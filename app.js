/* Read-only streetlifting dashboard. GitHub loads replace the in-memory file. */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var RANGES = ["1m", "3m", "1y", "all"];
  var WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var mainBoot = document.getElementById("main");
  if (!window.Street) {
    var heroBoot = document.getElementById("hero");
    if (heroBoot) heroBoot.hidden = true;
    if (mainBoot) mainBoot.textContent = "Streetlifting core failed to load.";
    return;
  }

  var els = {
    sync: document.getElementById("sync-label"),
    hero: document.getElementById("hero"),
    main: mainBoot,
    connect: document.getElementById("connect"),
    connectBtn: document.getElementById("btn-connect")
  };

  var file = { sessions: {}, goals: [], weeks: {} };
  var nutrition = null;
  var chartLift = "";
  var chartRange = "3m";
  var sessionChip = "all";
  var openDates = {};
  var loading = false;

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function hhmm() {
    var now = new Date();
    return pad2(now.getHours()) + ":" + pad2(now.getMinutes());
  }

  function hasToken() {
    try {
      var cfg = JSON.parse(localStorage.getItem("dong-gh-sync") || "null");
      return !!(cfg && cfg.token);
    } catch (e) {
      return false;
    }
  }

  function showConnect() {
    if (els.connect) els.connect.hidden = hasToken();
  }

  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function button(className, text) {
    var el = node("button", className, text);
    el.type = "button";
    return el;
  }

  function svgEl(tag) {
    return document.createElementNS(SVGNS, tag);
  }

  function card(title) {
    var section = node("section", "card");
    if (title) section.appendChild(node("h3", "", title));
    return section;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function comps() {
    if (Street.COMP && Street.COMP.length) return Street.COMP.slice();
    return ["pullup", "dip", "muscleup", "squat"];
  }

  function label(slug) {
    try {
      var name = Street.label(slug);
      if (name) return String(name);
    } catch (e) {}
    return String(slug == null ? "" : slug);
  }

  function fmtKg(n) {
    var v = Number(n);
    var rounded;
    if (!isFinite(v)) return "\u2014";
    rounded = Math.round(v * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 1e-6) return String(Math.round(rounded));
    return rounded.toFixed(1);
  }

  function fmtE1(n) {
    var v = Number(n);
    if (!isFinite(v)) return "\u2014";
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  function fmtReps(n) {
    var v = Number(n);
    if (!isFinite(v)) return "\u2014";
    return String(Math.round(v));
  }

  function fmtRel(n) {
    var v;
    if (n == null || n === "") return "\u2014";
    v = Number(n);
    if (!isFinite(v)) return "\u2014";
    return v.toFixed(2) + "x";
  }

  function countText(v) {
    var n = Number(v);
    if (v == null || v === "" || !isFinite(n)) return "\u2014";
    if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function shortDate(iso, withYear) {
    var text = String(iso || "");
    var m = parseInt(text.slice(5, 7), 10);
    var d = parseInt(text.slice(8, 10), 10);
    if (!m || !d || m < 1 || m > 12) return text;
    return d + " " + MONTHS[m - 1] + (withYear ? " " + text.slice(0, 4) : "");
  }

  function kindName(kind) {
    var k = String(kind || "").toLowerCase().replace(/[\s_-]/g, "");
    if (k === "e1rm") return "e1RM";
    if (k === "heaviest" || k === "weight" || k === "kg" || k === "load") return "heaviest";
    if (k === "reps" || k === "rep") return "reps";
    return String(kind || "");
  }

  function prValueText(item) {
    var name = kindName(item && item.kind);
    var n = item && item.value != null ? item.value : null;
    if (n == null && item && name === "heaviest") n = item.kg;
    if (n == null && item && name === "reps") n = item.reps;
    if (n == null && item && name === "e1RM") n = item.e1rm;
    if (name === "e1RM") return fmtE1(n);
    if (name === "reps") return fmtReps(n);
    return fmtKg(n);
  }

  function currentRange() {
    var i;
    for (i = 0; i < RANGES.length; i++) {
      if (RANGES[i] === chartRange) return chartRange;
    }
    return "3m";
  }

  function sessionsObj() {
    if (file && file.sessions && typeof file.sessions === "object") return file.sessions;
    return {};
  }

  function sessionDates() {
    return Object.keys(sessionsObj()).filter(function (key) {
      return /^\d{4}-\d{2}-\d{2}$/.test(key);
    }).sort(function (a, b) {
      if (a < b) return 1;
      if (a > b) return -1;
      return 0;
    });
  }

  function orderedLifts(lifts) {
    var seen = {};
    var out = [];
    comps().forEach(function (slug) {
      if (lifts && Object.prototype.hasOwnProperty.call(lifts, slug)) {
        seen[slug] = true;
        out.push(slug);
      }
    });
    if (lifts && typeof lifts === "object") {
      Object.keys(lifts).sort().forEach(function (slug) {
        if (!seen[slug]) out.push(slug);
      });
    }
    return out;
  }

  function liftReset(slug) {
    if (!Street.prReset) return null;
    try {
      return Street.prReset(file, slug);
    } catch (e) {
      return null;
    }
  }

  function isPartial(slug, date) {
    var reset = liftReset(slug);
    if (!reset || !reset.from || !date) return false;
    return String(date) < String(reset.from);
  }

  function topWorking(sets) {
    var best = null;
    var bestScore = -1;
    if (!Array.isArray(sets) || typeof Street.e1rm !== "function") return null;
    sets.forEach(function (set) {
      var score;
      if (!set || set.warmup) return;
      if (typeof set.kg !== "number" || !isFinite(set.kg)) return;
      if (typeof set.reps !== "number" || !isFinite(set.reps)) return;
      score = Street.e1rm(set.kg, set.reps);
      if (typeof score !== "number" || !isFinite(score) || !(score > bestScore)) return;
      bestScore = score;
      best = set;
    });
    return best;
  }

  function barPct(goal) {
    var n;
    if (goal && goal.hit) return 100;
    n = Number(goal && goal.pct);
    if (!isFinite(n) || n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function goalStatus(goal) {
    if (!goal) return "";
    if (goal.hit) return "Hit";
    if (goal.stalled) return "Stalled";
    if (typeof goal.eta === "string" && goal.eta.trim()) return goal.eta.trim();
    if (typeof goal.eta === "number" && isFinite(goal.eta)) return String(goal.eta);
    return "";
  }

  function latestByDate(points) {
    var best = null;
    var bestKey = "";
    points.forEach(function (point) {
      var key;
      if (!point) return;
      key = point.date ? String(point.date) : "";
      if (!best || key >= bestKey) {
        best = point;
        bestKey = key;
      }
    });
    return best;
  }

  function dateNum(iso) {
    var text = String(iso || "");
    var y = parseInt(text.slice(0, 4), 10);
    var m = parseInt(text.slice(5, 7), 10);
    var d = parseInt(text.slice(8, 10), 10);
    if (!y || !m || !d) return null;
    return Date.UTC(y, m - 1, d);
  }

  function drawChart(points, aria, spark, format) {
    var sorted;
    var w = 320;
    var h = spark ? 46 : 128;
    var padX = 8;
    var padY = spark ? 6 : 14;
    var min;
    var max;
    var lo;
    var hi;
    var timed = true;
    var t0 = null;
    var t1 = null;
    var board;
    var wrap;
    var coords;
    var i;
    if (!points.length) return null;
    sorted = points.slice().sort(function (a, b) {
      var da = String(a.date || "");
      var db = String(b.date || "");
      if (da < db) return -1;
      if (da > db) return 1;
      return 0;
    });
    min = sorted[0].y;
    max = sorted[0].y;
    for (i = 0; i < sorted.length; i++) {
      var t = dateNum(sorted[i].date);
      if (sorted[i].y < min) min = sorted[i].y;
      if (sorted[i].y > max) max = sorted[i].y;
      if (t == null) timed = false;
      if (t0 == null || (t != null && t < t0)) t0 = t;
      if (t1 == null || (t != null && t > t1)) t1 = t;
    }
    if (!timed || t0 == null || t0 === t1) timed = false;
    lo = min;
    hi = max;
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }

    function xAt(idx) {
      if (sorted.length === 1) return w / 2;
      if (timed) return padX + ((dateNum(sorted[idx].date) - t0) / (t1 - t0)) * (w - padX * 2);
      return padX + (idx / (sorted.length - 1)) * (w - padX * 2);
    }

    function yAt(v) {
      return padY + (1 - (v - lo) / (hi - lo)) * (h - padY * 2);
    }

    board = svgEl("svg");
    board.setAttribute("viewBox", "0 0 " + w + " " + h);
    board.setAttribute("role", "img");
    board.setAttribute("aria-label", aria);
    coords = [];
    for (i = 0; i < sorted.length; i++) {
      coords.push(xAt(i).toFixed(1) + "," + yAt(sorted[i].y).toFixed(1));
    }
    if (sorted.length > 1) {
      var poly = svgEl("polyline");
      poly.setAttribute("class", "chart-line");
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "currentColor");
      poly.setAttribute("stroke-width", "2.5");
      poly.setAttribute("stroke-linejoin", "round");
      poly.setAttribute("stroke-linecap", "round");
      poly.setAttribute("points", coords.join(" "));
      board.appendChild(poly);
    }
    for (i = 0; i < sorted.length; i++) {
      var mark = sorted.length === 1 || sorted[i].pr;
      var dot;
      var title;
      if (!mark) continue;
      dot = svgEl("circle");
      dot.setAttribute("class", sorted[i].pr ? "chart-pr" : "chart-dot");
      dot.setAttribute("cx", xAt(i).toFixed(1));
      dot.setAttribute("cy", yAt(sorted[i].y).toFixed(1));
      dot.setAttribute("r", sorted[i].pr ? "4" : "3.5");
      dot.setAttribute("fill", "currentColor");
      title = svgEl("title");
      title.textContent = String(sorted[i].date || "") + " " + (format ? format(sorted[i].y) : String(sorted[i].y)) + (sorted[i].partial ? " partial" : "");
      dot.appendChild(title);
      board.appendChild(dot);
    }
    wrap = node("div", spark ? "chart spark" : "chart");
    wrap.appendChild(board);
    return { wrap: wrap, min: min, max: max, first: sorted[0].date, last: sorted[sorted.length - 1].date };
  }

  function axisLine(drawn, format) {
    var years = String(drawn.first || "").slice(0, 4) !== String(drawn.last || "").slice(0, 4);
    var line = node("p", "axis");
    line.appendChild(node("span", "", shortDate(drawn.first, years)));
    line.appendChild(node("span", "", format(drawn.min) + " - " + format(drawn.max)));
    line.appendChild(node("span", "", shortDate(drawn.last, years)));
    return line;
  }

  function makeTabs(labels, current, onPick) {
    var row = node("div", "toggle");
    labels.forEach(function (item) {
      var value = typeof item === "string" ? item : item.value;
      var text = typeof item === "string" ? item : item.text;
      var tab = button(value === current ? "on" : "", text);
      tab.setAttribute("aria-pressed", value === current ? "true" : "false");
      tab.addEventListener("click", function () {
        onPick(value);
      });
      row.appendChild(tab);
    });
    return row;
  }

  function activeLifts() {
    var found = [];
    try {
      found = asArray(Street.liftsIn(file)).filter(function (slug) {
        return !!slug;
      });
    } catch (e) {
      found = [];
    }
    if (!found.length) return comps();
    return found;
  }

  function selectedLift(lifts) {
    var i;
    for (i = 0; i < lifts.length; i++) {
      if (lifts[i] === chartLift) return chartLift;
    }
    return lifts[0];
  }

  function programSetText(set) {
    var kg;
    var kgMax;
    var load;
    var setsText;
    var repsText;
    if (!set || typeof set !== "object") return "";
    kg = typeof set.kg === "number" && isFinite(set.kg) ? set.kg : null;
    kgMax = typeof set.kgMax === "number" && isFinite(set.kgMax) ? set.kgMax : null;
    if (kg !== null && kgMax !== null && kgMax !== kg) load = fmtKg(kg) + "-" + fmtKg(kgMax) + " kg";
    else if (kg !== null) load = fmtKg(kg) + " kg";
    else load = "\u2014";
    setsText = typeof set.sets === "number" && isFinite(set.sets) ? fmtKg(set.sets) : "\u2014";
    repsText = typeof set.reps === "number" && isFinite(set.reps) ? fmtKg(set.reps) : "\u2014";
    return setsText + " x " + repsText + " @ " + load;
  }

  function paintPrograms() {
    var order = ["pullup", "squat"];
    var i;
    var view;
    if (typeof Street.programView !== "function") return;
    for (i = 0; i < order.length; i++) {
      view = null;
      try {
        view = Street.programView(file, order[i]);
      } catch (err) {
        view = null;
      }
      if (!view || !view.days || !view.days.length) continue;
      els.main.appendChild(programCard(view, order[i]));
    }
  }

  function programCard(view, lift) {
    var doneCount = Number(view.doneCount);
    var total = Number(view.total);
    var pct;
    var name = view.name && String(view.name).trim() ? String(view.name).trim() : label(lift);
    var section = node("section", "card program");
    var bar;
    var fill;
    var meta;
    var list;
    var d;
    var day;
    var dayEl;
    var head;
    var sets;
    var s;
    var finished = true;
    if (!isFinite(doneCount) || doneCount < 0) doneCount = 0;
    if (!isFinite(total) || total < 0) total = view.days.length;
    pct = total ? (doneCount / total) * 100 : 0;
    if (!isFinite(pct) || pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    section.setAttribute("aria-label", name);
    section.appendChild(node("h3", "", name));
    if (typeof view.note === "string" && view.note.trim()) {
      section.appendChild(node("p", "goal-note", view.note.trim()));
    }
    bar = node("div", "bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    bar.setAttribute("aria-label", name + " progress");
    fill = document.createElement("i");
    fill.style.width = (Math.round(pct * 10) / 10) + "%";
    bar.appendChild(fill);
    section.appendChild(bar);
    meta = node("p", "goal-meta");
    meta.appendChild(node("span", "", String(doneCount) + " / " + String(total)));
    section.appendChild(meta);
    list = node("div", "prog-days");
    for (d = 0; d < view.days.length; d++) {
      day = view.days[d];
      if (!day || (day.status !== "done" && day.status !== "next")) continue;
      if (day.status === "next") finished = false;
      dayEl = node("div", "prog-day" + (day.status === "next" ? " is-next" : day.status === "upcoming" ? " is-upcoming" : " is-done"));
      if (day.status === "next") dayEl.setAttribute("aria-current", "step");
      head = node("p", "prog-label");
      head.appendChild(document.createTextNode(day.label ? String(day.label) : "Day " + (d + 1)));
      if (day.status === "next") head.appendChild(node("span", "tag", "Next"));
      dayEl.appendChild(head);
      if (day.status === "done" && day.done) dayEl.appendChild(node("p", "prog-when", String(day.done)));
      if (day.status === "next") {
        sets = Array.isArray(day.sets) ? day.sets : [];
        for (s = 0; s < sets.length; s++) {
          if (!sets[s] || typeof sets[s] !== "object") continue;
          dayEl.appendChild(node("p", "set-line", programSetText(sets[s])));
        }
      }
      list.appendChild(dayEl);
    }
    section.appendChild(list);
    if (finished) section.appendChild(node("p", "prog-finished", "Program finished."));
    return section;
  }

  function repBlock(lift, today) {
    var wrap = node("div", "rm-block");
    var grid = node("div", "rm-grid");
    var rows = [];
    var i;
    var row;
    var cell;
    var kgText;
    wrap.appendChild(node("h4", "subhead", "Best for reps"));
    try {
      rows = asArray(Street.repMaxes(file, lift));
    } catch (err) {
      rows = [];
    }
    for (i = 0; i < 10; i++) {
      row = rows[i] || {};
      cell = node("div", "rm-cell");
      cell.appendChild(node("span", "rm-name", String(row.reps || (i + 1)) + "RM"));
      if (typeof row.kg === "number" && isFinite(row.kg)) kgText = fmtKg(row.kg) + " kg";
      else kgText = "\u2014";
      cell.appendChild(node("span", "rm-kg", kgText));
      if (row.date) {
        cell.appendChild(node("span", "rm-date", shortDate(row.date, String(row.date).slice(0, 4) !== String(today).slice(0, 4))));
      }
      if (row.note) cell.appendChild(node("span", "rm-date", String(row.note)));
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  var KCAL_FIXED = {
    strength: "#4682b4",
    run: "#0d9488",
    ride: "#d97706",
    swim: "#16a34a",
    walk: "#7c3aed",
    row: "#0284c7",
    hike: "#65a30d"
  };
  var KCAL_EXTRA = ["#db2777", "#ea580c", "#4f46e5", "#0f766e", "#c026d3", "#b45309"];

  function kcalColors(keys) {
    var map = {};
    var extra = 0;
    var i;
    var key;
    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      if (KCAL_FIXED[key]) map[key] = KCAL_FIXED[key];
      else {
        map[key] = KCAL_EXTRA[extra % KCAL_EXTRA.length];
        extra += 1;
      }
    }
    return map;
  }

  function weekTotal(week) {
    var parts = week && week.parts;
    var keys;
    var i;
    var v;
    var n = 0;
    var any = false;
    if (parts && typeof parts === "object") {
      keys = Object.keys(parts);
      for (i = 0; i < keys.length; i++) {
        v = parts[keys[i]];
        if (typeof v === "number" && isFinite(v)) {
          n += v;
          any = true;
        }
      }
    }
    if (any) return n;
    if (week && typeof week.total === "number" && isFinite(week.total)) return week.total;
    return 0;
  }

  function kcalName(key) {
    if (key === "strength") return "Strength";
    return label(key);
  }

  function kcalSegments(weeks) {
    var canon = ["run", "ride", "swim", "walk", "row", "hike"];
    var has = {};
    var extras = [];
    var out = [];
    var i;
    var k;
    var parts;
    var keys;
    for (i = 0; i < weeks.length; i++) {
      parts = weeks[i] && weeks[i].parts;
      if (!parts || typeof parts !== "object") continue;
      keys = Object.keys(parts);
      for (k = 0; k < keys.length; k++) {
        if (parts[keys[k]]) has[keys[k]] = true;
      }
    }
    if (has.strength) out.push("strength");
    for (i = 0; i < canon.length; i++) {
      if (has[canon[i]]) out.push(canon[i]);
    }
    keys = Object.keys(has);
    keys.sort();
    for (i = 0; i < keys.length; i++) {
      if (keys[i] === "strength") continue;
      if (canon.indexOf(keys[i]) !== -1) continue;
      extras.push(keys[i]);
    }
    for (i = 0; i < extras.length; i++) out.push(extras[i]);
    return out;
  }

  function sumPart(weeks, key) {
    var n = 0;
    var i;
    var parts;
    var v;
    for (i = 0; i < weeks.length; i++) {
      parts = weeks[i] && weeks[i].parts;
      if (!parts) continue;
      v = parts[key];
      if (typeof v === "number" && isFinite(v)) n += v;
    }
    return n;
  }

  function weekTick(key) {
    var text = String(key || "");
    var m = /-W(\d+)$/.exec(text);
    if (!m) return "";
    return "W" + String(Number(m[1]));
  }

  function kcalChart(weeks, keys, max, colors) {
    var w = 360;
    var h = 148;
    var padX = 4;
    var padT = 6;
    var padB = 16;
    var n = weeks.length;
    var gap = n > 1 ? 3 : 0;
    var barW = n ? (w - padX * 2 - gap * (n - 1)) / n : 0;
    var plotH = h - padT - padB;
    var plotBottom = h - padB;
    var board = svgEl("svg");
    var wrap = node("div", "kcal-chart");
    var baseline;
    var i;
    var k;
    var x;
    var y;
    var val;
    var bh;
    var g;
    var hit;
    var rect;
    var title;
    var text;
    var parts;
    var week;
    var total;
    if (!(barW > 0)) barW = 0;
    board.setAttribute("viewBox", "0 0 " + w + " " + h);
    board.setAttribute("role", "img");
    board.setAttribute("aria-label", "Weekly calories");
    baseline = svgEl("line");
    baseline.setAttribute("class", "kcal-base");
    baseline.setAttribute("x1", String(padX));
    baseline.setAttribute("x2", String(w - padX));
    baseline.setAttribute("y1", String(plotBottom));
    baseline.setAttribute("y2", String(plotBottom));
    board.appendChild(baseline);
    for (i = 0; i < n; i++) {
      x = padX + i * (barW + gap);
      y = plotBottom;
      week = weeks[i] || {};
      parts = week.parts && typeof week.parts === "object" ? week.parts : {};
      total = weekTotal(week);
      g = svgEl("g");
      hit = svgEl("rect");
      hit.setAttribute("x", x.toFixed(2));
      hit.setAttribute("y", String(padT));
      hit.setAttribute("width", barW.toFixed(2));
      hit.setAttribute("height", String(plotH));
      hit.setAttribute("fill", "transparent");
      g.appendChild(hit);
      title = svgEl("title");
      title.textContent = String(week.week || "") + ", " + fmtKg(total) + " kcal";
      g.appendChild(title);
      for (k = 0; k < keys.length; k++) {
        val = Number(parts[keys[k]]);
        if (!isFinite(val) || val <= 0 || !(max > 0)) continue;
        bh = (val / max) * plotH;
        y -= bh;
        rect = svgEl("rect");
        rect.setAttribute("x", x.toFixed(2));
        rect.setAttribute("y", y.toFixed(2));
        rect.setAttribute("width", barW.toFixed(2));
        rect.setAttribute("height", bh.toFixed(2));
        rect.setAttribute("fill", colors[keys[k]] || "#6d8499");
        g.appendChild(rect);
      }
      board.appendChild(g);
      text = svgEl("text");
      text.setAttribute("class", "kcal-tick");
      text.setAttribute("x", (x + barW / 2).toFixed(2));
      text.setAttribute("y", String(h - 3));
      text.setAttribute("text-anchor", "middle");
      text.textContent = weekTick(week.week);
      board.appendChild(text);
    }
    wrap.appendChild(board);
    return wrap;
  }

  function kcalLegend(weeks, keys, colors) {
    var list = node("ul", "kcal-legend");
    var i;
    var item;
    var swatch;
    for (i = 0; i < keys.length; i++) {
      item = node("li", "");
      swatch = node("span", "kcal-swatch");
      swatch.style.background = colors[keys[i]] || "#6d8499";
      swatch.setAttribute("aria-hidden", "true");
      item.appendChild(swatch);
      item.appendChild(node("span", "", kcalName(keys[i])));
      item.appendChild(node("b", "", fmtKg(sumPart(weeks, keys[i]))));
      list.appendChild(item);
    }
    return list;
  }

  function paintCalories(today) {
    var section = card("Calories");
    var weeks = [];
    var allZero = true;
    var i;
    var keys;
    var colors;
    var max = 0;
    var last;
    var total;
    if (typeof Street.weeklyKcal !== "function") return;
    try {
      weeks = asArray(Street.weeklyKcal(file, today, 12));
    } catch (err) {
      weeks = [];
    }
    for (i = 0; i < weeks.length; i++) {
      if (weekTotal(weeks[i]) !== 0) allZero = false;
    }
    if (!weeks.length || allZero) {
      section.appendChild(node("p", "empty-line", "No calories yet"));
      els.main.appendChild(section);
      return;
    }
    keys = kcalSegments(weeks);
    colors = kcalColors(keys);
    for (i = 0; i < weeks.length; i++) {
      total = weekTotal(weeks[i]);
      if (total > max) max = total;
    }
    if (max > 0) section.appendChild(kcalChart(weeks, keys, max, colors));
    last = weeks[weeks.length - 1];
    section.appendChild(node("p", "kcal-now", "This week " + fmtKg(weekTotal(last)) + " kcal"));
    if (keys.length) section.appendChild(kcalLegend(weeks, keys, colors));
    els.main.appendChild(section);
  }

  function chipKind(chip) {
    if (chip.indexOf("lift:") === 0) return "lift";
    if (chip.indexOf("act:") === 0) return "act";
    return "all";
  }

  function chipSlug(chip) {
    if (chip.indexOf("lift:") === 0) return chip.slice(5);
    if (chip.indexOf("act:") === 0) return chip.slice(4);
    return "";
  }

  function hasLiftObject(session, slug) {
    var lifts;
    var arr;
    var i;
    if (!session || !session.lifts || typeof session.lifts !== "object") return false;
    if (!Object.prototype.hasOwnProperty.call(session.lifts, slug)) return false;
    lifts = session.lifts;
    arr = lifts[slug];
    if (!Array.isArray(arr)) return false;
    for (i = 0; i < arr.length; i++) {
      if (arr[i] && typeof arr[i] === "object") return true;
    }
    return false;
  }

  function hasActivity(session, type) {
    var acts;
    var i;
    if (!session || !Array.isArray(session.activities)) return false;
    acts = session.activities;
    for (i = 0; i < acts.length; i++) {
      if (acts[i] && typeof acts[i] === "object" && acts[i].type === type) return true;
    }
    return false;
  }

  function sessionMatches(session, chip) {
    var kind = chipKind(chip);
    if (kind === "lift") return hasLiftObject(session, chipSlug(chip));
    if (kind === "act") return hasActivity(session, chipSlug(chip));
    return true;
  }

  function activityText(act) {
    var bits = [];
    var name;
    var km;
    var mins;
    var kcal;
    if (!act || typeof act !== "object") return "";
    name = label(act.type);
    km = typeof act.km === "number" && isFinite(act.km) ? act.km : null;
    mins = typeof act.min === "number" && isFinite(act.min) ? act.min : null;
    kcal = typeof act.kcal === "number" && isFinite(act.kcal) ? act.kcal : null;
    if (name) bits.push(name);
    if (km !== null) bits.push(fmtKg(km) + " km");
    if (mins !== null) bits.push(fmtKg(mins) + " min");
    if (kcal !== null) bits.push(fmtKg(kcal) + " kcal");
    return bits.join(" \u00b7 ");
  }

  function fallbackKcal(session) {
    var sum = null;
    var acts;
    var i;
    var c;
    if (!session || typeof session !== "object") return null;
    if (typeof session.liftKcal === "number" && isFinite(session.liftKcal)) sum = session.liftKcal;
    acts = session.activities;
    if (!Array.isArray(acts)) return sum;
    for (i = 0; i < acts.length; i++) {
      if (!acts[i] || typeof acts[i].kcal !== "number" || !isFinite(acts[i].kcal)) continue;
      c = acts[i].kcal;
      sum = sum === null ? c : sum + c;
    }
    return sum;
  }

  function sessionKcal(session) {
    var n;
    if (typeof Street.sessionKcal === "function") {
      try {
        n = Street.sessionKcal(session);
        if (n == null || (typeof n === "number" && isFinite(n))) return n;
      } catch (e0) {}
    }
    return fallbackKcal(session);
  }

  function activityToken(act) {
    var head;
    var km;
    var mins;
    if (!act || typeof act !== "object") return "";
    head = label(act.type);
    km = typeof act.km === "number" && isFinite(act.km) ? act.km : null;
    mins = typeof act.min === "number" && isFinite(act.min) ? act.min : null;
    if (km !== null) return (head ? head + " " : "") + fmtKg(km) + " km";
    if (mins !== null) return (head ? head + " " : "") + fmtKg(mins) + " min";
    return head;
  }

  function sessionChipOptions() {
    var opts = [{ value: "all", text: "All" }];
    var lifts = [];
    var acts = [];
    var i;
    try {
      lifts = asArray(Street.liftsIn(file));
    } catch (err) {
      lifts = [];
    }
    try {
      acts = asArray(Street.activityTypes(file));
    } catch (err2) {
      acts = [];
    }
    for (i = 0; i < lifts.length; i++) {
      if (!lifts[i]) continue;
      opts.push({ value: "lift:" + lifts[i], text: label(lifts[i]) });
    }
    for (i = 0; i < acts.length; i++) {
      if (!acts[i]) continue;
      opts.push({ value: "act:" + acts[i], text: label(acts[i]) });
    }
    return opts;
  }

  function selectedChip(opts) {
    var i;
    for (i = 0; i < opts.length; i++) {
      if (opts[i].value === sessionChip) return sessionChip;
    }
    return "all";
  }

  function paintHero(today) {
    var streak = Street.streak(file, today) || {};
    var month = Street.monthCount(file, today);
    var fresh = asArray(Street.latestDayPrs(file));
    var stats = node("div", "stats");
    els.hero.hidden = false;
    els.hero.textContent = "";
    [
      [countText(streak.weeks), "week streak"],
      [countText(month), "sessions this month"],
      [countText(streak.daysSince), "days since last session"]
    ].forEach(function (pair) {
      var stat = node("div", "stat");
      stat.appendChild(node("p", "stat-num", pair[0]));
      stat.appendChild(node("p", "stat-label", pair[1]));
      stats.appendChild(stat);
    });
    els.hero.appendChild(stats);
    if (!fresh.length) return;
    var banner = node("div", "pr-banner");
    var list = node("ul", "");
    banner.appendChild(node("p", "kicker", "New PR"));
    fresh.forEach(function (item) {
      if (!item) return;
      list.appendChild(node("li", "", label(item.lift) + " \u00b7 " + kindName(item.kind) + " " + prValueText(item)));
    });
    banner.appendChild(list);
    els.hero.appendChild(banner);
  }

  function paintGoals() {
    var goals = asArray(Street.goalCards(file, todayISO()));
    if (!goals.length) {
      els.main.appendChild(node("section", "card empty", "Tell Grok a goal."));
      return;
    }
    goals.forEach(function (goal) {
      var pct;
      var status;
      var section;
      var meta;
      var bar;
      var fill;
      if (!goal) return;
      pct = barPct(goal);
      status = goalStatus(goal);
      section = node("section", "card goal" + (goal.hit ? " is-hit" : goal.stalled ? " is-stalled" : ""));
      section.setAttribute("aria-label", "Goal");
      section.appendChild(node("h3", "", label(goal.lift)));
      section.appendChild(node("p", "goal-target", fmtKg(goal.target) + " kg x " + fmtReps(goal.reps)));
      bar = node("div", "bar");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(Math.round(pct)));
      bar.setAttribute("aria-label", label(goal.lift) + " progress");
      fill = document.createElement("i");
      fill.style.width = (Math.round(pct * 10) / 10) + "%";
      bar.appendChild(fill);
      section.appendChild(bar);
      meta = node("p", "goal-meta");
      meta.appendChild(node("span", "", (goal.current == null ? "\u2014" : fmtKg(goal.current)) + " / " + fmtKg(goal.target) + " kg"));
      if (status) {
        meta.appendChild(node("span", status === "Hit" ? "status-hit" : status === "Stalled" ? "status-stalled" : "", status));
      }
      section.appendChild(meta);
      if (typeof goal.note === "string" && goal.note.trim()) {
        section.appendChild(node("p", "goal-note", goal.note.trim()));
      }
      els.main.appendChild(section);
    });
  }

  function seriesPoints(lift, range, today) {
    var points = [];
    asArray(Street.series(file, lift, range, today)).forEach(function (row) {
      if (!row || typeof row.e1rm !== "number" || !isFinite(row.e1rm)) return;
      points.push({ date: row.date, y: row.e1rm, pr: !!row.pr, partial: !!row.partial });
    });
    return points;
  }

  function paintProgress(today) {
    var lifts = activeLifts();
    var lift = selectedLift(lifts);
    var range = currentRange();
    var section = card("Progress");
    var points;
    var drawn;
    section.appendChild(makeTabs(lifts.map(function (slug) {
      return { value: slug, text: label(slug) };
    }), lift, function (value) {
      chartLift = value;
      render();
    }));
    section.appendChild(makeTabs(RANGES, range, function (value) {
      chartRange = value;
      render();
    }));
    points = seriesPoints(lift, range, today);
    if (!points.length) {
      section.appendChild(node("p", "empty-line", "No sets yet."));
    } else {
      drawn = drawChart(points, label(lift) + " estimated 1RM, " + range, false, fmtE1);
      if (drawn) {
        section.appendChild(drawn.wrap);
        section.appendChild(axisLine(drawn, fmtE1));
      }
      if (points.some(function (point) { return point && point.partial; })) {
        var reset = liftReset(lift);
        var when = reset && reset.from ? shortDate(reset.from, true) : "";
        section.appendChild(node("p", "empty-line", "Before " + when + " is partial depth."));
      }
    }
    if (typeof Street.repMaxes === "function") section.appendChild(repBlock(lift, today));
    els.main.appendChild(section);
  }

  function paintStrength(today) {
    var range = currentRange();
    var section = card("Total and relative strength");
    var pack = Street.totalSeries(file, range, today) || {};
    var points = asArray(pack.points);
    var missing = {};
    var last = latestByDate(points);
    var parts = last && last.parts && typeof last.parts === "object" ? last.parts : {};
    var tiles = node("div", "tiles");
    var totalPoints = [];
    var drawn;
    var relPack;
    var relPoints;
    var latestRel;
    var relGrid;
    var sparkPoints;
    var spark;
    asArray(pack.missing).forEach(function (slug) {
      missing[slug] = true;
    });
    comps().forEach(function (slug) {
      var tile = node("div", "tile");
      var value = "\u2014";
      var best = null;
      var hist = asArray(Street.series(file, slug, "all", today));
      tile.appendChild(node("span", "tile-name", label(slug)));
      if (typeof Street.bestE1rm === "function") {
        try {
          best = Street.bestE1rm(file, slug);
        } catch (err) {
          best = null;
        }
        if (typeof best !== "number" || !isFinite(best)) best = null;
      }
      if (best === null) {
        if (last && !missing[slug] && parts[slug] != null && parts[slug] !== "" && isFinite(Number(parts[slug]))) {
          best = Number(parts[slug]);
        }
        hist.forEach(function (row) {
          if (!row || typeof row.e1rm !== "number" || !isFinite(row.e1rm)) return;
          if (best === null || row.e1rm > best) best = row.e1rm;
        });
      }
      if (best !== null) value = fmtKg(best);
      tile.appendChild(node("span", "tile-val", value));
      tiles.appendChild(tile);
    });
    section.appendChild(tiles);
    if (!points.length && asArray(pack.missing).length) {
      section.appendChild(node("p", "empty-line", "Total needs " + asArray(pack.missing).map(label).join(", ") + "."));
    }
    points.forEach(function (point) {
      if (!point || typeof point.total !== "number" || !isFinite(point.total)) return;
      totalPoints.push({ date: point.date, y: point.total, pr: false });
    });
    drawn = drawChart(totalPoints, "Streetlifting total, " + range, false, fmtKg);
    if (drawn) {
      section.appendChild(drawn.wrap);
      section.appendChild(axisLine(drawn, fmtKg));
    }
    relPack = Street.relativeSeries(file, nutrition && nutrition.days ? nutrition : null, range, today) || {};
    relPoints = asArray(relPack.points);
    if (!relPoints.length) {
      section.appendChild(node("p", "empty-line", "No bodyweight yet."));
      els.main.appendChild(section);
      return;
    }
    latestRel = latestByDate(relPoints) || {};
    section.appendChild(node("h4", "subhead", "Relative"));
    (function () {
      var bwLine = node("p", "bw-line");
      var bwText = latestRel.bw == null || latestRel.bw === "" ? "\u2014" : fmtKg(latestRel.bw) + " kg";
      bwLine.appendChild(node("span", "", "Bodyweight"));
      bwLine.appendChild(document.createTextNode(bwText));
      section.appendChild(bwLine);
    })();
    relGrid = node("div", "rels");
    comps().forEach(function (slug) {
      var rel = latestRel.rel && typeof latestRel.rel === "object" ? latestRel.rel[slug] : null;
      var est = null;
      var bw = latestRel.bw;
      var cell = node("div", "rel");
      if (typeof Street.bestE1rm === "function") {
        try {
          est = Street.bestE1rm(file, slug);
        } catch (err) {
          est = null;
        }
      }
      if (typeof est === "number" && isFinite(est) && typeof bw === "number" && isFinite(bw) && bw !== 0) {
        rel = (bw + est) / bw;
      }
      cell.appendChild(node("span", "rel-name", label(slug)));
      cell.appendChild(node("span", "rel-val", fmtRel(rel)));
      relGrid.appendChild(cell);
    });
    section.appendChild(relGrid);
    sparkPoints = [];
    relPoints.forEach(function (point) {
      if (!point || typeof point.bw !== "number" || !isFinite(point.bw)) return;
      sparkPoints.push({ date: point.date, y: point.bw, pr: false });
    });
    spark = drawChart(sparkPoints, "Bodyweight", true, fmtKg);
    if (spark) section.appendChild(spark.wrap);
    els.main.appendChild(section);
  }

  function heatLevel(count, max) {
    var n = Number(count);
    var level;
    if (!isFinite(n) || n <= 0 || !max) return 0;
    level = Math.ceil((n / max) * 4);
    if (level < 1) level = 1;
    if (level > 4) level = 4;
    return level;
  }

  function paintHeat(today) {
    var section = card("Heatmap");
    var pack = Street.heatmap(file, today) || {};
    var columns = asArray(pack.columns);
    var max = 0;
    var layout;
    var days;
    var scroller;
    var grid;
    if (!columns.length) {
      section.appendChild(node("p", "empty-line", "No sessions yet."));
      els.main.appendChild(section);
      return;
    }
    columns.forEach(function (col) {
      var cells = Array.isArray(col) ? col : [];
      var r;
      for (r = 0; r < cells.length && r < 7; r++) {
        var n = cells[r] && Number(cells[r].count);
        if (isFinite(n) && n > max) max = n;
      }
    });
    layout = node("div", "heat-layout");
    days = node("div", "heat-days");
    days.setAttribute("aria-hidden", "true");
    WEEKDAYS.forEach(function (name) {
      days.appendChild(node("span", "", name));
    });
    scroller = node("div", "heat-scroll");
    grid = node("div", "heat-grid");
    columns.forEach(function (col) {
      var cells = Array.isArray(col) ? col : [];
      var r;
      for (r = 0; r < 7; r++) {
        var cell = cells[r];
        var spot = node("span", "heat-cell");
        var count = cell && isFinite(Number(cell.count)) ? Number(cell.count) : 0;
        var date = cell && cell.date ? String(cell.date) : "";
        var labelText = date + ", " + count;
        spot.setAttribute("data-level", String(date ? heatLevel(count, max) : 0));
        if (date && date === today) spot.className += " is-today";
        if (date) {
          spot.setAttribute("role", "img");
          spot.setAttribute("aria-label", labelText);
          spot.title = labelText;
        } else {
          spot.setAttribute("aria-hidden", "true");
        }
        grid.appendChild(spot);
      }
    });
    scroller.appendChild(grid);
    layout.appendChild(days);
    layout.appendChild(scroller);
    section.appendChild(layout);
    els.main.appendChild(section);
  }

  function paintRecords() {
    var rows = asArray(Street.prs(file)).slice(0, 30);
    var section = card("Records");
    if (!rows.length) {
      section.appendChild(node("p", "empty-line", "No records yet."));
      els.main.appendChild(section);
      return;
    }
    rows.forEach(function (item) {
      var row;
      if (!item) return;
      row = node("div", "pr-row");
      row.appendChild(node("span", "pr-date", String(item.date || "")));
      row.appendChild(node("span", "pr-lift", label(item.lift)));
      row.appendChild(node("span", "pr-kind", kindName(item.kind)));
      row.appendChild(node("span", "pr-val", prValueText(item)));
      if (item.note) row.appendChild(node("span", "tag", String(item.note)));
      section.appendChild(row);
    });
    els.main.appendChild(section);
  }

  function paintCoach(today) {
    var text = Street.currentWeekCoach(file, today);
    var section;
    var prose;
    if (typeof text !== "string" || !text.trim()) return;
    section = card("This week");
    prose = node("p", "prose", text.trim());
    section.appendChild(prose);
    els.main.appendChild(section);
  }

  function paintSessions(today) {
    var dates = sessionDates();
    var section = card("Sessions");
    var opts = sessionChipOptions();
    var chip = selectedChip(opts);
    var bestCache = {};
    var shown = 0;
    var kind = chipKind(chip);
    var slug = chipSlug(chip);

    function bestFor(one, date) {
      if (!Object.prototype.hasOwnProperty.call(bestCache, one)) {
        var map = {};
        try {
          asArray(Street.series(file, one, "all", today)).forEach(function (row) {
            if (row && row.date) map[row.date] = row;
          });
        } catch (e) {}
        bestCache[one] = map;
      }
      return bestCache[one][date] || null;
    }

    if (!dates.length) {
      section.appendChild(node("p", "empty-line", "No sessions yet."));
      els.main.appendChild(section);
      return;
    }

    (function () {
      var row = node("div", "toggle");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Filter sessions");
      opts.forEach(function (item, idx) {
        var tab = button(item.value === chip ? "on" : "", item.text);
        tab.id = "sess-chip-" + idx;
        tab.setAttribute("aria-pressed", item.value === chip ? "true" : "false");
        tab.addEventListener("click", function () {
          sessionChip = item.value;
          render();
          var again = document.getElementById("sess-chip-" + idx);
          if (again && again.focus) again.focus();
        });
        row.appendChild(tab);
      });
      section.appendChild(row);
    })();

    dates.forEach(function (date) {
      var session = sessionsObj()[date] || {};
      var lifts = session.lifts && typeof session.lifts === "object" ? session.lifts : {};
      var slugs = orderedLifts(lifts);
      var bits = [];
      var block = node("div", "session");
      var toggle;
      var open = !!openDates[date];
      var detail;
      var showLifts = kind !== "act";
      var bw;
      var kcal;
      var acts;
      if (!sessionMatches(session, chip)) return;
      shown += 1;
      if (showLifts) {
        slugs.forEach(function (one) {
          var best = bestFor(one, date);
          var piece = label(one);
          var top;
          if (kind === "lift" && one !== slug) return;
          if (best && (best.kg != null || best.reps != null)) {
            piece += " " + fmtKg(best.kg) + " x " + fmtReps(best.reps);
          } else {
            top = topWorking(lifts[one]);
            if (top) piece += " " + fmtKg(top.kg) + " x " + fmtReps(top.reps);
          }
          if (isPartial(one, date) && piece !== label(one)) piece += " partial";
          bits.push(piece);
        });
      }
      if (kind !== "lift" && Array.isArray(session.activities)) {
        session.activities.forEach(function (act) {
          var token;
          if (!act || typeof act !== "object") return;
          if (kind === "act" && act.type !== slug) return;
          token = activityToken(act);
          if (token) bits.push(token);
        });
      }
      kcal = sessionKcal(session);
      if (typeof kcal === "number" && isFinite(kcal)) bits.push(Math.round(kcal) + " kcal");
      bw = session.bw;
      if (typeof bw === "number" && isFinite(bw)) bits.push(fmtKg(bw) + " kg");
      toggle = button("session-toggle", "");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) toggle.id = "sess-" + date;
      toggle.appendChild(node("span", "session-date", date));
      toggle.appendChild(node("span", "session-summary", bits.join(" \u00b7 ") || "No sets yet."));
      toggle.addEventListener("click", function () {
        if (openDates[date]) delete openDates[date];
        else openDates[date] = true;
        render();
        var again = document.getElementById("sess-" + date);
        if (again && again.focus) again.focus();
      });
      block.appendChild(toggle);
      if (open) {
        detail = node("div", "session-detail");
        if (typeof session.note === "string" && session.note.trim()) {
          detail.appendChild(node("p", "prose", session.note.trim()));
        }
        if (typeof session.coach === "string" && session.coach.trim()) {
          detail.appendChild(node("p", "prose", session.coach.trim()));
        }
        if (showLifts) {
          slugs.forEach(function (one) {
            var sets;
            if (kind === "lift" && one !== slug) return;
            sets = Array.isArray(lifts[one]) ? lifts[one] : [];
            (function () {
              var head = node("h4", "lift-name", label(one));
              if (isPartial(one, date)) head.appendChild(node("span", "tag", "partial"));
              detail.appendChild(head);
            })();
            if (!sets.length) {
              detail.appendChild(node("p", "set-line", "No sets yet."));
              return;
            }
            sets.forEach(function (set) {
              var line;
              if (!set || typeof set !== "object") return;
              line = node("p", "set-line");
              line.appendChild(node("span", "", fmtKg(set.kg) + " x " + fmtReps(set.reps)));
              if (set.warmup === true) line.appendChild(node("span", "tag", "warmup"));
              if (typeof set.rpe === "number" && isFinite(set.rpe)) {
                line.appendChild(node("span", "tag", "RPE " + fmtKg(set.rpe)));
              }
              detail.appendChild(line);
            });
          });
        }
        if (kind !== "lift") {
          acts = Array.isArray(session.activities) ? session.activities : [];
          acts.forEach(function (act) {
            var lineText;
            if (!act || typeof act !== "object") return;
            if (kind === "act" && act.type !== slug) return;
            lineText = activityText(act);
            if (lineText) detail.appendChild(node("p", "act-line", lineText));
            if (typeof act.note === "string" && act.note.trim()) {
              detail.appendChild(node("p", "act-note", act.note.trim()));
            }
          });
        }
        block.appendChild(detail);
      }
      section.appendChild(block);
    });
    if (!shown) section.appendChild(node("p", "empty-line", "No sessions yet."));
    els.main.appendChild(section);
  }

  function paint() {
    var today = todayISO();
    els.hero.textContent = "";
    els.main.textContent = "";
    paintHero(today);
    paintGoals();
    paintPrograms();
    paintProgress(today);
    paintStrength(today);
    paintCalories(today);
    paintHeat(today);
    paintRecords();
    paintCoach(today);
    paintSessions(today);
  }

  function render() {
    try {
      paint();
    } catch (err) {
      if (els.hero) {
        els.hero.textContent = "";
        els.hero.hidden = true;
      }
      if (els.main) els.main.textContent = err && err.message ? err.message : String(err);
    }
  }

  function apply(payload) {
    if (!payload || typeof payload !== "object") return;
    file = payload;
    render();
  }

  function applyNutrition(payload) {
    if (!payload || typeof payload !== "object" || !payload.days) return;
    nutrition = payload;
    render();
  }

  function loadNutrition() {
    if (!hasToken()) return Promise.resolve();
    return GhSync.load("nutrition", applyNutrition).then(function () {}, function () {});
  }

  function pull() {
    var street;
    if (loading) return;
    loading = true;
    if (els.sync) els.sync.textContent = "Syncing\u2026";
    try {
      street = GhSync.load("streetlifting", apply);
    } catch (err) {
      if (els.sync) els.sync.textContent = err && err.message ? err.message : String(err);
      loading = false;
      showConnect();
      return;
    }
    street.then(function () {
      if (els.sync) els.sync.textContent = "Synced " + hhmm();
    }, function (err) {
      if (els.sync) els.sync.textContent = err && err.message ? err.message : String(err);
    }).then(function () {
      return loadNutrition();
    }).then(function () {
      loading = false;
      showConnect();
    }, function () {
      loading = false;
      showConnect();
    });
  }

  function autoLoad() {
    showConnect();
    if (!hasToken()) {
      if (els.sync) els.sync.textContent = "Not synced";
      return;
    }
    if (loading) return;
    pull();
  }

  if (!window.GhSync || typeof GhSync.load !== "function") {
    if (els.sync) els.sync.textContent = "GitHub sync failed to load.";
    render();
    return;
  }

  if (els.connectBtn) {
    els.connectBtn.addEventListener("click", function () {
      if (!loading) pull();
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") autoLoad();
  });

  showConnect();
  render();
  setInterval(autoLoad, 60000);
  autoLoad();
})();
