# Architecture Overview: Claude Code Decoded

> **简体中文：** [架构总览](zh/01-architecture.md)

> A **logical** map of the harness, layer by layer. Ground truth for **what ships in public** is [anthropics/claude-code](https://github.com/anthropics/claude-code) plus [official docs](https://code.claude.com/docs/en/overview); quantitative module sizes below follow **post-leak discourse** (see [methodology.md](methodology.md)).

---

## Official repository, shipped product, and this diagram

Anthropic’s public repo **[anthropics/claude-code](https://github.com/anthropics/claude-code)** contains **plugins**, **examples**, **`.claude/`** (slash-style commands and related config), **`scripts/`** / **`Script/`**, CI under **`.github/`**, and similar surfaces — not a full source listing of the distributed `claude` binary. Installation is via curl, Homebrew, WinGet, etc.; see **[setup](https://code.claude.com/docs/en/setup)** and the **[product overview](https://code.claude.com/docs/en/overview)**.

### Mapping public artifacts to harness concepts

| Public artifact (upstream) | Harness idea it reflects |
|----------------------------|---------------------------|
| [`plugins/`](https://github.com/anthropics/claude-code/tree/main/plugins) | Extension packs: custom commands, agents, and tool-shaped capabilities |
| [`examples/`](https://github.com/anthropics/claude-code/tree/main/examples) | Recipes and integration patterns |
| [`.claude/`](https://github.com/anthropics/claude-code/tree/main/.claude) | Declarative command hooks the product loads at runtime |
| `scripts/`, `Script/` | Installer and automation glue around the shipped CLI |

### Relation to the five-layer map

The diagram below is a **pedagogical decomposition** (bridge → orchestration → agent loop → query engine ↔ memory & tools → API model). It is consistent with **documented product behavior** and **leak-era architecture discussion**, but **line counts in the figure** (e.g. ~46K / ~29K) are **Tier A/B** — community-scale estimates, **not** file-by-file counts from the public GitHub tree.

---

## System Map

```
                        ┌─────────────────────┐
                        │     User / IDE       │
                        └──────────┬──────────┘
                                   │ natural language task
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│                        IDE Bridge                             │
│  VSCode extension · JetBrains plugin · CLI terminal UI (Ink) │
│  bidirectional protocol · inline diff preview · approval UI  │
└──────────────────────────────────┬───────────────────────────┘
                                   │ structured task + context
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│                    Multi-Agent Orchestrator                   │
│  task decomposition · subagent spawning · result aggregation │
│  fan-out strategies: sequential / parallel / swarm           │
└────────┬─────────────────────────────────────────┬───────────┘
         │ (main agent)                             │ (subagents)
         ▼                                         ▼
┌─────────────────────┐                ┌─────────────────────┐
│    Agent Loop       │                │    Agent Loop       │
│  (single instance)  │     ...        │  (single instance)  │
└────────┬────────────┘                └─────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│                      Query Engine                             │
│  ~46K lines · streaming · backpressure · retry · caching     │
│  token accounting · cost tracking · model routing            │
└──────────────────────────────────┬───────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
         ┌──────────────────┐         ┌──────────────────────┐
         │   Memory System  │         │    Tool System        │
         │  autoCompact     │         │  ~29K lines           │
         │  KAIROS daemon   │         │  40+ tools            │
         │  autoDream       │         │  permission-gated     │
         │  checkpointing   │         │  sandboxed            │
         └────────┬─────────┘         └──────────┬───────────┘
                  │                              │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │     Claude Model       │
                    │  (via Anthropic API)   │
                    └────────────────────────┘
```

---

## Layer 1: IDE Bridge

The surface the user interacts with. Three implementations in the leaked source:

**Terminal UI** — Built with [Ink](https://github.com/vadimdemedes/ink), a React renderer for terminals. This is why Claude Code's terminal output looks like a proper UI rather than scrolling text. Components include an approval dialog, diff viewer, progress indicators, and the "Buddy" companion system.

**VSCode Extension** — Bidirectional protocol over a local socket. The extension can:
- Send files and cursor position as context
- Receive and preview diffs before application
- Show inline approval prompts for destructive operations
- Display agent status without leaving the editor

**JetBrains Plugin** — Same protocol, different host.

**Key design decision**: The bridge is a thin transport layer. It serializes user intent and IDE context into a structured task object. It does not make any AI decisions. This separation means the harness runs identically whether invoked from VSCode, a terminal, or a test harness.

---

## Layer 2: Multi-Agent Orchestrator

When a task is too large or complex for a single agent loop, the orchestrator decomposes it and delegates.

**Three coordination patterns** found in the leaked source:

```
Sequential (default):
  orchestrator → subagent_1 → result_1 → subagent_2 → result_2 → aggregate

Parallel fan-out (independent subtasks):
  orchestrator → subagent_1 ─┐
               → subagent_2 ─┼─ barrier → aggregate results
               → subagent_3 ─┘

Swarm (emergent coordination):
  orchestrator → subagent_1 ─→ discovers subtask → spawns subagent_4
               → subagent_2 ─→ completes → reports to orchestrator
               → subagent_3 ─→ blocked → signals orchestrator
```

**Context isolation**: Each subagent gets a scoped copy of the context — task-specific, not the full session history. This is critical for both performance (smaller context = cheaper API calls) and correctness (subagents don't see unrelated conversation).

**Result aggregation**: The orchestrator receives structured results from all subagents and synthesizes them. If a subagent fails, the orchestrator decides whether to retry, skip, or abort — the same error handling logic as the Tool System.

---

## Layer 3: Agent Loop

The core loop that every agent (main or sub) executes:

```
while not done and iterations < max_iterations:
    1. Observe:  build context from memory + current state
    2. Decide:   call LLM via Query Engine, get tool_calls or final_response
    3. Act:      execute tool_calls via Tool System
    4. Update:   add observations to memory, check compaction threshold
    5. Check:    has the task been completed? does human approval need?
```

**Iteration limit**: The leaked source revealed that runaway agents were a real operational problem. The `max_iterations` guard is not just a safety measure — it's load management. Without it, a confused agent can loop indefinitely, burning API budget.

**Approval gates**: Certain tool calls (destructive file operations, network calls to new domains, shell commands matching sensitive patterns) trigger a pause in the loop and surface an approval request to the user. The loop resumes only after explicit approval or denial.

---

## Layer 4: Query Engine (~46K lines)

The most complex single module. Handles all communication with the LLM.

**Streaming pipeline**: Claude Code uses streaming responses (`stream=True`) for all non-trivial calls. The Query Engine processes the stream token-by-token, building tool call structures incrementally and updating the terminal UI in real-time.

**Backpressure**: If the terminal UI or downstream consumers can't keep up with the stream, the Query Engine buffers and throttles. This prevents memory exhaustion on long responses.

**Retry strategies** (from source analysis):
```
retryable:
  - 429 (rate limit) → exponential backoff with jitter
  - 529 (overloaded) → exponential backoff
  - 500/503 → fixed delay, 3 attempts max
  - network timeout → immediate retry, 2 attempts max

non-retryable:
  - 400 (invalid request) → surface error immediately
  - 401/403 (auth) → surface error immediately
  - context_length_exceeded → trigger compaction, retry once
```

**Response caching**: Identical tool-observation sequences can produce cached responses. This is important for multi-agent scenarios where several subagents observe the same file contents.

**Model routing**: The leaked source contains references to routing logic based on task complexity. Simple tool-only steps may use a faster/cheaper model variant; complex reasoning steps use the full model.

---

## Layer 5: Memory System

**autoCompact** — Triggered when the context window reaches ~85% capacity. Generates a structured summary preserving: task specification, constraints and requirements, completed work, current progress, open questions. The summary replaces the compacted messages. The raw messages are checkpointed to disk for replay/debugging.

**KAIROS daemon** — A background process (separate fork from the main agent loop) that runs while the user is idle. Its job:
1. Read all session transcripts from disk
2. Merge overlapping observations
3. Resolve contradictions (newer fact wins, unless explicitly marked as hypothesis)
4. Convert tentative notes to durable facts
5. Build a "consolidated memory" object that future sessions can load

The fork isolation is critical: KAIROS cannot corrupt the main agent's live context. It writes to a separate memory store that the main agent reads on session start.

**autoDream** — Part of KAIROS. After consolidation, autoDream runs a "synthesis pass" that looks for patterns across sessions: recurring errors, frequently-touched files, established conventions in the codebase. It writes these as structured notes attached to the project context.

---

## Layer 6: Tool System (~29K lines)

**Tool definition structure** (from analysis of the leaked source):

```typescript
interface Tool {
  name: string
  description: string               // shown to LLM in system prompt
  inputSchema: JSONSchema            // validated before execution
  requiredPermissions: Permission[]  // checked against session grants
  outputSchema: JSONSchema           // normalized output format
  timeout: number                    // hard execution limit
  execute(args: unknown, ctx: ExecutionContext): Promise<ToolResult>
  onError(error: Error, args: unknown): ToolError  // error classification
}
```

**The 40+ tools** fall into categories:

| Category | Examples | Key permission |
|----------|---------|----------------|
| File read | `read_file`, `glob`, `grep` | `fs:read` |
| File write | `write_file`, `patch_file` | `fs:write` |
| Shell | `bash`, `python` | `shell:execute` |
| Network | `web_fetch`, `web_search` | `net:fetch` |
| IDE | `show_diff`, `open_file` | `ide:display` |
| Agent | `spawn_subagent`, `ask_user` | `agent:spawn` |

**Undercover Mode** (`undercover.ts`) — A special context flag activated when the agent detects it's operating in a public/open-source repository. In this mode:
- Commit messages are scrubbed of internal codenames (Capybara, Tengu, etc.)
- PR descriptions cannot reference Anthropic-internal systems
- AI authorship attribution is suppressed in git metadata
- The flag is checked before every `git_commit` and `create_pr` tool execution

---

## What's NOT in the Harness

Equally important: what the harness deliberately excludes.

**Model weights** — The harness is completely model-agnostic at the interface level. It calls an API. Swapping the model means changing a config string, not the harness.

**Business logic** — The harness has no opinions about what tasks are valid, valuable, or correct. That's the tool layer's job (input validation) and the user's job (task specification).

**UI opinions** — The IDE Bridge is a thin transport. The harness doesn't care whether it's running in a terminal, an extension, or a headless test environment.

This separation is what makes the harness reusable. It's an execution framework, not an application.

---

## Next Steps

- **[Doc 02: Harness vs Wrapper](02-harness-vs-wrapper.md)** — why this architecture matters
- **[Doc 03: Tool System](03-tool-system.md)** — the permission model in depth
- **[Doc 05: Memory & Context](05-memory-context.md)** — autoCompact and KAIROS in detail
- **[Level 1 examples](../examples/)** — see the architecture in ~300 lines of code
