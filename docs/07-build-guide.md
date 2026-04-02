# Production Build Guide: From Design Decisions to Deployment

> Everything you need to ship a production-grade agent harness. Checklists included.

---

## Phase 0: Design Decisions (Before Writing Code)

These decisions are hard to change later. Get them right upfront.

### Decision 1: What's the permission boundary?

Define the `PermissionSet` your agent will use. Be as restrictive as possible; you can always expand later.

```
[ ] Does the agent need to write files, or only read them?
[ ] Does it need to execute shell commands?
[ ] Does it need to make network requests? To which domains?
[ ] Does it need to spawn subagents?
[ ] Will it operate on repositories it doesn't own?
```

If you answer "yes" to shell execution and network access, your audit logging and sandboxing requirements go up significantly.

### Decision 2: What's the context window strategy?

```
[ ] What's the expected session length (short < 10 turns, long > 50 turns)?
[ ] Is cross-session memory valuable for this use case?
[ ] What's the compaction threshold? (85% is a good default)
[ ] Will you checkpoint raw messages for debugging/replay?
```

Short-lived, stateless agents (classify this, summarize that) don't need KAIROS or autoDream. Long-running agents on complex codebases benefit enormously from them.

### Decision 3: Single agent or multi-agent?

```
[ ] Can the task structure be known in advance, or is it discovered during execution?
[ ] Are subtasks independent enough to benefit from parallel execution?
[ ] What's the maximum agent count you're willing to support operationally?
[ ] Do you need redundancy (multiple agents checking each other)?
```

### Decision 4: What failure modes are acceptable?

```
[ ] Is partial task completion worse than no completion? (ABORT_ON_FIRST vs BEST_EFFORT)
[ ] How should the harness handle API outages? (graceful degradation vs hard fail)
[ ] What's the maximum cost per session you're willing to accept?
[ ] Does the agent need to explain what it did? (audit log requirements)
```

---

## Phase 1: Core Harness Implementation

### Minimum Viable Harness Checklist

```
[ ] Tool base class with permission enforcement (not just checking — enforced)
[ ] Tool registry with typed lookup
[ ] Query Engine with retry for 429/529/500/503
[ ] Agent loop with max_iterations guard
[ ] Execution trace (tool calls, token counts, timing)
[ ] Graceful handling of unexpected stop_reason
```

This is what Level 1 implements. Do not proceed to production without every item checked.

### Harness Hardening Checklist

```
[ ] Input schema validation before tool execution (not inside tools)
[ ] Error classification (RETRYABLE / INPUT_INVALID / PERMISSION_DENIED / FATAL)
[ ] Audit log (JSONL, append-only, includes full args + result summary)
[ ] Token budget enforcement (session limit + per-call limit)
[ ] Shell sandbox (cwd restriction, env allowlist, timeout, output size limit)
[ ] Context compaction with failure counter
[ ] Approval gates for destructive operations
```

This is Level 2 territory. Required before giving the agent write access to production systems.

---

## Phase 2: Observability

Observability is not optional in production. When your agent fails silently, you need to know where it went wrong.

### Structured Logging

Every significant event gets a structured log entry:

```python
import structlog

log = structlog.get_logger()

# In the agent loop
log.info("agent.iteration", session_id=session_id, iteration=n,
         input_tokens=tokens, model=model)

# In tool execution
log.info("tool.execute", tool=name, args_hash=hash(str(args)),
         duration_ms=duration, success=result.success)

# In compaction
log.info("memory.compact", session_id=session_id,
         before_tokens=before, after_tokens=after, messages_removed=n)
```

Use `structlog` (Python) or `pino` (TypeScript) for structured output. Plain `print()` statements are not observability.

### Metrics

Expose these metrics from day one:

```python
METRICS = {
    "agent_sessions_total":      Counter,   # sessions started
    "agent_iterations_total":    Counter,   # total LLM calls
    "tool_calls_total":          Counter,   # by tool name + success/failure
    "token_usage_total":         Counter,   # by model + input/output
    "compaction_total":          Counter,   # by success/failure
    "session_cost_usd":          Histogram, # cost distribution
    "session_duration_seconds":  Histogram, # duration distribution
    "api_retry_total":           Counter,   # by status code
}
```

These metrics tell you: is the harness healthy? is it expensive? where are failures concentrated?

### Tracing

For production, instrument with OpenTelemetry:

```python
from opentelemetry import trace

tracer = trace.get_tracer("agent.harness")

async def run(self, task: str):
    with tracer.start_as_current_span("agent.session") as span:
        span.set_attribute("task.length", len(task))
        span.set_attribute("session.id", self.session_id)
        # ... session logic

        with tracer.start_as_current_span("agent.iteration") as iter_span:
            iter_span.set_attribute("iteration", n)
            # ... iteration logic
```

Distributed traces let you reconstruct exactly what happened in a failed session, including latency at each step.

---

## Phase 3: Security Hardening

### API Key Management

```
[ ] ANTHROPIC_API_KEY loaded from environment, never hardcoded
[ ] Key not logged, not included in traces, not in error messages
[ ] Key rotated on a schedule (or use short-lived tokens if available)
[ ] Key has minimum required permissions (no admin access)
```

### Shell Execution

If your harness has `SHELL_EXEC` permission:

```
[ ] working_directory restricted to project root (no cd above it)
[ ] env allowlist explicitly defined (no secrets leaked to subprocesses)
[ ] timeout enforced (prevents runaway processes)
[ ] output size limited (prevents memory exhaustion)
[ ] commands logged before execution (audit trail)
[ ] known-dangerous patterns blocked at approval gate level:
    [ ] rm -rf /
    [ ] git push --force
    [ ] DROP TABLE / DELETE FROM (without WHERE)
    [ ] curl | sh pattern
    [ ] chmod 777
```

### File System Access

```
[ ] Write operations restricted to project root by default
[ ] Writes outside project root require explicit approval
[ ] No writes to /etc, /usr, ~/.ssh, ~/.aws, ~/.config
[ ] Dotfile writes require explicit approval
```

### Network Access

```
[ ] Domain allowlist for production (don't let the agent fetch arbitrary URLs)
[ ] New domains require user approval in first session, auto-approved thereafter
[ ] Credentials never included in logged request URLs
[ ] Response size limited (prevent exfiltration-by-URL attacks)
```

---

## Phase 4: Testing Strategy

### Unit Tests

Every tool needs unit tests:

```python
# tests/test_tools.py

async def test_read_file_permission_denied():
    tool = ReadFileTool()
    permissions = PermissionSet.read_only()
    permissions.granted.discard(Permission.FS_READ)  # remove the permission

    with pytest.raises(PermissionError, match="Missing permissions: FS_READ"):
        await tool.execute({"path": "README.md"}, permissions)

async def test_write_file_creates_directories():
    tool = WriteFileTool()
    permissions = PermissionSet.standard()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "deep", "nested", "file.txt")
        result = await tool.execute({"path": path, "content": "hello"}, permissions)
        assert result.success
        assert open(path).read() == "hello"
```

### Integration Tests

Test the agent loop with a mock LLM:

```python
class MockQueryEngine:
    def __init__(self, responses: list):
        self._responses = iter(responses)

    async def call(self, messages, tools, system, trace):
        return next(self._responses)

async def test_agent_completes_simple_task():
    engine = MockQueryEngine([
        make_tool_use_response("list_directory", {"path": "."}),
        make_end_turn_response("Found 5 Python files."),
    ])

    harness = AgentHarness(
        tool_registry=build_test_registry(),
        permissions=PermissionSet.read_only(),
        query_engine=engine,
    )

    result, trace = await harness.run("list the Python files here")
    assert "Python files" in result
    assert trace.iterations == 2
    assert len(trace.tool_calls) == 1
```

### Property Tests

Use hypothesis to find edge cases:

```python
from hypothesis import given, strategies as st

@given(st.text(min_size=0, max_size=10000))
async def test_tool_result_never_crashes_harness(arbitrary_output):
    """Whatever a tool returns, the harness should handle it gracefully."""
    # Mock a tool that returns arbitrary text
    # Assert harness doesn't crash, trace is valid
```

### Load Tests

Before production: run 100 concurrent sessions, verify:
- No race conditions in audit log
- Token budget enforced correctly under concurrency
- Retry logic doesn't create thundering herd

---

## Phase 5: Deployment

### Environment Configuration

```python
# config.py — all configuration from environment

@dataclass
class HarnessConfig:
    anthropic_api_key: str      = field(default_factory=lambda: require_env("ANTHROPIC_API_KEY"))
    model: str                  = field(default_factory=lambda: os.getenv("AGENT_MODEL", "claude-opus-4-6"))
    max_tokens_per_call: int    = field(default_factory=lambda: int(os.getenv("MAX_TOKENS", "4096")))
    session_token_budget: int   = field(default_factory=lambda: int(os.getenv("SESSION_BUDGET", "500000")))
    max_iterations: int         = field(default_factory=lambda: int(os.getenv("MAX_ITERATIONS", "50")))
    audit_log_path: str         = field(default_factory=lambda: os.getenv("AUDIT_LOG", "/var/log/agent/audit.jsonl"))
    compaction_threshold: float = field(default_factory=lambda: float(os.getenv("COMPACT_THRESHOLD", "0.85")))
    allowed_permissions: list   = field(default_factory=lambda: parse_permissions(os.getenv("PERMISSIONS", "FS_READ,FS_WRITE")))
```

No hardcoded values in production code. Every tunable parameter is an environment variable.

### Health Check Endpoint

```python
@app.get("/health")
async def health():
    # Check Anthropic API reachability
    try:
        await client.messages.create(model=config.model, max_tokens=1,
                                     messages=[{"role": "user", "content": "ping"}])
        api_ok = True
    except Exception:
        api_ok = False

    return {
        "status": "ok" if api_ok else "degraded",
        "api_reachable": api_ok,
        "audit_log_writable": os.access(config.audit_log_path, os.W_OK),
        "version": VERSION,
    }
```

### Graceful Shutdown

```python
import signal

async def shutdown(signal_num):
    print(f"Received {signal.Signals(signal_num).name}, shutting down...")
    # Stop accepting new sessions
    # Wait for active sessions to complete (with timeout)
    # Flush audit log buffer
    # Stop KAIROS daemon gracefully
    await asyncio.gather(*active_sessions, return_exceptions=True)
    sys.exit(0)

for sig in (signal.SIGTERM, signal.SIGINT):
    asyncio.get_event_loop().add_signal_handler(sig, lambda s=sig: asyncio.create_task(shutdown(s)))
```

---

## Production Readiness Checklist

### Before First User

```
[ ] All Phase 1 (core harness) checklist items complete
[ ] All Phase 2 (observability) items implemented
[ ] All Phase 3 (security) items applicable to your permission scope complete
[ ] Unit tests passing (>80% coverage on harness core)
[ ] Integration tests with mock LLM passing
[ ] Token budget configured and tested
[ ] Audit log writing and readable
[ ] Health check endpoint returning 200
[ ] Graceful shutdown tested
[ ] ANTHROPIC_API_KEY in secrets manager, not in .env
```

### Before Scale

```
[ ] Load test: 100 concurrent sessions, no race conditions, audit log correct
[ ] Monitoring dashboards: session volume, cost, error rate, p99 latency
[ ] Alerting: budget exceeded, error rate spike, API outage
[ ] Runbook: what to do when the agent does something unexpected
[ ] Incident response: how to stop a runaway session
[ ] Cost controls: per-user limits, daily limits, emergency shutoff
```

### Before Enterprise

```
[ ] SOC2 audit log format (tamper-evident, long-term retention)
[ ] Permission model maps to your RBAC system
[ ] KAIROS data retention policy (how long to keep session transcripts)
[ ] Data residency (where are session transcripts stored?)
[ ] Rate limit handling in multi-tenant scenarios
[ ] Per-tenant token budgets and cost attribution
```

---

## What This Costs

A rough cost model for a standard engineering team use case:

```
Light use (10 sessions/day, 20 iterations avg):
  Input:  10 × 20 × 2,000t  = 400,000 tokens/day
  Output: 10 × 20 × 500t    = 100,000 tokens/day
  Cost:   ($15 × 0.4 + $75 × 0.1) / 1M = $13.50/day

Heavy use (50 sessions/day, 40 iterations avg):
  Input:  50 × 40 × 3,000t  = 6,000,000 tokens/day
  Output: 50 × 40 × 800t    = 1,600,000 tokens/day
  Cost:   ($15 × 6 + $75 × 1.6) / 1M = $210/day
```

At heavy use, model routing (using faster/cheaper models for tool-only steps) can reduce cost by 40-60%. This is not premature optimization — it's a production necessity at scale.

---

## Reference Implementation

The Level 3 example in this repo implements every Phase 1 and Phase 2 checklist item, plus the security hardening items for `FS_READ`, `FS_WRITE`, and `SHELL_EXEC`.

See [`examples/python/production_agent/`](../examples/python/production_agent/) and [`examples/typescript/production-agent/`](../examples/typescript/production-agent/).
