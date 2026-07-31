/* Streetlifting — personal-record engine (read-only). */
(function () {
  "use strict";

  window.SL = window.SL || {};

  var KINDS = ["weight", "e1rm", "volume"];
  var KIND_LABEL = {
    weight: "weight",
    e1rm: "e1rm",
    volume: "volume",
  };

  /** Cache of all-time bests + per-session prior snapshots. */
  var cache = null;

  function storeApi() {
    try {
      return window.SL && window.SL.store ? window.SL.store : null;
    } catch (e) {
      return null;
    }
  }

  function safeCall(fnName, args, fallback) {
    try {
      var s = storeApi();
      if (!s || typeof s[fnName] !== "function") return fallback;
      return s[fnName].apply(s, args || []);
    } catch (e) {
      return fallback;
    }
  }

  function safeListSessions() {
    var list = safeCall("listSessions", [], []);
    return Array.isArray(list) ? list : [];
  }

  function safeCountsForVolume(set) {
    var v = safeCall("countsForVolume", [set], false);
    return !!v;
  }

  function safeE1rm(bwKg, loadKg, reps) {
    var v = safeCall("e1rm", [bwKg, loadKg, reps], 0);
    v = Number(v);
    return isFinite(v) ? v : 0;
  }

  function safeSetVolumeKg(set, bodyweightKg) {
    var v = safeCall("setVolumeKg", [set, bodyweightKg], 0);
    v = Number(v);
    return isFinite(v) ? v : 0;
  }

  function safeExerciseById(id) {
    return safeCall("exerciseById", [id], null);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Warm-ups, incomplete sets, and zero-rep sets never establish records. */
  function isEligible(set) {
    if (!set || typeof set !== "object") return false;
    if (!safeCountsForVolume(set)) return false;
    var reps = Number(set.reps) || 0;
    if (reps < 1) return false;
    return true;
  }

  /** Metrics use added load only — bodyweight is never included. */
  function metricsFor(set) {
    var load = Number(set.loadKg) || 0;
    var reps = Number(set.reps) || 0;
    return {
      weight: load,
      e1rm: safeE1rm(0, load, reps),
      volume: safeSetVolumeKg(set, 0),
    };
  }

  function emptyRecordBundle() {
    return { weight: null, e1rm: null, volume: null };
  }

  function emptyValueBundle() {
    return { weight: null, e1rm: null, volume: null };
  }

  function valuesFromRecords(recs) {
    var out = emptyValueBundle();
    if (!recs) return out;
    var k;
    for (k = 0; k < KINDS.length; k++) {
      var kind = KINDS[k];
      if (recs[kind] && typeof recs[kind].value === "number" && isFinite(recs[kind].value)) {
        out[kind] = recs[kind].value;
      }
    }
    return out;
  }

  function cloneValueBundle(src) {
    var out = emptyValueBundle();
    if (!src) return out;
    out.weight = src.weight;
    out.e1rm = src.e1rm;
    out.volume = src.volume;
    return out;
  }

  function clonePriorMap(map) {
    var out = {};
    if (!map) return out;
    for (var exId in map) {
      if (!Object.prototype.hasOwnProperty.call(map, exId)) continue;
      out[exId] = cloneValueBundle(map[exId]);
    }
    return out;
  }

  function exerciseName(exerciseId) {
    var ex = safeExerciseById(exerciseId);
    if (ex && ex.name) return String(ex.name);
    return exerciseId == null ? "" : String(exerciseId);
  }

  function sessionsOldestFirst(sessionsNewestFirst) {
    var list = sessionsNewestFirst.slice();
    list.reverse();
    return list;
  }

  /**
   * Apply one eligible set to running bests.
   * Returns list of kind strings that are new strict records.
   */
  function applySetToBests(bests, set, dateISO) {
    var broken = [];
    var m = metricsFor(set);
    var k;
    for (k = 0; k < KINDS.length; k++) {
      var kind = KINDS[k];
      var value = m[kind];
      if (typeof value !== "number" || !isFinite(value)) continue;
      var cur = bests[kind];
      if (!cur) {
        if (value > 0) {
          bests[kind] = { set: set, dateISO: dateISO, value: value };
          broken.push(kind);
        } else {
          /* Track zero as best-ever for computeAll, but it is not a PR event. */
          bests[kind] = { set: set, dateISO: dateISO, value: value };
        }
      } else if (value > cur.value) {
        bests[kind] = { set: set, dateISO: dateISO, value: value };
        broken.push(kind);
      }
    }
    return broken;
  }

  function applySetToValues(values, set) {
    var m = metricsFor(set);
    var k;
    for (k = 0; k < KINDS.length; k++) {
      var kind = KINDS[k];
      var value = m[kind];
      if (typeof value !== "number" || !isFinite(value)) continue;
      if (values[kind] == null || value > values[kind]) {
        values[kind] = value;
      }
    }
  }

  function buildCache(sessionsNewestFirst) {
    var sessions = sessionsOldestFirst(sessionsNewestFirst);
    var allBests = {};
    var priorValuesBySession = {};
    var runningValues = {};
    var events = [];
    var i;
    var j;

    for (i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      if (!sess || typeof sess !== "object") continue;
      var sid = sess.id;
      if (sid != null) {
        priorValuesBySession[sid] = clonePriorMap(runningValues);
      }

      var dateISO = sess.dateISO || "";
      var sets = Array.isArray(sess.sets) ? sess.sets : [];

      for (j = 0; j < sets.length; j++) {
        var set = sets[j];
        if (!isEligible(set)) continue;
        var exId = set.exerciseId;
        if (exId == null || exId === "") continue;

        if (!allBests[exId]) allBests[exId] = emptyRecordBundle();
        if (!runningValues[exId]) runningValues[exId] = emptyValueBundle();

        var broken = applySetToBests(allBests[exId], set, dateISO);
        applySetToValues(runningValues[exId], set);

        var bi;
        for (bi = 0; bi < broken.length; bi++) {
          var kind = broken[bi];
          var rec = allBests[exId][kind];
          events.push({
            exerciseId: exId,
            exerciseName: exerciseName(exId),
            kind: kind,
            value: rec.value,
            dateISO: dateISO,
            sessionId: sid == null ? null : sid,
          });
        }
      }
    }

    var newestId = null;
    if (sessionsNewestFirst.length && sessionsNewestFirst[0]) {
      newestId = sessionsNewestFirst[0].id || null;
    }

    return {
      sessionCount: sessionsNewestFirst.length,
      newestSessionId: newestId,
      allBests: allBests,
      priorValuesBySession: priorValuesBySession,
      feedChronological: events,
    };
  }

  /** Store write counter; catches edits that leave session count and ids unchanged. */
  function storeRevision() {
    try {
      if (SL.store && typeof SL.store.revision === "function") {
        return SL.store.revision();
      }
    } catch (e) {}
    return -1;
  }

  function fingerprint() {
    var sessions = safeListSessions();
    var newestId = null;
    if (sessions.length && sessions[0]) newestId = sessions[0].id || null;
    return {
      count: sessions.length,
      newestId: newestId,
      revision: storeRevision(),
      sessions: sessions,
    };
  }

  function ensureCache() {
    var fp = fingerprint();
    if (
      cache &&
      cache.sessionCount === fp.count &&
      cache.newestSessionId === fp.newestId &&
      cache.revision === fp.revision
    ) {
      return cache;
    }
    cache = buildCache(fp.sessions);
    cache.revision = fp.revision;
    return cache;
  }

  function invalidate() {
    cache = null;
  }

  function computeAll() {
    var c = ensureCache();
    var out = {};
    for (var exId in c.allBests) {
      if (!Object.prototype.hasOwnProperty.call(c.allBests, exId)) continue;
      var src = c.allBests[exId];
      out[exId] = {
        weight: src.weight || null,
        e1rm: src.e1rm || null,
        volume: src.volume || null,
      };
    }
    return out;
  }

  function bestFor(exerciseId) {
    if (exerciseId == null || exerciseId === "") return null;
    var c = ensureCache();
    var rec = c.allBests[exerciseId];
    if (!rec) return null;
    return {
      weight: rec.weight || null,
      e1rm: rec.e1rm || null,
      volume: rec.volume || null,
    };
  }

  function indexOfSet(session, set) {
    if (!session || !set || !Array.isArray(session.sets)) return -1;
    var sets = session.sets;
    var i;
    for (i = 0; i < sets.length; i++) {
      if (sets[i] === set) return i;
    }
    if (set.id != null && set.id !== "") {
      for (i = 0; i < sets.length; i++) {
        if (sets[i] && sets[i].id === set.id) return i;
      }
    }
    return -1;
  }

  function sessionIsStored(session) {
    if (!session) return false;
    var list = safeListSessions();
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] === session) return true;
      if (session.id != null && list[i] && list[i].id === session.id) return true;
    }
    return false;
  }

  /** Walk stored history strictly before `session` (oldest first). */
  function valuesBeforeStoredSession(session, exId) {
    var sessions = sessionsOldestFirst(safeListSessions());
    var values = emptyValueBundle();
    var i;
    var j;
    for (i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      if (!sess) continue;
      if (sess === session) break;
      if (session.id != null && sess.id === session.id) break;
      var sets = Array.isArray(sess.sets) ? sess.sets : [];
      for (j = 0; j < sets.length; j++) {
        var s = sets[j];
        if (!s || s.exerciseId !== exId) continue;
        if (!isEligible(s)) continue;
        applySetToValues(values, s);
      }
    }
    return values;
  }

  /**
   * Prior category values strictly before `set` in `session`.
   * Uses cached bests-before-session, then folds in earlier sets in this session.
   * Never includes the set itself or later sets in the same session.
   */
  function priorValuesBeforeSet(set, session) {
    var c = ensureCache();
    var exId = set && set.exerciseId;
    var values = emptyValueBundle();

    if (exId == null || exId === "") return values;

    var sid = session && session.id;
    if (sid != null && Object.prototype.hasOwnProperty.call(c.priorValuesBySession, sid)) {
      values = cloneValueBundle(c.priorValuesBySession[sid][exId]);
    } else if (sessionIsStored(session)) {
      /* Stored but missing from snapshot (e.g. null id): exclude this session. */
      values = valuesBeforeStoredSession(session, exId);
    } else {
      /* Brand-new session: every stored session is prior. */
      values = valuesFromRecords(c.allBests[exId]);
    }

    var sets = session && Array.isArray(session.sets) ? session.sets : [];
    var idx = indexOfSet(session, set);
    /* Not yet in the array: treat all current rows as prior. */
    var end = idx < 0 ? sets.length : idx;
    var i;

    for (i = 0; i < end; i++) {
      var other = sets[i];
      if (!other || other.exerciseId !== exId) continue;
      if (!isEligible(other)) continue;
      if (set.id != null && other.id === set.id) continue;
      applySetToValues(values, other);
    }

    return values;
  }

  function checkSet(set, session) {
    var out = [];
    if (!set || typeof set !== "object") return out;
    if (!isEligible(set)) return out;

    var m = metricsFor(set);
    var prior = priorValuesBeforeSet(set, session);
    var k;

    for (k = 0; k < KINDS.length; k++) {
      var kind = KINDS[k];
      var value = m[kind];
      if (typeof value !== "number" || !isFinite(value)) continue;
      var prev = prior[kind];
      if (prev == null) {
        if (value > 0) {
          out.push({ kind: kind, value: value, prevValue: null });
        }
      } else if (value > prev) {
        out.push({ kind: kind, value: value, prevValue: prev });
      }
    }
    return out;
  }

  function badgeHtml(records) {
    if (!records || !records.length) return "";
    var html = "";
    var i;
    for (i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r || !r.kind) continue;
      var kind = String(r.kind);
      var label = "PR " + (KIND_LABEL[kind] || kind);
      html +=
        '<span class="pr-badge pr-badge--' +
        esc(kind) +
        '">' +
        esc(label) +
        "</span>";
    }
    return html;
  }

  function feed(limit) {
    var lim = limit == null ? 50 : Number(limit);
    if (!isFinite(lim) || lim < 0) lim = 50;
    lim = Math.floor(lim);

    var c = ensureCache();
    var chrono = c.feedChronological || [];
    var out = [];
    var i;
    for (i = chrono.length - 1; i >= 0 && out.length < lim; i--) {
      var ev = chrono[i];
      out.push({
        exerciseId: ev.exerciseId,
        exerciseName: ev.exerciseName,
        kind: ev.kind,
        value: ev.value,
        dateISO: ev.dateISO,
        sessionId: ev.sessionId,
      });
    }
    return out;
  }

  window.SL.prs = {
    computeAll: computeAll,
    bestFor: bestFor,
    checkSet: checkSet,
    badgeHtml: badgeHtml,
    feed: feed,
    invalidate: invalidate,
  };
})();
