# Documentation ↔ Code Map

> **简体中文：** [文档 ↔ 代码对照表](zh/00-code-map.md)

Use this table to read **concepts in `docs/`** alongside **working code in `examples/`**.

| Doc | Topic | Python | TypeScript |
|-----|--------|--------|------------|
| [01-architecture](01-architecture.md) | Full stack map | All levels | All levels |
| [02-harness-vs-wrapper](02-harness-vs-wrapper.md) | Philosophy + minimal harness contract | `minimal_agent/agent.py` | `minimal-agent/agent.ts` |
| [03-tool-system](03-tool-system.md) | Permissions, validation, sandbox | `Tool`, `ToolRegistry`, `PermissionSet` in each `agent` | Same names in TS agents |
| [04-query-engine](04-query-engine.md) | Retry, streaming mindset | `QueryEngine`, `RETRY_POLICIES` | `QueryEngine`, `RETRY_POLICIES` |
| [05-memory-context](05-memory-context.md) | Compaction, checkpoints | `MemorySystem` in `standard_agent`, `production_agent` | `MemorySystem` in standard + production |
| [06-multi-agent](06-multi-agent.md) | Fan-out, swarm | `--parallel` in `standard_agent`; `SwarmOrchestrator` in `production_agent` | `--parallel` in standard; `--swarm` in production |
| [07-build-guide](07-build-guide.md) | Production checklist | `production_agent/agent.py` + `docker-compose.yml` | `production-agent/agent.ts` |

## Official Claude Code (upstream)

| Resource | Use |
|----------|-----|
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | Public OSS: plugins, examples, `.claude` commands, scripts |
| [Claude Code docs — overview](https://code.claude.com/docs/en/overview) | Product behavior and features |
| [Claude Code docs — setup](https://code.claude.com/docs/en/setup) | Installers and environment |
| [01-architecture § Official repository…](01-architecture.md#official-repository-shipped-product-and-this-diagram) | How the public repo relates to the five-layer diagram |

## Jump to implementation detail

| Mechanism | Where to look (Python) | Where to look (TypeScript) |
|-----------|-------------------------|----------------------------|
| Permission gate before tool runs | `PermissionSet.check` → `Tool.execute` | Same pattern |
| Tool result error taxonomy | `ToolErrorKind` (Level 2+) | `ToolErrorKind` |
| API retry with backoff | `QueryEngine.call` | `QueryEngine.call` |
| Context compaction + failure cap | `MemorySystem.maybe_compact`, `MAX_CONSECUTIVE_FAILURES` | Same |
| Audit JSONL | `AuditLog` (Level 2+); chained hash (Level 3) | `AuditLog`; chained hash (Level 3) |
| Token budget | `TokenBudget` + `ExecutionTrace` | Same |
| KAIROS / autoDream | `MemorySystem.run_kairos` (Level 3) | `MemorySystem.runKairos` (Level 3) |

## Animated explainers (no API key)

These pages visualize the same ideas as the code above:

- [Principles (animations)](../website/principles.html) — loop, permissions, compaction, fan-out
- [Request lifecycle (stepper)](../website/src/pages/request-lifecycle.html)
- [Tool system + Undercover](../website/src/pages/tool-system.html)
- [Multi-agent](../website/src/pages/multi-agent.html)
- [Context compaction](../website/compaction.html)
- [KAIROS timeline](../website/kairos.html)

Open `website/index.html` for the overview and navigation.
