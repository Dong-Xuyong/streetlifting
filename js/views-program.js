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
    return {
      exerciseId: exerciseId,
      sets: sets,
      repMin: repMin,
      repMax: repMax,
      progression: progression,
      startLoadKg: startLoadKg,
      linearIncrementKg: linearIncrementKg != null ? linearIncrementKg : 0,
    };
  }

  function normalizeProgression(val) {
    if (val === "linear" || val === "manual" || val === "double") return val;
    return "double";
  }

  function progShort(prog) {
    prog = normalizeProgression(prog);
    if (prog === "linear") return "Linear";
    if (prog === "manual") return "Manual";
    return "Double";
  }

  function progHint(prog) {
    prog = normalizeProgression(prog);
    if (prog === "linear") return "Add the increment each session.";
    if (prog === "manual") return "Pick the load when you log.";
    return "Hit rep max on all sets, then add load.";
  }

  function programKindLabel(p) {
    if (p.kind === "percent_cycle") return "4-week % cycle";
    if (p.kind === "pullup_wave") return "Pull-up wave";
    if (p.kind === "dip_wave") return "Dip wave";
    var n = (p.days && p.days.length) || 0;
    return n + " day" + (n === 1 ? "" : "s");
  }

  function isWaveProgram(p) {
    return !!(SL.store.isRepWave && SL.store.isRepWave(p));
  }

  function daySummaryLine(day, catalog) {
    var exs = (day && day.exercises) || [];
    if (!exs.length) return "No exercises yet";
    var parts = [];
    var limit = Math.min(exs.length, 3);
    for (var i = 0; i < limit; i++) {
      var ex = exs[i];
      var name = exerciseName(ex.exerciseId, catalog);
      parts.push(name + " " + ex.sets + "×" + ex.repMin + "–" + ex.repMax);
    }
    if (exs.length > 3) parts.push("+" + (exs.length - 3) + " more");
    return parts.join(" · ");
  }

  function sortProgramsForList(programs) {
    var active = [];
    var rest = [];
    for (var i = 0; i < programs.length; i++) {
      if (programs[i].active) active.push(programs[i]);
      else rest.push(programs[i]);
    }
    return active.concat(rest);
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

  function bindListActions(root) {
    root.querySelectorAll("[data-action]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        var action = el.getAttribute("data-action");
        var id = el.getAttribute("data-id");
        if (action === "set-active") {
          SL.store.setActiveProgram(id);
          refresh();
        } else if (action === "edit") {
          openProgram(id);
        } else if (action === "delete") {
          if (!confirm("Delete this program?")) return;
          if (state.programId === id) {
            state.mode = "list";
            state.programId = null;
            state.dayIndex = null;
          }
          SL.store.deleteProgram(id);
          refresh();
        }
      });
    });
  }

  function openProgram(id) {
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
    } else if (prog && isWaveProgram(prog)) {
      state.mode = "wave-status";
      state.programId = id;
    } else {
      state.mode = "edit";
      state.programId = id;
      state.dayIndex = null;
    }
    refresh();
  }

  function renderProgramRow(p) {
    var metaLabel = programKindLabel(p);
    var html = "";
    html +=
      '<div class="session-card" data-action="edit" data-id="' +
      esc(p.id) +
      '" role="button" tabindex="0">';
    html += '<div class="head">';
    html += '<span class="date">' + esc(p.name || "Program");
    if (p.active) html += ' <span class="badge green">Active</span>';
    html += "</span>";
    html += '<span class="muted small">' + esc(metaLabel) + "</span>";
    html += "</div>";
    if (p.active) {
      html += '<p class="muted small" style="margin:0 0 8px">Drives Home and Start workout.</p>';
    }
    html += '<div class="row wrap" style="margin-top:4px">';
    if (!p.active) {
      html +=
        '<button type="button" class="btn sm" data-action="set-active" data-id="' +
        esc(p.id) +
        '">Set active</button>';
    }
    html +=
      '<button type="button" class="btn sm secondary" data-action="edit" data-id="' +
      esc(p.id) +
      '">Edit</button>';
    html +=
      '<button type="button" class="btn sm danger" data-action="delete" data-id="' +
      esc(p.id) +
      '">Delete</button>';
    html += "</div></div>";
    return html;
  }

  function renderList(root) {
    var programs = SL.store.listPrograms();
    var ordered = sortProgramsForList(programs);
    var hasActive = false;
    for (var a = 0; a < programs.length; a++) {
      if (programs[a].active) {
        hasActive = true;
        break;
      }
    }

    var html = "";

    if (!programs.length) {
      html += '<div class="card">';
      html += '<div class="empty-state" style="padding:28px 12px">';
      html += '<div class="title">No program yet</div>';
      html +=
        '<p class="hint">Load the starter template or create a program — Home needs one to show your next load.</p>';
      html += '<div class="actions">';
      html += '<button type="button" class="btn block" id="prog-starter">Load starter template</button>';
      html +=
        '<button type="button" class="btn block secondary" id="prog-create-empty">Create program</button>';
      html += "</div></div></div>";
    } else {
      if (!hasActive) {
        html += '<div class="card">';
        html +=
          '<p class="muted" style="margin:0 0 10px"><strong style="color:var(--amber)">No active program</strong> — Home and Start workout need one.</p>';
        html +=
          '<p class="muted small" style="margin:0">Tap <strong>Set active</strong> on a program below.</p>';
        html += "</div>";
      }

      html += '<div class="card">';
      html += "<h2>Programs</h2>";
      html +=
        '<p class="muted small" style="margin:0 0 12px">Tap a row to edit. Only the active program drives Home.</p>';
      for (var i = 0; i < ordered.length; i++) {
        html += renderProgramRow(ordered[i]);
      }
      html += "</div>";
    }

    html += '<div class="card">';
    html += "<h2>Create</h2>";
    html +=
      '<p class="muted small" style="margin:0 0 10px">Blank program — add days and lifts yourself.</p>';
    html += '<label class="field"><span class="lbl">Program name</span>';
    html += '<input type="text" id="prog-new-name" placeholder="e.g. Pull + Dip block" /></label>';
    html += '<button type="button" class="btn block" id="prog-create">Create program</button>';
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Templates</h2>";
    html +=
      '<p class="muted small" style="margin:0 0 12px">Ready-made blocks. Each activates on create.</p>';
    if (programs.length) {
      html +=
        '<button type="button" class="btn block secondary" id="prog-starter" style="margin-bottom:10px">Load starter template</button>';
      html +=
        '<p class="muted small" style="margin:0 0 14px">2-day double progression: pull-ups + dips (face pull if available).</p>';
    } else {
      html +=
        '<p class="muted small" style="margin:0 0 14px">Starter is in the empty state above.</p>';
    }
    html += '<hr class="weld" />';
    html +=
      '<p class="muted" style="margin:0 0 12px">4-week squat peaking cycle. Enter your target 1RM; every session load comes from %.</p>';
    html +=
      '<button type="button" class="btn block" id="prog-squat-cycle">Squat 1RM cycle (4 weeks)</button>';
    html += '<hr class="weld" />';
    html +=
      '<p class="muted" style="margin:0 0 12px">Wave programs: start weight for the first micro (3×10). Advance +2.5 kg or drop reps (10→6→3). Intensive 3 sets / Volume 6 sets.</p>';
    html +=
      '<button type="button" class="btn block" id="prog-pullup-wave" style="margin-bottom:10px">Pull-up wave (start weight)</button>';
    html +=
      '<button type="button" class="btn block" id="prog-dip-wave">Dip wave (start weight)</button>';
    html += "</div>";

    root.innerHTML = html;

    function createBlankProgram() {
      var input = root.querySelector("#prog-new-name");
      var name = (input && input.value ? input.value : "").trim();
      if (!name) {
        if (input) {
          input.focus();
          return;
        }
        name = "New program";
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
    }

    var createBtn = root.querySelector("#prog-create");
    if (createBtn) createBtn.addEventListener("click", createBlankProgram);

    var createEmpty = root.querySelector("#prog-create-empty");
    if (createEmpty) {
      createEmpty.addEventListener("click", function () {
        var input = root.querySelector("#prog-new-name");
        if (input) input.focus();
        else createBlankProgram();
      });
    }

    var starter = root.querySelector("#prog-starter");
    if (starter) {
      starter.addEventListener("click", function () {
        loadStarterTemplate();
      });
    }

    root.querySelector("#prog-squat-cycle").addEventListener("click", function () {
      state.mode = "squat-cycle";
      state.programId = null;
      refresh();
    });

    root.querySelector("#prog-pullup-wave").addEventListener("click", function () {
      state.mode = "wave-create";
      state.waveKind = "pullup_wave";
      state.programId = null;
      refresh();
    });

    root.querySelector("#prog-dip-wave").addEventListener("click", function () {
      state.mode = "wave-create";
      state.waveKind = "dip_wave";
      state.programId = null;
      refresh();
    });

    bindListActions(root);
  }

  function waveCreateConfig(kind) {
    if (kind === "dip_wave") {
      return {
        kind: "dip_wave",
        exerciseId: "dip",
        title: "Dip wave",
        schemeId: "dip-wave",
        namePrefix: "Dip wave",
      };
    }
    return {
      kind: "pullup_wave",
      exerciseId: "pullup",
      title: "Pull-up wave",
      schemeId: "pullup-wave",
      namePrefix: "Pull-up wave",
    };
  }

  function renderWaveCreateForm(root) {
    var cfg = waveCreateConfig(state.waveKind || "pullup_wave");
    var unit = settingsUnit();
    var html = '<div class="card">';
    html +=
      '<button type="button" class="btn sm secondary" id="wave-cancel" style="margin-bottom:12px">Back to programs</button>';
    html += "<h2>" + esc(cfg.title) + "</h2>";
    html +=
      '<p class="muted" style="margin-bottom:14px">One input: start weight for the first micro (phase 3×10). Intensive 3 sets / Volume 6 sets follow the wave. You choose when to +2.5 kg or drop reps.</p>';
    html +=
      '<label class="field"><span class="lbl">Start weight — first micro (' +
      esc(unit) +
      ')</span><input type="number" id="wave-start" min="0" step="0.5" inputmode="decimal" placeholder="e.g. 20" autofocus /></label>';
    html += '<div class="stack" style="margin-top:8px">';
    html += '<button type="button" class="btn block" id="wave-create">Create program</button>';
    html += "</div></div>";
    root.innerHTML = html;

    root.querySelector("#wave-cancel").addEventListener("click", function () {
      state.mode = "list";
      state.waveKind = null;
      refresh();
    });

    root.querySelector("#wave-create").addEventListener("click", function () {
      var input = root.querySelector("#wave-start");
      var raw = input && input.value;
      var n = Number(raw);
      if (!isFinite(n) || n < 0) {
        if (input) input.focus();
        return;
      }
      var startKg = unit === "lb" ? n / KG_TO_LB : n;
      startKg = Math.round(startKg * 100) / 100;
      SL.store
        .loadWaveScheme(cfg.kind)
        .then(function (scheme) {
          var program = {
            id: uid(),
            name: cfg.namePrefix + " — " + kgToDisplay(startKg, unit) + " " + unit,
            active: false,
            kind: cfg.kind,
            exerciseId: cfg.exerciseId,
            startLoadKg: startKg,
            intensiveLoadKg: startKg,
            phaseIndex: 0,
            microStepKg: 2.5,
            nextWaveDay: "intensive",
            schemeId: (scheme && scheme.id) || cfg.schemeId,
            days: [],
          };
          SL.store.upsertProgram(program);
          SL.store.setActiveProgram(program.id);
          state.mode = "wave-status";
          state.programId = program.id;
          state.waveScheme = scheme;
          state.waveKind = cfg.kind;
          refresh();
        })
        .catch(function (err) {
          root.innerHTML =
            '<div class="card"><p class="muted">Could not load ' +
            esc(cfg.title.toLowerCase()) +
            ": " +
            esc((err && err.message) || "error") +
            '</p><button type="button" class="btn block" id="wave-back">Back to programs</button></div>';
          root.querySelector("#wave-back").addEventListener("click", function () {
            state.mode = "list";
            refresh();
          });
        });
    });
  }

  function renderWaveStatus(root) {
    var program = getEditingProgram();
    if (!program || !isWaveProgram(program)) {
      state.mode = "list";
      renderList(root);
      return;
    }
    var unit = settingsUnit();
    var lift =
      (SL.store.waveLiftLabel && SL.store.waveLiftLabel(program)) || "Pull-up";

    function paint(scheme) {
      state.waveScheme = scheme;
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
      html +=
        '<button type="button" class="btn sm secondary" id="wave-back-list" style="margin-bottom:12px">Back to programs</button>';
      html += '<div class="spread"><h2 style="margin:0">' + esc(program.name) + "</h2>";
      if (program.active) html += '<span class="badge green">Active</span>';
      html += "</div>";
      if (!program.active) {
        html +=
          '<p class="muted small" style="margin:8px 0 0">Not on Home yet — set active when you want this wave.</p>';
      } else {
        html +=
          '<p class="muted small" style="margin:8px 0 0">Active — drives Home and Start workout.</p>';
      }
      html +=
        '<p class="muted" style="margin:12px 0 14px">' +
        esc(lift) +
        " · Macro: 10 → 6 → 3 · Micro: +2.5 kg until you drop reps</p>";
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
          '<div class="session-card" style="margin-bottom:8px;cursor:default"><div class="head"><span class="date">Intensive</span><span class="muted small">3 sets</span></div>';
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
          '<div class="session-card" style="margin-bottom:8px;cursor:default"><div class="head"><span class="date">Volume</span><span class="muted small">6 sets</span></div>';
        html +=
          '<div class="pr-row"><div class="name">' +
          esc(vx.sets + "×" + vx.reps) +
          '</div><div class="value">' +
          esc(kgToDisplay(vx.loadKg, unit) + " " + unit) +
          "</div></div></div>";
      }
      if (next) {
        html +=
          '<p class="muted small" style="margin:10px 0">Suggested next: <strong>' +
          esc(next.name) +
          "</strong></p>";
      }

      var prefer =
        program.nextWaveDay === "volume"
          ? "volume"
          : program.nextWaveDay === "intensive"
            ? "intensive"
            : next
              ? next.waveDay
              : "intensive";

      html += '<hr class="weld" />';
      html += "<h3 style=\"margin:0 0 8px\">Start day</h3>";
      html +=
        '<p class="muted small" style="margin:0 0 10px">Pick Intensive or Volume for the next workout. New micro/macro defaults to Intensive.</p>';
      html += '<div class="row wrap" style="margin-bottom:4px">';
      html +=
        '<button type="button" class="btn grow' +
        (prefer === "intensive" ? "" : " secondary") +
        '" id="wave-prefer-intensive">Intensive</button>';
      html +=
        '<button type="button" class="btn grow' +
        (prefer === "volume" ? "" : " secondary") +
        '" id="wave-prefer-volume">Volume</button>';
      html += "</div>";

      html += '<hr class="weld" />';
      html += '<div class="stack">';
      html +=
        '<button type="button" class="btn block" id="wave-micro">Next micro (+2.5 kg)</button>';
      html +=
        '<button type="button" class="btn block secondary" id="wave-micro-back">Previous micro (−2.5 kg)</button>';
      if (!atPeak) {
        html +=
          '<button type="button" class="btn block secondary" id="wave-macro">End micro / next macro (drop reps)</button>';
      } else {
        html +=
          '<p class="muted small">At final phase 3×3 — keep micro (+2.5 kg) or start a new cycle.</p>';
      }
      if (idx > 0) {
        html +=
          '<button type="button" class="btn block secondary" id="wave-macro-back">Previous macro (raise reps)</button>';
      }
      html += "</div>";
      if (!program.active) {
        html +=
          '<button type="button" class="btn block" id="wave-activate" style="margin-top:14px">Set active</button>';
      }
      html += "</div>";
      root.innerHTML = html;

      root.querySelector("#wave-back-list").addEventListener("click", function () {
        state.mode = "list";
        state.programId = null;
        refresh();
      });
      var act = root.querySelector("#wave-activate");
      if (act) {
        act.addEventListener("click", function () {
          SL.store.setActiveProgram(program.id);
          refresh();
        });
      }
      root.querySelector("#wave-prefer-intensive").addEventListener("click", function () {
        SL.store.setPullupNextWaveDay(program.id, "intensive");
        var updated = getEditingProgram();
        if (updated) program = updated;
        paint(scheme);
      });
      root.querySelector("#wave-prefer-volume").addEventListener("click", function () {
        SL.store.setPullupNextWaveDay(program.id, "volume");
        var updated = getEditingProgram();
        if (updated) program = updated;
        paint(scheme);
      });
      root.querySelector("#wave-micro").addEventListener("click", function () {
        SL.store.advancePullupMicro(program.id);
        var updated = getEditingProgram();
        if (updated) program = updated;
        paint(scheme);
      });
      root.querySelector("#wave-micro-back").addEventListener("click", function () {
        SL.store.retreatPullupMicro(program.id);
        var updated = getEditingProgram();
        if (updated) program = updated;
        paint(scheme);
      });
      var macroBtn = root.querySelector("#wave-macro");
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
      var macroBack = root.querySelector("#wave-macro-back");
      if (macroBack) {
        macroBack.addEventListener("click", function () {
          SL.store.retreatPullupMacro(program.id);
          var updated = getEditingProgram();
          if (updated) program = updated;
          paint(scheme);
        });
      }
    }

    var cached = state.waveScheme || state.pullupScheme;
    if (cached && cached.exerciseId === (program.exerciseId || cached.exerciseId)) {
      // Prefer matching scheme; fall through to load if wrong lift cached
      if (
        (program.kind === "dip_wave" && cached.id === "dip-wave") ||
        (program.kind === "pullup_wave" && cached.id === "pullup-wave") ||
        cached.exerciseId === program.exerciseId
      ) {
        paint(cached);
        return;
      }
    }
    root.innerHTML = '<div class="card"><p class="muted">Loading wave…</p></div>';
    SL.store
      .loadWaveScheme(program)
      .then(paint)
      .catch(function (err) {
        root.innerHTML =
          '<div class="card"><p class="muted">' +
          esc((err && err.message) || "Failed to load") +
          '</p><button type="button" class="btn block" id="wave-back-list">Back to programs</button></div>';
        root.querySelector("#wave-back-list").addEventListener("click", function () {
          state.mode = "list";
          refresh();
        });
      });
  }

  function renderSquatCycleForm(root) {
    var unit = settingsUnit();
    var html = '<div class="card">';
    html +=
      '<button type="button" class="btn sm secondary" id="squat-cancel" style="margin-bottom:12px">Back to programs</button>';
    html += "<h2>Squat 1RM cycle</h2>";
    html +=
      '<p class="muted" style="margin-bottom:14px">Target one-rep max for the next four weeks. Every session load is scheduled from that goal.</p>';
    html +=
      '<label class="field"><span class="lbl">Target 1RM (' +
      esc(unit) +
      ')</span><input type="number" id="squat-target" min="1" step="0.5" inputmode="decimal" placeholder="e.g. 125" /></label>';
    html +=
      '<label class="field"><span class="lbl">Start date (Week 1 Day 1)</span><input type="date" id="squat-start" value="' +
      esc(todayLocalISO()) +
      '" /></label>';
    html += '<div class="stack" style="margin-top:8px">';
    html += '<button type="button" class="btn block" id="squat-create">Create &amp; schedule</button>';
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
      SL.store
        .loadSquatCycleScheme()
        .then(function (scheme) {
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
        })
        .catch(function (err) {
          root.innerHTML =
            '<div class="card"><p class="muted">Could not load squat cycle: ' +
            esc((err && err.message) || "error") +
            '</p><button type="button" class="btn block" id="squat-back">Back to programs</button></div>';
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
      html +=
        '<button type="button" class="btn sm secondary" id="squat-back-list" style="margin-bottom:12px">Back to programs</button>';
      html += '<div class="spread"><h2 style="margin:0">' + esc(program.name) + "</h2>";
      if (program.active) html += '<span class="badge green">Active</span>';
      html += "</div>";
      if (!program.active) {
        html +=
          '<p class="muted small" style="margin:8px 0 0">Not on Home yet — set active to use this cycle.</p>';
      } else {
        html +=
          '<p class="muted small" style="margin:8px 0 0">Active — drives Home and Start workout.</p>';
      }
      html +=
        '<p class="muted" style="margin:12px 0">Target 1RM: <strong>' +
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
      html +=
        '<button type="button" class="btn secondary block" id="squat-apply" style="margin-bottom:14px">Update schedule</button>';

      var week = null;
      for (var i = 0; i < sessions.length; i++) {
        var sess = sessions[i];
        if (week !== sess.week) {
          if (week != null) html += "</div>";
          week = sess.week;
          html += '<div class="card" style="margin-top:10px"><h3>Week ' + esc(sess.week) + "</h3>";
        }
        html += '<div class="session-card" style="margin-top:8px;cursor:default">';
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

      if (!program.active) {
        html +=
          '<button type="button" class="btn block" id="squat-activate" style="margin-top:14px">Set active</button>';
      }
      html += "</div>";
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
      SL.store
        .loadSquatCycleScheme()
        .then(paint)
        .catch(function (err) {
          root.innerHTML =
            '<div class="card"><p class="muted">' +
            esc((err && err.message) || "Failed to load") +
            '</p><button type="button" class="btn block" id="squat-back-list">Back to programs</button></div>';
          root.querySelector("#squat-back-list").addEventListener("click", function () {
            state.mode = "list";
            refresh();
          });
        });
    }
  }

  function renderExerciseBlock(ex, idx, catalog, unit) {
    var prog = normalizeProgression(ex.progression);
    var html = "";
    html += '<div class="exercise-block" data-ex-idx="' + idx + '">';
    html += '<div class="ex-head">';
    html += '<span class="title">' + esc(exerciseName(ex.exerciseId, catalog)) + "</span>";
    html +=
      '<button type="button" class="btn sm danger" data-action="remove-ex" data-idx="' +
      idx +
      '">Remove</button>';
    html += "</div>";
    html +=
      '<p class="muted small" style="margin:0 0 10px">' +
      esc(ex.sets + " sets · " + ex.repMin + "–" + ex.repMax + " reps · " + progShort(prog)) +
      "</p>";

    html += '<div class="row wrap" style="align-items:flex-end">';
    html +=
      '<label class="field grow" style="min-width:4.5rem;margin-bottom:8px"><span class="lbl">Sets</span>' +
      '<input type="number" min="1" inputmode="numeric" data-field="sets" data-idx="' +
      idx +
      '" value="' +
      esc(ex.sets) +
      '" /></label>';
    html +=
      '<label class="field grow" style="min-width:4.5rem;margin-bottom:8px"><span class="lbl">Rep min</span>' +
      '<input type="number" min="1" inputmode="numeric" data-field="repMin" data-idx="' +
      idx +
      '" value="' +
      esc(ex.repMin) +
      '" /></label>';
    html +=
      '<label class="field grow" style="min-width:4.5rem;margin-bottom:8px"><span class="lbl">Rep max</span>' +
      '<input type="number" min="1" inputmode="numeric" data-field="repMax" data-idx="' +
      idx +
      '" value="' +
      esc(ex.repMax) +
      '" /></label>';
    html += "</div>";

    html +=
      '<label class="field"><span class="lbl">Progression</span><select data-field="progression" data-idx="' +
      idx +
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
      '<p class="muted small prog-hint" data-idx="' +
      idx +
      '" style="margin:-4px 0 10px">' +
      esc(progHint(prog)) +
      "</p>";

    html +=
      '<label class="field"><span class="lbl">Start load (' +
      esc(unit) +
      ")</span>" +
      '<input type="number" step="0.5" min="0" inputmode="decimal" data-field="startLoadKg" data-idx="' +
      idx +
      '" value="' +
      esc(kgToDisplay(ex.startLoadKg != null ? ex.startLoadKg : 0, unit) || "0") +
      '" /></label>';
    html +=
      '<label class="field linear-inc"' +
      (prog === "linear" ? "" : ' style="display:none"') +
      '><span class="lbl">Add each session (' +
      esc(unit) +
      ")</span>" +
      '<input type="number" step="0.5" min="0" inputmode="decimal" data-field="linearIncrementKg" data-idx="' +
      idx +
      '" value="' +
      esc(kgToDisplay(ex.linearIncrementKg != null ? ex.linearIncrementKg : 0, unit) || "0") +
      '" /></label>';
    html += "</div>";
    return html;
  }

  function renderDayEditor(root, program, dayIndex, catalog) {
    var day = program.days[dayIndex];
    if (!day) {
      state.dayIndex = null;
      renderEdit(root);
      return;
    }

    var unit = settingsUnit();
    var html = "";

    html += '<div class="card">';
    html +=
      '<button type="button" class="btn sm secondary" id="day-back" style="margin-bottom:12px">Back to program</button>';
    html +=
      '<p class="muted small" style="margin:0 0 6px">' +
      esc(program.name || "Program") +
      " · Day " +
      (dayIndex + 1) +
      "</p>";
    html += "<h2 style=\"margin:0 0 12px\">Edit day</h2>";
    html += '<label class="field"><span class="lbl">Day name</span>';
    html +=
      '<input type="text" id="day-name" value="' + esc(day.name || "") + '" /></label>';
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Exercises</h2>";
    if (!day.exercises || !day.exercises.length) {
      html += '<div class="empty-state" style="padding:24px 8px">';
      html += '<div class="title">No exercises yet</div>';
      html += '<p class="hint">Add a lift below to build this day.</p>';
      html += "</div>";
    } else {
      html +=
        '<p class="muted small" style="margin:0 0 12px">Sets and reps first. Progression picks how load moves.</p>';
      for (var i = 0; i < day.exercises.length; i++) {
        html += renderExerciseBlock(day.exercises[i], i, catalog, unit);
      }
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
            day.exercises[idx].progression = normalizeProgression(val);
          } else if (field === "sets" || field === "repMin" || field === "repMax") {
            var intN = parseInt(val, 10);
            day.exercises[idx][field] = isFinite(intN) && intN > 0 ? intN : 1;
          } else if (field === "startLoadKg" || field === "linearIncrementKg") {
            var disp = parseFloat(val);
            if (!isFinite(disp) || disp < 0) disp = 0;
            var kg = unit === "lb" ? disp / KG_TO_LB : disp;
            day.exercises[idx][field] = Math.round(kg * 100) / 100;
          }
        }
        var row = day.exercises[idx];
        if (row.repMin > row.repMax) {
          var swap = row.repMin;
          row.repMin = row.repMax;
          row.repMax = swap;
        }
        row.progression = normalizeProgression(row.progression);
        if (row.progression !== "linear") {
          row.linearIncrementKg = row.linearIncrementKg || 0;
        }
      }
    }

    function persistDay(goBack) {
      readDayFromDom();
      program.days[dayIndex] = day;
      SL.store.upsertProgram(program);
      if (goBack) state.dayIndex = null;
      refresh();
    }

    root.querySelector("#day-back").addEventListener("click", function () {
      persistDay(true);
    });

    root.querySelectorAll('[data-field="progression"]').forEach(function (sel) {
      sel.addEventListener("change", function () {
        var block = sel.closest(".exercise-block");
        var inc = block && block.querySelector(".linear-inc");
        if (inc) inc.style.display = sel.value === "linear" ? "" : "none";
        var hint = block && block.querySelector(".prog-hint");
        if (hint) hint.textContent = progHint(sel.value);
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
      if (!exId) {
        if (sel) sel.focus();
        return;
      }
      readDayFromDom();
      if (!day.exercises) day.exercises = [];
      day.exercises.push(progEx(exId, 3, 5, 8, "double", 0, 0));
      program.days[dayIndex] = day;
      SL.store.upsertProgram(program);
      refresh();
    });

    root.querySelector("#day-save").addEventListener("click", function () {
      persistDay(true);
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

    ensureExercises(function (catalog) {
      program = getEditingProgram();
      if (!program) {
        state.mode = "list";
        state.programId = null;
        renderList(root);
        return;
      }

      var html = "";
      html += '<div class="card">';
      html +=
        '<button type="button" class="btn sm secondary" id="prog-back" style="margin-bottom:12px">Back to programs</button>';
      html += '<p class="muted small" style="margin:0 0 6px">Programs · Edit</p>';
      html += "<h2 style=\"margin:0 0 12px\">" + esc(program.name || "Program") + "</h2>";
      html += '<label class="field"><span class="lbl">Name</span>';
      html +=
        '<input type="text" id="prog-name" value="' + esc(program.name || "") + '" /></label>';
      if (program.active) {
        html +=
          '<p class="muted" style="margin:8px 0 0"><span class="badge green">Active</span> Drives Home and Start workout.</p>';
      } else {
        html +=
          '<p class="muted small" style="margin:8px 0 10px">Not on Home yet.</p>';
        html +=
          '<button type="button" class="btn block" id="prog-set-active">Set active</button>';
      }
      html += "</div>";

      html += '<div class="card">';
      html +=
        '<div class="spread" style="margin-bottom:12px"><h2 style="margin:0">Days</h2>';
      html += '<button type="button" class="btn sm" id="prog-add-day">Add day</button></div>';

      if (!program.days || !program.days.length) {
        html += '<div class="empty-state" style="padding:24px 8px">';
        html += '<div class="title">No days yet</div>';
        html += '<p class="hint">Add a day, then stack exercises for that session.</p>';
        html += '<div class="actions">';
        html += '<button type="button" class="btn block" id="prog-add-day-empty">Add day</button>';
        html += "</div></div>";
      } else {
        html +=
          '<p class="muted small" style="margin:0 0 12px">Tap a day to edit lifts and progression.</p>';
        for (var i = 0; i < program.days.length; i++) {
          var d = program.days[i];
          var nEx = (d.exercises && d.exercises.length) || 0;
          html +=
            '<div class="session-card" data-action="edit-day" data-idx="' +
            i +
            '" role="button" tabindex="0">';
          html += '<div class="head">';
          html += '<span class="date">' + esc(d.name || "Day " + (i + 1)) + "</span>";
          html +=
            '<span class="muted small">' +
            nEx +
            " exercise" +
            (nEx === 1 ? "" : "s") +
            "</span>";
          html += "</div>";
          html +=
            '<p class="ex-line" style="margin:0 0 10px">' +
            esc(daySummaryLine(d, catalog)) +
            "</p>";
          html += '<div class="row wrap">';
          html +=
            '<button type="button" class="btn sm" data-action="edit-day" data-idx="' +
            i +
            '">Edit day</button>';
          html +=
            '<button type="button" class="btn sm danger" data-action="delete-day" data-idx="' +
            i +
            '">Delete</button>';
          html += "</div></div>";
        }
      }
      html += "</div>";

      html += '<button type="button" class="btn block" id="prog-save">Save program</button>';

      root.innerHTML = html;

      function addDay() {
        var nameEl = root.querySelector("#prog-name");
        if (nameEl) program.name = nameEl.value.trim() || program.name;
        if (!program.days) program.days = [];
        var n = program.days.length + 1;
        program.days.push({ id: uid(), name: "Day " + n, exercises: [] });
        SL.store.upsertProgram(program);
        state.dayIndex = program.days.length - 1;
        refresh();
      }

      root.querySelector("#prog-back").addEventListener("click", function () {
        var nameEl = root.querySelector("#prog-name");
        if (nameEl) {
          program.name = nameEl.value.trim() || program.name;
          SL.store.upsertProgram(program);
        }
        state.mode = "list";
        state.programId = null;
        state.dayIndex = null;
        refresh();
      });

      var setActiveBtn = root.querySelector("#prog-set-active");
      if (setActiveBtn) {
        setActiveBtn.addEventListener("click", function () {
          var nameEl = root.querySelector("#prog-name");
          if (nameEl) program.name = nameEl.value.trim() || program.name;
          SL.store.upsertProgram(program);
          SL.store.setActiveProgram(program.id);
          refresh();
        });
      }

      var addBtn = root.querySelector("#prog-add-day");
      if (addBtn) addBtn.addEventListener("click", addDay);
      var addEmpty = root.querySelector("#prog-add-day-empty");
      if (addEmpty) addEmpty.addEventListener("click", addDay);

      root.querySelectorAll('[data-action="edit-day"]').forEach(function (el) {
        el.addEventListener("click", function (e) {
          e.stopPropagation();
          state.dayIndex = Number(el.getAttribute("data-idx"));
          refresh();
        });
      });

      root.querySelectorAll('[data-action="delete-day"]').forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
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
    });
  }

  function render(root) {
    if (!root) return;
    if (state.mode === "squat-cycle") {
      renderSquatCycleForm(root);
    } else if (state.mode === "squat-schedule") {
      renderSquatSchedule(root);
    } else if (state.mode === "wave-create" || state.mode === "pullup-wave") {
      renderWaveCreateForm(root);
    } else if (state.mode === "wave-status" || state.mode === "pullup-status") {
      renderWaveStatus(root);
    } else if (state.mode === "edit") {
      renderEdit(root);
    } else {
      renderList(root);
    }
  }

  function title() {
    if (state.mode === "squat-cycle") return "Squat 1RM cycle";
    if (state.mode === "squat-schedule") return "Squat schedule";
    if (state.mode === "wave-create" || state.mode === "pullup-wave") {
      return waveCreateConfig(state.waveKind || "pullup_wave").title;
    }
    if (state.mode === "wave-status" || state.mode === "pullup-status") {
      var wp = getEditingProgram();
      if (wp && wp.kind === "dip_wave") return "Dip wave";
      return "Pull-up wave";
    }
    if (state.mode === "edit" && state.dayIndex != null) return "Edit day";
    if (state.mode === "edit") return "Edit program";
    return "Programs";
  }

  window.SL.views.program = {
    render: render,
    title: title,
  };
})();
