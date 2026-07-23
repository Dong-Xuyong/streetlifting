/* Streetlifting — app orchestrator / tab router */
(() => {
  "use strict";

  const SL = (window.SL = window.SL || {});

  const TOP_TABS = ["home", "log", "history", "analytics", "program", "exercises", "settings"];

  let currentTab = "home";
  let pendingOpts = null;
  let showBack = false;

  const root = () => document.getElementById("view-root");
  const titleEl = () => document.getElementById("topbar-title");
  const metaEl = () => document.getElementById("topbar-meta");
  const backBtn = () => document.getElementById("back-btn");

  function resolveView(tab) {
    const views = SL.views || {};
    if (tab === "history") {
      return views.history || views.log || null;
    }
    return views[tab] || null;
  }

  function setActiveTabButton(tab) {
    document.querySelectorAll("#tabbar [data-tab]").forEach((btn) => {
      const t = btn.getAttribute("data-tab");
      btn.classList.toggle("active", t === tab);
    });
  }

  function updateChrome(view, tab) {
    const title = view && typeof view.title === "function" ? view.title() : tab;
    const h1 = titleEl();
    if (h1) h1.textContent = title || "Streetlifting";

    const meta = metaEl();
    if (meta) meta.textContent = "";

    const back = backBtn();
    if (back) {
      const topLevel = TOP_TABS.includes(tab) && !showBack;
      back.classList.toggle("hidden", topLevel);
    }
  }

  function paint() {
    const el = root();
    if (!el) return;

    const view = resolveView(currentTab);
    updateChrome(view, currentTab);
    setActiveTabButton(currentTab);

    if (!view || typeof view.render !== "function") {
      el.innerHTML = `<div class="empty"><p>View "${currentTab}" is not available yet.</p></div>`;
      return;
    }

    const opts = pendingOpts;
    pendingOpts = null;
    try {
      view.render(el, opts);
    } catch (err) {
      console.error("SL render error", currentTab, err);
      el.innerHTML = `<div class="empty"><p>Failed to render ${currentTab}.</p></div>`;
    }
  }

  function navigate(tab, opts) {
    if (!tab) return;
    currentTab = tab;
    pendingOpts = opts != null ? opts : null;
    showBack = !!(opts && opts.showBack);
    paint();
  }

  function refresh() {
    paint();
  }

  async function boot() {
    if (!SL.store) {
      console.error("SL.store missing — load js/store.js before app.js");
      const el = root();
      if (el) el.innerHTML = `<div class="empty"><p>Store failed to load.</p></div>`;
      return;
    }

    try {
      const maybe = SL.store.load();
      if (maybe && typeof maybe.then === "function") await maybe;
    } catch (err) {
      console.error("SL.store.load failed", err);
    }

    // Warm exercise catalog (builtins + custom) via store
    try {
      if (typeof SL.store.listExercises === "function") {
        const list = SL.store.listExercises();
        if (list && typeof list.then === "function") await list;
      }
    } catch (err) {
      console.warn("listExercises", err);
    }

    document.querySelectorAll("#tabbar [data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        navigate(tab);
      });
    });

    const back = backBtn();
    if (back) {
      back.addEventListener("click", () => {
        showBack = false;
        navigate("home");
      });
    }

    navigate(currentTab);
  }

  SL.navigate = navigate;
  SL.refresh = refresh;
  SL.app = {
    get currentTab() {
      return currentTab;
    },
    navigate,
    refresh,
  };

  document.addEventListener("DOMContentLoaded", () => {
    boot();
  });
})();
