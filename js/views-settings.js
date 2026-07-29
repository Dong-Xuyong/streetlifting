/* Streetlifting — Settings view */
(function () {
  "use strict";

  var SL = (window.SL = window.SL || {});
  SL.views = SL.views || {};

  var DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
  var KG_TO_LB = 2.2046226218;
  var MAX_WARNINGS_SHOWN = 8;
  var TOP_TABS = {
    home: true,
    log: true,
    history: true,
    analytics: true,
    program: true,
    exercises: true,
    settings: true,
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function storeOk() {
    return !!(SL.store && typeof SL.store.get === "function");
  }

  function getSettings() {
    if (!storeOk()) {
      return {
        unit: "kg",
        restSeconds: 180,
        bodyweightKg: null,
        autoStartRest: true,
        vibrate: true,
        plateStack: null,
      };
    }
    try {
      var data = SL.store.get();
      return (data && data.settings) || {
        unit: "kg",
        restSeconds: 180,
        bodyweightKg: null,
        autoStartRest: true,
        vibrate: true,
        plateStack: null,
      };
    } catch (e) {
      return {
        unit: "kg",
        restSeconds: 180,
        bodyweightKg: null,
        autoStartRest: true,
        vibrate: true,
        plateStack: null,
      };
    }
  }

  function mergeSettings(base, partial) {
    var out = {};
    var k;
    var src = base || {};
    for (k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
    partial = partial || {};
    for (k in partial) {
      if (Object.prototype.hasOwnProperty.call(partial, k)) out[k] = partial[k];
    }
    return out;
  }

  function patchSettings(partial) {
    if (!storeOk() || typeof SL.store.save !== "function") return;
    try {
      var data = SL.store.get();
      data.settings = mergeSettings(data.settings || {}, partial);
      SL.store.save();
    } catch (e) {
      /* ignore */
    }
  }

  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? "0" + s : s;
  }

  function refreshApp() {
    if (typeof SL.refresh === "function") SL.refresh();
  }

  function kgToDisplay(kg, unit) {
    if (kg == null || kg === "" || isNaN(Number(kg))) return "";
    var n = Number(kg);
    return unit === "lb" ? +(n * KG_TO_LB).toFixed(1) : +n.toFixed(2);
  }

  function displayToKg(val, unit) {
    var n = Number(val);
    if (val === "" || isNaN(n)) return null;
    return unit === "lb" ? n / KG_TO_LB : n;
  }

  function plateListKg() {
    var s = getSettings();
    if (s.plateStack && s.plateStack.length) {
      var copy = [];
      var i;
      for (i = 0; i < s.plateStack.length; i++) {
        var n = Number(s.plateStack[i]);
        if (isFinite(n) && n > 0) copy.push(n);
      }
      copy.sort(function (a, b) {
        return b - a;
      });
      if (copy.length) return copy;
    }
    return DEFAULT_PLATES.slice();
  }

  /** Greedy plate combo summing to target kg (dip-belt total hanging weight). */
  function plateCombo(targetKg) {
    var plates = plateListKg();
    var remaining = Math.round(Number(targetKg) * 1000) / 1000;
    if (!(remaining > 0)) return { plates: [], leftover: 0, ok: false, target: 0 };

    var used = [];
    var pi;
    for (pi = 0; pi < plates.length; pi++) {
      var p = plates[pi];
      var count = 0;
      while (remaining + 1e-9 >= p) {
        remaining = Math.round((remaining - p) * 1000) / 1000;
        count += 1;
      }
      if (count) used.push({ plate: p, count: count });
    }
    var leftover = Math.round(remaining * 1000) / 1000;
    return {
      plates: used,
      leftover: leftover,
      ok: leftover < 0.001,
      target: Math.round(Number(targetKg) * 1000) / 1000,
    };
  }

  function formatLoadNum(kg, unit) {
    if (unit === "lb") return String(+(kg * KG_TO_LB).toFixed(1));
    var n = +Number(kg).toFixed(2);
    return n === Math.floor(n) ? String(n) : String(n);
  }

  function formatCombo(result, unit) {
    var unitLabel = unit === "lb" ? "lb" : "kg";
    if (!result.target || result.target <= 0) {
      return '<p class="muted small">Enter the load hanging on the belt.</p>';
    }

    var loadNum = formatLoadNum(result.target, unit);
    var statusClass = result.ok ? "text-green" : "text-amber";
    var statusText = result.ok
      ? "Exact stack"
      : "Short " + formatLoadNum(result.leftover, unit) + " " + unitLabel;

    var hero =
      '<div class="data-plate-hero">' +
      '<div class="muted small data-plate-eyebrow">Belt total</div>' +
      '<div class="data-plate-load">+' +
      esc(loadNum) +
      ' <span class="data-plate-unit">' +
      esc(unitLabel) +
      "</span></div>" +
      '<div class="small ' +
      statusClass +
      ' data-plate-status">' +
      esc(statusText) +
      "</div>" +
      "</div>" +
      '<hr class="weld" />';

    if (!result.plates.length) {
      return (
        hero +
        '<p class="muted small">No standard plates fit that load. Try a rounder target.</p>'
      );
    }

    var plateTotalKg = 0;
    var lines = [];
    var i;
    for (i = 0; i < result.plates.length; i++) {
      var x = result.plates[i];
      plateTotalKg += x.plate * x.count;
      lines.push(
        '<div class="spread data-plate-line">' +
          "<span>" +
          esc(x.plate) +
          ' <span class="muted">kg</span> × ' +
          esc(x.count) +
          "</span>" +
          '<span class="muted">' +
          esc(+(x.plate * x.count).toFixed(2)) +
          " kg</span>" +
          "</div>"
      );
    }

    var footer = "";
    if (result.ok) {
      footer =
        '<p class="small muted data-plate-footer">Load largest first — ' +
        esc(formatLoadNum(plateTotalKg, "kg")) +
        " kg on the carabiner.</p>";
    } else {
      footer =
        '<p class="small text-amber data-plate-footer">Leftover ' +
        esc(formatLoadNum(result.leftover, "kg")) +
        " kg — add fractionals or round the target.</p>";
    }

    return (
      hero +
      '<div class="muted small data-plate-stack-label">Stack</div>' +
      lines.join("") +
      footer
    );
  }

  function toast(msg) {
    var prev = document.querySelector(".toast");
    if (prev) prev.remove();
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.remove();
    }, 2200);
  }

  function todayStamp() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function downloadBlob(text, mime, filename) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadJson(text) {
    downloadBlob(
      text,
      "application/json",
      "streetlifting-export-" + todayStamp() + ".json"
    );
  }

  function downloadCsv(text) {
    downloadBlob(text, "text/csv;charset=utf-8", "streetlifting-" + todayStamp() + ".csv");
  }

  function backupCounts() {
    if (SL.store && typeof SL.store.backupCounts === "function") {
      try {
        return SL.store.backupCounts();
      } catch (e) {
        /* fall through */
      }
    }
    if (!storeOk()) {
      return { programs: 0, sessions: 0, customExercises: 0 };
    }
    try {
      var s = SL.store.get();
      return {
        programs: (s.programs || []).length,
        sessions: (s.sessions || []).length,
        customExercises: (s.customExercises || []).length,
      };
    } catch (e2) {
      return { programs: 0, sessions: 0, customExercises: 0 };
    }
  }

  function formatBackupSummary(counts) {
    var c = counts || {};
    var programs = c.programs || 0;
    var sessions = c.sessions || 0;
    var custom = c.customExercises || 0;
    var parts = [
      programs === 1 ? "1 program" : programs + " programs",
      sessions === 1 ? "1 workout" : sessions + " workouts",
    ];
    if (custom) {
      parts.push(custom === 1 ? "1 custom exercise" : custom + " custom exercises");
    }
    return parts.join(", ");
  }

  function confirmImport(counts) {
    var summary = formatBackupSummary(counts);
    return window.confirm(
      "Replace all data on this device with this backup?\n\n" +
        summary +
        "\n\nPrograms and workout history will be restored. Current data will be overwritten."
    );
  }

  function runImport(raw) {
    if (!SL.store || typeof SL.store.importJson !== "function") {
      toast("Import unavailable");
      return;
    }
    try {
      var result = SL.store.importJson(raw);
      var counts = (result && result.counts) || backupCounts();
      toast("Imported " + formatBackupSummary(counts));
      refreshApp();
    } catch (err) {
      toast("Import failed — check JSON");
    }
  }

  function renderCsvResult(host, result) {
    if (!host) return;
    var added = (result && result.added) || 0;
    var skipped = (result && result.skipped) || 0;
    var warnings = (result && result.warnings) || [];
    var html =
      '<p class="small">CSV import: <strong>' +
      esc(added) +
      "</strong> added, <strong>" +
      esc(skipped) +
      "</strong> skipped.</p>";
    if (warnings.length) {
      var shown = warnings.slice(0, MAX_WARNINGS_SHOWN);
      var rest = warnings.length - shown.length;
      html += '<div class="data-warning">';
      html += '<p class="small"><strong>' + esc(warnings.length) + " warning(s)</strong></p>";
      html += "<ul>";
      var i;
      for (i = 0; i < shown.length; i++) {
        html += "<li>" + esc(shown[i]) + "</li>";
      }
      html += "</ul>";
      if (rest > 0) {
        html +=
          '<p class="small muted">…and ' + esc(rest) + " more warning(s) not shown.</p>";
      }
      html += "</div>";
    } else {
      html += '<p class="small muted">No warnings.</p>';
    }
    host.innerHTML = html;
  }

  function runCsvImport(raw, resultHost) {
    if (!raw || !String(raw).trim()) {
      toast("Paste or choose a CSV first");
      return;
    }
    if (!SL.csv || typeof SL.csv.importCsv !== "function") {
      toast("CSV import unavailable");
      if (resultHost) {
        resultHost.innerHTML =
          '<div class="data-warning"><p class="small">CSV module is not loaded.</p></div>';
      }
      return;
    }
    var result;
    try {
      result = SL.csv.importCsv(raw);
    } catch (e) {
      toast("CSV import failed");
      if (resultHost) {
        resultHost.innerHTML =
          '<div class="data-warning"><p class="small">' +
          esc(e && e.message ? e.message : "Import failed") +
          "</p></div>";
      }
      return;
    }
    renderCsvResult(resultHost, result);
    toast(
      "CSV: " +
        ((result && result.added) || 0) +
        " added, " +
        ((result && result.skipped) || 0) +
        " skipped"
    );
    refreshApp();
  }

  function requestNotifyPermissionSoft() {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        if (typeof Notification.requestPermission === "function") {
          Notification.requestPermission();
        }
      }
    } catch (e) {
      /* never block the toggle */
    }
  }

  function bind(root) {
    var unit = getSettings().unit || "kg";

    var unitBtns = root.querySelectorAll("[data-unit]");
    var ui;
    for (ui = 0; ui < unitBtns.length; ui++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          patchSettings({ unit: btn.getAttribute("data-unit") });
          toast(btn.getAttribute("data-unit") === "lb" ? "Display: lb" : "Display: kg");
          refreshApp();
        });
      })(unitBtns[ui]);
    }

    var restInput = root.querySelector("#set-rest");
    if (restInput) {
      restInput.addEventListener("change", function () {
        var n = Math.max(0, Math.round(Number(restInput.value) || 0));
        patchSettings({ restSeconds: n });
        restInput.value = String(n);
        toast(n ? "Rest set to " + n + "s" : "Rest timer off");
      });
    }

    var autoRest = root.querySelector("#set-auto-rest");
    if (autoRest) {
      autoRest.addEventListener("change", function () {
        patchSettings({ autoStartRest: !!autoRest.checked });
        toast(autoRest.checked ? "Auto-start rest on" : "Auto-start rest off");
      });
    }

    var vibrateToggle = root.querySelector("#set-vibrate");
    if (vibrateToggle) {
      vibrateToggle.addEventListener("change", function () {
        var on = !!vibrateToggle.checked;
        if (on) requestNotifyPermissionSoft();
        patchSettings({ vibrate: on });
        toast(on ? "Rest vibrate on" : "Rest vibrate off");
      });
    }

    var bwInput = root.querySelector("#set-bw");
    if (bwInput) {
      bwInput.addEventListener("change", function () {
        var kg = displayToKg(bwInput.value, unit);
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

    var plateTarget = root.querySelector("#plate-target");
    var plateOut = root.querySelector("#plate-out");
    var calcBtn = root.querySelector("#plate-calc");

    function runPlateCalc() {
      if (!plateOut) return;
      var raw = plateTarget ? plateTarget.value : "";
      if (raw === "" || raw == null) {
        plateOut.innerHTML =
          '<p class="muted small">Enter the load hanging on the belt.</p>';
        return;
      }
      var target = Number(raw);
      if (isNaN(target)) {
        plateOut.innerHTML =
          '<p class="muted small">Enter a number for belt load.</p>';
        return;
      }
      if (unit === "lb") target = target / KG_TO_LB;
      plateOut.innerHTML = formatCombo(plateCombo(target), unit);
    }

    if (calcBtn) calcBtn.addEventListener("click", runPlateCalc);
    if (plateTarget) {
      plateTarget.addEventListener("input", runPlateCalc);
      plateTarget.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          runPlateCalc();
        }
      });
    }

    var exportBtn = root.querySelector("#export-json");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        try {
          if (!SL.store || typeof SL.store.exportJson !== "function") {
            toast("Export unavailable");
            return;
          }
          var counts = backupCounts();
          downloadJson(SL.store.exportJson());
          toast("Exported " + formatBackupSummary(counts));
        } catch (err) {
          toast("Export failed");
        }
      });
    }

    var importArea = root.querySelector("#import-text");
    var importBtn = root.querySelector("#import-json");
    if (importBtn) {
      importBtn.addEventListener("click", function () {
        var raw = (importArea && importArea.value) || "";
        if (!raw.trim()) {
          toast("Paste JSON first");
          return;
        }
        try {
          var preview = JSON.parse(raw);
          var counts = {
            programs: Array.isArray(preview.programs) ? preview.programs.length : 0,
            sessions: Array.isArray(preview.sessions) ? preview.sessions.length : 0,
            customExercises: Array.isArray(preview.customExercises)
              ? preview.customExercises.length
              : 0,
          };
          if (!confirmImport(counts)) return;
          runImport(raw);
        } catch (err) {
          toast("Import failed — check JSON");
        }
      });
    }

    var fileInput = root.querySelector("#import-file");
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var raw = String(reader.result || "");
            var preview = JSON.parse(raw);
            var counts = {
              programs: Array.isArray(preview.programs) ? preview.programs.length : 0,
              sessions: Array.isArray(preview.sessions) ? preview.sessions.length : 0,
              customExercises: Array.isArray(preview.customExercises)
                ? preview.customExercises.length
                : 0,
            };
            if (!confirmImport(counts)) {
              fileInput.value = "";
              return;
            }
            runImport(raw);
          } catch (err) {
            toast("Import failed — check JSON");
          } finally {
            fileInput.value = "";
          }
        };
        reader.onerror = function () {
          toast("Could not read file");
        };
        reader.readAsText(file);
      });
    }

    var exportCsvBtn = root.querySelector("#export-csv");
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", function () {
        try {
          if (!SL.csv || typeof SL.csv.exportCsv !== "function") {
            toast("CSV export unavailable");
            return;
          }
          downloadCsv(SL.csv.exportCsv());
          toast("CSV exported");
        } catch (err) {
          toast("CSV export failed");
        }
      });
    }

    var csvResult = root.querySelector("#csv-import-result");
    var csvPaste = root.querySelector("#import-csv-text");
    var csvImportBtn = root.querySelector("#import-csv");
    if (csvImportBtn) {
      csvImportBtn.addEventListener("click", function () {
        var raw = (csvPaste && csvPaste.value) || "";
        runCsvImport(raw, csvResult);
      });
    }

    var csvFile = root.querySelector("#import-csv-file");
    if (csvFile) {
      csvFile.addEventListener("change", function () {
        var file = csvFile.files && csvFile.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var raw = String(reader.result || "");
          if (csvPaste) csvPaste.value = raw;
          runCsvImport(raw, csvResult);
          csvFile.value = "";
        };
        reader.onerror = function () {
          toast("Could not read CSV file");
          csvFile.value = "";
        };
        reader.readAsText(file);
      });
    }

    var resetBtn = root.querySelector("#reset-all");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        var ok = window.confirm(
          "Wipe all Streetlifting data?\n\nPrograms, sessions, custom exercises, and settings will be cleared. This cannot be undone."
        );
        if (!ok) return;
        if (!SL.store || typeof SL.store.reset !== "function") {
          toast("Wipe unavailable");
          return;
        }
        try {
          SL.store.reset();
          toast("Data wiped");
          refreshApp();
        } catch (e) {
          toast("Wipe failed");
        }
      });
    }
  }

  SL.views.settings = {
    title: function () {
      return "Settings";
    },

    render: function (rootEl) {
      var s = getSettings();
      var unit = s.unit === "lb" ? "lb" : "kg";
      var rest = s.restSeconds != null ? s.restSeconds : 180;
      var bwDisplay = kgToDisplay(s.bodyweightKg, unit);
      var unitLabel = unit === "lb" ? "lb" : "kg";
      var plates = plateListKg();
      var plateList = plates.join(" · ");
      var counts = backupCounts();
      var backupSummary = formatBackupSummary(counts);
      var autoStart = s.autoStartRest !== false;
      var vibrate = s.vibrate !== false;

      rootEl.innerHTML =
        '<div class="card">' +
        "<h2>Display</h2>" +
        '<p class="muted small">Loads stay stored in kg. Switch display only.</p>' +
        '<div class="chip-row">' +
        '<button type="button" class="chip' +
        (unit === "kg" ? " active" : "") +
        '" data-unit="kg" aria-pressed="' +
        (unit === "kg") +
        '">kg</button>' +
        '<button type="button" class="chip' +
        (unit === "lb" ? " active" : "") +
        '" data-unit="lb" aria-pressed="' +
        (unit === "lb") +
        '">lb</button>' +
        "</div>" +
        "</div>" +
        '<div class="card">' +
        "<h2>Session defaults</h2>" +
        '<label class="field">' +
        '<span class="lbl">Default bodyweight (' +
        esc(unitLabel) +
        ")</span>" +
        '<input id="set-bw" type="number" min="0" step="0.1" value="' +
        esc(bwDisplay) +
        '" placeholder="e.g. 75" inputmode="decimal" />' +
        "</label>" +
        "</div>" +
        '<div class="card">' +
        "<h2>Timer behavior</h2>" +
        '<p class="muted small">Controls rest after a completed set.</p>' +
        '<label class="field">' +
        '<span class="lbl">Default rest (seconds)</span>' +
        '<input id="set-rest" type="number" min="0" step="15" value="' +
        esc(rest) +
        '" inputmode="numeric" />' +
        "</label>" +
        '<label class="field data-row">' +
        '<span class="lbl">Auto-start rest timer</span>' +
        '<input id="set-auto-rest" type="checkbox"' +
        (autoStart ? " checked" : "") +
        " />" +
        "</label>" +
        '<label class="field data-row">' +
        '<span class="lbl">Vibrate / notify when rest ends</span>' +
        '<input id="set-vibrate" type="checkbox"' +
        (vibrate ? " checked" : "") +
        " />" +
        "</label>" +
        "</div>" +
        '<div class="card">' +
        "<h2>Belt load</h2>" +
        '<p class="muted small">' +
        "Target = total hanging on the dip belt. Stack from " +
        esc(plateList) +
        "&nbsp;kg plates." +
        "</p>" +
        '<label class="field">' +
        '<span class="lbl">Target load (' +
        esc(unitLabel) +
        ")</span>" +
        '<input id="plate-target" type="number" min="0" step="0.25" placeholder="e.g. 40" inputmode="decimal" />' +
        "</label>" +
        '<button type="button" class="btn block" id="plate-calc">Build stack</button>' +
        '<div id="plate-out" class="data-plate-out">' +
        '<p class="muted small">Enter the load hanging on the belt.</p>' +
        "</div>" +
        "</div>" +
        '<div class="card">' +
        "<h2>Backup</h2>" +
        '<p class="muted small">' +
        "Full backup: programs, workout history, custom exercises, and settings." +
        "</p>" +
        '<p class="muted small">On this device: ' +
        esc(backupSummary) +
        ".</p>" +
        '<div class="data-row data-actions">' +
        '<button type="button" class="btn block" id="export-json">Export backup</button>' +
        "</div>" +
        '<hr class="weld" />' +
        '<label class="field">' +
        '<span class="lbl">Import from file</span>' +
        '<input id="import-file" type="file" accept="application/json,.json" />' +
        "</label>" +
        '<label class="field">' +
        '<span class="lbl">Or paste backup JSON</span>' +
        '<textarea id="import-text" rows="5" placeholder=\'{"version":2,"programs":[],"sessions":[],...}\'></textarea>' +
        "</label>" +
        '<div class="data-actions">' +
        '<button type="button" class="btn secondary block" id="import-json">Import backup</button>' +
        "</div>" +
        "</div>" +
        '<div class="card">' +
        "<h2>CSV (Strong format)</h2>" +
        '<p class="muted small">' +
        "One row per set. Compatible with Strong column order. Weight uses your display unit (" +
        esc(unitLabel) +
        ")." +
        "</p>" +
        '<div class="data-row data-actions">' +
        '<button type="button" class="btn block" id="export-csv">Export CSV</button>' +
        "</div>" +
        '<hr class="weld" />' +
        '<label class="field">' +
        '<span class="lbl">Import CSV file</span>' +
        '<input id="import-csv-file" type="file" accept=".csv,text/csv" />' +
        "</label>" +
        '<label class="field">' +
        '<span class="lbl">Or paste CSV</span>' +
        '<textarea id="import-csv-text" rows="5" placeholder="Date,Workout Name,Duration,..."></textarea>' +
        "</label>" +
        '<div class="data-actions">' +
        '<button type="button" class="btn secondary block" id="import-csv">Import CSV</button>' +
        "</div>" +
        '<div id="csv-import-result" class="data-row"></div>' +
        "</div>" +
        '<div class="card">' +
        "<h2>Danger zone</h2>" +
        '<p class="muted small">Clears programs, sessions, and settings on this device.</p>' +
        '<button type="button" class="btn danger block" id="reset-all">Wipe all data</button>' +
        "</div>";

      bind(rootEl);

      var tab = (SL.app && SL.app.currentTab) || "settings";
      if (TOP_TABS[tab]) {
        var back = document.getElementById("back-btn");
        if (back) back.classList.add("hidden");
      }
    },
  };
})();
