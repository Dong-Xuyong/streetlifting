/* Streetlifting — post-workout session summary view */
(function () {
  "use strict";

  window.SL = window.SL || {};
  SL.views = SL.views || {};

  var KG_TO_LB = 2.2046226218;
  var MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pad2(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    return n < 10 ? "0" + n : String(n);
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
    if (rounded === Math.floor(rounded)) return String(rounded);
    return rounded.toFixed(1);
  }

  function fmtWeight(kg, unit) {
    var text = fmtNum(kg, unit);
    if (text == null) return "-";
    return text + " " + unit;
  }

  function formatDuration(sec) {
    if (sec == null || sec === "" || isNaN(Number(sec))) return "-";
    var total = Math.max(0, Math.floor(Number(sec)));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + ":" + pad2(m) + ":" + pad2(s);
    return m + ":" + pad2(s);
  }

  function formatDate(iso) {
    if (!iso || typeof iso !== "string") return "Session";
    var p = iso.split("-");
    if (p.length < 3) return iso;
    var y = Number(p[0]);
    var m = Number(p[1]) - 1;
    var d = Number(p[2]);
    if (!y || m < 0 || m > 11 || !d) return iso;
    return MONTHS[m] + " " + d + ", " + y;
  }

  function goTo(tab, opts) {
    if (typeof SL.navigate === "function") SL.navigate(tab, opts);
  }

  function exerciseName(id) {
    if (id == null || id === "") return "Exercise";
    if (SL.store && typeof SL.store.exerciseById === "function") {
      var ex = SL.store.exerciseById(id);
      if (ex && ex.name) return ex.name;
    }
    var fallback = {
      pullup: "Pull-up",
      dip: "Dip",
      muscleup: "Muscle-up",
      squat: "Squat",
      chinup: "Chin-up",
    };
    if (fallback[id]) return fallback[id];
    try {
      var custom = (SL.store.get().customExercises || []);
      for (var i = 0; i < custom.length; i++) {
        if (custom[i] && custom[i].id === id) {
          return custom[i].name || id;
        }
      }
    } catch (e) {
      /* ignore */
    }
    return String(id);
  }

  function resolveSession(opts) {
    if (!SL.store || typeof SL.store.listSessions !== "function") return null;
    var sessions = SL.store.listSessions() || [];
    var id = opts && opts.sessionId;
    if (id) {
      var i;
      for (i = 0; i < sessions.length; i++) {
        if (sessions[i] && sessions[i].id === id) return sessions[i];
      }
    }
    return sessions.length ? sessions[0] : null;
  }

  function getSummary(session) {
    if (!session || !SL.store || typeof SL.store.sessionSummary !== "function") {
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
    return SL.store.sessionSummary(session);
  }

  function collectPrHits(session) {
    var hits = [];
    if (!session || !SL.prs || typeof SL.prs.checkSet !== "function") {
      return hits;
    }
    var sets = Array.isArray(session.sets) ? session.sets : [];
    var i;
    for (i = 0; i < sets.length; i++) {
      var set = sets[i];
      if (!set) continue;
      var records = null;
      try {
        records = SL.prs.checkSet(set, session);
      } catch (e) {
        records = null;
      }
      if (!records || !records.length) continue;
      var j;
      for (j = 0; j < records.length; j++) {
        var rec = records[j];
        if (!rec || !rec.kind) continue;
        hits.push({
          exerciseId: set.exerciseId,
          kind: rec.kind,
          value: rec.value,
          prevValue: rec.prevValue,
        });
      }
    }
    return hits;
  }

  function prKindClass(kind) {
    if (kind === "weight") return "pr-badge pr-badge--weight";
    if (kind === "e1rm") return "pr-badge pr-badge--e1rm";
    if (kind === "volume") return "pr-badge pr-badge--volume";
    return "pr-badge";
  }

  function prKindLabel(kind) {
    if (kind === "weight") return "Weight";
    if (kind === "e1rm") return "e1RM";
    if (kind === "volume") return "Volume";
    return String(kind || "PR");
  }

  function formatTopSet(topSet, unit) {
    if (!topSet) return "-";
    var loadText = fmtNum(topSet.loadKg, unit);
    if (loadText == null) loadText = "0";
    var reps = topSet.reps != null ? String(topSet.reps) : "0";
    return "+" + loadText + " x " + reps;
  }

  function buildShareText(session, summary, unit) {
    var lines = [];
    lines.push("Streetlifting - " + formatDate(session.dateISO));
    lines.push("Duration: " + formatDuration(summary.durationSec));
    lines.push("Volume: " + fmtWeight(summary.totalVolumeKg, unit));
    lines.push(
      "Sets: " +
        summary.setCount +
        " (" +
        summary.workingSetCount +
        " working)"
    );
    lines.push("Exercises: " + summary.exerciseCount);
    lines.push("");
    var per = summary.perExercise || [];
    var i;
    for (i = 0; i < per.length; i++) {
      var row = per[i];
      var name = exerciseName(row.exerciseId);
      lines.push(
        name +
          " - " +
          row.sets +
          " sets, " +
          fmtWeight(row.volumeKg, unit)
      );
      lines.push("  Top: " + formatTopSet(row.topSet, unit));
    }
    return lines.join("\n");
  }

  function fallbackCopy(text, done) {
    var ok = false;
    var ta = null;
    try {
      ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.setAttribute("aria-hidden", "true");
      ta.tabIndex = -1;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      if (typeof ta.setSelectionRange === "function") {
        ta.setSelectionRange(0, ta.value.length);
      }
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    if (ta && ta.parentNode) {
      try {
        ta.parentNode.removeChild(ta);
      } catch (e2) {
        /* ignore */
      }
    }
    if (typeof done === "function") done(!!ok);
  }

  function copyShareText(text, done) {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        navigator.clipboard.writeText(text).then(
          function () {
            if (typeof done === "function") done(true);
          },
          function () {
            fallbackCopy(text, done);
          }
        );
        return;
      }
    } catch (e) {
      /* fall through */
    }
    fallbackCopy(text, done);
  }

  function renderEmpty() {
    return (
      '<div class="empty-state" role="status">' +
      '<div class="title">No workouts yet</div>' +
      '<p class="hint">Finish a session to see duration, volume, and PRs here.</p>' +
      '<div class="actions">' +
      '<button type="button" class="btn primary block" data-action="goto-home">Go home</button>' +
      '<button type="button" class="btn secondary block" data-action="goto-log">Start workout</button>' +
      "</div></div>"
    );
  }

  function renderHero(session, summary, unit) {
    var dateLabel = formatDate(session.dateISO);
    var dur = formatDuration(summary.durationSec);
    var volNum = fmtNum(summary.totalVolumeKg, unit);
    if (volNum == null) volNum = "0";
    return (
      '<section class="summary-hero" aria-label="Workout summary">' +
      '<p class="summary-hero-date">' +
      esc(dateLabel) +
      "</p>" +
      '<p class="summary-hero-duration num" aria-label="Duration ' +
      esc(dur) +
      '">' +
      esc(dur) +
      "</p>" +
      '<p class="summary-hero-label">Duration</p>' +
      '<p class="summary-hero-volume">' +
      '<span class="num">' +
      esc(volNum) +
      "</span> " +
      '<span class="unit">' +
      esc(unit) +
      "</span>" +
      ' <span class="summary-hero-volume-label">volume</span>' +
      "</p></section>"
    );
  }

  function renderStats(summary, unit) {
    var items = [
      { lbl: "Duration", val: formatDuration(summary.durationSec) },
      { lbl: "Volume", val: fmtWeight(summary.totalVolumeKg, unit) },
      { lbl: "Sets", val: String(summary.setCount) },
      { lbl: "Working", val: String(summary.workingSetCount) },
      { lbl: "Exercises", val: String(summary.exerciseCount) },
    ];
    var html = '<div class="summary-stats" role="list">';
    var i;
    for (i = 0; i < items.length; i++) {
      html +=
        '<div class="summary-stat" role="listitem">' +
        '<div class="summary-stat-val num">' +
        esc(items[i].val) +
        "</div>" +
        '<div class="summary-stat-lbl">' +
        esc(items[i].lbl) +
        "</div></div>";
    }
    html += "</div>";
    return html;
  }

  function renderPrs(hits, unit) {
    if (!hits || !hits.length) return "";
    var html =
      '<section class="summary-prs" aria-label="PRs hit">' +
      '<h2 class="summary-section-title">PRs hit</h2>' +
      '<ul class="summary-pr-list">';
    var i;
    for (i = 0; i < hits.length; i++) {
      var hit = hits[i];
      var valText = fmtWeight(hit.value, unit);
      html +=
        '<li class="summary-pr-row">' +
        '<span class="summary-pr-ex">' +
        esc(exerciseName(hit.exerciseId)) +
        "</span> " +
        '<span class="' +
        prKindClass(hit.kind) +
        '">' +
        esc(prKindLabel(hit.kind)) +
        " " +
        esc(valText) +
        "</span></li>";
    }
    html += "</ul></section>";
    return html;
  }

  function renderPerExercise(summary, unit) {
    var per = summary.perExercise || [];
    var html =
      '<section class="summary-exercises" aria-label="Per exercise">' +
      '<h2 class="summary-section-title">Exercises</h2>';
    if (!per.length) {
      html += '<p class="muted small">No working sets logged.</p></section>';
      return html;
    }
    var i;
    for (i = 0; i < per.length; i++) {
      var row = per[i];
      html +=
        '<div class="summary-ex-row">' +
        '<div class="summary-ex-name">' +
        esc(exerciseName(row.exerciseId)) +
        "</div>" +
        '<div class="summary-ex-meta muted small">' +
        esc(String(row.sets)) +
        " sets · " +
        esc(fmtWeight(row.volumeKg, unit)) +
        "</div>" +
        '<div class="summary-ex-top">' +
        '<span class="summary-ex-top-label muted small">Top</span> ' +
        '<span class="num">' +
        esc(formatTopSet(row.topSet, unit)) +
        "</span></div></div>";
    }
    html += "</section>";
    return html;
  }

  function renderMuscleSplit(summary) {
    var split = summary.muscleSplit || [];
    if (!split.length) return "";
    var html =
      '<section class="summary-split" aria-label="Muscle split">' +
      '<h2 class="summary-section-title">Muscle split</h2>';
    var i;
    for (i = 0; i < split.length; i++) {
      var row = split[i];
      var pct = Number(row.pct) || 0;
      if (pct < 0) pct = 0;
      if (pct > 100) pct = 100;
      var pctLabel = Math.round(pct) + "%";
      var width = Math.round(pct * 10) / 10;
      html +=
        '<div class="summary-split-row">' +
        '<span class="summary-split-name">' +
        esc(row.muscle || "") +
        "</span>" +
        '<div class="summary-split-track" aria-hidden="true">' +
        '<div class="summary-split-fill" style="width:' +
        width +
        '%"></div></div>' +
        '<span class="summary-split-pct">' +
        esc(pctLabel) +
        "</span></div>";
    }
    html += "</section>";
    return html;
  }

  function renderShare() {
    return (
      '<section class="summary-share-block" aria-label="Share">' +
      '<button type="button" class="btn secondary block summary-share" data-action="share">' +
      "Copy summary" +
      "</button>" +
      '<p class="summary-share-status muted small" data-share-status aria-live="polite"></p>' +
      "</section>"
    );
  }

  function renderNav() {
    return (
      '<nav class="summary-nav" aria-label="Summary navigation">' +
      '<button type="button" class="btn secondary block" data-action="goto-history">History</button>' +
      '<button type="button" class="btn block" data-action="goto-home">Home</button>' +
      "</nav>"
    );
  }

  function renderSummaryHtml(session, summary, unit, prHits) {
    return (
      '<div class="summary-view stack">' +
      renderHero(session, summary, unit) +
      renderStats(summary, unit) +
      renderPrs(prHits, unit) +
      renderPerExercise(summary, unit) +
      renderMuscleSplit(summary) +
      renderShare() +
      renderNav() +
      "</div>"
    );
  }

  function bind(rootEl, ctx) {
    rootEl.onclick = function (ev) {
      var t = ev.target;
      if (!t) return;
      var el = null;
      while (t && t !== rootEl) {
        if (t.getAttribute && t.getAttribute("data-action")) {
          el = t;
          break;
        }
        t = t.parentNode;
      }
      if (!el) return;
      var action = el.getAttribute("data-action");
      if (action === "goto-home") {
        goTo("home");
        return;
      }
      if (action === "goto-history") {
        goTo("history");
        return;
      }
      if (action === "goto-log") {
        goTo("log");
        return;
      }
      if (action === "share") {
        var status = rootEl.querySelector("[data-share-status]");
        var btn = el;
        copyShareText(ctx.shareText, function (ok) {
          if (status) {
            status.textContent = ok ? "Copied to clipboard" : "Copy failed";
          }
          if (btn && ok) {
            var prev = btn.textContent;
            btn.textContent = "Copied";
            setTimeout(function () {
              if (btn.isConnected) btn.textContent = prev || "Copy summary";
            }, 1600);
          }
        });
      }
    };
  }

  function paint(rootEl, opts) {
    if (!rootEl) return;
    var session = resolveSession(opts || {});
    if (!session) {
      rootEl.innerHTML = renderEmpty();
      bind(rootEl, { shareText: "" });
      return;
    }

    var settings = {};
    try {
      settings = (SL.store.get() && SL.store.get().settings) || {};
    } catch (e) {
      settings = {};
    }
    var unit = unitLabel(settings);
    var summary = getSummary(session);
    var prHits = collectPrHits(session);
    var shareText = buildShareText(session, summary, unit);

    rootEl.innerHTML = renderSummaryHtml(session, summary, unit, prHits);
    bind(rootEl, { shareText: shareText });
  }

  SL.views.summary = {
    title: function () {
      return "Summary";
    },
    render: function (rootEl, opts) {
      paint(rootEl, opts);
    },
  };
})();
