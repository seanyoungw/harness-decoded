# ADR-003: Memory Compaction Trigger Strategy

**Status**: Accepted  
**Date**: 2024-01

## Context

autoCompact must decide when to trigger. Three candidate strategies:

1. **Token count threshold** — compact when estimated tokens > X% of window
2. **Message count threshold** — compact every N messages
3. **Proactive compaction** — compact after every iteration, keep context minimal

## Decision

Use **token count threshold at 85% of context window**.

## Rationale

**Message count is a poor proxy.** Tool results vary enormously in size. Ten `read_file` results from large files can exceed the context limit; fifty short tool calls might not. Message count doesn't reflect actual token consumption.

**Proactive compaction is too expensive.** Compaction is itself an LLM call. Calling it after every iteration doubles the API cost of long sessions. The 85% threshold ensures we compact exactly when needed.

**Why 85% and not 95%?** The compaction call itself consumes tokens. If we wait until 95%, the compaction prompt may not fit. The leaked Claude Code source uses a similar threshold (exact value not visible, but behavioral analysis suggests ~85%). A 15% buffer gives the compaction call room to work.

**The failure counter is the critical insight.** Without `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES`, a session stuck in a compaction failure loop burns API budget indefinitely. The three-attempt limit is a hard stop that prevents this. After three failures, the harness surfaces an error rather than silently looping. The user can start a new session with a clean context.

## Consequences

- Long sessions (>100 iterations) will compact multiple times
- Each compaction potentially loses some context detail (by design)
- The 85% threshold can be tuned per deployment via `COMPACT_THRESHOLD` env var
- Compaction failures are counted and surfaced — operators can alert on this metric
