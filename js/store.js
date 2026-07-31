/* Streetlifting — persistence + derived metrics. */
(function () {
  "use strict";

  window.SL = window.SL || {};

  var STORAGE_KEY = "streetlifting-v1";
  var BACKUP_KEY = "streetlifting-v1-backup";
  var SCHEMA_VERSION = 2;
  var EXERCISES_URL = "data/exercises.json";
  var SQUAT_CYCLE_URL = "data/squat-1rm-cycle.json";
  var PULLUP_WAVE_URL = "data/pullup-wave-cycle.json";
  var DIP_WAVE_URL = "data/dip-wave-cycle.json";

  var state = null;
  var revisionCounter = 0;
  var builtinsCache = null;
  var builtinsPromise = null;
  var squatSchemeCache = null;
  var squatSchemePromise = null;
  var pullupWaveCache = null;
  var pullupWavePromise = null;
  var dipWaveCache = null;
  var dipWavePromise = null;

  function isRepWave(program) {
    return !!(
      program &&
      (program.kind === "pullup_wave" || program.kind === "dip_wave")
    );
  }

  function waveLiftLabel(program) {
    if (!program) return "Pull-up";
    if (program.kind === "dip_wave" || program.exerciseId === "dip") return "Dip";
    return "Pull-up";
  }

  function waveSchemeCache(program) {
    if (program && program.kind === "dip_wave") return dipWaveCache;
    return pullupWaveCache;
  }

  function defaults() {
    return {
      version: SCHEMA_VERSION,
      settings: {
        unit: "kg",
        restSeconds: 180,
        bodyweightKg: null,
        autoStartRest: true,
        vibrate: true,
        plateStack: null,
      },
      exerciseSettings: {},
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

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  /** Top-level shape check: salvageable exports pass; junk types fail. */
  function validateStore(data) {
    if (!isPlainObject(data)) return false;
    if (data.settings != null && !isPlainObject(data.settings)) return false;
    if (data.exerciseSettings != null && !isPlainObject(data.exerciseSettings)) return false;
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

  function normalizePlateStack(raw) {
    if (raw === null) return null;
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var n = coerceFiniteNumber(raw[i]);
      if (n != null) out.push(n);
    }
    return out;
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
    if (typeof rawSettings.autoStartRest === "boolean") {
      s.autoStartRest = rawSettings.autoStartRest;
    }
    if (typeof rawSettings.vibrate === "boolean") {
      s.vibrate = rawSettings.vibrate;
    }
    if (hasOwn(rawSettings, "plateStack")) {
      s.plateStack = normalizePlateStack(rawSettings.plateStack);
    }
    return s;
  }

  function normalizeSet(set) {
    if (!isPlainObject(set)) return null;
    ensureId(set);
    if (
      set.type !== "normal" &&
      set.type !== "warmup" &&
      set.type !== "drop" &&
      set.type !== "failure"
    ) {
      set.type = "normal";
    }
    if (!hasOwn(set, "supersetId")) set.supersetId = null;
    return set;
  }

  function normalizeSession(sess) {
    if (!isPlainObject(sess)) return null;
    if (typeof sess.note !== "string") sess.note = sess.note != null ? String(sess.note) : "";
    if (!isPlainObject(sess.sectionNotes)) sess.sectionNotes = {};
    if (!Array.isArray(sess.sets)) sess.sets = [];
    if (!hasOwn(sess, "startedAt")) sess.startedAt = null;
    if (!hasOwn(sess, "endedAt")) sess.endedAt = null;
    if (!hasOwn(sess, "durationSec")) sess.durationSec = null;
    var kept = [];
    for (var i = 0; i < sess.sets.length; i++) {
      var set = normalizeSet(sess.sets[i]);
      if (set) kept.push(set);
    }
    sess.sets = kept;
    return sess;
  }

  function normalizeProgram(p) {
    if (!isPlainObject(p)) return null;
    if (!Array.isArray(p.days)) p.days = [];
    else p.days = filterPlainObjects(p.days);
    return p;
  }

  function normalizeExerciseSettings(raw) {
    if (!isPlainObject(raw)) return {};
    var out = {};
    for (var id in raw) {
      if (!hasOwn(raw, id)) continue;
      var entry = raw[id];
      if (!isPlainObject(entry)) continue;
      var rest = null;
      if (entry.restSeconds != null) {
        var n = coerceFiniteNumber(entry.restSeconds);
        if (n != null) {
          if (n < 0) n = 0;
          rest = Math.round(n);
        }
      }
      out[id] = {
        restSeconds: rest,
        favorite: !!entry.favorite,
      };
    }
    return out;
  }

  function needsMigration(data) {
    if (!isPlainObject(data)) return true;
    var v = coerceFiniteNumber(data.version);
    return v == null || v < SCHEMA_VERSION;
  }

  function backupV1Once(rawString) {
    try {
      if (localStorage.getItem(BACKUP_KEY) != null) return;
      localStorage.setItem(BACKUP_KEY, rawString);
    } catch (e) {
      /* ignore backup failures */
    }
  }

  /**
   * Migrate a parsed store blob to v2 in place.
   * Preserves unknown fields on programs/sessions/sets.
   */
  function migrateToV2(data) {
    if (!isPlainObject(data)) return defaults();
    if (!needsMigration(data)) return data;

    if (!isPlainObject(data.settings)) data.settings = {};
    if (!hasOwn(data.settings, "autoStartRest")) data.settings.autoStartRest = true;
    if (!hasOwn(data.settings, "vibrate")) data.settings.vibrate = true;
    if (!hasOwn(data.settings, "plateStack")) data.settings.plateStack = null;

    if (!isPlainObject(data.exerciseSettings)) data.exerciseSettings = {};

    var sessions = Array.isArray(data.sessions) ? data.sessions : [];
    for (var i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      if (!isPlainObject(sess)) continue;
      if (!hasOwn(sess, "startedAt")) sess.startedAt = null;
      if (!hasOwn(sess, "endedAt")) sess.endedAt = null;
      if (!hasOwn(sess, "durationSec")) sess.durationSec = null;
      var sets = Array.isArray(sess.sets) ? sess.sets : [];
      for (var j = 0; j < sets.length; j++) {
        var set = sets[j];
        if (!isPlainObject(set)) continue;
        ensureId(set);
        if (!hasOwn(set, "type")) set.type = "normal";
        if (!hasOwn(set, "supersetId")) set.supersetId = null;
      }
    }

    data.version = SCHEMA_VERSION;
    return data;
  }

  function normalizeLoaded(raw) {
    var d = defaults();
    if (!isPlainObject(raw)) return d;

    d.version = SCHEMA_VERSION;
    d.settings = normalizeSettings(raw.settings);
    d.exerciseSettings = normalizeExerciseSettings(raw.exerciseSettings);
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
    s.version = SCHEMA_VERSION;
    if (!isPlainObject(s.settings)) {
      s.settings = defaults().settings;
    } else {
      var fixed = normalizeSettings(s.settings);
      s.settings.unit = fixed.unit;
      s.settings.restSeconds = fixed.restSeconds;
      s.settings.bodyweightKg = fixed.bodyweightKg;
      s.settings.autoStartRest = fixed.autoStartRest;
      s.settings.vibrate = fixed.vibrate;
      if (!hasOwn(s.settings, "plateStack")) s.settings.plateStack = fixed.plateStack;
      else if (s.settings.plateStack !== null && !Array.isArray(s.settings.plateStack)) {
        s.settings.plateStack = fixed.plateStack;
      }
    }
    if (!isPlainObject(s.exerciseSettings)) s.exerciseSettings = {};
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

  function getBuiltins() {
    return Array.isArray(builtinsCache) ? builtinsCache : [];
  }

  function exerciseById(id) {
    if (id == null || id === "") return null;
    var builtins = getBuiltins();
    var i;
    for (i = 0; i < builtins.length; i++) {
      if (builtins[i] && builtins[i].id === id) return builtins[i];
    }
    var custom = [];
    try {
      custom = filterPlainObjects((state || load()).customExercises);
    } catch (e) {
      custom = [];
    }
    for (i = 0; i < custom.length; i++) {
      if (custom[i] && custom[i].id === id) return custom[i];
    }
    return null;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) {
          state = defaults();
        } else {
          if (needsMigration(parsed)) {
            backupV1Once(raw);
            migrateToV2(parsed);
          }
          state = normalizeLoaded(parsed);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          } catch (saveErr) {
            /* never throw during load */
          }
        }
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
    state.version = SCHEMA_VERSION;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      throw new Error("Failed to save (storage full or unavailable)");
    }
    revisionCounter++;
  }

  /** Bumped on every write so derived caches (SL.prs) know when to recompute. */
  function revision() {
    return revisionCounter;
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
    if (!hasOwn(sess, "startedAt")) sess.startedAt = null;
    if (!hasOwn(sess, "endedAt")) sess.endedAt = null;
    if (!hasOwn(sess, "durationSec")) sess.durationSec = null;
    var kept = [];
    for (var si = 0; si < sess.sets.length; si++) {
      var set = normalizeSet(sess.sets[si]);
      if (set) kept.push(set);
    }
    sess.sets = kept;
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
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: cloneJson(s.settings),
      exerciseSettings: cloneJson(s.exerciseSettings || {}),
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
    // Accept v1 backups, v2 backups, and legacy flat store blobs.
    if (needsMigration(parsed)) {
      migrateToV2(parsed);
    }
    state = normalizeLoaded(parsed);
    save();
    return {
      state: state,
      counts: backupCounts(state),
    };
  }

  function getExerciseSettings(exerciseId) {
    var fallback = { restSeconds: null, favorite: false };
    if (exerciseId == null || exerciseId === "") return fallback;
    var s = get();
    var es = s.exerciseSettings && s.exerciseSettings[exerciseId];
    if (!isPlainObject(es)) return fallback;
    var rest = null;
    if (es.restSeconds != null) {
      var n = coerceFiniteNumber(es.restSeconds);
      if (n != null) {
        if (n < 0) n = 0;
        rest = Math.round(n);
      }
    }
    return { restSeconds: rest, favorite: !!es.favorite };
  }

  function setExerciseSettings(exerciseId, patch) {
    var fallback = { restSeconds: null, favorite: false };
    if (exerciseId == null || exerciseId === "") return fallback;
    var s = get();
    if (!isPlainObject(s.exerciseSettings)) s.exerciseSettings = {};
    var cur = getExerciseSettings(exerciseId);
    if (isPlainObject(patch)) {
      if (hasOwn(patch, "restSeconds")) {
        if (patch.restSeconds == null) {
          cur.restSeconds = null;
        } else {
          var n = coerceFiniteNumber(patch.restSeconds);
          if (n != null) {
            if (n < 0) n = 0;
            cur.restSeconds = Math.round(n);
          }
        }
      }
      if (hasOwn(patch, "favorite")) {
        cur.favorite = !!patch.favorite;
      }
    }
    s.exerciseSettings[exerciseId] = {
      restSeconds: cur.restSeconds,
      favorite: cur.favorite,
    };
    save();
    return s.exerciseSettings[exerciseId];
  }

  function restSecondsFor(exerciseId) {
    var es = getExerciseSettings(exerciseId);
    if (es.restSeconds != null && isFinite(es.restSeconds)) {
      return Math.round(es.restSeconds);
    }
    var ex = exerciseById(exerciseId);
    if (ex) {
      var d = coerceFiniteNumber(ex.defaultRestSeconds);
      if (d != null) {
        if (d < 0) d = 0;
        return Math.round(d);
      }
    }
    var s = get().settings;
    var g = coerceFiniteNumber(s && s.restSeconds);
    if (g != null) {
      if (g < 0) g = 0;
      return Math.round(g);
    }
    return 180;
  }

  function toggleFavorite(exerciseId) {
    var es = getExerciseSettings(exerciseId);
    var next = !es.favorite;
    setExerciseSettings(exerciseId, { favorite: next });
    return next;
  }

  function listFavorites() {
    var s = get();
    var es = s.exerciseSettings;
    if (!isPlainObject(es)) return [];
    var out = [];
    for (var id in es) {
      if (!hasOwn(es, id)) continue;
      if (es[id] && es[id].favorite) out.push(id);
    }
    return out;
  }

  function newSet(exerciseId, patch) {
    var set = {
      exerciseId: exerciseId == null ? null : exerciseId,
      loadKg: 0,
      reps: 0,
      completed: false,
      type: "normal",
      supersetId: null,
    };
    ensureId(set);
    if (isPlainObject(patch)) {
      for (var k in patch) {
        if (hasOwn(patch, k)) set[k] = patch[k];
      }
    }
    if (!set.id) ensureId(set);
    if (
      set.type !== "normal" &&
      set.type !== "warmup" &&
      set.type !== "drop" &&
      set.type !== "failure"
    ) {
      set.type = "normal";
    }
    if (!hasOwn(set, "supersetId")) set.supersetId = null;
    return set;
  }

  function countsForVolume(set) {
    if (!set || typeof set !== "object") return false;
    if (set.completed === false) return false;
    if (set.type === "warmup") return false;
    return true;
  }

  /**
   * Volume is always added load × reps. Bodyweight is never folded in —
   * stats, PRs, and summaries all use belt/external load only.
   * `bodyweightKg` is kept for call-site compatibility and ignored.
   */
  function setVolumeKg(set, bodyweightKg) {
    if (!countsForVolume(set)) return 0;
    var load = Number(set.loadKg) || 0;
    var reps = Number(set.reps) || 0;
    return load * reps;
  }

  function previousSetsFor(exerciseId, excludeSessionId) {
    if (exerciseId == null || exerciseId === "") return [];
    var sessions;
    try {
      sessions = listSessions();
    } catch (e) {
      return [];
    }
    for (var i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      if (!sess) continue;
      if (excludeSessionId != null && sess.id === excludeSessionId) continue;
      var sets = Array.isArray(sess.sets) ? sess.sets : [];
      var matched = [];
      for (var j = 0; j < sets.length; j++) {
        var set = sets[j];
        if (!set || typeof set !== "object") continue;
        if (set.exerciseId !== exerciseId) continue;
        var annotated = cloneJson(set);
        annotated.dateISO = sess.dateISO;
        annotated.bodyweightKg = sess.bodyweightKg;
        matched.push(annotated);
      }
      if (matched.length) return matched;
    }
    return [];
  }

  function emptySessionSummary() {
    return {
      durationSec: null,
      totalVolumeKg: 0,
      setCount: 0,
      workingSetCount: 0,
      exerciseCount: 0,
      perExercise: [],
      muscleSplit: [],
    };
  }

  function findSession(sessionOrId) {
    if (isPlainObject(sessionOrId)) return sessionOrId;
    if (sessionOrId == null || sessionOrId === "") return null;
    var list = filterPlainObjects(get().sessions);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === sessionOrId) return list[i];
    }
    return null;
  }

  function sessionSummary(sessionOrId) {
    var sess;
    try {
      sess = findSession(sessionOrId);
    } catch (e) {
      return emptySessionSummary();
    }
    if (!sess) return emptySessionSummary();

    var sets = Array.isArray(sess.sets) ? sess.sets : [];
    var setCount = 0;
    var workingSetCount = 0;
    var totalVolumeKg = 0;
    var byEx = {};
    var exOrder = [];

    for (var i = 0; i < sets.length; i++) {
      var set = sets[i];
      if (!set || typeof set !== "object") continue;
      if (set.completed === false) continue;
      setCount += 1;
      if (!countsForVolume(set)) continue;
      workingSetCount += 1;
      var vol = setVolumeKg(set);
      totalVolumeKg += vol;
      var exId = set.exerciseId;
      if (exId == null) continue;
      if (!byEx[exId]) {
        byEx[exId] = {
          exerciseId: exId,
          sets: 0,
          volumeKg: 0,
          topSet: null,
          topE1rm: -Infinity,
        };
        exOrder.push(exId);
      }
      var bucket = byEx[exId];
      bucket.sets += 1;
      bucket.volumeKg += vol;
      var e = e1rm(0, set.loadKg, set.reps);
      if (e > bucket.topE1rm) {
        bucket.topE1rm = e;
        bucket.topSet = set;
      }
    }

    var perExercise = [];
    var muscleMap = {};
    for (var oi = 0; oi < exOrder.length; oi++) {
      var b = byEx[exOrder[oi]];
      perExercise.push({
        exerciseId: b.exerciseId,
        sets: b.sets,
        volumeKg: b.volumeKg,
        topSet: b.topSet,
      });
      var ex = exerciseById(b.exerciseId);
      var muscles = ex && Array.isArray(ex.muscles) ? ex.muscles : [];
      if (muscles.length && b.volumeKg) {
        var share = b.volumeKg / muscles.length;
        for (var mi = 0; mi < muscles.length; mi++) {
          var m = muscles[mi];
          if (m == null || m === "") continue;
          muscleMap[m] = (muscleMap[m] || 0) + share;
        }
      }
    }

    var muscleSplit = [];
    for (var muscle in muscleMap) {
      if (!hasOwn(muscleMap, muscle)) continue;
      var mv = muscleMap[muscle];
      muscleSplit.push({
        muscle: muscle,
        volumeKg: mv,
        pct: totalVolumeKg > 0 ? (mv / totalVolumeKg) * 100 : 0,
      });
    }
    muscleSplit.sort(function (a, b) {
      return b.volumeKg - a.volumeKg;
    });

    var durationSec = sess.durationSec;
    if (durationSec != null) {
      var d = coerceFiniteNumber(durationSec);
      durationSec = d != null ? Math.round(d) : null;
    } else {
      durationSec = null;
    }

    return {
      durationSec: durationSec,
      totalVolumeKg: totalVolumeKg,
      setCount: setCount,
      workingSetCount: workingSetCount,
      exerciseCount: perExercise.length,
      perExercise: perExercise,
      muscleSplit: muscleSplit,
    };
  }

  /**
   * Epley e1RM on added load only. `bwKg` is ignored (kept for API compatibility).
   */
  function e1rm(bwKg, loadKg, reps) {
    var load = Number(loadKg) || 0;
    var r = Number(reps) || 0;
    if (r <= 1) return load;
    return load * (1 + r / 30);
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
      for (var j = 0; j < sets.length; j++) {
        var set = sets[j];
        if (!set || typeof set !== "object") continue;
        if (set.exerciseId !== exerciseId) continue;
        if (set.completed === false) continue;
        if (set.type === "warmup") continue;
        out.push({
          dateISO: sess.dateISO,
          bodyweightKg: sess.bodyweightKg,
          loadKg: set.loadKg,
          reps: set.reps,
          e1rm: e1rm(0, set.loadKg, set.reps),
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

  function loadDipWaveScheme() {
    if (dipWaveCache) return Promise.resolve(dipWaveCache);
    if (dipWavePromise) return dipWavePromise;
    dipWavePromise = fetch(DIP_WAVE_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load dip wave: " + res.status);
        return res.json();
      })
      .then(function (scheme) {
        dipWaveCache = scheme;
        return scheme;
      })
      .catch(function (err) {
        dipWavePromise = null;
        throw err;
      });
    return dipWavePromise;
  }

  function loadWaveScheme(programOrKind) {
    var kind =
      typeof programOrKind === "string"
        ? programOrKind
        : programOrKind && programOrKind.kind;
    if (kind === "dip_wave") return loadDipWaveScheme();
    return loadPullupWaveScheme();
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
    if (!isRepWave(program)) {
      throw new Error("Not a wave program");
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
    if (!isRepWave(program)) return program;
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
    var exId =
      program.exerciseId ||
      scheme.exerciseId ||
      (program.kind === "dip_wave" ? "dip" : "pullup");
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
    if (!isRepWave(program)) {
      throw new Error("Not a wave program");
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
    if (!isRepWave(program)) {
      throw new Error("Not a wave program");
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
    if (!isRepWave(program)) {
      throw new Error("Not a wave program");
    }
    var scheme = waveSchemeCache(program);
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
    if (!isRepWave(program)) {
      throw new Error("Not a wave program");
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

  /** End full cycle: back to first phase (3x10) and +microStepKg on intensive load. */
  function finishPullupCycle(programOrId) {
    var program =
      typeof programOrId === "string" ? findProgramById(programOrId) : programOrId;
    if (!isRepWave(program)) {
      throw new Error("Not a wave program");
    }
    var step = Number(program.microStepKg);
    if (!isFinite(step) || step <= 0) step = 2.5;
    var cur = Number(program.intensiveLoadKg);
    if (!isFinite(cur)) cur = Number(program.startLoadKg) || 0;
    program.phaseIndex = 0;
    program.intensiveLoadKg = roundLoadKg(cur + step);
    program.nextWaveDay = "intensive";
    upsertProgram(program);
    return program;
  }

  function pullupWaveAtPeak(program, scheme) {
    var cached = waveSchemeCache(program);
    var phases =
      (scheme && scheme.phases) || (cached && cached.phases) || [];
    if (!phases.length) return false;
    var idx = Number(program && program.phaseIndex) || 0;
    return idx >= phases.length - 1;
  }

  window.SL.store = {
    load: load,
    save: save,
    get: get,
    reset: reset,
    revision: revision,
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
    isRepWave: isRepWave,
    waveLiftLabel: waveLiftLabel,
    loadPullupWaveScheme: loadPullupWaveScheme,
    loadDipWaveScheme: loadDipWaveScheme,
    loadWaveScheme: loadWaveScheme,
    currentPullupWaveSession: currentPullupWaveSession,
    setPullupNextWaveDay: setPullupNextWaveDay,
    clearPullupNextWaveDay: clearPullupNextWaveDay,
    advancePullupMicro: advancePullupMicro,
    retreatPullupMicro: retreatPullupMicro,
    advancePullupMacro: advancePullupMacro,
    retreatPullupMacro: retreatPullupMacro,
    finishPullupCycle: finishPullupCycle,
    pullupWaveAtPeak: pullupWaveAtPeak,
    todayISO: todayISO,
    getExerciseSettings: getExerciseSettings,
    setExerciseSettings: setExerciseSettings,
    restSecondsFor: restSecondsFor,
    toggleFavorite: toggleFavorite,
    listFavorites: listFavorites,
    newSet: newSet,
    countsForVolume: countsForVolume,
    setVolumeKg: setVolumeKg,
    previousSetsFor: previousSetsFor,
    sessionSummary: sessionSummary,
    getBuiltins: getBuiltins,
    exerciseById: exerciseById,
  };
})();
