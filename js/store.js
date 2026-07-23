/* Streetlifting — persistence + derived metrics. */
(function () {
  "use strict";

  window.SL = window.SL || {};

  var STORAGE_KEY = "streetlifting-v1";
  var EXERCISES_URL = "data/exercises.json";
  var SQUAT_CYCLE_URL = "data/squat-1rm-cycle.json";

  var state = null;
  var builtinsCache = null;
  var builtinsPromise = null;
  var squatSchemeCache = null;
  var squatSchemePromise = null;

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

  function validateStore(data) {
    if (!isPlainObject(data)) return false;
    if (!isPlainObject(data.settings)) return false;
    var u = data.settings.unit;
    if (u !== "kg" && u !== "lb") return false;
    if (typeof data.settings.restSeconds !== "number" || !isFinite(data.settings.restSeconds)) {
      return false;
    }
    var bw = data.settings.bodyweightKg;
    if (bw !== null && (typeof bw !== "number" || !isFinite(bw))) return false;
    if (!Array.isArray(data.customExercises)) return false;
    if (!Array.isArray(data.programs)) return false;
    if (!Array.isArray(data.sessions)) return false;
    return true;
  }

  function normalizeLoaded(raw) {
    var d = defaults();
    if (!isPlainObject(raw)) return d;

    if (isPlainObject(raw.settings)) {
      if (raw.settings.unit === "kg" || raw.settings.unit === "lb") {
        d.settings.unit = raw.settings.unit;
      }
      if (typeof raw.settings.restSeconds === "number" && isFinite(raw.settings.restSeconds)) {
        d.settings.restSeconds = raw.settings.restSeconds;
      }
      if (
        raw.settings.bodyweightKg === null ||
        (typeof raw.settings.bodyweightKg === "number" && isFinite(raw.settings.bodyweightKg))
      ) {
        d.settings.bodyweightKg = raw.settings.bodyweightKg;
      }
    }

    if (Array.isArray(raw.customExercises)) d.customExercises = raw.customExercises;
    if (Array.isArray(raw.programs)) d.programs = raw.programs;
    if (Array.isArray(raw.sessions)) d.sessions = raw.sessions;
    return d;
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
        state = normalizeLoaded(JSON.parse(raw));
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function get() {
    if (!state) load();
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
      return builtins.concat(s.customExercises || []);
    });
  }

  function upsertCustomExercise(ex) {
    if (!ex || typeof ex !== "object") throw new Error("Invalid exercise");
    ensureId(ex);
    var s = get();
    var i = s.customExercises.findIndex(function (e) {
      return e.id === ex.id;
    });
    if (i >= 0) s.customExercises[i] = ex;
    else s.customExercises.push(ex);
    save();
    return ex;
  }

  function deleteCustomExercise(id) {
    var s = get();
    s.customExercises = s.customExercises.filter(function (e) {
      return e.id !== id;
    });
    save();
  }

  function listPrograms() {
    return get().programs.slice();
  }

  function getActiveProgram() {
    var programs = get().programs;
    for (var i = 0; i < programs.length; i++) {
      if (programs[i].active) return programs[i];
    }
    return null;
  }

  function upsertProgram(p) {
    if (!p || typeof p !== "object") throw new Error("Invalid program");
    ensureId(p);
    if (!Array.isArray(p.days)) p.days = [];
    for (var d = 0; d < p.days.length; d++) {
      ensureId(p.days[d]);
    }
    var s = get();
    var i = s.programs.findIndex(function (x) {
      return x.id === p.id;
    });
    if (i >= 0) s.programs[i] = p;
    else s.programs.push(p);
    save();
    return p;
  }

  function deleteProgram(id) {
    var s = get();
    s.programs = s.programs.filter(function (p) {
      return p.id !== id;
    });
    save();
  }

  function setActiveProgram(id) {
    var s = get();
    for (var i = 0; i < s.programs.length; i++) {
      s.programs[i].active = s.programs[i].id === id;
    }
    save();
  }

  function listSessions() {
    return get()
      .sessions.slice()
      .sort(function (a, b) {
        var da = a.dateISO || "";
        var db = b.dateISO || "";
        if (da < db) return 1;
        if (da > db) return -1;
        return 0;
      });
  }

  function upsertSession(sess) {
    if (!sess || typeof sess !== "object") throw new Error("Invalid session");
    ensureId(sess);
    if (!Array.isArray(sess.sets)) sess.sets = [];
    var s = get();
    var i = s.sessions.findIndex(function (x) {
      return x.id === sess.id;
    });
    if (i >= 0) s.sessions[i] = sess;
    else s.sessions.push(sess);
    save();
    return sess;
  }

  function deleteSession(id) {
    var s = get();
    s.sessions = s.sessions.filter(function (x) {
      return x.id !== id;
    });
    save();
  }

  function exportJson() {
    return JSON.stringify(get(), null, 2);
  }

  function importJson(str) {
    var parsed;
    try {
      parsed = JSON.parse(str);
    } catch (e) {
      throw new Error("Invalid JSON");
    }
    if (!validateStore(parsed)) {
      throw new Error("Invalid store shape");
    }
    state = normalizeLoaded(parsed);
    save();
    return state;
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
    var sessions = get().sessions.slice().sort(function (a, b) {
      var da = a.dateISO || "";
      var db = b.dateISO || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return 0;
    });
    var out = [];
    for (var i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      var sets = sess.sets || [];
      var bw = sess.bodyweightKg;
      for (var j = 0; j < sets.length; j++) {
        var set = sets[j];
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
    e1rm: e1rm,
    bestSet: bestSet,
    historyFor: historyFor,
    roundLoadKg: roundLoadKg,
    loadSquatCycleScheme: loadSquatCycleScheme,
    expandPercentCycle: expandPercentCycle,
    nextCycleSession: nextCycleSession,
    todayISO: todayISO,
  };
})();

