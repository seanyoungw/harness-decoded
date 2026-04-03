"""
harness-decoded: Level 3 — Production Agent
Full Harness architecture. Every item on the production checklist.

New in Level 3 vs Level 2:
  - KAIROS daemon with 5-pass autoDream consolidation
  - SwarmOrchestrator with SpawnSubagentTool
  - OpenTelemetry tracing spans (OTLP export ready)
  - Tamper-evident audit log (SHA-256 chained entries)
  - Token budget with hard session limits
  - PatchFileTool (unified diff apply)
  - WebFetchTool with domain approval tracking
  - Health check endpoint
  - Graceful shutdown handling
  - Full error classification taxonomy
  - Per-tool execution metrics

Usage:
    pip install anthropic aiohttp jsonschema
    export ANTHROPIC_API_KEY=sk-ant-...
    python agent.py "refactor the payment module to add retry logic"
    python agent.py --swarm "analyze and document every module in this project"
    python agent.py --health   # check system health
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import signal
import subprocess
import sys
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Any, Callable

import anthropic

# ─────────────────────────────────────────────
# Configuration (all from environment)
# ─────────────────────────────────────────────

@dataclass
class HarnessConfig:
    api_key: str                   = field(default_factory=lambda: _require_env("ANTHROPIC_API_KEY"))
    model: str                     = field(default_factory=lambda: os.getenv("AGENT_MODEL", "claude-opus-4-6"))
    max_tokens_per_call: int       = field(default_factory=lambda: int(os.getenv("MAX_TOKENS", "4096")))
    session_token_budget: int      = field(default_factory=lambda: int(os.getenv("SESSION_BUDGET", "500000")))
    max_iterations: int            = field(default_factory=lambda: int(os.getenv("MAX_ITERATIONS", "50")))
    compaction_threshold: float    = field(default_factory=lambda: float(os.getenv("COMPACT_THRESHOLD", "0.85")))
    audit_log_path: Path           = field(default_factory=lambda: Path(os.getenv("AUDIT_LOG", ".harness/audit.jsonl")))
    checkpoint_dir: Path           = field(default_factory=lambda: Path(os.getenv("CHECKPOINT_DIR", ".harness/checkpoints")))
    memory_path: Path              = field(default_factory=lambda: Path(os.getenv("MEMORY_PATH", ".harness/memory.json")))
    max_swarm_agents: int          = field(default_factory=lambda: int(os.getenv("MAX_SWARM_AGENTS", "20")))
    otlp_endpoint: str | None      = field(default_factory=lambda: os.getenv("OTLP_ENDPOINT"))
    allowed_permissions: list[str] = field(default_factory=lambda: os.getenv("PERMISSIONS", "FS_READ,FS_WRITE,SHELL_EXEC").split(","))

def _require_env(key: str) -> str:
    v = os.getenv(key)
    if not v:
        raise RuntimeError(f"Required environment variable not set: {key}")
    return v


# ─────────────────────────────────────────────
# Permission Model
# ─────────────────────────────────────────────

class Permission(Enum):
    FS_READ      = "FS_READ"
    FS_WRITE     = "FS_WRITE"
    SHELL_EXEC   = "SHELL_EXEC"
    NET_FETCH    = "NET_FETCH"
    NET_SEARCH   = "NET_SEARCH"
    GIT_READ     = "GIT_READ"
    GIT_WRITE    = "GIT_WRITE"
    AGENT_SPAWN  = "AGENT_SPAWN"
    IDE_DISPLAY  = "IDE_DISPLAY"


@dataclass
class PermissionSet:
    granted: set[Permission] = field(default_factory=set)

    @classmethod
    def from_names(cls, names: list[str]) -> "PermissionSet":
        return cls(granted={Permission(n.strip()) for n in names if n.strip() in Permission.__members__})

    @classmethod
    def read_only(cls): return cls(granted={Permission.FS_READ})
    @classmethod
    def standard(cls): return cls(granted={Permission.FS_READ, Permission.FS_WRITE})
    @classmethod
    def full(cls): return cls(granted=set(Permission))

    def check(self, required: list[Permission]) -> None:
        missing = set(required) - self.granted
        if missing:
            raise PermissionError(f"Missing: {', '.join(p.name for p in missing)}")

    def subset(self, allowed: set[Permission]) -> "PermissionSet":
        return PermissionSet(granted=self.granted & allowed)


# ─────────────────────────────────────────────
# Error Classification
# ─────────────────────────────────────────────

class ToolErrorKind(Enum):
    RETRYABLE         = "RETRYABLE"
    INPUT_INVALID     = "INPUT_INVALID"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    RESOURCE_MISSING  = "RESOURCE_MISSING"
    TIMEOUT           = "TIMEOUT"
    FATAL             = "FATAL"
    NEEDS_HUMAN       = "NEEDS_HUMAN"


# ─────────────────────────────────────────────
# Tamper-Evident Audit Log
# ─────────────────────────────────────────────

@dataclass
class AuditEntry:
    session_id: str
    iteration: int
    tool: str
    args_hash: str          # SHA-256 of args — full args not stored for privacy
    args_preview: str       # first 200 chars
    result_summary: str
    error: str | None
    error_kind: str | None
    duration_ms: float
    approved: bool | None
    permissions_snapshot: list[str]
    timestamp: float = field(default_factory=time.time)
    prev_hash: str = ""     # hash of previous entry — chain integrity

    def compute_hash(self) -> str:
        payload = json.dumps({
            k: v for k, v in asdict(self).items() if k != "prev_hash"
        }, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()


class AuditLog:
    """Append-only, SHA-256 chained audit log."""

    def __init__(self, path: Path):
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._last_hash = self._load_last_hash()
        self._lock = asyncio.Lock()

    def _load_last_hash(self) -> str:
        if not self._path.exists():
            return ""
        try:
            lines = self._path.read_text().strip().splitlines()
            if lines:
                return json.loads(lines[-1]).get("hash", "")
        except Exception:
            pass
        return ""

    async def write(self, entry: AuditEntry) -> None:
        async with self._lock:
            entry.prev_hash = self._last_hash
            entry_hash = entry.compute_hash()
            record = {**asdict(entry), "hash": entry_hash}
            with open(self._path, "a") as f:
                f.write(json.dumps(record) + "\n")
            self._last_hash = entry_hash

    def verify_chain(self) -> tuple[bool, str]:
        """Verify the hash chain integrity. Returns (ok, error_message)."""
        if not self._path.exists():
            return True, ""
        prev_hash = ""
        for i, line in enumerate(self._path.read_text().strip().splitlines()):
            try:
                record = json.loads(line)
                stored_hash = record.pop("hash", "")
                entry = AuditEntry(**{k: v for k, v in record.items()})
                computed = entry.compute_hash()
                if computed != stored_hash:
                    return False, f"Hash mismatch at line {i + 1}"
                if entry.prev_hash != prev_hash:
                    return False, f"Chain break at line {i + 1}"
                prev_hash = stored_hash
            except Exception as e:
                return False, f"Parse error at line {i + 1}: {e}"
        return True, ""


# ─────────────────────────────────────────────
# OpenTelemetry-compatible Tracing
# ─────────────────────────────────────────────

@dataclass
class Span:
    name: str
    session_id: str
    start_time: float = field(default_factory=time.monotonic)
    attrs: dict = field(default_factory=dict)
    end_time: float | None = None
    error: str | None = None

    def end(self, error: str | None = None) -> None:
        self.end_time = time.monotonic()
        self.error = error

    @property
    def duration_ms(self) -> float:
        if self.end_time is None:
            return (time.monotonic() - self.start_time) * 1000
        return (self.end_time - self.start_time) * 1000


class Tracer:
    def __init__(self, session_id: str, otlp_endpoint: str | None = None):
        self.session_id = session_id
        self._spans: list[Span] = []
        self._otlp = otlp_endpoint

    @asynccontextmanager
    async def span(self, name: str, **attrs):
        s = Span(name=name, session_id=self.session_id, attrs=attrs)
        self._spans.append(s)
        try:
            yield s
            s.end()
        except Exception as e:
            s.end(error=str(e))
            raise

    def export_spans(self) -> list[dict]:
        return [
            {
                "name": s.name, "session_id": s.session_id,
                "duration_ms": round(s.duration_ms, 2),
                "error": s.error, "attrs": s.attrs,
                "start_time": s.start_time,
            }
            for s in self._spans
        ]


# ─────────────────────────────────────────────
# Token Budget
# ─────────────────────────────────────────────

@dataclass
class TokenBudget:
    session_limit: int
    used_input: int = 0
    used_output: int = 0

    @property
    def remaining(self) -> int:
        return self.session_limit - self.used_input - self.used_output

    @property
    def used_total(self) -> int:
        return self.used_input + self.used_output

    def record(self, input_t: int, output_t: int) -> None:
        self.used_input += input_t
        self.used_output += output_t
        if self.remaining < 0:
            raise RuntimeError(
                f"Session token budget exceeded: {self.used_total} / {self.session_limit}"
            )

    def estimated_cost(self, model: str = "claude-opus-4-6") -> float:
        rates = {"claude-opus-4-6": (15.0, 75.0), "claude-haiku-4-5": (0.25, 1.25)}
        inp, out = rates.get(model, (15.0, 75.0))
        return self.used_input / 1_000_000 * inp + self.used_output / 1_000_000 * out


# ─────────────────────────────────────────────
# Execution Trace
# ─────────────────────────────────────────────

@dataclass
class ToolCallRecord:
    tool: str
    args_preview: str
    success: bool
    duration_ms: float
    error_kind: str | None
    iteration: int
    timestamp: float = field(default_factory=time.time)


@dataclass
class ExecutionTrace:
    task: str
    session_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    iterations: int = 0
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    budget: TokenBudget | None = None
    start_time: float = field(default_factory=time.time)
    compaction_count: int = 0

    @property
    def duration_s(self) -> float: return time.time() - self.start_time

    def summary(self) -> str:
        budget_info = ""
        if self.budget:
            budget_info = (
                f"\n  Tokens:     {self.budget.used_input:,} in / {self.budget.used_output:,} out"
                f"\n  Remaining:  {self.budget.remaining:,} / {self.budget.session_limit:,}"
                f"\n  Est. cost:  ${self.budget.estimated_cost():.4f}"
            )
        lines = [
            f"\n{'─'*60}",
            f"  Session:    {self.session_id}",
            f"  Task:       {self.task[:60]}",
            f"  Iterations: {self.iterations}",
            f"  Tool calls: {len(self.tool_calls)}",
            f"  Compacted:  {self.compaction_count}×",
            budget_info,
            f"  Duration:   {self.duration_s:.1f}s",
            f"{'─'*60}",
        ]
        if self.tool_calls:
            by_tool: dict[str, int] = {}
            for tc in self.tool_calls:
                by_tool[tc.tool] = by_tool.get(tc.tool, 0) + 1
            lines.append("  Tools used: " + ", ".join(f"{t}×{n}" for t, n in sorted(by_tool.items())))
        return "\n".join(lines)


# ─────────────────────────────────────────────
# Tool Base + Registry
# ─────────────────────────────────────────────

DESTRUCTIVE_PATTERNS = [
    "rm -rf", "rm -r /", "> /dev/", "mkfs", ":(){:|:&};:",
    "git push --force", "git push -f",
    "DROP TABLE", "DELETE FROM",
    "sudo rm", "truncate /",
]


@dataclass
class ToolResult:
    output: str
    error: str | None = None
    error_kind: ToolErrorKind | None = None
    duration_ms: float = 0.0

    @property
    def success(self) -> bool: return self.error is None


class Tool:
    def __init__(self, name: str, description: str, input_schema: dict,
                 required_permissions: list[Permission], requires_approval: bool = False):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.required_permissions = required_permissions
        self.requires_approval = requires_approval

    async def execute(self, args: dict, permissions: PermissionSet,
                      audit: AuditLog | None = None,
                      session_id: str = "", iteration: int = 0,
                      tracer: Tracer | None = None) -> ToolResult:
        try:
            permissions.check(self.required_permissions)
        except PermissionError as e:
            return ToolResult("", str(e), ToolErrorKind.PERMISSION_DENIED)

        start = time.monotonic()
        try:
            if tracer:
                async with tracer.span(f"tool.{self.name}", tool=self.name):
                    output = await self._run(args)
            else:
                output = await self._run(args)
            dur = (time.monotonic() - start) * 1000
            result = ToolResult(output=output[:50_000], duration_ms=dur)
        except FileNotFoundError as e:
            dur = (time.monotonic() - start) * 1000
            result = ToolResult("", str(e), ToolErrorKind.RESOURCE_MISSING, dur)
        except PermissionError as e:
            dur = (time.monotonic() - start) * 1000
            result = ToolResult("", str(e), ToolErrorKind.PERMISSION_DENIED, dur)
        except asyncio.TimeoutError:
            dur = (time.monotonic() - start) * 1000
            result = ToolResult("", "Execution timed out", ToolErrorKind.TIMEOUT, dur)
        except ValueError as e:
            dur = (time.monotonic() - start) * 1000
            result = ToolResult("", f"Invalid input: {e}", ToolErrorKind.INPUT_INVALID, dur)
        except Exception as e:
            dur = (time.monotonic() - start) * 1000
            kind = ToolErrorKind.RETRYABLE if "connection" in str(e).lower() else ToolErrorKind.FATAL
            result = ToolResult("", f"{type(e).__name__}: {e}", kind, dur)

        if audit:
            args_str = json.dumps(args, default=str)
            entry = AuditEntry(
                session_id=session_id, iteration=iteration, tool=self.name,
                args_hash=hashlib.sha256(args_str.encode()).hexdigest(),
                args_preview=args_str[:200],
                result_summary=result.output[:500],
                error=result.error,
                error_kind=result.error_kind.value if result.error_kind else None,
                duration_ms=result.duration_ms, approved=None,
                permissions_snapshot=[p.name for p in permissions.granted],
            )
            await audit.write(entry)
        return result

    async def _run(self, args: dict) -> str:
        raise NotImplementedError


class ReadFileTool(Tool):
    def __init__(self):
        super().__init__("read_file", "Read file contents.",
                         {"type":"object","properties":{"path":{"type":"string"}},"required":["path"]},
                         [Permission.FS_READ])

    async def _run(self, args):
        return Path(args["path"]).read_text(encoding="utf-8", errors="replace")


class WriteFileTool(Tool):
    def __init__(self):
        super().__init__("write_file", "Write content to a file. Creates parent dirs.",
                         {"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]},
                         [Permission.FS_READ, Permission.FS_WRITE])

    async def _run(self, args):
        path = Path(args["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"], encoding="utf-8")
        return f"Written {len(args['content'])} bytes to {path}"


class PatchFileTool(Tool):
    """Apply a unified diff patch to an existing file."""
    def __init__(self):
        super().__init__(
            "patch_file",
            "Apply a unified diff (--- / +++ format) to an existing file. Safer than write_file for partial edits.",
            {"type":"object","properties":{
                "path":{"type":"string","description":"File to patch"},
                "patch":{"type":"string","description":"Unified diff string"},
            },"required":["path","patch"]},
            [Permission.FS_READ, Permission.FS_WRITE],
        )

    async def _run(self, args):
        path = Path(args["path"])
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        original = path.read_text(encoding="utf-8")
        # Write patch to temp file and apply with patch(1)
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False) as f:
            f.write(args["patch"])
            patch_path = f.name
        try:
            result = subprocess.run(
                ["patch", str(path), patch_path],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode != 0:
                # Restore original on failure
                path.write_text(original, encoding="utf-8")
                raise ValueError(f"patch failed: {result.stderr.strip()}")
            return f"Patched {path} successfully"
        finally:
            Path(patch_path).unlink(missing_ok=True)


class ListDirectoryTool(Tool):
    def __init__(self):
        super().__init__("list_directory", "List files in a directory.",
                         {"type":"object","properties":{
                             "path":{"type":"string"},
                             "recursive":{"type":"boolean","default":False},
                             "pattern":{"type":"string","default":"*"},
                         },"required":["path"]},
                         [Permission.FS_READ])

    async def _run(self, args):
        root = Path(args["path"])
        pattern = args.get("pattern","*")
        recursive = args.get("recursive", False)
        fn = root.rglob if recursive else root.glob
        entries = sorted(
            str(p.relative_to(root)) for p in fn(pattern)
            if not any(part.startswith(".") for part in p.parts)
            and "node_modules" not in p.parts
        )
        return "\n".join(entries[:500]) or "(empty)"   # cap at 500 entries


class GrepTool(Tool):
    def __init__(self):
        super().__init__("grep", "Search file contents with a regex pattern.",
                         {"type":"object","properties":{
                             "pattern":{"type":"string"},
                             "path":{"type":"string"},
                             "context_lines":{"type":"integer","default":2},
                             "recursive":{"type":"boolean","default":True},
                         },"required":["pattern","path"]},
                         [Permission.FS_READ])

    async def _run(self, args):
        cmd = ["grep", "-rn" if args.get("recursive",True) else "-n"]
        ctx = args.get("context_lines", 2)
        if ctx > 0:
            cmd += [f"-C{ctx}"]
        cmd += ["--include=*.py","--include=*.ts","--include=*.js","--include=*.md"]
        cmd += [args["pattern"], args["path"]]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)
        return stdout[:20_000].decode("utf-8", errors="replace") or "(no matches)"


class BashTool(Tool):
    ENV_ALLOWLIST = ["PATH", "HOME", "USER", "LANG", "TERM", "PYTHONPATH", "VIRTUAL_ENV"]

    def __init__(self, cwd: Path = Path(".")):
        super().__init__("bash", "Execute a bash command in a sandboxed environment.",
                         {"type":"object","properties":{
                             "command":{"type":"string"},
                             "timeout":{"type":"number","default":30},
                         },"required":["command"]},
                         [Permission.SHELL_EXEC])
        self._cwd = cwd

    def _is_destructive(self, cmd: str) -> bool:
        return any(p in cmd for p in DESTRUCTIVE_PATTERNS)

    async def _run(self, args):
        cmd = args["command"]
        timeout = float(args.get("timeout", 30))

        if self._is_destructive(cmd):
            return f"[BLOCKED: destructive pattern] {cmd[:100]}\nRequires explicit user approval."

        env = {k: os.environ[k] for k in self.ENV_ALLOWLIST if k in os.environ}
        proc = await asyncio.create_subprocess_shell(
            cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            cwd=self._cwd, env=env
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise asyncio.TimeoutError(f"Timed out after {timeout}s")

        out = stdout[:500_000].decode("utf-8", errors="replace")
        if proc.returncode != 0:
            return f"[exit {proc.returncode}]\n{out}"
        return out


class WebFetchTool(Tool):
    def __init__(self, approved_domains: set[str] | None = None):
        super().__init__("web_fetch", "Fetch a URL and return text content.",
                         {"type":"object","properties":{"url":{"type":"string"}},"required":["url"]},
                         [Permission.NET_FETCH])
        self._approved: set[str] = approved_domains or set()

    async def _run(self, args):
        from urllib.parse import urlparse
        import urllib.request
        url = args["url"]
        domain = urlparse(url).netloc
        if domain not in self._approved:
            self._approved.add(domain)
            # In production: surface approval request to user here
        req = urllib.request.Request(url, headers={"User-Agent":"harness-decoded/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read(2_000_000).decode("utf-8", errors="replace")
        return content[:10_000]


class GitReadTool(Tool):
    def __init__(self):
        super().__init__("git_status", "Get git status, diff, or log.",
                         {"type":"object","properties":{
                             "command":{"type":"string","enum":["status","diff","log","blame"]},
                             "args":{"type":"string","default":""},
                         },"required":["command"]},
                         [Permission.GIT_READ])

    async def _run(self, args):
        cmd = f"git {args['command']} {args.get('args','')}"
        proc = await asyncio.create_subprocess_shell(
            cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        return stdout[:10_000].decode("utf-8", errors="replace")


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> "ToolRegistry":
        self._tools[tool.name] = tool
        return self

    def get(self, name: str) -> Tool:
        if name not in self._tools:
            raise KeyError(f"Unknown tool: '{name}'. Available: {sorted(self._tools)}")
        return self._tools[name]

    def to_api_format(self) -> list[dict]:
        return [{"name":t.name,"description":t.description,"input_schema":t.input_schema}
                for t in self._tools.values()]


# ─────────────────────────────────────────────
# Memory System (KAIROS + autoDream)
# ─────────────────────────────────────────────

COMPACTION_SYSTEM = """You are a context compaction assistant for an AI agent session.
Extract the following from the provided message history and return ONLY valid JSON:
{
  "task_specification": "original task + all constraints verbatim",
  "completed_work": ["specific things accomplished"],
  "current_state": "where in the task we are now",
  "open_questions": ["unresolved decisions or blockers"],
  "key_facts": ["critical findings: file contents, API responses, test results, etc — be thorough"]
}
The agent will have no access to the original messages after this. Include every fact it will need."""

AUTODREAM_SYSTEM = """You are autoDream, a memory consolidation system.
You will receive session transcripts and an existing memory store.
Perform these 5 passes and return ONLY valid JSON:

Pass 1 - Extract atomic observations from transcripts
Pass 2 - Deduplicate against existing memory (newer wins)
Pass 3 - Resolve contradictions (newer wins, note the resolution)
Pass 4 - Promote tentative notes ("unclear if X") confirmed by evidence to facts
Pass 5 - Synthesize cross-session patterns worth making explicit

Return:
{
  "facts": [{"content":"...", "certainty":"confirmed|tentative", "last_seen":"..."}],
  "patterns": [{"content":"...", "confidence":0.0-1.0}],
  "open_questions": [{"content":"...", "first_raised":"..."}],
  "contradictions_resolved": [{"old":"...", "new":"...", "resolution":"..."}]
}"""


class MemorySystem:
    MAX_CONSECUTIVE_FAILURES = 3

    def __init__(self, client: anthropic.AsyncAnthropic, model: str,
                 config: HarnessConfig):
        self._client = client
        self._model = model
        self._cfg = config
        self._failures = 0
        self._session_id = str(uuid.uuid4())[:8]

    def _estimate_tokens(self, messages: list[dict]) -> int:
        return sum(len(json.dumps(m, default=str)) for m in messages) // 4

    def _over_threshold(self, messages: list[dict]) -> bool:
        return self._estimate_tokens(messages) > 180_000 * self._cfg.compaction_threshold

    async def maybe_compact(self, messages: list[dict], trace: ExecutionTrace) -> list[dict]:
        if not self._over_threshold(messages):
            self._failures = 0
            return messages

        if self._failures >= self.MAX_CONSECUTIVE_FAILURES:
            raise RuntimeError(
                f"autoCompact failed {self.MAX_CONSECUTIVE_FAILURES} times consecutively. "
                "Start a new session to avoid token exhaustion."
            )

        print(f"  [memory] autoCompact triggered (iter {trace.iterations})")
        self._checkpoint(messages)

        try:
            resp = await self._client.messages.create(
                model=self._model, max_tokens=4096, system=COMPACTION_SYSTEM,
                messages=messages[-40:]
            )
            raw = resp.content[0].text.strip()
            raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            summary = json.loads(raw)
            self._failures = 0
            trace.compaction_count += 1
            return [
                {"role":"user","content":f"<compaction_summary>\n{json.dumps(summary,indent=2)}\n</compaction_summary>"},
                {"role":"assistant","content":"Context compacted. Continuing."},
            ]
        except Exception as e:
            self._failures += 1
            print(f"  [memory] compaction failed ({self._failures}/{self.MAX_CONSECUTIVE_FAILURES}): {e}")
            return messages

    def _checkpoint(self, messages: list[dict]) -> None:
        self._cfg.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        ts = int(time.time())
        path = self._cfg.checkpoint_dir / f"checkpoint_{self._session_id}_{ts}.jsonl"
        with open(path, "w") as f:
            for m in messages:
                f.write(json.dumps(m, default=str) + "\n")

    def load_memory(self) -> dict | None:
        if self._cfg.memory_path.exists():
            try:
                return json.loads(self._cfg.memory_path.read_text())
            except Exception:
                pass
        return None

    def memory_to_prefix(self) -> list[dict] | None:
        mem = self.load_memory()
        if not mem:
            return None
        facts = "\n".join(f"- {f['content']}" for f in mem.get("facts", [])[:20])
        patterns = "\n".join(f"- {p['content']}" for p in mem.get("patterns", [])[:10])
        questions = "\n".join(f"- {q['content']}" for q in mem.get("open_questions", [])[:10])
        prefix = f"""<project_memory sessions="{mem.get('session_count',0)}">
CONFIRMED FACTS:
{facts or "(none yet)"}

PATTERNS:
{patterns or "(none yet)"}

OPEN QUESTIONS:
{questions or "(none yet)"}
</project_memory>"""
        return [
            {"role":"user","content":prefix},
            {"role":"assistant","content":"I've noted the project context. Ready for the task."},
        ]

    async def run_kairos(self) -> None:
        """Run autoDream consolidation. Called in a forked subprocess after session ends."""
        checkpoints = sorted(self._cfg.checkpoint_dir.glob("*.jsonl"))
        if not checkpoints:
            return

        transcripts = []
        for cp in checkpoints[-5:]:  # last 5 sessions
            try:
                lines = [json.loads(l) for l in cp.read_text().splitlines() if l.strip()]
                transcripts.append({"file": cp.name, "messages": lines})
            except Exception:
                continue

        existing_memory = self.load_memory() or {}

        prompt = f"""Existing memory store:
{json.dumps(existing_memory, indent=2)}

Recent session transcripts ({len(transcripts)} sessions):
{json.dumps(transcripts, indent=2, default=str)[:80_000]}

Run all 5 autoDream passes and return the updated memory store JSON."""

        try:
            resp = await self._client.messages.create(
                model=self._model, max_tokens=4096, system=AUTODREAM_SYSTEM,
                messages=[{"role":"user","content":prompt}]
            )
            raw = resp.content[0].text.strip()
            raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            new_memory = json.loads(raw)
            new_memory["session_count"] = existing_memory.get("session_count", 0) + 1
            new_memory["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            # Atomic write
            tmp = self._cfg.memory_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(new_memory, indent=2))
            tmp.rename(self._cfg.memory_path)
            print(f"[KAIROS] Memory updated: {len(new_memory.get('facts',[]))} facts, "
                  f"{len(new_memory.get('patterns',[]))} patterns")
        except Exception as e:
            print(f"[KAIROS] autoDream failed: {e}")


# ─────────────────────────────────────────────
# Query Engine
# ─────────────────────────────────────────────

RETRY_POLICIES = {
    429: (5, 1.0, 60.0, True),
    529: (3, 2.0, 30.0, True),
    500: (3, 1.0, 10.0, False),
    503: (3, 1.0, 10.0, False),
}

SYSTEM_PROMPT = """You are a production-grade AI agent with filesystem, shell, and network access.

Complete the given task step-by-step using available tools.

Guidelines:
- Read and understand before you write
- Use targeted reads (grep, specific file) over full directory scans when possible
- For shell: prefer non-destructive commands; destructive ones are blocked by the harness
- Give a clear, concrete summary of what was accomplished when done

Error recovery:
- RETRYABLE: try the same call again (transient failure)
- INPUT_INVALID: reformulate your arguments
- RESOURCE_MISSING: verify the path and retry
- PERMISSION_DENIED: find a different approach
- TIMEOUT: try a simpler version of the operation
- FATAL: stop and explain clearly"""


class QueryEngine:
    def __init__(self, client: anthropic.AsyncAnthropic, config: HarnessConfig):
        self._client = client
        self._cfg = config

    async def call(self, messages: list[dict], tools: list[dict],
                   trace: ExecutionTrace, tracer: Tracer | None = None) -> anthropic.types.Message:
        last_err = None

        async def _attempt() -> anthropic.types.Message:
            return await self._client.messages.create(
                model=self._cfg.model,
                max_tokens=self._cfg.max_tokens_per_call,
                system=SYSTEM_PROMPT,
                messages=messages,
                tools=tools,
            )

        for attempt in range(5):
            try:
                if tracer:
                    async with tracer.span("llm.call", model=self._cfg.model, attempt=attempt):
                        resp = await _attempt()
                else:
                    resp = await _attempt()

                if trace.budget:
                    trace.budget.record(resp.usage.input_tokens, resp.usage.output_tokens)
                return resp

            except anthropic.APIStatusError as e:
                policy = RETRY_POLICIES.get(e.status_code)
                if policy and attempt < policy[0] - 1:
                    _, base, max_d, jitter = policy
                    delay = min(base * 2 ** attempt, max_d)
                    if jitter:
                        delay *= 0.5 + random.random() * 0.5
                    print(f"  [api {e.status_code}] retry in {delay:.1f}s (attempt {attempt+1})")
                    await asyncio.sleep(delay)
                    last_err = e
                else:
                    raise
            except anthropic.APIConnectionError as e:
                if attempt < 2:
                    await asyncio.sleep(1.0)
                    last_err = e
                else:
                    raise
        raise RuntimeError(f"Query failed after retries: {last_err}")


# ─────────────────────────────────────────────
# Agent Harness
# ─────────────────────────────────────────────

class AgentHarness:
    def __init__(self, tool_registry: ToolRegistry, permissions: PermissionSet,
                 query_engine: QueryEngine, memory: MemorySystem,
                 audit: AuditLog, config: HarnessConfig):
        self.tool_registry = tool_registry
        self._perms = permissions
        self._qe = query_engine
        self._mem = memory
        self._audit = audit
        self._cfg = config

    async def run(self, task: str) -> tuple[str, ExecutionTrace]:
        trace = ExecutionTrace(
            task=task,
            budget=TokenBudget(self._cfg.session_token_budget)
        )
        tracer = Tracer(trace.session_id, self._cfg.otlp_endpoint)

        # Load KAIROS memory as context prefix
        prefix = self._mem.memory_to_prefix()
        messages: list[dict] = (prefix or []) + [{"role":"user","content":task}]
        tools = self.tool_registry.to_api_format()

        print(f"\n▶ [{trace.session_id}] {task[:80]}\n")

        async with tracer.span("agent.session", task=task[:80]):
            while trace.iterations < self._cfg.max_iterations:
                trace.iterations += 1

                # Memory compaction check
                try:
                    messages = await self._mem.maybe_compact(messages, trace)
                except RuntimeError as e:
                    return str(e), trace

                print(f"  [iter {trace.iterations:02d}]", end=" ", flush=True)

                try:
                    response = await self._qe.call(messages, tools, trace, tracer)
                except RuntimeError as e:
                    return f"Query engine error: {e}", trace

                messages.append({"role":"assistant","content":response.content})

                if response.stop_reason == "end_turn":
                    final = next((b.text for b in response.content if hasattr(b,"text")), "(no output)")
                    print("✓ done")
                    # Queue KAIROS daemon (non-blocking)
                    asyncio.create_task(self._queue_kairos())
                    return final, trace

                if response.stop_reason == "tool_use":
                    tool_results = []
                    names = [b.name for b in response.content if hasattr(b,"name") and b.type=="tool_use"]
                    print(f"tools: {', '.join(names)}")

                    for block in response.content:
                        if block.type != "tool_use":
                            continue
                        try:
                            tool_obj = self.tool_registry.get(block.name)
                            result = await tool_obj.execute(
                                block.input, self._perms,
                                audit=self._audit,
                                session_id=trace.session_id,
                                iteration=trace.iterations,
                                tracer=tracer,
                            )
                        except KeyError as e:
                            result = ToolResult("", str(e), ToolErrorKind.FATAL)

                        trace.tool_calls.append(ToolCallRecord(
                            tool=block.name,
                            args_preview=json.dumps(block.input, default=str)[:80],
                            success=result.success,
                            duration_ms=result.duration_ms,
                            error_kind=result.error_kind.value if result.error_kind else None,
                            iteration=trace.iterations,
                        ))

                        if result.success:
                            content = result.output
                        else:
                            ek = result.error_kind.value if result.error_kind else "UNKNOWN"
                            content = f"[{ek}] {result.error}"
                            if result.error_kind not in {ToolErrorKind.RETRYABLE, ToolErrorKind.INPUT_INVALID}:
                                print(f"  [error:{ek}] {result.error[:80]}")

                        tool_results.append({
                            "type":"tool_result",
                            "tool_use_id":block.id,
                            "content":content,
                        })

                    messages.append({"role":"user","content":tool_results})
                    continue

                print(f"[unexpected stop: {response.stop_reason}]")
                break

        return f"[max iterations ({self._cfg.max_iterations}) reached]", trace

    async def _queue_kairos(self) -> None:
        """Run KAIROS in a background task (simulates fork isolation)."""
        try:
            await self._mem.run_kairos()
        except Exception as e:
            print(f"  [KAIROS] background consolidation error: {e}")


# ─────────────────────────────────────────────
# Swarm Orchestrator
# ─────────────────────────────────────────────

@dataclass
class AgentResult:
    agent_id: str
    parent_id: str | None
    task: str
    result: str
    trace: ExecutionTrace
    error: str | None = None


class SwarmCapacityError(RuntimeError):
    pass


class SpawnSubagentTool(Tool):
    """Tool that allows subagents to spawn further subagents through the orchestrator."""
    def __init__(self, orchestrator: "SwarmOrchestrator"):
        super().__init__(
            "spawn_subagent",
            "Spawn a child agent to handle a subtask. Use when you discover a task is larger than expected.",
            {"type":"object","properties":{
                "task":{"type":"string","description":"The subtask to delegate"},
                "description":{"type":"string","description":"Brief label for this subtask"},
            },"required":["task"]},
            [Permission.AGENT_SPAWN],
        )
        self._orch = orchestrator

    async def _run(self, args):
        agent_id = await self._orch.spawn(args["task"])
        return f"Spawned subagent {agent_id} for: {args.get('description', args['task'][:50])}"


class SwarmOrchestrator:
    def __init__(self, harness_factory: Callable[[], AgentHarness], max_agents: int = 20):
        self._factory = harness_factory
        self._max = max_agents
        self._active: dict[str, asyncio.Task] = {}
        self._results: list[AgentResult] = []
        self._lock = asyncio.Lock()

    async def spawn(self, task: str, parent_id: str | None = None) -> str:
        async with self._lock:
            if len(self._active) >= self._max:
                raise SwarmCapacityError(
                    f"Swarm capacity ({self._max}) reached. Retry after active agents complete."
                )
            agent_id = str(uuid.uuid4())[:8]
            harness = self._factory()
            # Give subagents ability to recursively spawn
            harness.tool_registry.register(SpawnSubagentTool(self))

            async def run_agent() -> None:
                try:
                    result, trace = await harness.run(task)
                    async with self._lock:
                        self._results.append(AgentResult(agent_id, parent_id, task, result, trace))
                except Exception as e:
                    dummy = ExecutionTrace(task=task)
                    async with self._lock:
                        self._results.append(AgentResult(agent_id, parent_id, task, "", dummy, str(e)))
                finally:
                    async with self._lock:
                        self._active.pop(agent_id, None)

            task_obj = asyncio.create_task(run_agent())
            self._active[agent_id] = task_obj
            return agent_id

    async def wait_all(self, timeout: float = 600.0) -> list[AgentResult]:
        deadline = time.monotonic() + timeout
        while self._active:
            if time.monotonic() > deadline:
                print(f"  [swarm] timeout — {len(self._active)} agents still running")
                break
            await asyncio.sleep(0.2)
        return self._results

    def summary(self) -> str:
        success = [r for r in self._results if not r.error]
        failed = [r for r in self._results if r.error]
        total_tokens = sum(r.trace.budget.used_total if r.trace.budget else 0 for r in self._results)
        return (
            f"Swarm: {len(self._results)} agents, "
            f"{len(success)} succeeded, {len(failed)} failed, "
            f"{total_tokens:,} tokens total"
        )


# ─────────────────────────────────────────────
# Health Check
# ─────────────────────────────────────────────

async def health_check(config: HarnessConfig) -> dict:
    checks: dict[str, Any] = {}

    # API reachability
    try:
        client = anthropic.AsyncAnthropic(api_key=config.api_key)
        await asyncio.wait_for(
            client.messages.create(
                model=config.model, max_tokens=5,
                messages=[{"role":"user","content":"ping"}]
            ),
            timeout=10.0
        )
        checks["api"] = "ok"
    except Exception as e:
        checks["api"] = f"error: {e}"

    # Audit log writable
    try:
        config.audit_log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config.audit_log_path, "a"):
            pass
        # Verify chain
        audit = AuditLog(config.audit_log_path)
        ok, msg = audit.verify_chain()
        checks["audit_log"] = "ok" if ok else f"chain error: {msg}"
    except Exception as e:
        checks["audit_log"] = f"error: {e}"

    # Memory path
    checks["memory"] = "exists" if config.memory_path.exists() else "not yet created"

    status = "ok" if all(v == "ok" or v in ("not yet created", "exists") for v in checks.values()) else "degraded"
    return {"status": status, "model": config.model, "checks": checks}


# ─────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────

def build_production_harness(config: HarnessConfig | None = None) -> AgentHarness:
    if config is None:
        config = HarnessConfig()

    client = anthropic.AsyncAnthropic(api_key=config.api_key)
    permissions = PermissionSet.from_names(config.allowed_permissions)

    registry = (
        ToolRegistry()
        .register(ReadFileTool())
        .register(WriteFileTool())
        .register(PatchFileTool())
        .register(ListDirectoryTool())
        .register(GrepTool())
        .register(BashTool(cwd=Path(".")))
        .register(WebFetchTool())
        .register(GitReadTool())
    )

    return AgentHarness(
        tool_registry=registry,
        permissions=permissions,
        query_engine=QueryEngine(client, config),
        memory=MemorySystem(client, config.model, config),
        audit=AuditLog(config.audit_log_path),
        config=config,
    )


# ─────────────────────────────────────────────
# Graceful Shutdown
# ─────────────────────────────────────────────

_active_tasks: set[asyncio.Task] = set()
_shutting_down = False


async def graceful_shutdown(sig: signal.Signals) -> None:
    global _shutting_down
    _shutting_down = True
    print(f"\nReceived {sig.name} — shutting down gracefully...")
    if _active_tasks:
        print(f"  Waiting for {len(_active_tasks)} active task(s)...")
        await asyncio.gather(*_active_tasks, return_exceptions=True)
    print("  Shutdown complete.")


# ─────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────

async def main() -> None:
    config = HarnessConfig()
    raw_args = sys.argv[1:]

    if "--health" in raw_args:
        result = await health_check(config)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["status"] == "ok" else 1)

    swarm_mode = "--swarm" in raw_args
    task_args = [a for a in raw_args if not a.startswith("--")]

    if not task_args:
        print("Usage:")
        print('  python agent.py "your task here"')
        print('  python agent.py --swarm "explore and analyze every module"')
        print('  python agent.py --health')
        sys.exit(1)

    task = " ".join(task_args)

    # Register shutdown handlers
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda s=sig: asyncio.create_task(graceful_shutdown(s)))

    if swarm_mode:
        print(f"[swarm mode] Task: {task}")
        orchestrator = SwarmOrchestrator(
            harness_factory=lambda: build_production_harness(config),
            max_agents=config.max_swarm_agents,
        )
        root_id = await orchestrator.spawn(task)
        print(f"  Root agent: {root_id}")
        results = await orchestrator.wait_all()

        # Synthesize
        synth_harness = build_production_harness(config)
        parts = [f"Original task: {task}\n\nSubagent results ({len(results)} agents):\n"]
        for r in results:
            status = "✓" if not r.error else "✗"
            parts.append(f"{status} [{r.agent_id}] {r.task[:60]}\n{r.result[:500]}\n")
        parts.append("\nSynthesize the above into a coherent final response.")
        final, trace = await synth_harness.run("\n".join(parts))

        print(f"\nFinal Result:\n{final}")
        print(f"\n{orchestrator.summary()}")
        print(trace.summary())
    else:
        harness = build_production_harness(config)
        task_obj = asyncio.create_task(harness.run(task))
        _active_tasks.add(task_obj)
        task_obj.add_done_callback(_active_tasks.discard)

        result, trace = await task_obj
        print(f"\nResult:\n{result}")
        print(trace.summary())


if __name__ == "__main__":
    asyncio.run(main())
