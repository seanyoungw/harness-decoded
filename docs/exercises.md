# Exercises

> **简体中文：** [练习题](zh/exercises.md)

Short drills after reading [02-harness-vs-wrapper](02-harness-vs-wrapper.md) and running Level 1. Suggested answers are sketches, not unique.

## 1. Wrapper → harness (design)

**Prompt:** List three things a naive `while True: call_llm(messages)` loop lacks compared to the harness loop in [01-architecture](01-architecture.md).

**Sketch:** No `max_iterations`; no tool permission gate; no compaction or checkpoint when context grows.

## 2. Trace the permission check

**Prompt:** In `minimal_agent` (Python or TS), trace from `Tool.execute` to the exception type when `FS_WRITE` is missing.

**Sketch:** `PermissionSet.check` → missing set → `PermissionError` (Python) or `Error` with “Missing permissions” (TS).

## 3. Retry policy

**Prompt:** In `RETRY_POLICIES`, why might 429 use jitter?

**Sketch:** Avoid synchronized retries from many clients hammering the API at the same instant.

## 4. Compaction failure

**Prompt:** What should the agent do after `MAX_CONSECUTIVE_FAILURES` compaction failures? (See [ADR-003](adr/003-compaction-triggers.md).)

**Sketch:** Stop retrying compaction blindly; surface error to user / degrade gracefully; optional checkpoint for debug.

## 5. Fan-out vs swarm

**Prompt:** When is `--parallel` (fixed subtasks) safer than `--swarm` (recursive spawn)?

**Sketch:** Fixed fan-out when task shape is known and bounded; swarm when exploration is needed but you still need a hard `max_agents` cap.

## 6. Observability

**Prompt:** Name three fields you would require in an audit entry for a regulated environment.

**Sketch:** Who (session), what (tool + args hash), when (timestamp), outcome (success/error class), optional approver id.

---

**Hands-on:** Run a Level 1 task that triggers a tool, then open `.harness/audit.jsonl` (Level 2+) and map one line to a doc section in [03-tool-system](03-tool-system.md).
