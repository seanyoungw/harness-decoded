# Official `anthropics/claude-code` + Richer Site Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

I'm using the **writing-plans** skill to create this implementation plan.

**Goal:** Ground harness-decoded’s architecture story in what is **actually visible** in the public [anthropics/claude-code](https://github.com/anthropics/claude-code) repository and [official docs](https://code.claude.com/docs/en/overview), while **honestly separating** that from leak/discourse-derived quantitative claims — so the site feels deeper without pretending the GitHub tree is the 500K-line product.

**Architecture:** Add a **three-layer epistemology** in docs + site copy: (1) **OSS repo facts** — directories, plugins, examples, scripts; (2) **Product docs** — install, IDE, data usage from code.claude.com; (3) **Teaching / leak-tier narrative** — five-layer harness, line counts, KAIROS, etc., labeled per `docs/methodology.md` tiers. Expand `docs/01-architecture.md` + `docs/zh/01-architecture.md` with a new major section and a concrete **repo → concept** table. Touch `website/index.html` + `website/i18n/zh.json` only for **new copy blocks** (no CSS/layout changes unless explicitly needed for one extra paragraph or link row).

**Tech Stack:** Markdown, static HTML, existing i18n (`data-i18n` / `zh.json`). Optional: shallow `git clone --depth 1` of upstream for local reference (no submodule required).

---

## Critical context (read before coding)

| Source | What it actually is |
|--------|---------------------|
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | Public repo: **`plugins/`**, **`examples/`**, **`.claude/`** (commands), **`scripts/`**, **`Script/`**, install-related assets, **CHANGELOG**, etc. README points to **curl/brew/winget** install and [setup docs](https://code.claude.com/docs/en/setup) — the **core product is not this repo’s full TypeScript monolith**. |
| harness-decoded today | Strong **five-layer** diagram + **~46K / ~29K line** stats framed around **“leaked source”** — still valid as **Tier A/B pedagogical narrative** if labeled; **not** directly provable by listing files in `anthropics/claude-code`. |

**Scope check:** Single coherent deliverable — documentation + site copy alignment. No vendoring of Claude Code, no copying non-MIT upstream text wholesale.

---

## File map

| File | Role |
|------|------|
| `docs/methodology.md` | Add short subsection: **public repo vs product binary vs leak discourse** (3–5 sentences). |
| `docs/01-architecture.md` | New **§ Public repository & official product** + **repo layout table** + links; tweak opening note so “leak” and “public OSS” coexist. |
| `docs/zh/01-architecture.md` | Mirror structure in Chinese. |
| `docs/00-code-map.md` (+ `docs/zh/00-code-map.md`) | One row or bullet: link new section + upstream repo. |
| `website/index.html` | Under `#architecture` or hero-adjacent **one paragraph + link** to upstream repo + official docs (English default). |
| `website/i18n/zh.json` | New keys under `arch.*` or `hero.*` for Chinese mirror of that paragraph only. |
| `README.md` (repo root) | Optional one-line: “See also official Claude Code repo …” — only if you want discoverability from GitHub landing. |

---

### Task 1: Inventory upstream repo (read-only)

**Files:** None in harness-decoded yet — local notes OK.

- [ ] **Step 1:** Open [anthropics/claude-code](https://github.com/anthropics/claude-code) and list **top-level dirs** you will cite: `.claude-plugin`, `.claude`, `plugins`, `examples`, `scripts`, `Script`, `.github`, etc.

- [ ] **Step 2:** Read [plugins/README.md](https://github.com/anthropics/claude-code/blob/main/plugins/README.md) (raw or on GitHub) and note **2–4 concrete capabilities** (commands, agents, extension points) you can quote in **your own words**.

- [ ] **Step 3:** Skim `examples/` listing — note **1 sentence** on what examples illustrate (without copying README text verbatim if license differs; prefer paraphrase + link).

**Verify:** You can answer in one sentence: “The public repo primarily ships X, not the full CLI source.”

---

### Task 2: Extend `docs/methodology.md`

**Files:**
- Modify: `docs/methodology.md`

- [ ] **Step 1:** Add subsection **“Public Claude Code repository”** stating:
  - [anthropics/claude-code](https://github.com/anthropics/claude-code) documents **plugins, examples, and tooling** shipped as OSS.
  - The **installed `claude` binary** is distributed via installers per [setup documentation](https://code.claude.com/docs/en/setup); harness-decoded does **not** mirror that binary.
  - Line-count / internal-module claims about “query engine ~46K LOC” remain **Tier A/B** (community / reconstruction), not “counted from anthropics/claude-code tree.”

```markdown
## Public Claude Code repository (2026)

Anthropic publishes [anthropics/claude-code](https://github.com/anthropics/claude-code) on GitHub. That tree is primarily **plugins, examples, scripts, and related OSS surfaces** — not a line-for-line dump of the entire shipped product. The CLI is installed via official installers; see [Claude Code setup](https://code.claude.com/docs/en/setup).

When this site mentions large module sizes (e.g. query engine, tool system), those figures come from **post-leak community analysis and architectural reconstruction** (tiers A/B in this doc), not from file-by-file measurement of the public repo unless explicitly stated.
```

- [ ] **Step 2:** Commit

```bash
git add docs/methodology.md && git commit -m "docs: clarify public claude-code repo vs product vs leak-tier claims"
```

---

### Task 3: Expand `docs/01-architecture.md`

**Files:**
- Modify: `docs/01-architecture.md`

- [ ] **Step 1:** After the opening blockquote (or before `## System Map`), add **§ What the official GitHub repo contains** with:
  - Bullet list mapped to real paths: `plugins/`, `examples/`, `.claude/commands`, `scripts/`, `Script/`.
  - Link: [anthropics/claude-code](https://github.com/anthropics/claude-code).
  - Link: [Official documentation](https://code.claude.com/docs/en/overview).

- [ ] **Step 2:** Add a **two-column table** `Public artifact | Maps to harness concept` (e.g. plugins → extensibility / tool-shaped commands; examples → integration patterns).

- [ ] **Step 3:** Add one short **§ Relationship to the five-layer diagram** paragraph: diagram = **logical** harness; public repo = **one slice** of extensibility + docs; leak-tier numbers = **separate evidence track**.

- [ ] **Step 4:** Optionally soften the first line of the doc note from “leaked source” only to “leak discourse + public OSS + official docs” — **without deleting** the rest of the leak-informed layers (still pedagogically useful).

- [ ] **Step 5:** Commit

```bash
git add docs/01-architecture.md && git commit -m "docs: architecture doc grounded in official claude-code repo"
```

---

### Task 4: Mirror in `docs/zh/01-architecture.md`

**Files:**
- Modify: `docs/zh/01-architecture.md`

- [ ] **Step 1:** Translate Task 3 sections (same structure, same outbound links).

- [ ] **Step 2:** Commit

```bash
git add docs/zh/01-architecture.md && git commit -m "docs(zh): sync architecture with official repo section"
```

---

### Task 5: Code map cross-links

**Files:**
- Modify: `docs/00-code-map.md`, `docs/zh/00-code-map.md`

- [ ] **Step 1:** Add a row or bullet under “Jump to implementation” or a new **External** mini-table:

| Link | Purpose |
|------|---------|
| https://github.com/anthropics/claude-code | Official OSS: plugins, examples |
| https://code.claude.com/docs/en/overview | Product behavior / setup |

- [ ] **Step 2:** Commit

```bash
git add docs/00-code-map.md docs/zh/00-code-map.md && git commit -m "docs: link code map to official claude-code and docs"
```

---

### Task 6: Website copy (English + zh.json only)

**Files:**
- Modify: `website/index.html`
- Modify: `website/i18n/zh.json`

- [ ] **Step 1:** In `index.html`, inside `#architecture` `.diagram-inner`, **after** `section-desc` (the line with `arch.desc`), add a **single** new `<p class="section-desc">` or reuse same class with **no new CSS** — English default text like:

```html
<p class="section-desc" style="margin-top:-0.5rem;">
  The public
  <a href="https://github.com/anthropics/claude-code" target="_blank" rel="noopener">anthropics/claude-code</a>
  repo ships plugins, examples, and tooling; the diagram below is a <strong>logical harness</strong> aligned with
  <a href="https://code.claude.com/docs/en/overview" target="_blank" rel="noopener">official Claude Code docs</a>
  and leak-era architecture discussion — see
  <a href="../docs/01-architecture.md">Architecture doc</a> for the full split.
</p>
```

**User preference was “don’t change styles” before** — avoid inline `style` if possible; if spacing looks tight, use only `margin-top` on existing token or omit margin.

**Revised snippet without inline style:**

```html
<p class="section-desc" data-i18n-html="true" data-i18n="arch.officialRepo">
  The public <a href="https://github.com/anthropics/claude-code" target="_blank" rel="noopener">anthropics/claude-code</a> repository provides plugins, examples, and related OSS; the layers below are a <strong>logical harness</strong>. See the <a href="../docs/01-architecture.md">architecture write-up</a> and <a href="https://code.claude.com/docs/en/overview" target="_blank" rel="noopener">official documentation</a> for how this maps to the shipped product.
</p>
```

- [ ] **Step 2:** Add `arch.officialRepo` (HTML string) to `website/i18n/zh.json` with Chinese translation + same three links.

- [ ] **Step 3:** Manual test: `cd website && npm start` → `index.html` EN + `?lang=zh` → paragraph renders, links work.

- [ ] **Step 4:** Commit

```bash
git add website/index.html website/i18n/zh.json && git commit -m "feat(website): link architecture section to official claude-code repo"
```

---

### Task 7: Optional — findings section disclaimer

**Files:**
- Modify: `website/index.html`, `website/i18n/zh.json` (find.* keys)

- [ ] **Step 1:** If you keep “From the Leaked Source” cards, add **one sentence** in `find.desc` (EN + zh) that line-scale claims are **not** derived from counting `anthropics/claude-code` files.

- [ ] **Step 2:** Commit

```bash
git add website/index.html website/i18n/zh.json && git commit -m "copy: clarify findings vs public repo"
```

---

### Task 8: Regression

- [ ] **Step 1:** `grep -r "46K\|29K" website/` — ensure each occurrence still has **methodology** nearby or footer link to `docs/methodology.md` if challenged.

- [ ] **Step 2:** Read `docs/01-architecture.md` on GitHub preview locally (or `npx markdown-preview`) for broken links.

---

## Plan review loop (@writing-plans)

1. Dispatch **plan-document-reviewer** with: this file path + user spec (“understand anthropics/claude-code, architecture intro too simple”).
2. Fix loop ≤3 iterations or escalate to human.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-04-official-claude-code-repo-architecture.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks. **REQUIRED SUB-SKILL:** @superpowers:subagent-driven-development  

**2. Inline Execution** — Run tasks in this session with checkpoints. **REQUIRED SUB-SKILL:** @superpowers:executing-plans  

**Which approach?**
