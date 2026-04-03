(function () {
  var svg;
  var canvas;
  var getPlaced;
  var simTimer = null;

  function ns(name) {
    return document.createElementNS("http://www.w3.org/2000/svg", name);
  }

  function firstElOfType(type) {
    var list = getPlaced();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.type !== type) continue;
      var el = document.getElementById("comp-" + p.id);
      if (el) return el;
    }
    return null;
  }

  function redrawEdges() {
    if (!svg || !canvas || !getPlaced) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var crect = canvas.getBoundingClientRect();
    var w = Math.max(1, crect.width);
    var h = Math.max(1, crect.height);
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));

    function cx(el) {
      var r = el.getBoundingClientRect();
      return r.left - crect.left + r.width / 2;
    }
    function cy(el) {
      var r = el.getBoundingClientRect();
      return r.top - crect.top + r.height / 2;
    }
    function addLine(x1, y1, x2, y2) {
      var line = ns("line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", "rgba(120,120,200,0.35)");
      line.setAttribute("stroke-width", "2");
      svg.appendChild(line);
    }

    var hEl = firstElOfType("harness");
    var qEl = firstElOfType("query");
    var mEl = firstElOfType("memory");
    var audEl = firstElOfType("audit");
    if (hEl && qEl) addLine(cx(hEl), cy(hEl), cx(qEl), cy(qEl));
    if (qEl && mEl) addLine(cx(qEl), cy(qEl), cx(mEl), cy(mEl));

    getPlaced().forEach(function (p) {
      if (p.type.indexOf("tool_") !== 0 || !qEl) return;
      var el = document.getElementById("comp-" + p.id);
      if (el) addLine(cx(qEl), cy(qEl), cx(el), cy(el));
    });

    if (audEl) {
      getPlaced().forEach(function (p) {
        if (p.type.indexOf("tool_") !== 0) return;
        var el = document.getElementById("comp-" + p.id);
        if (el) addLine(cx(el), cy(el), cx(audEl), cy(audEl));
      });
    }

    var orch = firstElOfType("fanout") || firstElOfType("swarm");
    if (hEl && orch) addLine(cx(hEl), cy(hEl), cx(orch), cy(orch));
  }

  function clearPulse() {
    document.querySelectorAll(".placed-comp").forEach(function (e) {
      e.classList.remove("flow-pulse");
    });
  }

  function pulseType(stepId) {
    clearPulse();
    getPlaced().forEach(function (p) {
      var match =
        stepId === "tools"
          ? p.type.indexOf("tool_") === 0
          : p.type === stepId;
      if (!match) return;
      var el = document.getElementById("comp-" + p.id);
      if (el) el.classList.add("flow-pulse");
    });
  }

  function buildSimSteps() {
    var p = getPlaced();
    var steps = [];
    function has(t) {
      return p.some(function (x) {
        return x.type === t;
      });
    }
    if (has("harness")) steps.push({ id: "harness", label: "1 · Task enters AgentHarness" });
    if (has("query")) steps.push({ id: "query", label: "2 · QueryEngine calls LLM (stream + retry)" });
    if (has("memory")) steps.push({ id: "memory", label: "3 · MemorySystem threshold / compaction" });
    if (p.some(function (x) { return x.type.indexOf("tool_") === 0; }))
      steps.push({ id: "tools", label: "4 · Tools execute (PermissionSet + sandbox)" });
    if (has("audit")) steps.push({ id: "audit", label: "5 · AuditLog records invocation" });
    if (has("fanout")) steps.push({ id: "fanout", label: "6 · Parallel fan-out barrier" });
    if (has("swarm")) steps.push({ id: "swarm", label: "6 · Swarm spawn / aggregate" });
    if (steps.length === 0) steps.push({ id: "none", label: "Add components to see a harness flow" });
    return steps;
  }

  function stopSimulation() {
    if (simTimer) clearTimeout(simTimer);
    simTimer = null;
    clearPulse();
  }

  function runSimulation(statusEl) {
    stopSimulation();
    var steps = buildSimSteps();
    if (steps.length === 1 && steps[0].id === "none") {
      statusEl.textContent = steps[0].label;
      return;
    }
    var i = 0;
    function tick() {
      if (i >= steps.length) {
        statusEl.textContent = "Done — clear canvas or add parts to explore again";
        clearPulse();
        simTimer = null;
        return;
      }
      var s = steps[i];
      statusEl.textContent = s.label;
      pulseType(s.id);
      i++;
      simTimer = setTimeout(tick, 950);
    }
    tick();
  }

  function warnBashPerms(warnEl) {
    if (!warnEl || !getPlaced) return;
    var p = getPlaced();
    var bash = p.some(function (x) { return x.type === "tool_bash"; });
    var perms = p.some(function (x) { return x.type === "perms"; });
    warnEl.textContent =
      bash && !perms
        ? "Tip: add PermissionSet for a realistic gate with BashTool."
        : "";
  }

  window.PlaygroundFlow = {
    init: function (opts) {
      svg = opts.svg;
      canvas = opts.canvas;
      getPlaced = opts.getPlaced;
      window.addEventListener("resize", function () {
        requestAnimationFrame(redrawEdges);
      });
    },
    scheduleRedraw: function () {
      requestAnimationFrame(redrawEdges);
    },
    redrawEdges: redrawEdges,
    runSimulation: runSimulation,
    stopSimulation: stopSimulation,
    warnBashPerms: warnBashPerms,
    clearWarn: function (warnEl) {
      if (warnEl) warnEl.textContent = "";
    },
  };
})();
