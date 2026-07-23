/* Streetlifting — Home view */
(function () {
  "use strict";

  window.SL = window.SL || {};
  SL.views = SL.views || {};

  var KG_TO_LB = 2.2046226218;
  var PR_LIFTS = [
    { id: "pullup", label: "Pull-up" },
    { id: "dip", label: "Dip" },
    { id: "muscleup", label: "Muscle-up" },
    { id: "squat", label: "Squat" },
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function unitLabel(settings) {
    return settings && settings.unit === "lb" ? "lb" : "kg";
  }

  function kgToDisplay(kg, unit) {
    if (kg == null || kg === "" || isNaN(Number(kg))) return null;
    var n = Number(kg);
    if (unit === "lb") return n * KG_TO_LB;
    return n;
  }

  function fmtWeight(kg, unit) {
    var v = kgToDisplay(kg, unit);
    if (v == null) return "—";
    var rounded = Math.round(v * 10) / 10;
    var text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return text + " " + unit;
  }

  function exerciseNameMap() {
    var map = {
      pullup: "Pull-up",
      dip: "Dip",
      muscleup: "Muscle-up",
      squat: "Squat",
    };
    var custom = (SL.store.get().customExercises || []);
    for (var i = 0; i < custom.length; i++) {
      var ex = custom[i];
      if (ex && ex.id) map[ex.id] = ex.name || ex.id;
    }
    return map;
  }

  function nextProgramDay(program) {
    var days = (program && program.days) || [];
    if (!days.length) return null;

    var sessions = SL.store.listSessions() || [];
    var lastDayId = null;
    for (var i = 0; i < sessions.length; i++) {
      var sess = sessions[i];
      if (!sess || !sess.dayId) continue;
      if (sess.programId && sess.programId !== program.id) continue;
      lastDayId = sess.dayId;
      break;
    }

    if (!lastDayId) return days[0];

    var idx = -1;
    for (var j = 0; j < days.length; j++) {
      if (days[j].id === lastDayId) {
        idx = j;
        break;
      }
    }
    if (idx < 0) return days[0];
    return days[(idx + 1) % days.length];
  }

  function renderCycleSessionCard(program, session, unit) {
    var html =
      '<div class="card">' +
      "<h2>Program</h2>" +
      '<div class="spread" style="margin-bottom:12px">' +
      "<div><strong>" +
      esc(program.name || "Squat cycle") +
      '</strong><div class="muted small">Active · target ' +
      esc(fmtWeight(program.target1rmKg, unit)) +
      "</div></div>" +
      '<button type="button" class="btn secondary sm" data-action="goto-program">View</button>' +
      "</div>";

    if (!session) {
      html += '<p class="muted">Schedule unavailable.</p></div>';
      return html;
    }

    html +=
      "<h2>Next session</h2>" +
      '<p style="font-weight:700;margin-bottom:4px">' +
      esc(session.name) +
      "</p>" +
      '<p class="muted small" style="margin-bottom:10px">' +
      esc(session.dateISO) +
      "</p>";

    var exercises = session.exercises || [];
    for (var i = 0; i < exercises.length; i++) {
      var pe = exercises[i];
      var load =
        pe.loadKgMax != null && pe.loadKgMax !== pe.loadKg
          ? fmtWeight(pe.loadKg, unit) + "–" + fmtWeight(pe.loadKgMax, unit)
          : fmtWeight(pe.loadKg, unit);
      html +=
        '<div class="pr-row">' +
        '<div><div class="name">Squat</div><div class="sub">' +
        esc(pe.sets + " × " + pe.reps + " @ " + (pe.pctLabel || "") + " · " + load) +
        "</div></div></div>";
    }

    html +=
      '<button type="button" class="btn block" data-action="start-workout" style="margin-top:14px">Start workout</button>' +
      "</div>";
    return html;
  }

  function renderPullupWaveCard(program, session, unit) {
    var html =
      '<div class="card">' +
      "<h2>Program</h2>" +
      '<div class="spread" style="margin-bottom:12px">' +
      "<div><strong>" +
      esc(program.name || "Pull-up wave") +
      '</strong><div class="muted small">Active · intensive ' +
      esc(fmtWeight(program.intensiveLoadKg, unit)) +
      "</div></div>" +
      '<button type="button" class="btn secondary sm" data-action="goto-program">View</button>' +
      "</div>";

    if (!session) {
      html += '<p class="muted">Wave session unavailable.</p></div>';
      return html;
    }

    html +=
      "<h2>Next session</h2>" +
      '<p style="font-weight:700;margin-bottom:10px">' +
      esc(session.name) +
      "</p>";

    var exercises = session.exercises || [];
    for (var i = 0; i < exercises.length; i++) {
      var pe = exercises[i];
      html +=
        '<div class="pr-row">' +
        '<div><div class="name">Pull-up</div><div class="sub">' +
        esc(pe.sets + " × " + pe.reps + " @ " + fmtWeight(pe.loadKg, unit)) +
        "</div></div></div>";
    }

    html +=
      '<button type="button" class="btn block" data-action="start-workout" style="margin-top:14px">Start workout</button>' +
      "</div>";
    return html;
  }

  function startWorkout() {
    SL.pendingStart = true;
    if (typeof SL.navigate === "function") {
      SL.navigate("log", { startFromProgram: true });
    }
  }

  function renderBodyweight(settings, unit) {
    var bw = settings && settings.bodyweightKg;
    if (bw == null || bw === "" || isNaN(Number(bw))) {
      return (
        '<div class="card">' +
        "<h2>Bodyweight</h2>" +
        '<p class="muted">Not set — add it in Settings.</p>' +
        "</div>"
      );
    }
    return (
      '<div class="card">' +
      "<h2>Bodyweight</h2>" +
      '<div class="stat-grid">' +
      '<div class="stat"><div class="val">' +
      esc(fmtWeight(bw, unit)) +
      '</div><div class="lbl">Current</div></div>' +
      "</div></div>"
    );
  }

  function renderProgramCard(program, day, names, unit) {
    if (!program) {
      return (
        '<div class="card">' +
        "<h2>Program</h2>" +
        '<p class="muted">No active program yet.</p>' +
        '<button type="button" class="btn block" data-action="goto-program">Create a program</button>' +
        "</div>"
      );
    }

    var html =
      '<div class="card">' +
      "<h2>Program</h2>" +
      '<div class="spread" style="margin-bottom:12px">' +
      "<div><strong>" +
      esc(program.name || "Untitled") +
      '</strong><div class="muted small">Active</div></div>' +
      '<button type="button" class="btn secondary sm" data-action="goto-program">Edit</button>' +
      "</div>";

    if (!day) {
      html += '<p class="muted">This program has no days yet.</p></div>';
      return html;
    }

    html +=
      "<h2>Today / next day</h2>" +
      '<p style="font-weight:700;margin-bottom:10px">' +
      esc(day.name || "Day") +
      "</p>";

    var exercises = day.exercises || [];
    if (!exercises.length) {
      html += '<p class="muted">No exercises on this day.</p>';
    } else {
      for (var i = 0; i < exercises.length; i++) {
        var pe = exercises[i];
        var name = names[pe.exerciseId] || pe.exerciseId || "Exercise";
        var sets = pe.sets != null ? pe.sets : "?";
        var reps =
          pe.repMin != null && pe.repMax != null
            ? pe.repMin === pe.repMax
              ? String(pe.repMin)
              : pe.repMin + "–" + pe.repMax
            : pe.repMin != null
              ? String(pe.repMin)
              : pe.repMax != null
                ? String(pe.repMax)
                : "?";
        var load =
          pe.startLoadKg != null ? fmtWeight(pe.startLoadKg, unit) : null;
        html +=
          '<div class="pr-row">' +
          '<div><div class="name">' +
          esc(name) +
          '</div><div class="sub">' +
          esc(sets + " × " + reps + (load ? " @ " + load : "")) +
          "</div></div></div>";
      }
    }

    html +=
      '<button type="button" class="btn block" data-action="start-workout" style="margin-top:14px">Start workout</button>' +
      "</div>";
    return html;
  }

  function renderPrs(unit) {
    var html = '<div class="card"><h2>Quick PRs</h2>';
    var any = false;
    for (var i = 0; i < PR_LIFTS.length; i++) {
      var lift = PR_LIFTS[i];
      var best = SL.store.bestSet(lift.id);
      var value;
      var sub;
      if (!best) {
        value = "—";
        sub = "No sets yet";
      } else {
        any = true;
        value = fmtWeight(best.loadKg, unit) + " × " + (best.reps != null ? best.reps : "?");
        var e1 = best.e1rm != null ? fmtWeight(best.e1rm, unit) + " e1RM" : "";
        var date = best.dateISO ? best.dateISO : "";
        sub = [e1, date].filter(Boolean).join(" · ") || "Best e1RM";
      }
      html +=
        '<div class="pr-row">' +
        '<div class="name">' +
        esc(lift.label) +
        '</div><div style="text-align:right"><div class="value">' +
        esc(value) +
        '</div><div class="sub">' +
        esc(sub) +
        "</div></div></div>";
    }
    if (!any) {
      html += '<p class="muted small" style="margin-top:8px">Log sessions to track competition PRs.</p>';
    }
    html += "</div>";
    return html;
  }

  function paint(root) {
    var data = SL.store.get();
    var settings = data.settings || {};
    var unit = unitLabel(settings);
    var program = SL.store.getActiveProgram();
    var names = exerciseNameMap();

    function finish(programHtml) {
      root.innerHTML =
        renderBodyweight(settings, unit) + programHtml + renderPrs(unit);

      root.onclick = function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var btn = t.closest("[data-action]");
        if (!btn) return;
        var action = btn.getAttribute("data-action");
        if (action === "goto-program") {
          SL.navigate("program");
        } else if (action === "start-workout") {
          startWorkout();
        }
      };
    }

    if (program && program.kind === "percent_cycle") {
      finish(
        '<div class="card"><p class="muted">Loading squat schedule…</p></div>'
      );
      SL.store
        .loadSquatCycleScheme()
        .then(function (scheme) {
          if (!root.isConnected) return;
          var session = SL.store.nextCycleSession(program, scheme);
          finish(renderCycleSessionCard(program, session, unit));
        })
        .catch(function () {
          if (!root.isConnected) return;
          finish(
            '<div class="card"><h2>Program</h2><p class="muted">Could not load squat cycle schedule.</p>' +
              '<button type="button" class="btn block" data-action="goto-program">Open Programs</button></div>'
          );
        });
      return;
    }

    if (program && program.kind === "pullup_wave") {
      finish('<div class="card"><p class="muted">Loading pull-up wave…</p></div>');
      SL.store
        .loadPullupWaveScheme()
        .then(function (scheme) {
          if (!root.isConnected) return;
          var session = SL.store.currentPullupWaveSession(program, scheme, "next");
          finish(renderPullupWaveCard(program, session, unit));
        })
        .catch(function () {
          if (!root.isConnected) return;
          finish(
            '<div class="card"><h2>Program</h2><p class="muted">Could not load pull-up wave.</p>' +
              '<button type="button" class="btn block" data-action="goto-program">Open Programs</button></div>'
          );
        });
      return;
    }

    var day = program ? nextProgramDay(program) : null;
    finish(renderProgramCard(program, day, names, unit));

    if (typeof SL.store.listExercises === "function") {
      SL.store.listExercises().then(function (list) {
        if (!root.isConnected) return;
        var changed = false;
        for (var i = 0; i < list.length; i++) {
          var ex = list[i];
          if (ex && ex.id && names[ex.id] !== ex.name) {
            names[ex.id] = ex.name;
            changed = true;
          }
        }
        if (changed && program && day) {
          finish(renderProgramCard(program, day, names, unit));
        }
      }).catch(function () { /* ignore */ });
    }
  }

  SL.views.home = {
    title: function () {
      return "Home";
    },
    render: function (root) {
      if (!root) return;
      paint(root);
    },
  };
})();
