# Tool Permission System: Sandbox, Audit, and Revocation

> How Claude Code ensures that 40+ tools can execute arbitrary system operations without becoming a security liability.

---

## The Core Problem

An AI agent that can read files, write files, execute shell commands, and make network requests has essentially the same capabilities as the user running it — possibly more, since it operates autonomously without a human in the loop for every action.

This is not a hypothetical concern. A confused or manipulated agent could:
- Overwrite source files with broken code
- Exfiltrate sensitive files via network calls
- Execute destructive shell commands
- Commit changes to repositories the user didn't intend to modify

The wrapper pattern has no answer to this. The harness does.

---

## Permission Scopes

Every tool declares the permissions it requires. The harness checks these against the session's `PermissionSet` before any execution begins.

```
Permission Hierarchy
─────────────────────────────────────────────────
FS_READ         read files, list directories, glob
FS_WRITE        write files, create directories, delete
SHELL_EXEC      execute bash commands, run scripts
NET_FETCH       HTTP requests to external URLs
NET_SEARCH      web search APIs
AGENT_SPAWN     create subagents with their own permissions
IDE_DISPLAY     send diffs and UI events to the IDE
GIT_READ        read git history, diff, log
GIT_WRITE       commit, push, create branches/PRs
```

Permissions are additive and explicit. A tool requiring `FS_WRITE` cannot execute if the session only grants `FS_READ` — even if the user is running as root.

### Default Permission Sets

```python
PermissionSet.read_only()   # FS_READ only — safe for analysis tasks
PermissionSet.standard()    # FS_READ + FS_WRITE — most coding tasks
PermissionSet.full()        # all permissions — explicit opt-in required
```

The harness defaults to `standard()`. `SHELL_EXEC` and `NET_FETCH` require explicit opt-in at session creation. This is not just a UX guardrail — it's an architectural guarantee that analysis-only tasks cannot accidentally trigger shell execution.

---

## The Permission Check Path

```
tool_registry.execute(tool_name, args, context)
    │
    ├─ 1. Tool lookup — does this tool exist?
    │     KeyError if not → hard fail, not recoverable
    │
    ├─ 2. Input schema validation
    │     args validated against tool.input_schema (JSON Schema)
    │     ValidationError → tool_result with error, agent decides to retry or abort
    │
    ├─ 3. Permission check
    │     tool.required_permissions ⊆ context.session.permissions.granted?
    │     PermissionError → surfaced to agent, optionally surfaces approval request to user
    │
    ├─ 4. Approval gate (for sensitive operations)
    │     some tools + some contexts → pause loop, request user approval
    │     user denies → PermissionError with explanation
    │     user approves → execution proceeds with approval logged
    │
    ├─ 5. Sandbox execution
    │     tool._run(validated_args) in sandboxed context
    │     timeout enforced
    │     resource limits applied (memory, CPU for SHELL_EXEC)
    │
    └─ 6. Audit log entry
          timestamp, tool, args, result, duration, session_id
          written before returning result to agent
```

No step can be skipped. This is the value of the single `execute()` choke point described in [ADR-001](adr/001-tools-as-data.md).

---

## Approval Gates

Some tool calls are automatically flagged for human approval before execution. The threshold is configurable, but the defaults from Claude Code's architecture are instructive:

**Always requires approval:**
- `write_file` targeting files outside the project root
- `bash` with commands matching destructive patterns (`rm -rf`, `DROP TABLE`, `git push --force`)
- `git_push` to remote branches
- `net_fetch` to domains not previously accessed in the session
- `spawn_subagent` with permissions exceeding the parent's grants

**Approval prompt includes:**
- The exact tool call (name + full arguments)
- Why approval is being requested
- What the harness will do if denied
- A diff preview for file write operations

**Approval is persisted for the session.** If the user approves `net_fetch` to `api.github.com`, subsequent calls to that domain in the same session are auto-approved. This prevents approval fatigue while maintaining the audit trail.

```python
@dataclass
class ApprovalRecord:
    tool: str
    args: dict
    granted: bool
    user_note: str | None
    timestamp: float
    session_id: str
```

---

## Audit Trail

Every tool execution — successful or not — generates an audit record before the result is returned to the agent. The record is append-only and written to disk.

```python
@dataclass
class AuditEntry:
    session_id: str
    iteration: int
    tool: str
    args: dict                  # full, not truncated
    result_summary: str         # first 500 chars of output
    error: str | None
    duration_ms: float
    permission_set: list[str]   # snapshot of permissions at execution time
    approval: ApprovalRecord | None
    timestamp: float

    def to_line(self) -> str:
        """JSONL format for streaming writes."""
        return json.dumps(asdict(self))
```

The audit log enables:
- **Replay**: reconstruct exactly what the agent did and in what order
- **Debugging**: find where the agent diverged from intent
- **Compliance**: demonstrate what operations were performed and with what authorization
- **Cost analysis**: per-tool timing breakdown for optimization

---

## Sandboxing Shell Execution

`SHELL_EXEC` is the highest-risk permission. The harness does not execute shell commands with `subprocess.run(shell=True)` — that's the wrapper approach.

The harness-level controls:

```python
@dataclass
class SandboxConfig:
    working_directory: Path       # commands cannot cd above this
    timeout_seconds: float = 30   # hard wall clock limit
    max_output_bytes: int = 1_000_000  # prevent output flooding
    env_allowlist: list[str] = field(default_factory=lambda: [
        "PATH", "HOME", "USER", "LANG", "TERM"
    ])  # no secrets leaked from environment

async def execute_shell(command: str, config: SandboxConfig) -> ShellResult:
    env = {k: os.environ[k] for k in config.env_allowlist if k in os.environ}

    proc = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=config.working_directory,
        env=env,
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=config.timeout_seconds
        )
    except asyncio.TimeoutError:
        proc.kill()
        raise ToolTimeoutError(command, config.timeout_seconds)

    output = (stdout + stderr)[:config.max_output_bytes]
    return ShellResult(
        exit_code=proc.returncode,
        output=output.decode("utf-8", errors="replace"),
        truncated=len(stdout + stderr) > config.max_output_bytes
    )
```

The environment allowlist is particularly important: it prevents the agent from accidentally leaking `ANTHROPIC_API_KEY`, `AWS_SECRET_ACCESS_KEY`, or any other secrets present in the shell environment to commands it executes.

---

## Error Classification

Not all tool errors are equal. The harness classifies errors so the agent loop can make informed recovery decisions:

```python
class ToolErrorKind(Enum):
    RETRYABLE        = auto()  # transient — try again
    INPUT_INVALID    = auto()  # args were wrong — model should reformulate
    PERMISSION_DENIED = auto() # missing permission — escalate or abandon
    RESOURCE_MISSING = auto()  # file not found, etc — check path
    TIMEOUT          = auto()  # took too long — try simpler approach
    FATAL            = auto()  # unrecoverable — abort task
    NEEDS_HUMAN      = auto()  # approval required before retry
```

The error classification is returned to the agent as part of the tool result, allowing the agent to reason about recovery rather than seeing a generic error string.

---

## Undercover Mode

When the agent detects it's operating in a public or open-source repository, `undercover.ts` activates a special execution context that modifies the behavior of git-related tools:

**What it blocks:**
- Internal codenames in commit messages (`Capybara`, `Tengu`, `KAIROS`, `autoDream`)
- References to Anthropic-internal systems or URLs
- AI authorship attribution in git metadata (`Co-authored-by: Claude`)
- Internal feature flag names or API version strings

**How it detects public repos:**
1. Checks for `LICENSE` file with open-source license text
2. Checks git remote URL against known public hosting patterns
3. Checks for `CONTRIBUTING.md` with public contribution instructions
4. Falls back to explicit `--public-repo` flag

This is not primarily a privacy feature — it's an enterprise feature. Many large companies prohibit AI-assisted contributions to their open-source projects, or require that AI contributions be explicitly attributed. Undercover Mode lets Anthropic's own engineers use Claude Code on public repos without violating those policies.

---

## Implementation in the Examples

The Level 1 minimal agent implements the permission check path without approval gates (those are a Level 2 feature). See `examples/python/minimal_agent/agent.py` — the `PermissionSet.check()` call in `Tool.execute()` is the enforcement point.

Level 2 adds:
- Approval gate middleware
- Full audit log (JSONL file)
- Error classification on all tool results
- Sandbox config for shell execution

See [examples/python/standard_agent/](../examples/python/standard_agent/) for the full implementation.

---

## Next

- [Doc 04: Query Engine Internals](04-query-engine.md) — how the LLM call layer works
- [ADR-002: Streaming vs Synchronous Tool Execution](adr/002-streaming-tools.md)
