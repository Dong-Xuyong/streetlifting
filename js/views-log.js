/* Streetlifting — Log + History views */
(function () {
  "use strict";

  window.SL = window.SL || {};
  SL.views = SL.views || {};

  var KG_TO_LB = 2.2046226218;

  /** @type {object|null} */
  var draft = null;
  /** @type {string|null} */
  var historyDetailId = null;
  var overlayEl = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function uid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function settings() {
    var s = (SL.store.get() || {}).settings || {};
    return {
      unit: s.unit === "lb" ? "lb" : "kg",
      restSeconds: typeof s.restSeconds === "number" ? s.restSeconds : 180,
      bodyweightKg: s.bodyweightKg != null ? s.bodyweightKg : null,
    };
  }

  function kgToDisplay(kg, unit) {
    if (kg == null || kg === "" || isNaN(Number(kg))) return "";
    var n = Number(kg);
    var v = unit === "lb" ? n * KG_TO_LB : n;
    var r = Math.round(v * 100) / 100;
    return String(r);
  }

  function displayToKg(val, unit) {
    if (val === "" || val == null) return null;
    var n = Number(val);
    if (isNaN(n)) return null;
    return unit === "lb" ? n / KG_TO_LB : n;
  }

  function fmtWeight(kg, unit) {
    var t = kgToDisplay(kg, unit);
    if (t === "") return "—";
    return t + " " + unit;
  }

  function nextProgramDay(program) {
    var days = (program && program.days) || [];
    if (!days.length) return null;

    var sessions = SL.store.listSessions() || [];
    var lastDayId = null;
    for (var i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      if (!sess || !sess.dayId) continue;
      if (sess.programId && program && sess.programId !== program.id) continue;
      lastDayId = sess.dayId;
      break;
    }

    if (!lastDayId) return days[0];

    var idx = -1;
    for (var j = 0; j < days.length; j++) {
      if (days[j].id === lastDayId) {
        idx = j;
        break;
      }
    }
    if (idx < 0) return days[0];
    return days[(idx + 1) % days.length];
  }

  function emptyDraft() {
    var s = settings();
    return {
      id: uid(),
      dateISO: todayISO(),
      bodyweightKg: s.bodyweightKg,
      programId: null,
      dayId: null,
      dayName: null,
      sets: [],
    };
  }

  function setFromProgramEx(pe) {
    var targetReps =
      pe.repMin != null
        ? pe.repMin
        : pe.repMax != null
          ? pe.repMax
          : null;
    var repLabel =
      pe.repMin != null && pe.repMax != null
        ? pe.repMin === pe.repMax
          ? String(pe.repMin)
          : pe.repMin + "–" + pe.repMax
        : pe.repMin != null
          ? String(pe.repMin)
          : pe.repMax != null
            ? String(pe.repMax)
            : "";
    return {
      exerciseId: pe.exerciseId || "",
      loadKg: pe.startLoadKg != null ? pe.startLoadKg : null,
      reps: targetReps,
      rpe: null,
      completed: false,
      targetLoadKg: pe.startLoadKg != null ? pe.startLoadKg : null,
      targetRepsLabel: repLabel,
    };
  }

  function draftFromProgram(program, day) {
    var s = settings();
    var sets = [];
    var exercises = (day && day.exercises) || [];
    for (var i = 0; i < exercises.length; i++) {
      var pe = exercises[i];
      var count = pe.sets != null && pe.sets > 0 ? pe.sets : 1;
      for (var k = 0; k < count; k++) {
        sets.push(setFromProgramEx(pe));
      }
    }
    return {
      id: uid(),
      dateISO: todayISO(),
      bodyweightKg: s.bodyweightKg,
      programId: program ? program.id : null,
      dayId: day ? day.id : null,
      dayName: day ? day.name || null : null,
      week: null,
      dayNum: null,
      cycleKey: null,
      sets: sets,
    };
  }

  function draftFromCycleSession(program, session) {
    var s = settings();
    var sets = [];
    var exercises = (session && session.exercises) || [];
    for (var i = 0; i < exercises.length; i++) {
      var pe = exercises[i];
      var count = pe.sets != null && pe.sets > 0 ? pe.sets : 1;
      var repLabel = String(pe.reps != null ? pe.reps : "");
      if (pe.pctLabel) {
        repLabel =
          (pe.reps != null ? pe.reps : "?") +
          " @ " +
          pe.pctLabel +
          (pe.loadKgMax != null && pe.loadKgMax !== pe.loadKg
            ? " (" + pe.loadKg + "-" + pe.loadKgMax + " kg)"
            : "");
      }
      for (var k = 0; k < count; k++) {
        sets.push({
          exerciseId: pe.exerciseId || "squat",
          loadKg: pe.loadKg != null ? pe.loadKg : null,
          reps: pe.reps != null ? pe.reps : null,
          rpe: null,
          completed: false,
          targetLoadKg: pe.loadKg != null ? pe.loadKg : null,
          targetLoadKgMax: pe.loadKgMax != null ? pe.loadKgMax : null,
          targetRepsLabel: repLabel,
        });
      }
    }
    return {
      id: uid(),
      dateISO: (session && session.dateISO) || todayISO(),
      bodyweightKg: s.bodyweightKg,
      programId: program ? program.id : null,
      dayId: session ? session.id : null,
      dayName: session ? session.name || null : null,
      week: session ? session.week : null,
      dayNum: session ? session.day : null,
      cycleKey: session ? session.id : null,
      waveDay: null,
      phaseIndex: null,
      intensiveLoadKg: null,
      sets: sets,
    };
  }

  function draftFromPullupWaveSession(program, session) {
    var s = settings();
    var sets = [];
    var exercises = (session && session.exercises) || [];
    for (var i = 0; i < exercises.length; i++) {
      var pe = exercises[i];
      var count = pe.sets != null && pe.sets > 0 ? pe.sets : 1;
      var repLabel = pe.sets + "×" + pe.reps + " @ " + pe.loadKg + " kg";
      for (var k = 0; k < count; k++) {
        sets.push({
          exerciseId: pe.exerciseId || "pullup",
          loadKg: pe.loadKg != null ? pe.loadKg : null,
          reps: pe.reps != null ? pe.reps : null,
          rpe: null,
          completed: false,
          targetLoadKg: pe.loadKg != null ? pe.loadKg : null,
          targetRepsLabel: repLabel,
        });
      }
    }
    return {
      id: uid(),
      dateISO: todayISO(),
      bodyweightKg: s.bodyweightKg,
      programId: program ? program.id : null,
      dayId: session ? session.id : null,
      dayName: session ? session.name || null : null,
      week: null,
      dayNum: null,
      cycleKey: session ? session.id : null,
      waveDay: session ? session.waveDay : null,
      phaseIndex: session ? session.phaseIndex : null,
      intensiveLoadKg: session ? session.intensiveLoadKg : null,
      sets: sets,
    };
  }

  function draftFromSession(sess) {
    var sets = (sess.sets || []).map(function (set) {
      return {
        exerciseId: set.exerciseId || "",
        loadKg: set.loadKg != null ? set.loadKg : null,
        reps: set.reps != null ? set.reps : null,
        rpe: set.rpe != null ? set.rpe : null,
        completed: set.completed !== false,
        targetLoadKg: null,
        targetRepsLabel: "",
      };
    });
    return {
      id: sess.id,
      dateISO: sess.dateISO || todayISO(),
      bodyweightKg: sess.bodyweightKg != null ? sess.bodyweightKg : null,
      programId: sess.programId || null,
      dayId: sess.dayId || null,
      dayName: null,
      sets: sets,
    };
  }

  function shouldPrefill(opts) {
    if (SL.pendingStart) return true;
    if (opts && (opts.startFromProgram || opts.prefillProgram)) return true;
    return false;
  }

  function ensureDraft(opts, done) {
    if (opts && opts.sessionId) {
      var sessions = SL.store.listSessions() || [];
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id === opts.sessionId) {
          draft = draftFromSession(sessions[i]);
          SL.pendingStart = false;
          if (done) done(draft);
          return draft;
        }
      }
    }

    if (shouldPrefill(opts) || !draft) {
      var program = SL.store.getActiveProgram();

      if (shouldPrefill(opts) && program && program.kind === "percent_cycle") {
        SL.pendingStart = false;
        SL.store
          .loadSquatCycleScheme()
          .then(function (scheme) {
            var session = SL.store.nextCycleSession(program, scheme);
            draft = session
              ? draftFromCycleSession(program, session)
              : emptyDraft();
            if (done) done(draft);
            else if (typeof SL.refresh === "function") SL.refresh();
          })
          .catch(function () {
            draft = emptyDraft();
            if (done) done(draft);
            else if (typeof SL.refresh === "function") SL.refresh();
          });
        return draft;
      }

      if (shouldPrefill(opts) && program && program.kind === "pullup_wave") {
        SL.pendingStart = false;
        SL.store
          .loadPullupWaveScheme()
          .then(function (scheme) {
            var session = SL.store.currentPullupWaveSession(program, scheme, "next");
            draft = session
              ? draftFromPullupWaveSession(program, session)
              : emptyDraft();
            if (done) done(draft);
            else if (typeof SL.refresh === "function") SL.refresh();
          })
          .catch(function () {
            draft = emptyDraft();
            if (done) done(draft);
            else if (typeof SL.refresh === "function") SL.refresh();
          });
        return draft;
      }

      var day = null;
      if (opts && opts.dayId && program) {
        var days = program.days || [];
        for (var d = 0; d < days.length; d++) {
          if (days[d].id === opts.dayId) {
            day = days[d];
            break;
          }
        }
      }
      if (!day && program) day = nextProgramDay(program);

      if (shouldPrefill(opts) && program && day) {
        draft = draftFromProgram(program, day);
      } else if (!draft) {
        draft = emptyDraft();
        if (program && day && shouldPrefill(opts)) {
          draft.programId = program.id;
          draft.dayId = day.id;
          draft.dayName = day.name || null;
        }
      }
      SL.pendingStart = false;
    }
    if (done) done(draft);
    return draft;
  }

  function exerciseOptionsHtml(exercises, selectedId) {
    var html = '<option value="">Exercise</option>';
    for (var i = 0; i < exercises.length; i++) {
      var ex = exercises[i];
      var sel = ex.id === selectedId ? " selected" : "";
      html +=
        '<option value="' +
        esc(ex.id) +
        '"' +
        sel +
        ">" +
        esc(ex.name || ex.id) +
        "</option>";
    }
    return html;
  }

  function nameMap(exercises) {
    var map = {};
    for (var i = 0; i < exercises.length; i++) {
      map[exercises[i].id] = exercises[i].name || exercises[i].id;
    }
    return map;
  }

  function formatMmSs(sec) {
    var s = Math.max(0, Math.floor(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return String(m) + ":" + String(r).padStart(2, "0");
  }

  function ensureOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.id = "timer-overlay";
    overlayEl.className = "timer-overlay hidden";
    overlayEl.setAttribute("role", "dialog");
    overlayEl.setAttribute("aria-label", "Rest timer");
    overlayEl.innerHTML =
      '<div class="timer-label">Rest</div>' +
      '<div class="timer-display" data-timer-display>0:00</div>' +
      '<div class="timer-actions">' +
      '<button type="button" class="btn btn-primary" data-timer-skip>Skip rest</button>' +
      "</div>";
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-timer-skip") != null) {
        hideOverlay();
      }
    });
    return overlayEl;
  }

  function hideOverlay() {
    if (SL.timer) SL.timer.stop();
    var el = ensureOverlay();
    el.classList.add("hidden");
    var display = el.querySelector("[data-timer-display]");
    if (display) display.classList.remove("done");
  }

  function showRestTimer(seconds) {
    var el = ensureOverlay();
    var display = el.querySelector("[data-timer-display]");
    el.classList.remove("hidden");
    if (display) display.classList.remove("done");

    function tick(rem) {
      if (display) {
        display.textContent = formatMmSs(rem);
        if (rem <= 0) display.classList.add("done");
      }
    }

    SL.timer.start(seconds, tick, function () {
      if (display) {
        display.textContent = "0:00";
        display.classList.add("done");
      }
      setTimeout(function () {
        hideOverlay();
      }, 800);
    });
  }

  function renderSetBlocks(exercises, unit) {
    var sets = draft.sets || [];
    if (!sets.length) {
      return '<p class="muted">No sets yet. Add a set to begin.</p>';
    }

    var html =
      '<div class="set-head" style="grid-template-columns:1fr">' +
      "<span>Sets</span></div>";

    for (var i = 0; i < sets.length; i++) {
      var set = sets[i];
      var hint = "";
      if (set.targetRepsLabel || set.targetLoadKg != null) {
        hint =
          '<p class="muted small">Target: ' +
          esc(
            (set.targetLoadKg != null ? fmtWeight(set.targetLoadKg, unit) : "—") +
              (set.targetRepsLabel ? " × " + set.targetRepsLabel : "")
          ) +
          "</p>";
      }
      html +=
        '<div class="exercise-block" data-set-idx="' +
        i +
        '">' +
        '<div class="ex-head">' +
        '<select data-field="exerciseId" aria-label="Exercise">' +
        exerciseOptionsHtml(exercises, set.exerciseId) +
        "</select>" +
        '<button type="button" class="del-set" data-action="remove-set" aria-label="Remove set">&times;</button>' +
        "</div>" +
        hint +
        '<div class="set-head"><span>#</span><span>Load (' +
        esc(unit) +
        ")</span><span>Reps</span><span>RPE</span><span></span></div>" +
        '<div class="set-row">' +
        '<span class="set-num">' +
        (i + 1) +
        "</span>" +
        '<input type="number" class="load-num" inputmode="decimal" step="any" data-field="load" placeholder="0" value="' +
        esc(kgToDisplay(set.loadKg, unit)) +
        '" aria-label="Load" />' +
        '<input type="number" inputmode="numeric" step="1" data-field="reps" placeholder="0" value="' +
        esc(set.reps != null ? set.reps : "") +
        '" aria-label="Reps" />' +
        '<input type="number" inputmode="decimal" step="0.5" min="1" max="10" data-field="rpe" placeholder="—" value="' +
        esc(set.rpe != null ? set.rpe : "") +
        '" aria-label="RPE" />' +
        (set.completed
          ? '<span class="badge green" title="Completed">OK</span>'
          : '<button type="button" class="btn sm btn-primary" data-action="complete-set" aria-label="Complete set">Done</button>') +
        "</div>" +
        "</div>";
    }
    return html;
  }

  function onLogChange(e) {
    var root = e.currentTarget;
    if (!draft || root.getAttribute("data-sl-view") !== "log") return;
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.id === "log-date") {
      draft.dateISO = t.value || todayISO();
      return;
    }
    if (t.id === "log-bw") {
      draft.bodyweightKg = displayToKg(t.value, settings().unit);
      return;
    }
    if (t.id === "log-link-day") {
      if (!t.checked) {
        draft.programId = null;
        draft.dayId = null;
        draft.dayName = null;
        return;
      }
      var program = SL.store.getActiveProgram();
      var day = program ? nextProgramDay(program) : null;
      if (program && day) {
        draft.programId = program.id;
        draft.dayId = day.id;
        draft.dayName = day.name || null;
      }
      return;
    }

    var block = t.closest && t.closest("[data-set-idx]");
    if (!block) return;
    var idx = Number(block.getAttribute("data-set-idx"));
    if (!draft.sets[idx]) return;
    var field = t.getAttribute("data-field");
    var unit = settings().unit;
    if (field === "exerciseId") {
      draft.sets[idx].exerciseId = t.value;
    } else if (field === "load") {
      draft.sets[idx].loadKg = displayToKg(t.value, unit);
    } else if (field === "reps") {
      var reps = t.value === "" ? null : Number(t.value);
      draft.sets[idx].reps = reps != null && !isNaN(reps) ? reps : null;
    } else if (field === "rpe") {
      var rpe = t.value === "" ? null : Number(t.value);
      draft.sets[idx].rpe = rpe != null && !isNaN(rpe) ? rpe : null;
    }
  }

  function onLogClick(e) {
    var root = e.currentTarget;
    if (!draft || root.getAttribute("data-sl-view") !== "log") return;
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest("[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");

    if (action === "add-set") {
      draft.sets.push({
        exerciseId: "",
        loadKg: null,
        reps: null,
        rpe: null,
        completed: false,
        targetLoadKg: null,
        targetRepsLabel: "",
      });
      paintLog(root);
      return;
    }

    if (action === "save-session") {
      saveSession(false);
      return;
    }

    if (action === "complete-session") {
      saveSession(true);
      return;
    }

    if (action === "new-session") {
      draft = emptyDraft();
      paintLog(root);
      return;
    }

    if (action === "prefill-program") {
      SL.pendingStart = true;
      draft = null;
      var prog = SL.store.getActiveProgram();
      if (prog && (prog.kind === "percent_cycle" || prog.kind === "pullup_wave")) {
        root.innerHTML =
          '<div class="card"><p class="muted">Loading ' +
          (prog.kind === "pullup_wave" ? "pull-up" : "squat") +
          " session…</p></div>";
        ensureDraft({ startFromProgram: true }, function () {
          if (root.isConnected) paintLog(root);
        });
      } else {
        ensureDraft({ startFromProgram: true });
        paintLog(root);
      }
      return;
    }

    var block = btn.closest("[data-set-idx]");
    if (!block) return;
    var idx = Number(block.getAttribute("data-set-idx"));
    if (!draft.sets[idx]) return;

    if (action === "remove-set") {
      draft.sets.splice(idx, 1);
      paintLog(root);
      return;
    }

    if (action === "complete-set") {
      syncSetFromDom(block, idx);
      var set = draft.sets[idx];
      if (!set.exerciseId) {
        alert("Pick an exercise for this set.");
        return;
      }
      if (set.reps == null || set.reps === "") {
        alert("Enter reps before completing the set.");
        return;
      }
      set.completed = true;
      paintLog(root);
      var rest = settings().restSeconds;
      if (rest > 0 && SL.timer) showRestTimer(rest);
    }
  }

  function bindLog(root) {
    if (root.getAttribute("data-sl-log-bound") === "1") return;
    root.setAttribute("data-sl-log-bound", "1");
    root.addEventListener("change", onLogChange);
    root.addEventListener("click", onLogClick);
  }

  function syncSetFromDom(block, idx) {
    var unit = settings().unit;
    var set = draft.sets[idx];
    if (!set) return;
    var ex = block.querySelector('[data-field="exerciseId"]');
    var load = block.querySelector('[data-field="load"]');
    var reps = block.querySelector('[data-field="reps"]');
    var rpe = block.querySelector('[data-field="rpe"]');
    if (ex) set.exerciseId = ex.value;
    if (load) set.loadKg = displayToKg(load.value, unit);
    if (reps) {
      var r = reps.value === "" ? null : Number(reps.value);
      set.reps = r != null && !isNaN(r) ? r : null;
    }
    if (rpe) {
      var rp = rpe.value === "" ? null : Number(rpe.value);
      set.rpe = rp != null && !isNaN(rp) ? rp : null;
    }
  }

  function syncAllFromDom(root) {
    if (!draft || !root) return;
    var dateEl = root.querySelector("#log-date");
    var bwEl = root.querySelector("#log-bw");
    if (dateEl) draft.dateISO = dateEl.value || todayISO();
    if (bwEl) draft.bodyweightKg = displayToKg(bwEl.value, settings().unit);
    var blocks = root.querySelectorAll("[data-set-idx]");
    for (var i = 0; i < blocks.length; i++) {
      var idx = Number(blocks[i].getAttribute("data-set-idx"));
      syncSetFromDom(blocks[i], idx);
    }
  }

  function saveSession(markAllComplete) {
    var root = document.getElementById("view-root");
    syncAllFromDom(root);

    var outSets = [];
    for (var i = 0; i < draft.sets.length; i++) {
      var set = draft.sets[i];
      if (!set.exerciseId) continue;
      if (set.reps == null || set.reps === "") continue;
      var completed = markAllComplete ? true : !!set.completed;
      if (!completed && !markAllComplete) {
        // still include filled sets as completed when saving mid-workout
        completed = true;
      }
      var row = {
        exerciseId: set.exerciseId,
        loadKg: set.loadKg != null ? Number(set.loadKg) : 0,
        reps: Number(set.reps),
        completed: true,
      };
      if (set.rpe != null && set.rpe !== "") row.rpe = Number(set.rpe);
      outSets.push(row);
    }

    if (!outSets.length) {
      alert("Add at least one set with exercise and reps.");
      return;
    }

    var sess = {
      id: draft.id || uid(),
      dateISO: draft.dateISO || todayISO(),
      bodyweightKg: draft.bodyweightKg,
      sets: outSets,
    };
    if (draft.programId) sess.programId = draft.programId;
    if (draft.dayId) sess.dayId = draft.dayId;
    if (draft.week != null) sess.week = draft.week;
    if (draft.dayNum != null) sess.day = draft.dayNum;
    if (draft.cycleKey) sess.cycleKey = draft.cycleKey;
    if (draft.waveDay) sess.waveDay = draft.waveDay;
    if (draft.phaseIndex != null) sess.phaseIndex = draft.phaseIndex;
    if (draft.intensiveLoadKg != null) sess.intensiveLoadKg = draft.intensiveLoadKg;

    SL.store.upsertSession(sess);

    if (draft.bodyweightKg != null) {
      var data = SL.store.get();
      data.settings = data.settings || {};
      data.settings.bodyweightKg = draft.bodyweightKg;
      SL.store.save();
    }

    hideOverlay();
    draft = emptyDraft();
    if (typeof SL.navigate === "function") {
      SL.navigate("history");
    } else if (typeof SL.refresh === "function") {
      SL.refresh();
    }
  }

  function paintLog(root) {
    ensureOverlay();
    if (!draft) draft = emptyDraft();
    var s = settings();
    var unit = s.unit;
    var program = SL.store.getActiveProgram();
    var day =
      program && program.kind !== "percent_cycle" && program.kind !== "pullup_wave"
        ? nextProgramDay(program)
        : null;
    var linked = !!(draft.programId && (draft.dayId || draft.cycleKey || draft.waveDay));

    SL.store.listExercises().then(function (exercises) {
      if (SL.app && SL.app.currentTab && SL.app.currentTab !== "log") return;
      exercises = exercises || [];

      var linkHtml = "";
      if (program && program.kind === "percent_cycle" && linked) {
        linkHtml =
          '<p class="muted small">Linked to <strong>' +
          esc(draft.dayName || "squat cycle session") +
          "</strong></p>";
      } else if (program && program.kind === "pullup_wave" && linked) {
        linkHtml =
          '<p class="muted small">Linked to <strong>' +
          esc(draft.dayName || "pull-up wave session") +
          "</strong></p>";
      } else if (program && day) {
        linkHtml =
          '<label class="field row" style="align-items:center;gap:10px">' +
          '<input type="checkbox" id="log-link-day"' +
          (linked ? " checked" : "") +
          " />" +
          "<span>Link to " +
          esc(program.name || "program") +
          " — " +
          esc(day.name || "next day") +
          (draft.dayName && linked ? " (active: " + esc(draft.dayName) + ")" : "") +
          "</span></label>";
      } else {
        linkHtml =
          '<p class="muted small">No active program day to link. ' +
          '<button type="button" class="btn sm" data-action="prefill-program" ' +
          (program ? "" : "disabled") +
          ">Prefill from program</button></p>";
      }

      root.innerHTML =
        '<div class="stack stack-lg">' +
        '<div class="card">' +
        '<div class="card-head"><h2 class="card-title" style="margin:0">Session</h2>' +
        '<button type="button" class="btn sm" data-action="new-session">New</button></div>' +
        '<label class="field"><span class="lbl">Date</span>' +
        '<input type="date" id="log-date" value="' +
        esc(draft.dateISO || todayISO()) +
        '" /></label>' +
        '<label class="field"><span class="lbl">Bodyweight (' +
        esc(unit) +
        ")</span>" +
        '<input type="number" inputmode="decimal" step="any" id="log-bw" value="' +
        esc(kgToDisplay(draft.bodyweightKg, unit)) +
        '" placeholder="—" /></label>' +
        linkHtml +
        (linked && draft.dayName
          ? '<p class="muted small">Program day: <strong>' +
            esc(draft.dayName) +
            "</strong></p>"
          : "") +
        "</div>" +
        '<div class="card">' +
        "<h2>Sets</h2>" +
        renderSetBlocks(exercises, unit) +
        '<button type="button" class="btn block" data-action="add-set" style="margin-top:8px">Add set</button>' +
        "</div>" +
        '<div class="stack">' +
        '<button type="button" class="btn btn-primary block" data-action="complete-session">Complete session</button>' +
        '<button type="button" class="btn block" data-action="save-session">Save session</button>' +
        "</div>" +
        "</div>";

      root.setAttribute("data-sl-view", "log");
      bindLog(root);
    });
  }

  function renderLog(root, opts) {
    var program = SL.store.getActiveProgram();
    var starting =
      SL.pendingStart || (opts && opts.startFromProgram);
    if (
      starting &&
      program &&
      program.kind === "percent_cycle" &&
      (!draft || !draft.cycleKey)
    ) {
      root.innerHTML = '<div class="card"><p class="muted">Loading squat session…</p></div>';
      ensureDraft(opts || null, function () {
        if (root.isConnected) paintLog(root);
      });
      return;
    }
    if (
      starting &&
      program &&
      program.kind === "pullup_wave" &&
      (!draft || !draft.waveDay)
    ) {
      root.innerHTML = '<div class="card"><p class="muted">Loading pull-up session…</p></div>';
      ensureDraft(opts || null, function () {
        if (root.isConnected) paintLog(root);
      });
      return;
    }
    ensureDraft(opts || null);
    paintLog(root);
  }

  function sessionSummary(sess, names, unit) {
    var byEx = {};
    var sets = sess.sets || [];
    for (var i = 0; i < sets.length; i++) {
      var id = sets[i].exerciseId || "?";
      byEx[id] = (byEx[id] || 0) + 1;
    }
    var parts = [];
    for (var k in byEx) {
      if (!Object.prototype.hasOwnProperty.call(byEx, k)) continue;
      parts.push((names[k] || k) + " ×" + byEx[k]);
    }
    return parts.join(", ") || "No sets";
  }

  function onHistoryClick(e) {
    var root = e.currentTarget;
    if (root.getAttribute("data-sl-view") !== "history") return;
    var t = e.target;
    if (!t || !t.closest) return;

    var actionBtn = t.closest("[data-hist-action]");
    if (actionBtn) {
      var action = actionBtn.getAttribute("data-hist-action");
      if (action === "goto-log") {
        if (SL.navigate) SL.navigate("log");
        return;
      }
      if (action === "back") {
        historyDetailId = null;
        paintHistory(root);
        return;
      }
      if (action === "edit") {
        var editId = actionBtn.getAttribute("data-session-id") || historyDetailId;
        var sessions = SL.store.listSessions() || [];
        var sess = null;
        for (var i = 0; i < sessions.length; i++) {
          if (sessions[i].id === editId) {
            sess = sessions[i];
            break;
          }
        }
        if (!sess) return;
        historyDetailId = null;
        draft = draftFromSession(sess);
        if (SL.navigate) SL.navigate("log", { sessionId: sess.id });
        return;
      }
      if (action === "delete") {
        var delId = actionBtn.getAttribute("data-session-id") || historyDetailId;
        if (!delId) return;
        if (!confirm("Delete this session?")) return;
        SL.store.deleteSession(delId);
        historyDetailId = null;
        paintHistory(root);
        return;
      }
    }

    var item = t.closest("[data-session-id]");
    if (item && item.classList.contains("list-item")) {
      historyDetailId = item.getAttribute("data-session-id");
      paintHistory(root);
    }
  }

  function bindHistory(root) {
    if (root.getAttribute("data-sl-hist-bound") === "1") return;
    root.setAttribute("data-sl-hist-bound", "1");
    root.addEventListener("click", onHistoryClick);
  }

  function renderHistoryList(root, exercises) {
    var names = nameMap(exercises);
    var unit = settings().unit;
    var sessions = SL.store.listSessions() || [];

    root.setAttribute("data-sl-view", "history");
    bindHistory(root);

    if (!sessions.length) {
        root.innerHTML =
        '<div class="empty"><p class="title">No sessions yet</p>' +
        "<p>Complete a workout to build history here.</p>" +
        '<div class="actions"><button type="button" class="btn btn-primary" data-hist-action="goto-log">Start workout</button></div></div>';
      return;
    }

    var html = '<div class="stack">';
    for (var i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      var bw =
        sess.bodyweightKg != null ? fmtWeight(sess.bodyweightKg, unit) : "—";
      html +=
        '<button type="button" class="list-item session-card" data-session-id="' +
        esc(sess.id) +
        '">' +
        '<div class="name">' +
        esc(sess.dateISO || "Session") +
        '<div class="muted small">' +
        esc(sessionSummary(sess, names, unit)) +
        "</div></div>" +
        '<div class="meta">' +
        esc(bw) +
        '<br /><span class="chev">›</span></div>' +
        "</button>";
    }
    html += "</div>";
    root.innerHTML = html;
  }

  function renderHistoryDetail(root, exercises) {
    var names = nameMap(exercises);
    var unit = settings().unit;
    var sessions = SL.store.listSessions() || [];
    var sess = null;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id === historyDetailId) {
        sess = sessions[i];
        break;
      }
    }

    if (!sess) {
      historyDetailId = null;
      renderHistoryList(root, exercises);
      return;
    }

    var rows = "";
    var sets = sess.sets || [];
    for (var j = 0; j < sets.length; j++) {
      var set = sets[j];
      rows +=
        "<tr><td>" +
        esc(names[set.exerciseId] || set.exerciseId || "—") +
        "</td><td>" +
        esc(fmtWeight(set.loadKg, unit)) +
        "</td><td>" +
        esc(set.reps != null ? set.reps : "—") +
        "</td><td>" +
        esc(set.rpe != null ? set.rpe : "—") +
        "</td></tr>";
    }

    root.setAttribute("data-sl-view", "history");
    bindHistory(root);

    root.innerHTML =
      '<div class="stack stack-lg">' +
      '<button type="button" class="btn sm" data-hist-action="back">Back</button>' +
      '<div class="card">' +
      '<div class="card-head"><div class="date">' +
      esc(sess.dateISO || "") +
      "</div>" +
      '<span class="muted">' +
      esc(sess.bodyweightKg != null ? fmtWeight(sess.bodyweightKg, unit) : "bw —") +
      "</span></div>" +
      (sets.length
        ? '<table class="detail-set-table"><thead><tr><th>Exercise</th><th>Load</th><th>Reps</th><th>RPE</th></tr></thead><tbody>' +
          rows +
          "</tbody></table>"
        : '<p class="muted">No sets logged.</p>') +
      "</div>" +
      '<div class="stack">' +
      '<button type="button" class="btn btn-primary block" data-hist-action="edit" data-session-id="' +
      esc(sess.id) +
      '">Edit in Log</button>' +
      '<button type="button" class="btn btn-danger block" data-hist-action="delete" data-session-id="' +
      esc(sess.id) +
      '">Delete session</button>' +
      "</div></div>";
  }

  function paintHistory(root) {
    SL.store.listExercises().then(function (exercises) {
      if (SL.app && SL.app.currentTab && SL.app.currentTab !== "history") return;
      exercises = exercises || [];
      if (historyDetailId) renderHistoryDetail(root, exercises);
      else renderHistoryList(root, exercises);
    });
  }

  function renderHistory(root, opts) {
    if (opts && opts.sessionId) historyDetailId = opts.sessionId;
    paintHistory(root);
  }

  SL.views.log = {
    render: renderLog,
    title: function () {
      return "Log";
    },
  };

  SL.views.history = {
    render: renderHistory,
    title: function () {
      return "History";
    },
  };
})();
