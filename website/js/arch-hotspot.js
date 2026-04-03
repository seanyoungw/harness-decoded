/**
 * Binds .arch-hotspot[data-node] to CC_UPSTREAM entries; opens modal with tier + links.
 * Depends on cc-upstream-map.js (window.CC_UPSTREAM).
 */
(function () {
  function ensureModal() {
    var el = document.getElementById("arch-hotspot-modal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "arch-hotspot-modal";
    el.className = "arch-modal";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML =
      '<div class="arch-modal-panel" tabindex="-1">' +
      '<div class="arch-modal-tier" id="ah-tier"></div>' +
      '<div class="arch-modal-title" id="ah-title"></div>' +
      '<div class="arch-modal-hint" id="ah-hint"></div>' +
      '<div class="arch-modal-actions">' +
      '<a id="ah-primary" href="#" target="_blank" rel="noopener">Open ↗</a>' +
      '<button type="button" class="ghost" id="ah-close">Close</button>' +
      "</div></div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el) closeModal();
    });
    el.querySelector("#ah-close").addEventListener("click", closeModal);
    return el;
  }

  var lastFocus = null;

  function openModal(entry) {
    var map = window.CC_UPSTREAM || {};
    var modal = ensureModal();
    var tierEl = modal.querySelector("#ah-tier");
    var titleEl = modal.querySelector("#ah-title");
    var hintEl = modal.querySelector("#ah-hint");
    var linkEl = modal.querySelector("#ah-primary");
    if (!entry) {
      tierEl.textContent = "unknown";
      tierEl.className = "arch-modal-tier";
      titleEl.textContent = "No mapping";
      hintEl.textContent = "Missing CC_UPSTREAM entry for this node.";
      linkEl.style.display = "none";
    } else {
      var tier = entry.tier || "docs";
      tierEl.textContent = tier;
      tierEl.className = "arch-modal-tier " + tier;
      titleEl.textContent = entry.title || "";
      hintEl.textContent = entry.hint || "";
      if (entry.href) {
        linkEl.href = entry.href;
        linkEl.style.display = "";
        linkEl.textContent =
          tier === "public"
            ? "GitHub ↗"
            : tier === "example"
              ? "Example source ↗"
              : tier === "disclosure"
                ? "Teaching doc ↗"
                : "Open doc ↗";
      } else {
        linkEl.style.display = "none";
      }
    }
    lastFocus = document.activeElement;
    modal.classList.add("open");
    modal.querySelector(".arch-modal-panel").focus();
  }

  function closeModal() {
    var modal = document.getElementById("arch-hotspot-modal");
    if (modal) modal.classList.remove("open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === "Escape") closeModal();
  }

  window.initArchHotspots = function (root) {
    root = root || document;
    if (!window.CC_UPSTREAM) return;
    root.querySelectorAll(".arch-hotspot[data-node]").forEach(function (btn) {
      var id = btn.getAttribute("data-node");
      if (!id) return;
      if (btn.getAttribute("data-arch-bound") === "1") return;
      btn.setAttribute("data-arch-bound", "1");
      if (btn.tagName === "BUTTON") btn.setAttribute("type", "button");
      if (!btn.getAttribute("tabindex")) btn.setAttribute("tabindex", "0");
      if (!btn.getAttribute("aria-label")) btn.setAttribute("aria-label", "Upstream link: " + id);

      function activate() {
        openModal(window.CC_UPSTREAM[id]);
      }
      btn.addEventListener("click", activate);
      btn.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    });
    if (!window.__ARCH_HOTSPOT_KEY__) {
      window.__ARCH_HOTSPOT_KEY__ = true;
      document.addEventListener("keydown", onKey);
    }
  };
})();
