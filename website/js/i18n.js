(function () {
  var STORAGE = "harness-lang";
  var REPO = "https://github.com/seanyoungw/harness-decoded";

  function get(obj, path) {
    return path.split(".").reduce(function (o, k) {
      return o && o[k] !== undefined ? o[k] : null;
    }, obj);
  }

  function currentLang() {
    var q = new URLSearchParams(location.search).get("lang");
    if (q === "zh" || q === "en") return q;
    try {
      return localStorage.getItem(STORAGE) || "en";
    } catch (e) {
      return "en";
    }
  }

  function setStoredLang(lang) {
    try {
      localStorage.setItem(STORAGE, lang);
    } catch (e) { /* ignore */ }
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
  }

  function docsPrefix(zh) {
    var p = location.pathname;
    if (p.indexOf("/src/pages/") !== -1) return zh ? "../../../docs/zh/" : "../../../docs/";
    return zh ? "../docs/zh/" : "../docs/";
  }

  function applyDict(dict) {
    var cb = get(dict, "pages.compaction.below");
    if (cb) {
      window.__I18N_COMPACT = {
        below: cb,
        above: get(dict, "pages.compaction.above") || "",
      };
    } else {
      try {
        delete window.__I18N_COMPACT;
      } catch (e) { /* ignore */ }
    }

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var val = get(dict, key);
      if (val == null || val === "") return;
      if (el.getAttribute("data-i18n-html") === "true") el.innerHTML = val;
      else el.textContent = val;
    });
    document.querySelectorAll("a[data-doc]").forEach(function (el) {
      var name = el.getAttribute("data-doc");
      if (!name) return;
      el.href = docsPrefix(true) + name;
    });
  }

  function clearZhDocLinks() {
    document.querySelectorAll("a[data-doc]").forEach(function (el) {
      var name = el.getAttribute("data-doc");
      if (name) el.href = docsPrefix(false) + name;
    });
  }

  function updateLangSwitchUI() {
    var lang = currentLang();
    document.querySelectorAll(".lang-switch button[data-lang]").forEach(function (btn) {
      var isOn = btn.getAttribute("data-lang") === lang;
      btn.setAttribute("aria-current", isOn ? "true" : "false");
    });
  }

  function wireRepoLinks() {
    document.querySelectorAll("a[data-repo]").forEach(function (a) {
      var p = a.getAttribute("data-repo-path") || "";
      a.href = REPO + p;
    });
  }

  function zhJsonUrl() {
    var b = document.querySelector("base");
    if (b && b.href) {
      try {
        return new URL("i18n/zh.json", b.href).href;
      } catch (e) { /* ignore */ }
    }
    var p = location.pathname;
    if (p.indexOf("/src/pages/") !== -1) return "../../i18n/zh.json";
    return "i18n/zh.json";
  }

  function wireLangSwitch() {
    document.querySelectorAll(".lang-switch button[data-lang]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.getAttribute("data-lang");
        if (!target || target === currentLang()) return;
        setStoredLang(target);
        var url = new URL(location.href);
        url.searchParams.set("lang", target);
        location.href = url.toString();
      });
    });
  }

  function init() {
    var q = new URLSearchParams(location.search).get("lang");
    if (q === "zh" || q === "en") setStoredLang(q);

    if (currentLang() !== "zh") {
      try {
        delete window.__I18N_COMPACT;
      } catch (e) { /* ignore */ }
    }

    wireRepoLinks();
    wireLangSwitch();
    updateLangSwitchUI();

    if (currentLang() !== "zh") return;

    fetch(zhJsonUrl())
      .then(function (r) {
        return r.json();
      })
      .then(function (dict) {
        applyDict(dict);
        wireRepoLinks();
        updateLangSwitchUI();
      })
      .catch(function () {
        updateLangSwitchUI();
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
