/**
 * harness-decoded: Level 1 — Minimal Agent (TypeScript)
 * ~300 lines. Identical interface to the Python implementation.
 *
 * Usage:
 *   npm install
 *   npx ts-node agent.ts "list all TODO comments in this directory"
 */

import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────
// Permission Model
// ─────────────────────────────────────────────

enum Permission {
  FS_READ = "FS_READ",
  FS_WRITE = "FS_WRITE",
  SHELL_EXEC = "SHELL_EXEC",
  NET_FETCH = "NET_FETCH",
}

class PermissionSet {
  constructor(public readonly granted: Set<Permission> = new Set()) {}

  static readOnly(): PermissionSet {
    return new PermissionSet(new Set([Permission.FS_READ]));
  }

  static standard(): PermissionSet {
    return new PermissionSet(new Set([Permission.FS_READ, Permission.FS_WRITE]));
  }

  check(required: Permission[]): void {
    const missing = required.filter((p) => !this.granted.has(p));
    if (missing.length > 0) {
      throw new Error(`Missing permissions: ${missing.join(", ")}`);
    }
  }
}

// ─────────────────────────────────────────────
// Tool System
// ─────────────────────────────────────────────

interface ToolResult {
  output: string;
  error?: string;
  durationMs: number;
}

interface InputSchema {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
}

abstract class Tool {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly inputSchema: InputSchema,
    public readonly requiredPermissions: Permission[]
  ) {}

  async execute(args: Record<string, unknown>, permissions: PermissionSet): Promise<ToolResult> {
    permissions.check(this.requiredPermissions);
    const start = Date.now();
    try {
      const output = await this.run(args);
      return { output, durationMs: Date.now() - start };
    } catch (err) {
      const error = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
      return { output: "", error, durationMs: Date.now() - start };
    }
  }

  protected abstract run(args: Record<string, unknown>): Promise<string>;
}

class ReadFileTool extends Tool {
  constructor() {
    super(
      "read_file",
      "Read the contents of a file. Returns the full text content.",
      {
        type: "object",
        properties: { path: { type: "string", description: "Path to the file to read" } },
        required: ["path"],
      },
      [Permission.FS_READ]
    );
  }

  protected async run(args: Record<string, unknown>): Promise<string> {
    const { readFileSync } = await import("fs");
    const path = args.path as string;
    return readFileSync(path, "utf-8");
  }
}

class ListDirectoryTool extends Tool {
  constructor() {
    super(
      "list_directory",
      "List files and directories at a given path.",
      {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to list" },
          recursive: { type: "boolean", default: false },
        },
        required: ["path"],
      },
      [Permission.FS_READ]
    );
  }

  protected async run(args: Record<string, unknown>): Promise<string> {
    const { readdirSync, statSync } = await import("fs");
    const { join } = await import("path");
    const root = args.path as string;
    const recursive = args.recursive as boolean ?? false;

    const list = (dir: string, base = ""): string[] => {
      return readdirSync(dir).flatMap((entry) => {
        if (entry.startsWith(".")) return [];
        const rel = base ? `${base}/${entry}` : entry;
        const full = join(dir, entry);
        if (recursive && statSync(full).isDirectory()) {
          return [rel, ...list(full, rel)];
        }
        return [rel];
      });
    };

    const entries = list(root).sort();
    return entries.length > 0 ? entries.join("\n") : "(empty directory)";
  }
}

class WriteFileTool extends Tool {
  constructor() {
    super(
      "write_file",
      "Write content to a file. Creates the file if it does not exist.",
      {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      [Permission.FS_READ, Permission.FS_WRITE]
    );
  }

  protected async run(args: Record<string, unknown>): Promise<string> {
    const { writeFileSync, mkdirSync } = await import("fs");
    const { dirname } = await import("path");
    const path = args.path as string;
    const content = args.content as string;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
    return `Written ${content.length} bytes to ${path}`;
  }
}

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}. Available: ${[...this.tools.keys()]}`);
    return tool;
  }

  toApiFormat(): Anthropic.Tool[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
    }));
  }
}

// ─────────────────────────────────────────────
// Execution Trace
// ─────────────────────────────────────────────

interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: ToolResult;
  timestamp: number;
}

class ExecutionTrace {
  iterations = 0;
  toolCalls: ToolCallRecord[] = [];
  totalInputTokens = 0;
  totalOutputTokens = 0;
  readonly startTime = Date.now();

  constructor(public readonly task: string) {}

  get durationS(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  get estimatedCostUsd(): number {
    return this.totalInputTokens / 1_000_000 * 15.0 +
           this.totalOutputTokens / 1_000_000 * 75.0;
  }

  summary(): string {
    const lines = [
      `\n${"─".repeat(50)}`,
      `  Task:       ${this.task.slice(0, 60)}`,
      `  Iterations: ${this.iterations}`,
      `  Tool calls: ${this.toolCalls.length}`,
      `  Tokens:     ${this.totalInputTokens.toLocaleString()} in / ${this.totalOutputTokens.toLocaleString()} out`,
      `  Est. cost:  $${this.estimatedCostUsd.toFixed(4)}`,
      `  Duration:   ${this.durationS.toFixed(1)}s`,
      `${"─".repeat(50)}`,
    ];
    if (this.toolCalls.length > 0) {
      lines.push("  Tool calls:");
      for (const tc of this.toolCalls) {
        const status = tc.result.error ? "✗" : "✓";
        lines.push(`    ${status} ${tc.tool}(${JSON.stringify(tc.args).slice(0, 40)}...) [${tc.result.durationMs}ms]`);
      }
    }
    return lines.join("\n");
  }
}

// ─────────────────────────────────────────────
// Query Engine
// ─────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRYABLE_STATUS = new Set([429, 529, 500, 503]);

class QueryEngine {
  constructor(
    private client: Anthropic,
    private model = "claude-opus-4-6",
    private maxTokens = 4096
  ) {}

  async call(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    system: string,
    trace: ExecutionTrace
  ): Promise<Anthropic.Message> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system,
          messages,
          tools,
        });
        trace.totalInputTokens += response.usage.input_tokens;
        trace.totalOutputTokens += response.usage.output_tokens;
        return response;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status && RETRYABLE_STATUS.has(status)) {
          const wait = 2 ** attempt * 1000;
          console.log(`  [api error ${status}] retrying in ${wait / 1000}s`);
          await new Promise((r) => setTimeout(r, wait));
          lastError = err as Error;
        } else {
          throw err;
        }
      }
    }
    throw new Error(`Query failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
  }
}

// ─────────────────────────────────────────────
// Agent Harness
// ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a capable AI agent with access to tools.

Your job: complete the task given to you, step by step, using the available tools.

Guidelines:
- Use tools to gather information before drawing conclusions
- Prefer targeted reads over full directory scans when you know what you need
- When you have enough information to complete the task, call the task complete
- Be precise and concise in your final response

You are NOT allowed to:
- Make up file contents you haven't read
- Claim a task is complete if you haven't verified it with tool calls`;

class AgentHarness {
  constructor(
    private toolRegistry: ToolRegistry,
    private permissions: PermissionSet,
    private queryEngine: QueryEngine,
    private maxIterations = 25
  ) {}

  async run(task: string): Promise<[string, ExecutionTrace]> {
    const trace = new ExecutionTrace(task);
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: task }];
    const tools = this.toolRegistry.toApiFormat();

    console.log(`\n▶ Task: ${task}\n`);

    while (trace.iterations < this.maxIterations) {
      trace.iterations++;
      console.log(`  [iter ${trace.iterations}] thinking...`);

      const response = await this.queryEngine.call(messages, tools, SYSTEM_PROMPT, trace);
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        const final = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("") || "(no text response)";
        console.log("\n✓ Complete\n");
        return [final, trace];
      }

      if (response.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== "tool_use") continue;

          console.log(`  [tool] ${block.name}(${JSON.stringify(block.input).slice(0, 60)})`);

          let result: ToolResult;
          try {
            const tool = this.toolRegistry.get(block.name);
            result = await tool.execute(block.input as Record<string, unknown>, this.permissions);
          } catch (err) {
            result = { output: "", error: String(err), durationMs: 0 };
          }

          trace.toolCalls.push({ tool: block.name, args: block.input as Record<string, unknown>, result, timestamp: Date.now() });

          const content = result.error ? `Error: ${result.error}` : result.output.slice(0, 8000);
          if (result.error) console.log(`  [error] ${result.error}`);

          toolResults.push({ type: "tool_result", tool_use_id: block.id, content });
        }

        messages.push({ role: "user", content: toolResults });
        continue;
      }

      console.warn(`  [warn] unexpected stop_reason: ${response.stop_reason}`);
      break;
    }

    return [`[max iterations (${this.maxIterations}) reached]`, trace];
  }
}

// ─────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────

function buildDefaultHarness(): AgentHarness {
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new ListDirectoryTool());
  registry.register(new WriteFileTool());

  return new AgentHarness(
    registry,
    PermissionSet.standard(),
    new QueryEngine(new Anthropic())
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: npx ts-node agent.ts "your task here"');
    console.log('Example: npx ts-node agent.ts "list all TypeScript files and count lines"');
    process.exit(1);
  }

  const task = args.join(" ");
  const harness = buildDefaultHarness();
  const [result, trace] = await harness.run(task);

  console.log(`Result:\n${result}`);
  console.log(trace.summary());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
