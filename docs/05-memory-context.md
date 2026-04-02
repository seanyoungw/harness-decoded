# Memory & Context: autoCompact, KAIROS, and autoDream

> The hardest problem in production AI agents is not intelligence — it's memory. Claude Code solves it with three interlocking systems.

---

## The Fundamental Constraint

Every LLM has a context window: a hard limit on how many tokens it can process in a single call. For Claude, this is currently ~200,000 tokens. That sounds large. A realistic coding session can exceed it in under an hour:

```
System prompt:           ~2,000 tokens
Initial codebase scan:  ~15,000 tokens
20 file reads × 500t:   ~10,000 tokens
50 LLM turns × 800t:    ~40,000 tokens
Tool results:           ~30,000 tokens
────────────────────────────────────────
Running total:          ~97,000 tokens (48% of window)
```

A complex refactoring task that spans hours will hit the limit. The wrapper pattern's answer is truncation — drop old messages. This is catastrophically wrong: the oldest messages contain the task specification, the constraints, and the original reasoning. Dropping them means the agent forgets what it's supposed to do.

The harness answer is **compaction**: compress the context while preserving what matters.

---

## System 1: autoCompact

`autoCompact` triggers when the context window reaches a configurable threshold (default: 85% capacity). It replaces a portion of the message history with a structured summary that preserves task-critical information.

### What Gets Preserved

The compaction algorithm maintains five categories of information:

```python
@dataclass
class CompactionSummary:
    task_specification: str      # original task + constraints, verbatim
    completed_work: list[str]    # what has been accomplished
    current_state: str           # where in the task we are now
    open_questions: list[str]    # unresolved decisions or blockers
    key_facts: list[str]         # file contents, findings that will be needed
```

The compaction prompt instructs the model to extract these five categories from the messages being compressed. The raw messages are then replaced by a single "compaction summary" message, reducing token count while retaining the semantic content the agent needs to continue.

### What Gets Dropped

Everything that is not in the five categories above: exploratory tool calls that didn't yield useful information, intermediate reasoning that led to a dead end, redundant re-readings of files already captured in `key_facts`.

### Compaction Failure

The leaked source revealed a critical production problem: compaction itself can fail. If the messages being compacted are themselves near the context limit, the compaction LLM call may exceed the limit. This creates a pathological loop:

```
context full → trigger compaction → compaction call too large → compaction fails
→ agent continues → context grows further → trigger compaction → fails again
→ ...
```

The fix: `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`. After three consecutive failures, the harness stops attempting compaction and surfaces an error to the agent loop. The agent can then choose to abandon the current task and start fresh with a clean context.

Before this fix, 1,279 sessions per day were burning ~250,000 API calls in this failure loop — a real operational cost that a three-line constant fixed.

```python
class MemorySystem:
    MAX_CONSECUTIVE_FAILURES = 3

    async def maybe_compact(self, messages: list[dict], token_count: int) -> list[dict]:
        if token_count < self._threshold(messages):
            self._consecutive_failures = 0
            return messages

        if self._consecutive_failures >= self.MAX_CONSECUTIVE_FAILURES:
            raise CompactionGaveUpError(
                "autoCompact failed too many times. Consider starting a new session."
            )

        try:
            compacted = await self._compact(messages)
            self._consecutive_failures = 0
            self._checkpoint(messages)  # save raw to disk before replacing
            return compacted
        except Exception as e:
            self._consecutive_failures += 1
            raise CompactionError(str(e)) from e
```

### Checkpointing

Before replacing messages with their compaction summary, the harness checkpoints the raw messages to disk. This serves two purposes:

1. **Debugging**: if the compaction summary is wrong or incomplete, the raw messages can be inspected
2. **Replay**: the full session can be reconstructed from checkpoints, even after multiple compaction passes

Checkpoints are written as JSONL files, append-only. They accumulate across the session and are consumed by the KAIROS daemon.

---

## System 2: KAIROS

KAIROS is a background daemon — a persistent process that runs while the user is idle. Its purpose is cross-session memory consolidation: turning individual session checkpoints into durable, reusable knowledge.

### Fork Architecture

The most important architectural detail: KAIROS runs in a **forked subprocess**, not in the main agent process.

```python
async def start_kairos_daemon(session_dir: Path) -> None:
    """Start KAIROS in a forked process. Returns immediately."""
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "harness.kairos",
        str(session_dir),
        # Explicitly isolated from parent environment
        env={"PYTHONPATH": str(PROJECT_ROOT)},
        # Output goes to daemon log, not parent stdout
        stdout=open(session_dir / "kairos.log", "a"),
        stderr=asyncio.subprocess.STDOUT,
    )
    # Do not await — daemon runs independently
    # Parent continues without waiting for KAIROS
```

Why the fork? Memory consolidation involves its own LLM calls, disk reads, and extended computation. If this ran in the main agent process:
- It would consume context window tokens during active sessions
- Its LLM calls would compete with the agent's calls for rate limits
- A bug in consolidation could corrupt the live agent's state
- The agent would have to wait for consolidation to complete

The fork means: KAIROS can fail completely without affecting the live agent. It's a best-effort background improvement, not a required component.

### KAIROS Lifecycle

```
Session ends (user idle or explicit close)
    │
    ▼
KAIROS daemon starts (forked)
    │
    ├─ 1. Load all session checkpoints from session_dir/
    │
    ├─ 2. Load existing memory store (if any) from project_dir/.harness/memory.json
    │
    ├─ 3. Run autoDream consolidation (see below)
    │
    ├─ 4. Write updated memory store to project_dir/.harness/memory.json
    │
    └─ 5. Exit cleanly (or crash — main process doesn't care)

Next session starts
    │
    ▼
Memory system loads .harness/memory.json
    │
    └─ Injects consolidated memory as system context prefix
```

---

## System 3: autoDream

autoDream is the consolidation algorithm that runs inside KAIROS. It takes session transcripts and a prior memory store, and produces a better memory store.

### Five Consolidation Passes

**Pass 1: Observation extraction**

Each session transcript is read and reduced to atomic observations:

```
Session: "Read src/auth.py. It uses JWT with HS256. The secret is loaded from ENV['JWT_SECRET'].
          Tried to refactor to RS256 but the key loading code doesn't exist yet."

Observations:
  - src/auth.py uses JWT with HS256
  - JWT secret loaded from ENV['JWT_SECRET']
  - RS256 migration: key loading code does not exist
```

**Pass 2: Deduplication**

Observations from the current session are merged with the existing memory store. Identical or near-identical observations are deduplicated (the more recent one wins if there's a conflict).

**Pass 3: Contradiction resolution**

When two observations contradict each other, the newer one wins — but the resolution is logged:

```
Contradiction detected:
  Old (2025-11-01): "auth tests pass"
  New (2025-11-15): "auth tests failing — JWT validation broken after refactor"
Resolution: new observation wins. Old observation archived.
```

**Pass 4: Certainty promotion**

Tentative observations (phrased as questions, prefixed with "might", "unclear if") are reviewed. If subsequent sessions confirmed or denied them, they're promoted to facts or retracted.

```
Tentative (2025-11-01): "unclear if auth.py is tested"
Confirmed (2025-11-10): read_file tests/test_auth.py → exists
Promoted: "auth.py has tests in tests/test_auth.py"
```

**Pass 5: Pattern synthesis**

autoDream looks for patterns across sessions that are worth making explicit:

```
Pattern detected across 8 sessions:
  - Agent repeatedly reads src/config.py early in sessions
  - src/config.py changes frequently
  - Config changes often cause downstream failures

Synthesized note: "src/config.py is a frequent change point. Check it early
                   when investigating failures. High coupling to auth and payments modules."
```

### The Memory Store Format

```json
{
  "project": "harness-decoded",
  "last_updated": "2025-11-15T14:23:00Z",
  "session_count": 12,
  "facts": [
    {
      "content": "JWT secret loaded from ENV['JWT_SECRET']",
      "source": "session_2025-11-01",
      "certainty": "confirmed",
      "last_seen": "2025-11-15"
    }
  ],
  "patterns": [
    {
      "content": "src/config.py is a frequent change point...",
      "supporting_sessions": ["session_2025-11-03", "session_2025-11-07", "..."],
      "confidence": 0.85
    }
  ],
  "open_questions": [
    {
      "content": "RS256 migration: key loading code still missing?",
      "first_raised": "2025-11-01",
      "last_seen": "2025-11-12"
    }
  ]
}
```

### What autoDream Does NOT Do

autoDream is not trying to build a knowledge graph of the entire codebase. That's what `read_file` is for — the agent reads what it needs when it needs it.

autoDream builds **meta-knowledge**: observations about the codebase that are slow to derive but useful across many sessions. "This file changes often." "This test is consistently flaky." "This API has an undocumented rate limit that we've hit three times." These are facts that a human engineer would have internalized after months on a project. autoDream approximates that accumulation across sessions.

---

## Loading Memory at Session Start

When a new session begins, the Memory System loads the existing memory store and injects it as a context prefix:

```python
async def build_session_context(project_dir: Path, task: str) -> list[dict]:
    memory = load_memory_store(project_dir / ".harness" / "memory.json")

    if not memory or memory.is_empty():
        return [{"role": "user", "content": task}]

    memory_prefix = f"""<project_memory>
{memory.to_context_string()}
</project_memory>

Note: The above represents consolidated knowledge from {memory.session_count} previous sessions.
Facts are verified observations. Patterns are inferred from repeated behavior.
Open questions have not been definitively resolved."""

    return [
        {"role": "user", "content": memory_prefix},
        {"role": "assistant", "content": "I've noted the project context. What's the task?"},
        {"role": "user", "content": task}
    ]
```

The memory prefix costs tokens but pays for itself: the agent doesn't have to re-derive facts it already knows. On a mature project with 50+ sessions of history, the memory prefix can save dozens of redundant tool calls per session.

---

## Implementation in the Examples

- **Level 1**: No KAIROS (single-session only). autoCompact is present but simplified (truncates instead of summarizes, for clarity).
- **Level 2**: Full autoCompact with LLM-powered summarization. KAIROS daemon with observation extraction and deduplication (passes 1-2).
- **Level 3**: Full implementation including contradiction resolution, certainty promotion, and pattern synthesis.

---

## Next

- [Doc 06: Multi-Agent Patterns](06-multi-agent.md) — fan-out, gather, swarm
- [Doc 07: Production Build Guide](07-build-guide.md) — end-to-end deployment
