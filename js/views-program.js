/* Streetlifting — program list / edit view. */
(function () {
  "use strict";

  window.SL = window.SL || {};
  window.SL.views = window.SL.views || {};

  var state = {
    mode: "list", // list | edit | squat-cycle | squat-schedule | pullup-wave | pullup-status
    programId: null,
    dayIndex: null, // null = program meta; number = editing that day
    exercises: null,
    exercisesError: null,
    squatScheme: null,
    pullupScheme: null,
  };

  var KG_TO_LB = 2.2046226218;

  function settingsUnit() {
    var s = SL.store.get().settings || {};
    return s.unit === "lb" ? "lb" : "kg";
  }

  function displayToKg(val, unit) {
    var n = Number(val);
    if (!isFinite(n) || n <= 0) return null;
    return unit === "lb" ? n / KG_TO_LB : n;
  }

  function kgToDisplay(kg, unit) {
    if (kg == null || !isFinite(kg)) return "";
    var v = unit === "lb" ? kg * KG_TO_LB : kg;
    var r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  function fmtLoadRange(ex, unit) {
    if (ex.loadKgMax != null && ex.loadKgMax !== ex.loadKg) {
      return kgToDisplay(ex.loadKg, unit) + "-" + kgToDisplay(ex.loadKgMax, unit) + " " + unit;
    }
    return kgToDisplay(ex.loadKg, unit) + " " + unit;
  }

  function todayLocalISO() {
    if (typeof SL.store.todayISO === "function") return SL.store.todayISO();
    var d = new Date();
    var m = String(d.getMonth() + 1);
    if (m.length < 2) m = "0" + m;
    var day = String(d.getDate());
    if (day.length < 2) day = "0" + day;
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function refresh() {
    if (typeof SL.refresh === "function") SL.refresh();
  }

  function cloneProgram(p) {
    return JSON.parse(JSON.stringify(p));
  }

  function getEditingProgram() {
    if (!state.programId) return null;
    var list = SL.store.listPrograms();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.programId) return cloneProgram(list[i]);
    }
    return null;
  }

  function ensureExercises(cb) {
    if (state.exercises) {
      cb(state.exercises);
      return;
    }
    var result = SL.store.listExercises();
    if (result && typeof result.then === "function") {
      result
        .then(function (list) {
          state.exercises = Array.isArray(list) ? list : [];
          state.exercisesError = null;
          cb(state.exercises);
        })
        .catch(function (err) {
          state.exercisesError = (err && err.message) || "Failed to load exercises";
          state.exercises = [];
          cb(state.exercises);
        });
    } else {
      state.exercises = Array.isArray(result) ? result : [];
      cb(state.exercises);
    }
  }

  function exerciseName(id, catalog) {
    if (!catalog) return id;
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i].id === id) return catalog[i].name;
    }
    return id;
  }

  function findFacePullId(catalog) {
    var ids = ["face-pull", "face_pull", "facepull"];
    for (var i = 0; i < catalog.length; i++) {
      var id = catalog[i].id;
      if (ids.indexOf(id) >= 0) return id;
      var name = String(catalog[i].name || "").toLowerCase();
      if (name.indexOf("face pull") >= 0 || name.indexOf("face-pull") >= 0) return id;
    }
    return null;
  }

  function progEx(exerciseId, sets, repMin, repMax, progression, startLoadKg, linearIncrementKg) {
    var row = {
      exerciseId: exerciseId,
      sets: sets,
      repMin: repMin,
      repMax: repMax,
      progression: progression,
      startLoadKg: startLoadKg,
      linearIncrementKg: linearIncrementKg != null ? linearIncrementKg : 0,
    };
    return row;
  }

  function loadStarterTemplate() {
    ensureExercises(function (catalog) {
      var faceId = findFacePullId(catalog);
      var dayAEx = [
        progEx("pullup", 4, 4, 6, "double", 5, 0),
        progEx("dip", 4, 4, 6, "double", 5, 0),
      ];
      if (faceId) {
        dayAEx.push(progEx(faceId, 3, 10, 15, "double", 0, 0));
      }
      var dayBEx = [
        progEx("pullup", 5, 5, 8, "double", 5, 0),
        progEx("dip", 5, 5, 8, "double", 5, 0),
      ];
      if (faceId) {
        dayBEx.push(progEx(faceId, 3, 10, 15, "double", 0, 0));
      }

      var program = {
        id: uid(),
        name: "Double Progression Pull+Dip",
        active: false,
        days: [
          { id: uid(), name: "Day A", exercises: dayAEx },
          { id: uid(), name: "Day B", exercises: dayBEx },
        ],
      };
      SL.store.upsertProgram(program);
      SL.store.setActiveProgram(program.id);
      state.mode = "list";
      state.programId = null;
      state.dayIndex = null;
      refresh();
    });
  }

  function renderList(root) {
    var programs = SL.store.listPrograms();
    var html = "";

    html += '<div class="card">';
    html += "<h2>Programs</h2>";
    if (!programs.length) {
      html += '<p class="muted">No programs yet. Create one or load the starter template.</p>';
    } else {
      for (var i = 0; i < programs.length; i++) {
        var p = programs[i];
        var metaLabel =
          p.kind === "percent_cycle"
            ? "4-week % cycle"
            : p.kind === "pullup_wave"
              ? "Pull-up wave"
              : ((p.days && p.days.length) || 0) +
                " day" +
                ((p.days && p.days.length) === 1 ? "" : "s");
        html += '<div class="session-card" data-action="edit" data-id="' + esc(p.id) + '" style="cursor:default">';
        html += '<div class="head">';
        html += '<span class="date">' + esc(p.name);
        if (p.active) html += '<span class="badge">Active</span>';
        html += "</span>";
        html += '<span class="muted small">' + esc(metaLabel) + "</span>";
        html += "</div>";
        html += '<div class="row" style="flex-wrap:wrap;margin-top:8px">';
        if (!p.active) {
          html +=
            '<button type="button" class="btn sm secondary" data-action="set-active" data-id="' +
            esc(p.id) +
            '">Set Active</button>';
        }
        html +=
          '<button type="button" class="btn sm secondary" data-action="edit" data-id="' +
          esc(p.id) +
          '">Edit</button>';
        html +=
          '<button type="button" class="btn sm danger" data-action="delete" data-id="' +
          esc(p.id) +
          '">Delete</button>';
        html += "</div>";
        html += "</div>";
      }
    }
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Create</h2>";
    html += '<label class="field"><span class="lbl">Program name</span>';
    html += '<input type="text" id="prog-new-name" placeholder="e.g. Pull + Dip block" /></label>';
    html += '<button type="button" class="btn block" id="prog-create">Create program</button>';
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Template</h2>";
    html +=
      '<p class="muted" style="margin-bottom:12px">2-day double progression: pull-ups + dips (face pull if available).</p>';
    html +=
      '<button type="button" class="btn block secondary" id="prog-starter">Load starter template</button>';
    html +=
      '<p class="muted" style="margin:16px 0 12px">4-week squat peaking cycle. Enter your target 1RM and the app schedules every session from %.</p>';
    html +=
      '<button type="button" class="btn block" id="prog-squat-cycle">Squat 1RM cycle (4 weeks)</button>';
    html +=
      '<p class="muted" style="margin:16px 0 12px">Pull-up wave: enter only the start weight for the first micro cycle (3×10). Volume matches the phase; you advance +2.5 kg or drop reps (10→6→3).</p>';
    html +=
      '<button type="button" class="btn block" id="prog-pullup-wave">Pull-up wave (start weight)</button>';
    html += "</div>";

    root.innerHTML = html;

    root.querySelector("#prog-create").addEventListener("click", function () {
      var input = root.querySelector("#prog-new-name");
      var name = (input && input.value ? input.value : "").trim();
      if (!name) {
        if (input) input.focus();
        return;
      }
      var program = {
        id: uid(),
        name: name,
        active: SL.store.listPrograms().length === 0,
        days: [],
      };
      SL.store.upsertProgram(program);
      if (program.active) SL.store.setActiveProgram(program.id);
      state.mode = "edit";
      state.programId = program.id;
      state.dayIndex = null;
      refresh();
    });

    root.querySelector("#prog-starter").addEventListener("click", function () {
      loadStarterTemplate();
    });

    root.querySelector("#prog-squat-cycle").addEventListener("click", function () {
      state.mode = "squat-cycle";
      state.programId = null;
      refresh();
    });

    root.querySelector("#prog-pullup-wave").addEventListener("click", function () {
      state.mode = "pullup-wave";
      state.programId = null;
      refresh();
    });

    root.querySelectorAll("[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var action = btn.getAttribute("data-action");
        var id = btn.getAttribute("data-id");
        if (action === "set-active") {
          SL.store.setActiveProgram(id);
          refresh();
        } else if (action === "edit") {
          var prog = null;
          var list = SL.store.listPrograms();
          for (var pi = 0; pi < list.length; pi++) {
            if (list[pi].id === id) {
              prog = list[pi];
              break;
            }
          }
          if (prog && prog.kind === "percent_cycle") {
            state.mode = "squat-schedule";
            state.programId = id;
          } else if (prog && prog.kind === "pullup_wave") {
            state.mode = "pullup-status";
            state.programId = id;
          } else {
            state.mode = "edit";
            state.programId = id;
            state.dayIndex = null;
          }
          refresh();
        } else if (action === "delete") {
          if (!confirm("Delete this program?")) return;
          SL.store.deleteProgram(id);
          refresh();
        }
      });
    });
  }

  function renderPullupWaveForm(root) {
    var unit = settingsUnit();
    var html = '<div class="card">';
    html += "<h2>Pull-up wave</h2>";
    html +=
      '<p class="muted" style="margin-bottom:14px">Only one input: start weight for the first micro cycle (phase 3×10). Then Intensive 3 sets / Volume 6 sets follow the wave. You choose when to +2.5 kg or drop reps.</p>';
    html +=
      '<label class="field"><span class="lbl">Start weight — first micro cycle (' +
      esc(unit) +
      ')</span><input type="number" id="pullup-start" min="0" step="0.5" inputmode="decimal" placeholder="e.g. 20" autofocus /></label>';
    html += '<div class="row" style="gap:8px;margin-top:8px">';
    html += '<button type="button" class="btn secondary" id="pullup-cancel">Cancel</button>';
    html += '<button type="button" class="btn" id="pullup-create">Create program</button>';
    html += "</div></div>";
    root.innerHTML = html;

    root.querySelector("#pullup-cancel").addEventListener("click", function () {
      state.mode = "list";
      refresh();
    });

    root.querySelector("#pullup-create").addEventListener("click", function () {
      var input = root.querySelector("#pullup-start");
      var raw = input && input.value;
      var n = Number(raw);
      if (!isFinite(n) || n < 0) {
        if (input) input.focus();
        return;
      }
      var startKg = unit === "lb" ? n / KG_TO_LB : n;
      startKg = Math.round(startKg * 100) / 100;
      SL.store.loadPullupWaveScheme().then(function (scheme) {
        var program = {
          id: uid(),
          name: "Pull-up wave — " + kgToDisplay(startKg, unit) + " " + unit,
          active: false,
          kind: "pullup_wave",
          exerciseId: "pullup",
          startLoadKg: startKg,
          intensiveLoadKg: startKg,
          phaseIndex: 0,
          microStepKg: 2.5,
          schemeId: (scheme && scheme.id) || "pullup-wave",
          days: [],
        };
        SL.store.upsertProgram(program);
        SL.store.setActiveProgram(program.id);
        state.mode = "pullup-status";
        state.programId = program.id;
        state.pullupScheme = scheme;
        refresh();
      }).catch(function (err) {
        root.innerHTML =
          '<div class="card"><p class="muted">Could not load pull-up wave: ' +
          esc((err && err.message) || "error") +
          '</p><button type="button" class="btn" id="pullup-back">Back</button></div>';
        root.querySelector("#pullup-back").addEventListener("click", function () {
          state.mode = "list";
          refresh();
        });
      });
    });
  }

  function renderPullupWaveStatus(root) {
    var program = getEditingProgram();
    if (!program || program.kind !== "pullup_wave") {
      state.mode = "list";
      renderList(root);
      return;
    }
    var unit = settingsUnit();

    function paint(scheme) {
      state.pullupScheme = scheme;
      var intensive = SL.store.currentPullupWaveSession(program, scheme, "intensive");
      var volume = SL.store.currentPullupWaveSession(program, scheme, "volume");
      var next = SL.store.currentPullupWaveSession(program, scheme, "next");
      var phases = (scheme && scheme.phases) || [];
      var idx = Number(program.phaseIndex) || 0;
      var atPeak = idx >= phases.length - 1;
      var phase = phases[idx] || {};
      var phaseLabel = "3×" + (phase.reps != null ? phase.reps : "?");

      var html = '<div class="card">';
      html += '<div class="spread"><h2>' + esc(program.name) + "</h2>";
      if (program.active) html += '<span class="badge">Active</span>';
      html += "</div>";
      html +=
        '<p class="muted" style="margin:8px 0 14px">Macro: 10 → 6 → 3 · Micro: +2.5 kg until you drop reps</p>';
      html += '<div class="stat-grid" style="margin-bottom:14px">';
      html +=
        '<div class="stat"><div class="val">' +
        esc(phaseLabel) +
        '</div><div class="lbl">Phase</div></div>';
      html +=
        '<div class="stat"><div class="val">' +
        esc(kgToDisplay(program.intensiveLoadKg, unit) + " " + unit) +
        '</div><div class="lbl">Intensive load</div></div>';
      html += "</div>";

      if (intensive && intensive.exercises[0]) {
        var ix = intensive.exercises[0];
        html +=
          '<div class="session-card" style="margin-bottom:8px"><div class="head"><span class="date">Intensive</span><span class="muted small">3 sets</span></div>';
        html +=
          '<div class="pr-row"><div class="name">' +
          esc(ix.sets + "×" + ix.reps) +
          '</div><div class="value">' +
          esc(kgToDisplay(ix.loadKg, unit) + " " + unit) +
          "</div></div></div>";
      }
      if (volume && volume.exercises[0]) {
        var vx = volume.exercises[0];
        html +=
          '<div class="session-card" style="margin-bottom:8px"><div class="head"><span class="date">Volume</span><span class="muted small">6 sets</span></div>';
        html +=
          '<div class="pr-row"><div class="name">' +
          esc(vx.sets + "×" + vx.reps) +
          '</div><div class="value">' +
          esc(kgToDisplay(vx.loadKg, unit) + " " + unit) +
          "</div></div></div>";
      }
      if (next) {
        html +=
          '<p class="muted small" style="margin:10px 0">Next session: <strong>' +
          esc(next.name) +
          "</strong></p>";
      }

      html += '<div class="stack" style="margin-top:12px">';
      html +=
        '<button type="button" class="btn block" id="pullup-micro">Next micro (+2.5 kg)</button>';
      if (!atPeak) {
        html +=
          '<button type="button" class="btn block secondary" id="pullup-macro">End micro / next macro (drop reps)</button>';
      } else {
        html +=
          '<p class="muted small">At final phase 3×3 — keep micro (+2.5 kg) or start a new cycle.</p>';
      }
      html += "</div>";
      html += '<div class="row" style="gap:8px;margin-top:14px">';
      html += '<button type="button" class="btn secondary" id="pullup-back-list">Back</button>';
      if (!program.active) {
        html += '<button type="button" class="btn" id="pullup-activate">Set Active</button>';
      }
      html += "</div></div>";
      root.innerHTML = html;

      root.querySelector("#pullup-back-list").addEventListener("click", function () {
        state.mode = "list";
        state.programId = null;
        refresh();
      });
      var act = root.querySelector("#pullup-activate");
      if (act) {
        act.addEventListener("click", function () {
          SL.store.setActiveProgram(program.id);
          refresh();
        });
      }
      root.querySelector("#pullup-micro").addEventListener("click", function () {
        SL.store.advancePullupMicro(program.id);
        var updated = getEditingProgram();
        if (updated) program = updated;
        paint(scheme);
      });
      var macroBtn = root.querySelector("#pullup-macro");
      if (macroBtn) {
        macroBtn.addEventListener("click", function () {
          if (
            !confirm(
              "Drop reps to the next macro phase and keep current weight? (Use after RPE 10 / failure.)"
            )
          ) {
            return;
          }
          SL.store.advancePullupMacro(program.id);
          var updated = getEditingProgram();
          if (updated) program = updated;
          paint(scheme);
        });
      }
    }

    if (state.pullupScheme) {
      paint(state.pullupScheme);
    } else {
      root.innerHTML = '<div class="card"><p class="muted">Loading wave…</p></div>';
      SL.store
        .loadPullupWaveScheme()
        .then(paint)
        .catch(function (err) {
          root.innerHTML =
            '<div class="card"><p class="muted">' +
            esc((err && err.message) || "Failed to load") +
            '</p><button type="button" class="btn" id="pullup-back-list">Back</button></div>';
          root.querySelector("#pullup-back-list").addEventListener("click", function () {
            state.mode = "list";
            refresh();
          });
        });
    }
  }

  function renderSquatCycleForm(root) {
    var unit = settingsUnit();
    var html = '<div class="card">';
    html += "<h2>Squat 1RM cycle</h2>";
    html +=
      '<p class="muted" style="margin-bottom:14px">What is your target one-rep max for the next four weeks? Every session load is scheduled from that goal.</p>';
    html +=
      '<label class="field"><span class="lbl">Target 1RM (' +
      esc(unit) +
      ')</span><input type="number" id="squat-target" min="1" step="0.5" inputmode="decimal" placeholder="e.g. 125" /></label>';
    html +=
      '<label class="field"><span class="lbl">Start date (Week 1 Day 1)</span><input type="date" id="squat-start" value="' +
      esc(todayLocalISO()) +
      '" /></label>';
    html += '<div class="row" style="gap:8px;margin-top:8px">';
    html += '<button type="button" class="btn secondary" id="squat-cancel">Cancel</button>';
    html += '<button type="button" class="btn" id="squat-create">Create &amp; schedule</button>';
    html += "</div></div>";
    root.innerHTML = html;

    root.querySelector("#squat-cancel").addEventListener("click", function () {
      state.mode = "list";
      refresh();
    });

    root.querySelector("#squat-create").addEventListener("click", function () {
      var targetInput = root.querySelector("#squat-target");
      var startInput = root.querySelector("#squat-start");
      var targetKg = displayToKg(targetInput && targetInput.value, unit);
      if (!targetKg) {
        if (targetInput) targetInput.focus();
        return;
      }
      var startDate = (startInput && startInput.value) || todayLocalISO();
      SL.store.loadSquatCycleScheme().then(function (scheme) {
        var program = {
          id: uid(),
          name: "Squat 1RM Peak — " + kgToDisplay(targetKg, unit) + " " + unit,
          active: false,
          kind: "percent_cycle",
          exerciseId: "squat",
          target1rmKg: Math.round(targetKg * 100) / 100,
          startDateISO: startDate,
          schemeId: (scheme && scheme.id) || "squat-1rm-4w",
          days: [],
        };
        SL.store.upsertProgram(program);
        SL.store.setActiveProgram(program.id);
        state.mode = "squat-schedule";
        state.programId = program.id;
        state.squatScheme = scheme;
        refresh();
      }).catch(function (err) {
        root.innerHTML =
          '<div class="card"><p class="muted">Could not load squat cycle: ' +
          esc((err && err.message) || "error") +
          '</p><button type="button" class="btn" id="squat-back">Back</button></div>';
        root.querySelector("#squat-back").addEventListener("click", function () {
          state.mode = "list";
          refresh();
        });
      });
    });
  }

  function renderSquatSchedule(root) {
    var program = getEditingProgram();
    if (!program || program.kind !== "percent_cycle") {
      state.mode = "list";
      renderList(root);
      return;
    }
    var unit = settingsUnit();
    var paint = function (scheme) {
      state.squatScheme = scheme;
      var sessions = SL.store.expandPercentCycle(program, scheme);
      var html = '<div class="card">';
      html += '<div class="spread"><h2>' + esc(program.name) + "</h2>";
      if (program.active) html += '<span class="badge">Active</span>';
      html += "</div>";
      html +=
        '<p class="muted" style="margin-bottom:12px">Target 1RM: <strong>' +
        esc(kgToDisplay(program.target1rmKg, unit) + " " + unit) +
        "</strong> · starts " +
        esc(program.startDateISO || "") +
        "</p>";
      html +=
        '<label class="field"><span class="lbl">Update target 1RM (' +
        esc(unit) +
        ')</span><input type="number" id="squat-retarget" min="1" step="0.5" value="' +
        esc(kgToDisplay(program.target1rmKg, unit)) +
        '" /></label>';
      html +=
        '<label class="field"><span class="lbl">Start date</span><input type="date" id="squat-restartdate" value="' +
        esc(program.startDateISO || todayLocalISO()) +
        '" /></label>';
      html += '<button type="button" class="btn secondary block" id="squat-apply" style="margin-bottom:14px">Update schedule</button>';

      var week = null;
      for (var i = 0; i < sessions.length; i++) {
        var sess = sessions[i];
        if (week !== sess.week) {
          if (week != null) html += "</div>";
          week = sess.week;
          html += '<div class="card" style="margin-top:10px"><h3>Week ' + esc(sess.week) + "</h3>";
        }
        html += '<div class="session-card" style="margin-top:8px">';
        html +=
          '<div class="head"><span class="date">' +
          esc(sess.name) +
          '</span><span class="muted small">' +
          esc(sess.dateISO) +
          "</span></div>";
        for (var e = 0; e < sess.exercises.length; e++) {
          var ex = sess.exercises[e];
          html +=
            '<div class="pr-row"><div class="name">' +
            esc(ex.sets + "×" + ex.reps + " @ " + ex.pctLabel) +
            '</div><div class="value">' +
            esc(fmtLoadRange(ex, unit)) +
            "</div></div>";
        }
        html += "</div>";
      }
      if (week != null) html += "</div>";

      html += '<div class="row" style="gap:8px;margin-top:14px">';
      html += '<button type="button" class="btn secondary" id="squat-back-list">Back</button>';
      if (!program.active) {
        html += '<button type="button" class="btn" id="squat-activate">Set Active</button>';
      }
      html += "</div></div>";
      root.innerHTML = html;

      root.querySelector("#squat-back-list").addEventListener("click", function () {
        state.mode = "list";
        state.programId = null;
        refresh();
      });
      var act = root.querySelector("#squat-activate");
      if (act) {
        act.addEventListener("click", function () {
          SL.store.setActiveProgram(program.id);
          refresh();
        });
      }
      root.querySelector("#squat-apply").addEventListener("click", function () {
        var t = displayToKg(root.querySelector("#squat-retarget").value, unit);
        var sd = root.querySelector("#squat-restartdate").value || program.startDateISO;
        if (!t) return;
        program.target1rmKg = Math.round(t * 100) / 100;
        program.startDateISO = sd;
        program.name = "Squat 1RM Peak — " + kgToDisplay(t, unit) + " " + unit;
        SL.store.upsertProgram(program);
        refresh();
      });
    };

    if (state.squatScheme) {
      paint(state.squatScheme);
    } else {
      root.innerHTML = '<div class="card"><p class="muted">Loading schedule…</p></div>';
      SL.store.loadSquatCycleScheme().then(paint).catch(function (err) {
        root.innerHTML =
          '<div class="card"><p class="muted">' +
          esc((err && err.message) || "Failed to load") +
          '</p><button type="button" class="btn" id="squat-back-list">Back</button></div>';
        root.querySelector("#squat-back-list").addEventListener("click", function () {
          state.mode = "list";
          refresh();
        });
      });
    }
  }

  function renderDayEditor(root, program, dayIndex, catalog) {
    var day = program.days[dayIndex];
    if (!day) {
      state.dayIndex = null;
      renderEdit(root);
      return;
    }

    var html = "";
    html += '<div class="card">';
    html +=
      '<button type="button" class="btn sm secondary" id="day-back" style="margin-bottom:12px">Back to program</button>';
    html += "<h2>Edit day</h2>";
    html += '<label class="field"><span class="lbl">Day name</span>';
    html +=
      '<input type="text" id="day-name" value="' + esc(day.name || "") + '" /></label>';
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Exercises</h2>";
    if (!day.exercises || !day.exercises.length) {
      html += '<p class="muted">No exercises yet.</p>';
    }
    for (var i = 0; i < (day.exercises || []).length; i++) {
      var ex = day.exercises[i];
      var prog = ex.progression || "double";
      html += '<div class="exercise-block" data-ex-idx="' + i + '">';
      html += '<div class="ex-head">';
      html += '<span class="title">' + esc(exerciseName(ex.exerciseId, catalog)) + "</span>";
      html +=
        '<button type="button" class="btn sm danger" data-action="remove-ex" data-idx="' +
        i +
        '">Remove</button>';
      html += "</div>";
      html += '<div class="row" style="flex-wrap:wrap;align-items:flex-end">';
      html +=
        '<label class="field grow" style="margin-bottom:8px"><span class="lbl">Sets</span>' +
        '<input type="number" min="1" data-field="sets" data-idx="' +
        i +
        '" value="' +
        esc(ex.sets) +
        '" /></label>';
      html +=
        '<label class="field grow" style="margin-bottom:8px"><span class="lbl">Rep min</span>' +
        '<input type="number" min="1" data-field="repMin" data-idx="' +
        i +
        '" value="' +
        esc(ex.repMin) +
        '" /></label>';
      html +=
        '<label class="field grow" style="margin-bottom:8px"><span class="lbl">Rep max</span>' +
        '<input type="number" min="1" data-field="repMax" data-idx="' +
        i +
        '" value="' +
        esc(ex.repMax) +
        '" /></label>';
      html += "</div>";
      html +=
        '<label class="field"><span class="lbl">Progression</span><select data-field="progression" data-idx="' +
        i +
        '">' +
        '<option value="double"' +
        (prog === "double" ? " selected" : "") +
        ">Double</option>" +
        '<option value="linear"' +
        (prog === "linear" ? " selected" : "") +
        ">Linear</option>" +
        '<option value="manual"' +
        (prog === "manual" ? " selected" : "") +
        ">Manual</option>" +
        "</select></label>";
      html +=
        '<label class="field"><span class="lbl">Start load (kg)</span>' +
        '<input type="number" step="0.5" data-field="startLoadKg" data-idx="' +
        i +
        '" value="' +
        esc(ex.startLoadKg != null ? ex.startLoadKg : 0) +
        '" /></label>';
      html +=
        '<label class="field linear-inc"' +
        (prog === "linear" ? "" : ' style="display:none"') +
        '><span class="lbl">Linear increment (kg)</span>' +
        '<input type="number" step="0.5" data-field="linearIncrementKg" data-idx="' +
        i +
        '" value="' +
        esc(ex.linearIncrementKg != null ? ex.linearIncrementKg : 0) +
        '" /></label>';
      html += "</div>";
    }
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Add exercise</h2>";
    if (state.exercisesError) {
      html += '<p class="muted">' + esc(state.exercisesError) + "</p>";
    }
    html += '<label class="field"><span class="lbl">Exercise</span><select id="add-ex-select">';
    html += '<option value="">Select…</option>';
    for (var j = 0; j < catalog.length; j++) {
      var c = catalog[j];
      html +=
        '<option value="' +
        esc(c.id) +
        '">' +
        esc(c.name) +
        (c.category ? " (" + esc(c.category) + ")" : "") +
        "</option>";
    }
    html += "</select></label>";
    html += '<button type="button" class="btn block" id="add-ex-btn">Add exercise</button>';
    html += "</div>";

    html += '<button type="button" class="btn block" id="day-save">Save day</button>';

    root.innerHTML = html;

    function readDayFromDom() {
      var nameEl = root.querySelector("#day-name");
      day.name = nameEl ? nameEl.value.trim() || day.name : day.name;
      var blocks = root.querySelectorAll(".exercise-block");
      for (var b = 0; b < blocks.length; b++) {
        var idx = Number(blocks[b].getAttribute("data-ex-idx"));
        if (!day.exercises[idx]) continue;
        var fields = blocks[b].querySelectorAll("[data-field]");
        for (var f = 0; f < fields.length; f++) {
          var field = fields[f].getAttribute("data-field");
          var val = fields[f].value;
          if (field === "progression") {
            day.exercises[idx].progression = val;
          } else {
            var num = parseFloat(val);
            day.exercises[idx][field] = isFinite(num) ? num : 0;
          }
        }
      }
    }

    root.querySelector("#day-back").addEventListener("click", function () {
      state.dayIndex = null;
      refresh();
    });

    root.querySelectorAll('[data-field="progression"]').forEach(function (sel) {
      sel.addEventListener("change", function () {
        var block = sel.closest(".exercise-block");
        var inc = block && block.querySelector(".linear-inc");
        if (inc) inc.style.display = sel.value === "linear" ? "" : "none";
      });
    });

    root.querySelectorAll('[data-action="remove-ex"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        readDayFromDom();
        var idx = Number(btn.getAttribute("data-idx"));
        day.exercises.splice(idx, 1);
        program.days[dayIndex] = day;
        SL.store.upsertProgram(program);
        refresh();
      });
    });

    root.querySelector("#add-ex-btn").addEventListener("click", function () {
      var sel = root.querySelector("#add-ex-select");
      var exId = sel && sel.value;
      if (!exId) return;
      readDayFromDom();
      if (!day.exercises) day.exercises = [];
      day.exercises.push(progEx(exId, 3, 5, 8, "double", 0, 0));
      program.days[dayIndex] = day;
      SL.store.upsertProgram(program);
      refresh();
    });

    root.querySelector("#day-save").addEventListener("click", function () {
      readDayFromDom();
      program.days[dayIndex] = day;
      SL.store.upsertProgram(program);
      state.dayIndex = null;
      refresh();
    });
  }

  function renderEdit(root) {
    var program = getEditingProgram();
    if (!program) {
      state.mode = "list";
      state.programId = null;
      renderList(root);
      return;
    }

    if (state.dayIndex != null) {
      root.innerHTML = '<p class="muted">Loading exercises…</p>';
      ensureExercises(function (catalog) {
        program = getEditingProgram();
        if (!program) {
          state.mode = "list";
          state.programId = null;
          state.dayIndex = null;
          renderList(root);
          return;
        }
        renderDayEditor(root, program, state.dayIndex, catalog);
      });
      return;
    }

    var html = "";
    html += '<div class="card">';
    html +=
      '<button type="button" class="btn sm secondary" id="prog-back" style="margin-bottom:12px">Back</button>';
    html += "<h2>Edit program</h2>";
    html += '<label class="field"><span class="lbl">Name</span>';
    html +=
      '<input type="text" id="prog-name" value="' + esc(program.name || "") + '" /></label>';
    if (program.active) {
      html += '<p class="muted"><span class="badge">Active</span> This is your current program.</p>';
    } else {
      html +=
        '<button type="button" class="btn sm secondary" id="prog-set-active" style="margin-top:4px">Set Active</button>';
    }
    html += "</div>";

    html += '<div class="card">';
    html += '<div class="spread" style="margin-bottom:12px"><h2 style="margin:0">Days</h2>';
    html += '<button type="button" class="btn sm" id="prog-add-day">Add day</button></div>';
    if (!program.days || !program.days.length) {
      html += '<p class="muted">No days yet. Add a day to build the template.</p>';
    }
    for (var i = 0; i < (program.days || []).length; i++) {
      var d = program.days[i];
      var nEx = (d.exercises && d.exercises.length) || 0;
      html += '<div class="session-card" style="cursor:default">';
      html += '<div class="head">';
      html += '<span class="date">' + esc(d.name || "Day " + (i + 1)) + "</span>";
      html += '<span class="muted small">' + nEx + " exercise" + (nEx === 1 ? "" : "s") + "</span>";
      html += "</div>";
      html += '<div class="row" style="flex-wrap:wrap;margin-top:8px">';
      html +=
        '<button type="button" class="btn sm secondary" data-action="edit-day" data-idx="' +
        i +
        '">Edit</button>';
      html +=
        '<button type="button" class="btn sm danger" data-action="delete-day" data-idx="' +
        i +
        '">Delete</button>';
      html += "</div></div>";
    }
    html += "</div>";

    html += '<button type="button" class="btn block" id="prog-save">Save program</button>';

    root.innerHTML = html;

    root.querySelector("#prog-back").addEventListener("click", function () {
      state.mode = "list";
      state.programId = null;
      state.dayIndex = null;
      refresh();
    });

    var setActiveBtn = root.querySelector("#prog-set-active");
    if (setActiveBtn) {
      setActiveBtn.addEventListener("click", function () {
        SL.store.setActiveProgram(program.id);
        refresh();
      });
    }

    root.querySelector("#prog-add-day").addEventListener("click", function () {
      var nameEl = root.querySelector("#prog-name");
      if (nameEl) program.name = nameEl.value.trim() || program.name;
      if (!program.days) program.days = [];
      var n = program.days.length + 1;
      program.days.push({ id: uid(), name: "Day " + n, exercises: [] });
      SL.store.upsertProgram(program);
      state.dayIndex = program.days.length - 1;
      refresh();
    });

    root.querySelectorAll('[data-action="edit-day"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.dayIndex = Number(btn.getAttribute("data-idx"));
        refresh();
      });
    });

    root.querySelectorAll('[data-action="delete-day"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Delete this day?")) return;
        var idx = Number(btn.getAttribute("data-idx"));
        program.days.splice(idx, 1);
        SL.store.upsertProgram(program);
        refresh();
      });
    });

    root.querySelector("#prog-save").addEventListener("click", function () {
      var nameEl = root.querySelector("#prog-name");
      program.name = nameEl ? nameEl.value.trim() || program.name : program.name;
      SL.store.upsertProgram(program);
      state.mode = "list";
      state.programId = null;
      refresh();
    });
  }

  function render(root) {
    if (!root) return;
    if (state.mode === "squat-cycle") {
      renderSquatCycleForm(root);
    } else if (state.mode === "squat-schedule") {
      renderSquatSchedule(root);
    } else if (state.mode === "pullup-wave") {
      renderPullupWaveForm(root);
    } else if (state.mode === "pullup-status") {
      renderPullupWaveStatus(root);
    } else if (state.mode === "edit") {
      renderEdit(root);
    } else {
      renderList(root);
    }
  }

  function title() {
    if (state.mode === "squat-cycle") return "Squat 1RM cycle";
    if (state.mode === "squat-schedule") return "Squat schedule";
    if (state.mode === "pullup-wave") return "Pull-up wave";
    if (state.mode === "pullup-status") return "Pull-up wave";
    if (state.mode === "edit" && state.dayIndex != null) return "Edit day";
    if (state.mode === "edit") return "Edit program";
    return "Programs";
  }

  window.SL.views.program = {
    render: render,
    title: title,
  };
})();
