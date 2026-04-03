/**
 * harness-decoded: Level 2 — Standard Agent (TypeScript)
 * Mirrors the Python standard_agent with identical interfaces.
 *
 * New vs Level 1:
 *   - autoCompact with LLM summarization
 *   - Full audit log (JSONL, append-only)
 *   - Error classification on all tool results
 *   - BashTool with env allowlist + destructive pattern blocking
 *   - GrepTool
 *   - Parallel fan-out orchestration
 *   - Token budget tracking
 *
 * Usage:
 *   npm install
 *   npx ts-node agent.ts "refactor auth module"
 *   npx ts-node agent.ts --parallel "analyze all modules"
 */

import Anthropic from "@anthropic-ai/sdk";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────
// Permission Model
// ─────────────────────────────────────────────

enum Permission {
  FS_READ    = "FS_READ",
  FS_WRITE   = "FS_WRITE",
  SHELL_EXEC = "SHELL_EXEC",
  NET_FETCH  = "NET_FETCH",
  GIT_READ   = "GIT_READ",
  AGENT_SPAWN = "AGENT_SPAWN",
}

class PermissionSet {
  constructor(public readonly granted: Set<Permission> = new Set()) {}

  static readOnly() { return new PermissionSet(new Set([Permission.FS_READ])); }
  static standard() { return new PermissionSet(new Set([Permission.FS_READ, Permission.FS_WRITE])); }
  static withShell() {
    return new PermissionSet(new Set([Permission.FS_READ, Permission.FS_WRITE, Permission.SHELL_EXEC]));
  }

  check(required: Permission[]): void {
    const missing = required.filter(p => !this.granted.has(p));
    if (missing.length > 0) throw new Error(`Missing permissions: ${missing.join(", ")}`);
  }
}

// ─────────────────────────────────────────────
// Error Classification
// ─────────────────────────────────────────────

enum ToolErrorKind {
  RETRYABLE         = "RETRYABLE",
  INPUT_INVALID     = "INPUT_INVALID",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  RESOURCE_MISSING  = "RESOURCE_MISSING",
  TIMEOUT           = "TIMEOUT",
  FATAL             = "FATAL",
  NEEDS_HUMAN       = "NEEDS_HUMAN",
}

interface ToolResult {
  output: string;
  error?: string;
  errorKind?: ToolErrorKind;
  durationMs: number;
}

// ─────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────

interface AuditEntry {
  sessionId: string;
  iteration: number;
  tool: string;
  argsHash: string;
  argsPreview: string;
  resultSummary: string;
  error?: string;
  errorKind?: string;
  durationMs: number;
  approved?: boolean;
  timestamp: number;
}

class AuditLog {
  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  write(entry: AuditEntry): void {
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
  }
}

// ─────────────────────────────────────────────
// Token Budget
// ─────────────────────────────────────────────

class TokenBudget {
  usedInput = 0;
  usedOutput = 0;

  constructor(public readonly sessionLimit: number) {}

  get remaining() { return this.sessionLimit - this.usedInput - this.usedOutput; }
  get usedTotal() { return this.usedInput + this.usedOutput; }

  record(input: number, output: number): void {
    this.usedInput += input;
    this.usedOutput += output;
    if (this.remaining < 0) {
      throw new Error(`Session token budget exceeded: ${this.usedTotal} / ${this.sessionLimit}`);
    }
  }

  estimatedCostUsd(): number {
    return this.usedInput / 1_000_000 * 15.0 + this.usedOutput / 1_000_000 * 75.0;
  }
}

// ─────────────────────────────────────────────
// Execution Trace
// ─────────────────────────────────────────────

interface ToolCallRecord {
  tool: string;
  argsPreview: string;
  success: boolean;
  durationMs: number;
  errorKind?: string;
  iteration: number;
}

class ExecutionTrace {
  readonly sessionId = crypto.randomBytes(4).toString("hex");
  iterations = 0;
  toolCalls: ToolCallRecord[] = [];
  budget: TokenBudget;
  compactionCount = 0;
  private startTime = Date.now();

  constructor(public readonly task: string, sessionBudget = 500_000) {
    this.budget = new TokenBudget(sessionBudget);
  }

  get durationS() { return (Date.now() - this.startTime) / 1000; }

  summary(): string {
    const toolCounts: Record<string, number> = {};
    for (const tc of this.toolCalls) toolCounts[tc.tool] = (toolCounts[tc.tool] ?? 0) + 1;
    return [
      `\n${"─".repeat(60)}`,
      `  Session:    ${this.sessionId}`,
      `  Task:       ${this.task.slice(0, 60)}`,
      `  Iterations: ${this.iterations}`,
      `  Tool calls: ${this.toolCalls.length}`,
      `  Compacted:  ${this.compactionCount}×`,
      `  Tokens:     ${this.budget.usedInput.toLocaleString()} in / ${this.budget.usedOutput.toLocaleString()} out`,
      `  Est. cost:  $${this.budget.estimatedCostUsd().toFixed(4)}`,
      `  Duration:   ${this.durationS.toFixed(1)}s`,
      `${"─".repeat(60)}`,
      `  Tools: ${Object.entries(toolCounts).map(([t,n]) => `${t}×${n}`).join(", ")}`,
    ].join("\n");
  }
}

// ─────────────────────────────────────────────
// Tool System
// ─────────────────────────────────────────────

const DESTRUCTIVE_PATTERNS = [
  "rm -rf", "rm -r /", "> /dev/", ":(){:|:&};:",
  "git push --force", "git push -f", "DROP TABLE", "DELETE FROM",
];

abstract class Tool {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly inputSchema: object,
    public readonly requiredPermissions: Permission[],
  ) {}

  async execute(
    args: Record<string, unknown>,
    permissions: PermissionSet,
    audit?: AuditLog,
    sessionId = "",
    iteration = 0,
  ): Promise<ToolResult> {
    try {
      permissions.check(this.requiredPermissions);
    } catch (err) {
      return { output: "", error: String(err), errorKind: ToolErrorKind.PERMISSION_DENIED, durationMs: 0 };
    }

    const start = Date.now();
    try {
      const output = await this.run(args);
      const durationMs = Date.now() - start;
      const result: ToolResult = { output: output.slice(0, 50_000), durationMs };
      if (audit) {
        const argsStr = JSON.stringify(args);
        audit.write({
          sessionId, iteration, tool: this.name,
          argsHash: crypto.createHash("sha256").update(argsStr).digest("hex"),
          argsPreview: argsStr.slice(0, 200),
          resultSummary: output.slice(0, 500),
          durationMs, timestamp: Date.now(),
        });
      }
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      const msg = String(err);
      const kind = msg.includes("ENOENT") ? ToolErrorKind.RESOURCE_MISSING
                 : msg.includes("EACCES") ? ToolErrorKind.PERMISSION_DENIED
                 : msg.includes("timeout") ? ToolErrorKind.TIMEOUT
                 : ToolErrorKind.FATAL;
      return { output: "", error: msg, errorKind: kind, durationMs };
    }
  }

  protected abstract run(args: Record<string, unknown>): Promise<string>;
}

class ReadFileTool extends Tool {
  constructor() {
    super("read_file", "Read file contents.",
      { type:"object", properties:{path:{type:"string"}}, required:["path"] },
      [Permission.FS_READ]);
  }
  protected async run(args: Record<string, unknown>) {
    return fs.readFileSync(args.path as string, "utf-8");
  }
}

class WriteFileTool extends Tool {
  constructor() {
    super("write_file", "Write content to a file, creating parent dirs.",
      { type:"object", properties:{path:{type:"string"},content:{type:"string"}}, required:["path","content"] },
      [Permission.FS_READ, Permission.FS_WRITE]);
  }
  protected async run(args: Record<string, unknown>) {
    const p = args.path as string;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, args.content as string, "utf-8");
    return `Written ${(args.content as string).length} bytes to ${p}`;
  }
}

class ListDirectoryTool extends Tool {
  constructor() {
    super("list_directory", "List files in a directory.",
      { type:"object", properties:{
          path:{type:"string"},
          recursive:{type:"boolean",default:false},
          pattern:{type:"string",default:"*"},
        }, required:["path"] },
      [Permission.FS_READ]);
  }
  protected async run(args: Record<string, unknown>) {
    const root = args.path as string;
    const recursive = args.recursive as boolean ?? false;
    const collectFiles = (dir: string, base = ""): string[] => {
      try {
        return fs.readdirSync(dir).flatMap(entry => {
          if (entry.startsWith(".") || entry === "node_modules") return [];
          const rel = base ? `${base}/${entry}` : entry;
          const full = path.join(dir, entry);
          const stat = fs.statSync(full);
          if (recursive && stat.isDirectory()) return [rel, ...collectFiles(full, rel)];
          return [rel];
        });
      } catch { return []; }
    };
    return collectFiles(root).sort().slice(0, 500).join("\n") || "(empty)";
  }
}

class GrepTool extends Tool {
  constructor() {
    super("grep", "Search file contents with a regex pattern.",
      { type:"object", properties:{
          pattern:{type:"string"},
          path:{type:"string"},
          contextLines:{type:"integer",default:2},
        }, required:["pattern","path"] },
      [Permission.FS_READ]);
  }
  protected async run(args: Record<string, unknown>) {
    const ctx = (args.contextLines as number ?? 2);
    const cmd = `grep -rn -C${ctx} ${JSON.stringify(args.pattern)} ${JSON.stringify(args.path)} --include="*.ts" --include="*.js" --include="*.py" --include="*.md" 2>/dev/null | head -200`;
    try {
      const { stdout } = await execAsync(cmd, { timeout: 15_000 });
      return stdout || "(no matches)";
    } catch { return "(no matches)"; }
  }
}

class BashTool extends Tool {
  private static readonly ENV_ALLOWLIST = ["PATH","HOME","USER","LANG","TERM","PYTHONPATH","VIRTUAL_ENV"];

  constructor(private readonly cwd: string = ".") {
    super("bash", "Execute a bash command in a sandboxed environment.",
      { type:"object", properties:{command:{type:"string"},timeout:{type:"number",default:30}}, required:["command"] },
      [Permission.SHELL_EXEC]);
  }

  private isDestructive(cmd: string): boolean {
    return DESTRUCTIVE_PATTERNS.some(p => cmd.includes(p));
  }

  protected async run(args: Record<string, unknown>) {
    const command = args.command as string;
    const timeout = (args.timeout as number ?? 30) * 1000;

    if (this.isDestructive(command)) {
      return `[BLOCKED: destructive pattern] ${command.slice(0, 100)}\nRequires explicit approval.`;
    }

    const env = Object.fromEntries(
      BashTool.ENV_ALLOWLIST.filter(k => process.env[k]).map(k => [k, process.env[k]!])
    );

    const { stdout, stderr } = await execAsync(command, {
      cwd: this.cwd, env, timeout, maxBuffer: 500_000,
    });
    return (stdout + stderr).slice(0, 50_000);
  }
}

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): this { this.tools.set(tool.name, tool); return this; }

  get(name: string): Tool {
    const t = this.tools.get(name);
    if (!t) throw new Error(`Unknown tool: ${name}. Available: ${[...this.tools.keys()]}`);
    return t;
  }

  toApiFormat(): Anthropic.Tool[] {
    return [...this.tools.values()].map(t => ({
      name: t.name, description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
    }));
  }
}

// ─────────────────────────────────────────────
// Memory System (autoCompact)
// ─────────────────────────────────────────────

const COMPACTION_SYSTEM = `You are a context compaction assistant for an AI agent session.
Extract the following and return ONLY valid JSON (no markdown):
{
  "task_specification": "original task + all constraints verbatim",
  "completed_work": ["specific things accomplished"],
  "current_state": "where in the task we are now",
  "open_questions": ["unresolved decisions or blockers"],
  "key_facts": ["critical findings the agent will need to continue"]
}`;

class MemorySystem {
  private static readonly MAX_FAILURES = 3;
  private failures = 0;
  private readonly sessionId = crypto.randomBytes(4).toString("hex");

  constructor(private readonly client: Anthropic, private readonly model: string) {}

  private estimateTokens(messages: unknown[]): number {
    return JSON.stringify(messages).length / 4;
  }

  async maybeCompact(messages: Anthropic.MessageParam[], trace: ExecutionTrace): Promise<Anthropic.MessageParam[]> {
    if (this.estimateTokens(messages) <= 180_000 * 0.85) {
      this.failures = 0;
      return messages;
    }

    if (this.failures >= MemorySystem.MAX_FAILURES) {
      throw new Error(`autoCompact gave up after ${MemorySystem.MAX_FAILURES} failures. Start new session.`);
    }

    console.log(`  [memory] autoCompact triggered`);
    this.checkpoint(messages);

    try {
      const resp = await this.client.messages.create({
        model: this.model, max_tokens: 4096, system: COMPACTION_SYSTEM,
        messages: messages.slice(-40) as Anthropic.MessageParam[],
      });

      let raw = resp.content.filter(b => b.type === "text").map(b => (b as Anthropic.TextBlock).text).join("");
      raw = raw.trim().replace(/^```json|^```|```$/g, "").trim();
      const summary = JSON.parse(raw);

      this.failures = 0;
      trace.compactionCount++;
      return [
        { role: "user", content: `<compaction_summary>\n${JSON.stringify(summary, null, 2)}\n</compaction_summary>` },
        { role: "assistant", content: "Context compacted. Continuing." },
      ];
    } catch (err) {
      this.failures++;
      console.log(`  [memory] compaction failed (${this.failures}/${MemorySystem.MAX_FAILURES}): ${err}`);
      return messages;
    }
  }

  private checkpoint(messages: unknown[]): void {
    const dir = ".harness/checkpoints";
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `checkpoint_${this.sessionId}_${Date.now()}.jsonl`);
    fs.writeFileSync(file, messages.map(m => JSON.stringify(m)).join("\n"), "utf-8");
  }
}

// ─────────────────────────────────────────────
// Query Engine
// ─────────────────────────────────────────────

const RETRY_POLICIES: Record<number, [number, number, number, boolean]> = {
  429: [5, 1.0, 60.0, true],
  529: [3, 2.0, 30.0, true],
  500: [3, 1.0, 10.0, false],
  503: [3, 1.0, 10.0, false],
};

const SYSTEM_PROMPT = `You are a production-grade AI agent with filesystem and shell access.

Complete the given task step-by-step using available tools.
Read before you write. Use targeted reads (grep, specific file) over broad scans.
Destructive shell commands are blocked by the harness — use safer alternatives.

Error recovery:
- RETRYABLE: try again unchanged
- INPUT_INVALID: reformulate arguments  
- RESOURCE_MISSING: verify path and retry
- PERMISSION_DENIED: find another approach
- TIMEOUT: try a simpler operation`;

class QueryEngine {
  constructor(
    private readonly client: Anthropic,
    private readonly model = "claude-opus-4-6",
    private readonly maxTokens = 4096,
  ) {}

  async call(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    trace: ExecutionTrace,
  ): Promise<Anthropic.Message> {
    let lastErr: Error | undefined;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const resp = await this.client.messages.create({
          model: this.model, max_tokens: this.maxTokens,
          system: SYSTEM_PROMPT, messages, tools,
        });
        trace.budget.record(resp.usage.input_tokens, resp.usage.output_tokens);
        return resp;
      } catch (err) {
        const status = (err as { status?: number }).status;
        const policy = status ? RETRY_POLICIES[status] : undefined;
        if (policy && attempt < policy[0] - 1) {
          let delay = Math.min(policy[1] * Math.pow(2, attempt), policy[2]);
          if (policy[3]) delay *= 0.5 + Math.random() * 0.5;
          console.log(`  [api ${status}] retry in ${delay.toFixed(1)}s`);
          await new Promise(r => setTimeout(r, delay * 1000));
          lastErr = err as Error;
        } else throw err;
      }
    }
    throw new Error(`Query failed after retries: ${lastErr?.message}`);
  }
}

// ─────────────────────────────────────────────
// Agent Harness
// ─────────────────────────────────────────────

class AgentHarness {
  constructor(
    public readonly toolRegistry: ToolRegistry,
    private readonly permissions: PermissionSet,
    private readonly queryEngine: QueryEngine,
    private readonly memory: MemorySystem,
    private readonly audit: AuditLog,
    private readonly maxIterations = 50,
  ) {}

  async run(task: string): Promise<[string, ExecutionTrace]> {
    const trace = new ExecutionTrace(task);
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: task }];
    const tools = this.toolRegistry.toApiFormat();

    console.log(`\n▶ [${trace.sessionId}] ${task.slice(0, 80)}\n`);

    while (trace.iterations < this.maxIterations) {
      trace.iterations++;

      try {
        messages = await this.memory.maybeCompact(messages, trace);
      } catch (err) {
        return [String(err), trace];
      }

      process.stdout.write(`  [iter ${String(trace.iterations).padStart(2, "0")}] `);
      const response = await this.queryEngine.call(messages, tools, trace);
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        const final = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map(b => b.text).join("") || "(no output)";
        console.log("✓ done");
        return [final, trace];
      }

      if (response.stop_reason === "tool_use") {
        const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        console.log(`tools: ${toolBlocks.map(b => b.name).join(", ")}`);

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolBlocks) {
          let result: ToolResult;
          try {
            const tool = this.toolRegistry.get(block.name);
            result = await tool.execute(
              block.input as Record<string, unknown>,
              this.permissions, this.audit,
              trace.sessionId, trace.iterations,
            );
          } catch (err) {
            result = { output: "", error: String(err), errorKind: ToolErrorKind.FATAL, durationMs: 0 };
          }

          trace.toolCalls.push({
            tool: block.name,
            argsPreview: JSON.stringify(block.input).slice(0, 80),
            success: !result.error,
            durationMs: result.durationMs,
            errorKind: result.errorKind,
            iteration: trace.iterations,
          });

          const content = result.error
            ? `[${result.errorKind ?? "UNKNOWN"}] ${result.error}`
            : result.output;

          toolResults.push({ type: "tool_result", tool_use_id: block.id, content });
        }

        messages.push({ role: "user", content: toolResults });
        continue;
      }

      console.log(`[unexpected stop: ${response.stop_reason}]`);
      break;
    }

    return [`[max iterations (${this.maxIterations}) reached]`, trace];
  }
}

// ─────────────────────────────────────────────
// Parallel Fan-Out
// ─────────────────────────────────────────────

interface SubTask { prompt: string; description?: string; }

interface FanOutResult {
  subtask: SubTask;
  result: string;
  trace: ExecutionTrace;
  error?: string;
}

async function parallelFanOut(
  subtasks: SubTask[],
  harnessFactory: () => AgentHarness,
  maxConcurrency = 4,
): Promise<FanOutResult[]> {
  const semaphore = { count: 0 };
  const queue: Array<() => void> = [];

  const acquire = () => new Promise<void>(resolve => {
    if (semaphore.count < maxConcurrency) { semaphore.count++; resolve(); }
    else queue.push(resolve);
  });

  const release = () => {
    semaphore.count--;
    const next = queue.shift();
    if (next) { semaphore.count++; next(); }
  };

  return Promise.all(subtasks.map(async (subtask) => {
    await acquire();
    try {
      const harness = harnessFactory();
      const [result, trace] = await harness.run(subtask.prompt);
      return { subtask, result, trace };
    } catch (err) {
      const trace = new ExecutionTrace(subtask.prompt);
      return { subtask, result: "", trace, error: String(err) };
    } finally {
      release();
    }
  }));
}

// ─────────────────────────────────────────────
// Factory + Entry Point
// ─────────────────────────────────────────────

function buildHarness(): AgentHarness {
  const client = new Anthropic();
  const model = "claude-opus-4-6";

  const registry = new ToolRegistry()
    .register(new ReadFileTool())
    .register(new WriteFileTool())
    .register(new ListDirectoryTool())
    .register(new GrepTool())
    .register(new BashTool("."));

  return new AgentHarness(
    registry,
    PermissionSet.withShell(),
    new QueryEngine(client, model),
    new MemorySystem(client, model),
    new AuditLog(".harness/audit.jsonl"),
    50,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parallel = args.includes("--parallel");
  const taskArgs = args.filter(a => !a.startsWith("--"));

  if (taskArgs.length === 0) {
    console.log('Usage: npx ts-node agent.ts [--parallel] "your task"');
    process.exit(1);
  }

  const task = taskArgs.join(" ");

  if (parallel) {
    const dirs = fs.readdirSync(".").filter(e => {
      try { return !e.startsWith(".") && fs.statSync(e).isDirectory(); }
      catch { return false; }
    }).slice(0, 6);

    if (dirs.length === 0) {
      console.log("No subdirectories found. Running single agent.");
    } else {
      const subtasks: SubTask[] = dirs.map(d => ({
        prompt: `${task} — focus specifically on the '${d}' directory`,
        description: `dir: ${d}`,
      }));

      console.log(`[parallel] Spawning ${subtasks.length} agents...\n`);
      const results = await parallelFanOut(subtasks, buildHarness);

      const totalCost = results.reduce((s, r) => s + r.trace.budget.estimatedCostUsd(), 0);
      console.log(`\n[fan-out complete] ${results.length} agents, $${totalCost.toFixed(4)} total`);

      const synth = buildHarness();
      const parts = [`Original task: ${task}\n\nSubtask results:\n`];
      for (const r of results) {
        parts.push(`[${r.subtask.description}]\n${r.result.slice(0, 500)}\n`);
      }
      parts.push("\nSynthesize into a coherent final response.");
      const [final, trace] = await synth.run(parts.join("\n"));
      console.log(`\nResult:\n${final}`);
      console.log(trace.summary());
      return;
    }
  }

  const harness = buildHarness();
  const [result, trace] = await harness.run(task);
  console.log(`\nResult:\n${result}`);
  console.log(trace.summary());
}

main().catch(err => { console.error(err); process.exit(1); });
