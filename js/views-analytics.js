/* Streetlifting — analytics view (SVG charts, no chart libs). */
(function () {
  "use strict";

  window.SL = window.SL || {};
  window.SL.views = window.SL.views || {};

  var COMP_LIFTS = [
    { id: "pullup", label: "Pull-up" },
    { id: "dip", label: "Dip" },
    { id: "muscleup", label: "Muscle-up" },
    { id: "squat", label: "Squat" },
  ];

  var REL_LIFTS = [
    { id: "pullup", label: "Pull-up" },
    { id: "dip", label: "Dip" },
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function store() {
    return window.SL.store;
  }

  function unitLabel() {
    var s = store().get();
    return (s.settings && s.settings.unit) === "lb" ? "lb" : "kg";
  }

  function fromKg(kg) {
    var n = Number(kg) || 0;
    if (unitLabel() === "lb") return n * 2.2046226218;
    return n;
  }

  function fmt(n, digits) {
    if (n == null || !isFinite(n)) return "—";
    var d = digits == null ? 1 : digits;
    return Number(n).toFixed(d);
  }

  /** Epley on added belt load only — analytics never adds bodyweight into the total. */
  function e1rmAdded(loadKg, reps) {
    var load = Number(loadKg) || 0;
    var r = Number(reps) || 0;
    if (r <= 1) return load;
    return load * (1 + r / 30);
  }

  function bestAddedSet(exerciseId) {
    var hist = store().historyFor(exerciseId) || [];
    var best = null;
    for (var i = 0; i < hist.length; i++) {
      var row = hist[i];
      if (!row) continue;
      var e = e1rmAdded(row.loadKg, row.reps);
      if (!best || e > best.e1rm) {
        best = {
          dateISO: row.dateISO,
          bodyweightKg: row.bodyweightKg,
          loadKg: row.loadKg,
          reps: row.reps,
          e1rm: e,
        };
      }
    }
    return best;
  }

  function fmtLoad(kg) {
    return fmt(fromKg(kg), 1) + " " + unitLabel();
  }

  function fmtDateShort(iso) {
    if (!iso || String(iso).length < 10) return String(iso || "");
    return String(iso).slice(5);
  }

  function deltaLabel(fromKgVal, toKgVal) {
    var d = toKgVal - fromKgVal;
    var sign = d > 0 ? "+" : "";
    return sign + fmt(fromKg(d), 1) + " " + unitLabel();
  }

  function gotoLogCta(label) {
    return (
      '<div class="actions">' +
      '<button type="button" class="btn primary block" data-action="goto-log">' +
      esc(label || "Log a session") +
      "</button></div>"
    );
  }

  function sectionEmpty(title, hint) {
    return (
      '<div class="empty-note">' +
      (title ? '<p class="title">' + esc(title) + "</p>" : "") +
      "<p>" +
      esc(hint) +
      "</p>" +
      gotoLogCta("Log a session") +
      "</div>"
    );
  }

  /**
   * Inline SVG line chart.
   * points: number[] (y values, chronological)
   * opts: { ariaLabel, xLabels: [first, last], yDigits }
   */
  function svgLineChart(points, w, h, opts) {
    w = w || 320;
    h = h || 148;
    opts = opts || {};
    var yDigits = opts.yDigits == null ? 0 : opts.yDigits;
    var aria = opts.ariaLabel || "Trend chart";

    if (!points || !points.length) {
      return (
        '<svg viewBox="0 0 ' +
        w +
        " " +
        h +
        '" width="' +
        w +
        '" height="' +
        h +
        '" role="img" aria-label="No data">' +
        '<text x="' +
        w / 2 +
        '" y="' +
        h / 2 +
        '" text-anchor="middle" class="axis-label">No data yet</text>' +
        "</svg>"
      );
    }

    var padL = 40;
    var padR = 12;
    var padT = 14;
    var padB = opts.xLabels ? 28 : 18;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;

    var min = points[0];
    var max = points[0];
    for (var i = 1; i < points.length; i++) {
      if (points[i] < min) min = points[i];
      if (points[i] > max) max = points[i];
    }
    if (min === max) {
      min = min - 1;
      max = max + 1;
    }
    var range = max - min;
    var mid = (min + max) / 2;

    function xAt(idx) {
      if (points.length === 1) return padL + plotW / 2;
      return padL + (idx / (points.length - 1)) * plotW;
    }
    function yAt(v) {
      return padT + plotH - ((v - min) / range) * plotH;
    }

    var coords = [];
    for (var j = 0; j < points.length; j++) {
      coords.push(xAt(j).toFixed(1) + "," + yAt(points[j]).toFixed(1));
    }

    var lastIdx = points.length - 1;
    var yMax = yAt(max);
    var yMid = yAt(mid);
    var yMin = yAt(min);
    var x0 = xAt(0);
    var xLast = xAt(lastIdx);
    var yBase = padT + plotH;

    // Soft fill under the line for contrast on dark iron bg
    var areaD =
      "M" +
      x0.toFixed(1) +
      "," +
      yBase.toFixed(1) +
      " L" +
      coords
        .map(function (c) {
          return c;
        })
        .join(" L") +
      " L" +
      xLast.toFixed(1) +
      "," +
      yBase.toFixed(1) +
      " Z";

    var svg =
      '<svg viewBox="0 0 ' +
      w +
      " " +
      h +
      '" width="' +
      w +
      '" height="' +
      h +
      '" role="img" aria-label="' +
      esc(aria) +
      '">' +
      // Mid guide
      '<line x1="' +
      padL +
      '" y1="' +
      yMid.toFixed(1) +
      '" x2="' +
      (padL + plotW) +
      '" y2="' +
      yMid.toFixed(1) +
      '" stroke="var(--border, #2a3342)" stroke-width="1" stroke-dasharray="3 4"/>' +
      // Axes
      '<line x1="' +
      padL +
      '" y1="' +
      padT +
      '" x2="' +
      padL +
      '" y2="' +
      yBase +
      '" stroke="var(--border, #2a3342)" stroke-width="1"/>' +
      '<line x1="' +
      padL +
      '" y1="' +
      yBase +
      '" x2="' +
      (padL + plotW) +
      '" y2="' +
      yBase +
      '" stroke="var(--border, #2a3342)" stroke-width="1"/>' +
      // Y labels (display units)
      '<text x="2" y="' +
      (yMax + 3).toFixed(1) +
      '" class="axis-label">' +
      esc(fmt(fromKg(max), yDigits)) +
      "</text>" +
      '<text x="2" y="' +
      (yMid + 3).toFixed(1) +
      '" class="axis-label">' +
      esc(fmt(fromKg(mid), yDigits)) +
      "</text>" +
      '<text x="2" y="' +
      (yMin + 3).toFixed(1) +
      '" class="axis-label">' +
      esc(fmt(fromKg(min), yDigits)) +
      "</text>" +
      '<path d="' +
      areaD +
      '" fill="rgba(119,183,255,0.12)"/>' +
      '<polyline fill="none" stroke="var(--accent, #77b7ff)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" points="' +
      coords.join(" ") +
      '"/>';

    for (var k = 0; k < points.length; k++) {
      var isLast = k === lastIdx;
      svg +=
        '<circle cx="' +
        xAt(k).toFixed(1) +
        '" cy="' +
        yAt(points[k]).toFixed(1) +
        '" r="' +
        (isLast ? "4.5" : "2.75") +
        '" fill="' +
        (isLast ? "var(--green, #3fb96b)" : "var(--accent, #77b7ff)") +
        '"/>';
    }

    if (opts.xLabels && opts.xLabels.length) {
      var firstLab = opts.xLabels[0] || "";
      var lastLab = opts.xLabels[opts.xLabels.length - 1] || "";
      svg +=
        '<text x="' +
        padL +
        '" y="' +
        (h - 6) +
        '" class="axis-label">' +
        esc(firstLab) +
        "</text>";
      if (points.length > 1 && lastLab) {
        svg +=
          '<text x="' +
          (padL + plotW) +
          '" y="' +
          (h - 6) +
          '" text-anchor="end" class="axis-label">' +
          esc(lastLab) +
          "</text>";
      }
    }

    svg += "</svg>";
    return svg;
  }

  /** Best added-load e1RM per session date (chronological). */
  function bestE1rmByDate(exerciseId) {
    var hist = store().historyFor(exerciseId) || [];
    var byDate = {};
    for (var i = 0; i < hist.length; i++) {
      var row = hist[i];
      var d = row.dateISO || "";
      if (!d) continue;
      var e = e1rmAdded(row.loadKg, row.reps);
      if (!byDate[d] || e > byDate[d]) byDate[d] = e;
    }
    var dates = Object.keys(byDate).sort();
    return dates.map(function (date) {
      return { dateISO: date, e1rm: byDate[date] };
    });
  }

  /** Running streetlifting total (sum of running-best e1RM of 4 lifts) per date. */
  function streetliftingTotalHistory() {
    var series = {};
    COMP_LIFTS.forEach(function (lift) {
      series[lift.id] = bestE1rmByDate(lift.id);
    });

    var dateSet = {};
    COMP_LIFTS.forEach(function (lift) {
      series[lift.id].forEach(function (p) {
        dateSet[p.dateISO] = true;
      });
    });
    var dates = Object.keys(dateSet).sort();
    if (!dates.length) return [];

    var idx = {};
    COMP_LIFTS.forEach(function (lift) {
      idx[lift.id] = 0;
    });
    var running = {};
    COMP_LIFTS.forEach(function (lift) {
      running[lift.id] = 0;
    });

    var out = [];
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i];
      COMP_LIFTS.forEach(function (lift) {
        var arr = series[lift.id];
        var j = idx[lift.id];
        while (j < arr.length && arr[j].dateISO <= d) {
          if (arr[j].e1rm > running[lift.id]) running[lift.id] = arr[j].e1rm;
          j++;
        }
        idx[lift.id] = j;
      });
      var sum = 0;
      var complete = true;
      COMP_LIFTS.forEach(function (lift) {
        if (!running[lift.id]) complete = false;
        sum += running[lift.id] || 0;
      });
      if (complete) {
        out.push({ dateISO: d, total: sum });
      }
    }
    return out;
  }

  function currentStreetliftingTotal() {
    var sum = 0;
    var complete = true;
    COMP_LIFTS.forEach(function (lift) {
      var best = bestAddedSet(lift.id);
      if (!best) complete = false;
      else sum += best.e1rm;
    });
    if (!complete) return null;
    return sum;
  }

  function missingCompLifts() {
    var missing = [];
    COMP_LIFTS.forEach(function (lift) {
      if (!bestAddedSet(lift.id)) missing.push(lift.label);
    });
    return missing;
  }

  function isoWeekKey(dateISO) {
    var d = new Date(dateISO + "T12:00:00");
    if (isNaN(d.getTime())) return dateISO;
    var tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
    var y = tmp.getUTCFullYear();
    var w = weekNo < 10 ? "0" + weekNo : String(weekNo);
    return y + "-W" + w;
  }

  function weeklyVolume() {
    var sessions = store().listSessions() || [];
    var weeks = {};
    for (var i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      var key = isoWeekKey(sess.dateISO || "");
      if (!weeks[key]) weeks[key] = { week: key, sets: 0, tonnage: 0 };
      var sets = sess.sets || [];
      for (var j = 0; j < sets.length; j++) {
        var set = sets[j];
        if (set.completed === false) continue;
        var load = Number(set.loadKg) || 0;
        var reps = Number(set.reps) || 0;
        weeks[key].sets += 1;
        weeks[key].tonnage += load * reps;
      }
    }
    return Object.keys(weeks)
      .sort()
      .map(function (k) {
        return weeks[k];
      });
  }

  /**
   * Stall: double-progression exercises where the last 2 sessions
   * failed to hit repMax across programmed sets.
   */
  function stallHints() {
    var program = store().getActiveProgram();
    if (!program || !Array.isArray(program.days)) return [];

    var doubleEx = {};
    program.days.forEach(function (day) {
      (day.exercises || []).forEach(function (ex) {
        if (ex.progression === "double" && ex.exerciseId) {
          doubleEx[ex.exerciseId] = {
            exerciseId: ex.exerciseId,
            sets: Number(ex.sets) || 0,
            repMax: Number(ex.repMax) || 0,
          };
        }
      });
    });

    var ids = Object.keys(doubleEx);
    if (!ids.length) return [];

    var sessions = (store().listSessions() || []).slice().sort(function (a, b) {
      var da = a.dateISO || "";
      var db = b.dateISO || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return 0;
    });

    var nameById = {};
    try {
      var custom = (store().get().customExercises || []).slice();
      custom.forEach(function (e) {
        nameById[e.id] = e.name;
      });
    } catch (e) {}
    COMP_LIFTS.forEach(function (l) {
      nameById[l.id] = l.label;
    });

    var hints = [];
    ids.forEach(function (exId) {
      var cfg = doubleEx[exId];
      if (!cfg.repMax || !cfg.sets) return;

      var relevant = [];
      for (var i = sessions.length - 1; i >= 0 && relevant.length < 2; i--) {
        var sess = sessions[i];
        var exSets = (sess.sets || []).filter(function (s) {
          return s.exerciseId === exId && s.completed !== false;
        });
        if (!exSets.length) continue;
        relevant.push({ session: sess, sets: exSets });
      }
      if (relevant.length < 2) return;

      relevant.reverse();

      var stalled = relevant.every(function (entry) {
        var programmed = entry.sets.slice(0, cfg.sets);
        if (programmed.length < cfg.sets) return true;
        return !programmed.every(function (s) {
          return Number(s.reps) >= cfg.repMax;
        });
      });

      if (stalled) {
        hints.push({
          exerciseId: exId,
          name: nameById[exId] || exId,
          sets: cfg.sets,
          repMax: cfg.repMax,
          action: "Drop load 5–10%, then rebuild to all sets at " + cfg.repMax + " reps.",
        });
      }
    });

    return hints;
  }

  function renderEmpty() {
    return (
      '<div class="empty empty-state">' +
      '<p class="title">No sessions yet</p>' +
      '<p class="hint">Log a workout to unlock e1RM trends, meet total, volume, and PRs.</p>' +
      gotoLogCta("Log first session") +
      "</div>"
    );
  }

  function bindRoot(root) {
    root.onclick = function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var btn = t.closest("[data-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      if (action === "goto-log" && window.SL.navigate) {
        window.SL.navigate("log");
      }
    };
  }

  /** Competition PRs — memorable Syne load numerals. */
  function renderPrSection() {
    var html =
      '<div class="card">' +
      "<h2>Competition PRs</h2>" +
      '<p class="muted small" style="margin-top:-6px;margin-bottom:10px">Best belt load · e1RM on added load only</p>';

    var any = false;
    COMP_LIFTS.forEach(function (lift) {
      var best = bestAddedSet(lift.id);
      if (!best) {
        html +=
          '<div class="pr-row">' +
          "<div><div class=\"name\">" +
          esc(lift.label) +
          '</div><div class="sub">Log a set to claim this PR</div></div>' +
          '<div class="value muted">—</div></div>';
        return;
      }
      any = true;
      html +=
        '<div class="pr-row">' +
        "<div><div class=\"name\">" +
        esc(lift.label) +
        '</div><div class="sub">e1RM ' +
        esc(fmtLoad(best.e1rm)) +
        (best.dateISO ? " · " + esc(fmtDateShort(best.dateISO)) : "") +
        '</div></div><div class="value">' +
        esc(fmt(fromKg(best.loadKg), 1)) +
        '<span class="muted small"> ×' +
        esc(String(best.reps)) +
        "</span></div></div>";
    });

    if (!any) {
      html += sectionEmpty(
        "No competition PRs",
        "Hit pull-up, dip, muscle-up, and squat in a logged session."
      );
    }

    html += "</div>";
    return html;
  }

  function renderTotalSection() {
    var current = currentStreetliftingTotal();
    var hist = streetliftingTotalHistory();
    var missing = missingCompLifts();
    var html =
      '<div class="card">' +
      "<h2>Streetlifting total</h2>" +
      '<p class="muted small" style="margin-top:-6px;margin-bottom:10px">Sum of best added-load e1RM across the four competition lifts</p>';

    if (current == null) {
      html +=
        '<p class="muted">Need a best set for every lift.</p>' +
        '<p class="muted small" style="margin-bottom:10px">Still missing: ' +
        esc(missing.join(", ") || "all four") +
        "</p>" +
        gotoLogCta("Log missing lifts");
    } else {
      html +=
        '<div class="stat-grid" style="margin-bottom:8px">' +
        '<div class="stat accent"><div class="val">' +
        esc(fmt(fromKg(current), 1)) +
        '</div><div class="lbl">Meet total · ' +
        esc(unitLabel()) +
        "</div></div>";

      if (hist.length >= 2) {
        var first = hist[0].total;
        var last = hist[hist.length - 1].total;
        html +=
          '<div class="stat"><div class="val">' +
          esc(deltaLabel(first, last)) +
          '</div><div class="lbl">Since first full total</div></div>';
      } else {
        html +=
          '<div class="stat"><div class="val">' +
          esc(String(hist.length || 1)) +
          '</div><div class="lbl">Full-total session' +
          (hist.length === 1 ? "" : "s") +
          "</div></div>";
      }
      html += "</div>";

      if (hist.length >= 2) {
        html +=
          '<div class="chart-wrap">' +
          svgLineChart(
            hist.map(function (p) {
              return p.total;
            }),
            320,
            140,
            {
              ariaLabel: "Streetlifting total over time",
              xLabels: [
                fmtDateShort(hist[0].dateISO),
                fmtDateShort(hist[hist.length - 1].dateISO),
              ],
              yDigits: 0,
            }
          ) +
          "</div>";
      } else {
        html +=
          '<p class="muted small">Chart unlocks after another session that covers all four lifts.</p>';
      }
    }
    html += "</div>";
    return html;
  }

  function renderE1rmSection() {
    var html =
      '<div class="card">' +
      "<h2>e1RM trends</h2>" +
      '<p class="muted small" style="margin-top:-6px;margin-bottom:12px">Best estimated 1RM each session (added load only)</p>';

    var any = false;
    COMP_LIFTS.forEach(function (lift) {
      var series = bestE1rmByDate(lift.id);
      if (!series.length) return;
      any = true;
      var points = series.map(function (p) {
        return p.e1rm;
      });
      var first = series[0];
      var last = series[series.length - 1];
      var delta =
        series.length > 1 ? deltaLabel(first.e1rm, last.e1rm) : "baseline";

      html +=
        '<div style="margin-bottom:18px">' +
        '<div class="pr-row" style="border-bottom:none;padding-bottom:2px;padding-top:0">' +
        "<div><div class=\"name\">" +
        esc(lift.label) +
        '</div><div class="sub">' +
        esc(series.length + " session" + (series.length === 1 ? "" : "s")) +
        " · " +
        esc(delta) +
        '</div></div><div class="value">' +
        esc(fmt(fromKg(last.e1rm), 1)) +
        '<span class="muted small"> ' +
        esc(unitLabel()) +
        "</span></div></div>" +
        '<div class="chart-wrap">' +
        svgLineChart(points, 320, 132, {
          ariaLabel: lift.label + " e1RM trend",
          xLabels: [
            fmtDateShort(first.dateISO),
            fmtDateShort(last.dateISO),
          ],
          yDigits: 0,
        }) +
        "</div></div>";
    });

    if (!any) {
      html += sectionEmpty(
        "No e1RM data",
        "Log competition lifts to plot estimated max over time."
      );
    }

    html += "</div>";
    return html;
  }

  function renderRelativeSection() {
    var html =
      '<div class="card">' +
      "<h2>Relative strength</h2>" +
      '<p class="muted small" style="margin-top:-6px;margin-bottom:10px">Added-load e1RM ÷ bodyweight for pull-up and dip</p>';

    var any = false;
    REL_LIFTS.forEach(function (lift) {
      var best = bestAddedSet(lift.id);
      if (!best) {
        html +=
          '<div class="pr-row">' +
          "<div><div class=\"name\">" +
          esc(lift.label) +
          '</div><div class="sub">No best set yet</div></div>' +
          '<div class="value muted">—</div></div>';
        return;
      }
      any = true;
      var bw =
        Number(best.bodyweightKg) ||
        Number(store().get().settings.bodyweightKg) ||
        0;
      var ratio = bw > 0 ? best.e1rm / bw : null;
      html +=
        '<div class="pr-row">' +
        "<div><div class=\"name\">" +
        esc(lift.label) +
        '</div><div class="sub">e1RM ' +
        esc(fmtLoad(best.e1rm)) +
        (bw > 0 ? " / BW " + esc(fmtLoad(bw)) : " · set bodyweight in Settings") +
        '</div></div><div class="value">' +
        (ratio != null ? esc(fmt(ratio, 2) + "×") : "—") +
        "</div></div>";
    });

    if (!any) {
      html += sectionEmpty(
        "No relative numbers",
        "Log pull-ups or dips with bodyweight set."
      );
    }

    html += "</div>";
    return html;
  }

  function renderVolumeSection(weeks) {
    var html =
      '<div class="card">' +
      "<h2>Weekly volume</h2>" +
      '<p class="muted small" style="margin-top:-6px;margin-bottom:10px">Tonnage = belt load × reps</p>';

    if (!weeks.length) {
      html += sectionEmpty("No volume yet", "Complete sets in a logged session.");
      html += "</div>";
      return html;
    }

    var recent = weeks.slice(-8);
    var tonnagePts = recent.map(function (w) {
      return w.tonnage;
    });
    var latest = recent[recent.length - 1];

    html +=
      '<div class="pr-row" style="border-bottom:none;padding-top:0;padding-bottom:4px">' +
      "<div><div class=\"name\">This week</div>" +
      '<div class="sub">' +
      esc(latest.week) +
      " · " +
      esc(String(latest.sets)) +
      " sets</div></div>" +
      '<div class="value">' +
      esc(fmt(fromKg(latest.tonnage), 0)) +
      '<span class="muted small"> ' +
      esc(unitLabel()) +
      "</span></div></div>" +
      '<div class="chart-wrap">' +
      svgLineChart(tonnagePts, 320, 132, {
        ariaLabel: "Weekly tonnage",
        xLabels: [recent[0].week, latest.week],
        yDigits: 0,
      }) +
      "</div>";

    if (recent.length > 1) {
      html += '<hr class="weld"/>';
      recent
        .slice()
        .reverse()
        .slice(1, 5)
        .forEach(function (w) {
          html +=
            '<div class="pr-row">' +
            "<div><div class=\"name\">" +
            esc(w.week) +
            '</div><div class="sub">' +
            esc(String(w.sets)) +
            ' sets</div></div><div class="value" style="color:var(--text)">' +
            esc(fmt(fromKg(w.tonnage), 0)) +
            " " +
            esc(unitLabel()) +
            "</div></div>";
        });
    }

    html += "</div>";
    return html;
  }

  function renderStallSection(hints) {
    if (!hints.length) return "";
    var html =
      '<div class="card">' +
      "<h2>Progression hints</h2>" +
      '<p class="muted small" style="margin-top:-6px;margin-bottom:10px">Double progression — last 2 sessions missed top reps</p>';

    hints.forEach(function (h) {
      html +=
        '<div class="insight">' +
        '<div class="ico" aria-hidden="true">!</div>' +
        "<div><span class=\"badge amber\">Stall</span> <strong>" +
        esc(h.name) +
        "</strong>" +
        '<div class="muted small" style="margin-top:4px">' +
        esc(
          "Missed " +
            h.repMax +
            " reps across " +
            h.sets +
            " sets, twice."
        ) +
        "</div>" +
        "<div style=\"margin-top:4px\">" +
        esc(h.action) +
        "</div></div></div>";
    });

    html += "</div>";
    return html;
  }

  function title() {
    return "Analytics";
  }

  function render(root) {
    if (!root) return;
    var sessions = store().listSessions() || [];
    if (!sessions.length) {
      root.innerHTML = renderEmpty();
      bindRoot(root);
      return;
    }

    var weeks = weeklyVolume();
    var hints = stallHints();

    // Narrative: PRs → meet total → trends → relative → volume → coaching
    root.innerHTML =
      renderPrSection() +
      renderTotalSection() +
      renderE1rmSection() +
      renderRelativeSection() +
      renderVolumeSection(weeks) +
      renderStallSection(hints);

    bindRoot(root);
  }

  window.SL.views.analytics = {
    render: render,
    title: title,
  };

  window.SL.views.analytics.svgLineChart = svgLineChart;
})();
