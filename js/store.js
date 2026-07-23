/* Streetlifting — persistence + derived metrics. */
(function () {
  "use strict";

  window.SL = window.SL || {};

  var STORAGE_KEY = "streetlifting-v1";
  var EXERCISES_URL = "data/exercises.json";
  var SQUAT_CYCLE_URL = "data/squat-1rm-cycle.json";
  var PULLUP_WAVE_URL = "data/pullup-wave-cycle.json";

  var state = null;
  var builtinsCache = null;
  var builtinsPromise = null;
  var squatSchemeCache = null;
  var squatSchemePromise = null;
  var pullupWaveCache = null;
  var pullupWavePromise = null;

  function defaults() {
    return {
      settings: {
        unit: "kg",
        restSeconds: 180,
        bodyweightKg: null,
      },
      customExercises: [],
      programs: [],
      sessions: [],
    };
  }

  function ensureId(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (!obj.id) {
      obj.id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
    return obj;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function filterPlainObjects(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (isPlainObject(arr[i])) out.push(arr[i]);
    }
    return out;
  }

  /** Top-level shape check: salvageable exports pass; junk types fail. */
  function validateStore(data) {
    if (!isPlainObject(data)) return false;
    if (data.settings != null && !isPlainObject(data.settings)) return false;
    if (data.customExercises != null && !Array.isArray(data.customExercises)) return false;
    if (data.programs != null && !Array.isArray(data.programs)) return false;
    if (data.sessions != null && !Array.isArray(data.sessions)) return false;
    return true;
  }

  function coerceFiniteNumber(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      var n = Number(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  function normalizeSettings(rawSettings) {
    var s = defaults().settings;
    if (!isPlainObject(rawSettings)) return s;
    if (rawSettings.unit === "kg" || rawSettings.unit === "lb") {
      s.unit = rawSettings.unit;
    }
    var rest = coerceFiniteNumber(rawSettings.restSeconds);
    if (rest != null) {
      if (rest < 0) rest = 0;
      s.restSeconds = Math.round(rest);
    }
    if (rawSettings.bodyweightKg === null) {
      s.bodyweightKg = null;
    } else {
      var bw = coerceFiniteNumber(rawSettings.bodyweightKg);
      if (bw != null) s.bodyweightKg = bw;
    }
    return s;
  }

  function normalizeSession(sess) {
    if (!isPlainObject(sess)) return null;
    if (typeof sess.note !== "string") sess.note = sess.note != null ? String(sess.note) : "";
    if (!isPlainObject(sess.sectionNotes)) sess.sectionNotes = {};
    if (!Array.isArray(sess.sets)) sess.sets = [];
    return sess;
  }

  function normalizeProgram(p) {
    if (!isPlainObject(p)) return null;
    if (!Array.isArray(p.days)) p.days = [];
    else p.days = filterPlainObjects(p.days);
    return p;
  }

  function normalizeLoaded(raw) {
    var d = defaults();
    if (!isPlainObject(raw)) return d;

    d.settings = normalizeSettings(raw.settings);
    d.customExercises = filterPlainObjects(raw.customExercises);

    var programs = filterPlainObjects(raw.programs);
    for (var pi = 0; pi < programs.length; pi++) {
      normalizeProgram(programs[pi]);
    }
    d.programs = programs;

    var sessions = filterPlainObjects(raw.sessions);
    for (var i = 0; i < sessions.length; i++) {
      normalizeSession(sessions[i]);
    }
    d.sessions = sessions;
    return d;
  }

  /** Fill missing settings / array roots in place (stable object identity for views). */
  function ensureStateShape(s) {
    if (!isPlainObject(s)) return defaults();
    if (!isPlainObject(s.settings)) {
      s.settings = defaults().settings;
    } else {
      var fixed = normalizeSettings(s.settings);
      s.settings.unit = fixed.unit;
      s.settings.restSeconds = fixed.restSeconds;
      s.settings.bodyweightKg = fixed.bodyweightKg;
    }
    if (!Array.isArray(s.customExercises)) s.customExercises = [];
    if (!Array.isArray(s.programs)) s.programs = [];
    if (!Array.isArray(s.sessions)) s.sessions = [];
    return s;
  }

  function loadBuiltins() {
    if (builtinsCache) return Promise.resolve(builtinsCache);
    if (builtinsPromise) return builtinsPromise;
    builtinsPromise = fetch(EXERCISES_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load exercises.json: " + res.status);
        return res.json();
      })
      .then(function (list) {
        builtinsCache = Array.isArray(list) ? list : [];
        return builtinsCache;
      })
      .catch(function (err) {
        builtinsPromise = null;
        throw err;
      });
    return builtinsPromise;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        // Salvage partial / corrupt blobs; wipe only if not an object root.
        state = isPlainObject(parsed) ? normalizeLoaded(parsed) : defaults();
      } else {
        state = defaults();
      }
    } catch (e) {
      state = defaults();
    }
    return state;
  }

  function save() {
    if (!state) state = defaults();
    ensureStateShape(state);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      throw new Error("Failed to save (storage full or unavailable)");
    }
  }

  function get() {
    if (!state) load();
    ensureStateShape(state);
    return state;
  }

  function reset() {
    state = defaults();
    save();
    return state;
  }

  function listExercises() {
    return loadBuiltins().then(function (builtins) {
      var s = get();
      var custom = filterPlainObjects(s.customExercises);
      return (Array.isArray(builtins) ? builtins : []).concat(custom);
    });
  }

  function upsertCustomExercise(ex) {
    if (!isPlainObject(ex)) throw new Error("Invalid exercise");
    ensureId(ex);
    var s = get();
    var i = s.customExercises.findIndex(function (e) {
      return e && e.id === ex.id;
    });
    if (i >= 0) s.customExercises[i] = ex;
    else s.customExercises.push(ex);
    save();
    return ex;
  }

  function deleteCustomExercise(id) {
    var s = get();
    s.customExercises = s.customExercises.filter(function (e) {
      return e && e.id !== id;
    });
    save();
  }

  function listPrograms() {
    return filterPlainObjects(get().programs).slice();
  }

  function getActiveProgram() {
    var programs = get().programs;
    if (!Array.isArray(programs)) return null;
    for (var i = 0; i < programs.length; i++) {
      var p = programs[i];
      if (isPlainObject(p) && p.active) return p;
    }
    return null;
  }

  function upsertProgram(p) {
    if (!isPlainObject(p)) throw new Error("Invalid program");
    ensureId(p);
    if (!Array.isArray(p.days)) p.days = [];
    for (var d = 0; d < p.days.length; d++) {
      if (isPlainObject(p.days[d])) ensureId(p.days[d]);
    }
    p.days = filterPlainObjects(p.days);
    var s = get();
    var i = s.programs.findIndex(function (x) {
      return x && x.id === p.id;
    });
    if (i >= 0) s.programs[i] = p;
    else s.programs.push(p);
    save();
    return p;
  }

  function deleteProgram(id) {
    var s = get();
    s.programs = s.programs.filter(function (p) {
      return p && p.id !== id;
    });
    save();
  }

  function setActiveProgram(id) {
    var s = get();
    for (var i = 0; i < s.programs.length; i++) {
      var p = s.programs[i];
      if (!isPlainObject(p)) continue;
      p.active = p.id === id;
    }
    save();
  }

  function listSessions() {
    return filterPlainObjects(get().sessions)
      .slice()
      .sort(function (a, b) {
        var da = (a && a.dateISO) || "";
        var db = (b && b.dateISO) || "";
        if (da < db) return 1;
        if (da > db) return -1;
        return 0;
      });
  }

  function upsertSession(sess) {
    if (!isPlainObject(sess)) throw new Error("Invalid session");
    ensureId(sess);
    if (!Array.isArray(sess.sets)) sess.sets = [];
    if (typeof sess.note !== "string") sess.note = sess.note != null ? String(sess.note) : "";
    if (!isPlainObject(sess.sectionNotes)) sess.sectionNotes = {};
    var s = get();
    var i = s.sessions.findIndex(function (x) {
      return x && x.id === sess.id;
    });
    if (i >= 0) s.sessions[i] = sess;
    else s.sessions.push(sess);
    save();
    return sess;
  }

  function deleteSession(id) {
    var s = get();
    s.sessions = s.sessions.filter(function (x) {
      return x && x.id !== id;
    });
    save();
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function backupCounts(data) {
    var s = isPlainObject(data) ? data : get();
    return {
      programs: Array.isArray(s.programs) ? s.programs.length : 0,
      sessions: Array.isArray(s.sessions) ? s.sessions.length : 0,
      customExercises: Array.isArray(s.customExercises) ? s.customExercises.length : 0,
    };
  }

  /** Full backup: settings, custom exercises, programs, and workout history (sessions). */
  function exportJson() {
    var s = get();
    var programs = cloneJson(s.programs || []);
    var sessions = cloneJson(s.sessions || []);
    sessions.sort(function (a, b) {
      var da = (a && a.dateISO) || "";
      var db = (b && b.dateISO) || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return 0;
    });
    var payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: cloneJson(s.settings),
      customExercises: cloneJson(s.customExercises || []),
      programs: programs,
      sessions: sessions,
    };
    payload.counts = backupCounts(payload);
    return JSON.stringify(payload, null, 2);
  }

  function importJson(str) {
    if (str == null) throw new Error("Invalid JSON");
    var text = String(str).replace(/^\uFEFF/, "").trim();
    if (!text) throw new Error("Invalid JSON");
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error("Invalid JSON");
    }
    if (!validateStore(parsed)) {
      throw new Error("Invalid store shape");
    }
    // Accept v1 backups and legacy flat store blobs (both carry programs + sessions).
    state = normalizeLoaded(parsed);
    save();
    return {
      state: state,
      counts: backupCounts(state),
    };
  }

  function e1rm(bwKg, loadKg, reps) {
    var bw = Number(bwKg) || 0;
    var load = Number(loadKg) || 0;
    var r = Number(reps) || 0;
    var total = bw + load;
    if (r <= 1) return total;
    return total * (1 + r / 30);
  }

  function historyFor(exerciseId) {
    var sessions = filterPlainObjects(get().sessions).sort(function (a, b) {
      var da = (a && a.dateISO) || "";
      var db = (b && b.dateISO) || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return 0;
    });
    var out = [];
    for (var i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      var sets = Array.isArray(sess.sets) ? sess.sets : [];
      var bw = sess.bodyweightKg;
      for (var j = 0; j < sets.length; j++) {
        var set = sets[j];
        if (!set || typeof set !== "object") continue;
        if (set.exerciseId !== exerciseId) continue;
        if (set.completed === false) continue;
        out.push({
          dateISO: sess.dateISO,
          bodyweightKg: bw,
          loadKg: set.loadKg,
          reps: set.reps,
          e1rm: e1rm(bw, set.loadKg, set.reps),
        });
      }
    }
    return out;
  }

  function bestSet(exerciseId) {
    var hist = historyFor(exerciseId);
    if (!hist.length) return null;
    var best = hist[0];
    for (var i = 1; i < hist.length; i++) {
      if (hist[i].e1rm > best.e1rm) best = hist[i];
    }
    return best;
  }

  function roundLoadKg(kg) {
    if (kg == null || !isFinite(kg)) return null;
    return Math.round(Number(kg) * 2) / 2;
  }

  function addDaysISO(dateISO, days) {
    var parts = String(dateISO || "").split("-");
    if (parts.length !== 3) return dateISO;
    var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    d.setUTCDate(d.getUTCDate() + days);
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1);
    if (m.length < 2) m = "0" + m;
    var day = String(d.getUTCDate());
    if (day.length < 2) day = "0" + day;
    return y + "-" + m + "-" + day;
  }

  function todayISO() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function loadSquatCycleScheme() {
    if (squatSchemeCache) return Promise.resolve(squatSchemeCache);
    if (squatSchemePromise) return squatSchemePromise;
    squatSchemePromise = fetch(SQUAT_CYCLE_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load squat cycle: " + res.status);
        return res.json();
      })
      .then(function (scheme) {
        squatSchemeCache = scheme;
        return scheme;
      })
      .catch(function (err) {
        squatSchemePromise = null;
        throw err;
      });
    return squatSchemePromise;
  }

  function expandSetPrescription(exId, presc, target1rmKg) {
    var pct = presc.pct != null ? Number(presc.pct) : null;
    var pctMin = presc.pctMin != null ? Number(presc.pctMin) : pct;
    var pctMax = presc.pctMax != null ? Number(presc.pctMax) : pct;
    var loadKg = roundLoadKg(target1rmKg * pctMin);
    var loadKgMax =
      pctMax != null && pctMax !== pctMin ? roundLoadKg(target1rmKg * pctMax) : null;
    var pctLabel =
      pctMax != null && pctMin != null && pctMax !== pctMin
        ? Math.round(pctMin * 100) + "-" + Math.round(pctMax * 100) + "%"
        : Math.round((pct != null ? pct : pctMin) * 100) + "%";
    return {
      exerciseId: exId,
      sets: presc.sets != null ? Number(presc.sets) : 1,
      reps: presc.reps != null ? Number(presc.reps) : 1,
      pct: pct,
      pctMin: pctMin,
      pctMax: pctMax,
      pctLabel: pctLabel,
      loadKg: loadKg,
      loadKgMax: loadKgMax,
      startLoadKg: loadKg,
      repMin: presc.reps,
      repMax: presc.reps,
      progression: "manual",
    };
  }

  function expandPercentCycle(program, scheme) {
    if (!program || !scheme) return [];
    var target = Number(program.target1rmKg);
    if (!isFinite(target) || target <= 0) return [];
    var start = program.startDateISO || todayISO();
    var exId = program.exerciseId || scheme.exerciseId || "squat";
    var out = [];
    var weeks = scheme.weeks || [];
    for (var w = 0; w < weeks.length; w++) {
      var week = weeks[w];
      var weekNum = week.week != null ? week.week : w + 1;
      var days = week.days || [];
      for (var d = 0; d < days.length; d++) {
        var day = days[d];
        var dayNum = day.day != null ? day.day : d + 1;
        var offset = (weekNum - 1) * 7 + (dayNum === 1 ? 0 : 3);
        var prescriptions = day.sets || [];
        var exercises = [];
        for (var s = 0; s < prescriptions.length; s++) {
          exercises.push(expandSetPrescription(exId, prescriptions[s], target));
        }
        var sessionKey = "w" + weekNum + "d" + dayNum;
        out.push({
          id: sessionKey,
          week: weekNum,
          day: dayNum,
          name: "Week " + weekNum + " · " + (day.name || "Day " + dayNum),
          dateISO: addDaysISO(start, offset),
          exerciseId: exId,
          exercises: exercises,
        });
      }
    }
    return out;
  }

  function nextCycleSession(program, scheme) {
    var sessions = expandPercentCycle(program, scheme);
    if (!sessions.length) return null;
    var logged = listSessions() || [];
    var done = {};
    for (var i = 0; i < logged.length; i++) {
      var sess = logged[i];
      if (!sess || sess.programId !== program.id) continue;
      if (sess.cycleKey) done[sess.cycleKey] = true;
      else if (sess.week != null && sess.day != null) {
        done["w" + sess.week + "d" + sess.day] = true;
      }
    }
    var today = todayISO();
    var upcoming = null;
    for (var j = 0; j < sessions.length; j++) {
      var s = sessions[j];
      if (done[s.id]) continue;
      if (s.dateISO <= today) return s;
      if (!upcoming) upcoming = s;
    }
    return upcoming || sessions[sessions.length - 1];
  }

  function loadPullupWaveScheme() {
    if (pullupWaveCache) return Promise.resolve(pullupWaveCache);
    if (pullupWavePromise) return pullupWavePromise;
    pullupWavePromise = fetch(PULLUP_WAVE_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load pull-up wave: " + res.status);
        return res.json();
      })
      .then(function (scheme) {
        pullupWaveCache = scheme;
        return scheme;
      })
      .catch(function (err) {
        pullupWavePromise = null;
        throw err;
      });
    return pullupWavePromise;
  }

  function pullupWavePhase(program, scheme) {
    var phases = (scheme && scheme.phases) || [];
    if (!phases.length) return null;
    var idx = Number(program.phaseIndex) || 0;
    if (idx < 0) idx = 0;
    if (idx >= phases.length) idx = phases.length - 1;
    return { index: idx, phase: phases[idx], phases: phases };
  }

  function lastPullupWaveDay(program) {
    // Prefer raw insert order over listSessions date sort: Intensive + Volume
    // logged the same day must resolve Volume as last, not Intensive.
    var raw = get().sessions || [];
    var best = null;
    var bestDate = "";
    var bestIdx = -1;
    for (var i = 0; i < raw.length; i++) {
      var sess = raw[i];
      if (!sess || sess.programId !== program.id) continue;
      if (sess.waveDay !== "intensive" && sess.waveDay !== "volume") continue;
      var d = sess.dateISO || "";
      if (!best || d > bestDate || (d === bestDate && i > bestIdx)) {
        best = sess.waveDay;
        bestDate = d;
        bestIdx = i;
      }
    }
    return best;
  }

  function resolvePullupWaveWhich(program, which) {
    if (which === "intensive" || which === "volume") return which;
    // Explicit preference after new micro/macro or user pick
    if (program && (program.nextWaveDay === "intensive" || program.nextWaveDay === "volume")) {
      return program.nextWaveDay;
    }
    var last = lastPullupWaveDay(program);
    if (last === "intensive") return "volume";
    return "intensive";
  }

  function setPullupNextWaveDay(programOrId, waveDay) {
    var program =
      typeof programOrId === "string" ? findProgramById(programOrId) : programOrId;
    if (!program || program.kind !== "pullup_wave") {
      throw new Error("Not a pull-up wave program");
    }
    if (waveDay !== "intensive" && waveDay !== "volume") {
      throw new Error("waveDay must be intensive or volume");
    }
    program.nextWaveDay = waveDay;
    upsertProgram(program);
    return program;
  }

  function clearPullupNextWaveDay(programOrId, matchedWaveDay) {
    var program =
      typeof programOrId === "string" ? findProgramById(programOrId) : programOrId;
    if (!program || program.kind !== "pullup_wave") return program;
    if (matchedWaveDay && program.nextWaveDay !== matchedWaveDay) return program;
    if (program.nextWaveDay == null) return program;
    program.nextWaveDay = null;
    upsertProgram(program);
    return program;
  }

  function currentPullupWaveSession(program, scheme, which) {
    if (!program || !scheme) return null;
    var resolved = resolvePullupWaveWhich(program, which || "next");
    var info = pullupWavePhase(program, scheme);
    if (!info) return null;
    var phase = info.phase;
    var exId = program.exerciseId || scheme.exerciseId || "pullup";
    var intensiveLoad = roundLoadKg(Number(program.intensiveLoadKg));
    if (intensiveLoad == null) intensiveLoad = roundLoadKg(Number(program.startLoadKg)) || 0;
    var loadKg = intensiveLoad;
    var sets;
    var reps;
    var name;
    if (resolved === "volume") {
      sets = phase.volumeSets != null ? Number(phase.volumeSets) : 6;
      reps = phase.volumeReps != null ? Number(phase.volumeReps) : phase.reps;
      var offset = phase.volumeOffsetKg != null ? Number(phase.volumeOffsetKg) : 0;
      loadKg = roundLoadKg(intensiveLoad + offset);
      if (loadKg < 0) loadKg = 0;
      name = "Volume · 6×" + reps;
    } else {
      sets = phase.intensiveSets != null ? Number(phase.intensiveSets) : 3;
      reps = phase.reps != null ? Number(phase.reps) : 10;
      name = "Intensive · 3×" + reps;
    }
    return {
      id: "wave-" + resolved + "-p" + info.index,
      name: name,
      waveDay: resolved,
      phaseIndex: info.index,
      intensiveLoadKg: intensiveLoad,
      exerciseId: exId,
      exercises: [
        {
          exerciseId: exId,
          sets: sets,
          reps: reps,
          loadKg: loadKg,
          startLoadKg: loadKg,
          repMin: reps,
          repMax: reps,
          progression: "manual",
          pctLabel: resolved === "volume" && phase.volumeOffsetKg
            ? "intensive " + (phase.volumeOffsetKg > 0 ? "+" : "") + phase.volumeOffsetKg + " kg"
            : null,
        },
      ],
    };
  }

  function findProgramById(id) {
    var list = get().programs || [];
    for (var i = 0; i < list.length; i++) {
      if (isPlainObject(list[i]) && list[i].id === id) return list[i];
    }
    return null;
  }

  function advancePullupMicro(programOrId) {
    var program =
      typeof programOrId === "string" ? findProgramById(programOrId) : programOrId;
    if (!program || program.kind !== "pullup_wave") {
      throw new Error("Not a pull-up wave program");
    }
    var step = Number(program.microStepKg);
    if (!isFinite(step) || step <= 0) step = 2.5;
    var cur = Number(program.intensiveLoadKg);
    if (!isFinite(cur)) cur = Number(program.startLoadKg) || 0;
    program.intensiveLoadKg = roundLoadKg(cur + step);
    program.nextWaveDay = "intensive";
    upsertProgram(program);
    return program;
  }

  function retreatPullupMicro(programOrId) {
    var program =
      typeof programOrId === "string" ? findProgramById(programOrId) : programOrId;
    if (!program || program.kind !== "pullup_wave") {
      throw new Error("Not a pull-up wave program");
    }
    var step = Number(program.microStepKg);
    if (!isFinite(step) || step <= 0) step = 2.5;
    var cur = Number(program.intensiveLoadKg);
    if (!isFinite(cur)) cur = Number(program.startLoadKg) || 0;
    var floor = Number(program.startLoadKg);
    if (!isFinite(floor)) floor = 0;
    var next = roundLoadKg(cur - step);
    if (next == null || next < floor) next = roundLoadKg(floor);
    if (next == null) next = 0;
    program.intensiveLoadKg = next;
    program.nextWaveDay = "intensive";
    upsertProgram(program);
    return program;
  }

  function advancePullupMacro(programOrId) {
    var program =
      typeof programOrId === "string" ? findProgramById(programOrId) : programOrId;
    if (!program || program.kind !== "pullup_wave") {
      throw new Error("Not a pull-up wave program");
    }
    var scheme = pullupWaveCache;
    var maxIdx = scheme && scheme.phases ? scheme.phases.length - 1 : 2;
    var idx = Number(program.phaseIndex) || 0;
    if (idx >= maxIdx) {
      return { program: program, advanced: false, atPeak: true };
    }
    program.phaseIndex = idx + 1;
    program.nextWaveDay = "intensive";
    upsertProgram(program);
    return { program: program, advanced: true, atPeak: program.phaseIndex >= maxIdx };
  }

  function retreatPullupMacro(programOrId) {
    var program =
      typeof programOrId === "string" ? findProgramById(programOrId) : programOrId;
    if (!program || program.kind !== "pullup_wave") {
      throw new Error("Not a pull-up wave program");
    }
    var idx = Number(program.phaseIndex) || 0;
    if (idx <= 0) {
      return { program: program, retreated: false, atStart: true };
    }
    program.phaseIndex = idx - 1;
    program.nextWaveDay = "intensive";
    upsertProgram(program);
    return { program: program, retreated: true, atStart: program.phaseIndex <= 0 };
  }

  window.SL.store = {
    load: load,
    save: save,
    get: get,
    reset: reset,
    listExercises: listExercises,
    upsertCustomExercise: upsertCustomExercise,
    deleteCustomExercise: deleteCustomExercise,
    listPrograms: listPrograms,
    getActiveProgram: getActiveProgram,
    upsertProgram: upsertProgram,
    deleteProgram: deleteProgram,
    setActiveProgram: setActiveProgram,
    listSessions: listSessions,
    upsertSession: upsertSession,
    deleteSession: deleteSession,
    exportJson: exportJson,
    importJson: importJson,
    backupCounts: backupCounts,
    e1rm: e1rm,
    bestSet: bestSet,
    historyFor: historyFor,
    roundLoadKg: roundLoadKg,
    loadSquatCycleScheme: loadSquatCycleScheme,
    expandPercentCycle: expandPercentCycle,
    nextCycleSession: nextCycleSession,
    loadPullupWaveScheme: loadPullupWaveScheme,
    currentPullupWaveSession: currentPullupWaveSession,
    setPullupNextWaveDay: setPullupNextWaveDay,
    clearPullupNextWaveDay: clearPullupNextWaveDay,
    advancePullupMicro: advancePullupMicro,
    retreatPullupMicro: retreatPullupMicro,
    advancePullupMacro: advancePullupMacro,
    retreatPullupMacro: retreatPullupMacro,
    todayISO: todayISO,
  };
})();

