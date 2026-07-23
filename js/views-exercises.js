(function () {
  "use strict";

  var SL = (window.SL = window.SL || {});
  SL.views = SL.views || {};

  var state = {
    mode: "list", // list | detail | add
    selectedId: null,
    query: "",
    filter: "all", // all | competition | accessory
    cache: null, // last fetched exercise list
    formError: "",
  };

  var CATEGORY_ORDER = ["competition", "accessory"];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isThenable(v) {
    return v != null && typeof v.then === "function";
  }

  function getExercises() {
    var store = SL.store;
    if (!store || typeof store.listExercises !== "function") {
      return Promise.resolve([]);
    }
    var result = store.listExercises();
    if (isThenable(result)) return result;
    return Promise.resolve(result || []);
  }

  function isCustom(ex) {
    if (!ex || !ex.id) return false;
    if (ex.custom === true) return true;
    var data = SL.store && typeof SL.store.get === "function" ? SL.store.get() : null;
    var customs = (data && data.customExercises) || [];
    for (var i = 0; i < customs.length; i++) {
      if (customs[i] && customs[i].id === ex.id) return true;
    }
    return false;
  }

  function categoryLabel(cat) {
    if (cat === "competition") return "Competition";
    if (cat === "accessory") return "Accessory";
    return cat || "Other";
  }

  function matchesQuery(ex, q) {
    if (!q) return true;
    var name = String(ex.name || "").toLowerCase();
    var muscles = (ex.muscles || []).join(" ").toLowerCase();
    var cues = String(ex.cues || "").toLowerCase();
    return (
      name.indexOf(q) !== -1 ||
      muscles.indexOf(q) !== -1 ||
      cues.indexOf(q) !== -1
    );
  }

  function matchesFilter(ex, filter) {
    if (filter === "all") return true;
    return ex.category === filter;
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function countByCategory(exercises) {
    var counts = { all: 0, competition: 0, accessory: 0 };
    for (var i = 0; i < exercises.length; i++) {
      var ex = exercises[i];
      if (!ex) continue;
      counts.all += 1;
      if (ex.category === "competition") counts.competition += 1;
      else if (ex.category === "accessory") counts.accessory += 1;
    }
    return counts;
  }

  function groupByCategory(list) {
    var groups = {};
    var other = [];
    for (var i = 0; i < list.length; i++) {
      var ex = list[i];
      if (!ex) continue;
      var cat = ex.category;
      if (cat === "competition" || cat === "accessory") {
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(ex);
      } else {
        other.push(ex);
      }
    }
    var ordered = [];
    for (var j = 0; j < CATEGORY_ORDER.length; j++) {
      var key = CATEGORY_ORDER[j];
      if (groups[key] && groups[key].length) {
        ordered.push({ id: key, label: categoryLabel(key), items: groups[key] });
      }
    }
    if (other.length) {
      ordered.push({ id: "other", label: "Other", items: other });
    }
    return ordered;
  }

  function setBackVisible(show) {
    var btn = document.getElementById("back-btn");
    if (!btn) return;
    if (show) btn.classList.remove("hidden");
    else btn.classList.add("hidden");
  }

  function wireBack(root, goList) {
    var btn = document.getElementById("back-btn");
    if (!btn) return;
    btn.onclick = function () {
      goList();
    };
  }

  function syncTitle() {
    var el = document.getElementById("topbar-title");
    if (el && SL.views.exercises && typeof SL.views.exercises.title === "function") {
      el.textContent = SL.views.exercises.title();
    }
  }

  function emptyStateHtml(opts) {
    opts = opts || {};
    var actions = opts.actionsHtml || "";
    return (
      '<div class="empty-state" role="status">' +
      '<div class="title">' +
      esc(opts.title || "Nothing here") +
      "</div>" +
      (opts.hint
        ? '<p class="hint">' + esc(opts.hint) + "</p>"
        : "") +
      (actions ? '<div class="actions">' + actions + "</div>" : "") +
      "</div>"
    );
  }

  function exerciseRowHtml(ex) {
    var muscles = (ex.muscles || []).map(esc).join(", ");
    var custom = isCustom(ex);
    var badge = custom ? ' <span class="badge">Custom</span>' : "";
    var cat = categoryLabel(ex.category);
    var aria =
      esc(ex.name) +
      (custom ? ", custom" : "") +
      ", " +
      esc(cat) +
      (muscles ? ", " + muscles : "");
    return (
      '<button type="button" class="list-item session-card" data-ex-id="' +
      esc(ex.id) +
      '" aria-label="' +
      aria +
      '">' +
      '<div class="name">' +
      esc(ex.name) +
      badge +
      "</div>" +
      '<div class="meta">' +
      (muscles || esc(cat)) +
      "</div>" +
      '<span class="chev" aria-hidden="true">›</span>' +
      "</button>"
    );
  }

  function renderGroupedList(filtered, showGroups) {
    if (!filtered.length) return "";

    if (!showGroups) {
      return filtered.map(exerciseRowHtml).join("");
    }

    var groups = groupByCategory(filtered);
    return groups
      .map(function (g) {
        return (
          '<div class="card" style="padding-bottom:8px">' +
          '<div class="card-head" style="margin-bottom:8px">' +
          '<h2 class="card-title" style="margin:0">' +
          esc(g.label) +
          "</h2>" +
          '<span class="muted small" aria-hidden="true">' +
          g.items.length +
          "</span>" +
          "</div>" +
          g.items.map(exerciseRowHtml).join("") +
          "</div>"
        );
      })
      .join("");
  }

  function renderList(root, exercises) {
    setBackVisible(false);
    syncTitle();
    var q = String(state.query || "").trim().toLowerCase();
    var hasQuery = !!q;
    var filtered = exercises.filter(function (ex) {
      return matchesFilter(ex, state.filter) && matchesQuery(ex, q);
    });
    var counts = countByCategory(exercises);
    var showGroups = state.filter === "all" && !hasQuery;

    var chips = [
      { id: "all", label: "All", count: counts.all },
      { id: "competition", label: "Competition", count: counts.competition },
      { id: "accessory", label: "Accessory", count: counts.accessory },
    ];

    var chipsHtml = chips
      .map(function (c) {
        var active = state.filter === c.id;
        return (
          '<button type="button" class="chip' +
          (active ? " active" : "") +
          '" data-filter="' +
          esc(c.id) +
          '" role="tab" aria-selected="' +
          (active ? "true" : "false") +
          '" aria-pressed="' +
          (active ? "true" : "false") +
          '" aria-label="' +
          esc(c.label) +
          ", " +
          c.count +
          ' exercises">' +
          esc(c.label) +
          ' <span class="small" aria-hidden="true">(' +
          c.count +
          ")</span>" +
          "</button>"
        );
      })
      .join("");

    var listHtml;
    var catalogEmpty = !exercises.length;
    var searchEmpty = !filtered.length && !catalogEmpty;

    if (catalogEmpty) {
      listHtml = emptyStateHtml({
        title: "No exercises yet",
        hint: "Add a custom lift to start your catalog.",
        actionsHtml:
          '<button type="button" class="btn block" id="ex-empty-add">Add custom exercise</button>',
      });
    } else if (searchEmpty) {
      listHtml = emptyStateHtml({
        title: "No matches",
        hint: hasQuery
          ? 'Nothing matches "' + state.query.trim() + '". Try another name or muscle.'
          : "Nothing in this category. Switch filter or add a custom exercise.",
        actionsHtml:
          (hasQuery
            ? '<button type="button" class="btn secondary block" id="ex-clear-search">Clear search</button>'
            : '<button type="button" class="btn secondary block" id="ex-clear-filter">Show all</button>') +
          '<button type="button" class="btn block" id="ex-empty-add">Add custom exercise</button>',
      });
    } else {
      var countLabel =
        filtered.length === 1
          ? "1 exercise"
          : filtered.length + " exercises";
      listHtml =
        '<p class="muted small" id="ex-result-count" aria-live="polite" style="margin:0 0 8px">' +
        esc(countLabel) +
        (hasQuery ? " matching" : "") +
        "</p>" +
        '<div id="ex-results">' +
        renderGroupedList(filtered, showGroups) +
        "</div>";
    }

    var clearBtn =
      hasQuery
        ? '<button type="button" class="btn ghost sm" id="ex-search-clear" aria-label="Clear search" style="margin-top:8px">Clear</button>'
        : "";

    root.innerHTML =
      '<div role="search">' +
      '<label class="field" for="ex-search">' +
      '<span class="lbl">Search</span>' +
      '<input type="search" id="ex-search" placeholder="Name, muscle, or cue…" value="' +
      esc(state.query) +
      '" autocomplete="off" enterkeyhint="search" aria-label="Search exercises by name, muscle, or cue" aria-controls="ex-list" />' +
      clearBtn +
      "</label>" +
      "</div>" +
      '<div class="chip-row" id="ex-chips" role="tablist" aria-label="Filter by category">' +
      chipsHtml +
      "</div>" +
      '<div id="ex-list">' +
      listHtml +
      "</div>" +
      (catalogEmpty
        ? ""
        : '<button type="button" class="btn block" id="ex-add-btn" style="margin-top:12px">Add custom exercise</button>');

    function goAdd() {
      state.mode = "add";
      state.formError = "";
      paint(root);
    }

    var search = root.querySelector("#ex-search");
    if (search) {
      search.addEventListener("input", function () {
        var start = search.selectionStart;
        var end = search.selectionEnd;
        state.query = search.value;
        renderList(root, state.cache || exercises);
        var again = root.querySelector("#ex-search");
        if (again) {
          again.focus();
          try {
            again.setSelectionRange(start, end);
          } catch (e) {}
        }
      });
      search.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && state.query) {
          ev.preventDefault();
          state.query = "";
          renderList(root, state.cache || exercises);
          var again = root.querySelector("#ex-search");
          if (again) again.focus();
        }
      });
    }

    var searchClear = root.querySelector("#ex-search-clear");
    if (searchClear) {
      searchClear.addEventListener("click", function () {
        state.query = "";
        renderList(root, state.cache || exercises);
        var again = root.querySelector("#ex-search");
        if (again) again.focus();
      });
    }

    var clearSearch = root.querySelector("#ex-clear-search");
    if (clearSearch) {
      clearSearch.addEventListener("click", function () {
        state.query = "";
        renderList(root, state.cache || exercises);
        var again = root.querySelector("#ex-search");
        if (again) again.focus();
      });
    }

    var clearFilter = root.querySelector("#ex-clear-filter");
    if (clearFilter) {
      clearFilter.addEventListener("click", function () {
        state.filter = "all";
        renderList(root, state.cache || exercises);
      });
    }

    root.querySelectorAll("[data-filter]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.filter = chip.getAttribute("data-filter") || "all";
        renderList(root, state.cache || exercises);
      });
    });

    root.querySelectorAll("[data-ex-id]").forEach(function (row) {
      row.addEventListener("click", function () {
        state.mode = "detail";
        state.selectedId = row.getAttribute("data-ex-id");
        paint(root);
      });
    });

    var addBtn = root.querySelector("#ex-add-btn");
    if (addBtn) addBtn.addEventListener("click", goAdd);
    var emptyAdd = root.querySelector("#ex-empty-add");
    if (emptyAdd) emptyAdd.addEventListener("click", goAdd);
  }

  function renderDetail(root, exercises) {
    var ex = findById(exercises, state.selectedId);
    setBackVisible(true);
    syncTitle();
    wireBack(root, function () {
      state.mode = "list";
      state.selectedId = null;
      paint(root);
    });

    if (!ex) {
      root.innerHTML =
        emptyStateHtml({
          title: "Exercise not found",
          hint: "It may have been deleted. Pick another from the list.",
          actionsHtml:
            '<button type="button" class="btn secondary block" id="ex-back">Back to list</button>',
        });
      var back = root.querySelector("#ex-back");
      if (back) {
        back.addEventListener("click", function () {
          state.mode = "list";
          state.selectedId = null;
          paint(root);
        });
      }
      return;
    }

    var musclesArr = ex.muscles || [];
    var musclesHtml = musclesArr.length
      ? '<div class="chip-row" role="list" aria-label="Muscles" style="margin-bottom:0">' +
        musclesArr
          .map(function (m) {
            return (
              '<span class="chip" role="listitem" style="cursor:default;min-height:32px;padding:6px 12px">' +
              esc(m) +
              "</span>"
            );
          })
          .join("") +
        "</div>"
      : '<p class="muted" style="margin:0">No muscles listed</p>';

    var cuesText = ex.cues ? String(ex.cues).trim() : "";
    var cuesHtml = cuesText
      ? '<div style="white-space:pre-wrap;font-size:0.95rem;line-height:1.55">' +
        esc(cuesText) +
        "</div>"
      : '<p class="muted" style="margin:0">No cues yet. Add form reminders when you create a custom exercise.</p>';

    var custom = isCustom(ex);
    var deleteHtml = custom
      ? '<button type="button" class="btn danger block" id="ex-delete" style="margin-top:16px" aria-label="Delete custom exercise">Delete</button>'
      : "";

    root.innerHTML =
      '<article class="card" aria-labelledby="ex-detail-name">' +
      '<p class="muted small" style="margin:0 0 6px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700">' +
      esc(categoryLabel(ex.category)) +
      (custom ? " · Custom" : "") +
      "</p>" +
      '<h2 id="ex-detail-name" style="text-transform:none;letter-spacing:0;color:var(--text);font-size:1.25rem;margin-bottom:16px">' +
      esc(ex.name) +
      "</h2>" +
      '<section class="field" aria-labelledby="ex-cues-lbl">' +
      '<span class="lbl" id="ex-cues-lbl">Cues</span>' +
      cuesHtml +
      "</section>" +
      '<hr class="weld" />' +
      '<section class="field" style="margin-bottom:0" aria-labelledby="ex-muscles-lbl">' +
      '<span class="lbl" id="ex-muscles-lbl">Muscles</span>' +
      musclesHtml +
      "</section>" +
      deleteHtml +
      "</article>";

    var del = root.querySelector("#ex-delete");
    if (del) {
      del.addEventListener("click", function () {
        if (!confirm("Delete this custom exercise?")) return;
        if (SL.store && typeof SL.store.deleteCustomExercise === "function") {
          SL.store.deleteCustomExercise(ex.id);
        }
        state.mode = "list";
        state.selectedId = null;
        state.cache = null;
        if (typeof SL.refresh === "function") SL.refresh();
        else paint(root, { force: true });
      });
    }
  }

  function renderAdd(root) {
    setBackVisible(true);
    syncTitle();
    wireBack(root, function () {
      state.mode = "list";
      state.formError = "";
      paint(root);
    });

    var errHtml = state.formError
      ? '<p class="muted" id="ex-form-error" role="alert" style="color:var(--red);margin:0 0 12px">' +
        esc(state.formError) +
        "</p>"
      : "";

    root.innerHTML =
      '<form class="card" id="ex-add-form" novalidate>' +
      '<h2 id="ex-add-heading">Add custom exercise</h2>' +
      '<p class="muted small" style="margin:-4px 0 14px">Name is required. Muscles and cues help you find it later.</p>' +
      errHtml +
      '<label class="field" for="ex-name">' +
      '<span class="lbl">Name <span class="muted">(required)</span></span>' +
      '<input type="text" id="ex-name" name="name" required autocomplete="off" enterkeyhint="next" aria-required="true" aria-describedby="ex-name-hint" placeholder="e.g. Weighted chin-up" />' +
      '<span class="muted small" id="ex-name-hint" style="display:block;margin-top:6px">Shown in programs and the log.</span>' +
      "</label>" +
      '<label class="field" for="ex-category">' +
      '<span class="lbl">Category</span>' +
      '<select id="ex-category" name="category" aria-describedby="ex-cat-hint">' +
      '<option value="accessory">Accessory</option>' +
      '<option value="competition">Competition</option>' +
      "</select>" +
      '<span class="muted small" id="ex-cat-hint" style="display:block;margin-top:6px">Accessory is the usual pick for custom work.</span>' +
      "</label>" +
      '<label class="field" for="ex-muscles">' +
      '<span class="lbl">Muscles</span>' +
      '<input type="text" id="ex-muscles" name="muscles" placeholder="lats, biceps, core" autocomplete="off" enterkeyhint="next" aria-describedby="ex-muscles-hint" />' +
      '<span class="muted small" id="ex-muscles-hint" style="display:block;margin-top:6px">Comma-separated. Used by search.</span>' +
      "</label>" +
      '<label class="field" for="ex-cues">' +
      '<span class="lbl">Cues</span>' +
      '<textarea id="ex-cues" name="cues" rows="4" placeholder="Brace hard. Pull elbows to hips." aria-describedby="ex-cues-hint"></textarea>' +
      '<span class="muted small" id="ex-cues-hint" style="display:block;margin-top:6px">Short form reminders for the rack.</span>' +
      "</label>" +
      '<div class="stack" style="margin-top:4px">' +
      '<button type="submit" class="btn block" id="ex-save">Save exercise</button>' +
      '<button type="button" class="btn secondary block" id="ex-cancel">Cancel</button>' +
      "</div>" +
      "</form>";

    var form = root.querySelector("#ex-add-form");
    var nameEl = root.querySelector("#ex-name");
    if (nameEl) {
      setTimeout(function () {
        if (nameEl && document.body.contains(nameEl)) nameEl.focus();
      }, 0);
    }

    function saveExercise(ev) {
      if (ev) ev.preventDefault();
      var catEl = root.querySelector("#ex-category");
      var musEl = root.querySelector("#ex-muscles");
      var cuesEl = root.querySelector("#ex-cues");
      var name = nameEl ? String(nameEl.value || "").trim() : "";
      if (!name) {
        state.formError = "Enter a name to save.";
        renderAdd(root);
        var again = root.querySelector("#ex-name");
        if (again) again.focus();
        return;
      }
      var musclesRaw = musEl ? String(musEl.value || "") : "";
      var muscles = musclesRaw
        .split(",")
        .map(function (m) {
          return m.trim();
        })
        .filter(Boolean);
      var ex = {
        name: name,
        category: catEl ? catEl.value : "accessory",
        muscles: muscles,
        cues: cuesEl ? String(cuesEl.value || "").trim() : "",
      };
      if (SL.store && typeof SL.store.upsertCustomExercise === "function") {
        SL.store.upsertCustomExercise(ex);
      }
      state.mode = "list";
      state.formError = "";
      state.cache = null;
      if (typeof SL.refresh === "function") SL.refresh();
      else paint(root, { force: true });
    }

    if (form) {
      form.addEventListener("submit", saveExercise);
    }

    var cancel = root.querySelector("#ex-cancel");
    if (cancel) {
      cancel.addEventListener("click", function () {
        state.mode = "list";
        state.formError = "";
        paint(root);
      });
    }
  }

  function paint(root, opts) {
    if (!root) return;
    opts = opts || {};
    if (state.mode === "add") {
      renderAdd(root);
      return;
    }

    function show(list) {
      state.cache = list;
      if (state.mode === "detail") renderDetail(root, list);
      else renderList(root, list);
    }

    if (state.cache && !opts.force) {
      show(state.cache);
      // Refresh in background in case catalog just loaded
      getExercises().then(function (exercises) {
        var list = Array.isArray(exercises) ? exercises : [];
        state.cache = list;
        if (state.mode === "detail" || state.mode === "list") {
          if (document.activeElement && document.activeElement.id === "ex-search") {
            return; // avoid stomping search focus mid-type
          }
          show(list);
        }
      });
      return;
    }

    root.innerHTML = '<div class="empty muted" role="status">Loading…</div>';
    getExercises().then(
      function (exercises) {
        show(Array.isArray(exercises) ? exercises : []);
      },
      function () {
        root.innerHTML = emptyStateHtml({
          title: "Could not load exercises",
          hint: "Check your connection, then open this tab again.",
        });
      }
    );
  }

  SL.views.exercises = {
    title: function () {
      if (state.mode === "detail") return "Exercise";
      if (state.mode === "add") return "Add exercise";
      return "Exercises";
    },
    render: function (root) {
      // Reset nested mode when tab is freshly opened only if already on list
      // Keep state across refresh after save/delete
      paint(root);
    },
  };
})();
