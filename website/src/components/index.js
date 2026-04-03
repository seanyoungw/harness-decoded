/**
 * harness-decoded Web Components
 * Reusable custom elements used across all pages.
 *
 * Usage (in any HTML page):
 *   <script type="module" src="../src/components/index.js"></script>
 *
 *   <harness-layer name="Tool System" color="amber" lines="29K" tag="permission-gated">
 *     Detail text shown on expand...
 *   </harness-layer>
 *
 *   <tool-card name="BashTool" permission="SHELL_EXEC" risk="high">
 *     Executes shell commands in a sandboxed environment.
 *   </tool-card>
 *
 *   <code-block lang="python" label="agent.py">
 *     async def run(self, task): ...
 *   </code-block>
 *
 *   <metric-badge label="Lines" value="46K" color="blue"></metric-badge>
 *
 *   <timeline-step time="T+0:00" title="Session starts" type="session">
 *     Description of what happens at this step.
 *   </timeline-step>
 */

const CSS_VARS = `
  :host {
    --bg: #0a0a0f; --bg2: #11111a; --bg3: #1a1a28;
    --border: rgba(120,120,200,0.12);
    --border2: rgba(120,120,200,0.28);
    --text: #e2e2f0; --muted: #7070a0;
    --purple: #8b5cf6; --purple2: #a78bfa;
    --teal: #2dd4bf; --amber: #f59e0b;
    --coral: #f97316; --green: #34d399; --blue: #60a5fa;
    --font-mono: 'JetBrains Mono', monospace;
    --font-head: 'Syne', sans-serif;
    display: block;
  }
`;

const COLOR_MAP = {
  purple: '#8b5cf6', teal: '#2dd4bf', amber: '#f59e0b',
  coral:  '#f97316', green: '#34d399', blue:  '#60a5fa',
  gray:   '#7070a0', red:  '#f87171',
};

// ─────────────────────────────────────────────────────────
// <harness-layer>
// Expandable layer card for the architecture stack diagram
// ─────────────────────────────────────────────────────────
class HarnessLayer extends HTMLElement {
  connectedCallback() {
    const name  = this.getAttribute('name')  || 'Layer';
    const color = COLOR_MAP[this.getAttribute('color')] || COLOR_MAP.purple;
    const lines = this.getAttribute('lines') || '';
    const tag   = this.getAttribute('tag')   || '';
    const detail = this.innerHTML;
    this.innerHTML = '';

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        ${CSS_VARS}
        .layer {
          display: flex; align-items: stretch;
          border: 1px solid var(--border); border-radius: 8px;
          overflow: hidden; cursor: pointer;
          transition: border-color .2s, transform .2s;
          background: var(--bg3); margin-bottom: 3px;
          font-family: var(--font-mono);
        }
        .layer:hover { border-color: var(--border2); transform: translateX(4px); }
        .layer.active { border-color: ${color}; background: ${color}18; }
        .accent { width: 4px; background: ${color}; flex-shrink: 0; }
        .body { flex: 1; padding: 1.1rem 1.4rem; display: flex; align-items: center; gap: 1.5rem; }
        .name { font-family: var(--font-head); font-weight: 600; font-size: 14px;
                color: var(--text); min-width: 200px; }
        .desc { color: var(--muted); font-size: 12px; flex: 1; }
        .stat { font-size: 10px; padding: 2px 9px; border-radius: 100px;
                background: ${color}18; color: ${color}; border: 1px solid ${color}33;
                white-space: nowrap; }
        .detail { display: none; padding: 1.25rem 1.25rem 1.25rem 3.5rem;
                  background: rgba(0,0,0,0.25); border-top: 1px solid var(--border);
                  font-size: 12px; color: var(--muted); line-height: 1.9; }
        .detail.open { display: block; }
        .detail ::slotted(code), code {
          background: var(--bg); padding: 2px 6px; border-radius: 4px; color: var(--teal); font-size: 11px;
        }
        @media (max-width: 600px) { .body { flex-direction: column; align-items: flex-start; gap: .4rem; }
          .name { min-width: unset; } }
      </style>
      <div class="layer" id="layer">
        <div class="accent"></div>
        <div class="body">
          <div class="name">${name}</div>
          <div class="desc">${tag}</div>
          ${lines ? `<div class="stat">${lines}</div>` : ''}
        </div>
      </div>
      <div class="detail" id="detail"><slot></slot></div>
    `;

    shadow.getElementById('layer').addEventListener('click', () => {
      const d = shadow.getElementById('detail');
      const l = shadow.getElementById('layer');
      const open = d.classList.toggle('open');
      l.classList.toggle('active', open);
      this.dispatchEvent(new CustomEvent('toggle', { detail: { open }, bubbles: true }));
    });
  }
}
customElements.define('harness-layer', HarnessLayer);

// ─────────────────────────────────────────────────────────
// <tool-card>
// Card showing a tool's name, permission, risk level, description
// ─────────────────────────────────────────────────────────
class ToolCard extends HTMLElement {
  connectedCallback() {
    const name       = this.getAttribute('name')       || 'Tool';
    const permission = this.getAttribute('permission') || '';
    const risk       = this.getAttribute('risk')       || 'low';
    const category   = this.getAttribute('category')  || '';
    const detail     = this.innerHTML;
    this.innerHTML = '';

    const riskColor  = { low: '#34d399', medium: '#f59e0b', high: '#f97316', critical: '#f87171' };
    const rc = riskColor[risk] || riskColor.low;

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        ${CSS_VARS}
        :host { font-family: var(--font-mono); }
        .card {
          background: var(--bg2); border: 1px solid var(--border);
          border-radius: 10px; padding: 1.1rem 1.25rem;
          transition: border-color .2s, background .2s;
          height: 100%;
        }
        .card:hover { border-color: var(--border2); background: var(--bg3); }
        .head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: .5rem; }
        .name { font-family: var(--font-head); font-weight: 600; font-size: 14px; color: var(--text); }
        .risk { font-size: 10px; padding: 2px 8px; border-radius: 100px;
                background: ${rc}18; color: ${rc}; border: 1px solid ${rc}33; }
        .perm { font-size: 11px; color: var(--teal); margin-bottom: .5rem; font-family: var(--font-mono); }
        .cat  { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em;
                margin-bottom: .4rem; }
        .desc { font-size: 12px; color: var(--muted); line-height: 1.8; }
      </style>
      <div class="card">
        <div class="head">
          <div class="name">${name}</div>
          <div class="risk">${risk}</div>
        </div>
        ${category ? `<div class="cat">${category}</div>` : ''}
        ${permission ? `<div class="perm">requires: ${permission}</div>` : ''}
        <div class="desc"><slot></slot></div>
      </div>
    `;
  }
}
customElements.define('tool-card', ToolCard);

// ─────────────────────────────────────────────────────────
// <code-block>
// Syntax-highlighted code display with copy button
// ─────────────────────────────────────────────────────────
class CodeBlock extends HTMLElement {
  connectedCallback() {
    const lang  = this.getAttribute('lang')  || 'python';
    const label = this.getAttribute('label') || lang;
    const raw   = this.textContent.trim();
    this.innerHTML = '';

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        ${CSS_VARS}
        :host { font-family: var(--font-mono); display: block; }
        .wrap { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
        .header {
          display: flex; align-items: center; justify-content: space-between;
          padding: .6rem 1rem; background: var(--bg2);
          border-bottom: 1px solid var(--border); font-size: 12px;
        }
        .dots { display: flex; gap: 5px; }
        .dot  { width: 9px; height: 9px; border-radius: 50%; }
        .label { color: var(--muted); font-size: 11px; }
        .copy  {
          background: transparent; border: 1px solid var(--border);
          color: var(--muted); font-family: var(--font-mono); font-size: 10px;
          padding: 2px 8px; border-radius: 4px; cursor: pointer; transition: all .15s;
        }
        .copy:hover { border-color: var(--border2); color: var(--text); }
        pre {
          margin: 0; padding: 1.25rem; background: var(--bg);
          font-size: 12px; line-height: 1.8; color: var(--muted);
          overflow-x: auto; white-space: pre;
        }
        .kw  { color: #a78bfa; } .fn  { color: #60a5fa; }
        .str { color: #34d399; } .cm  { color: #3a3a5a; font-style: italic; }
        .hl  { color: #e2e2f0; } .num { color: #f59e0b; }
      </style>
      <div class="wrap">
        <div class="header">
          <div style="display:flex;align-items:center;gap:.75rem">
            <div class="dots">
              <div class="dot" style="background:#f87171"></div>
              <div class="dot" style="background:#f59e0b"></div>
              <div class="dot" style="background:#34d399"></div>
            </div>
            <span class="label">${label}</span>
          </div>
          <button class="copy" id="copy-btn">copy</button>
        </div>
        <pre id="code-pre">${this._highlight(raw, lang)}</pre>
      </div>
    `;

    shadow.getElementById('copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(raw).then(() => {
        const btn = shadow.getElementById('copy-btn');
        btn.textContent = 'copied!';
        setTimeout(() => btn.textContent = 'copy', 1500);
      });
    });
  }

  _highlight(code, lang) {
    // Simple token-based highlighting
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let html = esc(code);

    if (lang === 'python' || lang === 'py') {
      html = html
        .replace(/(#[^\n]*)/g, '<span class="cm">$1</span>')
        .replace(/\b(async|await|def|class|import|from|if|else|elif|for|while|return|raise|try|except|with|as|not|in|and|or|is|None|True|False|self|pass|yield)\b/g, '<span class="kw">$1</span>')
        .replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')/g, '<span class="str">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>');
    } else if (lang === 'typescript' || lang === 'ts' || lang === 'javascript' || lang === 'js') {
      html = html
        .replace(/(\/\/[^\n]*)/g, '<span class="cm">$1</span>')
        .replace(/\b(async|await|const|let|var|function|class|import|export|from|if|else|for|while|return|throw|try|catch|new|this|extends|implements|interface|type|enum|readonly|private|public|protected|static|default|void|null|undefined|true|false)\b/g, '<span class="kw">$1</span>')
        .replace(/(`[^`]*`|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')/g, '<span class="str">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>');
    } else if (lang === 'bash' || lang === 'sh') {
      html = html
        .replace(/(#[^\n]*)/g, '<span class="cm">$1</span>')
        .replace(/\b(export|source|echo|cd|ls|mkdir|rm|cp|mv|cat|grep|find|pip|npm|git|python|node)\b/g, '<span class="kw">$1</span>')
        .replace(/("[^"]*"|'[^']*')/g, '<span class="str">$1</span>');
    }
    return html;
  }
}
customElements.define('code-block', CodeBlock);

// ─────────────────────────────────────────────────────────
// <metric-badge>
// Small stat badge: label + large value
// ─────────────────────────────────────────────────────────
class MetricBadge extends HTMLElement {
  static get observedAttributes() {
    return ['label', 'value', 'sub', 'color'];
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  _render() {
    const label = this.getAttribute('label') || '';
    const value = this.getAttribute('value') || '';
    const color = COLOR_MAP[this.getAttribute('color')] || COLOR_MAP.purple;
    const sub = this.getAttribute('sub') || '';

    const shadow = this.shadowRoot || this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        ${CSS_VARS}
        :host { display: inline-block; font-family: var(--font-mono); }
        .badge {
          background: ${color}10; border: 1px solid ${color}28;
          border-radius: 10px; padding: .9rem 1.25rem;
          text-align: center; min-width: 100px;
        }
        .label { font-size: 10px; color: var(--muted); text-transform: uppercase;
                 letter-spacing: .1em; margin-bottom: .3rem; }
        .value { font-family: var(--font-head); font-size: 1.6rem; font-weight: 800;
                 color: ${color}; line-height: 1; }
        .sub   { font-size: 10px; color: var(--muted); margin-top: .3rem; }
      </style>
      <div class="badge">
        <div class="label">${label}</div>
        <div class="value">${value}</div>
        ${sub ? `<div class="sub">${sub}</div>` : ''}
      </div>
    `;
  }
}
customElements.define('metric-badge', MetricBadge);

// ─────────────────────────────────────────────────────────
// <timeline-step>
// Expandable step in a vertical timeline
// ─────────────────────────────────────────────────────────
class TimelineStep extends HTMLElement {
  connectedCallback() {
    const time  = this.getAttribute('time')  || '';
    const title = this.getAttribute('title') || '';
    const type  = this.getAttribute('type')  || 'session';
    const sub   = this.getAttribute('sub')   || '';
    const detail = this.innerHTML;
    this.innerHTML = '';

    const typeColor = {
      session: COLOR_MAP.teal, process: COLOR_MAP.purple,
      output: COLOR_MAP.amber, error: COLOR_MAP.red, default: COLOR_MAP.gray,
    };
    const tc = typeColor[type] || typeColor.default;

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        ${CSS_VARS}
        :host { display: block; font-family: var(--font-mono); }
        .row { display: grid; grid-template-columns: 100px 1fr; gap: 1.5rem; }
        .time { text-align: right; font-size: 10px; color: var(--muted);
                padding-top: 1rem; letter-spacing: .05em; white-space: nowrap; }
        .event {
          position: relative; padding: .9rem 1.1rem .9rem 1.4rem;
          border: 1px solid ${tc}28; border-radius: 8px; background: var(--bg2);
          margin-bottom: 5px; cursor: pointer; transition: border-color .15s;
        }
        .event::before {
          content: ''; position: absolute; left: -1.48rem; top: 1.05rem;
          width: 9px; height: 9px; border-radius: 50%;
          border: 2px solid ${tc}44; background: var(--bg); transition: all .2s;
        }
        .event:hover { border-color: ${tc}55; }
        .event.open  { border-color: ${tc}; background: ${tc}08; }
        .event.open::before { background: ${tc}; border-color: ${tc}; box-shadow: 0 0 7px ${tc}55; }
        .title { font-weight: 500; font-size: 13px; color: var(--text); margin-bottom: 2px; }
        .sub   { font-size: 11px; color: var(--muted); }
        .body  { display: none; margin-top: .65rem; padding-top: .65rem;
                 border-top: 1px solid var(--border); font-size: 12px;
                 color: var(--muted); line-height: 1.9; }
        .body.open { display: block; }
        @media (max-width: 500px) { .row { grid-template-columns: 70px 1fr; gap: .75rem; } }
      </style>
      <div class="row">
        <div class="time">${time}</div>
        <div class="event" id="ev">
          <div class="title">${title}</div>
          ${sub ? `<div class="sub">${sub}</div>` : ''}
          <div class="body" id="body"><slot></slot></div>
        </div>
      </div>
    `;

    shadow.getElementById('ev').addEventListener('click', () => {
      const ev   = shadow.getElementById('ev');
      const body = shadow.getElementById('body');
      const open = body.classList.toggle('open');
      ev.classList.toggle('open', open);
    });
  }
}
customElements.define('timeline-step', TimelineStep);

// ─────────────────────────────────────────────────────────
// <section-hero>
// Page hero block: eyebrow + h1 + description
// ─────────────────────────────────────────────────────────
class SectionHero extends HTMLElement {
  connectedCallback() {
    const eyebrow = this.getAttribute('eyebrow') || '';
    const title   = this.getAttribute('title')   || '';
    const color   = COLOR_MAP[this.getAttribute('color')] || COLOR_MAP.purple;
    const desc    = this.innerHTML;
    this.innerHTML = '';

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        ${CSS_VARS}
        :host { display: block; font-family: var(--font-mono); }
        .hero { padding: 7rem 0 3rem; max-width: 820px; }
        .eye  { font-size: 11px; letter-spacing: .2em; color: ${color};
                text-transform: uppercase; margin-bottom: .9rem; }
        h1    { font-family: var(--font-head); font-size: clamp(2.4rem,5vw,4rem);
                font-weight: 800; line-height: .95; letter-spacing: -.02em;
                margin-bottom: 1.25rem; color: var(--text); }
        .desc { color: var(--muted); font-size: 14px; line-height: 1.9; max-width: 540px; }
      </style>
      <div class="hero">
        ${eyebrow ? `<p class="eye">${eyebrow}</p>` : ''}
        <h1>${title}</h1>
        <div class="desc"><slot></slot></div>
      </div>
    `;
  }
}
customElements.define('section-hero', SectionHero);
