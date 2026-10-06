(function (root) {
  "use strict";

  var COMP = ["pullup", "dip", "muscleup", "squat"];
  var ACT_ORDER = ["run", "ride", "swim", "walk", "row", "hike"];
  var LABELS = {
    pullup: "Pull-up",
    dip: "Dip",
    muscleup: "Muscle-up",
    squat: "Squat"
  };
  var MS_DAY = 86400000;

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function finite(v) {
    if (typeof v !== "number" || !isFinite(v)) return null;
    return v;
  }

  function hasKey(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function parseDay(iso) {
    if (typeof iso !== "string") return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }

  function formatDay(dt) {
    return dt.getUTCFullYear() + "-" + pad2(dt.getUTCMonth() + 1) + "-" + pad2(dt.getUTCDate());
  }

  function addDays(iso, delta) {
    var dt = parseDay(iso);
    if (!dt) return "";
    dt.setUTCDate(dt.getUTCDate() + delta);
    return formatDay(dt);
  }

  function addMonths(iso, delta) {
    var dt = parseDay(iso);
    if (!dt) return "";
    var day = dt.getUTCDate();
    var moved = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + delta, 1, 12, 0, 0));
    var last = new Date(Date.UTC(moved.getUTCFullYear(), moved.getUTCMonth() + 1, 0, 12, 0, 0)).getUTCDate();
    if (day > last) day = last;
    moved.setUTCDate(day);
    return formatDay(moved);
  }

  function dayDiff(fromISO, toISO) {
    var a = parseDay(fromISO);
    var b = parseDay(toISO);
    if (!a || !b) return 0;
    return Math.round((b.getTime() - a.getTime()) / MS_DAY);
  }

  function weekKey(dateISO) {
    var dt = parseDay(dateISO);
    if (!dt) return "";
    var utc = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    var weekday = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
    var isoYear = utc.getUTCFullYear();
    var dayOffset = Math.round((utc.getTime() - Date.UTC(isoYear, 0, 1)) / MS_DAY);
    return isoYear + "-W" + pad2(Math.floor(dayOffset / 7) + 1);
  }

  function mondayOfWeek(key) {
    var m = /^(\d{4})-W(\d{2})$/.exec(key);
    if (!m) return "";
    var year = Number(m[1]);
    var week = Number(m[2]);
    if (!isFinite(year) || !isFinite(week) || week < 1) return "";
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var weekday = jan4.getUTCDay() || 7;
    var monday = new Date(jan4.getTime());
    monday.setUTCDate(jan4.getUTCDate() + 4 - weekday + (week - 1) * 7 - 3);
    return formatDay(monday);
  }

  function shiftWeekKey(key, delta) {
    var mon = mondayOfWeek(key);
    if (!mon) return "";
    return weekKey(addDays(mon, delta * 7));
  }

  function label(slug) {
    if (hasKey(LABELS, slug)) return LABELS[slug];
    var text = slug == null ? "" : String(slug);
    var parts = text.split(/[-_]+/);
    var words = [];
    var i;
    var piece;
    var lower;
    for (i = 0; i < parts.length; i++) {
      piece = parts[i];
      if (!piece) continue;
      lower = piece.toLowerCase();
      words.push(lower.charAt(0).toUpperCase() + lower.slice(1));
    }
    return words.join(" ");
  }

  function e1rm(kg, reps) {
    if (typeof kg !== "number" || !isFinite(kg)) return 0;
    if (typeof reps !== "number" || !isFinite(reps)) return 0;
    if (reps <= 1) return kg;
    return kg * (1 + reps / 30);
  }

  function normalize(file) {
    var sessions = {};
    var goals = [];
    var weeks = {};
    if (file && typeof file === "object") {
      if (file.sessions && typeof file.sessions === "object") sessions = file.sessions;
      if (Array.isArray(file.goals)) goals = file.goals;
      if (file.weeks && typeof file.weeks === "object") weeks = file.weeks;
    }
    return { sessions: sessions, goals: goals, weeks: weeks };
  }

  function sessionDates(file) {
    var sessions = normalize(file).sessions;
    var dates = Object.keys(sessions);
    var out = [];
    var i;
    for (i = 0; i < dates.length; i++) {
      if (parseDay(dates[i])) out.push(dates[i]);
    }
    out.sort();
    return out;
  }

  function readWorking(set) {
    if (!set || typeof set !== "object") return null;
    if (set.warmup) return null;
    var kg = finite(set.kg);
    var reps = finite(set.reps);
    if (kg === null || reps === null) return null;
    return { kg: kg, reps: reps, e1rm: e1rm(kg, reps) };
  }

  function workingSets(session, lift) {
    var out = [];
    if (!session || !session.lifts || typeof session.lifts !== "object") return out;
    var arr = session.lifts[lift];
    if (!Array.isArray(arr)) return out;
    var i;
    var parsed;
    for (i = 0; i < arr.length; i++) {
      parsed = readWorking(arr[i]);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  function inRange(date, range, todayISO) {
    if (range !== "1m" && range !== "3m" && range !== "1y") return true;
    if (typeof date !== "string" || typeof todayISO !== "string") return false;
    if (date > todayISO) return false;
    var months = range === "1m" ? -1 : range === "3m" ? -3 : -12;
    var start = addMonths(todayISO, months);
    if (!start) return false;
    return date >= start;
  }

  function series(file, lift, range, todayISO) {
    var sessions = normalize(file).sessions;
    var dates = sessionDates(file);
    var maxPrev = null;
    var all = [];
    var i;
    var j;
    var sets;
    var best;
    var isPr;
    for (i = 0; i < dates.length; i++) {
      sets = workingSets(sessions[dates[i]], lift);
      best = null;
      for (j = 0; j < sets.length; j++) {
        if (!best || sets[j].e1rm > best.e1rm) best = sets[j];
      }
      if (!best) continue;
      isPr = maxPrev === null || best.e1rm > maxPrev;
      if (isPr) maxPrev = best.e1rm;
      all.push({
        date: dates[i],
        e1rm: best.e1rm,
        kg: best.kg,
        reps: best.reps,
        pr: isPr
      });
    }
    var out = [];
    for (i = 0; i < all.length; i++) {
      if (inRange(all[i].date, range, todayISO)) out.push(all[i]);
    }
    return out;
  }

  function prs(file) {
    var sessions = normalize(file).sessions;
    var dates = sessionDates(file);
    var maxE = {};
    var maxKg = {};
    var maxReps = {};
    var groups = [];
    var di;
    var li;
    var j;
    var date;
    var session;
    var lifts;
    var lift;
    var arr;
    var parsed;
    var group;
    for (di = 0; di < dates.length; di++) {
      date = dates[di];
      session = sessions[date];
      if (!session || !session.lifts || typeof session.lifts !== "object") continue;
      lifts = Object.keys(session.lifts);
      for (li = 0; li < lifts.length; li++) {
        lift = lifts[li];
        arr = session.lifts[lift];
        if (!Array.isArray(arr)) continue;
        for (j = 0; j < arr.length; j++) {
          parsed = readWorking(arr[j]);
          if (!parsed) continue;
          group = [];
          if (!hasKey(maxE, lift) || parsed.e1rm > maxE[lift]) {
            maxE[lift] = parsed.e1rm;
            group.push({
              date: date,
              lift: lift,
              kind: "e1rm",
              value: parsed.e1rm,
              kg: parsed.kg,
              reps: parsed.reps
            });
          }
          if (!hasKey(maxKg, lift) || parsed.kg > maxKg[lift]) {
            maxKg[lift] = parsed.kg;
            group.push({
              date: date,
              lift: lift,
              kind: "weight",
              value: parsed.kg,
              kg: parsed.kg,
              reps: parsed.reps
            });
          }
          if (!hasKey(maxReps, lift) || parsed.reps > maxReps[lift]) {
            maxReps[lift] = parsed.reps;
            group.push({
              date: date,
              lift: lift,
              kind: "reps",
              value: parsed.reps,
              kg: parsed.kg,
              reps: parsed.reps
            });
          }
          if (group.length) groups.push(group);
        }
      }
    }
    var out = [];
    var gi;
    var si;
    for (gi = groups.length - 1; gi >= 0; gi--) {
      for (si = 0; si < groups[gi].length; si++) out.push(groups[gi][si]);
    }
    return out;
  }

  function latestDayPrs(file) {
    var dates = sessionDates(file);
    if (!dates.length) return [];
    var newest = dates[dates.length - 1];
    var all = prs(file);
    var out = [];
    var i;
    for (i = 0; i < all.length; i++) {
      if (all[i].date === newest) out.push(all[i]);
    }
    return out;
  }

  function streak(file, todayISO) {
    var dates = sessionDates(file);
    if (!dates.length) return { weeks: 0, daysSince: null };
    var has = {};
    var i;
    for (i = 0; i < dates.length; i++) has[weekKey(dates[i])] = true;
    var daysSince = dayDiff(dates[dates.length - 1], todayISO);
    var cursor = weekKey(todayISO);
    if (!has[cursor]) {
      cursor = shiftWeekKey(cursor, -1);
      if (!cursor || !has[cursor]) return { weeks: 0, daysSince: daysSince };
    }
    var weeks = 0;
    while (cursor && has[cursor] && weeks < 2000) {
      weeks += 1;
      cursor = shiftWeekKey(cursor, -1);
    }
    return { weeks: weeks, daysSince: daysSince };
  }

  function monthCount(file, todayISO) {
    if (typeof todayISO !== "string" || todayISO.length < 7) return 0;
    var ym = todayISO.slice(0, 7);
    var dates = sessionDates(file);
    var n = 0;
    var i;
    for (i = 0; i < dates.length; i++) {
      if (dates[i].slice(0, 7) === ym) n += 1;
    }
    return n;
  }

  function totalSeries(file, range, todayISO) {
    var sessions = normalize(file).sessions;
    var dates = sessionDates(file);
    var best = { pullup: null, dip: null, muscleup: null, squat: null };
    var points = [];
    var i;
    var c;
    var j;
    var date;
    var lift;
    var sets;
    var ready;
    var parts;
    for (i = 0; i < dates.length; i++) {
      date = dates[i];
      for (c = 0; c < COMP.length; c++) {
        lift = COMP[c];
        sets = workingSets(sessions[date], lift);
        for (j = 0; j < sets.length; j++) {
          if (best[lift] === null || sets[j].e1rm > best[lift]) best[lift] = sets[j].e1rm;
        }
      }
      ready = true;
      for (c = 0; c < COMP.length; c++) {
        if (best[COMP[c]] === null) ready = false;
      }
      if (!ready) continue;
      parts = {
        pullup: best.pullup,
        dip: best.dip,
        muscleup: best.muscleup,
        squat: best.squat
      };
      points.push({
        date: date,
        total: parts.pullup + parts.dip + parts.muscleup + parts.squat,
        parts: parts
      });
    }
    var filtered = [];
    for (i = 0; i < points.length; i++) {
      if (inRange(points[i].date, range, todayISO)) filtered.push(points[i]);
    }
    var missing = [];
    for (c = 0; c < COMP.length; c++) {
      if (best[COMP[c]] === null) missing.push(COMP[c]);
    }
    return { missing: missing, points: filtered };
  }

  function weightOnOrBefore(sortedDates, days, date) {
    var i;
    var row;
    var w;
    for (i = sortedDates.length - 1; i >= 0; i--) {
      if (sortedDates[i] > date) continue;
      row = days[sortedDates[i]];
      if (!row || typeof row !== "object") continue;
      w = finite(row.weight);
      if (w !== null) return w;
    }
    return null;
  }

  function resolveBw(session, date, nutDates, nutDays) {
    if (session && typeof session.bw === "number" && isFinite(session.bw)) return session.bw;
    return weightOnOrBefore(nutDates, nutDays, date);
  }

  function relativeSeries(file, nutrition, range, todayISO) {
    var sessions = normalize(file).sessions;
    var dates = sessionDates(file);
    var best = { pullup: null, dip: null, muscleup: null, squat: null };
    var nutDays = {};
    if (nutrition && typeof nutrition === "object" && nutrition.days && typeof nutrition.days === "object") {
      nutDays = nutrition.days;
    }
    var nutDates = [];
    var rawKeys = Object.keys(nutDays);
    var i;
    for (i = 0; i < rawKeys.length; i++) {
      if (parseDay(rawKeys[i])) nutDates.push(rawKeys[i]);
    }
    nutDates.sort();
    var points = [];
    var c;
    var j;
    var date;
    var lift;
    var sets;
    var bw;
    var rel;
    var est;
    var ratio;
    for (i = 0; i < dates.length; i++) {
      date = dates[i];
      for (c = 0; c < COMP.length; c++) {
        lift = COMP[c];
        sets = workingSets(sessions[date], lift);
        for (j = 0; j < sets.length; j++) {
          if (best[lift] === null || sets[j].e1rm > best[lift]) best[lift] = sets[j].e1rm;
        }
      }
      if (!inRange(date, range, todayISO)) continue;
      bw = resolveBw(sessions[date], date, nutDates, nutDays);
      if (bw === null) continue;
      rel = {};
      for (c = 0; c < COMP.length; c++) {
        lift = COMP[c];
        est = best[lift];
        if (est === null) {
          rel[lift] = null;
        } else {
          ratio = (bw + est) / bw;
          rel[lift] = typeof ratio === "number" && isFinite(ratio) ? ratio : null;
        }
      }
      points.push({ date: date, bw: bw, rel: rel });
    }
    return { points: points };
  }

  function goalMode(goal) {
    if (!goal || goal.reps == null) return { oneRm: true, reps: 1 };
    if (typeof goal.reps !== "number" || !isFinite(goal.reps) || goal.reps === 1) {
      return { oneRm: true, reps: 1 };
    }
    return { oneRm: false, reps: goal.reps };
  }

  function bestCurrent(file, lift, mode) {
    var sessions = normalize(file).sessions;
    var dates = sessionDates(file);
    var best = null;
    var i;
    var j;
    var sets;
    var v;
    for (i = 0; i < dates.length; i++) {
      sets = workingSets(sessions[dates[i]], lift);
      for (j = 0; j < sets.length; j++) {
        if (mode.oneRm) v = sets[j].e1rm;
        else if (sets[j].reps >= mode.reps) v = sets[j].kg;
        else continue;
        if (best === null || v > best) best = v;
      }
    }
    return best === null ? 0 : best;
  }

  function weekWindow(todayISO) {
    var end = weekKey(todayISO);
    var out = [];
    var i;
    if (!end) return out;
    for (i = 7; i >= 0; i--) out.push(shiftWeekKey(end, -i));
    return out;
  }

  function weeklyPoints(file, lift, todayISO, mode) {
    var sessions = normalize(file).sessions;
    var weeks = weekWindow(todayISO);
    var indexOf = {};
    var best = {};
    var i;
    var dates;
    var wk;
    var sets;
    var j;
    var v;
    for (i = 0; i < weeks.length; i++) indexOf[weeks[i]] = i;
    dates = sessionDates(file);
    for (i = 0; i < dates.length; i++) {
      wk = weekKey(dates[i]);
      if (!hasKey(indexOf, wk)) continue;
      sets = workingSets(sessions[dates[i]], lift);
      for (j = 0; j < sets.length; j++) {
        if (mode.oneRm) v = sets[j].e1rm;
        else if (sets[j].reps >= mode.reps) v = sets[j].kg;
        else continue;
        if (!hasKey(best, wk) || v > best[wk]) best[wk] = v;
      }
    }
    var pts = [];
    for (i = 0; i < weeks.length; i++) {
      if (hasKey(best, weeks[i])) pts.push({ x: i, y: best[weeks[i]] });
    }
    return { weeks: weeks, pts: pts };
  }

  function fitLine(pts) {
    var n = pts.length;
    var sumX = 0;
    var sumY = 0;
    var sumXY = 0;
    var sumXX = 0;
    var i;
    for (i = 0; i < n; i++) {
      sumX += pts[i].x;
      sumY += pts[i].y;
      sumXY += pts[i].x * pts[i].y;
      sumXX += pts[i].x * pts[i].x;
    }
    var denom = n * sumXX - sumX * sumX;
    if (!denom) return { slope: 0, intercept: n ? sumY / n : 0 };
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    return { slope: slope, intercept: intercept };
  }

  function projectEta(slope, intercept, target, weeks, todayISO) {
    if (!(slope > 0)) return { eta: null, stalled: true };
    if (!weeks.length) return { eta: null, stalled: false };
    var currentIndex = weeks.length - 1;
    var limit = currentIndex + 104;
    var x;
    var y;
    var week;
    var monday;
    for (x = 0; x <= limit; x++) {
      y = intercept + slope * x;
      if (y + 1e-6 >= target) {
        week = shiftWeekKey(weeks[0], x);
        monday = mondayOfWeek(week);
        if (!monday) return { eta: null, stalled: false };
        if (monday < todayISO) return { eta: todayISO, stalled: false };
        return { eta: monday, stalled: false };
      }
    }
    return { eta: null, stalled: false };
  }

  function goalCards(file, todayISO) {
    var goals = normalize(file).goals;
    var out = [];
    var i;
    var goal;
    var mode;
    var target;
    var current;
    var pct;
    var hit;
    var eta;
    var stalled;
    var weekly;
    var fit;
    var projected;
    for (i = 0; i < goals.length; i++) {
      goal = goals[i] && typeof goals[i] === "object" ? goals[i] : {};
      mode = goalMode(goal);
      target = finite(goal.target);
      if (target === null) target = 0;
      current = bestCurrent(file, typeof goal.lift === "string" ? goal.lift : "", mode);
      pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
      if (!isFinite(pct)) pct = 0;
      hit = current >= target && target > 0;
      eta = null;
      stalled = false;
      if (!hit) {
        weekly = weeklyPoints(file, typeof goal.lift === "string" ? goal.lift : "", todayISO, mode);
        if (weekly.pts.length >= 2) {
          fit = fitLine(weekly.pts);
          projected = projectEta(fit.slope, fit.intercept, target, weekly.weeks, todayISO);
          eta = projected.eta;
          stalled = projected.stalled;
        }
      }
      out.push({
        id: goal.id,
        lift: goal.lift,
        target: target,
        reps: mode.reps,
        note: goal.note,
        current: current,
        pct: pct,
        eta: eta,
        stalled: stalled,
        hit: hit
      });
    }
    return out;
  }

  function workingCount(session) {
    if (!session || !session.lifts || typeof session.lifts !== "object") return 0;
    var keys = Object.keys(session.lifts);
    var n = 0;
    var i;
    var j;
    var arr;
    for (i = 0; i < keys.length; i++) {
      arr = session.lifts[keys[i]];
      if (!Array.isArray(arr)) continue;
      for (j = 0; j < arr.length; j++) {
        if (readWorking(arr[j])) n += 1;
      }
    }
    return n;
  }

  function heatCount(session) {
    var work;
    var n;
    if (!session) return 0;
    work = workingCount(session);
    if (work > 0) return work;
    if (!Array.isArray(session.activities) || session.activities.length === 0) return 0;
    n = activityCount(session);
    if (n < 1) return 1;
    return n;
  }

  function heatmap(file, todayISO) {
    var sessions = normalize(file).sessions;
    var monday = mondayOfWeek(weekKey(todayISO));
    var start = monday ? addDays(monday, -25 * 7) : "";
    var columns = [];
    var w;
    var d;
    var date;
    var col;
    for (w = 0; w < 26; w++) {
      col = [];
      for (d = 0; d < 7; d++) {
        date = start ? addDays(start, w * 7 + d) : "";
        col.push({
          date: date,
          count: date && sessions[date] ? heatCount(sessions[date]) : 0
        });
      }
      columns.push(col);
    }
    return { columns: columns };
  }

  function currentWeekCoach(file, todayISO) {
    var weeks = normalize(file).weeks;
    var row = weeks[weekKey(todayISO)];
    if (!row || typeof row.coach !== "string") return "";
    return row.coach;
  }

  function liftsIn(file) {
    var sessions = normalize(file).sessions;
    var dates = sessionDates(file);
    var seen = {};
    var i;
    var k;
    var j;
    var keys;
    var lift;
    var arr;
    var session;
    for (i = 0; i < dates.length; i++) {
      session = sessions[dates[i]];
      if (!session || !session.lifts || typeof session.lifts !== "object") continue;
      keys = Object.keys(session.lifts);
      for (k = 0; k < keys.length; k++) {
        lift = keys[k];
        arr = session.lifts[lift];
        if (!Array.isArray(arr)) continue;
        for (j = 0; j < arr.length; j++) {
          if (arr[j] && typeof arr[j] === "object") {
            seen[lift] = true;
            break;
          }
        }
      }
    }
    var out = [];
    var extras = [];
    keys = Object.keys(seen);
    for (i = 0; i < COMP.length; i++) {
      if (seen[COMP[i]]) out.push(COMP[i]);
    }
    for (i = 0; i < keys.length; i++) {
      if (COMP.indexOf(keys[i]) === -1) extras.push(keys[i]);
    }
    extras.sort();
    for (i = 0; i < extras.length; i++) out.push(extras[i]);
    return out;
  }

  function activityCount(session) {
    var acts;
    var n = 0;
    var i;
    if (!session || !Array.isArray(session.activities)) return 0;
    acts = session.activities;
    for (i = 0; i < acts.length; i++) {
      if (acts[i] && typeof acts[i] === "object") n += 1;
    }
    return n;
  }

  function repMaxes(file, lift) {
    var sessions = normalize(file).sessions;
    var dates = sessionDates(file);
    var bestKg = [];
    var bestDate = [];
    var out = [];
    var n;
    var i;
    var j;
    var sets;
    var kg;
    var reps;
    for (n = 1; n <= 10; n++) {
      bestKg[n] = null;
      bestDate[n] = null;
    }
    for (i = 0; i < dates.length; i++) {
      sets = workingSets(sessions[dates[i]], lift);
      for (j = 0; j < sets.length; j++) {
        kg = sets[j].kg;
        reps = sets[j].reps;
        for (n = 1; n <= 10; n++) {
          if (reps < n) break;
          if (bestKg[n] === null || kg > bestKg[n]) {
            bestKg[n] = kg;
            bestDate[n] = dates[i];
          }
        }
      }
    }
    for (n = 1; n <= 10; n++) {
      out.push({ reps: n, kg: bestKg[n], date: bestDate[n] });
    }
    return out;
  }

  function programView(file, lift) {
    var programs;
    var prog;
    var srcDays;
    var days = [];
    var i;
    var src;
    var doneText;
    var isDone;
    var sawNext = false;
    var status;
    var doneCount = 0;
    if (!file || typeof file !== "object") return null;
    programs = file.programs;
    if (!programs || typeof programs !== "object") return null;
    if (!hasKey(programs, lift)) return null;
    prog = programs[lift];
    if (!prog || typeof prog !== "object") return null;
    srcDays = prog.days;
    if (!Array.isArray(srcDays) || !srcDays.length) return null;
    for (i = 0; i < srcDays.length; i++) {
      src = srcDays[i] && typeof srcDays[i] === "object" ? srcDays[i] : {};
      doneText = typeof src.done === "string" ? src.done : "";
      isDone = doneText.length > 0;
      if (isDone) {
        status = "done";
        doneCount += 1;
      } else if (!sawNext) {
        status = "next";
        sawNext = true;
      } else {
        status = "upcoming";
      }
      days.push({
        label: typeof src.label === "string" ? src.label : "",
        sets: Array.isArray(src.sets) ? src.sets.slice() : [],
        done: isDone ? doneText : null,
        status: status
      });
    }
    return {
      name: typeof prog.name === "string" ? prog.name : "",
      note: typeof prog.note === "string" ? prog.note : "",
      start: typeof prog.start === "string" ? prog.start : "",
      days: days,
      doneCount: doneCount,
      total: srcDays.length
    };
  }

  function sessionKcal(session) {
    var total = null;
    var k;
    var acts;
    var i;
    var c;
    if (!session || typeof session !== "object") return null;
    k = finite(session.liftKcal);
    if (k !== null) total = k;
    acts = session.activities;
    if (!Array.isArray(acts)) return total;
    for (i = 0; i < acts.length; i++) {
      if (!acts[i] || typeof acts[i] !== "object") continue;
      c = finite(acts[i].kcal);
      if (c === null) continue;
      total = total === null ? c : total + c;
    }
    return total;
  }

  function bumpPart(bucket, key, value) {
    if (typeof key !== "string" || !key) return;
    if (typeof value !== "number" || !isFinite(value)) return;
    if (!hasKey(bucket, key)) bucket[key] = 0;
    bucket[key] += value;
  }

  function weekSpan(todayISO, n) {
    var end = weekKey(todayISO);
    var out = [];
    var count = 12;
    var i;
    if (!end) return out;
    if (typeof n === "number" && isFinite(n)) count = Math.floor(n);
    if (count < 0) count = 0;
    for (i = count - 1; i >= 0; i--) out.push(shiftWeekKey(end, -i));
    return out;
  }

  function weeklyKcal(file, todayISO, n) {
    var sessions = normalize(file).sessions;
    var weeks = weekSpan(todayISO, n);
    var indexOf = {};
    var buckets = [];
    var out = [];
    var dates;
    var i;
    var j;
    var date;
    var session;
    var wk;
    var idx;
    var k;
    var acts;
    var act;
    var parts;
    var keys;
    var key;
    var total;
    for (i = 0; i < weeks.length; i++) {
      indexOf[weeks[i]] = i;
      buckets.push({});
    }
    dates = sessionDates(file);
    for (i = 0; i < dates.length; i++) {
      date = dates[i];
      wk = weekKey(date);
      if (!hasKey(indexOf, wk)) continue;
      idx = indexOf[wk];
      session = sessions[date];
      if (!session || typeof session !== "object") continue;
      k = finite(session.liftKcal);
      if (k !== null) bumpPart(buckets[idx], "strength", k);
      acts = session.activities;
      if (!Array.isArray(acts)) continue;
      for (j = 0; j < acts.length; j++) {
        act = acts[j];
        if (!act || typeof act !== "object") continue;
        if (typeof act.type !== "string" || !act.type) continue;
        k = finite(act.kcal);
        if (k === null) continue;
        bumpPart(buckets[idx], act.type, k);
      }
    }
    for (i = 0; i < weeks.length; i++) {
      parts = {};
      total = 0;
      keys = Object.keys(buckets[i]);
      for (j = 0; j < keys.length; j++) {
        key = keys[j];
        if (!buckets[i][key]) continue;
        parts[key] = buckets[i][key];
        total += buckets[i][key];
      }
      out.push({ week: weeks[i], total: total, parts: parts });
    }
    return out;
  }

  function activityTypes(file) {
    var sessions = normalize(file).sessions;
    var dates = sessionDates(file);
    var seen = {};
    var out = [];
    var extras = [];
    var keys;
    var i;
    var j;
    var session;
    var acts;
    var type;
    for (i = 0; i < dates.length; i++) {
      session = sessions[dates[i]];
      if (!session || !Array.isArray(session.activities)) continue;
      acts = session.activities;
      for (j = 0; j < acts.length; j++) {
        if (!acts[j] || typeof acts[j] !== "object") continue;
        type = acts[j].type;
        if (typeof type !== "string" || !type) continue;
        seen[type] = true;
      }
    }
    for (i = 0; i < ACT_ORDER.length; i++) {
      if (seen[ACT_ORDER[i]]) out.push(ACT_ORDER[i]);
    }
    keys = Object.keys(seen);
    for (i = 0; i < keys.length; i++) {
      if (ACT_ORDER.indexOf(keys[i]) === -1) extras.push(keys[i]);
    }
    extras.sort();
    for (i = 0; i < extras.length; i++) out.push(extras[i]);
    return out;
  }

  var api = {
    COMP: COMP,
    LABELS: LABELS,
    label: label,
    e1rm: e1rm,
    series: series,
    prs: prs,
    latestDayPrs: latestDayPrs,
    streak: streak,
    monthCount: monthCount,
    totalSeries: totalSeries,
    relativeSeries: relativeSeries,
    goalCards: goalCards,
    heatmap: heatmap,
    weekKey: weekKey,
    currentWeekCoach: currentWeekCoach,
    liftsIn: liftsIn,
    repMaxes: repMaxes,
    programView: programView,
    sessionKcal: sessionKcal,
    weeklyKcal: weeklyKcal,
    activityTypes: activityTypes
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.Street = api;
  }
})(typeof window !== "undefined" ? window : {});

if (typeof module !== "undefined" && require.main === module) {
  var assert = require("assert");
  var Street = module.exports;

  assert.strictEqual(Street.e1rm(100, 1), 100);
  assert.ok(Math.abs(Street.e1rm(100, 5) - 100 * (1 + 5 / 30)) < 1e-9);
  assert.strictEqual(Street.e1rm(NaN, 5), 0);
  assert.strictEqual(Street.e1rm(100, Infinity), 0);

  assert.strictEqual(Street.weekKey("2026-10-06"), "2026-W41");
  assert.strictEqual(Street.weekKey("2026-12-31"), "2026-W53");
  assert.strictEqual(Street.weekKey("2026-10-05"), "2026-W41");
  assert.strictEqual(Street.weekKey("2026-10-11"), "2026-W41");
  assert.strictEqual(Street.weekKey("2026-10-12"), "2026-W42");
  assert.strictEqual(Street.weekKey("2026-09-28"), "2026-W40");
  assert.strictEqual(Street.weekKey("2026-09-21"), "2026-W39");
  assert.strictEqual(Street.weekKey("2026-09-20"), "2026-W38");

  var streak3 = Street.streak({
    sessions: {
      "2026-10-05": { lifts: { pullup: [{ kg: 10, reps: 5 }] } },
      "2026-09-28": { lifts: { pullup: [{ kg: 10, reps: 5 }] } },
      "2026-09-21": { lifts: { pullup: [{ kg: 10, reps: 5 }] } }
    }
  }, "2026-10-06");
  assert.strictEqual(streak3.weeks, 3);
  assert.strictEqual(streak3.daysSince, 1);

  var streak1 = Street.streak({
    sessions: { "2026-09-28": { lifts: { pullup: [{ kg: 10, reps: 5 }] } } }
  }, "2026-10-06");
  assert.strictEqual(streak1.weeks, 1);
  assert.strictEqual(streak1.daysSince, 8);

  var streak0 = Street.streak({
    sessions: { "2026-09-20": { lifts: { pullup: [{ kg: 10, reps: 5 }] } } }
  }, "2026-10-06");
  assert.strictEqual(streak0.weeks, 0);
  assert.ok(streak0.daysSince > 7);

  var emptyStreak = Street.streak(null, "2026-10-06");
  assert.strictEqual(emptyStreak.weeks, 0);
  assert.strictEqual(emptyStreak.daysSince, null);

  var warm = {
    sessions: {
      "2026-10-05": {
        lifts: { pullup: [{ kg: 100, reps: 5, warmup: true }] }
      }
    }
  };
  assert.strictEqual(Street.prs(warm).length, 0);
  var heat = Street.heatmap(warm, "2026-10-06");
  assert.strictEqual(heat.columns.length, 26);
  assert.strictEqual(heat.columns[0].length, 7);
  assert.strictEqual(heat.columns[25][0].date, "2026-10-05");
  assert.strictEqual(heat.columns[25][0].count, 0);
  assert.strictEqual(heat.columns[25][1].date, "2026-10-06");
  assert.strictEqual(heat.columns[25][6].date, "2026-10-11");
  assert.strictEqual(heat.columns[25][6].count, 0);

  var heavy = {
    sessions: {
      "2026-10-01": { lifts: { pullup: [{ kg: 10, reps: 5 }] } },
      "2026-10-05": { lifts: { pullup: [{ kg: 20, reps: 5 }] } }
    }
  };
  var heavyPrs = Street.prs(heavy);
  var sawE1 = false;
  var sawKg = false;
  var pi;
  for (pi = 0; pi < heavyPrs.length; pi++) {
    if (heavyPrs[pi].date === "2026-10-05" && heavyPrs[pi].kind === "e1rm") sawE1 = true;
    if (heavyPrs[pi].date === "2026-10-05" && heavyPrs[pi].kind === "weight") sawKg = true;
  }
  assert.ok(sawE1);
  assert.ok(sawKg);
  assert.strictEqual(Street.latestDayPrs(heavy)[0].date, "2026-10-05");

  var hist = Street.series({
    sessions: {
      "2026-01-01": { lifts: { pullup: [{ kg: 50, reps: 1 }] } },
      "2026-10-05": { lifts: { pullup: [{ kg: 20, reps: 1 }] } }
    }
  }, "pullup", "1m", "2026-10-06");
  assert.strictEqual(hist.length, 1);
  assert.strictEqual(hist[0].date, "2026-10-05");
  assert.strictEqual(hist[0].pr, false);

  var rising = {
    goals: [{ id: "g1", lift: "pullup", target: 40, reps: 1, note: "up" }],
    sessions: {
      "2026-09-28": { lifts: { pullup: [{ kg: 10, reps: 1 }] } },
      "2026-10-05": { lifts: { pullup: [{ kg: 20, reps: 1 }] } }
    }
  };
  var cards = Street.goalCards(rising, "2026-10-06");
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].current, 20);
  assert.strictEqual(cards[0].hit, false);
  assert.strictEqual(cards[0].stalled, false);
  assert.strictEqual(cards[0].eta, "2026-10-19");

  var flat = {
    goals: [{ id: "g2", lift: "pullup", target: 40, reps: 1, note: "flat" }],
    sessions: {
      "2026-09-28": { lifts: { pullup: [{ kg: 20, reps: 1 }] } },
      "2026-10-05": { lifts: { pullup: [{ kg: 20, reps: 1 }] } }
    }
  };
  var flatCards = Street.goalCards(flat, "2026-10-06");
  assert.strictEqual(flatCards[0].stalled, true);
  assert.strictEqual(flatCards[0].eta, null);

  var partial = {
    sessions: {
      "2026-10-05": {
        lifts: {
          pullup: [{ kg: 10, reps: 5 }],
          dip: [{ kg: 10, reps: 5 }]
        }
      }
    }
  };
  var tot = Street.totalSeries(partial, "all", "2026-10-06");
  assert.ok(tot.missing.indexOf("muscleup") !== -1);
  assert.ok(tot.missing.indexOf("squat") !== -1);
  assert.strictEqual(tot.missing.indexOf("pullup"), -1);
  assert.strictEqual(tot.points.length, 0);

  var rel = Street.relativeSeries({
    sessions: {
      "2026-10-01": { bw: 80, lifts: { pullup: [{ kg: 20, reps: 1 }] } },
      "2026-10-03": { lifts: { dip: [{ kg: 10, reps: 1 }] } }
    }
  }, {
    days: {
      "2026-09-30": { weight: 79 },
      "2026-10-02": { weight: 81 }
    }
  }, "all", "2026-10-06");
  assert.strictEqual(rel.points.length, 2);
  assert.strictEqual(rel.points[0].bw, 80);
  assert.strictEqual(rel.points[0].rel.pullup, 1.25);
  assert.strictEqual(rel.points[0].rel.dip, null);
  assert.strictEqual(rel.points[1].bw, 81);
  assert.ok(Math.abs(rel.points[1].rel.pullup - (81 + 20) / 81) < 1e-9);
  assert.ok(Math.abs(rel.points[1].rel.dip - (81 + 10) / 81) < 1e-9);

  assert.deepStrictEqual(Street.liftsIn({
    sessions: {
      "2026-10-05": {
        lifts: {
          "front-lever": [{ kg: 0, reps: 5 }],
          squat: [{ kg: 20, reps: 5, warmup: true }],
          dip: [{ kg: 10, reps: 3 }]
        }
      }
    }
  }), ["dip", "squat", "front-lever"]);

  assert.strictEqual(Street.currentWeekCoach({
    weeks: { "2026-W41": { coach: "Steady week." } }
  }, "2026-10-06"), "Steady week.");
  assert.strictEqual(Street.monthCount({
    sessions: { "2026-10-05": {}, "2026-09-28": {} }
  }, "2026-10-06"), 1);
  assert.strictEqual(Street.label("front-lever"), "Front Lever");
  assert.strictEqual(Street.label("pullup"), "Pull-up");

  var rm = Street.repMaxes({
    sessions: {
      "2026-10-01": {
        lifts: {
          squat: [
            { kg: 200, reps: 1, warmup: true },
            { kg: 100, reps: 3 }
          ]
        }
      },
      "2026-10-08": {
        lifts: { squat: [{ kg: 90, reps: 8 }] }
      }
    }
  }, "squat");
  assert.strictEqual(rm.length, 10);
  assert.strictEqual(rm[0].reps, 1);
  assert.strictEqual(rm[0].kg, 100);
  assert.strictEqual(rm[0].date, "2026-10-01");
  assert.strictEqual(rm[1].kg, 100);
  assert.strictEqual(rm[2].kg, 100);
  assert.strictEqual(rm[3].reps, 4);
  assert.strictEqual(rm[3].kg, 90);
  assert.strictEqual(rm[3].date, "2026-10-08");
  assert.strictEqual(rm[4].kg, 90);
  assert.strictEqual(rm[5].kg, 90);
  assert.strictEqual(rm[6].kg, 90);
  assert.strictEqual(rm[7].reps, 8);
  assert.strictEqual(rm[7].kg, 90);
  assert.strictEqual(rm[8].reps, 9);
  assert.strictEqual(rm[8].kg, null);
  assert.strictEqual(rm[8].date, null);
  assert.strictEqual(rm[9].reps, 10);
  assert.strictEqual(rm[9].kg, null);
  assert.strictEqual(rm[9].date, null);

  var progView = Street.programView({
    programs: {
      pullup: {
        name: "Base",
        note: "easy",
        start: "2026-10-01",
        days: [
          { label: "A", sets: [{ sets: 3, reps: 10, kg: 27.5 }], done: "2026-10-01" },
          { label: "B", sets: [{ sets: 3, reps: 8, kg: 30 }] }
        ]
      }
    }
  }, "pullup");
  assert.strictEqual(progView.doneCount, 1);
  assert.strictEqual(progView.total, 2);
  assert.strictEqual(progView.days[0].status, "done");
  assert.strictEqual(progView.days[1].status, "next");
  assert.strictEqual(Street.programView({ programs: {} }, "squat"), null);
  assert.strictEqual(Street.programView({ programs: { dip: { days: [] } } }, "dip"), null);

  assert.strictEqual(Street.sessionKcal({
    liftKcal: 100,
    activities: [{ type: "run", kcal: 50 }]
  }), 150);
  assert.strictEqual(Street.sessionKcal({ lifts: { pullup: [{ kg: 20, reps: 5 }] } }), null);
  assert.strictEqual(Street.sessionKcal({ liftKcal: 0 }), 0);

  var kcalWeeks = Street.weeklyKcal({
    sessions: {
      "2026-10-05": {
        liftKcal: 300,
        activities: [{ type: "run", min: 30, km: 5, kcal: 250 }]
      },
      "2026-09-30": {
        activities: [{ type: "ride", kcal: 100 }]
      }
    }
  }, "2026-10-06", 12);
  assert.strictEqual(kcalWeeks.length, 12);
  assert.strictEqual(kcalWeeks[0].total, 0);
  assert.strictEqual(kcalWeeks[11].week, "2026-W41");
  assert.strictEqual(kcalWeeks[11].parts.strength, 300);
  assert.strictEqual(kcalWeeks[11].parts.run, 250);
  assert.strictEqual(kcalWeeks[11].total, 550);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(kcalWeeks[11].parts, "ride"), false);
  assert.strictEqual(kcalWeeks[10].week, "2026-W40");
  assert.strictEqual(kcalWeeks[10].parts.ride, 100);
  assert.strictEqual(kcalWeeks[10].total, 100);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(kcalWeeks[10].parts, "strength"), false);
  assert.strictEqual(Street.weeklyKcal({ sessions: {} }, "2026-10-06").length, 12);

  var cardioHeat = Street.heatmap({
    sessions: {
      "2026-10-05": { activities: [{ type: "run", kcal: 10 }] }
    }
  }, "2026-10-06");
  assert.strictEqual(cardioHeat.columns[25][0].date, "2026-10-05");
  assert.strictEqual(cardioHeat.columns[25][0].count, 1);

  assert.deepStrictEqual(Street.activityTypes({
    sessions: {
      "2026-10-05": {
        activities: [
          { type: "yoga" },
          { type: "hike" },
          { type: "swim" },
          { type: "run" }
        ]
      },
      "2026-10-06": {
        activities: [{ type: "ski-erg" }, { type: "ride" }]
      }
    }
  }), ["run", "ride", "swim", "hike", "ski-erg", "yoga"]);

  var band = Street.repMaxes({
    sessions: {
      "2026-09-01": {
        lifts: { pullup: [{ kg: 80, reps: 8 }] }
      },
      "2026-10-01": {
        lifts: {
          pullup: [
            { kg: 200, reps: 10, warmup: true },
            { kg: 100, reps: 5 }
          ]
        }
      }
    }
  }, "pullup");
  assert.strictEqual(band.length, 10);
  var bi;
  for (bi = 0; bi < 5; bi++) {
    assert.strictEqual(band[bi].reps, bi + 1);
    assert.strictEqual(band[bi].kg, 100);
    assert.strictEqual(band[bi].date, "2026-10-01");
  }
  for (bi = 5; bi < 8; bi++) {
    assert.strictEqual(band[bi].reps, bi + 1);
    assert.strictEqual(band[bi].kg, 80);
    assert.strictEqual(band[bi].date, "2026-09-01");
  }
  assert.strictEqual(band[8].reps, 9);
  assert.strictEqual(band[8].kg, null);
  assert.strictEqual(band[8].date, null);
  assert.strictEqual(band[9].reps, 10);
  assert.strictEqual(band[9].kg, null);
  assert.strictEqual(band[9].date, null);

  var progPlain = Street.programView({
    programs: {
      squat: {
        days: [
          { label: "A", sets: [{ kg: 80, reps: 5 }], done: "logged" },
          { label: "B", sets: [{ kg: 85, reps: 5 }] }
        ]
      }
    }
  }, "squat");
  assert.strictEqual(progPlain.days[0].status, "done");
  assert.strictEqual(progPlain.days[1].status, "next");
  assert.strictEqual(progPlain.doneCount, 1);
  assert.strictEqual(progPlain.total, 2);
  assert.strictEqual(progPlain.name, "");
  assert.strictEqual(progPlain.note, "");
  assert.strictEqual(progPlain.start, "");
  assert.strictEqual(Street.programView({ sessions: {} }, "squat"), null);

  assert.strictEqual(Street.sessionKcal({
    liftKcal: 100,
    activities: [{ type: "run", kcal: 50 }]
  }), 150);
  assert.strictEqual(Street.sessionKcal({ note: "empty" }), null);

  assert.strictEqual(Street.weeklyKcal({ sessions: {} }, "2026-10-06", 4).length, 4);

  var runOnly = Street.heatmap({
    sessions: {
      "2026-10-05": { activities: [{ type: "run", kcal: 10 }] }
    }
  }, "2026-10-06");
  assert.strictEqual(runOnly.columns[25][0].date, "2026-10-05");
  assert.strictEqual(runOnly.columns[25][0].count, 1);

  var liftAndRun = Street.heatmap({
    sessions: {
      "2026-10-06": {
        lifts: { dip: [{ kg: 20, reps: 5 }, { kg: 22, reps: 3 }] },
        activities: [{ type: "run", kcal: 10 }]
      }
    }
  }, "2026-10-06");
  assert.strictEqual(liftAndRun.columns[25][1].date, "2026-10-06");
  assert.strictEqual(liftAndRun.columns[25][1].count, 2);

  console.log("streetlifting core checks passed");
}
