# harness-decoded

> **The Claude Code source leak taught us something profound: the real innovation wasn't the model. It was the harness.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://typescriptlang.org)

---

## What is a Harness?

Most developers building AI agents write a **wrapper** — a thin shell that formats prompts and parses responses. Claude Code is not a wrapper. It's a **harness**: a production-grade execution framework where the LLM is just one component.

```
Wrapper:   User Input → [LLM] → Output
Harness:   User Input → Tool System → Query Engine → Memory → [LLM] → Orchestrator → Output
                            ↑              ↑            ↑                    ↑
                       permission      backpressure  compaction         multi-agent
                        gating          & retry       & recall           fan-out
```

This repository decodes that architecture — visually, technically, and practically.

---

## Three Ways to Use This Repo

| Track | You want to... | Start here |
|-------|---------------|------------|
| **Understand** | Read the leaked source, understand every design decision | [`docs/01-architecture.md`](docs/01-architecture.md) |
| **Learn** | Internalize the Harness pattern, apply it to your own systems | [`docs/02-harness-vs-wrapper.md`](docs/02-harness-vs-wrapper.md) |
| **Build** | Implement a production-grade agent from scratch | [`examples/`](examples/) → [`docs/07-build-guide.md`](docs/07-build-guide.md) |

---

## Interactive Architecture Website

The fastest way to understand the architecture is visually. Open [`website/index.html`](website/index.html) in your browser — no build step required.

**7 interactive pages:**
- **Request Lifecycle** — step through a single agent request frame by frame
- **Tool System** — click any tool, trace its permission chain and execution path
- **Context Compaction** — drag a slider, watch the memory system handle overflow
- **Multi-Agent Orchestration** — visualize fan-out, gather, and swarm patterns
- **KAIROS + autoDream** — the background daemon timeline, annotated
- **Undercover Mode** — the stealth commit flow decoded
- **Architecture Playground** — drag-and-drop your own agent, export scaffolding code

---

## The Harness: Five Layers

```
┌─────────────────────────────────────────────────────────┐
│                     Tool System                          │
│  40+ tools · permission-gated · sandboxed execution     │
├─────────────────────────────────────────────────────────┤
│                    Query Engine                          │
│  streaming · backpressure · retry · response caching    │
├─────────────────────────────────────────────────────────┤
│                   Memory System                          │
│  autoCompact · KAIROS daemon · autoDream consolidation  │
├─────────────────────────────────────────────────────────┤
│             Multi-Agent Orchestration                    │
│  subagent spawning · swarm coordination · result gather │
├─────────────────────────────────────────────────────────┤
│                    IDE Bridge                            │
│  bidirectional comms · LSP integration · inline diffs   │
└─────────────────────────────────────────────────────────┘
                          ↕
                    [Claude Model]
           (one component among many, not the system)
```

---

## Code Examples: Three Levels

Every example ships in both **Python** and **TypeScript** with identical interfaces.

### Level 1 — Minimal (~300 lines)
The irreducible core. Tool system + Query Engine. Zero dependencies beyond the Anthropic SDK. Read this first.

```bash
# Python
cd examples/python/minimal_agent
pip install anthropic
python agent.py "list all TODO comments in this codebase"

# TypeScript
cd examples/typescript/minimal-agent
npm install
npx ts-node agent.ts "list all TODO comments in this codebase"
```

### Level 2 — Standard (~800 lines)
Adds Memory System and Multi-Agent orchestration. Extensible tool plugin interface.

### Level 3 — Production
Full Harness architecture. KAIROS-inspired background processing, audit logging, deployment configs.

---

## Documentation

| Doc | Topic | Depth |
|-----|-------|-------|
| [01 — Architecture Overview](docs/01-architecture.md) | Full system map with annotated source references | ★★★★☆ |
| [02 — Harness vs Wrapper](docs/02-harness-vs-wrapper.md) | The philosophical and engineering differences | ★★★★★ |
| [03 — Tool Permission System](docs/03-tool-system.md) | Sandbox design, audit trails, revocation | ★★★★☆ |
| [04 — Query Engine Internals](docs/04-query-engine.md) | Backpressure, retry strategies, response caching | ★★★★☆ |
| [05 — Memory & Context](docs/05-memory-context.md) | autoCompact algorithm, KAIROS, autoDream | ★★★★★ |
| [06 — Multi-Agent Patterns](docs/06-multi-agent.md) | fan-out, gather, swarm — when to use each | ★★★★☆ |
| [07 — Production Build Guide](docs/07-build-guide.md) | From design decisions to deployment | ★★★★★ |

---

## Architecture Decision Records

Every non-obvious design decision in the examples is documented in [`docs/adr/`](docs/adr/). Format: context → options considered → decision → consequences.

Example ADRs:
- [ADR-001: Why tools are defined as data, not code](docs/adr/001-tools-as-data.md)
- [ADR-002: Synchronous vs streaming tool execution](docs/adr/002-streaming-tools.md)
- [ADR-003: Memory compaction trigger strategy](docs/adr/003-compaction-triggers.md)

---

## Key Findings from the Leaked Source

Things the community discovered that informed this repo:

- **The Query Engine is 46K lines** — the LLM call itself is a small fraction of the complexity
- **Tool definitions are ~29K lines** — each tool has extensive validation, permission checking, and error recovery built in
- **KAIROS** (`autoDream`) performs memory consolidation in background forks so main context is never corrupted by maintenance
- **Undercover Mode** (`undercover.ts`) blocks internal codenames and hides AI authorship from open-source commit history
- **MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3** — a single comment revealing that 1,279 sessions had 50+ consecutive failures daily before this fix

> Disclaimer: This repo contains no leaked source code. All examples are original implementations inspired by architectural patterns discussed publicly after the leak.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In particular:
- New tools for Level 1/2/3 examples are very welcome
- Additional language ports (Go, Rust) would be incredible
- Corrections to architectural analysis — open an issue with source references

---

## License

MIT. Build something great.
