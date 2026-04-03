# Level 2 — Standard Agent (Python)

Adds `MemorySystem` (autoCompact + checkpoints), JSONL audit log, token budget, `--parallel` fan-out, bash sandbox rules, `grep`.

## Setup

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
python agent.py "refactor plan for the auth module"
python agent.py --parallel "note one risk per top-level subdirectory"
```

## Demo scenarios

| Goal | What to observe |
|------|-----------------|
| Audit trail | After a run, inspect `.harness/audit.jsonl` — one line per tool invocation |
| Compaction | Very long sessions may log `[memory] autoCompact triggered`; on repeated compaction failure, session aborts after 3 tries |
| Parallel | `--parallel` spawns one harness per subdirectory (capped), then a synthesizer agent merges results |
| Token budget | Trace footer shows input/output tokens and estimated cost |

## Animations

[`website/principles.html`](../../../website/principles.html) (compaction + fan-out), [`website/compaction.html`](../../../website/compaction.html) (threshold slider).

## See also

[`docs/05-memory-context.md`](../../../docs/05-memory-context.md), [`docs/06-multi-agent.md`](../../../docs/06-multi-agent.md)
