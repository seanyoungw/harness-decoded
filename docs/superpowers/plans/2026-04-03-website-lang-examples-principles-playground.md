# Website: Lang Switch, Example Links, Interactive Principles & Playground — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bordered language toggles with minimal `en` / `zh` text controls; fix Python/TypeScript example links that 404 under local `website` dev server; make `principles.html` demos user-driven (not CSS-only); extend `playground.html` with a complete-feeling flow beyond drag-and-drop.

**Architecture:** Centralize language UI behavior in `website/js/i18n.js` + shared `website/css/lang-switch.css`. Fix example URLs via existing `data-repo` / `data-repo-path` pattern in `i18n.js` (`wireRepoLinks`). Add `website/js/principles-interactive.js` for step-based / click-driven demos. Extend `playground.html` with an SVG overlay for edges, a deterministic topology sort + “Simulate flow” stepped highlight, and optional validation messages.

**Tech Stack:** Static HTML/CSS/ES5–ES6 vanilla JS (no bundler), `serve` for local preview, GitHub Pages path rules via existing `site-base.js`.

---

## File map (create / modify)

| File | Responsibility |
|------|------------------|
| **Create** `website/css/lang-switch.css` | Shared `.lang-switch` text controls: no border, no extra margin/padding on `nav`, `en`/`zh` as inline text buttons, active state |
| **Modify** `website/js/i18n.js` | Wire `en`/`zh` controls; drop single `#lang-toggle`; keep `?lang=` + `localStorage`; update `updateToggleButton` → `updateLangSwitchUI` |
| **Modify** `website/index.html` | `<link>` lang CSS; replace `<button id="lang-toggle">` with two `data-lang` controls inside `.lang-switch`; fix code section links with `data-repo` + `data-repo-path` |
| **Modify** `website/principles.html` | Lang switch markup + CSS link; footer example link → `data-repo`; add `<script src="js/principles-interactive.js">` |
| **Create** `website/js/principles-interactive.js` | Click/keyboard-driven loop, gate, compaction, fan-out (see tasks below) |
| **Modify** `website/compaction.html`, `kairos.html`, `playground.html` | Same lang markup + CSS link |
| **Modify** `website/src/pages/request-lifecycle.html`, `tool-system.html`, `multi-agent.html` | Same (paths: `../../css/lang-switch.css`, `../../js/i18n.js` already; CSS link relative to page) |
| **Modify** `website/playground.html` | SVG layer, simulation toolbar, extended JS (inline script block or **create** `website/js/playground-flow.js`) |

**Docs / tests to read first:** `website/js/site-base.js` (GitHub Pages `<base>`), `website/package.json` (local server roots at `website/` only — root cause of `../examples` 404).

**How to test:**  
- Local: `cd website && npm start` → open `http://127.0.0.1:5173/index.html` (HTTP only).  
- Expect: example links open GitHub blob (200), not `127.0.0.1/examples/...` (404).  
- GH Pages: open deployed `.../website/index.html`; lang switch + links still work with `<base>`.

---

### Task 1: Shared lang-switch stylesheet

**Files:**
- Create: `website/css/lang-switch.css`
- Modify: (none until Task 2 links it)

- [ ] **Step 1: Add CSS**

```css
/* Text-only en/zh switch — no box, minimal layout impact in nav */
.lang-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
  margin: 0;
  padding: 0;
  list-style: none;
}
.lang-switch button {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  font-size: 12px;
  color: var(--muted, #7070a0);
  cursor: pointer;
  text-decoration: none;
  line-height: inherit;
}
.lang-switch button:hover {
  color: var(--purple2, #a78bfa);
}
.lang-switch button[aria-current="true"] {
  color: var(--text, #e2e2f0);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.lang-switch .lang-sep {
  color: var(--muted, #7070a0);
  user-select: none;
  font-size: 12px;
}
```

- [ ] **Step 2: Commit**

```bash
git add website/css/lang-switch.css
git commit -m "feat(website): add text-only en/zh lang switch styles"
```

---

### Task 2: i18n.js — dual `en` / `zh` controls

**Files:**
- Modify: `website/js/i18n.js`

- [ ] **Step 1: Replace `updateToggleButton` + `wireToggle`**

Remove `getElementById("lang-toggle")`. Use:

```javascript
function setLang(lang) {
  if (lang !== "zh" && lang !== "en") return;
  setStoredLang(lang);
  location.search = "?lang=" + lang;
  location.reload();
}

function updateLangSwitchUI() {
  var lang = currentLang();
  document.querySelectorAll(".lang-switch button[data-lang]").forEach(function (btn) {
    var isOn = btn.getAttribute("data-lang") === lang;
    btn.setAttribute("aria-current", isOn ? "true" : "false");
  });
}

function wireLangSwitch() {
  document.querySelectorAll(".lang-switch button[data-lang]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-lang");
      if (target === currentLang()) return;
      setStoredLang(target);
      if (target === "en") {
        clearZhDocLinks();
      }
      location.search = "?lang=" + target;
      location.reload();
    });
  });
}
```

In `init()`, call `wireLangSwitch()` instead of `wireToggle()`, and `updateLangSwitchUI()` instead of `updateToggleButton()`. After `applyDict` on zh fetch, call `updateLangSwitchUI()`.

**Note:** Using `location.search = "?lang=…"; location.reload()` avoids duplicating fetch logic on click; `init()` already reads `?lang=` and loads `zh.json`.

- [ ] **Step 2: Manual check**

Open `principles.html` with two buttons; click `zh` → page reloads Chinese; click `en` → English; `aria-current` matches active language.

- [ ] **Step 3: Commit**

```bash
git add website/js/i18n.js
git commit -m "feat(website): wire en/zh text lang switch in i18n.js"
```

---

### Task 3: Apply lang markup + CSS link on all pages

**Files:**
- Modify: `website/index.html` (nav `<li>` block ~544)
- Modify: `website/principles.html` (~104)
- Modify: `website/compaction.html`, `kairos.html`, `playground.html`
- Modify: `website/src/pages/request-lifecycle.html`, `tool-system.html`, `multi-agent.html`

- [ ] **Step 1: HTML pattern (inside `<head>`, after fonts)**

```html
<link rel="stylesheet" href="css/lang-switch.css">
```

For `src/pages/*` use `../../css/lang-switch.css`.

- [ ] **Step 2: Replace single button with**

```html
<li class="lang-switch">
  <button type="button" data-lang="en" aria-label="English">en</button>
  <span class="lang-sep">/</span>
  <button type="button" data-lang="zh" aria-label="简体中文">zh</button>
</li>
```

On `playground.html` the switch lives in a `<div>` not `<ul>` — use `<span class="lang-switch">` (same CSS class) without `<li>`.

- [ ] **Step 3: Remove old `.nav-lang` rules** from each file’s `<style>` block (avoid duplicate/conflict with `lang-switch.css`).

- [ ] **Step 4: Commit**

```bash
git add website/index.html website/principles.html website/compaction.html website/kairos.html website/playground.html website/src/pages/*.html
git commit -m "feat(website): use en/zh text lang switch on all pages"
```

---

### Task 4: Fix Python / TypeScript example 404 (GitHub blob links)

**Root cause:** `npm start` serves **only** `website/`; `href="../examples/...` resolves to `http://127.0.0.1:5173/examples/...` which **does not exist** → 404. GitHub Pages with repo root published may work for `../examples`, but local dev never will without leaving `website/`.

**Files:**
- Modify: `website/index.html` (~882–884): `View full Python source` / `View full TypeScript source`
- Modify: `website/principles.html` (~167): `minimal_agent.py` footer link
- Optional: grep `../examples/` across `website/` and fix any other marketing links the same way

- [ ] **Step 1: Markup pattern** (reuse `wireRepoLinks` in `i18n.js`)

```html
<a
  class="btn btn-ghost"
  data-repo
  data-repo-path="/blob/main/examples/python/minimal_agent/agent.py"
  data-i18n="code.btnPy"
>View full Python source</a>
```

```html
<a
  class="btn btn-ghost"
  data-repo
  data-repo-path="/blob/main/examples/typescript/minimal-agent/agent.ts"
  data-i18n="code.btnTs"
>View full TypeScript source</a>
```

Footer:

```html
<a data-repo data-repo-path="/blob/main/examples/python/minimal_agent/agent.py">minimal_agent.py</a>
```

Confirm `REPO` in `i18n.js` is `https://github.com/seanyoungw/harness-decoded` (or your fork — single constant).

- [ ] **Step 2: Verify**

Run: `cd website && npm start`  
Open: `http://127.0.0.1:5173/index.html` → click both buttons → browser goes to `github.com/.../blob/main/examples/...` (200).

- [ ] **Step 3: Commit**

```bash
git add website/index.html website/principles.html
git commit -m "fix(website): point example source links to GitHub blob (local 404 fix)"
```

---

### Task 5: Interactive principles (`principles.html` + new JS)

**Files:**
- Create: `website/js/principles-interactive.js`
- Modify: `website/principles.html` — remove inline IIFE at bottom; add `<script src="js/principles-interactive.js" defer></script>`; add short hint text per demo; adjust CSS (pause infinite animations where replaced by classes)

**Behavior spec (YAGNI-friendly but clearly interactive):**

1. **Agent loop:** Remove `setInterval` cycling. On **click** any `.loop-node` or **ArrowRight**/**Space**: advance active index (wrap). Add small “Next step” link or rely on click tooltip in caption.
2. **Permission gate:** Remove auto `setInterval`. **Click** `#gate` toggles: closed (“checking…”) ↔ open (“granted”) + `#gateOk` visibility; **second mode**: add `Shift+click` or double-click to show “denied” state (gate stays closed, label “blocked — missing SHELL_EXEC”).
3. **Compaction:** Replace infinite CSS keyframe loop with **one-shot**: button “Run compaction” under caption; on click add class to collapse `.msg` opacity and show `.summary-bubble` with CSS transition (no new deps).
4. **Fan-out:** **Click** `.fan-hub`: cycle 0→3 visible workers (stagger opacity), click again reset; optional label “spawn subagent”.

- [ ] **Step 1: Implement `principles-interactive.js`** with exported IIFE attaching listeners on `DOMContentLoaded`.

- [ ] **Step 2: Update `zh.json`** if new visible strings (“Next”, “Run compaction”, “denied” copy) need `data-i18n` keys — prefer English default in HTML + zh keys under `pages.principles.*`.

- [ ] **Step 3: Commit**

```bash
git add website/js/principles-interactive.js website/principles.html website/i18n/zh.json
git commit -m "feat(website): interactive click-driven principles demos"
```

---

### Task 6: Playground — flow simulation + edges (complete the story)

**Files:**
- Create: `website/js/playground-flow.js` (recommended) **or** extend inline `<script>` in `playground.html` if keeping one file is required
- Modify: `playground.html` — HTML for SVG overlay + toolbar; CSS for `.flow-svg`, `.flow-edge`, `.sim-step`

**Minimum viable “complete flow” (incremental):**

- [ ] **Step 1: SVG `<svg id="flow-svg">` absolutely positioned over `#canvas`** (`pointer-events: none` for lines; `pointer-events: auto` only if you add draggable ports later). On `resize` / `mouseup` after drag, call `redrawEdges()`.

- [ ] **Step 2: Edge model:** For each pair of placed components, infer edges from **preset topology rules** (data-driven), e.g.  
  `harness → query`, `query → memory` (bidirectional optional), `harness → fanout|swarm`, `tool_* → audit`, `perms → tool_*`.  
  Draw quadratic or straight lines between component centers (getBoundingClientRect vs canvas).

- [ ] **Step 3: “Simulate flow” button** next to `generate`: disables during run; steps `t=0..n`: highlight current node + pulse related edges; labels in a small status strip: e.g. “1. IDE → Harness”, “2. Harness → QueryEngine”, “3. QueryEngine → Model”, “4. Tools → Audit”.  
  Use `setTimeout` chain or `async` IIFE; **Cancel** on `clearCanvas`.

- [ ] **Step 4: Validation (light):** If canvas has `BashTool` but no `PermissionSet`, show non-blocking warning in toolbar (“Add PermissionSet for realistic flow”).

- [ ] **Step 5: Commit**

```bash
git add website/playground.html website/js/playground-flow.js
git commit -m "feat(website): playground edges + simulate flow stepper"
```

---

### Task 7: Regression pass

- [ ] **Step 1:** Grep `lang-toggle` and `nav-lang` — expect **zero** matches.
- [ ] **Step 2:** Open each of the 9 HTML pages; confirm `en`/`zh` switch and no nav overflow on narrow width.
- [ ] **Step 3:** `index.html` + deployed GH Pages URL: confirm `<base>` + `data-repo` links still correct (absolute GitHub URLs unaffected by `<base>`).

- [ ] **Step 4: Commit** (if only doc/fixes)

```bash
git commit --allow-empty -m "chore(website): verify lang + links regression" || true
```

---

## Plan review loop (@writing-plans)

1. Dispatch a **plan-document-reviewer** subagent with: path to this file + link to user spec (four bullets).  
2. If issues: fix plan, re-run reviewer (max 3 loops; then ask human).  
3. If approved: hand off to implementation.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-03-website-lang-examples-principles-playground.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration. **REQUIRED SUB-SKILL:** @superpowers:subagent-driven-development  

**2. Inline Execution** — Run tasks in one session with checkpoints. **REQUIRED SUB-SKILL:** @superpowers:executing-plans  

**Which approach do you want?**
