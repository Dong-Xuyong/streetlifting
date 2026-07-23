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

  function fmtLoad(kg) {
    return fmt(fromKg(kg), 1) + " " + unitLabel();
  }

  /** Inline SVG line chart. points: number[] (y values, chronological). */
  function svgLineChart(points, w, h) {
    w = w || 320;
    h = h || 140;
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
        '" text-anchor="middle" class="axis-label">No data</text>' +
        "</svg>"
      );
    }

    var padL = 36;
    var padR = 10;
    var padT = 12;
    var padB = 22;
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

    var mid = (min + max) / 2;
    var svg =
      '<svg viewBox="0 0 ' +
      w +
      " " +
      h +
      '" width="' +
      w +
      '" height="' +
      h +
      '" role="img">' +
      '<line x1="' +
      padL +
      '" y1="' +
      padT +
      '" x2="' +
      padL +
      '" y2="' +
      (padT + plotH) +
      '" stroke="var(--border, #2a3342)" stroke-width="1"/>' +
      '<line x1="' +
      padL +
      '" y1="' +
      (padT + plotH) +
      '" x2="' +
      (padL + plotW) +
      '" y2="' +
      (padT + plotH) +
      '" stroke="var(--border, #2a3342)" stroke-width="1"/>' +
      '<text x="4" y="' +
      (padT + 4) +
      '" class="axis-label">' +
      esc(fmt(fromKg(max), 0)) +
      "</text>" +
      '<text x="4" y="' +
      (padT + plotH / 2 + 3) +
      '" class="axis-label">' +
      esc(fmt(fromKg(mid), 0)) +
      "</text>" +
      '<text x="4" y="' +
      (padT + plotH) +
      '" class="axis-label">' +
      esc(fmt(fromKg(min), 0)) +
      "</text>" +
      '<polyline fill="none" stroke="var(--accent, #77b7ff)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' +
      coords.join(" ") +
      '"/>';

    for (var k = 0; k < points.length; k++) {
      svg +=
        '<circle cx="' +
        xAt(k).toFixed(1) +
        '" cy="' +
        yAt(points[k]).toFixed(1) +
        '" r="3" fill="var(--accent, #77b7ff)"/>';
    }

    svg += "</svg>";
    return svg;
  }

  /** Best e1RM per session date (chronological). */
  function bestE1rmByDate(exerciseId) {
    var hist = store().historyFor(exerciseId) || [];
    var byDate = {};
    for (var i = 0; i < hist.length; i++) {
      var row = hist[i];
      var d = row.dateISO || "";
      if (!d) continue;
      if (!byDate[d] || row.e1rm > byDate[d]) byDate[d] = row.e1rm;
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
      var best = store().bestSet(lift.id);
      if (!best) complete = false;
      else sum += best.e1rm;
    });
    if (!complete) return null;
    return sum;
  }

  function isoWeekKey(dateISO) {
    var d = new Date(dateISO + "T12:00:00");
    if (isNaN(d.getTime())) return dateISO;
    // ISO week date
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
      var bw = Number(sess.bodyweightKg) || 0;
      var sets = sess.sets || [];
      for (var j = 0; j < sets.length; j++) {
        var set = sets[j];
        if (set.completed === false) continue;
        var load = Number(set.loadKg) || 0;
        var reps = Number(set.reps) || 0;
        weeks[key].sets += 1;
        weeks[key].tonnage += (bw + load) * reps;
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
    // Sync name lookup from cached builtins + custom if possible
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

      // chronological order of the two
      relevant.reverse();

      var stalled = relevant.every(function (entry) {
        var programmed = entry.sets.slice(0, cfg.sets);
        if (programmed.length < cfg.sets) return true; // incomplete = fail
        return !programmed.every(function (s) {
          return Number(s.reps) >= cfg.repMax;
        });
      });

      if (stalled) {
        hints.push({
          exerciseId: exId,
          name: nameById[exId] || exId,
          message: "consider -5 to -10% load",
        });
      }
    });

    return hints;
  }

  function renderEmpty() {
    return (
      '<div class="empty">' +
      '<span class="big" aria-hidden="true">—</span>' +
      "<p>No sessions yet. Log a workout to see trends, volume, and PRs.</p>" +
      "</div>"
    );
  }

  function renderE1rmSection() {
    var html = '<div class="card"><h2>e1RM trends</h2>';
    var any = false;
    COMP_LIFTS.forEach(function (lift) {
      var series = bestE1rmByDate(lift.id);
      if (!series.length) return;
      any = true;
      var points = series.map(function (p) {
        return p.e1rm;
      });
      var last = series[series.length - 1];
      html +=
        '<div style="margin-bottom:16px">' +
        '<div class="spread" style="margin-bottom:6px">' +
        '<span class="pr-row name">' +
        esc(lift.label) +
        "</span>" +
        '<span class="pr-row value">' +
        esc(fmtLoad(last.e1rm)) +
        "</span>" +
        "</div>" +
        '<div class="chart-wrap">' +
        svgLineChart(points, 320, 120) +
        "</div>" +
        '<p class="muted small">' +
        esc(series.length + " session" + (series.length === 1 ? "" : "s")) +
        "</p>" +
        "</div>";
    });
    if (!any) {
      html += '<p class="muted">No competition lift data yet.</p>';
    }
    html += "</div>";
    return html;
  }

  function renderTotalSection() {
    var current = currentStreetliftingTotal();
    var hist = streetliftingTotalHistory();
    var html = '<div class="card"><h2>Streetlifting total</h2>';
    if (current == null) {
      html +=
        '<p class="muted">Need a best set for all four lifts (pull-up, dip, muscle-up, squat).</p>';
    } else {
      html +=
        '<div class="stat-grid" style="margin-bottom:12px">' +
        '<div class="stat"><div class="val">' +
        esc(fmt(fromKg(current), 1)) +
        '</div><div class="lbl">Current total (' +
        esc(unitLabel()) +
        ")</div></div>" +
        "</div>";
      if (hist.length >= 2) {
        html +=
          '<div class="chart-wrap">' +
          svgLineChart(
            hist.map(function (p) {
              return p.total;
            }),
            320,
            120
          ) +
          "</div>" +
          '<p class="muted small">Running sum of best e1RM per competition lift</p>';
      } else if (hist.length === 1) {
        html +=
          '<p class="muted small">History will appear after more sessions covering all four lifts.</p>';
      }
    }
    html += "</div>";
    return html;
  }

  function renderRelativeSection() {
    var html = '<div class="card"><h2>Relative strength</h2>';
    var rows = "";
    REL_LIFTS.forEach(function (lift) {
      var best = store().bestSet(lift.id);
      if (!best) {
        rows +=
          '<div class="pr-row"><div><div class="name">' +
          esc(lift.label) +
          '</div><div class="sub">No data</div></div><div class="value">—</div></div>';
        return;
      }
      var bw =
        Number(best.bodyweightKg) ||
        Number(store().get().settings.bodyweightKg) ||
        0;
      var ratio = bw > 0 ? best.e1rm / bw : null;
      rows +=
        '<div class="pr-row"><div><div class="name">' +
        esc(lift.label) +
        '</div><div class="sub">e1RM ' +
        esc(fmtLoad(best.e1rm)) +
        (bw > 0 ? " / BW " + esc(fmtLoad(bw)) : "") +
        '</div></div><div class="value">' +
        (ratio != null ? esc(fmt(ratio, 2) + "×") : "—") +
        "</div></div>";
    });
    html += rows + "</div>";
    return html;
  }

  function renderVolumeSection(weeks) {
    var html = '<div class="card"><h2>Weekly volume</h2>';
    if (!weeks.length) {
      html += '<p class="muted">No volume yet.</p></div>';
      return html;
    }
    var recent = weeks.slice(-8);
    var tonnagePts = recent.map(function (w) {
      return w.tonnage;
    });
    html +=
      '<div class="chart-wrap">' +
      svgLineChart(tonnagePts, 320, 120) +
      "</div>" +
      '<p class="muted small" style="margin-bottom:10px">Tonnage (bw+load)×reps — last ' +
      esc(String(recent.length)) +
      " week(s)</p>";

    recent
      .slice()
      .reverse()
      .forEach(function (w) {
        html +=
          '<div class="pr-row"><div><div class="name">' +
          esc(w.week) +
          '</div><div class="sub">' +
          esc(String(w.sets)) +
          ' sets</div></div><div class="value">' +
          esc(fmt(fromKg(w.tonnage), 0)) +
          " " +
          esc(unitLabel()) +
          "</div></div>";
      });
    html += "</div>";
    return html;
  }

  function renderPrSection() {
    var html = '<div class="card"><h2>PRs</h2>';
    COMP_LIFTS.forEach(function (lift) {
      var best = store().bestSet(lift.id);
      if (!best) {
        html +=
          '<div class="pr-row"><div class="name">' +
          esc(lift.label) +
          '</div><div class="value muted">—</div></div>';
        return;
      }
      html +=
        '<div class="pr-row"><div><div class="name">' +
        esc(lift.label) +
        '</div><div class="sub">e1RM ' +
        esc(fmtLoad(best.e1rm)) +
        (best.dateISO ? " · " + esc(best.dateISO) : "") +
        '</div></div><div class="value">' +
        esc(fmt(fromKg(best.loadKg), 1)) +
        " × " +
        esc(String(best.reps)) +
        "</div></div>";
    });
    html += "</div>";
    return html;
  }

  function renderStallSection(hints) {
    if (!hints.length) return "";
    var html = '<div class="card"><h2>Progression hints</h2>';
    hints.forEach(function (h) {
      html +=
        '<div class="insight" style="color:var(--amber, #d9a038)">' +
        '<div class="ico" aria-hidden="true">!</div>' +
        "<div><strong>" +
        esc(h.name) +
        "</strong> — last 2 sessions missed rep max; " +
        esc(h.message) +
        "</div></div>";
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
      return;
    }

    var weeks = weeklyVolume();
    var hints = stallHints();

    root.innerHTML =
      renderStallSection(hints) +
      renderE1rmSection() +
      renderTotalSection() +
      renderRelativeSection() +
      renderVolumeSection(weeks) +
      renderPrSection();
  }

  window.SL.views.analytics = {
    render: render,
    title: title,
  };

  // Expose helper for tests / reuse
  window.SL.views.analytics.svgLineChart = svgLineChart;
})();
