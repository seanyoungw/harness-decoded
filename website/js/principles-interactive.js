(function () {
  function initLoop() {
    var nodes = document.querySelectorAll(".loop-node");
    if (!nodes.length) return;
    var i = 0;
    function setActive(idx) {
      nodes.forEach(function (n, j) {
        n.classList.toggle("on", j === idx);
      });
      i = idx;
    }
    setActive(0);
    nodes.forEach(function (n, idx) {
      n.style.cursor = "pointer";
      n.addEventListener("click", function () {
        setActive(idx);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.code !== "Space" && e.code !== "ArrowRight") return;
      var t = e.target;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON") return;
      e.preventDefault();
      setActive((i + 1) % nodes.length);
    });
  }

  function initGate() {
    var gate = document.getElementById("gate");
    var lbl = document.getElementById("gateLbl");
    var ok = document.getElementById("gateOk");
    if (!gate) return;
    gate.style.cursor = "pointer";
    gate.addEventListener("click", function (e) {
      if (e.shiftKey) {
        gate.classList.remove("open");
        lbl.textContent = "blocked — missing SHELL_EXEC";
        ok.classList.remove("show");
        return;
      }
      if (gate.classList.contains("open")) {
        gate.classList.remove("open");
        lbl.textContent = "checking permissions…";
        ok.classList.remove("show");
      } else {
        gate.classList.add("open");
        lbl.textContent = "granted";
        ok.classList.add("show");
      }
    });
  }

  function initCompact() {
    var btn = document.getElementById("run-compact");
    var visual = document.querySelector(".compact-visual");
    if (!btn || !visual) return;
    var msgs = visual.querySelectorAll(".msg");
    var sum = visual.querySelector(".summary-bubble");
    btn.addEventListener("click", function () {
      msgs.forEach(function (m) {
        m.style.opacity = "0.2";
        m.style.transform = "translateX(80px) scale(0.65)";
      });
      if (sum) {
        sum.style.opacity = "1";
        sum.style.transform = "translateY(-50%) scale(1)";
      }
      btn.disabled = true;
      var zh = document.documentElement.lang && document.documentElement.lang.indexOf("zh") === 0;
      btn.textContent = zh ? "已压缩 — 刷新页面可重试" : "Compacted — reload page to reset";
    });
  }

  function initFan() {
    var hub = document.querySelector(".fan-hub");
    var workers = document.querySelectorAll(".fan-worker");
    if (!hub || !workers.length) return;
    var count = 0;
    hub.style.cursor = "pointer";
    hub.addEventListener("click", function () {
      count = (count + 1) % (workers.length + 1);
      workers.forEach(function (w, j) {
        w.classList.toggle("fan-visible", j < count);
      });
    });
  }

  function boot() {
    initLoop();
    initGate();
    initCompact();
    initFan();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
