/**
 * harness-decoded: Level 3 — Production Agent (TypeScript)
 * Mirrors Python production_agent: chained audit, KAIROS-style memory, swarm, health.
 *
 * Usage:
 *   npm install
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npx ts-node agent.ts "your task"
 *   npx ts-node agent.ts --parallel "analyze all modules"
 *   npx ts-node agent.ts --swarm "explore subsystems"
 *   npx ts-node agent.ts --health
 *
 * Animated explainers (no API key): ../../website/principles.html
 */

import Anthropic from "@anthropic-ai/sdk";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
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
// Harness configuration (env-driven, matches Python)
// ─────────────────────────────────────────────

interface HarnessConfig {
  model: string;
  maxTokensPerCall: number;
  sessionTokenBudget: number;
  maxIterations: number;
  compactionThreshold: number;
  contextWindowTokens: number;
  auditLogPath: string;
  checkpointDir: string;
  memoryPath: string;
  maxSwarmAgents: number;
}

function loadConfig(): HarnessConfig {
  return {
    model: process.env.AGENT_MODEL ?? "claude-opus-4-6",
    maxTokensPerCall: parseInt(process.env.MAX_TOKENS ?? "4096", 10),
    sessionTokenBudget: parseInt(process.env.SESSION_BUDGET ?? "500000", 10),
    maxIterations: parseInt(process.env.MAX_ITERATIONS ?? "50", 10),
    compactionThreshold: parseFloat(process.env.COMPACT_THRESHOLD ?? "0.85"),
    contextWindowTokens: parseInt(process.env.CONTEXT_WINDOW ?? "180000", 10),
    auditLogPath: process.env.AUDIT_LOG ?? ".harness/audit.jsonl",
    checkpointDir: process.env.CHECKPOINT_DIR ?? ".harness/checkpoints",
    memoryPath: process.env.MEMORY_PATH ?? ".harness/memory.json",
    maxSwarmAgents: parseInt(process.env.MAX_SWARM_AGENTS ?? "20", 10),
  };
}

function permissionSetFromEnv(): PermissionSet {
  const raw = process.env.PERMISSIONS ?? "FS_READ,FS_WRITE,SHELL_EXEC,NET_FETCH,GIT_READ,AGENT_SPAWN";
  const names = raw.split(",").map(s => s.trim()).filter(Boolean);
  const granted = new Set<Permission>();
  for (const n of names) {
    if ((Object.values(Permission) as string[]).includes(n)) granted.add(n as Permission);
  }
  return new PermissionSet(granted);
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
  permissionsSnapshot?: string[];
}

/** Append-only JSONL with SHA-256 chain (prevHash → hash per line). */
class AuditLog {
  private lastHash = "";

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.lastHash = this.loadLastHash();
  }

  private loadLastHash(): string {
    if (!fs.existsSync(this.filePath)) return "";
    try {
      const lines = fs.readFileSync(this.filePath, "utf-8").trim().split("\n").filter(Boolean);
      if (lines.length === 0) return "";
      const last = JSON.parse(lines[lines.length - 1]!) as { hash?: string };
      return last.hash ?? "";
    } catch {
      return "";
    }
  }

  private static entryHash(body: Record<string, unknown>): string {
    const { hash: _h, ...rest } = body;
    const keys = Object.keys(rest).filter(k => k !== "prevHash").sort();
    const stable: Record<string, unknown> = {};
    for (const k of keys) stable[k] = rest[k];
    return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
  }

  write(entry: AuditEntry): void {
    const prevHash = this.lastHash;
    const body: Record<string, unknown> = { ...entry, prevHash };
    const hash = AuditLog.entryHash(body);
    const record = { ...body, hash };
    fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n", "utf-8");
    this.lastHash = hash;
  }

  verifyChain(): [boolean, string] {
    if (!fs.existsSync(this.filePath)) return [true, ""];
    let prev = "";
    const lines = fs.readFileSync(this.filePath, "utf-8").trim().split("\n").filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      try {
        const record = JSON.parse(lines[i]!) as Record<string, unknown>;
        const stored = record.hash as string;
        delete record.hash;
        const computed = AuditLog.entryHash({ ...record });
        if (computed !== stored) return [false, `Hash mismatch at line ${i + 1}`];
        if ((record.prevHash as string) !== prev) return [false, `Chain break at line ${i + 1}`];
        prev = stored;
      } catch (e) {
        return [false, `Parse error at line ${i + 1}: ${e}`];
      }
    }
    return [true, ""];
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
          permissionsSnapshot: [...permissions.granted].map(p => String(p)),
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
      if (audit) {
        const argsStr = JSON.stringify(args);
        audit.write({
          sessionId, iteration, tool: this.name,
          argsHash: crypto.createHash("sha256").update(argsStr).digest("hex"),
          argsPreview: argsStr.slice(0, 200),
          resultSummary: "",
          error: msg, errorKind: kind, durationMs, timestamp: Date.now(),
          permissionsSnapshot: [...permissions.granted].map(p => String(p)),
        });
      }
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

class PatchFileTool extends Tool {
  constructor() {
    super("patch_file", "Apply a unified diff to an existing file.",
      { type: "object", properties: { path: { type: "string" }, patch: { type: "string" } }, required: ["path", "patch"] },
      [Permission.FS_READ, Permission.FS_WRITE]);
  }
  protected async run(args: Record<string, unknown>): Promise<string> {
    const p = args.path as string;
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
    const original = fs.readFileSync(p, "utf-8");
    const tmp = path.join(path.dirname(p), `.patch-${Date.now()}.tmp`);
    fs.writeFileSync(tmp, args.patch as string, "utf-8");
    try {
      await execAsync(`patch -u "${p}" -i "${tmp}"`, { timeout: 10_000 });
      return `Patched ${p} successfully`;
    } catch {
      fs.writeFileSync(p, original, "utf-8");
      throw new Error("patch failed; file restored");
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
}

class WebFetchTool extends Tool {
  constructor() {
    super("web_fetch", "HTTP GET a URL (allowlist: public documentation only in demos).",
      { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      [Permission.NET_FETCH]);
  }
  protected async run(args: Record<string, unknown>): Promise<string> {
    const url = args.url as string;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    return text.slice(0, 30_000);
  }
}

class GitReadTool extends Tool {
  constructor() {
    super("git_read", "Read-only git: status, branch, last commit subject.",
      { type: "object", properties: { command: { type: "string", enum: ["status", "branch", "last_log"] } }, required: ["command"] },
      [Permission.GIT_READ]);
  }
  protected async run(args: Record<string, unknown>): Promise<string> {
    const cmd = args.command as string;
    if (cmd === "status") {
      const { stdout } = await execAsync("git status -sb", { cwd: ".", timeout: 10_000 });
      return stdout;
    }
    if (cmd === "branch") {
      const { stdout } = await execAsync("git branch --show-current", { cwd: ".", timeout: 5_000 });
      return stdout.trim();
    }
    const { stdout } = await execAsync('git log -1 --oneline', { cwd: ".", timeout: 5_000 });
    return stdout.trim();
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

const AUTODREAM_SYSTEM = `You are KAIROS autoDream. Merge session transcripts into a JSON memory store.
Return ONLY valid JSON:
{
  "facts": [{"content": "string"}],
  "patterns": [{"content": "string"}],
  "open_questions": [{"content": "string"}]
}`;

class MemorySystem {
  private static readonly MAX_FAILURES = 3;
  private failures = 0;
  private readonly sessionId = crypto.randomBytes(4).toString("hex");

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly cfg: HarnessConfig,
  ) {}

  private estimateTokens(messages: unknown[]): number {
    return JSON.stringify(messages).length / 4;
  }

  memoryToPrefix(): Anthropic.MessageParam[] | null {
    if (!fs.existsSync(this.cfg.memoryPath)) return null;
    try {
      const mem = JSON.parse(fs.readFileSync(this.cfg.memoryPath, "utf-8")) as {
        facts?: Array<{ content: string }>;
        patterns?: Array<{ content: string }>;
        open_questions?: Array<{ content: string }>;
        session_count?: number;
      };
      const facts = (mem.facts ?? []).slice(0, 20).map(f => `- ${f.content}`).join("\n");
      const patterns = (mem.patterns ?? []).slice(0, 10).map(p => `- ${p.content}`).join("\n");
      const questions = (mem.open_questions ?? []).slice(0, 10).map(q => `- ${q.content}`).join("\n");
      const prefix = `<project_memory sessions="${mem.session_count ?? 0}">
CONFIRMED FACTS:
${facts || "(none yet)"}

PATTERNS:
${patterns || "(none yet)"}

OPEN QUESTIONS:
${questions || "(none yet)"}
</project_memory>`;
      return [
        { role: "user", content: prefix },
        { role: "assistant", content: "I've noted the project context. Ready for the task." },
      ];
    } catch {
      return null;
    }
  }

  async maybeCompact(messages: Anthropic.MessageParam[], trace: ExecutionTrace): Promise<Anthropic.MessageParam[]> {
    const limit = this.cfg.contextWindowTokens * this.cfg.compactionThreshold;
    if (this.estimateTokens(messages) <= limit) {
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
        model: this.model, max_tokens: this.cfg.maxTokensPerCall, system: COMPACTION_SYSTEM,
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
    fs.mkdirSync(this.cfg.checkpointDir, { recursive: true });
    const file = path.join(this.cfg.checkpointDir, `checkpoint_${this.sessionId}_${Date.now()}.jsonl`);
    fs.writeFileSync(file, messages.map(m => JSON.stringify(m)).join("\n"), "utf-8");
  }

  /** Background consolidation (simulates KAIROS; not an OS fork). */
  async runKairos(): Promise<void> {
    if (!fs.existsSync(this.cfg.checkpointDir)) return;
    const files = fs.readdirSync(this.cfg.checkpointDir).filter(f => f.endsWith(".jsonl")).sort().slice(-5);
    if (files.length === 0) return;

    const transcripts = files.map(f => {
      const full = path.join(this.cfg.checkpointDir, f);
      const lines = fs.readFileSync(full, "utf-8").split("\n").filter(Boolean);
      return { file: f, messages: lines.map(l => JSON.parse(l)) };
    });

    let existing: Record<string, unknown> = {};
    if (fs.existsSync(this.cfg.memoryPath)) {
      try { existing = JSON.parse(fs.readFileSync(this.cfg.memoryPath, "utf-8")); } catch { /* ignore */ }
    }

    const prompt = `Existing memory store:\n${JSON.stringify(existing, null, 2)}\n\nRecent sessions:\n${JSON.stringify(transcripts).slice(0, 80_000)}\n\nRun consolidation and return updated memory JSON.`;

    try {
      const resp = await this.client.messages.create({
        model: this.model, max_tokens: this.cfg.maxTokensPerCall, system: AUTODREAM_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      });
      let raw = resp.content.filter(b => b.type === "text").map(b => (b as Anthropic.TextBlock).text).join("");
      raw = raw.trim().replace(/^```json|^```|```$/g, "").trim();
      const newMemory = JSON.parse(raw) as Record<string, unknown>;
      newMemory.session_count = ((existing.session_count as number) ?? 0) + 1;
      newMemory.last_updated = new Date().toISOString();
      const tmp = `${this.cfg.memoryPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(newMemory, null, 2), "utf-8");
      fs.renameSync(tmp, this.cfg.memoryPath);
      console.log(`  [KAIROS] Memory updated`);
    } catch (e) {
      console.log(`  [KAIROS] autoDream failed: ${e}`);
    }
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

const SYSTEM_PROMPT = `You are a production-grade AI agent with filesystem, shell, and network access.

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
    private readonly cfg: HarnessConfig,
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
          model: this.cfg.model, max_tokens: this.cfg.maxTokensPerCall,
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
    private readonly cfg: HarnessConfig,
  ) {}

  async run(task: string): Promise<[string, ExecutionTrace]> {
    const trace = new ExecutionTrace(task, this.cfg.sessionTokenBudget);
    const prefix = this.memory.memoryToPrefix();
    let messages: Anthropic.MessageParam[] = [...(prefix ?? []), { role: "user", content: task }];
    const tools = this.toolRegistry.toApiFormat();

    console.log(`\n▶ [${trace.sessionId}] ${task.slice(0, 80)}\n`);

    while (trace.iterations < this.cfg.maxIterations) {
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
        void this.memory.runKairos().catch(e => console.error(`  [KAIROS] ${e}`));
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

    return [`[max iterations (${this.cfg.maxIterations}) reached]`, trace];
  }
}

// ─────────────────────────────────────────────
// Swarm (recursive spawn)
// ─────────────────────────────────────────────

interface ISwarmSpawn {
  spawn(task: string, parentId?: string | null): Promise<string>;
}

class SpawnSubagentTool extends Tool {
  constructor(private readonly orch: ISwarmSpawn) {
    super("spawn_subagent", "Spawn a child agent to handle a subtask.",
      { type: "object", properties: { task: { type: "string" }, description: { type: "string" } }, required: ["task"] },
      [Permission.AGENT_SPAWN]);
  }
  protected async run(args: Record<string, unknown>): Promise<string> {
    const id = await this.orch.spawn(args.task as string);
    return `Spawned subagent ${id} for: ${(args.description as string) ?? (args.task as string).slice(0, 50)}`;
  }
}

interface AgentSwarmResult {
  agentId: string;
  parentId: string | null;
  task: string;
  result: string;
  trace: ExecutionTrace;
  error?: string;
}

class SwarmOrchestrator implements ISwarmSpawn {
  private active = new Map<string, Promise<void>>();
  private results: AgentSwarmResult[] = [];

  constructor(
    private readonly harnessFactory: () => AgentHarness,
    private readonly maxAgents: number,
    private readonly sessionBudget: number,
  ) {}

  async spawn(task: string, parentId: string | null = null): Promise<string> {
    if (this.active.size >= this.maxAgents) {
      throw new Error(`Swarm capacity (${this.maxAgents}) reached.`);
    }
    const agentId = crypto.randomBytes(4).toString("hex");
    const harness = this.harnessFactory();
    harness.toolRegistry.register(new SpawnSubagentTool(this));

    const run = (async () => {
      try {
        const [result, trace] = await harness.run(task);
        this.results.push({ agentId, parentId, task, result, trace });
      } catch (e) {
        const t = new ExecutionTrace(task, this.sessionBudget);
        this.results.push({ agentId, parentId, task, result: "", trace: t, error: String(e) });
      } finally {
        this.active.delete(agentId);
      }
    })();

    this.active.set(agentId, run);
    return agentId;
  }

  async waitAll(timeoutMs = 600_000): Promise<AgentSwarmResult[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.active.size > 0) {
      if (Date.now() > deadline) {
        console.log(`  [swarm] timeout — ${this.active.size} agents still running`);
        break;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return this.results;
  }

  summary(): string {
    const ok = this.results.filter(r => !r.error).length;
    const fail = this.results.length - ok;
    const tokens = this.results.reduce((s, r) => s + r.trace.budget.usedTotal, 0);
    return `Swarm: ${this.results.length} agents, ${ok} succeeded, ${fail} failed, ${tokens.toLocaleString()} tokens total`;
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
// Health check
// ─────────────────────────────────────────────

async function healthCheck(cfg: HarnessConfig): Promise<{ status: string; model: string; checks: Record<string, string> }> {
  const checks: Record<string, string> = {};
  const client = new Anthropic();
  try {
    await client.messages.create({
      model: cfg.model, max_tokens: 5,
      messages: [{ role: "user", content: "ping" }],
    });
    checks.api = "ok";
  } catch (e) {
    checks.api = `error: ${e}`;
  }
  try {
    fs.mkdirSync(path.dirname(cfg.auditLogPath), { recursive: true });
    const audit = new AuditLog(cfg.auditLogPath);
    const [ok, msg] = audit.verifyChain();
    checks.audit_log = ok ? "ok" : `chain error: ${msg}`;
  } catch (e) {
    checks.audit_log = `error: ${e}`;
  }
  checks.memory = fs.existsSync(cfg.memoryPath) ? "exists" : "not yet created";
  const okVals = new Set(["ok", "not yet created", "exists"]);
  const status = Object.values(checks).every(v => okVals.has(v)) ? "ok" : "degraded";
  return { status, model: cfg.model, checks };
}

// ─────────────────────────────────────────────
// Factory + Entry Point
// ─────────────────────────────────────────────

function buildProductionHarness(config: HarnessConfig): AgentHarness {
  const client = new Anthropic();
  const registry = new ToolRegistry()
    .register(new ReadFileTool())
    .register(new WriteFileTool())
    .register(new PatchFileTool())
    .register(new ListDirectoryTool())
    .register(new GrepTool())
    .register(new BashTool("."))
    .register(new WebFetchTool())
    .register(new GitReadTool());

  return new AgentHarness(
    registry,
    permissionSetFromEnv(),
    new QueryEngine(client, config),
    new MemorySystem(client, config.model, config),
    new AuditLog(config.auditLogPath),
    config,
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const args = process.argv.slice(2);

  if (args.includes("--health")) {
    const h = await healthCheck(config);
    console.log(JSON.stringify(h, null, 2));
    process.exit(h.status === "ok" ? 0 : 1);
  }

  const parallel = args.includes("--parallel");
  const swarm = args.includes("--swarm");
  const taskArgs = args.filter(a => !a.startsWith("--"));

  if (taskArgs.length === 0) {
    console.log('Usage: npx ts-node agent.ts [--parallel|--swarm] "your task"');
    console.log("       npx ts-node agent.ts --health");
    process.exit(1);
  }

  const task = taskArgs.join(" ");

  if (swarm) {
    console.log(`[swarm mode] Task: ${task}`);
    const orch = new SwarmOrchestrator(
      () => buildProductionHarness(config),
      config.maxSwarmAgents,
      config.sessionTokenBudget,
    );
    const rootId = await orch.spawn(task);
    console.log(`  Root agent: ${rootId}`);
    const results = await orch.waitAll();
    const synth = buildProductionHarness(config);
    const parts = [`Original task: ${task}\n\nSubagent results (${results.length} agents):\n`];
    for (const r of results) {
      const mark = r.error ? "✗" : "✓";
      parts.push(`${mark} [${r.agentId}] ${r.task.slice(0, 60)}\n${r.result.slice(0, 500)}\n`);
    }
    parts.push("\nSynthesize the above into a coherent final response.");
    const [final, trace] = await synth.run(parts.join("\n"));
    console.log(`\nFinal Result:\n${final}`);
    console.log(orch.summary());
    console.log(trace.summary());
    return;
  }

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
      const results = await parallelFanOut(subtasks, () => buildProductionHarness(config));

      const totalCost = results.reduce((s, r) => s + r.trace.budget.estimatedCostUsd(), 0);
      console.log(`\n[fan-out complete] ${results.length} agents, $${totalCost.toFixed(4)} total`);

      const synth = buildProductionHarness(config);
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

  const harness = buildProductionHarness(config);
  const [result, trace] = await harness.run(task);
  console.log(`\nResult:\n${result}`);
  console.log(trace.summary());
}

main().catch(err => { console.error(err); process.exit(1); });
