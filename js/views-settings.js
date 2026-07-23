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
    if (!(remaining > 0)) return { plates: [], leftover: 0, ok: false, target: 0 };

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
    return {
      plates: used,
      leftover,
      ok: leftover < 0.001,
      target: Math.round(Number(targetKg) * 1000) / 1000,
    };
  }

  function formatLoadNum(kg, unit) {
    if (unit === "lb") return String(+(kg * KG_TO_LB).toFixed(1));
    const n = +Number(kg).toFixed(2);
    return Number.isInteger(n) ? String(n) : String(n);
  }

  function formatCombo(result, unit) {
    const unitLabel = unit === "lb" ? "lb" : "kg";
    if (!result.target || result.target <= 0) {
      return '<p class="muted small" style="margin:0">Enter the load hanging on the belt.</p>';
    }

    const loadNum = formatLoadNum(result.target, unit);
    const statusClass = result.ok ? "text-green" : "text-amber";
    const statusText = result.ok
      ? "Exact stack"
      : `Short ${formatLoadNum(result.leftover, unit)} ${unitLabel}`;

    const hero = `
      <div style="text-align:center;padding:8px 0 14px">
        <div class="muted small" style="text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:6px">Belt total</div>
        <div style="font-family:var(--font-load);font-weight:800;font-size:2.4rem;line-height:1;letter-spacing:-0.03em;font-variant-numeric:tabular-nums">
          +${esc(loadNum)}
          <span style="font-size:0.95rem;font-weight:700;color:var(--text-dim);margin-left:4px">${esc(unitLabel)}</span>
        </div>
        <div class="small ${statusClass}" style="margin-top:8px;font-weight:600">${esc(statusText)}</div>
      </div>
      <hr class="weld" style="margin:0 0 12px" />
    `;

    if (!result.plates.length) {
      return (
        hero +
        '<p class="muted small" style="margin:0">No standard plates fit that load. Try a rounder target.</p>'
      );
    }

    const plateTotalKg = result.plates.reduce((sum, x) => sum + x.plate * x.count, 0);
    const lines = result.plates.map(
      (x) =>
        `<div class="spread" style="padding:8px 0;border-bottom:1px solid var(--border);min-height:var(--touch);align-items:center">
          <span style="font-weight:600">${esc(x.plate)} <span class="muted">kg</span> × ${esc(x.count)}</span>
          <span class="muted" style="font-variant-numeric:tabular-nums">${esc(+(x.plate * x.count).toFixed(2))} kg</span>
        </div>`
    );

    let footer = "";
    if (result.ok) {
      footer = `<p class="small muted" style="margin-top:12px">Load largest first — ${esc(formatLoadNum(plateTotalKg, "kg"))} kg on the carabiner.</p>`;
    } else {
      footer = `<p class="small text-amber" style="margin-top:12px">Leftover ${esc(formatLoadNum(result.leftover, "kg"))} kg — add fractionals or round the target.</p>`;
    }

    return (
      hero +
      `<div class="muted small" style="text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:4px">Stack</div>` +
      lines.join("") +
      footer
    );
  }

  function toast(msg) {
    const prev = document.querySelector(".toast");
    if (prev) prev.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 2200);
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
        toast(btn.getAttribute("data-unit") === "lb" ? "Display: lb" : "Display: kg");
        SL.refresh();
      });
    });

    const restInput = root.querySelector("#set-rest");
    if (restInput) {
      restInput.addEventListener("change", () => {
        const n = Math.max(0, Math.round(Number(restInput.value) || 0));
        patchSettings({ restSeconds: n });
        restInput.value = String(n);
        toast(n ? `Rest set to ${n}s` : "Rest timer off");
      });
    }

    const bwInput = root.querySelector("#set-bw");
    if (bwInput) {
      bwInput.addEventListener("change", () => {
        const kg = displayToKg(bwInput.value, unit);
        patchSettings({ bodyweightKg: kg });
        if (kg != null) {
          bwInput.value = String(kgToDisplay(kg, unit));
          toast("Bodyweight saved");
        } else {
          bwInput.value = "";
          toast("Bodyweight cleared");
        }
      });
    }

    const plateTarget = root.querySelector("#plate-target");
    const plateOut = root.querySelector("#plate-out");
    const calcBtn = root.querySelector("#plate-calc");

    function runPlateCalc() {
      if (!plateOut) return;
      const raw = plateTarget ? plateTarget.value : "";
      if (raw === "" || raw == null) {
        plateOut.innerHTML =
          '<p class="muted small" style="margin:0">Enter the load hanging on the belt.</p>';
        return;
      }
      let target = Number(raw);
      if (Number.isNaN(target)) {
        plateOut.innerHTML =
          '<p class="muted small" style="margin:0">Enter a number for belt load.</p>';
        return;
      }
      if (unit === "lb") target = target / KG_TO_LB;
      plateOut.innerHTML = formatCombo(plateCombo(target), unit);
    }

    if (calcBtn) calcBtn.addEventListener("click", runPlateCalc);
    if (plateTarget) {
      plateTarget.addEventListener("input", runPlateCalc);
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
          toast("Export ready");
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
          toast("Import complete");
          SL.refresh();
        } catch (err) {
          toast("Import failed — check JSON");
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
            toast("Import complete");
            SL.refresh();
          } catch (err) {
            toast("Import failed — check JSON");
          }
        };
        reader.onerror = () => toast("Could not read file");
        reader.readAsText(file);
      });
    }

    const resetBtn = root.querySelector("#reset-all");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const ok = window.confirm(
          "Wipe all Streetlifting data?\n\nPrograms, sessions, custom exercises, and settings will be cleared. This cannot be undone."
        );
        if (!ok) return;
        SL.store.reset();
        toast("Data wiped");
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
      const plateList = PLATES.join(" · ");

      rootEl.innerHTML = `
        <div class="card">
          <h2>Display</h2>
          <p class="muted small" style="margin-bottom:10px">Loads stay stored in kg. Switch display only.</p>
          <div class="chip-row" style="margin-bottom:0">
            <button type="button" class="chip ${unit === "kg" ? "active" : ""}" data-unit="kg" aria-pressed="${unit === "kg"}">kg</button>
            <button type="button" class="chip ${unit === "lb" ? "active" : ""}" data-unit="lb" aria-pressed="${unit === "lb"}">lb</button>
          </div>
        </div>

        <div class="card">
          <h2>Session defaults</h2>
          <label class="field">
            <span class="lbl">Rest between sets (seconds)</span>
            <input id="set-rest" type="number" min="0" step="15" value="${esc(rest)}" inputmode="numeric" />
          </label>
          <label class="field" style="margin-bottom:0">
            <span class="lbl">Default bodyweight (${esc(unitLabel)})</span>
            <input id="set-bw" type="number" min="0" step="0.1" value="${esc(bwDisplay)}" placeholder="e.g. 75" inputmode="decimal" />
          </label>
        </div>

        <div class="card">
          <h2>Belt load</h2>
          <p class="muted small" style="margin-bottom:10px">
            Target = total hanging on the dip belt. Stack from ${esc(plateList)}&nbsp;kg plates.
          </p>
          <label class="field">
            <span class="lbl">Target load (${esc(unitLabel)})</span>
            <input id="plate-target" type="number" min="0" step="0.25" placeholder="e.g. 40" inputmode="decimal" />
          </label>
          <button type="button" class="btn block" id="plate-calc">Build stack</button>
          <div id="plate-out" style="margin-top:14px">
            <p class="muted small" style="margin:0">Enter the load hanging on the belt.</p>
          </div>
        </div>

        <div class="card">
          <h2>Backup</h2>
          <p class="muted small" style="margin-bottom:12px">Take a copy before you wipe or switch devices.</p>
          <button type="button" class="btn block" id="export-json">Export JSON</button>
          <hr class="weld" />
          <label class="field">
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
          <p class="muted small" style="margin-bottom:12px">Clears programs, sessions, and settings on this device.</p>
          <button type="button" class="btn danger block" id="reset-all">Wipe all data</button>
        </div>
      `;

      bind(rootEl);

      if (TOP_TABS.has((SL.app && SL.app.currentTab) || "settings")) {
        const back = document.getElementById("back-btn");
        if (back) back.classList.add("hidden");
      }
    },
  };
})();
