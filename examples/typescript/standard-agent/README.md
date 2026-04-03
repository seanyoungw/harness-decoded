# Level 2 — Standard Agent (TypeScript)

Twin of `examples/python/standard_agent`: compaction, audit, `--parallel`, token budget, bash sandbox, grep.

## Setup

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
npx ts-node agent.ts "summarize the harness-decoded README"
npx ts-node agent.ts --parallel "one bullet per subdirectory"
```

## Demo scenarios

See [Python standard README](../python/standard_agent/README.md).

## Animations

[`website/principles.html`](../../../website/principles.html), [`website/compaction.html`](../../../website/compaction.html)
