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

  function goTo(tab) {
    if (typeof SL.navigate === "function") SL.navigate(tab);
  }

  function formatBeltNum(num) {
    if (!num || num === "—") return "—";
    var s = String(num);
    return s.charAt(0) === "+" ? s : "+" + s;
  }

  function renderProgramPicker(programs, activeId) {
    if (!programs || programs.length < 2) return "";
    var html =
      '<section class="card" aria-label="Choose program">' +
      '<h2 class="muted">Program</h2>' +
      '<p class="muted small" style="margin:0 0 10px">Home and Start workout use the active one.</p>';
    for (var i = 0; i < programs.length; i++) {
      var p = programs[i];
      var isActive = p.id === activeId || (!!p.active && !activeId);
      html +=
        '<button type="button" class="btn block' +
        (isActive ? "" : " secondary") +
        '" style="margin-bottom:8px" data-action="select-program" data-id="' +
        esc(p.id) +
        '" aria-pressed="' +
        (isActive ? "true" : "false") +
        '">' +
        esc(p.name || "Program") +
        (isActive ? " · active" : "") +
        "</button>";
    }
    html += "</section>";
    return html;
  }

  /**
   * Signature artifact: oversized belt load + lift + one primary CTA.
   * Markup matches DESIGN.md classes: .load-hero .eyebrow .num .unit .lift .meta .cta
   */
  function renderLoadHero(opts) {
    var num = opts.num;
    var unit = opts.unit || "kg";
    var lift = opts.lift || "";
    var meta = opts.meta || "";
    var eyebrow = opts.eyebrow || "Next load";
    var ctaLabel = opts.ctaLabel || "Start workout";
    var ctaAction = opts.ctaAction || "start-workout";
    var empty = !num || num === "—";
    var displayNum = formatBeltNum(empty ? "—" : num);

    var ariaLoad = empty
      ? eyebrow + (lift ? ": " + lift : "")
      : displayNum + " " + unit + (lift ? " " + lift : "");
    var ctaAria = empty
      ? ctaLabel
      : ctaLabel + " — " + displayNum + " " + unit + (lift ? " " + lift : "");

    var html =
      '<section class="load-hero' +
      (empty ? " empty" : "") +
      '" aria-label="' +
      esc(ariaLoad) +
      '">' +
      '<p class="eyebrow" id="home-load-eyebrow">' +
      esc(eyebrow) +
      "</p>" +
      '<p class="num" aria-hidden="true">' +
      esc(displayNum) +
      "</p>" +
      '<p class="unit" aria-hidden="true">' +
      esc(unit) +
      "</p>";

    if (lift) {
      html += '<h1 class="lift">' + esc(lift) + "</h1>";
    }
    if (meta) {
      html += '<p class="session-name meta">' + esc(meta) + "</p>";
    }

    html +=
      '<div class="cta home-cta">' +
      '<button type="button" class="btn primary block" data-action="' +
      esc(ctaAction) +
      '" aria-label="' +
      esc(ctaAria) +
      '">' +
      esc(ctaLabel) +
      "</button></div></section>";
    return html;
  }

  function renderSecondaryHeading(text) {
    return '<h2 class="muted">' + esc(text) + "</h2>";
  }

  function renderExerciseRows(rows) {
    if (!rows || !rows.length) {
      return '<p class="muted small">No exercises planned.</p>';
    }
    var html = '<div class="stack stack-sm" role="list">';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html +=
        '<div class="pr-row" role="listitem">' +
        "<div><div class=\"name\">" +
        esc(r.name) +
        '</div><div class="sub">' +
        esc(r.sub) +
        "</div></div></div>";
    }
    html += "</div>";
    return html;
  }

  /** Quieter day / session plan under the hero. */
  function renderDayCard(title, programName, rows, editLabel) {
    return (
      '<hr class="weld" aria-hidden="true" />' +
      '<section class="card" aria-label="' +
      esc(title) +
      '">' +
      renderSecondaryHeading(title) +
      '<div class="spread" style="margin-bottom:10px">' +
      '<div><span class="muted small">' +
      esc(programName) +
      "</span></div>" +
      '<button type="button" class="btn secondary sm" data-action="goto-program" aria-label="' +
      esc((editLabel || "View") + " program") +
      '">' +
      esc(editLabel || "View") +
      "</button></div>" +
      renderExerciseRows(rows) +
      "</section>"
    );
  }

  function renderEmptyHint(title, hint) {
    return (
      '<hr class="weld" aria-hidden="true" />' +
      '<section class="empty-state" aria-label="' +
      esc(title) +
      '">' +
      '<div class="title">' +
      esc(title) +
      "</div>" +
      '<p class="hint">' +
      esc(hint) +
      "</p></section>"
    );
  }

  function renderEmptyProgram() {
    return (
      renderLoadHero({
        num: null,
        unit: "kg",
        eyebrow: "Belt load",
        lift: "No program yet",
        meta: "Add days and loads — your next weight shows here",
        ctaLabel: "Create a program",
        ctaAction: "goto-program",
      }) +
      renderEmptyHint(
        "Set up your program",
        "Pick lifts, sets, and starting loads. Home opens on the next belt weight."
      )
    );
  }

  function renderBodyweightMeta(settings, unit) {
    var bw = settings && settings.bodyweightKg;
    if (bw == null || bw === "" || isNaN(Number(bw))) {
      return (
        '<p class="muted small" style="margin:8px 0 4px;text-align:center">' +
        '<button type="button" class="btn secondary sm" data-action="goto-settings" aria-label="Set bodyweight in Settings">' +
        "Set bodyweight" +
        "</button></p>"
      );
    }
    return (
      '<p class="muted small" style="margin:8px 0 4px;text-align:center">BW ' +
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
          meta: "Open Programs to check the cycle",
          ctaLabel: "Open Programs",
          ctaAction: "goto-program",
        }) +
        renderEmptyHint(
          "No session queued",
          "The squat schedule could not be resolved for this program."
        )
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
        ctaLabel: "Start workout",
      }) +
      renderDayCard("Session plan", program.name || "Squat cycle", rows, "View")
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
          lift: "Wave unavailable",
          meta: "Open Programs to check the wave",
          ctaLabel: "Open Programs",
          ctaAction: "goto-program",
        }) +
        renderEmptyHint(
          "No wave session",
          "Intensive and volume days could not be loaded."
        )
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
      '<hr class="weld" aria-hidden="true" />' +
      '<section class="card" aria-label="Day type">' +
      renderSecondaryHeading("Day type") +
      '<p class="muted small" style="margin:0 0 10px">Choose Intensive or Volume, then start.</p>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:4px" role="group" aria-label="Wave day">' +
      '<button type="button" class="btn' +
      (selected === "intensive" ? "" : " secondary") +
      '" data-action="pick-wave-day" data-wave="intensive" aria-pressed="' +
      (selected === "intensive" ? "true" : "false") +
      '">Intensive</button>' +
      '<button type="button" class="btn' +
      (selected === "volume" ? "" : " secondary") +
      '" data-action="pick-wave-day" data-wave="volume" aria-pressed="' +
      (selected === "volume" ? "true" : "false") +
      '">Volume</button>' +
      "</div></section>";

    return (
      renderLoadHero({
        num: num,
        unit: unit,
        eyebrow: "Next load",
        lift: "Pull-up",
        meta: session.name || "Wave session",
        ctaLabel: "Start workout",
        ctaAction: "start-wave",
      }) +
      dayPick +
      renderDayCard("Session plan", program.name || "Pull-up wave", rows, "View")
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
          meta: "Add a day with lifts and starting loads",
          ctaLabel: "Edit program",
          ctaAction: "goto-program",
        }) +
        renderEmptyHint(
          "Add a training day",
          "Once a day has exercises and loads, the next belt weight appears above."
        )
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

    var heroOpts = {
      num: num,
      unit: unit,
      eyebrow: "Next load",
      lift: firstName,
      meta: (day.name || "Day") + " · " + (program.name || "Program"),
      ctaLabel: "Start workout",
    };
    if (num == null) {
      heroOpts.eyebrow = "Next lift";
      heroOpts.meta =
        (day.name || "Day") +
        " · " +
        (program.name || "Program") +
        " — set a starting load in the program";
    }

    return (
      renderLoadHero(heroOpts) +
      renderDayCard("Today / next day", program.name || "Untitled", rows, "Edit")
    );
  }

  /** Secondary PR strip — quieter than the load hero. */
  function renderPrs(unit) {
    var html =
      '<hr class="weld" aria-hidden="true" />' +
      '<section class="card" aria-label="Competition PRs">' +
      renderSecondaryHeading("Quick PRs");
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
    html += "</section>";
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
          goTo("program");
        } else if (action === "goto-settings") {
          goTo("settings");
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
          eyebrow: "Next load",
          lift: "Loading squat…",
          meta: "Fetching schedule",
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
              meta: "Check the program or try again",
              ctaLabel: "Open Programs",
              ctaAction: "goto-program",
            }) +
              renderEmptyHint(
                "Schedule failed",
                "Open Programs to fix the squat cycle, then return here."
              )
          );
        });
      return;
    }

    if (program && program.kind === "pullup_wave") {
      finish(
        renderLoadHero({
          num: null,
          unit: unit,
          eyebrow: "Next load",
          lift: "Loading wave…",
          meta: "Fetching intensive / volume",
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
              meta: "Check the program or try again",
              ctaLabel: "Open Programs",
              ctaAction: "goto-program",
            }) +
              renderEmptyHint(
                "Wave failed",
                "Open Programs to fix the pull-up wave, then return here."
              )
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
