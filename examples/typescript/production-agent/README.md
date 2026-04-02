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

## Status

Coming soon. Track progress in [GitHub Issues](https://github.com/YOUR_USERNAME/harness-decoded/issues).

Want to contribute? The Level 3 implementation is a great first PR.
See [CONTRIBUTING.md](../../CONTRIBUTING.md).
