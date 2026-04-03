(function () {
  var THRESH = 85;
  var EN_BELOW =
    "<strong>Below threshold.</strong> Full message history stays in the prompt. Token cost still compounds each turn — watch the lifecycle page token chart.";
  var EN_ABOVE =
    "<strong>Compaction path.</strong> Harness summarizes older turns into a structured block (task spec, progress, open questions). Checkpoints may be written to disk before summarization.";

  function render() {
    var fill = document.getElementById("fill");
    var num = document.getElementById("num");
    var bar = document.getElementById("bar");
    var state = document.getElementById("state");
    if (!fill || !num || !bar || !state) return;
    var v = +fill.value;
    num.textContent = String(v);
    bar.style.width = v + "%";
    var zh = window.__I18N_COMPACT;
    var useZh = zh && document.documentElement.lang === "zh-Hans";
    if (v < THRESH) {
      state.className = "state";
      state.innerHTML = useZh ? zh.below : EN_BELOW;
    } else {
      state.className = "state compact";
      state.innerHTML = useZh ? zh.above : EN_ABOVE;
    }
  }

  function init() {
    var fill = document.getElementById("fill");
    if (!fill) return;
    fill.addEventListener("input", render);
    document.addEventListener("i18n-applied", render);
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
