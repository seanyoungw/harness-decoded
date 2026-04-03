# Website Deep Pages: i18n, Content, Diagrams & Upstream Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully localize compaction, request lifecycle, tool-system, and multi-agent pages to Chinese; substantially deepen compaction and multi-agent pages with systematic prose and diagrams; add interactive architecture diagrams whose regions link to **navigable upstream references** (public Claude Code repo, official docs, and harness-decoded examples), with explicit methodology when no public file exists.

**Architecture:** Keep English as HTML/JS defaults; extend `website/i18n/zh.json` for static strings and add **page-specific locale payloads** (JSON or `.js` globals) for large interactive data (e.g. lifecycle `STEPS` array). Introduce a **shared upstream link registry** (`website/js/cc-upstream-map.js` or JSON) keyed by diagram node id → `{ label, publicRepo?, docs?, example?, note? }` so SVG/HTML hotspots stay DRY. Refactor compaction and multi-agent pages to include **new sections** sourced from `docs/05-memory-context.md`, `docs/adr/003-compaction-triggers.md`, `docs/06-multi-agent.md`, and `docs/03-tool-system.md` (mirror `docs/zh/*` for zh copy). Diagrams: prefer **inline SVG** with `<a xlink:href>` or overlay `<button>`/`<a>` regions for a11y and deep-linking (`#diagram-compaction`).

**Tech Stack:** Static HTML, existing `website/js/i18n.js` (`lang=zh` fetch `zh.json`), optional new `fetch` for page bundles, vanilla JS, existing `website/src/components/` (`metric-badge`, `code-block`) where applicable. No new build tool required if using `.js` files that set `window.*`.

**Constraint (non-negotiable):** The public [anthropics/claude-code](https://github.com/anthropics/claude-code) tree is **not** the full proprietary CLI. Many “source” targets (e.g. internal query engine paths) **do not exist** there. Every diagram tooltip or sidebar must distinguish **(A)** real public GitHub path, **(B)** [code.claude.com](https://code.claude.com/docs/en/overview) doc section, **(C)** harness-decoded `examples/` teaching code, **(D)** “discussed in leak-era architecture / not in public tree — see [methodology.md](../../methodology.md)”. This matches [methodology.md](../../methodology.md) and the architecture doc clarifications already in repo.

---

## File map (create / modify)

| File | Responsibility |
|------|----------------|
| `website/i18n/zh.json` | New keys: `pages.requestLifecycle.*`, `pages.toolSystem.*`, `pages.multiAgent.*`, `pages.compaction.*` (extend), nav strings if needed |
| `website/js/cc-upstream-map.js` | **New.** Export `CC_UPSTREAM` object: nodeId → links + tier (public/docs/example/disclosure) |
| `website/js/arch-hotspot.js` | **New (optional).** Bind click on `.arch-hotspot[data-node]` to open panel or `window.open` primary URL |
| `website/css/arch-diagram.css` | **New (optional).** Shared styles for SVG containers, focus rings, legend |
| `website/compaction.html` | New sections + diagram + `data-i18n` / hotspot markup; widen layout if needed |
| `website/src/pages/request-lifecycle.html` | `data-i18n` on static chrome; STEPS moved to locale data; title `data-i18n` |
| `website/src/pages/tool-system.html` | Full zh coverage; optional diagram hotspots |
| `website/src/pages/multi-agent.html` | Major content expansion + system diagram + hotspots |
| `website/js/i18n.js` | Optionally: second fetch for `i18n/pages/<page>.zh.json` OR document pattern for `window` globals set before `applyDict` |
| `website/js/compaction-inline.js` | **New.** Extract inline script from `compaction.html`; read zh strings from dict to avoid duplication |
| `docs/methodology.md` (tiny) | One bullet: interactive diagrams may link to non-file disclosures |
| `docs/zh/methodology.md` | Mirror |

---

## Upstream link registry — schema (implement in Task block)

Each diagram node entry (example):

```javascript
// website/js/cc-upstream-map.js (illustrative — adjust paths after verifying repo tree)
window.CC_UPSTREAM = {
  "plugin-skill": {
    tier: "public",
    title: "Plugins / skills surface",
    href: "https://github.com/anthropics/claude-code/tree/main/plugins",
    hint: "Public OSS: plugin packages and agents."
  },
  "slash-commands": {
    tier: "public",
    title: ".claude commands",
    href: "https://github.com/anthropics/claude-code/tree/main/.claude",
    hint: "Declarative command hooks in the public repo."
  },
  "query-engine": {
    tier: "disclosure",
    title: "Query engine (internal scale)",
    href: "https://github.com/seanyoungw/harness-decoded/blob/main/docs/04-query-engine.md",
    hint: "Not browsable in public anthropics/claude-code; see methodology + doc 04."
  },
  "spawn-subagent-teach": {
    tier: "example",
    title: "spawn / fan-out (teaching)",
    href: "https://github.com/seanyoungw/harness-decoded/blob/main/examples/python/level2_parallel/agent.py",
    hint: "harness-decoded Level 2 parallel pattern."
  }
};
```

**Task before coding:** Grep [anthropics/claude-code](https://github.com/anthropics/claude-code) (or web) for **real** paths for: plugins, examples, hooks, scripts — only use verified URLs in `tier: "public"`.

---

### Task 1: Upstream registry + hotspot helper

**Files:**
- Create: `website/js/cc-upstream-map.js`
- Create: `website/js/arch-hotspot.js` (if not inlined per page)
- Modify: `website/js/i18n.js` (load `cc-upstream-map.js` before interactive pages — or include script tag on each page)

- [ ] **Step 1:** Inventory public Claude Code paths (plugins, `.claude`, `examples`, `scripts`) and doc URLs (setup, overview, tool use if any).
- [ ] **Step 2:** Implement `CC_UPSTREAM` with ≥12 nodes covering: IDE/bridge (docs or disclosure), orchestration (example L2/L3), memory/compaction (doc 05 + ADR-003 + disclosure), query engine (doc 04 disclosure), tools (doc 03 + plugin public where relevant), multi-agent (doc 06 + example).
- [ ] **Step 3:** `arch-hotspot.js`: on click, show small modal/panel with title, tier badge, primary link, secondary link; support keyboard (Enter on focused hotspot).
- [ ] **Step 4:** Commit: `feat(site): add upstream link registry for diagram hotspots`

---

### Task 2: Compaction page — content + architecture diagram

**Files:**
- Modify: `website/compaction.html`
- Create: `website/js/compaction-lab.js` (slider + state text; import strings from i18n)
- Modify: `website/i18n/zh.json` (`pages.compaction.*` extend)

**New sections (EN default in HTML, zh via i18n):**
1. **Subsystem map:** autoCompact vs KAIROS vs autoDream — table + short paragraphs (from doc 05).
2. **Trigger pipeline:** SVG or CSS diagram — states: estimate fill → threshold → maybe_compact → summarize → checkpoint → inject summary; hotspots linked via `CC_UPSTREAM`.
3. **Failure / guard narrative:** `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` (link doc 05 / finding card on index).
4. **Cross-links:** ADR-003, doc 05 zh/en, `kairos.html`, lifecycle page.

- [ ] **Step 1:** Add HTML sections with `data-i18n` / `data-i18n-html` for headings and body paragraphs.
- [ ] **Step 2:** Add diagram markup (SVG recommended) with clickable regions `class="arch-hotspot" data-node="..."`.
- [ ] **Step 3:** Add zh strings to `zh.json` under `pages.compaction.section1Title`, … (flatten or nest consistently with existing `pages.compaction`).
- [ ] **Step 4:** Move lab script to `compaction-lab.js`; ensure `__I18N_COMPACT` still works for below/above strings.
- [ ] **Step 5:** Manual test: `lang=zh` and `lang=en`, slider, each hotspot opens correct tier.
- [ ] **Step 6:** Commit: `feat(site): expand compaction lab with diagram and zh copy`

---

### Task 3: Multi-agent page — deep content + orchestration diagram

**Files:**
- Modify: `website/src/pages/multi-agent.html`
- Modify: `website/i18n/zh.json` (`pages.multiAgent.*` large block)

**New / expanded sections:**
1. **When to use** (keep decision cards) — add quantitative heuristic from `docs/zh/06-multi-agent.md` (>15 sequential calls).
2. **Pattern comparison table:** Sequential vs Fan-out vs Swarm — dimensions: concurrency, context isolation, barrier, dynamic spawn, failure modes.
3. **Failure strategies:** `ABORT_ON_FIRST` / `BEST_EFFORT` / `RETRY_FAILED` / `REQUIRE_ALL` — short examples.
4. **Swarm risks:** max_agents, coordination cost, context overlap ~30% rule.
5. **Architecture diagram:** Orchestrator at center, branches to sub-harnesses, barrier, optional recursive spawn; hotspots → `CC_UPSTREAM` (e.g. `examples/.../level3` or disclosure for spawn tool).
6. **metric-badge** / tab labels / all headings: `data-i18n` keys.

- [ ] **Step 1:** Add `data-i18n` to every user-visible string in hero, tabs, lists, failure cards.
- [ ] **Step 2:** Author zh translations in `zh.json` (may be 80–150 lines — acceptable).
- [ ] **Step 3:** Insert SVG diagram + include `cc-upstream-map.js` + `arch-hotspot.js`.
- [ ] **Step 4:** Commit: `feat(site): deepen multi-agent page with diagram, zh i18n, and upstream hotspots`

---

### Task 4: Request lifecycle — full i18n + optional diagram strip

**Files:**
- Modify: `website/src/pages/request-lifecycle.html`
- Create: `website/js/request-lifecycle-data.js` — `window.LIFECYCLE_STEPS = { en: [...], zh: [...] }` (mirror structure of current `STEPS`)
- Modify: `website/i18n/zh.json` — chrome strings: `docTitle`, `eyebrow`, `h1`, `heroDesc`, tracker section, `prev`/`next` buttons

- [ ] **Step 1:** Extract `STEPS` to `request-lifecycle-data.js` with full zh translations (all `title`, `desc`, `callout`, `code` — code may stay English with zh comment line optional).
- [ ] **Step 2:** Update renderer to pick locale from `document.documentElement.lang`.
- [ ] **Step 3:** Add `<title data-i18n="pages.requestLifecycle.docTitle">` and static section i18n.
- [ ] **Step 4 (optional):** Thin horizontal diagram above stepper: 8 nodes, each hotspot → `CC_UPSTREAM`; clicking sets `step(i)`.
- [ ] **Step 5:** Test all 8 steps in both languages.
- [ ] **Step 6:** Commit: `feat(site): localize request lifecycle page (en/zh data + chrome)`

---

### Task 5: Tool system page — full i18n + permission diagram hotspots

**Files:**
- Modify: `website/src/pages/tool-system.html`
- Modify: `website/i18n/zh.json` (`pages.toolSystem.*`)

- [ ] **Step 1:** Tag hero, flow section titles, tool cards, matrix headers, undercover section with `data-i18n` keys.
- [ ] **Step 2:** For `code-block` and `metric-badge` inner text: either wrap with i18n-friendly attributes or replace with plain HTML + `data-i18n` if components block translation (inspect `website/src/components/` — may need small component API to accept `label` from attribute).
- [ ] **Step 3:** Add hotspots on the seven-step flow diagram linking to doc 03 + examples (`examples/python/minimal_agent` tool registration) + public plugins if applicable.
- [ ] **Step 4:** zh.json translations.
- [ ] **Step 5:** Commit: `feat(site): localize tool system page and add upstream hotspots`

---

### Task 6: i18n infrastructure polish

**Files:**
- Modify: `website/js/i18n.js`

- [ ] **Step 1:** If `zh.json` exceeds maintainability (~300+ new lines), split to `website/i18n/pages/multi-agent.zh.json` and merge in `applyDict` after fetch (single Promise.all).
- [ ] **Step 2:** Document in `website/js/i18n.js` header comment: pattern for new pages.
- [ ] **Step 3:** Commit: `refactor(site): optional split zh page bundles for i18n`

---

### Task 7: Documentation + methodology cross-link

**Files:**
- Modify: `docs/methodology.md`, `docs/zh/methodology.md`

- [ ] **Step 1:** Add one short subsection: “Interactive site diagrams” — links may point to public repo, official docs, this repo’s examples, or disclosure tier when no public file exists.
- [ ] **Step 2:** Commit: `docs: note diagram upstream link tiers`

---

### Task 8: Verification

- [ ] **Step 1:** Grep for hardcoded English in the four pages’ main content (excluding code samples) — should be minimal when `lang=zh`.
- [ ] **Step 2:** Open each page with `?lang=zh` and `?lang=en`; verify no console errors, hotspots work, `data-doc` links still correct from `src/pages/` depth (`../../../docs/zh/`).
- [ ] **Step 3:** Run local static server if available (`python -m http.server` in `website/`) and smoke-test navigation from `index.html` nav.

---

## Testing commands (examples)

```bash
cd website && python3 -m http.server 8765
# Visit http://localhost:8765/compaction.html?lang=zh
# Visit http://localhost:8765/src/pages/multi-agent.html?lang=zh
```

Expected: Chinese UI strings; diagrams clickable; disclosure-tier nodes open panel with methodology-linked explanation, not a fake GitHub path.

---

## Plan review loop (optional)

Per writing-plans skill: dispatch plan-document-reviewer with this file + user spec; fix if ❌; max 3 iterations.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-03-website-deep-pages-i18n-diagrams-cc-links.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task above, review between tasks, fast iteration.  
**2. Inline Execution** — Run tasks sequentially in this session with checkpoints after Tasks 2–3–4.

**Which approach do you want?**
