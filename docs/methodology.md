# Methodology: Claims, Evidence, and Reconstruction

> **简体中文：** [方法论](zh/methodology.md)

This repository teaches the **harness pattern** for production agents. Not every sentence describes verified Claude Code source code.

## Three tiers of statements

| Tier | Meaning | How we label it |
|------|---------|-----------------|
| **A — Public / widely reported** | Metrics or module sizes discussed in public post-leak analysis, blog posts, or community summaries | Stated as community-reported; treat as approximate |
| **B — Architectural reconstruction** | Interfaces and flows **inferred** from that discourse, implemented here as **original** teaching code | Examples in `examples/`; ADRs in `docs/adr/` |
| **C — Pedagogical simplification** | Behaviors chosen for clarity (e.g. simulated “fork” for KAIROS as `asyncio.create_task`) | Called out in code comments where it matters |

## Public Claude Code repository (2026)

Anthropic publishes **[anthropics/claude-code](https://github.com/anthropics/claude-code)** on GitHub. That tree is primarily **plugins, examples, `.claude/` command definitions, scripts, and related OSS** — not a complete, browsable copy of every line of the shipped CLI. The product is installed via official installers; see **[Claude Code setup](https://code.claude.com/docs/en/setup)** and the **[documentation overview](https://code.claude.com/docs/en/overview)**.

When this site cites large module sizes (e.g. query engine ~46K LOC, tool system ~29K LOC), those numbers come from **post-leak community analysis and architectural reconstruction** (**tiers A/B** above), **not** from measuring the public `anthropics/claude-code` repository unless we say so explicitly.

## What this repo is not

- **Not a source dump.** There is no proprietary or leaked code.
- **Not a line-by-line reimplementation** of any commercial product.
- **Not a guarantee** that public anecdotes (e.g. session counts, line counts) are exact today; they illustrate **order-of-magnitude** engineering reality.

## Website interactive diagrams

Some pages include clickable diagram regions. A popup labels each link’s **tier**: *public* (paths under [anthropics/claude-code](https://github.com/anthropics/claude-code)), *docs* (product docs or this repo’s `docs/`), *example* (this repo’s `examples/`), or *disclosure* (leak-era architecture discussion without a matching file in the public OSS tree — see tiers A/B above).

## How to cite this project

Prefer: “Educational reconstruction of harness-style architecture (harness-decoded).”  
Avoid implying this repository **is** or **equals** any vendor’s internal codebase.

## When you find a mistake

Open an issue using [architectural-correction](../.github/ISSUE_TEMPLATE/architectural-correction.md) with references. We prioritize correctness of **patterns** and **teaching accuracy** over matching unverifiable trivia.
