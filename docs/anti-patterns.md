# Anti-Patterns: Wrappers in Disguise

> **简体中文：** [反模式](zh/anti-patterns.md)

Common “agent” code that fails in production, with a harness-shaped fix. Pairs well with [02-harness-vs-wrapper](02-harness-vs-wrapper.md).

## 1. Unbounded message array

```python
# Anti-pattern
messages.append({"role": "user", "content": user})
messages.append({"role": "assistant", "content": model(messages)})
# ... grows until context_length_exceeded
```

**Fix:** Compaction policy + checkpoint of raw history; cap iterations; structured summary that preserves task spec (see Level 2 `MemorySystem`).

## 2. Shell as string soup

```python
# Anti-pattern
subprocess.run(response_text, shell=True)
```

**Fix:** Typed `bash` tool with allowlisted env, cwd restriction, timeout, output cap, destructive-pattern block (Level 2+).

## 3. No permission boundary

```python
# Anti-pattern
def run_tool(name, args):
    return TOOLS[name](**args)  # host process powers
```

**Fix:** `PermissionSet` checked before every execution; optional human approval for sensitive classes (Level 1+).

## 4. Sequential everything

```python
# Anti-pattern
for path in all_files:
    read_and_summarize(path)  # N serial LLM turns
```

**Fix:** When subtasks are independent, bounded fan-out with concurrency limit (Level 2 `--parallel`, Level 3 swarm with capacity).

## 5. Silent tool failure

```python
# Anti-pattern
try:
    tool()
except Exception:
    pass  # model never knows
```

**Fix:** Classify errors (`RETRYABLE`, `INPUT_INVALID`, …), return to model as tool_result content, increment trace (Level 2+).

## 6. No session budget

**Anti-pattern:** Track spend only in the billing console after the fact.

**Fix:** `TokenBudget` on `ExecutionTrace`; hard stop or degrade when exceeded (Level 2+; production config in Level 3).

## 7. “Compaction” = truncate last N messages

**Anti-pattern:** `messages = messages[-20:]`

**Fix:** LLM- or rules-based summary with explicit preserved fields (task, constraints, progress); failure counter (ADR-003).

---

Visual versions of several patterns are animated on [Principles](../website/principles.html).
