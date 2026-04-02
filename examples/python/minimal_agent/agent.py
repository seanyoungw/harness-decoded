"""
harness-decoded: Level 1 — Minimal Agent
~300 lines. The irreducible core of a production harness.

Implements:
  - Typed tool registry with permission gating
  - Query Engine with streaming + retry
  - Single-turn memory (no compaction — see Level 2)
  - Full execution trace

Usage:
    pip install anthropic
    python agent.py "list all TODO comments in this directory"
"""

import asyncio
import json
import sys
import time
from dataclasses import dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Any

import anthropic

# ─────────────────────────────────────────────
# Permission Model
# ─────────────────────────────────────────────

class Permission(Enum):
    FS_READ    = auto()
    FS_WRITE   = auto()
    SHELL_EXEC = auto()
    NET_FETCH  = auto()


@dataclass
class PermissionSet:
    granted: set[Permission] = field(default_factory=set)

    @classmethod
    def read_only(cls) -> "PermissionSet":
        return cls(granted={Permission.FS_READ})

    @classmethod
    def standard(cls) -> "PermissionSet":
        return cls(granted={Permission.FS_READ, Permission.FS_WRITE})

    def check(self, required: list[Permission]) -> None:
        missing = set(required) - self.granted
        if missing:
            names = ", ".join(p.name for p in missing)
            raise PermissionError(f"Missing permissions: {names}")


# ─────────────────────────────────────────────
# Tool System
# ─────────────────────────────────────────────

@dataclass
class ToolResult:
    output: str
    error: str | None = None
    duration_ms: float = 0.0

    @property
    def success(self) -> bool:
        return self.error is None


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    required_permissions: list[Permission]

    async def execute(self, args: dict, permissions: PermissionSet) -> ToolResult:
        permissions.check(self.required_permissions)
        start = time.monotonic()
        try:
            result = await self._run(args)
            return ToolResult(
                output=result,
                duration_ms=(time.monotonic() - start) * 1000
            )
        except PermissionError:
            raise
        except Exception as e:
            return ToolResult(
                output="",
                error=f"{type(e).__name__}: {e}",
                duration_ms=(time.monotonic() - start) * 1000
            )

    async def _run(self, args: dict) -> str:
        raise NotImplementedError


class ReadFileTool(Tool):
    def __init__(self):
        super().__init__(
            name="read_file",
            description="Read the contents of a file. Returns the full text content.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to read"}
                },
                "required": ["path"]
            },
            required_permissions=[Permission.FS_READ]
        )

    async def _run(self, args: dict) -> str:
        path = Path(args["path"])
        if not path.exists():
            raise FileNotFoundError(f"No such file: {path}")
        return path.read_text(encoding="utf-8", errors="replace")


class ListDirectoryTool(Tool):
    def __init__(self):
        super().__init__(
            name="list_directory",
            description="List files and directories at a given path.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory path to list"},
                    "recursive": {"type": "boolean", "default": False}
                },
                "required": ["path"]
            },
            required_permissions=[Permission.FS_READ]
        )

    async def _run(self, args: dict) -> str:
        root = Path(args.get("path", "."))
        recursive = args.get("recursive", False)

        if not root.exists():
            raise FileNotFoundError(f"No such directory: {root}")

        if recursive:
            entries = sorted(str(p.relative_to(root)) for p in root.rglob("*") if not any(
                part.startswith(".") for part in p.parts
            ))
        else:
            entries = sorted(str(p.relative_to(root)) for p in root.iterdir())

        return "\n".join(entries) if entries else "(empty directory)"


class WriteFileTool(Tool):
    def __init__(self):
        super().__init__(
            name="write_file",
            description="Write content to a file. Creates the file if it does not exist.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"]
            },
            required_permissions=[Permission.FS_READ, Permission.FS_WRITE]
        )

    async def _run(self, args: dict) -> str:
        path = Path(args["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"], encoding="utf-8")
        return f"Written {len(args['content'])} bytes to {path}"


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool:
        if name not in self._tools:
            raise KeyError(f"Unknown tool: {name}. Available: {list(self._tools)}")
        return self._tools[name]

    def to_api_format(self) -> list[dict]:
        """Convert registry to Anthropic API tool definitions."""
        return [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema
            }
            for t in self._tools.values()
        ]


# ─────────────────────────────────────────────
# Execution Trace
# ─────────────────────────────────────────────

@dataclass
class ToolCallRecord:
    tool: str
    args: dict
    result: ToolResult
    timestamp: float = field(default_factory=time.time)


@dataclass
class ExecutionTrace:
    task: str
    iterations: int = 0
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    start_time: float = field(default_factory=time.time)

    @property
    def duration_s(self) -> float:
        return time.time() - self.start_time

    @property
    def estimated_cost_usd(self) -> float:
        # claude-opus-4-5 pricing (approximate)
        return (self.total_input_tokens / 1_000_000 * 15.0 +
                self.total_output_tokens / 1_000_000 * 75.0)

    def summary(self) -> str:
        lines = [
            f"\n{'─'*50}",
            f"  Task:       {self.task[:60]}",
            f"  Iterations: {self.iterations}",
            f"  Tool calls: {len(self.tool_calls)}",
            f"  Tokens:     {self.total_input_tokens:,} in / {self.total_output_tokens:,} out",
            f"  Est. cost:  ${self.estimated_cost_usd:.4f}",
            f"  Duration:   {self.duration_s:.1f}s",
            f"{'─'*50}",
        ]
        if self.tool_calls:
            lines.append("  Tool calls:")
            for tc in self.tool_calls:
                status = "✓" if tc.result.success else "✗"
                lines.append(f"    {status} {tc.tool}({json.dumps(tc.args)[:40]}...) "
                              f"[{tc.result.duration_ms:.0f}ms]")
        return "\n".join(lines)


# ─────────────────────────────────────────────
# Query Engine
# ─────────────────────────────────────────────

MAX_RETRIES = 3
RETRYABLE_STATUS = {429, 529, 500, 503}


@dataclass
class QueryEngine:
    client: anthropic.AsyncAnthropic
    model: str = "claude-opus-4-6"
    max_tokens: int = 4096

    async def call(
        self,
        messages: list[dict],
        tools: list[dict],
        system: str,
        trace: ExecutionTrace,
    ) -> anthropic.types.Message:
        """Call the LLM with retry logic. Returns a complete Message."""
        last_error = None

        for attempt in range(MAX_RETRIES):
            try:
                response = await self.client.messages.create(
                    model=self.model,
                    max_tokens=self.max_tokens,
                    system=system,
                    messages=messages,
                    tools=tools,
                )
                trace.total_input_tokens += response.usage.input_tokens
                trace.total_output_tokens += response.usage.output_tokens
                return response

            except anthropic.RateLimitError as e:
                wait = 2 ** attempt
                print(f"  [rate limit] waiting {wait}s (attempt {attempt+1}/{MAX_RETRIES})")
                await asyncio.sleep(wait)
                last_error = e

            except anthropic.APIStatusError as e:
                if e.status_code in RETRYABLE_STATUS:
                    wait = 2 ** attempt
                    print(f"  [api error {e.status_code}] retrying in {wait}s")
                    await asyncio.sleep(wait)
                    last_error = e
                else:
                    raise  # non-retryable

            except anthropic.APIConnectionError as e:
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(1)
                    last_error = e
                else:
                    raise

        raise RuntimeError(f"Query failed after {MAX_RETRIES} attempts") from last_error


# ─────────────────────────────────────────────
# Agent Harness
# ─────────────────────────────────────────────

SYSTEM_PROMPT = """You are a capable AI agent with access to tools.

Your job: complete the task given to you, step by step, using the available tools.

Guidelines:
- Use tools to gather information before drawing conclusions
- Prefer targeted reads over full directory scans when you know what you need
- When you have enough information to complete the task, call the task complete
- Be precise and concise in your final response

You are NOT allowed to:
- Make up file contents you haven't read
- Claim a task is complete if you haven't verified it with tool calls"""


@dataclass
class AgentHarness:
    tool_registry: ToolRegistry
    permissions: PermissionSet
    query_engine: QueryEngine
    max_iterations: int = 25

    async def run(self, task: str) -> tuple[str, ExecutionTrace]:
        trace = ExecutionTrace(task=task)
        messages: list[dict] = [{"role": "user", "content": task}]
        tools = self.tool_registry.to_api_format()

        print(f"\n▶ Task: {task}\n")

        while trace.iterations < self.max_iterations:
            trace.iterations += 1
            print(f"  [iter {trace.iterations}] thinking...")

            response = await self.query_engine.call(
                messages=messages,
                tools=tools,
                system=SYSTEM_PROMPT,
                trace=trace,
            )

            # Append assistant response to conversation
            messages.append({"role": "assistant", "content": response.content})

            # If stop_reason is end_turn, we're done
            if response.stop_reason == "end_turn":
                final = next(
                    (b.text for b in response.content if hasattr(b, "text")),
                    "(no text response)"
                )
                print(f"\n✓ Complete\n")
                return final, trace

            # Process tool calls
            if response.stop_reason == "tool_use":
                tool_results = []

                for block in response.content:
                    if block.type != "tool_use":
                        continue

                    tool_name = block.name
                    tool_args = block.input
                    print(f"  [tool] {tool_name}({json.dumps(tool_args)[:60]})")

                    try:
                        tool = self.tool_registry.get(tool_name)
                        result = await tool.execute(tool_args, self.permissions)
                    except Exception as e:
                        result = ToolResult(output="", error=str(e))

                    trace.tool_calls.append(ToolCallRecord(
                        tool=tool_name, args=tool_args, result=result
                    ))

                    if result.success:
                        content = result.output[:8000]  # prevent runaway context
                    else:
                        content = f"Error: {result.error}"
                        print(f"  [error] {result.error}")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": content,
                    })

                messages.append({"role": "user", "content": tool_results})
                continue

            # Unexpected stop reason
            print(f"  [warn] unexpected stop_reason: {response.stop_reason}")
            break

        return f"[max iterations ({self.max_iterations}) reached]", trace


# ─────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────

def build_default_harness() -> AgentHarness:
    """Build a harness with standard read/write tools."""
    registry = ToolRegistry()
    registry.register(ReadFileTool())
    registry.register(ListDirectoryTool())
    registry.register(WriteFileTool())

    return AgentHarness(
        tool_registry=registry,
        permissions=PermissionSet.standard(),
        query_engine=QueryEngine(
            client=anthropic.AsyncAnthropic()  # reads ANTHROPIC_API_KEY from env
        ),
    )


async def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python agent.py \"your task here\"")
        print("Example: python agent.py \"list all Python files and count lines of code\"")
        sys.exit(1)

    task = " ".join(sys.argv[1:])
    harness = build_default_harness()
    result, trace = await harness.run(task)

    print(f"Result:\n{result}")
    print(trace.summary())


if __name__ == "__main__":
    asyncio.run(main())
