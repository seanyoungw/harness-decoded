# Harness vs Wrapper: The Architectural Divide That Separates Production AI from Prototypes

> This is the most important document in this repository. Everything else follows from the distinction made here.

---

## The Wrapper Trap

Most AI agent tutorials look like this:

```python
def run_agent(user_input: str) -> str:
    response = client.messages.create(
        model="claude-opus-4-5",
        messages=[{"role": "user", "content": user_input}]
    )
    return response.content[0].text
```

This is a wrapper. It works. It demos beautifully. Then it hits production and falls apart.

The failure modes are predictable:
- Context grows until it hits the token limit — agent crashes mid-task
- A tool call fails — no retry, no recovery, task abandoned
- Two subtasks could run in parallel — they don't, sequential execution bottlenecks everything
- The agent succeeds at the task — but there's no audit trail of what it did or why
- You want to add a new capability — you're editing prompt strings, not extending an interface

These aren't bugs. They're the structural consequences of the wrapper pattern. No amount of prompt engineering fixes them.

---

## What a Harness Actually Is

A harness is an execution framework that treats the LLM as a **capable but constrained component** within a larger system — not as the system itself.

The distinction is architectural, not cosmetic:

| Concern | Wrapper approach | Harness approach |
|---------|-----------------|-----------------|
| Tool execution | LLM generates text, you parse it | Typed tool registry with schema validation |
| Error handling | Prompt: "if something goes wrong..." | Retry policies, circuit breakers, fallbacks |
| Memory | Append to message array until limit | Compaction algorithms, semantic summarization |
| Concurrency | Sequential by default | Structured concurrency, task fan-out |
| Permissions | None / honor system | Explicit permission scopes, audit logs |
| Observability | Print statements | Structured spans, cost tracking, replay |

The leaked Claude Code source makes this concrete: the LLM call itself is a small portion of the 512,000-line codebase. The rest is harness.

---

## The Five Failure Modes Wrappers Cannot Solve

### 1. Context Window Exhaustion

A wrapper accumulates messages until the model refuses:

```
Error: prompt is too long: 203847 tokens > 200000 token maximum
```

The naive fix is truncation — drop old messages. This destroys coherence. The model loses the original task specification.

A harness solves this with **compaction**: semantic summarization that preserves task-relevant information while reducing token count. The Claude Code source revealed `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` — with a comment noting that before this three-line fix, 1,279 sessions per day were burning ~250,000 API calls failing to compact. The harness has a compaction *subsystem* with failure modes, retry limits, and degradation strategies.

```python
# Wrapper: truncate (loses context)
if token_count > limit:
    messages = messages[-20:]  # pray

# Harness: compact (preserves intent)
if token_count > compaction_threshold:
    messages = await memory_system.compact(
        messages,
        preserve=["task_spec", "constraints", "progress"],
        strategy=CompactionStrategy.SEMANTIC_SUMMARY
    )
```

### 2. Tool Execution Is Not Text Generation

Wrappers treat tools as a text formatting exercise: tell the model the tools exist, parse its output, call the function. This conflates the LLM's *decision* (which tool, with what args) with the *execution* (actually running it safely).

The Claude Code tool system is ~29,000 lines. Not because bash execution is hard, but because **safe, auditable, permission-gated bash execution in an agentic context** is hard:

- Input validation before execution (not after)
- Permission scoping per tool per session
- Execution sandboxing with resource limits
- Output normalization regardless of exit conditions
- Audit trail with full input/output/timing
- Cancellation and timeout handling
- Error classification (retryable vs fatal vs requires-human)

```python
# Wrapper: parse and call
if "bash" in response:
    command = extract_command(response)
    result = subprocess.run(command, shell=True)  # 😬

# Harness: typed, validated, sandboxed
result = await tool_registry.execute(
    tool=BashTool,
    args=validated_args,
    permission_context=session.permissions,
    sandbox=session.sandbox,
    timeout=tool.default_timeout,
    audit_logger=session.audit_log
)
```

### 3. Sequential Execution Is a Throughput Tax

Wrappers are inherently sequential: generate → parse → execute → observe → generate. When a task has independent subtasks, they all wait in line.

```
Wrapper: [read file A] → [read file B] → [read file C] → analyze all three
Time: 3 × file_read_latency + analysis_latency

Harness: [read file A] ─┐
         [read file B] ─┼─ (concurrent) → analyze all three
         [read file C] ─┘
Time: max(file_read_latency) + analysis_latency
```

For tasks spanning many files or network calls, this is the difference between a 30-second operation and a 10-second one.

The harness requires structured concurrency: spawning subtasks, collecting results, handling partial failures, merging contexts. This is not trivial to retrofit onto a wrapper. It's a fundamental architectural property.

### 4. No Permissions Means No Trust Boundary

A wrapper runs whatever the model decides to run, with whatever permissions the host process has. This is fine for a demo. It's unacceptable for an agent operating on a real codebase, touching real files, making real network calls.

Claude Code's permission system revealed in the leak:
- Per-tool permission scopes (read-only, read-write, network-access, etc.)
- Session-level permission grants with revocation
- Tool calls blocked until explicit user approval for sensitive operations
- Full audit log with cryptographic hashing for tamper detection

```python
# Wrapper: no concept of permissions
result = run_tool(tool_name, args)

# Harness: explicit permission check before execution
async def execute_tool(tool: Tool, args: ToolArgs, ctx: ExecutionContext):
    required = tool.required_permissions
    granted = ctx.session.permissions

    if not required.issubset(granted):
        missing = required - granted
        approval = await ctx.request_approval(tool, args, missing)
        if not approval.granted:
            raise PermissionDeniedError(tool, missing)

    return await tool.execute(args, ctx.sandbox)
```

### 5. Observability Is Not Optional

When your agent silently fails — and it will — a wrapper gives you no information. You have the final output (or lack of one) and nothing else.

A harness instruments everything:

```
span: agent_session{session_id=abc123, task="refactor payment module"}
  span: tool_call{tool=read_file, path=src/payment.py, duration=12ms, tokens=847}
  span: llm_call{model=claude-opus-4-5, input_tokens=2341, output_tokens=612, duration=2.1s}
  span: tool_call{tool=bash, command="python -m pytest tests/", duration=4.2s, exit=0}
  span: tool_call{tool=write_file, path=src/payment.py, bytes=3421, duration=8ms}
  span: llm_call{model=claude-opus-4-5, input_tokens=1892, output_tokens=234, duration=1.8s}
total: duration=8.3s, input_tokens=4233, output_tokens=846, cost=$0.034
```

When something goes wrong, you can replay the exact sequence of decisions and tool calls. You can see exactly where the model went off track, what it saw, and what it did.

---

## When to Use Each

Not every AI integration needs a harness. Choosing the wrong one for your context wastes either simplicity or capability.

**Use a wrapper when:**
- Single-turn, stateless interactions (classify this, summarize that)
- The "agent" makes no external tool calls
- Failure is cheap and easily recovered
- You're exploring or prototyping
- Team has no systems engineering capacity to maintain a harness

**Use a harness when:**
- Multi-turn tasks with persistent state
- Tool calls with real-world side effects (file writes, API calls, shell execution)
- Tasks long enough to hit context limits
- Failure is expensive (lost work, corrupted state, security exposure)
- You need to explain what the agent did and why (audit, compliance, debugging)
- Multiple subtasks that benefit from concurrency
- Multiple agents that need to coordinate

The threshold is roughly: **if your agent can cause side effects that matter, it needs a harness**.

---

## The Harness Pattern: Core Interface

Here's the minimal interface that characterizes a harness. Both Level 1 examples in this repo implement this contract:

```python
@dataclass
class HarnessConfig:
    tool_registry: ToolRegistry
    memory: MemorySystem
    permissions: PermissionSet
    max_iterations: int = 50
    compaction_threshold: float = 0.85  # % of context window

class AgentHarness:
    async def run(self, task: str, context: ExecutionContext) -> AgentResult:
        """Execute a task. Returns result + full execution trace."""

    async def step(self, state: AgentState) -> AgentState:
        """Single iteration: observe → decide → act → update."""

    def register_tool(self, tool: Tool) -> None:
        """Extend capability without modifying core logic."""
```

The key property: `register_tool` extends the harness without modifying it. New capabilities slot in. The core loop — observe, decide, act, update — never changes. This is the harness as extension point, not just execution wrapper.

---

## What the Leak Confirmed

Before the source map leak, the Claude Code architecture was partially reverse-engineered from the binary. The leak confirmed several things that were speculated:

**The Query Engine is the largest module at ~46K lines.** This is the harness's brain: managing LLM API calls, response streaming, token accounting, retry logic, and response caching. It is not "call the API and return the result" — it's a full request orchestration system.

**The Tool System at ~29K lines is the harness's hands.** Each tool is a typed, validated, sandboxed unit with its own permission requirements, error handling, and audit surface. Adding a new tool means implementing an interface, not editing prompt strings.

**The Memory System (KAIROS / autoDream) runs in a forked subprocess.** Memory consolidation happens in a separate process specifically to prevent it from corrupting the main agent's context. The `autoDream` process merges observations, removes contradictions, and converts tentative learnings to facts — then checkpoints the result back to the main context. This is systems programming applied to AI memory.

These are not prompt engineering decisions. They are software engineering decisions. They require the same skills — and the same investment — as building any production distributed system.

That's what a harness is.

---

## Next Steps

- Read [Doc 03: Tool Permission System](03-tool-system.md) to understand the permission model in detail
- See [Level 1 examples](../examples/) for the minimal harness implementation in Python and TypeScript
- Read [ADR-001](adr/001-tools-as-data.md) for the rationale behind the tool-as-data design
