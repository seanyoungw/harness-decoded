# Level 3 — Production Agent (TypeScript)

Mirrors [`examples/python/production_agent`](../python/production_agent): chained audit log, `MemorySystem` with KAIROS-style `runKairos`, swarm orchestration, health check, `patch_file` / `web_fetch` / `git_read`.

**See [Doc 07: Production Build Guide](../../docs/07-build-guide.md)** for the full checklist narrative.

## Setup

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
npx ts-node agent.ts "your task"
npx ts-node agent.ts --parallel "fan-out by subdirectory"
npx ts-node agent.ts --swarm "recursive subagent exploration"
npx ts-node agent.ts --health
```

## Environment (same names as Python)

`AGENT_MODEL`, `MAX_TOKENS`, `SESSION_BUDGET`, `MAX_ITERATIONS`, `COMPACT_THRESHOLD`, `CONTEXT_WINDOW`, `AUDIT_LOG`, `CHECKPOINT_DIR`, `MEMORY_PATH`, `MAX_SWARM_AGENTS`, `PERMISSIONS` (comma-separated).

## Demo scenarios

See [Python production README](../python/production_agent/README.md).

## Animations

[`website/principles.html`](../../../website/principles.html), [`website/kairos.html`](../../../website/kairos.html)
