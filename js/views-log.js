/* Streetlifting — Log + History views */
(function () {
  "use strict";

  window.SL = window.SL || {};
  SL.views = SL.views || {};

  var KG_TO_LB = 2.2046226218;

  var DRAFT_KEY = "streetlifting-draft";

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
  /** @type {number|null} interval for live workout duration on the log screen */
  var workoutClockTimer = null;
  /** @type {number|null} interval for the persistent bottom active-workout bar */
  var activeBarTimer = null;
  /** @type {number|null} debounce handle for draft persistence */
  var draftPersistTimer = null;
  /** Session details editor expanded (default collapsed) */
  var sessionDetailsOpen = false;
  /** @type {Object.<string, boolean>} set id -> extras row open */
  var openSetExtras = {};
  /** @type {Object.<string, boolean>} section key -> exercise menu open */
  var openExMenus = {};
  /** @type {Object.<string, boolean>} exerciseId -> section note forced open */
  var openSectionNotes = {};

  function clearPersistedDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      /* storage may be unavailable */
    }
  }

  function persistDraftNow() {
    try {
      if (
        !draft ||
        (draft.startedAt == null &&
          !(draft.sets && draft.sets.length) &&
          !(draft.note && String(draft.note).trim()))
      ) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
      /* never break logging on storage failure */
    }
  }

  function schedulePersistDraft() {
    if (draftPersistTimer != null) {
      clearTimeout(draftPersistTimer);
    }
    draftPersistTimer = setTimeout(function () {
      draftPersistTimer = null;
      persistDraftNow();
    }, 200);
  }

  function restoreDraftFromStorage() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      ensureNotes(parsed);
      if (!Array.isArray(parsed.sets)) parsed.sets = [];
      return parsed;
    } catch (err) {
      return null;
    }
  }

  (function initDraftFromStorage() {
    var restored = restoreDraftFromStorage();
    if (restored) draft = restored;
  })();

  function sectionMenuKey(secIdx, exerciseId) {
    return String(secIdx) + ":" + String(exerciseId || "");
  }

  function workoutDisplayName() {
    if (draft && draft.dayName) return String(draft.dayName);
    return "Workout";
  }

  function hasActiveSession() {
    return !!(draft && draft.startedAt != null && !isNaN(Number(draft.startedAt)));
  }

  function activeSessionInfo() {
    if (!hasActiveSession()) return null;
    var sets = draft.sets || [];
    return {
      name: workoutDisplayName(),
      startedAt: Number(draft.startedAt),
      elapsedMs: workoutElapsedMs(),
      setCount: sets.length,
    };
  }

  function stopActiveBarTick() {
    if (activeBarTimer != null) {
      clearInterval(activeBarTimer);
      activeBarTimer = null;
    }
  }

  function removeActiveBar() {
    stopActiveBarTick();
    var bar = document.getElementById("active-workout-bar");
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  function resumeActiveSession() {
    if (typeof SL.navigate === "function") {
      SL.navigate("log");
    }
  }

  function syncActiveBar() {
    var onLog = !!(SL.app && SL.app.currentTab === "log");
    if (onLog || !hasActiveSession()) {
      removeActiveBar();
      return;
    }
    var app = document.getElementById("app");
    if (!app) return;
    var info = activeSessionInfo();
    if (!info) {
      removeActiveBar();
      return;
    }
    var bar = document.getElementById("active-workout-bar");
    if (!bar) {
      bar = document.createElement("button");
      bar.type = "button";
      bar.id = "active-workout-bar";
      bar.className = "active-workout-bar";
      bar.setAttribute(
        "aria-label",
        "Running workout. Tap to return to logging."
      );
      bar.innerHTML =
        '<span class="active-workout-bar-name"></span>' +
        '<span class="active-workout-bar-time"></span>';
      bar.addEventListener("click", function (e) {
        e.preventDefault();
        resumeActiveSession();
      });
      app.appendChild(bar);
    }
    var nameEl = bar.querySelector(".active-workout-bar-name");
    var timeEl = bar.querySelector(".active-workout-bar-time");
    if (nameEl) nameEl.textContent = info.name;
    function tickBar() {
      if (!hasActiveSession()) {
        removeActiveBar();
        return;
      }
      var elapsed = formatElapsed(workoutElapsedMs());
      if (timeEl) timeEl.textContent = elapsed;
      bar.setAttribute(
        "aria-label",
        "Running workout " +
          workoutDisplayName() +
          ", " +
          elapsed +
          ". Tap to return to logging."
      );
    }
    tickBar();
    if (activeBarTimer == null) {
      activeBarTimer = setInterval(tickBar, 1000);
    }
  }

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
      autoStartRest: s.autoStartRest !== false,
    };
  }

  function makeSet(exerciseId, patch) {
    var p = patch && typeof patch === "object" ? patch : {};
    if (SL.store && typeof SL.store.newSet === "function") {
      return SL.store.newSet(exerciseId, p);
    }
    var set = {
      id: uid(),
      exerciseId: exerciseId == null ? null : exerciseId,
      loadKg: 0,
      reps: 0,
      completed: false,
      type: "normal",
      supersetId: null,
    };
    for (var k in p) {
      if (Object.prototype.hasOwnProperty.call(p, k)) set[k] = p[k];
    }
    if (
      set.type !== "normal" &&
      set.type !== "warmup" &&
      set.type !== "drop" &&
      set.type !== "failure"
    ) {
      set.type = "normal";
    }
    if (!Object.prototype.hasOwnProperty.call(set, "supersetId")) set.supersetId = null;
    return set;
  }

  function ensureSetShape(set) {
    if (!set || typeof set !== "object") return set;
    if (!set.id) set.id = uid();
    if (
      set.type !== "normal" &&
      set.type !== "warmup" &&
      set.type !== "drop" &&
      set.type !== "failure"
    ) {
      set.type = "normal";
    }
    if (!Object.prototype.hasOwnProperty.call(set, "supersetId")) set.supersetId = null;
    if (typeof set.note !== "string") {
      set.note = set.note != null ? String(set.note) : "";
    }
    return set;
  }

  function cycleSetType(type) {
    if (type === "normal") return "warmup";
    if (type === "warmup") return "drop";
    if (type === "drop") return "failure";
    return "normal";
  }

  function setTypeMarker(type, workingNum) {
    if (type === "warmup") return "W";
    if (type === "drop") return "D";
    if (type === "failure") return "F";
    return String(workingNum);
  }

  function setTypeClass(type) {
    var cls = "set-type";
    if (type === "warmup") cls += " set-type--warmup";
    else if (type === "drop") cls += " set-type--drop";
    else if (type === "failure") cls += " set-type--failure";
    return cls;
  }

  function setCountsForVolume(set) {
    if (SL.store && typeof SL.store.countsForVolume === "function") {
      return SL.store.countsForVolume(set);
    }
    if (!set || set.completed === false) return false;
    if (set.type === "warmup") return false;
    return true;
  }

  function setVolumeKg(set, bodyweightKg) {
    if (SL.store && typeof SL.store.setVolumeKg === "function") {
      return SL.store.setVolumeKg(set, bodyweightKg);
    }
    if (!setCountsForVolume(set)) return 0;
    var load = Number(set.loadKg) || 0;
    var reps = Number(set.reps) || 0;
    return load * reps;
  }

  function draftVolumeStats() {
    var sets = (draft && draft.sets) || [];
    var bw = draft ? draft.bodyweightKg : null;
    var working = 0;
    var volume = 0;
    var completed = 0;
    for (var i = 0; i < sets.length; i++) {
      var set = sets[i];
      if (!set || set.completed === false) continue;
      completed += 1;
      if (!setCountsForVolume(set)) continue;
      working += 1;
      volume += setVolumeKg(set, bw);
    }
    return { completed: completed, working: working, volumeKg: volume };
  }

  function previousSetsFor(exerciseId) {
    if (!draft || !exerciseId) return [];
    if (SL.store && typeof SL.store.previousSetsFor === "function") {
      try {
        return SL.store.previousSetsFor(exerciseId, draft.id) || [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  function prBadgeHtml(set, session) {
    if (!SL.prs || typeof SL.prs.checkSet !== "function") return "";
    try {
      var records = SL.prs.checkSet(set, session);
      if (!records || !records.length) return "";
      if (typeof SL.prs.badgeHtml === "function") {
        return SL.prs.badgeHtml(records) || "";
      }
      return "";
    } catch (e) {
      return "";
    }
  }

  function groupExerciseSections(sets) {
    var sections = [];
    var byExLocal = {};
    for (var i = 0; i < (sets || []).length; i++) {
      var set = sets[i];
      ensureSetShape(set);
      var exId = set.exerciseId || "";
      var last = sections.length ? sections[sections.length - 1] : null;
      if (!last || last.exerciseId !== exId) {
        last = {
          exerciseId: exId,
          indices: [],
          localNums: [],
          supersetId: set.supersetId || null,
        };
        sections.push(last);
        if (!byExLocal[exId]) byExLocal[exId] = 0;
      }
      last.indices.push(i);
      last.localNums.push(byExLocal[exId]);
      byExLocal[exId] += 1;
      if (set.supersetId) last.supersetId = set.supersetId;
    }
    return sections;
  }

  function newSupersetId() {
    return "ss-" + uid();
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
      startedAt: null,
      endedAt: null,
      durationSec: null,
    };
  }

  function formatElapsed(ms) {
    var total = Math.max(0, Math.floor(Number(ms) / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) {
      return h + ":" + pad2(m) + ":" + pad2(s);
    }
    return m + ":" + pad2(s);
  }

  function workoutElapsedMs() {
    if (!draft || draft.startedAt == null) return 0;
    var start = Number(draft.startedAt);
    if (!start || isNaN(start)) return 0;
    return Math.max(0, Date.now() - start);
  }

  function ensureWorkoutStarted() {
    if (!draft) return;
    if (draft.startedAt == null || isNaN(Number(draft.startedAt))) {
      draft.startedAt = Date.now();
    }
    draft.endedAt = null;
    draft.durationSec = null;
    schedulePersistDraft();
  }

  function stopWorkoutClockTick() {
    if (workoutClockTimer != null) {
      clearInterval(workoutClockTimer);
      workoutClockTimer = null;
    }
  }

  function syncWorkoutClockUI() {
    var label = draft && draft.startedAt != null ? formatElapsed(workoutElapsedMs()) : "";
    var meta = document.getElementById("topbar-meta");
    if (meta) {
      if (label) {
        meta.textContent = label;
        meta.setAttribute("title", "Workout time");
        meta.setAttribute("aria-label", "Workout time " + label);
        meta.classList.add("workout-clock");
      } else {
        meta.textContent = "";
        meta.removeAttribute("title");
        meta.removeAttribute("aria-label");
        meta.classList.remove("workout-clock");
      }
    }
    var live = document.getElementById("log-workout-clock");
    if (live) live.textContent = label || "0:00";
  }

  function startWorkoutClockTick() {
    stopWorkoutClockTick();
    ensureWorkoutStarted();
    syncWorkoutClockUI();
    workoutClockTimer = setInterval(function () {
      /* Stop only the on-screen log clock when leaving the tab.
         Never clear draft or end the session on navigation. */
      if (SL.app && SL.app.currentTab && SL.app.currentTab !== "log") {
        stopWorkoutClockTick();
        return;
      }
      syncWorkoutClockUI();
    }, 1000);
  }

  function removeCompleteFab() {
    /* Legacy cleanup: floating FAB was removed; strip any leftover node. */
    var fab = document.getElementById("log-complete-fab");
    if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
  }

  function endWorkoutClock(resetDraftStartedAt) {
    stopWorkoutClockTick();
    var elapsed = workoutElapsedMs();
    if (resetDraftStartedAt && draft) draft.startedAt = null;
    var meta = document.getElementById("topbar-meta");
    if (meta) {
      meta.textContent = "";
      meta.removeAttribute("title");
      meta.removeAttribute("aria-label");
      meta.classList.remove("workout-clock");
    }
    removeCompleteFab();
    return elapsed;
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
    var set = makeSet(pe.exerciseId || "", {
      loadKg: pe.startLoadKg != null ? pe.startLoadKg : null,
      reps: targetReps,
      rpe: null,
      completed: false,
    });
    set.targetLoadKg = pe.startLoadKg != null ? pe.startLoadKg : null;
    set.targetRepsLabel = repLabel;
    return set;
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
      startedAt: Date.now(),
      endedAt: null,
      durationSec: null,
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
        var cset = makeSet(pe.exerciseId || "squat", {
          loadKg: pe.loadKg != null ? pe.loadKg : null,
          reps: pe.reps != null ? pe.reps : null,
          rpe: null,
          completed: false,
        });
        cset.targetLoadKg = pe.loadKg != null ? pe.loadKg : null;
        cset.targetLoadKgMax = pe.loadKgMax != null ? pe.loadKgMax : null;
        cset.targetRepsLabel = repLabel;
        sets.push(cset);
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
      startedAt: Date.now(),
      endedAt: null,
      durationSec: null,
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
        var wset = makeSet(pe.exerciseId || "pullup", {
          loadKg: pe.loadKg != null ? pe.loadKg : null,
          reps: pe.reps != null ? pe.reps : null,
          rpe: null,
          completed: false,
        });
        wset.targetLoadKg = pe.loadKg != null ? pe.loadKg : null;
        wset.targetRepsLabel = repLabel;
        sets.push(wset);
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
      startedAt: Date.now(),
      endedAt: null,
      durationSec: null,
    };
  }

  function draftFromSession(sess) {
    var sets = (sess.sets || []).map(function (set) {
      var row = makeSet(set.exerciseId || "", {
        loadKg: set.loadKg != null ? set.loadKg : null,
        reps: set.reps != null ? set.reps : null,
        rpe: set.rpe != null ? set.rpe : null,
        completed: set.completed !== false,
        type: set.type || "normal",
        note: typeof set.note === "string" ? set.note : set.note != null ? String(set.note) : "",
        supersetId: set.supersetId != null ? set.supersetId : null,
      });
      if (set.id) row.id = set.id;
      row.targetLoadKg = null;
      row.targetRepsLabel = "";
      return row;
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
      week: sess.week != null ? sess.week : null,
      dayNum: sess.day != null ? sess.day : null,
      cycleKey: sess.cycleKey || null,
      waveDay: sess.waveDay || null,
      phaseIndex: sess.phaseIndex != null ? sess.phaseIndex : null,
      intensiveLoadKg: sess.intensiveLoadKg != null ? sess.intensiveLoadKg : null,
      note: typeof sess.note === "string" ? sess.note : "",
      sectionNotes: notes,
      sets: sets,
      startedAt: sess.startedAt != null ? sess.startedAt : Date.now(),
      endedAt: sess.endedAt != null ? sess.endedAt : null,
      durationSec: sess.durationSec != null ? sess.durationSec : null,
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
    // Docked strip, not a modal: resting must never block the rest of the app.
    overlayEl.setAttribute("role", "region");
    overlayEl.setAttribute("aria-label", "Rest timer");
    overlayEl.innerHTML =
      '<div class="rest-bar" data-rest-bar>' +
      '<div class="timer-label" data-timer-label>Rest</div>' +
      '<div class="rest-bar-time timer-display" data-timer-display aria-live="polite">0:00</div>' +
      '<div class="timer-actions rest-bar-actions">' +
      '<button type="button" class="btn secondary rest-bar-adjust" data-timer-adj="-15" aria-label="Minus 15 seconds">-15s</button>' +
      '<button type="button" class="btn secondary rest-bar-adjust" data-timer-adj="15" aria-label="Plus 15 seconds">+15s</button>' +
      '<button type="button" class="btn btn-primary rest-bar-skip" data-timer-skip>Skip rest</button>' +
      "</div></div>";
    var appEl = document.getElementById("app");
    if (appEl) appEl.appendChild(overlayEl);
    else document.body.appendChild(overlayEl);
    overlayEl.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-timer-skip]")) {
        hideOverlay();
        return;
      }
      var adjBtn = t.closest("[data-timer-adj]");
      if (adjBtn) {
        var delta = Number(adjBtn.getAttribute("data-timer-adj")) || 0;
        if (SL.timer && typeof SL.timer.adjust === "function") {
          SL.timer.adjust(delta);
          if (typeof SL.timer.remaining === "function") {
            var rem = SL.timer.remaining();
            var display = overlayEl.querySelector("[data-timer-display]");
            if (display) display.textContent = formatMmSs(rem);
            setOverlayDone(rem <= 0);
          }
          return;
        }
        var cur =
          SL.timer && typeof SL.timer.remaining === "function" ? SL.timer.remaining() : 0;
        if (cur < 0) cur = 0;
        showRestTimer(Math.max(0, cur + delta));
      }
    });
    return overlayEl;
  }

  function setOverlayDone(isDone) {
    var el = ensureOverlay();
    var bar = el.querySelector("[data-rest-bar]");
    var display = el.querySelector("[data-timer-display]");
    var label = el.querySelector("[data-timer-label]");
    var skip = el.querySelector("[data-timer-skip]");
    if (bar) {
      if (isDone) bar.classList.add("rest-bar--done");
      else bar.classList.remove("rest-bar--done");
    }
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
    if (SL.timer && typeof SL.timer.stop === "function") SL.timer.stop();
    var el = ensureOverlay();
    el.classList.add("hidden");
    setOverlayDone(false);
    var display = el.querySelector("[data-timer-display]");
    if (display) display.textContent = "0:00";
  }

  function bindRestTick(display) {
    return function tick(rem) {
      if (display) {
        display.textContent = formatMmSs(rem);
        if (rem <= 0) setOverlayDone(true);
        else setOverlayDone(false);
      }
    };
  }

  function bindRestDone(display) {
    return function () {
      if (display) {
        display.textContent = "0:00";
        setOverlayDone(true);
      }
      if (SL.timer && typeof SL.timer.notifyOnDone === "function") {
        try {
          SL.timer.notifyOnDone();
        } catch (errNotify) {
          /* ignore */
        }
      }
      doneHideTimer = setTimeout(function () {
        doneHideTimer = null;
        hideOverlay();
      }, 1400);
    };
  }

  function showRestTimer(seconds) {
    if (!SL.timer || typeof SL.timer.start !== "function") return;
    if (doneHideTimer) {
      clearTimeout(doneHideTimer);
      doneHideTimer = null;
    }
    var el = ensureOverlay();
    var display = el.querySelector("[data-timer-display]");
    el.classList.remove("hidden");
    setOverlayDone(false);
    SL.timer.start(seconds, bindRestTick(display), bindRestDone(display));
  }

  function startRestForExercise(exerciseId) {
    var s = settings();
    if (!s.autoStartRest) return;
    if (!SL.timer) return;
    if (doneHideTimer) {
      clearTimeout(doneHideTimer);
      doneHideTimer = null;
    }
    var el = ensureOverlay();
    var display = el.querySelector("[data-timer-display]");
    el.classList.remove("hidden");
    setOverlayDone(false);
    var onTick = bindRestTick(display);
    var onDone = bindRestDone(display);
    if (typeof SL.timer.startFor === "function") {
      SL.timer.startFor(exerciseId, onTick, onDone);
      return;
    }
    var sec = settings().restSeconds;
    if (SL.store && typeof SL.store.restSecondsFor === "function") {
      try {
        sec = SL.store.restSecondsFor(exerciseId);
      } catch (errRest) {
        /* keep default */
      }
    }
    if (sec > 0 && typeof SL.timer.start === "function") {
      SL.timer.start(sec, onTick, onDone);
    }
  }

  function renderSetRow(set, idx, localIdx, unit, workingNum) {
    ensureSetShape(set);
    var type = set.type || "normal";
    var isWarmup = type === "warmup";
    var prevList = previousSetsFor(set.exerciseId);
    var prev = prevList[localIdx];
    var prevHtml = "";
    if (prev && (prev.loadKg != null || prev.reps != null)) {
      prevHtml =
        '<button type="button" class="prev-set" data-action="apply-prev-set" aria-label="Use previous set values">' +
        esc(fmtWeight(prev.loadKg, unit)) +
        " x " +
        esc(prev.reps != null ? prev.reps : "\u2014") +
        "</button>";
    } else {
      prevHtml = '<span class="prev-set prev-set-empty" aria-hidden="true">\u2014</span>';
    }

    var noteVal = typeof set.note === "string" ? set.note : "";
    var hasNote = !!(noteVal && String(noteVal).trim());
    var hasRpe = set.rpe != null && set.rpe !== "";
    var extrasOpen = !!(openSetExtras[set.id] || false);
    var badge = set.completed ? prBadgeHtml(set, draft) : "";
    var rowCls =
      "set-row" + (isWarmup ? " set-row--warmup" : "") + (set.completed ? " set-row--done" : "");

    var html =
      '<div class="' +
      rowCls +
      '" data-set-idx="' +
      idx +
      '"' +
      (set.completed ? ' data-completed="1"' : "") +
      ">" +
      '<button type="button" class="' +
      setTypeClass(type) +
      '" data-action="cycle-set-type" aria-label="Set type ' +
      esc(type) +
      '. Tap to change.">' +
      esc(setTypeMarker(type, workingNum)) +
      "</button>" +
      prevHtml +
      '<input type="number" class="load-num" inputmode="decimal" step="any" enterkeyhint="next" data-field="load" placeholder="0" value="' +
      esc(kgToDisplay(set.loadKg, unit)) +
      '" aria-label="Load in ' +
      esc(unit) +
      '" />' +
      '<input type="number" inputmode="numeric" step="1" enterkeyhint="done" data-field="reps" placeholder="0" value="' +
      esc(set.reps != null ? set.reps : "") +
      '" aria-label="Reps" />' +
      (set.completed
        ? '<span class="badge green set-done-badge">Done</span>'
        : '<button type="button" class="btn btn-primary sm" data-action="complete-set" aria-label="Complete set">OK</button>') +
      (badge ? '<span class="set-pr-badges">' + badge + "</span>" : "") +
      '<button type="button" class="set-row-more' +
      (hasNote || hasRpe ? " set-row-more--on" : "") +
      (extrasOpen ? " set-row-more--open" : "") +
      '" data-action="toggle-set-extra" aria-expanded="' +
      (extrasOpen ? "true" : "false") +
      '" aria-label="More set options">\u2026</button>' +
      "</div>" +
      '<div class="set-row-meta' +
      (extrasOpen ? "" : " hidden") +
      '" data-set-idx="' +
      idx +
      '">' +
      '<label class="field set-rpe-field"><span class="lbl">RPE</span>' +
      '<input type="number" inputmode="decimal" step="0.5" min="1" max="10" data-field="rpe" placeholder="\u2014" value="' +
      esc(set.rpe != null ? set.rpe : "") +
      '" aria-label="RPE" /></label>' +
      '<div class="set-note">' +
      '<button type="button" class="set-note-btn' +
      (hasNote ? " set-note-btn--on" : "") +
      '" data-action="toggle-set-note" aria-expanded="' +
      (hasNote ? "true" : "false") +
      '" aria-label="' +
      (hasNote ? "Edit set note" : "Add set note") +
      '">Note</button>' +
      '<input type="text" class="set-note-input' +
      (hasNote ? "" : " hidden") +
      '" data-field="set-note" maxlength="200" placeholder="Set note" value="' +
      esc(noteVal) +
      '" aria-label="Set note" />' +
      "</div>" +
      '<button type="button" class="icon-btn del-set" data-action="remove-set" aria-label="Remove set">&times;</button>' +
      "</div>";

    if (set.targetRepsLabel || set.targetLoadKg != null) {
      html =
        '<p class="muted small set-target-hint" data-set-idx="' +
        idx +
        '">Target: ' +
        esc(
          (set.targetLoadKg != null ? fmtWeight(set.targetLoadKg, unit) : "\u2014") +
            (set.targetRepsLabel ? " x " + set.targetRepsLabel : "")
        ) +
        "</p>" +
        html;
    }
    return html;
  }

  function renderExerciseSection(section, secIdx, sections, exercises, unit) {
    var names = nameMap(exercises);
    var exId = section.exerciseId;
    var exLabel = names[exId] || exId || "Exercise";
    ensureNotes(draft);
    var sectionVal = exId && draft.sectionNotes[exId] ? draft.sectionNotes[exId] : "";
    var hasSectionNote = !!(sectionVal && String(sectionVal).trim());
    var menuKey = sectionMenuKey(secIdx, exId);
    var menuOpen = !!openExMenus[menuKey];
    var noteOpen = !!(hasSectionNote || openSectionNotes[exId]);
    var ssId = section.supersetId;
    var prevSec = secIdx > 0 ? sections[secIdx - 1] : null;
    var canJoin = !!(prevSec && (!ssId || !prevSec.supersetId || prevSec.supersetId !== ssId));
    var inGroup = !!ssId;

    var workingNum = 0;
    var rows = "";
    for (var r = 0; r < section.indices.length; r++) {
      var idx = section.indices[r];
      var set = draft.sets[idx];
      ensureSetShape(set);
      var displayNum = workingNum + 1;
      if (set.type !== "warmup") workingNum += 1;
      else displayNum = Math.max(1, workingNum);
      rows += renderSetRow(set, idx, section.localNums[r], unit, displayNum || 1);
    }

    var menuHtml =
      '<div class="log-ex-menu' +
      (menuOpen ? "" : " hidden") +
      '" data-ex-menu="' +
      esc(menuKey) +
      '">' +
      '<label class="field log-ex-change"><span class="lbl">Change exercise</span>' +
      '<select data-field="section-exerciseId" data-section-idx="' +
      secIdx +
      '" aria-label="Change exercise">' +
      exerciseOptionsHtml(exercises, exId) +
      "</select></label>";
    if (inGroup) {
      menuHtml +=
        '<button type="button" class="log-ex-menu-action" data-action="ungroup-superset" data-section-idx="' +
        secIdx +
        '">Ungroup</button>';
    } else if (canJoin && prevSec) {
      menuHtml +=
        '<button type="button" class="log-ex-menu-action" data-action="join-superset" data-section-idx="' +
        secIdx +
        '">Superset with previous</button>';
    }
    menuHtml +=
      '<button type="button" class="log-ex-menu-action" data-action="toggle-section-note" aria-expanded="' +
      (noteOpen ? "true" : "false") +
      '">' +
      (hasSectionNote ? "Edit section note" : "Add section note") +
      "</button>" +
      '<button type="button" class="log-ex-menu-action log-ex-menu-action--danger" data-action="remove-exercise" data-section-idx="' +
      secIdx +
      '">Remove exercise</button>' +
      "</div>";

    return (
      '<div class="exercise-block' +
      (inGroup ? " exercise-block--superset" : "") +
      '" data-section-idx="' +
      secIdx +
      '" data-exercise-id="' +
      esc(exId) +
      '">' +
      '<div class="ex-head log-ex-head">' +
      '<h3 class="log-ex-name">' +
      esc(exLabel) +
      "</h3>" +
      '<button type="button" class="log-ex-menu-btn' +
      (menuOpen ? " log-ex-menu-btn--open" : "") +
      '" data-action="toggle-ex-menu" data-section-idx="' +
      secIdx +
      '" aria-expanded="' +
      (menuOpen ? "true" : "false") +
      '" aria-label="Exercise options">\u2026</button>' +
      "</div>" +
      menuHtml +
      '<div class="section-note' +
      (noteOpen ? "" : " hidden") +
      '" data-section-note-wrap="' +
      esc(exId) +
      '">' +
      '<label class="field" data-section-note-body>' +
      '<span class="lbl">How did ' +
      esc(exLabel) +
      " feel?</span>" +
      '<textarea data-field="section-note" data-exercise-id="' +
      esc(exId) +
      '" rows="2" placeholder="Optional — form, pumps, sticking point">' +
      esc(sectionVal) +
      "</textarea></label></div>" +
      '<div class="set-head"><span>Set</span><span>Previous</span><span>+Kg</span><span>Reps</span><span></span></div>' +
      rows +
      '<button type="button" class="log-text-action" data-action="add-set-to-exercise" data-section-idx="' +
      secIdx +
      '">Add set</button>' +
      "</div>"
    );
  }

  function renderSetBlocks(exercises, unit) {
    var sets = draft.sets || [];
    if (!sets.length) {
      return '<p class="muted">No sets yet. Add a set to begin.</p>';
    }

    ensureNotes(draft);
    var sections = groupExerciseSections(sets);
    var html = "";
    var i = 0;
    while (i < sections.length) {
      var sec = sections[i];
      var ssId = sec.supersetId;
      if (ssId) {
        var groupEnd = i;
        while (groupEnd + 1 < sections.length && sections[groupEnd + 1].supersetId === ssId) {
          groupEnd += 1;
        }
        if (groupEnd > i) {
          html +=
            '<div class="superset" data-superset-id="' +
            esc(ssId) +
            '">' +
            '<div class="superset-rail" aria-hidden="true"></div>' +
            '<div class="superset-body">' +
            '<div class="superset-head"><span class="superset-tag">Superset</span></div>';
          for (var g = i; g <= groupEnd; g++) {
            html += renderExerciseSection(sections[g], g, sections, exercises, unit);
          }
          html += "</div></div>";
          i = groupEnd + 1;
          continue;
        }
      }
      html += renderExerciseSection(sec, i, sections, exercises, unit);
      i += 1;
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
      schedulePersistDraft();
      return;
    }
    if (t.id === "log-bw") {
      draft.bodyweightKg = displayToKg(t.value, settings().unit);
      schedulePersistDraft();
      return;
    }
    if (t.id === "log-link-day") {
      if (!t.checked) {
        draft.programId = null;
        draft.dayId = null;
        draft.dayName = null;
        schedulePersistDraft();
        return;
      }
      var program = SL.store.getActiveProgram();
      var day = program ? nextProgramDay(program) : null;
      if (program && day) {
        draft.programId = program.id;
        draft.dayId = day.id;
        draft.dayName = day.name || null;
      }
      schedulePersistDraft();
      return;
    }
    if (t.id === "log-session-note") {
      ensureNotes(draft);
      draft.note = t.value || "";
      schedulePersistDraft();
      return;
    }

    var field = t.getAttribute("data-field");
    if (field === "section-exerciseId") {
      var secIdxChange = Number(t.getAttribute("data-section-idx"));
      var sectionsChange = groupExerciseSections(draft.sets || []);
      var secChange = sectionsChange[secIdxChange];
      if (!secChange) return;
      var newEx = t.value;
      for (var ci = 0; ci < secChange.indices.length; ci++) {
        draft.sets[secChange.indices[ci]].exerciseId = newEx;
      }
      schedulePersistDraft();
      paintLog(root);
      return;
    }

    if (field === "section-note") {
      ensureNotes(draft);
      var noteEx = t.getAttribute("data-exercise-id");
      if (noteEx) draft.sectionNotes[noteEx] = t.value || "";
      schedulePersistDraft();
      return;
    }

    var block = t.closest && t.closest("[data-set-idx]");
    if (!block) return;
    var idx = Number(block.getAttribute("data-set-idx"));
    if (!draft.sets[idx]) return;
    var unit = settings().unit;
    ensureSetShape(draft.sets[idx]);
    if (field === "load") {
      draft.sets[idx].loadKg = displayToKg(t.value, unit);
    } else if (field === "reps") {
      var reps = t.value === "" ? null : Number(t.value);
      draft.sets[idx].reps = reps != null && !isNaN(reps) ? reps : null;
    } else if (field === "rpe") {
      var rpe = t.value === "" ? null : Number(t.value);
      draft.sets[idx].rpe = rpe != null && !isNaN(rpe) ? rpe : null;
    } else if (field === "set-note") {
      draft.sets[idx].note = t.value || "";
    }
    schedulePersistDraft();
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
    var block = root.querySelector('.set-row[data-set-idx="' + next + '"]');
    if (!block) block = root.querySelector('[data-set-idx="' + next + '"]');
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

  function applySupersetToSection(section, ssId) {
    if (!section) return;
    for (var i = 0; i < section.indices.length; i++) {
      ensureSetShape(draft.sets[section.indices[i]]);
      draft.sets[section.indices[i]].supersetId = ssId;
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
      ensureWorkoutStarted();
      var added = makeSet("", {
        loadKg: null,
        reps: null,
        rpe: null,
        completed: false,
        supersetId: null,
      });
      added.targetLoadKg = null;
      added.targetRepsLabel = "";
      draft.sets.push(added);
      schedulePersistDraft();
      paintLog(root);
      return;
    }

    if (action === "add-set-to-exercise") {
      ensureWorkoutStarted();
      var addSecIdx = Number(btn.getAttribute("data-section-idx"));
      var addSections = groupExerciseSections(draft.sets || []);
      var addSec = addSections[addSecIdx];
      if (!addSec) return;
      var template = draft.sets[addSec.indices[addSec.indices.length - 1]];
      var insertAt = addSec.indices[addSec.indices.length - 1] + 1;
      var newRow = makeSet(addSec.exerciseId, {
        loadKg: template && template.loadKg != null ? template.loadKg : null,
        reps: null,
        rpe: null,
        completed: false,
        supersetId: template ? template.supersetId : null,
      });
      newRow.targetLoadKg = null;
      newRow.targetRepsLabel = "";
      draft.sets.splice(insertAt, 0, newRow);
      schedulePersistDraft();
      paintLog(root);
      return;
    }

    if (action === "join-superset") {
      var joinIdx = Number(btn.getAttribute("data-section-idx"));
      var joinSections = groupExerciseSections(draft.sets || []);
      var joinSec = joinSections[joinIdx];
      var prevJoin = joinIdx > 0 ? joinSections[joinIdx - 1] : null;
      if (!joinSec || !prevJoin) return;
      var ss =
        prevJoin.supersetId ||
        joinSec.supersetId ||
        newSupersetId();
      applySupersetToSection(prevJoin, ss);
      applySupersetToSection(joinSec, ss);
      schedulePersistDraft();
      paintLog(root);
      return;
    }

    if (action === "ungroup-superset") {
      var ugIdx = Number(btn.getAttribute("data-section-idx"));
      var ugSections = groupExerciseSections(draft.sets || []);
      var ugSec = ugSections[ugIdx];
      if (!ugSec || !ugSec.supersetId) return;
      var ugId = ugSec.supersetId;
      for (var ui = 0; ui < ugSections.length; ui++) {
        if (ugSections[ui].supersetId === ugId) {
          applySupersetToSection(ugSections[ui], null);
        }
      }
      schedulePersistDraft();
      paintLog(root);
      return;
    }

    if (action === "toggle-session-details") {
      syncAllFromDom(root);
      sessionDetailsOpen = !sessionDetailsOpen;
      schedulePersistDraft();
      paintLog(root);
      return;
    }

    if (action === "toggle-ex-menu") {
      syncAllFromDom(root);
      var menuSecIdx = Number(btn.getAttribute("data-section-idx"));
      var menuSections = groupExerciseSections(draft.sets || []);
      var menuSec = menuSections[menuSecIdx];
      var menuKeyToggle = sectionMenuKey(
        menuSecIdx,
        menuSec ? menuSec.exerciseId : ""
      );
      openExMenus[menuKeyToggle] = !openExMenus[menuKeyToggle];
      paintLog(root);
      return;
    }

    if (action === "remove-exercise") {
      var remSecIdx = Number(btn.getAttribute("data-section-idx"));
      var remSections = groupExerciseSections(draft.sets || []);
      var remSec = remSections[remSecIdx];
      if (!remSec) return;
      if (!confirm("Remove this exercise and all its sets?")) return;
      var remIndices = remSec.indices.slice().sort(function (a, b) {
        return b - a;
      });
      for (var ri = 0; ri < remIndices.length; ri++) {
        draft.sets.splice(remIndices[ri], 1);
      }
      schedulePersistDraft();
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

    if (action === "new-session" || action === "cancel-workout") {
      if (draft.sets && draft.sets.length) {
        if (!confirm("Cancel this workout? Unsaved sets on this screen will be cleared.")) {
          return;
        }
      }
      hideOverlay();
      endWorkoutClock(true);
      clearPersistedDraft();
      openSetExtras = {};
      openExMenus = {};
      openSectionNotes = {};
      sessionDetailsOpen = false;
      draft = emptyDraft();
      removeActiveBar();
      paintLog(root);
      return;
    }

    if (action === "prefill-program") {
      SL.pendingStart = true;
      clearPersistedDraft();
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
          schedulePersistDraft();
          if (root.isConnected) paintLog(root);
        });
      } else {
        ensureDraft({ startFromProgram: true });
        schedulePersistDraft();
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
      clearPersistedDraft();
      draft = null;
      var waveLoadLabel =
        activeProg.kind === "dip_wave" ? "dip" : "pull-up";
      root.innerHTML =
        '<div class="card"><p class="muted">Loading ' +
        waveLoadLabel +
        " session…</p></div>";
      ensureDraft({ startFromProgram: true, waveDay: wave }, function () {
        schedulePersistDraft();
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
      clearPersistedDraft();
      draft = null;
      root.innerHTML = '<div class="card"><p class="muted">Updating wave…</p></div>';
      ensureDraft({ startFromProgram: true, waveDay: "intensive" }, function () {
        schedulePersistDraft();
        if (root.isConnected) paintLog(root);
      });
      return;
    }

    if (action === "toggle-section-note") {
      var wrap = btn.closest(".exercise-block");
      if (!wrap) return;
      var noteExId = wrap.getAttribute("data-exercise-id") || "";
      openSectionNotes[noteExId] = true;
      var noteWrap = wrap.querySelector("[data-section-note-wrap]");
      if (noteWrap) noteWrap.classList.remove("hidden");
      var ta = noteWrap ? noteWrap.querySelector("textarea") : null;
      if (ta && typeof ta.focus === "function") ta.focus();
      btn.setAttribute("aria-expanded", "true");
      return;
    }

    var block = btn.closest("[data-set-idx]");
    if (!block) return;
    var idx = Number(block.getAttribute("data-set-idx"));
    if (!draft.sets[idx]) return;
    ensureSetShape(draft.sets[idx]);

    if (action === "cycle-set-type") {
      draft.sets[idx].type = cycleSetType(draft.sets[idx].type || "normal");
      schedulePersistDraft();
      paintLog(root);
      return;
    }

    if (action === "toggle-set-extra") {
      syncAllFromDom(root);
      ensureSetShape(draft.sets[idx]);
      var sid = draft.sets[idx].id;
      openSetExtras[sid] = !openSetExtras[sid];
      paintLog(root);
      return;
    }

    if (action === "toggle-set-note") {
      var noteWrap = btn.closest(".set-note");
      if (!noteWrap) return;
      var noteInput = noteWrap.querySelector(".set-note-input");
      if (!noteInput) return;
      var noteOpen = noteInput.classList.contains("hidden");
      if (noteOpen) {
        noteInput.classList.remove("hidden");
        btn.setAttribute("aria-expanded", "true");
        if (typeof noteInput.focus === "function") noteInput.focus();
      } else {
        noteInput.classList.add("hidden");
        btn.setAttribute("aria-expanded", "false");
      }
      return;
    }

    if (action === "apply-prev-set") {
      var sectionsPrev = groupExerciseSections(draft.sets || []);
      var localIdx = 0;
      var foundLocal = false;
      for (var sp = 0; sp < sectionsPrev.length; sp++) {
        for (var spi = 0; spi < sectionsPrev[sp].indices.length; spi++) {
          if (sectionsPrev[sp].indices[spi] === idx) {
            localIdx = sectionsPrev[sp].localNums[spi];
            foundLocal = true;
            break;
          }
        }
        if (foundLocal) break;
      }
      var prevList = previousSetsFor(draft.sets[idx].exerciseId);
      var prev = prevList[localIdx];
      if (!prev) return;
      if (prev.loadKg != null) draft.sets[idx].loadKg = prev.loadKg;
      if (prev.reps != null) draft.sets[idx].reps = prev.reps;
      schedulePersistDraft();
      paintLog(root);
      return;
    }

    if (action === "remove-set") {
      if (!confirm("Remove this set?")) return;
      draft.sets.splice(idx, 1);
      schedulePersistDraft();
      paintLog(root);
      return;
    }

    if (action === "complete-set") {
      syncSetFromDom(block, idx);
      var set = draft.sets[idx];
      ensureSetShape(set);
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
      ensureWorkoutStarted();
      set.completed = true;
      startRestForExercise(set.exerciseId);
      pendingScrollSetIdx = idx;
      schedulePersistDraft();
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
    ensureSetShape(set);
    var row =
      block.classList && block.classList.contains("set-row")
        ? block
        : block.closest
          ? block.closest(".set-row") || block
          : block;
    var meta = row.parentNode
      ? row.parentNode.querySelector('.set-row-meta[data-set-idx="' + idx + '"]')
      : null;
    var load = row.querySelector('[data-field="load"]');
    var reps = row.querySelector('[data-field="reps"]');
    var rpe = meta ? meta.querySelector('[data-field="rpe"]') : row.querySelector('[data-field="rpe"]');
    var note = meta ? meta.querySelector('[data-field="set-note"]') : null;
    if (load) set.loadKg = displayToKg(load.value, unit);
    if (reps) {
      var r = reps.value === "" ? null : Number(reps.value);
      set.reps = r != null && !isNaN(r) ? r : null;
    }
    if (rpe) {
      var rp = rpe.value === "" ? null : Number(rpe.value);
      set.rpe = rp != null && !isNaN(rp) ? rp : null;
    }
    if (note) set.note = note.value || "";
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
    var rows = root.querySelectorAll(".set-row[data-set-idx]");
    for (var i = 0; i < rows.length; i++) {
      var idx = Number(rows[i].getAttribute("data-set-idx"));
      syncSetFromDom(rows[i], idx);
    }
    var sectionNotes = root.querySelectorAll('[data-field="section-note"]');
    for (var sn = 0; sn < sectionNotes.length; sn++) {
      var ex = sectionNotes[sn].getAttribute("data-exercise-id");
      if (ex) draft.sectionNotes[ex] = sectionNotes[sn].value || "";
    }
  }

  function saveSession(markAllComplete) {
    var root = document.getElementById("view-root");
    syncAllFromDom(root);

    var outSets = [];
    for (var i = 0; i < draft.sets.length; i++) {
      var set = draft.sets[i];
      ensureSetShape(set);
      if (!set.exerciseId) continue;
      if (set.reps == null || set.reps === "") continue;
      var completed = markAllComplete ? true : !!set.completed;
      if (!completed && !markAllComplete) {
        completed = true;
      }
      var row = makeSet(set.exerciseId, {
        loadKg: set.loadKg != null ? Number(set.loadKg) : 0,
        reps: Number(set.reps),
        completed: true,
        type: set.type || "normal",
        note: typeof set.note === "string" ? set.note : "",
        supersetId: set.supersetId != null ? set.supersetId : null,
      });
      if (set.id) row.id = set.id;
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

    ensureWorkoutStarted();
    var endedAt = Date.now();
    var startedAt = Number(draft.startedAt) || endedAt;
    var durationSec = Math.max(0, Math.round((endedAt - startedAt) / 1000));
    endWorkoutClock(false);

    var sess = {
      id: draft.id || uid(),
      dateISO: draft.dateISO || todayISO(),
      bodyweightKg: draft.bodyweightKg,
      note: draft.note || "",
      sectionNotes: sectionNotes,
      sets: outSets,
      startedAt: startedAt,
      endedAt: endedAt,
      durationSec: durationSec,
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
    clearPersistedDraft();
    draft = null;
    openSetExtras = {};
    openExMenus = {};
    openSectionNotes = {};
    sessionDetailsOpen = false;
    removeActiveBar();
    if (
      SL.views &&
      SL.views.summary &&
      typeof SL.navigate === "function"
    ) {
      SL.navigate("summary", { sessionId: sess.id });
    } else if (typeof SL.navigate === "function") {
      SL.navigate("history");
    } else if (typeof SL.refresh === "function") {
      SL.refresh();
    }
  }

  function paintLog(root) {
    ensureOverlay();
    if (!draft) draft = emptyDraft();
    if (draft.sets && draft.sets.length && (draft.startedAt == null || isNaN(Number(draft.startedAt)))) {
      ensureWorkoutStarted();
    }
    var s = settings();
    var unit = s.unit;
    var volStats = draftVolumeStats();
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
          '<div class="row wrap log-wave-row">' +
          '<button type="button" class="btn grow' +
          (draft.waveDay === "intensive" ? " btn-primary" : " secondary") +
          '" data-action="pick-wave-day" data-wave="intensive">Intensive</button>' +
          '<button type="button" class="btn grow' +
          (draft.waveDay === "volume" ? " btn-primary" : " secondary") +
          '" data-action="pick-wave-day" data-wave="volume">Volume</button>' +
          "</div>" +
          '<div class="row wrap log-wave-row">' +
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
          '<label class="field row log-link-row">' +
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

      var summaryParts = [];
      summaryParts.push(draft.dateISO || todayISO());
      if (draft.bodyweightKg != null) {
        summaryParts.push(fmtWeight(draft.bodyweightKg, unit));
      }
      if (linked && draft.dayName) {
        summaryParts.push(draft.dayName);
      } else if (linked) {
        summaryParts.push("Program linked");
      }
      var summaryLine = summaryParts.join(" · ");

      root.innerHTML =
        '<div class="stack stack-lg log-session-layout">' +
        '<div class="card log-workout-clock-card">' +
        '<div class="log-workout-clock-row">' +
        '<span class="log-workout-title">' +
        esc(workoutDisplayName()) +
        "</span>" +
        '<span id="log-workout-clock" class="log-workout-clock mono" aria-live="polite">' +
        esc(formatElapsed(workoutElapsedMs())) +
        "</span>" +
        '<button type="button" class="log-text-action log-finish-inline" data-action="complete-session">Finish</button>' +
        "</div></div>" +
        '<div class="card log-session-card">' +
        '<div class="log-session-summary">' +
        '<span class="log-session-summary-text">' +
        esc(summaryLine) +
        "</span>" +
        '<button type="button" class="log-session-details-toggle" data-action="toggle-session-details" aria-expanded="' +
        (sessionDetailsOpen ? "true" : "false") +
        '">' +
        (sessionDetailsOpen ? "Hide" : "Details") +
        "</button></div>" +
        '<div class="log-session-details' +
        (sessionDetailsOpen ? "" : " hidden") +
        '">' +
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
        '<button type="button" class="log-text-action" data-action="save-session">Save session</button>' +
        "</div></div>" +
        '<div class="card log-sets-card">' +
        '<div class="card-head"><h2 class="card-title log-sets-title">Sets</h2>' +
        '<span class="muted small log-volume-meta">' +
        esc(volStats.working + " working") +
        " · " +
        esc(fmtWeight(volStats.volumeKg, unit)) +
        "</span></div>" +
        renderSetBlocks(exercises, unit) +
        '<div class="log-session-actions">' +
        '<button type="button" class="log-text-action" data-action="add-set">Add exercise</button>' +
        '<button type="button" class="log-text-action log-text-action--primary" data-action="complete-session">Finish workout</button>' +
        '<button type="button" class="log-text-action log-text-action--danger" data-action="cancel-workout">Cancel workout</button>' +
        "</div></div>" +
        "</div>";

      root.setAttribute("data-sl-view", "log");
      bindLog(root);
      removeCompleteFab();
      removeActiveBar();
      schedulePersistDraft();
      if (draft.startedAt != null) {
        startWorkoutClockTick();
      } else {
        stopWorkoutClockTick();
        syncWorkoutClockUI();
      }
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
      clearPersistedDraft();
      ensureDraft(opts, function () {
        schedulePersistDraft();
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
      if (action === "goto-summary") {
        var sumId = actionBtn.getAttribute("data-session-id") || historyDetailId;
        if (!sumId) return;
        if (SL.views && SL.views.summary && typeof SL.navigate === "function") {
          SL.navigate("summary", { sessionId: sumId });
        }
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
      var workingNum = 0;
      for (var j = 0; j < sets.length; j++) {
        var set = sets[j];
        if (set.exerciseId !== exId) continue;
        n += 1;
        var st = set.type || "normal";
        if (st !== "warmup") workingNum += 1;
        var marker = setTypeMarker(st, workingNum || 1);
        var typeCls = setTypeClass(st);
        var setNote =
          typeof set.note === "string" && String(set.note).trim()
            ? '<div class="set-note hist-set-note">' + esc(set.note) + "</div>"
            : "";
        exRows +=
          "<tr class=\"" +
          (st === "warmup" ? "set-row--warmup" : "") +
          '"><td><span class="' +
          typeCls +
          '">' +
          esc(marker) +
          "</span></td><td>" +
          esc(fmtWeight(set.loadKg, unit)) +
          "</td><td>" +
          esc(set.reps != null ? set.reps : "\u2014") +
          "</td><td>" +
          esc(set.rpe != null ? set.rpe : "\u2014") +
          "</td></tr>" +
          (setNote
            ? '<tr class="hist-set-note-row"><td colspan="4">' + setNote + "</td></tr>"
            : "");
      }
      sectionsHtml +=
        '<div class="card section-card">' +
        "<h2>" +
        esc(names[exId] || exId) +
        "</h2>" +
        '<table class="detail-set-table"><thead><tr><th>Set</th><th>Load</th><th>Reps</th><th>RPE</th></tr></thead><tbody>' +
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

    var summaryLink =
      SL.views && SL.views.summary
        ? '<button type="button" class="btn block" data-hist-action="goto-summary" data-session-id="' +
          esc(sess.id) +
          '">View summary</button>'
        : "";

    root.innerHTML =
      '<div class="stack stack-lg">' +
      '<button type="button" class="btn sm" data-hist-action="back">Back to calendar</button>' +
      '<div class="card">' +
      '<div class="card-head"><div class="date">' +
      esc(sess.dateISO || "") +
      "</div>" +
      '<span class="muted">' +
      esc(sess.bodyweightKg != null ? fmtWeight(sess.bodyweightKg, unit) : "bw \u2014") +
      (sess.durationSec != null && sess.durationSec > 0
        ? " · " + formatElapsed(sess.durationSec * 1000)
        : "") +
      "</span></div>" +
      '<label class="field"><span class="lbl">Session note</span>' +
      '<textarea id="hist-session-note" rows="3" placeholder="Your opinion on this session overall">' +
      esc(sess.note || "") +
      "</textarea></label>" +
      "</div>" +
      (sectionsHtml || '<div class="card"><p class="muted">No sets logged.</p></div>') +
      '<div class="stack">' +
      summaryLink +
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
    stopWorkoutClockTick();
    removeCompleteFab();
    var meta = document.getElementById("topbar-meta");
    if (meta) {
      meta.textContent = "";
      meta.classList.remove("workout-clock");
    }
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

  SL.log = {
    hasActiveSession: hasActiveSession,
    activeSessionInfo: activeSessionInfo,
    syncActiveBar: syncActiveBar,
    resumeActiveSession: resumeActiveSession,
  };
})();
