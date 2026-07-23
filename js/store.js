/* Streetlifting — persistence + derived metrics. */
(function () {
  "use strict";

  window.SL = window.SL || {};

  var STORAGE_KEY = "streetlifting-v1";
  var EXERCISES_URL = "data/exercises.json";

  var state = null;
  var builtinsCache = null;
  var builtinsPromise = null;

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
  };
})();
