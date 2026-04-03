/**
 * Upstream navigation for architecture diagram hotspots.
 * Tiers: public (anthropics/claude-code), docs (product docs or harness-decoded docs),
 * example (this repo examples/), disclosure (leak-era / not in public OSS tree).
 */
(function () {
  var HD = "https://github.com/seanyoungw/harness-decoded/blob/main";
  var CC = "https://github.com/anthropics/claude-code/tree/main";

  window.CC_UPSTREAM = {
    "cc-plugins": {
      tier: "public",
      title: "Claude Code — plugins/",
      href: CC + "/plugins",
      hint: "Public OSS plugin packages (skills-style extensions).",
    },
    "cc-claude-commands": {
      tier: "public",
      title: "Claude Code — .claude/",
      href: CC + "/.claude",
      hint: "Slash-style commands and hooks shipped in the public repo.",
    },
    "cc-examples": {
      tier: "public",
      title: "Claude Code — examples/",
      href: CC + "/examples",
      hint: "Official integration and usage examples.",
    },
    "cc-scripts": {
      tier: "public",
      title: "Claude Code — scripts/",
      href: CC + "/scripts",
      hint: "Installer and automation scripts around the distributed CLI.",
    },
    "product-overview": {
      tier: "docs",
      title: "Claude Code — product overview",
      href: "https://code.claude.com/docs/en/overview",
      hint: "What the shipped product does (IDE, terminal, features).",
    },
    "product-setup": {
      tier: "docs",
      title: "Claude Code — setup",
      href: "https://code.claude.com/docs/en/setup",
      hint: "Installers: curl, Homebrew, WinGet, etc.",
    },
    "doc-adr-003": {
      tier: "docs",
      title: "harness-decoded — ADR-003 compaction",
      href: HD + "/docs/adr/003-compaction-triggers.md",
      hint: "When and how compaction triggers in teaching harnesses.",
    },
    "doc-05-memory": {
      tier: "docs",
      title: "harness-decoded — Memory & context",
      href: HD + "/docs/05-memory-context.md",
      hint: "autoCompact, KAIROS, autoDream, checkpoints.",
    },
    "doc-04-query": {
      tier: "disclosure",
      title: "Query engine (~46K LOC — discourse scale)",
      href: HD + "/docs/04-query-engine.md",
      hint: "Not a path inside public anthropics/claude-code; see methodology.md.",
    },
    "doc-03-tools": {
      tier: "disclosure",
      title: "Tool system (~29K LOC — discourse scale)",
      href: HD + "/docs/03-tool-system.md",
      hint: "Teaching doc; proprietary tool surface is not fully in the public repo.",
    },
    "doc-06-multi": {
      tier: "docs",
      title: "harness-decoded — Multi-agent patterns",
      href: HD + "/docs/06-multi-agent.md",
      hint: "Fan-out, barriers, swarm, failure policies.",
    },
    "methodology": {
      tier: "docs",
      title: "Methodology — evidence tiers",
      href: HD + "/docs/methodology.md",
      hint: "How we label public vs reconstruction vs teaching simplification.",
    },
    "ex-minimal-memory": {
      tier: "example",
      title: "Python — minimal_agent (memory hooks)",
      href: HD + "/examples/python/minimal_agent/agent.py",
      hint: "Smallest teaching loop; compare MemorySystem patterns in docs.",
    },
    "ex-standard-parallel": {
      tier: "example",
      title: "Python — standard_agent (--parallel)",
      href: HD + "/examples/python/standard_agent/agent.py",
      hint: "Semaphore fan-out + synthesizer; teaching parallel harness.",
    },
    "ex-prod-swarm": {
      tier: "example",
      title: "Python — production_agent (--swarm)",
      href: HD + "/examples/python/production_agent/agent.py",
      hint: "Swarm cap, spawn_subagent-style orchestration (teaching).",
    },
    "compaction-pipeline": {
      tier: "docs",
      title: "Compaction trigger path",
      href: HD + "/docs/adr/003-compaction-triggers.md",
      hint: "Threshold → maybe_compact → summarize → checkpoint (teaching model).",
    },
    "kairos-fork": {
      tier: "disclosure",
      title: "KAIROS / idle consolidation",
      href: HD + "/docs/05-memory-context.md",
      hint: "Discussed as fork-isolated consolidation; not a public file path.",
    },
    "orchestrator-pattern": {
      tier: "example",
      title: "Orchestration in examples",
      href: HD + "/examples/python/standard_agent/agent.py",
      hint: "parallel_fan_out and session boundaries in standard_agent.",
    },
    "compact-estimate": {
      tier: "docs",
      title: "Token / context estimate",
      href: HD + "/docs/05-memory-context.md",
      hint: "Why fill ratio matters before summarization (teaching doc).",
    },
    "compact-threshold": {
      tier: "docs",
      title: "Threshold (~85%)",
      href: HD + "/docs/adr/003-compaction-triggers.md",
      hint: "ADR-003: when maybe_compact enters the path.",
    },
    "compact-maybe": {
      tier: "example",
      title: "maybe_compact (teaching)",
      href: HD + "/examples/python/minimal_agent/agent.py",
      hint: "Smallest harness loop; pair with MemorySystem discussion in doc 05.",
    },
    "compact-summarize": {
      tier: "docs",
      title: "LLM summarization pass",
      href: HD + "/docs/05-memory-context.md",
      hint: "Structured summary: task spec, progress, open questions.",
    },
    "compact-checkpoint": {
      tier: "docs",
      title: "Checkpoint raw history",
      href: HD + "/docs/05-memory-context.md",
      hint: "Persist messages before replace (recovery / audit).",
    },
    "compact-inject": {
      tier: "docs",
      title: "Inject summary into thread",
      href: HD + "/docs/05-memory-context.md",
      hint: "Prompt shrinks; downstream iterations cheaper.",
    },
    "multi-orch": {
      tier: "example",
      title: "Orchestrator + fan-out",
      href: HD + "/examples/python/standard_agent/agent.py",
      hint: "parallel_fan_out + concurrency cap.",
    },
    "multi-sub-harness": {
      tier: "example",
      title: "Fresh harness per subagent",
      href: HD + "/examples/python/standard_agent/agent.py",
      hint: "Avoid shared ToolRegistry / memory races (teaching pattern).",
    },
    "multi-barrier": {
      tier: "docs",
      title: "Barrier / gather",
      href: HD + "/docs/06-multi-agent.md",
      hint: "asyncio.gather-style merge before synthesis.",
    },
    "multi-swarm-cap": {
      tier: "example",
      title: "Swarm cap (production_agent)",
      href: HD + "/examples/python/production_agent/agent.py",
      hint: "max_agents-style limit in teaching production example.",
    },
    "tool-flow-doc": {
      tier: "docs",
      title: "Tool execution path",
      href: HD + "/docs/03-tool-system.md",
      hint: "Seven-step gauntlet (teaching narrative).",
    },
    "tool-step-1": {
      tier: "docs",
      title: "Step 1 — Tool lookup",
      href: HD + "/docs/03-tool-system.md",
      hint: "Registry resolution; unknown tool names fail closed.",
    },
    "tool-step-2": {
      tier: "docs",
      title: "Step 2 — Schema validation",
      href: HD + "/docs/adr/001-tools-as-data.md",
      hint: "Tools as data: schema before execute().",
    },
    "tool-step-3": {
      tier: "docs",
      title: "Step 3 — Permission check",
      href: HD + "/docs/03-tool-system.md",
      hint: "requiredPermissions ⊆ session grant set.",
    },
    "tool-step-4": {
      tier: "docs",
      title: "Step 4 — Approval gate",
      href: HD + "/docs/03-tool-system.md",
      hint: "Destructive operations pause for human.",
    },
    "tool-step-5": {
      tier: "example",
      title: "Step 5 — Sandboxed execution",
      href: HD + "/examples/python/standard_agent/agent.py",
      hint: "Bash / subprocess patterns in standard_agent.",
    },
    "tool-step-6": {
      tier: "docs",
      title: "Step 6 — Error classification",
      href: HD + "/docs/03-tool-system.md",
      hint: "Retryable vs fatal vs permission errors.",
    },
    "tool-step-7": {
      tier: "example",
      title: "Step 7 — Audit log",
      href: HD + "/examples/python/standard_agent/agent.py",
      hint: "JSONL audit trail in teaching agents.",
    },
  };
})();
