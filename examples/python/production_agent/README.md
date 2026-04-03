# Level 3: Production Agent

This is the full production harness implementation.

**See [Doc 07: Production Build Guide](../../docs/07-build-guide.md)** for the complete specification of what this level implements.

## What's included

- Full `AgentHarness` with all Phase 1 + Phase 2 checklist items
- `MemorySystem` with KAIROS daemon and autoDream (5 passes)
- `SwarmOrchestrator` with dynamic subagent spawning
- OpenTelemetry instrumentation
- Token budget enforcement
- Shell sandbox with full environment isolation
- Tamper-evident audit log (SHA-256 chained)
- Health check endpoint
- Graceful shutdown handling
- Docker + docker-compose deployment config

## Run

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
python agent.py "your task"
python agent.py --swarm "exploratory multi-agent task"
python agent.py --health
```

## Demo scenarios

| Feature | How to see it |
|---------|----------------|
| Chained audit | `.harness/audit.jsonl` lines include `prevHash` and `hash`; integrity check runs on `--health` |
| Project memory | After sessions with checkpoints, `.harness/memory.json` may be updated by `run_kairos` (async after `end_turn`) |
| Swarm | `--swarm` — root agent + dynamic `spawn_subagent` up to `MAX_SWARM_AGENTS` |
| Tracing | `Tracer` spans wrap LLM and tool calls (exportable structure) |

## TypeScript twin

[`examples/typescript/production-agent`](../../typescript/production-agent) — same flags: `--health`, `--swarm`, `--parallel`.

## Animations

[`website/principles.html`](../../../website/principles.html), [`website/kairos.html`](../../../website/kairos.html)

## Contributing

[CONTRIBUTING.md](../../CONTRIBUTING.md)
