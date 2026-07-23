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
  /** @type {{y:number,m:number}|null} month is 0-based */
  var calMonth = null;
  /** @type {string|null} YYYY-MM-DD */
  var calSelectedISO = null;
  var overlayEl = null;
  /** @type {number|null} after complete-set, scroll toward next open set */
  var pendingScrollSetIdx = null;
  var doneHideTimer = null;

  function ensureNotes(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (typeof obj.note !== "string") obj.note = obj.note != null ? String(obj.note) : "";
    if (!obj.sectionNotes || typeof obj.sectionNotes !== "object") obj.sectionNotes = {};
    return obj;
  }

  function monthLabel(y, m) {
    var names = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return names[m] + " " + y;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function isoFromYMD(y, m, d) {
    return y + "-" + pad2(m + 1) + "-" + pad2(d);
  }

  function parseISODate(iso) {
    if (!iso || typeof iso !== "string") return null;
    var p = iso.split("-");
    if (p.length < 3) return null;
    var y = Number(p[0]);
    var m = Number(p[1]) - 1;
    var d = Number(p[2]);
    if (!y || m < 0 || m > 11 || !d) return null;
    return { y: y, m: m, d: d };
  }

  function ensureCalMonth() {
    if (calMonth) return calMonth;
    var now = new Date();
    calMonth = { y: now.getFullYear(), m: now.getMonth() };
    return calMonth;
  }

  function sessionsByDate() {
    var map = {};
    var sessions = SL.store.listSessions() || [];
    for (var i = 0; i < sessions.length; i++) {
      var iso = sessions[i].dateISO || "";
      if (!iso) continue;
      if (!map[iso]) map[iso] = [];
      map[iso].push(sessions[i]);
    }
    return map;
  }

  function uniqueExerciseIds(sets) {
    var ids = [];
    var seen = {};
    for (var i = 0; i < (sets || []).length; i++) {
      var id = sets[i].exerciseId;
      if (!id || seen[id]) continue;
      seen[id] = true;
      ids.push(id);
    }
    return ids;
  }

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
      note: "",
      sectionNotes: {},
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
      note: "",
      sectionNotes: {},
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
      note: "",
      sectionNotes: {},
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
      note: "",
      sectionNotes: {},
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
    var notes = {};
    if (sess.sectionNotes && typeof sess.sectionNotes === "object") {
      for (var k in sess.sectionNotes) {
        if (Object.prototype.hasOwnProperty.call(sess.sectionNotes, k)) {
          notes[k] = String(sess.sectionNotes[k] == null ? "" : sess.sectionNotes[k]);
        }
      }
    }
    return {
      id: sess.id,
      dateISO: sess.dateISO || todayISO(),
      bodyweightKg: sess.bodyweightKg != null ? sess.bodyweightKg : null,
      programId: sess.programId || null,
      dayId: sess.dayId || null,
      dayName: null,
      note: typeof sess.note === "string" ? sess.note : "",
      sectionNotes: notes,
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
      if (opts && opts.programId) {
        SL.store.setActiveProgram(opts.programId);
      }
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

      if (
        shouldPrefill(opts) &&
        program &&
        ((SL.store.isRepWave && SL.store.isRepWave(program)) ||
          program.kind === "pullup_wave" ||
          program.kind === "dip_wave")
      ) {
        SL.pendingStart = false;
        var which =
          opts && (opts.waveDay === "intensive" || opts.waveDay === "volume")
            ? opts.waveDay
            : "next";
        SL.store
          .loadWaveScheme(program)
          .then(function (scheme) {
            if (which === "intensive" || which === "volume") {
              SL.store.setPullupNextWaveDay(program.id, which);
            }
            var session = SL.store.currentPullupWaveSession(program, scheme, which);
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
    overlayEl.setAttribute("aria-modal", "true");
    overlayEl.setAttribute("aria-label", "Rest timer");
    overlayEl.innerHTML =
      '<div class="timer-label" data-timer-label>Rest</div>' +
      '<div class="timer-display" data-timer-display aria-live="polite">0:00</div>' +
      '<div class="timer-actions">' +
      '<button type="button" class="btn secondary" data-timer-add>+30s</button>' +
      '<button type="button" class="btn btn-primary" data-timer-skip>Skip rest</button>' +
      "</div>";
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-timer-skip]")) {
        hideOverlay();
        return;
      }
      if (t.closest("[data-timer-add]")) {
        var addSec = 30;
        var cur = SL.timer && typeof SL.timer.remaining === "function" ? SL.timer.remaining() : 0;
        if (cur < 0) cur = 0;
        showRestTimer(cur + addSec);
      }
    });
    return overlayEl;
  }

  function setOverlayDone(isDone) {
    var el = ensureOverlay();
    var display = el.querySelector("[data-timer-display]");
    var label = el.querySelector("[data-timer-label]");
    var skip = el.querySelector("[data-timer-skip]");
    if (display) {
      if (isDone) display.classList.add("done");
      else display.classList.remove("done");
    }
    if (label) label.textContent = isDone ? "Rest done" : "Rest";
    if (skip) skip.textContent = isDone ? "Continue" : "Skip rest";
  }

  function hideOverlay() {
    if (doneHideTimer) {
      clearTimeout(doneHideTimer);
      doneHideTimer = null;
    }
    if (SL.timer) SL.timer.stop();
    var el = ensureOverlay();
    el.classList.add("hidden");
    setOverlayDone(false);
    var display = el.querySelector("[data-timer-display]");
    if (display) display.textContent = "0:00";
  }

  function showRestTimer(seconds) {
    if (doneHideTimer) {
      clearTimeout(doneHideTimer);
      doneHideTimer = null;
    }
    var el = ensureOverlay();
    var display = el.querySelector("[data-timer-display]");
    el.classList.remove("hidden");
    setOverlayDone(false);

    function tick(rem) {
      if (display) {
        display.textContent = formatMmSs(rem);
        if (rem <= 0) setOverlayDone(true);
        else setOverlayDone(false);
      }
    }

    SL.timer.start(seconds, tick, function () {
      if (display) {
        display.textContent = "0:00";
        setOverlayDone(true);
      }
      // Hold long enough for CSS .done pulse (2 × 0.55s) to read on the floor
      doneHideTimer = setTimeout(function () {
        doneHideTimer = null;
        hideOverlay();
      }, 1400);
    });
  }

  function renderSetBlocks(exercises, unit) {
    var sets = draft.sets || [];
    if (!sets.length) {
      return '<p class="muted">No sets yet. Add a set to begin.</p>';
    }

    ensureNotes(draft);
    var seenNote = {};
    var names = nameMap(exercises);
    var html = '<div class="stack">';

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
      var showSectionNote = !!(set.exerciseId && !seenNote[set.exerciseId]);
      if (showSectionNote) seenNote[set.exerciseId] = true;
      var sectionVal =
        set.exerciseId && draft.sectionNotes[set.exerciseId]
          ? draft.sectionNotes[set.exerciseId]
          : "";
      var hasSectionNote = !!(sectionVal && String(sectionVal).trim());
      var noteOpen = hasSectionNote;
      var exLabel = names[set.exerciseId] || set.exerciseId || "exercise";

      html +=
        '<div class="exercise-block" data-set-idx="' +
        i +
        '"' +
        (set.completed ? ' data-completed="1"' : "") +
        ">" +
        '<div class="ex-head">' +
        '<select data-field="exerciseId" aria-label="Exercise for set ' +
        (i + 1) +
        '">' +
        exerciseOptionsHtml(exercises, set.exerciseId) +
        "</select>" +
        '<button type="button" class="icon-btn del-set" data-action="remove-set" aria-label="Remove set ' +
        (i + 1) +
        '">&times;</button>' +
        "</div>" +
        hint +
        '<div class="row wrap" style="gap:10px;align-items:flex-end">' +
        '<label class="field grow" style="margin:0;min-width:40%">' +
        '<span class="lbl">Load (' +
        esc(unit) +
        ")</span>" +
        '<input type="number" class="load-num" inputmode="decimal" step="any" enterkeyhint="next" data-field="load" placeholder="0" value="' +
        esc(kgToDisplay(set.loadKg, unit)) +
        '" aria-label="Load in ' +
        esc(unit) +
        '" /></label>' +
        '<label class="field grow" style="margin:0;min-width:28%">' +
        '<span class="lbl">Reps</span>' +
        '<input type="number" inputmode="numeric" step="1" enterkeyhint="done" data-field="reps" placeholder="0" value="' +
        esc(set.reps != null ? set.reps : "") +
        '" aria-label="Reps" /></label>' +
        '<label class="field" style="margin:0;width:72px;flex:0 0 72px">' +
        '<span class="lbl">RPE</span>' +
        '<input type="number" inputmode="decimal" step="0.5" min="1" max="10" data-field="rpe" placeholder="—" value="' +
        esc(set.rpe != null ? set.rpe : "") +
        '" aria-label="RPE" /></label>' +
        "</div>" +
        (set.completed
          ? '<div class="row spread" style="margin-top:10px">' +
            '<span class="muted small">Set ' +
            (i + 1) +
            "</span>" +
            '<span class="badge green">Completed</span></div>'
          : '<button type="button" class="btn btn-primary block" data-action="complete-set" style="margin-top:10px" aria-label="Complete set ' +
            (i + 1) +
            '">Complete set</button>') +
        (showSectionNote
          ? '<div class="section-note" data-section-note-wrap="' +
            esc(set.exerciseId) +
            '">' +
            '<button type="button" class="btn block" data-action="toggle-section-note" aria-expanded="' +
            (noteOpen ? "true" : "false") +
            '">' +
            (noteOpen ? "Hide note · " : "Add note · ") +
            esc(exLabel) +
            "</button>" +
            '<label class="field' +
            (noteOpen ? "" : " hidden") +
            '" data-section-note-body style="margin-top:8px">' +
            '<span class="lbl">How did ' +
            esc(exLabel) +
            " feel?</span>" +
            '<textarea data-field="section-note" rows="2" placeholder="Optional — form, pumps, sticking point">' +
            esc(sectionVal) +
            "</textarea></label></div>"
          : "") +
        "</div>";
    }
    html += "</div>";
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
    if (t.id === "log-session-note") {
      ensureNotes(draft);
      draft.note = t.value || "";
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
      paintLog(root);
    } else if (field === "load") {
      draft.sets[idx].loadKg = displayToKg(t.value, unit);
    } else if (field === "reps") {
      var reps = t.value === "" ? null : Number(t.value);
      draft.sets[idx].reps = reps != null && !isNaN(reps) ? reps : null;
    } else if (field === "rpe") {
      var rpe = t.value === "" ? null : Number(t.value);
      draft.sets[idx].rpe = rpe != null && !isNaN(rpe) ? rpe : null;
    } else if (field === "section-note") {
      ensureNotes(draft);
      var exId = draft.sets[idx].exerciseId;
      if (exId) draft.sectionNotes[exId] = t.value || "";
    }
  }

  function scrollToNextOpenSet(root, fromIdx) {
    if (!root || !draft) return;
    var sets = draft.sets || [];
    var next = -1;
    for (var i = fromIdx + 1; i < sets.length; i++) {
      if (!sets[i].completed) {
        next = i;
        break;
      }
    }
    if (next < 0) {
      for (var j = 0; j <= fromIdx; j++) {
        if (!sets[j].completed) {
          next = j;
          break;
        }
      }
    }
    if (next < 0) return;
    var block = root.querySelector('[data-set-idx="' + next + '"]');
    if (!block) return;
    if (typeof block.scrollIntoView === "function") {
      block.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    var reps = block.querySelector('[data-field="reps"]');
    if (reps && typeof reps.focus === "function") {
      try {
        reps.focus({ preventScroll: true });
      } catch (err) {
        reps.focus();
      }
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
      if (draft.sets && draft.sets.length) {
        if (!confirm("Start a new session? Unsaved sets on this screen will be cleared.")) {
          return;
        }
      }
      hideOverlay();
      draft = emptyDraft();
      paintLog(root);
      return;
    }

    if (action === "prefill-program") {
      SL.pendingStart = true;
      draft = null;
      var prog = SL.store.getActiveProgram();
      var isWaveProg =
        prog &&
        ((SL.store.isRepWave && SL.store.isRepWave(prog)) ||
          prog.kind === "pullup_wave" ||
          prog.kind === "dip_wave");
      if (prog && (prog.kind === "percent_cycle" || isWaveProg)) {
        var loadLabel =
          prog.kind === "percent_cycle"
            ? "squat"
            : prog.kind === "dip_wave"
              ? "dip"
              : "pull-up";
        root.innerHTML =
          '<div class="card"><p class="muted">Loading ' +
          loadLabel +
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

    if (action === "pick-wave-day") {
      var wave = btn.getAttribute("data-wave");
      var activeProg = SL.store.getActiveProgram();
      if (
        !activeProg ||
        !(
          (SL.store.isRepWave && SL.store.isRepWave(activeProg)) ||
          activeProg.kind === "pullup_wave" ||
          activeProg.kind === "dip_wave"
        ) ||
        (wave !== "intensive" && wave !== "volume")
      ) {
        return;
      }
      SL.store.setPullupNextWaveDay(activeProg.id, wave);
      SL.pendingStart = true;
      draft = null;
      var waveLoadLabel =
        activeProg.kind === "dip_wave" ? "dip" : "pull-up";
      root.innerHTML =
        '<div class="card"><p class="muted">Loading ' +
        waveLoadLabel +
        " session…</p></div>";
      ensureDraft({ startFromProgram: true, waveDay: wave }, function () {
        if (root.isConnected) paintLog(root);
      });
      return;
    }

    if (action === "wave-add-micro" || action === "wave-end-cycle") {
      var waveProg = SL.store.getActiveProgram();
      if (
        !waveProg ||
        !(
          (SL.store.isRepWave && SL.store.isRepWave(waveProg)) ||
          waveProg.kind === "pullup_wave" ||
          waveProg.kind === "dip_wave"
        )
      ) {
        return;
      }
      var unitNow = settings().unit;
      var stepNow = Number(waveProg.microStepKg);
      if (!isFinite(stepNow) || stepNow <= 0) stepNow = 2.5;
      var stepShown = kgToDisplay(stepNow, unitNow);
      var stepTxt =
        stepShown != null
          ? Number.isInteger(stepShown)
            ? String(stepShown)
            : String(Math.round(stepShown * 10) / 10)
          : String(stepNow);
      if (action === "wave-add-micro") {
        if (
          !window.confirm(
            "Add +" +
              stepTxt +
              " " +
              unitNow +
              " for the next micro?\n\nResets next day to Intensive and reloads this session."
          )
        ) {
          return;
        }
        SL.store.advancePullupMicro(waveProg.id);
      } else {
        var peakNow =
          typeof SL.store.pullupWaveAtPeak === "function"
            ? SL.store.pullupWaveAtPeak(waveProg)
            : false;
        if (peakNow) {
          if (
            !window.confirm(
              "End the cycle?\n\nBack to 3×10 and +" +
                stepTxt +
                " " +
                unitNow +
                ". Reloads as Intensive."
            )
          ) {
            return;
          }
          SL.store.finishPullupCycle(waveProg.id);
        } else {
          if (
            !window.confirm(
              "End this micro and drop reps to the next macro phase?\n\nWeight stays the same. Reloads as Intensive."
            )
          ) {
            return;
          }
          SL.store.advancePullupMacro(waveProg.id);
        }
      }
      SL.pendingStart = true;
      draft = null;
      root.innerHTML = '<div class="card"><p class="muted">Updating wave…</p></div>';
      ensureDraft({ startFromProgram: true, waveDay: "intensive" }, function () {
        if (root.isConnected) paintLog(root);
      });
      return;
    }

    if (action === "toggle-section-note") {
      var wrap = btn.closest("[data-section-note-wrap]");
      if (!wrap) return;
      var body = wrap.querySelector("[data-section-note-body]");
      if (!body) return;
      var open = body.classList.contains("hidden");
      if (open) body.classList.remove("hidden");
      else body.classList.add("hidden");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      var label = btn.textContent || "";
      if (open) {
        btn.textContent = label.replace(/^Add note/, "Hide note");
        var ta = body.querySelector("textarea");
        if (ta && typeof ta.focus === "function") ta.focus();
      } else {
        btn.textContent = label.replace(/^Hide note/, "Add note");
      }
      return;
    }

    var block = btn.closest("[data-set-idx]");
    if (!block) return;
    var idx = Number(block.getAttribute("data-set-idx"));
    if (!draft.sets[idx]) return;

    if (action === "remove-set") {
      if (!confirm("Remove this set?")) return;
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
        var repsEl = block.querySelector('[data-field="reps"]');
        if (repsEl && typeof repsEl.focus === "function") repsEl.focus();
        return;
      }
      set.completed = true;
      var rest = settings().restSeconds;
      // Start rest immediately — do not wait on async paint
      if (rest > 0 && SL.timer) showRestTimer(rest);
      pendingScrollSetIdx = idx;
      paintLog(root);
    }
  }

  function bindLog(root) {
    if (root.getAttribute("data-sl-log-bound") === "1") return;
    root.setAttribute("data-sl-log-bound", "1");
    root.addEventListener("change", onLogChange);
    root.addEventListener("input", onLogChange);
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
    ensureNotes(draft);
    var dateEl = root.querySelector("#log-date");
    var bwEl = root.querySelector("#log-bw");
    var noteEl = root.querySelector("#log-session-note");
    if (dateEl) draft.dateISO = dateEl.value || todayISO();
    if (bwEl) draft.bodyweightKg = displayToKg(bwEl.value, settings().unit);
    if (noteEl) draft.note = noteEl.value || "";
    var blocks = root.querySelectorAll("[data-set-idx]");
    for (var i = 0; i < blocks.length; i++) {
      var idx = Number(blocks[i].getAttribute("data-set-idx"));
      syncSetFromDom(blocks[i], idx);
      var ta = blocks[i].querySelector('[data-field="section-note"]');
      if (ta && draft.sets[idx] && draft.sets[idx].exerciseId) {
        draft.sectionNotes[draft.sets[idx].exerciseId] = ta.value || "";
      }
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

    ensureNotes(draft);
    var sectionNotes = {};
    for (var j = 0; j < outSets.length; j++) {
      var eid = outSets[j].exerciseId;
      if (eid && draft.sectionNotes[eid]) sectionNotes[eid] = draft.sectionNotes[eid];
    }

    var sess = {
      id: draft.id || uid(),
      dateISO: draft.dateISO || todayISO(),
      bodyweightKg: draft.bodyweightKg,
      note: draft.note || "",
      sectionNotes: sectionNotes,
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
    calSelectedISO = sess.dateISO;

    if (sess.programId && sess.waveDay) {
      SL.store.clearPullupNextWaveDay(sess.programId, sess.waveDay);
    }

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
      program &&
      program.kind !== "percent_cycle" &&
      program.kind !== "pullup_wave" &&
      program.kind !== "dip_wave" &&
      !(SL.store.isRepWave && SL.store.isRepWave(program))
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
      } else if (
        program &&
        linked &&
        ((SL.store.isRepWave && SL.store.isRepWave(program)) ||
          program.kind === "pullup_wave" ||
          program.kind === "dip_wave")
      ) {
        var stepKg = Number(program.microStepKg);
        if (!isFinite(stepKg) || stepKg <= 0) stepKg = 2.5;
        var stepDisp = kgToDisplay(stepKg, unit);
        var stepLabel =
          stepDisp != null
            ? Number.isInteger(stepDisp)
              ? String(stepDisp)
              : String(Math.round(stepDisp * 10) / 10)
            : String(stepKg);
        var atPeak =
          typeof SL.store.pullupWaveAtPeak === "function"
            ? SL.store.pullupWaveAtPeak(program)
            : false;
        var endLabel = atPeak
          ? "End cycle (+" + stepLabel + " " + unit + ")"
          : "End micro (drop reps)";
        linkHtml =
          '<p class="muted small">Linked to <strong>' +
          esc(draft.dayName || "pull-up wave session") +
          "</strong></p>" +
          '<div class="row wrap" style="gap:8px;margin:8px 0">' +
          '<button type="button" class="btn grow' +
          (draft.waveDay === "intensive" ? " btn-primary" : " secondary") +
          '" data-action="pick-wave-day" data-wave="intensive">Intensive</button>' +
          '<button type="button" class="btn grow' +
          (draft.waveDay === "volume" ? " btn-primary" : " secondary") +
          '" data-action="pick-wave-day" data-wave="volume">Volume</button>' +
          "</div>" +
          '<div class="row wrap" style="gap:8px;margin:0 0 8px">' +
          '<button type="button" class="btn secondary grow" data-action="wave-add-micro">+' +
          esc(stepLabel) +
          " " +
          esc(unit) +
          "</button>" +
          '<button type="button" class="btn secondary grow" data-action="wave-end-cycle">' +
          esc(endLabel) +
          "</button>" +
          "</div>";
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
        '<label class="field"><span class="lbl">Session note</span>' +
        '<textarea id="log-session-note" rows="3" placeholder="Your opinion on this session overall">' +
        esc(draft.note || "") +
        "</textarea></label>" +
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
      if (pendingScrollSetIdx != null) {
        var fromIdx = pendingScrollSetIdx;
        pendingScrollSetIdx = null;
        scrollToNextOpenSet(root, fromIdx);
      }
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
    var progIsWave =
      program &&
      ((SL.store.isRepWave && SL.store.isRepWave(program)) ||
        program.kind === "pullup_wave" ||
        program.kind === "dip_wave");
    var waveSessionLabel =
      program && program.kind === "dip_wave" ? "dip" : "pull-up";
    if (starting && progIsWave && (!draft || !draft.waveDay)) {
      root.innerHTML =
        '<div class="card"><p class="muted">Loading ' +
        waveSessionLabel +
        " session…</p></div>";
      ensureDraft(opts || null, function () {
        if (root.isConnected) paintLog(root);
      });
      return;
    }
    // Prefer explicit waveDay from Home even when a draft already exists
    if (
      starting &&
      progIsWave &&
      opts &&
      (opts.waveDay === "intensive" || opts.waveDay === "volume") &&
      draft &&
      draft.waveDay !== opts.waveDay
    ) {
      root.innerHTML =
        '<div class="card"><p class="muted">Loading ' +
        waveSessionLabel +
        " session…</p></div>";
      draft = null;
      ensureDraft(opts, function () {
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
      if (action === "cal-prev") {
        ensureCalMonth();
        calMonth.m -= 1;
        if (calMonth.m < 0) {
          calMonth.m = 11;
          calMonth.y -= 1;
        }
        paintHistory(root);
        return;
      }
      if (action === "cal-next") {
        ensureCalMonth();
        calMonth.m += 1;
        if (calMonth.m > 11) {
          calMonth.m = 0;
          calMonth.y += 1;
        }
        paintHistory(root);
        return;
      }
      if (action === "cal-day") {
        var dayIso = actionBtn.getAttribute("data-date");
        if (!dayIso) return;
        calSelectedISO = dayIso;
        historyDetailId = null;
        paintHistory(root);
        return;
      }
      if (action === "save-notes") {
        var sid = actionBtn.getAttribute("data-session-id") || historyDetailId;
        saveHistoryNotes(root, sid);
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

  function saveHistoryNotes(root, sessionId) {
    if (!sessionId) return;
    var sessions = SL.store.listSessions() || [];
    var sess = null;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id === sessionId) {
        sess = sessions[i];
        break;
      }
    }
    if (!sess) return;

    var noteEl = root.querySelector("#hist-session-note");
    sess.note = noteEl ? noteEl.value || "" : sess.note || "";
    sess.sectionNotes = sess.sectionNotes && typeof sess.sectionNotes === "object" ? sess.sectionNotes : {};
    var areas = root.querySelectorAll("[data-hist-section-note]");
    for (var j = 0; j < areas.length; j++) {
      var ex = areas[j].getAttribute("data-hist-section-note");
      if (ex) sess.sectionNotes[ex] = areas[j].value || "";
    }
    SL.store.upsertSession(sess);
    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = "Notes saved";
    document.body.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 1600);
  }

  function bindHistory(root) {
    if (root.getAttribute("data-sl-hist-bound") === "1") return;
    root.setAttribute("data-sl-hist-bound", "1");
    root.addEventListener("click", onHistoryClick);
  }

  function renderCalendarHtml(byDate) {
    var cm = ensureCalMonth();
    var y = cm.y;
    var m = cm.m;
    var first = new Date(y, m, 1);
    var startPad = (first.getDay() + 6) % 7; // Monday-first
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var today = todayISO();
    if (!calSelectedISO) calSelectedISO = today;

    var html =
      '<div class="card cal-card">' +
      '<div class="cal-head">' +
      '<button type="button" class="icon-btn" data-hist-action="cal-prev" aria-label="Previous month">&#8249;</button>' +
      "<h2>" +
      esc(monthLabel(y, m)) +
      "</h2>" +
      '<button type="button" class="icon-btn" data-hist-action="cal-next" aria-label="Next month">&#8250;</button>' +
      "</div>" +
      '<div class="cal-grid" role="grid" aria-label="Training calendar">';

    var dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (var d = 0; d < dows.length; d++) {
      html += '<div class="cal-dow">' + dows[d] + "</div>";
    }
    for (var p = 0; p < startPad; p++) {
      html += '<div class="cal-day empty" aria-hidden="true"></div>';
    }
    for (var day = 1; day <= daysInMonth; day++) {
      var iso = isoFromYMD(y, m, day);
      var count = byDate[iso] ? byDate[iso].length : 0;
      var cls = "cal-day";
      if (count) cls += " has-session";
      if (iso === calSelectedISO) cls += " selected";
      if (iso === today) cls += " today";
      html +=
        '<button type="button" class="' +
        cls +
        '" data-hist-action="cal-day" data-date="' +
        esc(iso) +
        '" aria-label="' +
        esc(iso) +
        (count ? ", " + count + " session" + (count > 1 ? "s" : "") : "") +
        '">' +
        '<span class="cal-num">' +
        day +
        "</span>" +
        (count ? '<span class="cal-dot" aria-hidden="true"></span>' : "") +
        "</button>";
    }
    html += "</div></div>";
    return html;
  }

  function renderHistoryList(root, exercises) {
    var names = nameMap(exercises);
    var unit = settings().unit;
    var byDate = sessionsByDate();
    var sessions = SL.store.listSessions() || [];

    root.setAttribute("data-sl-view", "history");
    bindHistory(root);

    if (!calSelectedISO) calSelectedISO = todayISO();
    var daySessions = byDate[calSelectedISO] || [];

    var html = '<div class="stack stack-lg">' + renderCalendarHtml(byDate);

    html +=
      '<div class="card"><h2 class="card-title">'+
      esc(calSelectedISO) +
      "</h2>";

    if (!sessions.length) {
      html +=
        '<p class="muted">No sessions yet. Complete a workout to fill the calendar.</p>' +
        '<button type="button" class="btn btn-primary block" data-hist-action="goto-log">Start workout</button>';
    } else if (!daySessions.length) {
      html += '<p class="muted">Nothing logged this day.</p>';
    } else {
      html += '<div class="stack">';
      for (var i = 0; i < daySessions.length; i++) {
        var sess = daySessions[i];
        var bw =
          sess.bodyweightKg != null ? fmtWeight(sess.bodyweightKg, unit) : "—";
        var hasNotes = !!(sess.note && String(sess.note).trim());
        if (!hasNotes && sess.sectionNotes) {
          for (var nk in sess.sectionNotes) {
            if (
              Object.prototype.hasOwnProperty.call(sess.sectionNotes, nk) &&
              sess.sectionNotes[nk] &&
              String(sess.sectionNotes[nk]).trim()
            ) {
              hasNotes = true;
              break;
            }
          }
        }
        html +=
          '<button type="button" class="list-item session-card" data-session-id="' +
          esc(sess.id) +
          '">' +
          '<div class="name">' +
          esc(sessionSummary(sess, names, unit)) +
          '<div class="muted small">' +
          esc(hasNotes ? "Has notes · " + bw : bw) +
          "</div></div>" +
          '<span class="chev">›</span>' +
          "</button>";
      }
      html += "</div>";
    }
    html += "</div></div>";
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

    if (sess.dateISO) calSelectedISO = sess.dateISO;
    var parsed = parseISODate(sess.dateISO);
    if (parsed) calMonth = { y: parsed.y, m: parsed.m };

    var sectionNotes =
      sess.sectionNotes && typeof sess.sectionNotes === "object" ? sess.sectionNotes : {};
    var sets = sess.sets || [];
    var exIds = uniqueExerciseIds(sets);

    var sectionsHtml = "";
    for (var e = 0; e < exIds.length; e++) {
      var exId = exIds[e];
      var exRows = "";
      var n = 0;
      for (var j = 0; j < sets.length; j++) {
        var set = sets[j];
        if (set.exerciseId !== exId) continue;
        n += 1;
        exRows +=
          "<tr><td>" +
          n +
          "</td><td>" +
          esc(fmtWeight(set.loadKg, unit)) +
          "</td><td>" +
          esc(set.reps != null ? set.reps : "—") +
          "</td><td>" +
          esc(set.rpe != null ? set.rpe : "—") +
          "</td></tr>";
      }
      sectionsHtml +=
        '<div class="card section-card">' +
        "<h2>" +
        esc(names[exId] || exId) +
        "</h2>" +
        '<table class="detail-set-table"><thead><tr><th>#</th><th>Load</th><th>Reps</th><th>RPE</th></tr></thead><tbody>' +
        exRows +
        "</tbody></table>" +
        '<label class="field section-note"><span class="lbl">Your note</span>' +
        '<textarea data-hist-section-note="' +
        esc(exId) +
        '" rows="3" placeholder="Personal opinion on this section">' +
        esc(sectionNotes[exId] || "") +
        "</textarea></label></div>";
    }

    root.setAttribute("data-sl-view", "history");
    bindHistory(root);

    root.innerHTML =
      '<div class="stack stack-lg">' +
      '<button type="button" class="btn sm" data-hist-action="back">Back to calendar</button>' +
      '<div class="card">' +
      '<div class="card-head"><div class="date">' +
      esc(sess.dateISO || "") +
      "</div>" +
      '<span class="muted">' +
      esc(sess.bodyweightKg != null ? fmtWeight(sess.bodyweightKg, unit) : "bw —") +
      "</span></div>" +
      '<label class="field"><span class="lbl">Session note</span>' +
      '<textarea id="hist-session-note" rows="3" placeholder="Your opinion on this session overall">' +
      esc(sess.note || "") +
      "</textarea></label>" +
      "</div>" +
      (sectionsHtml || '<div class="card"><p class="muted">No sets logged.</p></div>') +
      '<div class="stack">' +
      '<button type="button" class="btn btn-primary block" data-hist-action="save-notes" data-session-id="' +
      esc(sess.id) +
      '">Save notes</button>' +
      '<button type="button" class="btn block" data-hist-action="edit" data-session-id="' +
      esc(sess.id) +
      '">Edit sets in Log</button>' +
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
    ensureCalMonth();
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
