# Level 1 — Minimal Agent (Python)

Irreducible harness: typed tools, permission gate, query engine with retries, execution trace.

## Setup

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
python agent.py "list all TODO comments in this directory"
```

## Demo scenarios (what to notice)

| Goal | Command / action | Expected behavior |
|------|------------------|-------------------|
| Happy path | `python agent.py "read README.md and quote first line"` | Tool calls (`read_file`), trace printed at end |
| Permission wall | Temporarily edit `agent.py` to use `PermissionSet.read_only()` and ask for a write | `PermissionError` / tool returns permission denied |
| Retries | (Optional) transient API errors log `[api 429] retry…` from `QueryEngine` | Backoff then success or hard fail |

## Animated explainers (no API key)

Open from repo root: [`website/principles.html`](../../../website/principles.html) — loop + permission gate animations map directly to this file.

## See also

- [`docs/00-code-map.md`](../../../docs/00-code-map.md)
- TypeScript twin: [`examples/typescript/minimal-agent`](../../typescript/minimal-agent)
