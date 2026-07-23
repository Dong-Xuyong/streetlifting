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

  function fmtNum(kg, unit) {
    var v = kgToDisplay(kg, unit);
    if (v == null) return null;
    var rounded = Math.round(v * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function fmtWeight(kg, unit) {
    var text = fmtNum(kg, unit);
    if (text == null) return "—";
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

  function startWorkout(extra) {
    SL.pendingStart = true;
    var opts = { startFromProgram: true };
    if (extra && typeof extra === "object") {
      if (extra.waveDay) opts.waveDay = extra.waveDay;
      if (extra.programId) opts.programId = extra.programId;
    }
    if (typeof SL.navigate === "function") {
      SL.navigate("log", opts);
    }
  }

  function renderProgramPicker(programs, activeId) {
    if (!programs || programs.length < 2) return "";
    var html =
      '<div class="card"><h2>Start program</h2>' +
      '<p class="muted small" style="margin:0 0 10px">Choose which program Home and Start workout use.</p>';
    for (var i = 0; i < programs.length; i++) {
      var p = programs[i];
      var isActive = p.id === activeId || (!!p.active && !activeId);
      html +=
        '<button type="button" class="btn block' +
        (isActive ? "" : " secondary") +
        '" style="margin-bottom:8px" data-action="select-program" data-id="' +
        esc(p.id) +
        '">' +
        esc(p.name || "Program") +
        (isActive ? " · active" : "") +
        "</button>";
    }
    html += "</div>";
    return html;
  }

  /** Primary belt-load artifact for the home hero. */
  function renderLoadHero(opts) {
    var num = opts.num;
    var unit = opts.unit || "kg";
    var lift = opts.lift || "";
    var meta = opts.meta || "";
    var eyebrow = opts.eyebrow || "Next load";
    var ctaLabel = opts.ctaLabel || "Start workout";
    var ctaAction = opts.ctaAction || "start-workout";
    var empty = !num || num === "—";

    var html =
      '<section class="load-hero' +
      (empty ? " empty" : "") +
      '" aria-label="Next working load">' +
      '<div class="eyebrow">' +
      esc(eyebrow) +
      "</div>" +
      '<span class="num">' +
      esc(empty ? "—" : (String(num).charAt(0) === "+" ? num : "+" + num)) +
      "</span>" +
      '<div class="unit">' +
      esc(unit) +
      "</div>";

    if (lift) {
      html += '<div class="lift">' + esc(lift) + "</div>";
    }
    if (meta) {
      html += '<div class="meta">' + esc(meta) + "</div>";
    }

    html +=
      '<div class="cta">' +
      '<button type="button" class="btn primary block" data-action="' +
      esc(ctaAction) +
      '">' +
      esc(ctaLabel) +
      "</button></div></section>";
    return html;
  }

  function renderExerciseRows(rows) {
    if (!rows || !rows.length) {
      return '<p class="muted">No exercises planned.</p>';
    }
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html +=
        '<div class="pr-row">' +
        "<div><div class=\"name\">" +
        esc(r.name) +
        '</div><div class="sub">' +
        esc(r.sub) +
        "</div></div></div>";
    }
    return html;
  }

  function renderDayCard(title, programName, rows, editLabel) {
    return (
      '<div class="card">' +
      "<h2>" +
      esc(title) +
      "</h2>" +
      '<div class="spread" style="margin-bottom:12px">' +
      "<div><strong>" +
      esc(programName) +
      '</strong><div class="muted small">Active</div></div>' +
      '<button type="button" class="btn secondary sm" data-action="goto-program">' +
      esc(editLabel || "View") +
      "</button></div>" +
      renderExerciseRows(rows) +
      "</div>"
    );
  }

  function renderEmptyProgram() {
    return (
      renderLoadHero({
        num: null,
        unit: "kg",
        eyebrow: "No program",
        lift: "Create a program",
        meta: "Pick a day, then start from here",
        ctaLabel: "Create a program",
        ctaAction: "goto-program",
      }) +
      '<div class="card">' +
      "<h2>Program</h2>" +
      '<p class="muted">No active program yet. Set one up, then your next belt load shows here.</p>' +
      "</div>"
    );
  }

  function renderBodyweightMeta(settings, unit) {
    var bw = settings && settings.bodyweightKg;
    if (bw == null || bw === "" || isNaN(Number(bw))) {
      return (
        '<p class="muted small" style="margin:4px 0 14px">Bodyweight not set — add it in Settings.</p>'
      );
    }
    return (
      '<p class="muted small" style="margin:4px 0 14px">BW ' +
      esc(fmtWeight(bw, unit)) +
      "</p>"
    );
  }

  function renderCycleSessionHome(program, session, unit) {
    if (!session) {
      return (
        renderLoadHero({
          num: null,
          unit: unit,
          eyebrow: program.name || "Squat cycle",
          lift: "Schedule unavailable",
          ctaLabel: "Open Programs",
          ctaAction: "goto-program",
        }) +
        renderDayCard("Program", program.name || "Squat cycle", [], "View")
      );
    }

    var pe = (session.exercises && session.exercises[0]) || null;
    var num = pe ? fmtNum(pe.loadKg, unit) : null;
    var rows = [];
    var exercises = session.exercises || [];
    for (var i = 0; i < exercises.length; i++) {
      var ex = exercises[i];
      var load =
        ex.loadKgMax != null && ex.loadKgMax !== ex.loadKg
          ? fmtWeight(ex.loadKg, unit) + "–" + fmtWeight(ex.loadKgMax, unit)
          : fmtWeight(ex.loadKg, unit);
      rows.push({
        name: "Squat",
        sub: ex.sets + " × " + ex.reps + " @ " + (ex.pctLabel || "") + " · " + load,
      });
    }

    return (
      renderLoadHero({
        num: num,
        unit: unit,
        eyebrow: "Next load",
        lift: "Squat",
        meta: (session.name || "Session") + (session.dateISO ? " · " + session.dateISO : ""),
      }) +
      renderDayCard("Session", program.name || "Squat cycle", rows, "View")
    );
  }

  function renderPullupWaveHome(program, intensive, volume, selected, unit) {
    var session =
      selected === "volume" ? volume : intensive || volume;
    if (!session) {
      return (
        renderLoadHero({
          num: null,
          unit: unit,
          eyebrow: program.name || "Pull-up wave",
          lift: "Wave session unavailable",
          ctaLabel: "Open Programs",
          ctaAction: "goto-program",
        }) +
        renderDayCard("Program", program.name || "Pull-up wave", [], "View")
      );
    }

    var pe = (session.exercises && session.exercises[0]) || null;
    var num = pe ? fmtNum(pe.loadKg, unit) : null;
    var rows = [];
    var exercises = session.exercises || [];
    for (var i = 0; i < exercises.length; i++) {
      var ex = exercises[i];
      rows.push({
        name: "Pull-up",
        sub: ex.sets + " × " + ex.reps + " @ " + fmtWeight(ex.loadKg, unit),
      });
    }

    var dayPick =
      '<div class="card" style="margin-top:10px"><h2 style="margin:0 0 8px">Day type</h2>' +
      '<p class="muted small" style="margin:0 0 10px">Choose Intensive or Volume before starting.</p>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
      '<button type="button" class="btn' +
      (selected === "intensive" ? "" : " secondary") +
      '" data-action="pick-wave-day" data-wave="intensive">Intensive</button>' +
      '<button type="button" class="btn' +
      (selected === "volume" ? "" : " secondary") +
      '" data-action="pick-wave-day" data-wave="volume">Volume</button>' +
      "</div></div>";

    return (
      renderLoadHero({
        num: num,
        unit: unit,
        eyebrow: "Next load",
        lift: "Pull-up",
        meta: session.name || "Wave session",
        ctaAction: "start-wave",
      }) +
      dayPick +
      renderDayCard("Session", program.name || "Pull-up wave", rows, "View")
    );
  }

  function renderProgramHome(program, day, names, unit) {
    if (!program) return renderEmptyProgram();

    if (!day) {
      return (
        renderLoadHero({
          num: null,
          unit: unit,
          eyebrow: program.name || "Program",
          lift: "No days yet",
          ctaLabel: "Edit program",
          ctaAction: "goto-program",
        }) +
        renderDayCard("Program", program.name || "Untitled", [], "Edit")
      );
    }

    var exercises = day.exercises || [];
    var first = exercises[0] || null;
    var firstName = first
      ? names[first.exerciseId] || first.exerciseId || "Exercise"
      : day.name || "Day";
    var num = first && first.startLoadKg != null ? fmtNum(first.startLoadKg, unit) : null;

    var rows = [];
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
      var load = pe.startLoadKg != null ? fmtWeight(pe.startLoadKg, unit) : null;
      rows.push({
        name: name,
        sub: sets + " × " + reps + (load ? " @ " + load : ""),
      });
    }

    return (
      renderLoadHero({
        num: num,
        unit: unit,
        eyebrow: "Next load",
        lift: firstName,
        meta: (day.name || "Day") + " · " + (program.name || "Program"),
      }) +
      renderDayCard("Today / next day", program.name || "Untitled", rows, "Edit")
    );
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
        value =
          fmtWeight(best.loadKg, unit) +
          " × " +
          (best.reps != null ? best.reps : "?");
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
      html +=
        '<p class="muted small" style="margin-top:8px">Log sessions to track competition PRs.</p>';
    }
    html += "</div>";
    return html;
  }

  function paint(root) {
    var data = SL.store.get();
    var settings = data.settings || {};
    var unit = unitLabel(settings);
    var programs = SL.store.listPrograms() || [];
    var program = SL.store.getActiveProgram();
    var names = exerciseNameMap();
    var waveSelected =
      program &&
      program.kind === "pullup_wave" &&
      (program.nextWaveDay === "volume" || program.nextWaveDay === "intensive")
        ? program.nextWaveDay
        : null;

    function finish(programHtml) {
      root.innerHTML =
        renderProgramPicker(programs, program && program.id) +
        programHtml +
        renderBodyweightMeta(settings, unit) +
        renderPrs(unit);

      root.onclick = function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var btn = t.closest("[data-action]");
        if (!btn) return;
        var action = btn.getAttribute("data-action");
        if (action === "goto-program") {
          SL.navigate("program");
        } else if (action === "start-workout") {
          startWorkout({ programId: program && program.id });
        } else if (action === "start-wave") {
          var pick = root.querySelector(
            '[data-action="pick-wave-day"]:not(.secondary)'
          );
          var day =
            (pick && pick.getAttribute("data-wave")) ||
            (program && program.nextWaveDay) ||
            waveSelected ||
            "intensive";
          if (program && program.id) {
            SL.store.setPullupNextWaveDay(
              program.id,
              day === "volume" ? "volume" : "intensive"
            );
          }
          startWorkout({
            programId: program && program.id,
            waveDay: day === "volume" ? "volume" : "intensive",
          });
        } else if (action === "pick-wave-day") {
          var wave = btn.getAttribute("data-wave");
          if (!program || !wave) return;
          SL.store.setPullupNextWaveDay(program.id, wave);
          paint(root);
        } else if (action === "select-program") {
          var id = btn.getAttribute("data-id");
          if (!id) return;
          SL.store.setActiveProgram(id);
          paint(root);
        }
      };
    }

    if (program && program.kind === "percent_cycle") {
      finish(
        renderLoadHero({
          num: null,
          unit: unit,
          eyebrow: "Loading",
          lift: "Squat schedule…",
          ctaLabel: "Start workout",
        })
      );
      SL.store
        .loadSquatCycleScheme()
        .then(function (scheme) {
          if (!root.isConnected) return;
          var session = SL.store.nextCycleSession(program, scheme);
          finish(renderCycleSessionHome(program, session, unit));
        })
        .catch(function () {
          if (!root.isConnected) return;
          finish(
            renderLoadHero({
              num: null,
              unit: unit,
              eyebrow: "Squat cycle",
              lift: "Could not load schedule",
              ctaLabel: "Open Programs",
              ctaAction: "goto-program",
            })
          );
        });
      return;
    }

    if (program && program.kind === "pullup_wave") {
      finish(
        renderLoadHero({
          num: null,
          unit: unit,
          eyebrow: "Loading",
          lift: "Pull-up wave…",
          ctaLabel: "Start workout",
        })
      );
      SL.store
        .loadPullupWaveScheme()
        .then(function (scheme) {
          if (!root.isConnected) return;
          var intensive = SL.store.currentPullupWaveSession(
            program,
            scheme,
            "intensive"
          );
          var volume = SL.store.currentPullupWaveSession(
            program,
            scheme,
            "volume"
          );
          var suggested = SL.store.currentPullupWaveSession(
            program,
            scheme,
            "next"
          );
          var selected =
            waveSelected ||
            (suggested && suggested.waveDay) ||
            "intensive";
          finish(
            renderPullupWaveHome(program, intensive, volume, selected, unit)
          );
        })
        .catch(function () {
          if (!root.isConnected) return;
          finish(
            renderLoadHero({
              num: null,
              unit: unit,
              eyebrow: "Pull-up wave",
              lift: "Could not load wave",
              ctaLabel: "Open Programs",
              ctaAction: "goto-program",
            })
          );
        });
      return;
    }

    var day = program ? nextProgramDay(program) : null;
    finish(renderProgramHome(program, day, names, unit));

    if (typeof SL.store.listExercises === "function") {
      SL.store
        .listExercises()
        .then(function (list) {
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
            finish(renderProgramHome(program, day, names, unit));
          }
        })
        .catch(function () {
          /* ignore */
        });
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
