"""
harness-decoded: Level 2 — Standard Agent
~800 lines. Adds Memory System and Parallel Fan-Out to the Level 1 core.

New in Level 2:
  - autoCompact: LLM-powered context compaction at 85% capacity
  - Full audit log (JSONL, append-only)
  - Error classification on tool results
  - Approval gate for destructive operations
  - Parallel fan-out multi-agent orchestration
  - Shell tool with sandbox (cwd restriction, env allowlist, timeout)

Usage:
    pip install anthropic
    python agent.py "refactor the auth module and update the tests"
    python agent.py --parallel "analyze all Python files in this project"
"""

import asyncio
import hashlib
import json
import os
import random
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Any, Callable

import anthropic

# ─────────────────────────────────────────────
# Permission Model (same as Level 1, extended)
# ─────────────────────────────────────────────

class Permission(Enum):
    FS_READ     = "FS_READ"
    FS_WRITE    = "FS_WRITE"
    SHELL_EXEC  = "SHELL_EXEC"
    NET_FETCH   = "NET_FETCH"
    AGENT_SPAWN = "AGENT_SPAWN"


@dataclass
class PermissionSet:
    granted: set[Permission] = field(default_factory=set)

    @classmethod
    def read_only(cls):
        return cls(granted={Permission.FS_READ})

    @classmethod
    def standard(cls):
        return cls(granted={Permission.FS_READ, Permission.FS_WRITE})

    @classmethod
    def with_shell(cls):
        return cls(granted={Permission.FS_READ, Permission.FS_WRITE, Permission.SHELL_EXEC})

    def check(self, required: list[Permission]) -> None:
        missing = set(required) - self.granted
        if missing:
            raise PermissionError(f"Missing permissions: {', '.join(p.name for p in missing)}")

    def subset(self, allowed: set[Permission]) -> "PermissionSet":
        return PermissionSet(granted=self.granted & allowed)


# ─────────────────────────────────────────────
# Error Classification
# ─────────────────────────────────────────────

class ToolErrorKind(Enum):
    RETRYABLE         = auto()
    INPUT_INVALID     = auto()
    PERMISSION_DENIED = auto()
    RESOURCE_MISSING  = auto()
    TIMEOUT           = auto()
    FATAL             = auto()
    NEEDS_HUMAN       = auto()


@dataclass
class ToolResult:
    output: str
    error: str | None = None
    error_kind: ToolErrorKind | None = None
    duration_ms: float = 0.0
    requires_approval: bool = False

    @property
    def success(self) -> bool:
        return self.error is None


# ─────────────────────────────────────────────
# Audit Log
# ─────────────────────────────────────────────

@dataclass
class AuditEntry:
    session_id: str
    iteration: int
    tool: str
    args: dict
    result_summary: str
    error: str | None
    error_kind: str | None
    duration_ms: float
    approved: bool | None
    timestamp: float = field(default_factory=time.time)

    def to_jsonl(self) -> str:
        return json.dumps(asdict(self))


class AuditLog:
    def __init__(self, path: Path):
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, entry: AuditEntry) -> None:
        with open(self._path, "a") as f:
            f.write(entry.to_jsonl() + "\n")


# ─────────────────────────────────────────────
# Tool System (extended from Level 1)
# ─────────────────────────────────────────────

# Patterns that trigger approval gates
DESTRUCTIVE_PATTERNS = [
    "rm -rf", "rm -r /", "git push --force", "DROP TABLE",
    "DELETE FROM", "> /dev/", "format ", "mkfs", ":(){:|:&};:"
]


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    required_permissions: list[Permission]
    requires_approval: bool = False

    async def execute(
        self,
        args: dict,
        permissions: PermissionSet,
        audit: AuditLog | None = None,
        session_id: str = "",
        iteration: int = 0,
    ) -> ToolResult:
        try:
            permissions.check(self.required_permissions)
        except PermissionError as e:
            return ToolResult(output="", error=str(e), error_kind=ToolErrorKind.PERMISSION_DENIED)

        start = time.monotonic()
        try:
            output = await self._run(args)
            result = ToolResult(output=output, duration_ms=(time.monotonic() - start) * 1000)
        except FileNotFoundError as e:
            result = ToolResult(output="", error=str(e), error_kind=ToolErrorKind.RESOURCE_MISSING,
                                duration_ms=(time.monotonic() - start) * 1000)
        except PermissionError as e:
            result = ToolResult(output="", error=str(e), error_kind=ToolErrorKind.PERMISSION_DENIED,
                                duration_ms=(time.monotonic() - start) * 1000)
        except asyncio.TimeoutError:
            result = ToolResult(output="", error="Tool execution timed out",
                                error_kind=ToolErrorKind.TIMEOUT,
                                duration_ms=(time.monotonic() - start) * 1000)
        except Exception as e:
            kind = ToolErrorKind.RETRYABLE if "connection" in str(e).lower() else ToolErrorKind.FATAL
            result = ToolResult(output="", error=f"{type(e).__name__}: {e}",
                                error_kind=kind,
                                duration_ms=(time.monotonic() - start) * 1000)

        if audit:
            audit.write(AuditEntry(
                session_id=session_id,
                iteration=iteration,
                tool=self.name,
                args=args,
                result_summary=result.output[:500],
                error=result.error,
                error_kind=result.error_kind.name if result.error_kind else None,
                duration_ms=result.duration_ms,
                approved=None,
            ))

        return result

    async def _run(self, args: dict) -> str:
        raise NotImplementedError


class ReadFileTool(Tool):
    def __init__(self):
        super().__init__(
            name="read_file",
            description="Read the contents of a file.",
            input_schema={"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
            required_permissions=[Permission.FS_READ],
        )

    async def _run(self, args: dict) -> str:
        return Path(args["path"]).read_text(encoding="utf-8", errors="replace")


class ListDirectoryTool(Tool):
    def __init__(self):
        super().__init__(
            name="list_directory",
            description="List files in a directory.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "recursive": {"type": "boolean", "default": False},
                    "pattern": {"type": "string", "description": "glob pattern filter, e.g. '*.py'"},
                },
                "required": ["path"],
            },
            required_permissions=[Permission.FS_READ],
        )

    async def _run(self, args: dict) -> str:
        root = Path(args["path"])
        pattern = args.get("pattern", "*")
        recursive = args.get("recursive", False)
        method = root.rglob if recursive else root.glob
        entries = sorted(
            str(p.relative_to(root)) for p in method(pattern)
            if not any(part.startswith(".") for part in p.parts)
        )
        return "\n".join(entries) or "(empty)"


class WriteFileTool(Tool):
    def __init__(self):
        super().__init__(
            name="write_file",
            description="Write content to a file.",
            input_schema={
                "type": "object",
                "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                "required": ["path", "content"],
            },
            required_permissions=[Permission.FS_READ, Permission.FS_WRITE],
        )

    async def _run(self, args: dict) -> str:
        path = Path(args["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"], encoding="utf-8")
        return f"Written {len(args['content'])} bytes to {path}"


class BashTool(Tool):
    def __init__(self, working_directory: Path = Path(".")):
        super().__init__(
            name="bash",
            description="Execute a bash command. Runs with restricted environment.",
            input_schema={
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "timeout": {"type": "number", "default": 30},
                },
                "required": ["command"],
            },
            required_permissions=[Permission.SHELL_EXEC],
            requires_approval=False,  # set True in production for new commands
        )
        self._cwd = working_directory
        self._env_allowlist = ["PATH", "HOME", "USER", "LANG", "TERM", "PYTHONPATH"]

    def _is_destructive(self, command: str) -> bool:
        return any(p in command.lower() for p in DESTRUCTIVE_PATTERNS)

    async def _run(self, args: dict) -> str:
        command = args["command"]
        timeout = float(args.get("timeout", 30))

        if self._is_destructive(command):
            return f"[BLOCKED] Command matches destructive pattern. Requires explicit approval: {command[:80]}"

        env = {k: os.environ[k] for k in self._env_allowlist if k in os.environ}

        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=self._cwd,
            env=env,
        )

        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise asyncio.TimeoutError(f"Command timed out after {timeout}s: {command[:60]}")

        output = stdout[:500_000].decode("utf-8", errors="replace")
        exit_code = proc.returncode
        if exit_code != 0:
            return f"[exit {exit_code}]\n{output}"
        return output


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool:
        if name not in self._tools:
            raise KeyError(f"Unknown tool: {name}")
        return self._tools[name]

    def to_api_format(self) -> list[dict]:
        return [{"name": t.name, "description": t.description, "input_schema": t.input_schema}
                for t in self._tools.values()]


# ─────────────────────────────────────────────
# Memory System (autoCompact)
# ─────────────────────────────────────────────

COMPACTION_SYSTEM = """You are a context compaction assistant.
You will receive a sequence of messages from an AI agent session.
Extract and return a JSON object with exactly these keys:
{
  "task_specification": "the original task and all constraints (verbatim if possible)",
  "completed_work": ["list of concrete things accomplished so far"],
  "current_state": "where in the task we are right now",
  "open_questions": ["unresolved decisions or blockers"],
  "key_facts": ["file contents, findings, or observations needed to continue"]
}
Be thorough in key_facts — the agent will not have access to the original messages after compaction.
Return only valid JSON, no other text."""


class MemorySystem:
    MAX_CONSECUTIVE_FAILURES = 3
    COMPACTION_THRESHOLD = 0.85
    TOKENS_PER_MESSAGE_ESTIMATE = 300  # rough estimate for threshold check

    def __init__(self, client: anthropic.AsyncAnthropic, model: str, checkpoint_dir: Path | None = None):
        self._client = client
        self._model = model
        self._checkpoint_dir = checkpoint_dir
        self._consecutive_failures = 0
        self._session_id = str(uuid.uuid4())[:8]

    def _estimate_tokens(self, messages: list[dict]) -> int:
        total_chars = sum(
            len(json.dumps(m)) for m in messages
        )
        return total_chars // 4  # rough chars-to-tokens ratio

    def _is_over_threshold(self, messages: list[dict], context_limit: int = 180_000) -> bool:
        estimated = self._estimate_tokens(messages)
        return estimated > context_limit * self.COMPACTION_THRESHOLD

    async def maybe_compact(self, messages: list[dict]) -> list[dict]:
        if not self._is_over_threshold(messages):
            self._consecutive_failures = 0
            return messages

        if self._consecutive_failures >= self.MAX_CONSECUTIVE_FAILURES:
            print(f"  [memory] compaction failed {self.MAX_CONSECUTIVE_FAILURES} times — giving up")
            raise RuntimeError("autoCompact gave up after too many failures. Start a new session.")

        print(f"  [memory] context threshold reached, compacting...")
        self._checkpoint(messages)

        try:
            summary = await self._compact(messages)
            self._consecutive_failures = 0
            print(f"  [memory] compacted {len(messages)} messages → 1 summary")
            return [
                {"role": "user", "content": f"<compaction_summary>\n{json.dumps(summary, indent=2)}\n</compaction_summary>"},
                {"role": "assistant", "content": "Context compacted. Continuing with task."},
            ]
        except Exception as e:
            self._consecutive_failures += 1
            print(f"  [memory] compaction failed (attempt {self._consecutive_failures}): {e}")
            return messages  # return original, continue without compaction

    async def _compact(self, messages: list[dict]) -> dict:
        # Only send the messages being compacted, not system prompt
        response = await self._client.messages.create(
            model=self._model,
            max_tokens=4096,
            system=COMPACTION_SYSTEM,
            messages=messages[-40:],  # last 40 messages for compaction input
        )
        text = response.content[0].text
        # Strip any markdown fences
        text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(text)

    def _checkpoint(self, messages: list[dict]) -> None:
        if not self._checkpoint_dir:
            return
        self._checkpoint_dir.mkdir(parents=True, exist_ok=True)
        path = self._checkpoint_dir / f"checkpoint_{self._session_id}_{int(time.time())}.jsonl"
        with open(path, "w") as f:
            for msg in messages:
                f.write(json.dumps(msg) + "\n")


# ─────────────────────────────────────────────
# Query Engine (with full retry + token tracking)
# ─────────────────────────────────────────────

@dataclass
class ExecutionTrace:
    task: str
    session_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    iterations: int = 0
    tool_calls: list[dict] = field(default_factory=list)
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    start_time: float = field(default_factory=time.time)

    @property
    def duration_s(self) -> float:
        return time.time() - self.start_time

    @property
    def estimated_cost_usd(self) -> float:
        return (self.total_input_tokens / 1_000_000 * 15.0 +
                self.total_output_tokens / 1_000_000 * 75.0)

    def summary(self) -> str:
        lines = [
            f"\n{'─'*55}",
            f"  Session:    {self.session_id}",
            f"  Task:       {self.task[:60]}",
            f"  Iterations: {self.iterations}",
            f"  Tool calls: {len(self.tool_calls)}",
            f"  Tokens:     {self.total_input_tokens:,} in / {self.total_output_tokens:,} out",
            f"  Est. cost:  ${self.estimated_cost_usd:.4f}",
            f"  Duration:   {self.duration_s:.1f}s",
            f"{'─'*55}",
        ]
        for tc in self.tool_calls:
            s = "✓" if tc["success"] else "✗"
            lines.append(f"    {s} {tc['tool']}  [{tc['duration_ms']:.0f}ms]"
                         + (f"  [{tc['error_kind']}]" if tc.get("error_kind") else ""))
        return "\n".join(lines)


RETRY_CONFIG = {
    429: (5, 1.0, 60.0, True),   # (max_attempts, base_delay, max_delay, jitter)
    529: (3, 2.0, 30.0, True),
    500: (3, 1.0, 10.0, False),
    503: (3, 1.0, 10.0, False),
}


class QueryEngine:
    def __init__(self, client: anthropic.AsyncAnthropic, model: str = "claude-opus-4-6", max_tokens: int = 4096):
        self._client = client
        self.model = model
        self._max_tokens = max_tokens

    async def call(self, messages, tools, system, trace: ExecutionTrace) -> anthropic.types.Message:
        last_error = None
        for attempt in range(5):
            try:
                response = await self._client.messages.create(
                    model=self.model,
                    max_tokens=self._max_tokens,
                    system=system,
                    messages=messages,
                    tools=tools,
                )
                trace.total_input_tokens += response.usage.input_tokens
                trace.total_output_tokens += response.usage.output_tokens
                return response
            except anthropic.APIStatusError as e:
                cfg = RETRY_CONFIG.get(e.status_code)
                if cfg and attempt < cfg[0] - 1:
                    max_a, base, max_d, jitter = cfg
                    delay = min(base * (2 ** attempt), max_d)
                    if jitter:
                        delay *= (0.5 + random.random() * 0.5)
                    print(f"  [api {e.status_code}] retry in {delay:.1f}s")
                    await asyncio.sleep(delay)
                    last_error = e
                else:
                    raise
            except anthropic.APIConnectionError as e:
                if attempt < 2:
                    await asyncio.sleep(1.0)
                    last_error = e
                else:
                    raise
        raise RuntimeError(f"Query failed after retries") from last_error


# ─────────────────────────────────────────────
# Agent Harness (Level 2)
# ─────────────────────────────────────────────

SYSTEM_PROMPT = """You are a capable AI agent with file system and shell access.

Complete the given task using available tools. Guidelines:
- Read before writing — understand the current state first
- Use targeted reads when you know what file you need
- For shell commands, prefer non-destructive operations
- When complete, give a clear summary of what was done

Error handling:
- RETRYABLE errors: try the same tool call again
- INPUT_INVALID: reformulate your tool call arguments
- RESOURCE_MISSING: check the path/name and retry
- PERMISSION_DENIED: the operation is not allowed — find another approach or explain
- FATAL: stop and explain the error to the user"""


class AgentHarness:
    def __init__(
        self,
        tool_registry: ToolRegistry,
        permissions: PermissionSet,
        query_engine: QueryEngine,
        memory: MemorySystem,
        audit: AuditLog | None = None,
        max_iterations: int = 50,
    ):
        self._tools = tool_registry
        self._permissions = permissions
        self._qe = query_engine
        self._memory = memory
        self._audit = audit
        self._max_iter = max_iterations

    async def run(self, task: str) -> tuple[str, ExecutionTrace]:
        trace = ExecutionTrace(task=task)
        messages: list[dict] = [{"role": "user", "content": task}]
        api_tools = self._tools.to_api_format()

        print(f"\n▶ [{trace.session_id}] {task[:80]}\n")

        while trace.iterations < self._max_iter:
            trace.iterations += 1

            # Memory compaction check
            try:
                messages = await self._memory.maybe_compact(messages)
            except RuntimeError as e:
                return str(e), trace

            print(f"  [iter {trace.iterations}]", end=" ", flush=True)
            response = await self._qe.call(messages, api_tools, SYSTEM_PROMPT, trace)
            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "end_turn":
                final = next((b.text for b in response.content if hasattr(b, "text")), "(no output)")
                print("done")
                return final, trace

            if response.stop_reason == "tool_use":
                tool_results = []
                tool_names = [b.name for b in response.content if hasattr(b, "name") and b.type == "tool_use"]
                print(f"tools: {', '.join(tool_names)}")

                for block in response.content:
                    if block.type != "tool_use":
                        continue

                    tool_obj = None
                    try:
                        tool_obj = self._tools.get(block.name)
                        result = await tool_obj.execute(
                            block.input,
                            self._permissions,
                            audit=self._audit,
                            session_id=trace.session_id,
                            iteration=trace.iterations,
                        )
                    except KeyError as e:
                        result = ToolResult(output="", error=str(e), error_kind=ToolErrorKind.FATAL)

                    trace.tool_calls.append({
                        "tool": block.name,
                        "success": result.success,
                        "duration_ms": result.duration_ms,
                        "error_kind": result.error_kind.name if result.error_kind else None,
                    })

                    if result.success:
                        content = result.output[:10_000]
                    else:
                        ek = result.error_kind.name if result.error_kind else "UNKNOWN"
                        content = f"[{ek}] {result.error}"

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": content,
                    })

                messages.append({"role": "user", "content": tool_results})
                continue

            print(f"[unexpected stop: {response.stop_reason}]")
            break

        return f"[max iterations ({self._max_iter}) reached]", trace


# ─────────────────────────────────────────────
# Multi-Agent: Parallel Fan-Out
# ─────────────────────────────────────────────

@dataclass
class SubTask:
    prompt: str
    description: str = ""
    permissions: PermissionSet | None = None


@dataclass
class FanOutResult:
    subtask: SubTask
    result: str
    trace: ExecutionTrace
    error: str | None = None


async def parallel_fan_out(
    subtasks: list[SubTask],
    harness_factory: Callable[[], AgentHarness],
    max_concurrency: int = 4,
) -> list[FanOutResult]:
    semaphore = asyncio.Semaphore(max_concurrency)

    async def run_one(subtask: SubTask) -> FanOutResult:
        async with semaphore:
            harness = harness_factory()
            try:
                result, trace = await harness.run(subtask.prompt)
                return FanOutResult(subtask=subtask, result=result, trace=trace)
            except Exception as e:
                dummy_trace = ExecutionTrace(task=subtask.prompt)
                return FanOutResult(subtask=subtask, result="", trace=dummy_trace, error=str(e))

    results = await asyncio.gather(*[run_one(t) for t in subtasks])
    return list(results)


async def synthesize_results(
    harness: AgentHarness,
    original_task: str,
    results: list[FanOutResult],
) -> str:
    successful = [r for r in results if not r.error]
    failed = [r for r in results if r.error]

    parts = [f"Original task: {original_task}\n"]
    parts.append(f"Completed {len(successful)}/{len(results)} subtasks.\n")

    for i, r in enumerate(successful, 1):
        parts.append(f"Subtask {i} ({r.subtask.description or r.subtask.prompt[:40]}):\n{r.result}\n")

    if failed:
        parts.append(f"\nFailed subtasks ({len(failed)}):")
        for r in failed:
            parts.append(f"  - {r.subtask.description}: {r.error}")

    parts.append("\nPlease synthesize the above into a coherent final response.")

    synthesis, _ = await harness.run("\n".join(parts))
    return synthesis


# ─────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────

def build_harness(audit_path: Path | None = None, checkpoint_dir: Path | None = None) -> AgentHarness:
    client = anthropic.AsyncAnthropic()
    model = "claude-opus-4-6"

    registry = ToolRegistry()
    registry.register(ReadFileTool())
    registry.register(ListDirectoryTool())
    registry.register(WriteFileTool())
    registry.register(BashTool(working_directory=Path(".")))

    audit = AuditLog(audit_path or Path(".harness/audit.jsonl"))

    return AgentHarness(
        tool_registry=registry,
        permissions=PermissionSet.with_shell(),
        query_engine=QueryEngine(client, model),
        memory=MemorySystem(client, model, checkpoint_dir=checkpoint_dir or Path(".harness/checkpoints")),
        audit=audit,
        max_iterations=50,
    )


async def main() -> None:
    args = sys.argv[1:]
    parallel_mode = "--parallel" in args
    args = [a for a in args if a != "--parallel"]

    if not args:
        print('Usage: python agent.py [--parallel] "your task"')
        print('  --parallel: decompose task into subtasks and run concurrently')
        sys.exit(1)

    task = " ".join(args)

    if parallel_mode:
        # Demo: decompose a directory analysis task into per-directory subtasks
        print(f"[parallel mode] Decomposing task: {task}")
        dirs = [p for p in Path(".").iterdir() if p.is_dir() and not p.name.startswith(".")]
        if not dirs:
            print("No subdirectories found. Running single agent.")
            parallel_mode = False
        else:
            subtasks = [
                SubTask(
                    prompt=f"{task} — focus specifically on the '{d.name}' directory",
                    description=f"directory: {d.name}",
                )
                for d in sorted(dirs)[:6]  # cap at 6 parallel agents
            ]
            print(f"  Spawning {len(subtasks)} parallel agents...\n")
            results = await parallel_fan_out(subtasks, build_harness)

            total_cost = sum(r.trace.estimated_cost_usd for r in results)
            total_tokens = sum(r.trace.total_input_tokens + r.trace.total_output_tokens for r in results)
            print(f"\n[fan-out complete] {len(subtasks)} agents, "
                  f"{total_tokens:,} tokens total, ${total_cost:.4f}")

            synthesis_harness = build_harness()
            final = await synthesize_results(synthesis_harness, task, results)
            print(f"\nSynthesized result:\n{final}")
            return

    if not parallel_mode:
        harness = build_harness()
        result, trace = await harness.run(task)
        print(f"\nResult:\n{result}")
        print(trace.summary())


if __name__ == "__main__":
    asyncio.run(main())
