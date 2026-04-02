# ADR-002: Synchronous vs Streaming Tool Execution

**Status**: Accepted  
**Date**: 2024-01

## Context

The Anthropic API supports two call modes: synchronous (returns a complete `Message`) and streaming (returns an `AsyncStream` of events). For the Level 1 minimal agent, we use synchronous mode. For Level 2+, streaming is available.

## Decision

Level 1 uses **synchronous** API calls. Level 2+ offer **streaming** as an option.

## Rationale

**Synchronous is simpler to reason about.** The complete response is available before any processing begins. No partial state, no stream interruption handling, no incremental JSON assembly. For a teaching codebase, this clarity is worth the UX cost (no real-time progress).

**Streaming is essential for production UX.** A 30-second LLM call with no feedback feels broken. Streaming lets the terminal UI update in real time. The Claude Code source shows the entire terminal renderer is built around streaming.

**The harness interface is the same either way.** Both modes return the same `Message` object (synchronous mode directly, streaming mode after stream completion). Switching between them is a one-line change. Level 1 users can add streaming without changing any other harness logic.

## Consequences

- Level 1 has no real-time progress indication (by design — keep it simple)
- Level 2 wraps the streaming client but presents the same `Message` interface
- Stream interruption (network drop mid-response) is handled in Level 2's `QueryEngine`
