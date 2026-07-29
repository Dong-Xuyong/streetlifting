/* Streetlifting — Strong-compatible CSV import/export. */
(function () {
  "use strict";

  window.SL = window.SL || {};

  var HEADER =
    "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,RPE,Notes,Workout Notes";
  var COLS = [
    "Date",
    "Workout Name",
    "Duration",
    "Exercise Name",
    "Set Order",
    "Weight",
    "Reps",
    "RPE",
    "Notes",
    "Workout Notes",
  ];
  var KG_TO_LB = 2.2046226218;
  var TYPE_TAGS = {
    warmup: "[warmup]",
    drop: "[drop]",
    failure: "[failure]",
  };

  function storeApi() {
    return window.SL && window.SL.store ? window.SL.store : null;
  }

  function safeGet() {
    var store = storeApi();
    if (!store || typeof store.get !== "function") return null;
    try {
      return store.get();
    } catch (e) {
      return null;
    }
  }

  function displayUnit() {
    var data = safeGet();
    var u = data && data.settings && data.settings.unit;
    return u === "lb" ? "lb" : "kg";
  }

  function kgToDisplay(kg, unit) {
    var n = Number(kg);
    if (!isFinite(n)) return "";
    if (unit === "lb") return String(+(n * KG_TO_LB).toFixed(2));
    var rounded = Math.round(n * 1000) / 1000;
    return String(rounded);
  }

  function displayToKg(val, unit) {
    var n = Number(val);
    if (!isFinite(n)) return 0;
    var kg = unit === "lb" ? n / KG_TO_LB : n;
    var store = storeApi();
    if (store && typeof store.roundLoadKg === "function") {
      try {
        var rounded = store.roundLoadKg(kg);
        if (rounded != null && isFinite(rounded)) return rounded;
      } catch (e) {
        /* fall through */
      }
    }
    return Math.round(kg * 1000) / 1000;
  }

  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? "0" + s : s;
  }

  function formatDuration(sec) {
    var n = Number(sec);
    if (!isFinite(n) || n < 0) return "";
    n = Math.round(n);
    if (n === 0) return "0s";
    var h = Math.floor(n / 3600);
    var m = Math.floor((n % 3600) / 60);
    var s = n % 60;
    var parts = [];
    if (h) parts.push(h + "h");
    if (m) parts.push(m + "m");
    if (s && !h) parts.push(s + "s");
    if (!parts.length && h) return h + "h";
    if (!parts.length) return m ? m + "m" : s + "s";
    return parts.join(" ");
  }

  function parseDuration(text) {
    if (text == null || String(text).trim() === "") return null;
    var t = String(text).trim().toLowerCase();
    var total = 0;
    var matched = false;
    var re = /(\d+)\s*(h|m|s)/g;
    var m;
    while ((m = re.exec(t))) {
      matched = true;
      var v = Number(m[1]);
      if (m[2] === "h") total += v * 3600;
      else if (m[2] === "m") total += v * 60;
      else total += v;
    }
    if (matched) return total;
    var plain = Number(t);
    if (isFinite(plain) && plain >= 0) return Math.round(plain);
    return null;
  }

  function formatLocalDateTime(d) {
    return (
      d.getFullYear() +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      pad2(d.getDate()) +
      " " +
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes()) +
      ":" +
      pad2(d.getSeconds())
    );
  }

  function formatStartedAt(startedAt) {
    if (startedAt == null || !isFinite(Number(startedAt))) return null;
    var d = new Date(Number(startedAt));
    if (isNaN(d.getTime())) return null;
    return formatLocalDateTime(d);
  }

  /**
   * Synthetic time-of-day for sessions with null startedAt.
   * Nth null-startedAt session on a calendar day (0-based, after stable
   * same-day sort) gets midnight + N minutes: 00:00:00, 00:01:00, ...
   */
  function syntheticTimeOfDay(minuteIndex) {
    var n = Number(minuteIndex) || 0;
    if (n < 0) n = 0;
    var h = Math.floor(n / 60) % 24;
    var m = n % 60;
    return pad2(h) + ":" + pad2(m) + ":00";
  }

  function dateISOOf(session) {
    var iso = (session && session.dateISO) || "";
    if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
    var real = formatStartedAt(session && session.startedAt);
    if (real) return real.slice(0, 10);
    return "";
  }

  function startedAtMs(session) {
    if (!session || session.startedAt == null) return null;
    var n = Number(session.startedAt);
    return isFinite(n) ? n : null;
  }

  function compareSessionsForExport(a, b) {
    var da = dateISOOf(a);
    var db = dateISOOf(b);
    if (da < db) return -1;
    if (da > db) return 1;
    var sa = startedAtMs(a);
    var sb = startedAtMs(b);
    if (sa != null && sb != null && sa !== sb) return sa - sb;
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    var ida = (a && a.id) != null ? String(a.id) : "";
    var idb = (b && b.id) != null ? String(b.id) : "";
    if (ida < idb) return -1;
    if (ida > idb) return 1;
    return 0;
  }

  /**
   * Oldest-first session list plus a map of session identity -> unique Date
   * column value. Deterministic across identical store contents.
   */
  function prepareExportSessions(sessions) {
    var raw = Array.isArray(sessions) ? sessions.filter(Boolean) : [];
    var decorated = [];
    var i;
    for (i = 0; i < raw.length; i++) {
      decorated.push({ sess: raw[i], idx: i });
    }
    decorated.sort(function (a, b) {
      var c = compareSessionsForExport(a.sess, b.sess);
      if (c !== 0) return c;
      return a.idx - b.idx;
    });
    var ordered = [];
    for (i = 0; i < decorated.length; i++) ordered.push(decorated[i].sess);

    var dateByKey = {};
    var syntheticCountByDay = {};
    for (i = 0; i < ordered.length; i++) {
      var sess = ordered[i];
      var day = dateISOOf(sess);
      var real = formatStartedAt(sess.startedAt);
      var dateStr;
      if (real) {
        dateStr = real;
      } else if (day) {
        var n = syntheticCountByDay[day] || 0;
        syntheticCountByDay[day] = n + 1;
        dateStr = day + " " + syntheticTimeOfDay(n);
      } else {
        dateStr = "";
      }
      dateByKey[sessionIdentity(sess, i)] = dateStr;
    }
    return { ordered: ordered, dateByKey: dateByKey };
  }

  function sessionIdentity(session, fallbackIndex) {
    if (session && session.id != null && String(session.id) !== "") {
      return "id:" + String(session.id);
    }
    return "idx:" + String(fallbackIndex);
  }

  function exportDateFor(session, prepared, fallbackIndex) {
    if (!prepared) return formatStartedAt(session && session.startedAt) || "";
    var key = sessionIdentity(session, fallbackIndex);
    if (Object.prototype.hasOwnProperty.call(prepared.dateByKey, key)) {
      return prepared.dateByKey[key];
    }
    return "";
  }

  function dateISOFromField(dateField) {
    var s = String(dateField || "").trim();
    if (!s) return "";
    var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }
    return s;
  }

  /** Full Date cell value (trimmed). Used for grouping and import dedupe. */
  function fullDateKey(dateField) {
    return String(dateField || "").trim();
  }

  function capitalizeWave(waveDay) {
    var w = String(waveDay || "").toLowerCase();
    if (w === "intensive") return "Intensive";
    if (w === "volume") return "Volume";
    if (!w) return "";
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  function findProgram(programId) {
    if (programId == null || programId === "") return null;
    var store = storeApi();
    if (!store || typeof store.listPrograms !== "function") return null;
    var list;
    try {
      list = store.listPrograms() || [];
    } catch (e) {
      return null;
    }
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === programId) return list[i];
    }
    return null;
  }

  function dayLabelFor(session, program) {
    if (!session || session.dayId == null || session.dayId === "") return "";
    var dayId = session.dayId;
    if (program && Array.isArray(program.days)) {
      var i;
      for (i = 0; i < program.days.length; i++) {
        var day = program.days[i];
        if (day && day.id === dayId) {
          if (day.name != null && String(day.name).trim() !== "") {
            return String(day.name).trim();
          }
          break;
        }
      }
    }
    return String(dayId);
  }

  function workoutNameOf(session) {
    if (session && session.name != null && String(session.name).trim() !== "") {
      return String(session.name).trim().replace(/[\r\n]+/g, " ");
    }
    var program = findProgram(session && session.programId);
    var programName =
      program && program.name != null && String(program.name).trim() !== ""
        ? String(program.name).trim()
        : "";
    var wave = capitalizeWave(session && session.waveDay);
    var dayLabel = dayLabelFor(session, program);
    var parts = [];
    if (programName) parts.push(programName);
    if (wave) parts.push(wave);
    else if (dayLabel) parts.push(dayLabel);
    if (!parts.length) return "Workout";
    return parts.join(" · ").replace(/[\r\n]+/g, " ");
  }

  function sessionDedupKey(dateField, workoutName) {
    return fullDateKey(dateField) + "\0" + String(workoutName || "").trim().toLowerCase();
  }

  /** Parse Strong-style Date cell to epoch ms (local), or null. */
  function parseDateFieldToStartedAt(dateField) {
    var s = String(dateField || "").trim();
    if (!s) return null;
    var m = s.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/
    );
    if (!m) return null;
    var yr = Number(m[1]);
    var mo = Number(m[2]) - 1;
    var day = Number(m[3]);
    var hh = m[4] != null ? Number(m[4]) : 0;
    var mm = m[5] != null ? Number(m[5]) : 0;
    var ss = m[6] != null ? Number(m[6]) : 0;
    var d = new Date(yr, mo, day, hh, mm, ss);
    if (isNaN(d.getTime())) return null;
    return d.getTime();
  }

  function encodeNotes(set) {
    var type = set && set.type ? set.type : "normal";
    var note = set && set.note != null ? String(set.note) : "";
    var tag = TYPE_TAGS[type];
    if (!tag) return note;
    if (note) return tag + " " + note;
    return tag;
  }

  function decodeNotes(notesField) {
    var raw = notesField == null ? "" : String(notesField);
    var trimmed = raw.replace(/^\s+/, "");
    var type = "normal";
    var note = trimmed;
    var m = trimmed.match(/^\[(warmup|drop|failure)\]\s*/i);
    if (m) {
      type = m[1].toLowerCase();
      note = trimmed.slice(m[0].length);
    }
    return { type: type, note: note };
  }

  function rfcEscape(field) {
    var s = field == null ? "" : String(field);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exerciseNameForId(id) {
    var store = storeApi();
    if (store && typeof store.exerciseById === "function") {
      try {
        var ex = store.exerciseById(id);
        if (ex && ex.name) return String(ex.name);
      } catch (e) {
        /* ignore */
      }
    }
    return id == null ? "" : String(id);
  }

  function slugify(name) {
    var s = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return s || "unknown-exercise";
  }

  function buildNameIndex() {
    var map = {};
    var store = storeApi();
    var i;
    var ex;
    var key;
    if (store && typeof store.getBuiltins === "function") {
      try {
        var builtins = store.getBuiltins() || [];
        for (i = 0; i < builtins.length; i++) {
          ex = builtins[i];
          if (!ex || !ex.id) continue;
          key = String(ex.name || "").toLowerCase();
          if (key) map[key] = ex.id;
          map[String(ex.id).toLowerCase()] = ex.id;
        }
      } catch (e1) {
        /* ignore */
      }
    }
    var data = safeGet();
    var custom = (data && data.customExercises) || [];
    for (i = 0; i < custom.length; i++) {
      ex = custom[i];
      if (!ex || !ex.id) continue;
      key = String(ex.name || "").toLowerCase();
      if (key) map[key] = ex.id;
      map[String(ex.id).toLowerCase()] = ex.id;
    }
    return map;
  }

  function resolveExerciseId(name, nameIndex, warnings) {
    var raw = name == null ? "" : String(name).trim();
    if (!raw) {
      warnings.push("Row missing exercise name; used id unknown-exercise.");
      return "unknown-exercise";
    }
    var key = raw.toLowerCase();
    if (nameIndex[key]) return nameIndex[key];
    var store = storeApi();
    if (store && typeof store.exerciseById === "function") {
      try {
        var byId = store.exerciseById(raw);
        if (byId && byId.id) return byId.id;
      } catch (e) {
        /* ignore */
      }
    }
    var slug = slugify(raw);
    warnings.push('Unknown exercise "' + raw + '"; imported as id "' + slug + '".');
    return slug;
  }

  function inferImportWeightUnit(weights, settingsUnit) {
    var max = 0;
    var i;
    for (i = 0; i < weights.length; i++) {
      if (weights[i] > max) max = weights[i];
    }
    if (settingsUnit === "lb") {
      // Round-trip: our export writes lb when display unit is lb.
      // Only fall back to kg when lb would be absurd.
      if (max > 2000) return "kg";
      return "lb";
    }
    // Display unit kg: assume kg unless clearly an lb-scale Strong export.
    if (max >= 300) return "lb";
    return "kg";
  }

  /**
   * RFC4180 field parser. Handles quoted commas/newlines, CRLF/LF, BOM.
   * Returns array of rows (each row = array of string fields).
   */
  function parseRows(text) {
    var input = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    var rows = [];
    var row = [];
    var field = "";
    var i = 0;
    var len = input.length;
    var inQuotes = false;

    function pushField() {
      row.push(field);
      field = "";
    }

    function pushRow() {
      // Skip completely empty trailing line
      if (row.length === 1 && row[0] === "" && rows.length) {
        row = [];
        return;
      }
      rows.push(row);
      row = [];
    }

    while (i < len) {
      var ch = input.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && input.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        pushField();
        i += 1;
        continue;
      }
      if (ch === "\r") {
        pushField();
        pushRow();
        if (i + 1 < len && input.charAt(i + 1) === "\n") i += 2;
        else i += 1;
        continue;
      }
      if (ch === "\n") {
        pushField();
        pushRow();
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    }
    // Last field/row if file does not end with newline
    if (inQuotes || field !== "" || row.length) {
      pushField();
      pushRow();
    }
    return rows;
  }

  function normalizeHeader(name) {
    return String(name || "")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase();
  }

  function mapHeader(headerRow, warnings) {
    var index = {};
    var i;
    for (i = 0; i < headerRow.length; i++) {
      index[normalizeHeader(headerRow[i])] = i;
    }
    var colIndex = {};
    var missing = [];
    for (i = 0; i < COLS.length; i++) {
      var want = COLS[i];
      var idx = index[normalizeHeader(want)];
      if (idx == null) {
        missing.push(want);
        colIndex[want] = -1;
      } else {
        colIndex[want] = idx;
      }
    }
    if (missing.length) {
      warnings.push("Missing columns (treated as empty): " + missing.join(", ") + ".");
    }
    for (var key in index) {
      if (!Object.prototype.hasOwnProperty.call(index, key)) continue;
      var known = false;
      for (i = 0; i < COLS.length; i++) {
        if (normalizeHeader(COLS[i]) === key) {
          known = true;
          break;
        }
      }
      if (!known && key) {
        warnings.push('Ignoring unknown column "' + key + '".');
      }
    }
    return colIndex;
  }

  function cell(row, colIndex, name) {
    var idx = colIndex[name];
    if (idx == null || idx < 0 || idx >= row.length) return "";
    return row[idx] == null ? "" : String(row[idx]);
  }

  function parseNumber(raw) {
    if (raw == null || String(raw).trim() === "") return null;
    var n = Number(String(raw).trim());
    return isFinite(n) ? n : null;
  }

  function exportCsv() {
    var store = storeApi();
    var lines = [HEADER];
    if (!store || typeof store.listSessions !== "function") {
      return lines.join("\r\n") + "\r\n";
    }
    var sessions;
    try {
      sessions = store.listSessions() || [];
    } catch (e) {
      return lines.join("\r\n") + "\r\n";
    }
    var prepared = prepareExportSessions(sessions);
    var ordered = prepared.ordered;
    var unit = displayUnit();
    var si;
    for (si = 0; si < ordered.length; si++) {
      var sess = ordered[si];
      if (!sess) continue;
      var dateStr = exportDateFor(sess, prepared, si);
      var wName = workoutNameOf(sess);
      var dur = formatDuration(sess.durationSec);
      var wNotes = sess.note != null ? String(sess.note) : "";
      var sets = Array.isArray(sess.sets) ? sess.sets : [];
      var orderByEx = {};
      var zi;
      if (!sets.length) {
        // Still emit nothing for empty sessions (Strong is set-oriented)
        continue;
      }
      for (zi = 0; zi < sets.length; zi++) {
        var set = sets[zi];
        if (!set) continue;
        var exId = set.exerciseId;
        var exKey = exId == null ? "" : String(exId);
        if (!orderByEx[exKey]) orderByEx[exKey] = 0;
        orderByEx[exKey] += 1;
        var setOrder = orderByEx[exKey];
        var row = [
          dateStr,
          wName,
          dur,
          exerciseNameForId(exId),
          String(setOrder),
          kgToDisplay(set.loadKg, unit),
          set.reps != null && set.reps !== "" ? String(set.reps) : "",
          set.rpe != null && set.rpe !== "" ? String(set.rpe) : "",
          encodeNotes(set),
          wNotes,
        ];
        lines.push(
          row
            .map(function (f) {
              return rfcEscape(f);
            })
            .join(",")
        );
      }
    }
    return lines.join("\r\n") + "\r\n";
  }

  function parseCsv(text) {
    var warnings = [];
    var sessions = [];
    try {
      if (text == null || String(text).trim() === "") {
        warnings.push("Empty CSV.");
        return { sessions: [], warnings: warnings };
      }
      var rows = parseRows(text);
      if (!rows.length) {
        warnings.push("No rows found in CSV.");
        return { sessions: [], warnings: warnings };
      }
      var headerRow = rows[0];
      var colIndex = mapHeader(headerRow, warnings);
      var nameIndex = buildNameIndex();
      var settingsUnit = displayUnit();
      var weightSamples = [];
      var r;
      for (r = 1; r < rows.length; r++) {
        var wRaw = cell(rows[r], colIndex, "Weight");
        var wn = parseNumber(wRaw);
        if (wn != null) weightSamples.push(Math.abs(wn));
      }
      var weightUnit = inferImportWeightUnit(weightSamples, settingsUnit);
      if (weightUnit !== "kg") {
        warnings.push("Interpreting Weight column as " + weightUnit + " (converted to kg).");
      }

      var groups = {};
      var groupOrder = [];

      for (r = 1; r < rows.length; r++) {
        var row = rows[r];
        if (!row || !row.length) continue;
        var allEmpty = true;
        var ci;
        for (ci = 0; ci < row.length; ci++) {
          if (String(row[ci] || "").trim() !== "") {
            allEmpty = false;
            break;
          }
        }
        if (allEmpty) continue;

        var dateField = cell(row, colIndex, "Date");
        var wName = cell(row, colIndex, "Workout Name") || "Workout";
        var durField = cell(row, colIndex, "Duration");
        var exName = cell(row, colIndex, "Exercise Name");
        var weightField = cell(row, colIndex, "Weight");
        var repsField = cell(row, colIndex, "Reps");
        var rpeField = cell(row, colIndex, "RPE");
        var notesField = cell(row, colIndex, "Notes");
        var workoutNotes = cell(row, colIndex, "Workout Notes");

        var dateFull = fullDateKey(dateField);
        var key = sessionDedupKey(dateFull, wName);
        if (!dateFull) {
          warnings.push("Row " + (r + 1) + ": missing Date; skipped.");
          continue;
        }
        if (!groups[key]) {
          groups[key] = {
            dateISO: dateISOFromField(dateFull),
            name: wName,
            durationSec: parseDuration(durField),
            note: workoutNotes || "",
            sets: [],
            dateField: dateFull,
            startedAt: parseDateFieldToStartedAt(dateFull),
          };
          groupOrder.push(key);
        } else {
          var g0 = groups[key];
          if (!g0.note && workoutNotes) g0.note = workoutNotes;
          if (g0.durationSec == null) g0.durationSec = parseDuration(durField);
        }

        var decoded = decodeNotes(notesField);
        var exId = resolveExerciseId(exName, nameIndex, warnings);
        var loadDisplay = parseNumber(weightField);
        var loadKg = loadDisplay == null ? 0 : displayToKg(loadDisplay, weightUnit);
        var reps = parseNumber(repsField);
        if (reps == null) reps = 0;
        var rpe = parseNumber(rpeField);

        var setPatch = {
          loadKg: loadKg,
          reps: reps,
          completed: true,
          type: decoded.type,
          note: decoded.note || undefined,
        };
        if (rpe != null) setPatch.rpe = rpe;

        var store = storeApi();
        var built;
        if (store && typeof store.newSet === "function") {
          try {
            built = store.newSet(exId, setPatch);
          } catch (eNew) {
            built = null;
          }
        }
        if (!built) {
          built = {
            id:
              "id-" +
              Date.now().toString(36) +
              "-" +
              Math.random().toString(36).slice(2, 10),
            exerciseId: exId,
            loadKg: loadKg,
            reps: reps,
            completed: true,
            type: decoded.type,
            note: decoded.note || undefined,
            supersetId: null,
          };
          if (rpe != null) built.rpe = rpe;
          warnings.push("Row " + (r + 1) + ": newSet unavailable; built set locally.");
        }
        groups[key].sets.push(built);
      }

      for (var gi = 0; gi < groupOrder.length; gi++) {
        var g = groups[groupOrder[gi]];
        sessions.push({
          dateISO: g.dateISO,
          name: g.name,
          durationSec: g.durationSec,
          note: g.note || "",
          startedAt: g.startedAt != null ? g.startedAt : null,
          endedAt: null,
          bodyweightKg: null,
          sectionNotes: {},
          sets: g.sets,
          _csvDateField: g.dateField,
        });
      }
    } catch (err) {
      warnings.push("Parse failed: " + (err && err.message ? err.message : "unknown error"));
      return { sessions: [], warnings: warnings };
    }
    return { sessions: sessions, warnings: warnings };
  }

  function existingDedupKeys() {
    var keys = {};
    var store = storeApi();
    if (!store || typeof store.listSessions !== "function") return keys;
    var list;
    try {
      list = store.listSessions() || [];
    } catch (e) {
      return keys;
    }
    var prepared = prepareExportSessions(list);
    var i;
    for (i = 0; i < prepared.ordered.length; i++) {
      var s = prepared.ordered[i];
      if (!s) continue;
      var dateStr = exportDateFor(s, prepared, i);
      if (!dateStr) continue;
      keys[sessionDedupKey(dateStr, workoutNameOf(s))] = true;
    }
    return keys;
  }

  function importCsv(text) {
    var result = { added: 0, skipped: 0, warnings: [] };
    var parsed;
    try {
      parsed = parseCsv(text);
    } catch (e) {
      result.warnings.push("Import failed: " + (e && e.message ? e.message : "unknown error"));
      return result;
    }
    result.warnings = (parsed.warnings || []).slice();
    var sessions = parsed.sessions || [];
    var existing = existingDedupKeys();
    var store = storeApi();
    var i;
    for (i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      if (!sess) continue;
      var dateFull = fullDateKey(sess._csvDateField);
      if (!dateFull && sess.startedAt != null) {
        dateFull = formatStartedAt(sess.startedAt) || "";
      }
      if (!dateFull && sess.dateISO) {
        dateFull = String(sess.dateISO).slice(0, 10) + " 00:00:00";
      }
      var key = sessionDedupKey(dateFull, sess.name);
      if (existing[key]) {
        result.skipped += 1;
        continue;
      }
      var payload = {
        dateISO: sess.dateISO || dateISOFromField(dateFull),
        name: sess.name,
        durationSec: sess.durationSec,
        note: sess.note || "",
        startedAt: sess.startedAt != null ? sess.startedAt : parseDateFieldToStartedAt(dateFull),
        endedAt: null,
        bodyweightKg: sess.bodyweightKg != null ? sess.bodyweightKg : null,
        sectionNotes: sess.sectionNotes || {},
        sets: sess.sets || [],
      };
      if (!store || typeof store.upsertSession !== "function") {
        result.warnings.push(
          'Could not save workout "' + payload.name + '" on ' + payload.dateISO + " (store missing)."
        );
        continue;
      }
      try {
        store.upsertSession(payload);
        existing[key] = true;
        result.added += 1;
      } catch (err) {
        result.warnings.push(
          'Failed to save workout "' +
            payload.name +
            '" on ' +
            payload.dateISO +
            ": " +
            (err && err.message ? err.message : "error")
        );
      }
    }
    return result;
  }

  window.SL.csv = {
    exportCsv: exportCsv,
    parseCsv: parseCsv,
    importCsv: importCsv,
  };
})();
