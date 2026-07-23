/* Streetlifting — Settings view */
(() => {
  "use strict";

  const SL = (window.SL = window.SL || {});
  SL.views = SL.views || {};

  const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
  const KG_TO_LB = 2.2046226218;
  const TOP_TABS = new Set([
    "home",
    "log",
    "history",
    "analytics",
    "program",
    "exercises",
    "settings",
  ]);

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getSettings() {
    const data = SL.store.get();
    return data.settings || { unit: "kg", restSeconds: 180, bodyweightKg: null };
  }

  function patchSettings(partial) {
    const data = SL.store.get();
    data.settings = Object.assign({}, data.settings || {}, partial);
    SL.store.save();
  }

  function kgToDisplay(kg, unit) {
    if (kg == null || kg === "" || Number.isNaN(Number(kg))) return "";
    const n = Number(kg);
    return unit === "lb" ? +(n * KG_TO_LB).toFixed(1) : +n.toFixed(2);
  }

  function displayToKg(val, unit) {
    const n = Number(val);
    if (val === "" || Number.isNaN(n)) return null;
    return unit === "lb" ? n / KG_TO_LB : n;
  }

  /** Greedy plate combo summing to target kg (dip-belt total hanging weight). */
  function plateCombo(targetKg) {
    let remaining = Math.round(Number(targetKg) * 1000) / 1000;
    if (!(remaining > 0)) return { plates: [], leftover: 0, ok: false };

    const used = [];
    for (const p of PLATES) {
      let count = 0;
      while (remaining + 1e-9 >= p) {
        remaining = Math.round((remaining - p) * 1000) / 1000;
        count += 1;
      }
      if (count) used.push({ plate: p, count });
    }
    const leftover = Math.round(remaining * 1000) / 1000;
    return { plates: used, leftover, ok: leftover < 0.001 };
  }

  function formatCombo(result) {
    if (!result.plates.length && result.leftover === 0) {
      return '<p class="muted">Enter a target load above 0.</p>';
    }
    const lines = result.plates.map(
      (x) =>
        `<div class="spread" style="padding:6px 0;border-bottom:1px solid var(--border)">
          <span>${esc(x.plate)} kg × ${esc(x.count)}</span>
          <span class="muted">${esc(+(x.plate * x.count).toFixed(2))} kg</span>
        </div>`
    );
    let footer = "";
    if (result.ok) {
      footer = '<p class="small muted" style="margin-top:10px">Exact match for belt total.</p>';
    } else {
      footer = `<p class="small" style="margin-top:10px;color:var(--amber,#d9a038)">Leftover ${esc(result.leftover)} kg — add fractional plates or round.</p>`;
    }
    return lines.join("") + footer;
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function downloadJson(text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `streetlifting-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function bind(root) {
    const unit = getSettings().unit || "kg";

    root.querySelectorAll("[data-unit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        patchSettings({ unit: btn.getAttribute("data-unit") });
        SL.refresh();
      });
    });

    const restInput = root.querySelector("#set-rest");
    if (restInput) {
      restInput.addEventListener("change", () => {
        const n = Math.max(0, Math.round(Number(restInput.value) || 0));
        patchSettings({ restSeconds: n });
        restInput.value = String(n);
      });
    }

    const bwInput = root.querySelector("#set-bw");
    if (bwInput) {
      bwInput.addEventListener("change", () => {
        const kg = displayToKg(bwInput.value, unit);
        patchSettings({ bodyweightKg: kg });
        if (kg != null) bwInput.value = String(kgToDisplay(kg, unit));
        else bwInput.value = "";
      });
    }

    const plateTarget = root.querySelector("#plate-target");
    const plateOut = root.querySelector("#plate-out");
    const calcBtn = root.querySelector("#plate-calc");
    function runPlateCalc() {
      let target = Number(plateTarget.value);
      if (unit === "lb" && !Number.isNaN(target)) target = target / KG_TO_LB;
      plateOut.innerHTML = formatCombo(plateCombo(target));
    }
    if (calcBtn) calcBtn.addEventListener("click", runPlateCalc);
    if (plateTarget) {
      plateTarget.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          runPlateCalc();
        }
      });
    }

    const exportBtn = root.querySelector("#export-json");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        try {
          downloadJson(SL.store.exportJson());
          toast("Exported");
        } catch (err) {
          toast("Export failed");
        }
      });
    }

    const importArea = root.querySelector("#import-text");
    const importBtn = root.querySelector("#import-json");
    if (importBtn) {
      importBtn.addEventListener("click", () => {
        const raw = (importArea && importArea.value) || "";
        if (!raw.trim()) {
          toast("Paste JSON first");
          return;
        }
        try {
          SL.store.importJson(raw);
          toast("Imported");
          SL.refresh();
        } catch (err) {
          toast("Import failed");
        }
      });
    }

    const fileInput = root.querySelector("#import-file");
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            SL.store.importJson(String(reader.result || ""));
            toast("Imported from file");
            SL.refresh();
          } catch (err) {
            toast("Import failed");
          }
        };
        reader.readAsText(file);
      });
    }

    const resetBtn = root.querySelector("#reset-all");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const ok = window.confirm(
          "Reset all Streetlifting data? Programs, sessions, and settings will be wiped. This cannot be undone."
        );
        if (!ok) return;
        SL.store.reset();
        toast("Data reset");
        SL.refresh();
      });
    }
  }

  SL.views.settings = {
    title() {
      return "Settings";
    },

    render(rootEl) {
      const s = getSettings();
      const unit = s.unit === "lb" ? "lb" : "kg";
      const rest = s.restSeconds != null ? s.restSeconds : 180;
      const bwDisplay = kgToDisplay(s.bodyweightKg, unit);
      const unitLabel = unit === "lb" ? "lb" : "kg";

      rootEl.innerHTML = `
        <div class="card">
          <h2>Units</h2>
          <p class="muted small" style="margin-bottom:10px">Stored in kg; display converts when using lb.</p>
          <div class="chip-row">
            <button type="button" class="chip ${unit === "kg" ? "active" : ""}" data-unit="kg">kg</button>
            <button type="button" class="chip ${unit === "lb" ? "active" : ""}" data-unit="lb">lb</button>
          </div>
        </div>

        <div class="card">
          <h2>Defaults</h2>
          <label class="field">
            <span class="lbl">Rest timer (seconds)</span>
            <input id="set-rest" type="number" min="0" step="15" value="${esc(rest)}" />
          </label>
          <label class="field">
            <span class="lbl">Default bodyweight (${esc(unitLabel)})</span>
            <input id="set-bw" type="number" min="0" step="0.1" value="${esc(bwDisplay)}" placeholder="e.g. 75" />
          </label>
        </div>

        <div class="card">
          <h2>Plate calculator</h2>
          <p class="muted small" style="margin-bottom:10px">Dip belt = total hanging weight. Suggests a combination from ${esc(PLATES.join(", "))} kg.</p>
          <label class="field">
            <span class="lbl">Target load (${esc(unitLabel)})</span>
            <input id="plate-target" type="number" min="0" step="0.25" placeholder="e.g. 40" />
          </label>
          <button type="button" class="btn block" id="plate-calc">Calculate</button>
          <div id="plate-out" style="margin-top:12px"></div>
        </div>

        <div class="card">
          <h2>Backup</h2>
          <button type="button" class="btn block" id="export-json">Export JSON</button>
          <label class="field" style="margin-top:14px">
            <span class="lbl">Import from file</span>
            <input id="import-file" type="file" accept="application/json,.json" />
          </label>
          <label class="field">
            <span class="lbl">Or paste JSON</span>
            <textarea id="import-text" rows="5" placeholder='{"settings":...}'></textarea>
          </label>
          <button type="button" class="btn secondary block" id="import-json">Import JSON</button>
        </div>

        <div class="card">
          <h2>Danger zone</h2>
          <button type="button" class="btn danger block" id="reset-all">Reset all data</button>
        </div>
      `;

      bind(rootEl);

      // Keep top-level back hidden when landing here via tab
      if (TOP_TABS.has((SL.app && SL.app.currentTab) || "settings")) {
        const back = document.getElementById("back-btn");
        if (back) back.classList.add("hidden");
      }
    },
  };
})();
