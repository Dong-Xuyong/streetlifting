(function () {
  "use strict";

  var SL = (window.SL = window.SL || {});
  SL.views = SL.views || {};

  var EQUIPMENT_OPTIONS = [
    "bodyweight",
    "belt",
    "barbell",
    "dumbbell",
    "machine",
    "cable",
    "band",
    "other",
  ];

  var state = {
    mode: "list", // list | detail | add
    selectedId: null,
    query: "",
    filter: "all", // all | competition | accessory
    equipmentFilter: "",
    muscleFilter: "",
    favoritesOnly: false,
    cache: null,
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

  function favoriteIds() {
    if (!SL.store || typeof SL.store.listFavorites !== "function") return [];
    try {
      var list = SL.store.listFavorites();
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function isFavorite(exerciseId) {
    if (exerciseId == null || exerciseId === "") return false;
    if (SL.store && typeof SL.store.getExerciseSettings === "function") {
      try {
        var es = SL.store.getExerciseSettings(exerciseId);
        if (es && es.favorite) return true;
      } catch (e) {}
    }
    var favs = favoriteIds();
    for (var i = 0; i < favs.length; i++) {
      if (favs[i] === exerciseId) return true;
    }
    return false;
  }

  function toggleFavorite(exerciseId) {
    if (!SL.store || typeof SL.store.toggleFavorite !== "function") return false;
    try {
      return !!SL.store.toggleFavorite(exerciseId);
    } catch (e) {
      return false;
    }
  }

  function displayUnit() {
    var data = SL.store && typeof SL.store.get === "function" ? SL.store.get() : null;
    var unit = data && data.settings && data.settings.unit;
    return unit === "lb" ? "lb" : "kg";
  }

  function formatLoad(kg) {
    var n = Number(kg);
    if (!isFinite(n)) return "—";
    var unit = displayUnit();
    var v = unit === "lb" ? n * 2.2046226218 : n;
    var rounded = Math.round(v * 10) / 10;
    return String(rounded) + " " + unit;
  }

  function formatRest(sec) {
    var n = Math.round(Number(sec) || 0);
    if (n < 0) n = 0;
    var m = Math.floor(n / 60);
    var s = n % 60;
    var ss = s < 10 ? "0" + s : String(s);
    return m + ":" + ss + " (" + n + "s)";
  }

  function equipmentLabel(eq) {
    if (!eq) return "Other";
    if (eq === "bodyweight") return "Bodyweight";
    if (eq === "belt") return "Belt";
    if (eq === "barbell") return "Barbell";
    if (eq === "dumbbell") return "Dumbbell";
    if (eq === "machine") return "Machine";
    if (eq === "cable") return "Cable";
    if (eq === "band") return "Band";
    if (eq === "other") return "Other";
    return String(eq).charAt(0).toUpperCase() + String(eq).slice(1);
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
    var equipment = String(ex.equipment || "").toLowerCase();
    var instructions = Array.isArray(ex.instructions)
      ? ex.instructions.join(" ").toLowerCase()
      : "";
    return (
      name.indexOf(q) !== -1 ||
      muscles.indexOf(q) !== -1 ||
      cues.indexOf(q) !== -1 ||
      equipment.indexOf(q) !== -1 ||
      instructions.indexOf(q) !== -1
    );
  }

  function matchesCategory(ex, filter) {
    if (filter === "all") return true;
    return ex.category === filter;
  }

  function matchesEquipment(ex, equipmentFilter) {
    if (!equipmentFilter) return true;
    return String(ex.equipment || "other") === equipmentFilter;
  }

  function matchesMuscle(ex, muscleFilter) {
    if (!muscleFilter) return true;
    var muscles = ex.muscles || [];
    for (var i = 0; i < muscles.length; i++) {
      if (muscles[i] === muscleFilter) return true;
    }
    return false;
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

  function collectMuscles(exercises) {
    var seen = {};
    var out = [];
    for (var i = 0; i < exercises.length; i++) {
      var muscles = (exercises[i] && exercises[i].muscles) || [];
      for (var j = 0; j < muscles.length; j++) {
        var m = muscles[j];
        if (m == null || m === "") continue;
        var key = String(m);
        if (seen[key]) continue;
        seen[key] = true;
        out.push(key);
      }
    }
    out.sort(function (a, b) {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
    return out;
  }

  function hasActiveExtraFilters() {
    return !!(
      state.equipmentFilter ||
      state.muscleFilter ||
      state.favoritesOnly ||
      (state.filter && state.filter !== "all")
    );
  }

  function clearExtraFilters() {
    state.filter = "all";
    state.equipmentFilter = "";
    state.muscleFilter = "";
    state.favoritesOnly = false;
  }

  function filterExercises(exercises) {
    var q = String(state.query || "").trim().toLowerCase();
    var out = [];
    for (var i = 0; i < exercises.length; i++) {
      var ex = exercises[i];
      if (!ex) continue;
      if (!matchesCategory(ex, state.filter)) continue;
      if (!matchesQuery(ex, q)) continue;
      if (!matchesEquipment(ex, state.equipmentFilter)) continue;
      if (!matchesMuscle(ex, state.muscleFilter)) continue;
      if (state.favoritesOnly && !isFavorite(ex.id)) continue;
      out.push(ex);
    }
    return out;
  }

  function splitFavorites(list) {
    var favs = [];
    var rest = [];
    for (var i = 0; i < list.length; i++) {
      if (isFavorite(list[i].id)) favs.push(list[i]);
      else rest.push(list[i]);
    }
    return { favorites: favs, rest: rest };
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
      (opts.hint ? '<p class="hint">' + esc(opts.hint) + "</p>" : "") +
      (actions ? '<div class="actions">' + actions + "</div>" : "") +
      "</div>"
    );
  }

  function favButtonHtml(exerciseId, opts) {
    opts = opts || {};
    var on = isFavorite(exerciseId);
    var cls = "ex-fav" + (on ? " on" : "");
    if (opts.detail) cls += " ex-fav-detail";
    var label = on ? "Remove from favorites" : "Add to favorites";
    var glyph = on ? "\u2605" : "\u2606";
    return (
      '<button type="button" class="' +
      cls +
      '" data-fav-id="' +
      esc(exerciseId) +
      '" aria-label="' +
      esc(label) +
      '" aria-pressed="' +
      (on ? "true" : "false") +
      '" title="' +
      esc(label) +
      '">' +
      glyph +
      "</button>"
    );
  }

  function exerciseRowHtml(ex) {
    var muscles = (ex.muscles || []).map(esc).join(", ");
    var custom = isCustom(ex);
    var badge = custom ? ' <span class="badge">Custom</span>' : "";
    var cat = categoryLabel(ex.category);
    var eq = equipmentLabel(ex.equipment);
    var metaParts = [];
    if (muscles) metaParts.push(muscles);
    else metaParts.push(esc(cat));
    if (ex.equipment) metaParts.push(esc(eq));
    var aria =
      esc(ex.name) +
      (custom ? ", custom" : "") +
      ", " +
      esc(cat) +
      (muscles ? ", " + muscles : "") +
      (isFavorite(ex.id) ? ", favorite" : "");
    return (
      '<div class="ex-row-wrap">' +
      favButtonHtml(ex.id) +
      '<button type="button" class="list-item session-card ex-row-btn" data-ex-id="' +
      esc(ex.id) +
      '" aria-label="' +
      aria +
      '">' +
      '<div class="ex-row-main">' +
      '<div class="name">' +
      esc(ex.name) +
      badge +
      "</div>" +
      '<div class="meta">' +
      metaParts.join(" · ") +
      "</div>" +
      "</div>" +
      '<span class="chev" aria-hidden="true">›</span>' +
      "</button>" +
      "</div>"
    );
  }

  function renderRows(list) {
    var html = "";
    for (var i = 0; i < list.length; i++) {
      html += exerciseRowHtml(list[i]);
    }
    return html;
  }

  function renderGroupedList(filtered, showGroups) {
    if (!filtered.length) return "";

    var split = splitFavorites(filtered);
    var html = "";

    if (split.favorites.length && !state.favoritesOnly) {
      html +=
        '<div class="ex-fav-section">' +
        '<div class="ex-fav-heading">Favorites</div>' +
        renderRows(split.favorites) +
        "</div>";
    }

    var body = state.favoritesOnly ? filtered : split.rest;
    if (!body.length) return html;

    if (!showGroups || state.favoritesOnly) {
      if (split.favorites.length && !state.favoritesOnly) {
        html += '<div class="ex-fav-heading ex-fav-heading-rest">All exercises</div>';
      }
      return html + renderRows(body);
    }

    var groups = groupByCategory(body);
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      html +=
        '<div class="card ex-group">' +
        '<div class="card-head ex-group-head">' +
        '<h2 class="card-title">' +
        esc(group.label) +
        "</h2>" +
        '<span class="muted small" aria-hidden="true">' +
        group.items.length +
        "</span>" +
        "</div>" +
        renderRows(group.items) +
        "</div>";
    }
    return html;
  }

  function filterChipHtml(opts) {
    var active = !!opts.active;
    return (
      '<button type="button" class="ex-filter-chip' +
      (active ? " active" : "") +
      '" data-' +
      esc(opts.dataAttr) +
      '="' +
      esc(opts.value) +
      '" aria-pressed="' +
      (active ? "true" : "false") +
      '">' +
      esc(opts.label) +
      "</button>"
    );
  }

  function renderFiltersHtml(exercises) {
    var muscles = collectMuscles(exercises);
    var i;
    var equipHtml = "";
    for (i = 0; i < EQUIPMENT_OPTIONS.length; i++) {
      var eq = EQUIPMENT_OPTIONS[i];
      equipHtml += filterChipHtml({
        dataAttr: "equipment",
        value: eq,
        label: equipmentLabel(eq),
        active: state.equipmentFilter === eq,
      });
    }

    var muscleHtml = "";
    for (i = 0; i < muscles.length; i++) {
      muscleHtml += filterChipHtml({
        dataAttr: "muscle",
        value: muscles[i],
        label: muscles[i],
        active: state.muscleFilter === muscles[i],
      });
    }

    var favActive = state.favoritesOnly;
    var clearHtml = hasActiveExtraFilters()
      ? '<button type="button" class="ex-filter-clear" id="ex-filters-clear">Clear filters</button>'
      : "";

    return (
      '<div class="ex-filters" aria-label="Exercise filters">' +
      '<div class="ex-filter-group">' +
      '<div class="ex-filter-label">Favorites</div>' +
      '<div class="ex-filter-chips">' +
      filterChipHtml({
        dataAttr: "fav-only",
        value: "1",
        label: "Favorites",
        active: favActive,
      }) +
      "</div>" +
      "</div>" +
      '<div class="ex-filter-group">' +
      '<div class="ex-filter-label">Equipment</div>' +
      '<div class="ex-filter-chips">' +
      equipHtml +
      "</div>" +
      "</div>" +
      (muscles.length
        ? '<div class="ex-filter-group">' +
          '<div class="ex-filter-label">Muscle</div>' +
          '<div class="ex-filter-chips">' +
          muscleHtml +
          "</div>" +
          "</div>"
        : "") +
      clearHtml +
      "</div>"
    );
  }

  function wireFavoriteButtons(root, exercises, onToggle) {
    var buttons = root.querySelectorAll("[data-fav-id]");
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function (ev) {
          if (ev) {
            ev.preventDefault();
            if (ev.stopPropagation) ev.stopPropagation();
          }
          var id = btn.getAttribute("data-fav-id");
          if (!id) return;
          toggleFavorite(id);
          if (typeof onToggle === "function") onToggle();
          else renderList(root, state.cache || exercises);
        });
      })(buttons[i]);
    }
  }

  function renderList(root, exercises) {
    setBackVisible(false);
    syncTitle();
    var q = String(state.query || "").trim().toLowerCase();
    var hasQuery = !!q;
    var filtered = filterExercises(exercises);
    var counts = countByCategory(exercises);
    var showGroups =
      state.filter === "all" &&
      !hasQuery &&
      !state.equipmentFilter &&
      !state.muscleFilter &&
      !state.favoritesOnly;

    var chips = [
      { id: "all", label: "All", count: counts.all },
      { id: "competition", label: "Competition", count: counts.competition },
      { id: "accessory", label: "Accessory", count: counts.accessory },
    ];

    var chipsHtml = "";
    for (var ci = 0; ci < chips.length; ci++) {
      var c = chips[ci];
      var active = state.filter === c.id;
      chipsHtml +=
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
        "</button>";
    }

    var listHtml;
    var catalogEmpty = !exercises.length;
    var searchEmpty = !filtered.length && !catalogEmpty;
    var filtersActive = hasActiveExtraFilters() || hasQuery;

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
          : "Nothing matches these filters. Clear filters or add a custom exercise.",
        actionsHtml:
          (filtersActive
            ? '<button type="button" class="btn secondary block" id="ex-clear-all">Clear filters</button>'
            : "") +
          '<button type="button" class="btn block" id="ex-empty-add">Add custom exercise</button>',
      });
    } else {
      var countLabel =
        filtered.length === 1 ? "1 exercise" : filtered.length + " exercises";
      listHtml =
        '<p class="muted small ex-result-count" id="ex-result-count" aria-live="polite">' +
        esc(countLabel) +
        (filtersActive ? " matching" : "") +
        "</p>" +
        '<div id="ex-results">' +
        renderGroupedList(filtered, showGroups) +
        "</div>";
    }

    var clearBtn = hasQuery
      ? '<button type="button" class="btn ghost sm" id="ex-search-clear" aria-label="Clear search">Clear</button>'
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
      (catalogEmpty ? "" : renderFiltersHtml(exercises)) +
      '<div id="ex-list">' +
      listHtml +
      "</div>" +
      (catalogEmpty
        ? ""
        : '<button type="button" class="btn block ex-add-footer" id="ex-add-btn">Add custom exercise</button>');

    function goAdd() {
      state.mode = "add";
      state.formError = "";
      paint(root);
    }

    function refreshList() {
      renderList(root, state.cache || exercises);
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

    function clearAllFilters() {
      state.query = "";
      clearExtraFilters();
      renderList(root, state.cache || exercises);
      var again = root.querySelector("#ex-search");
      if (again) again.focus();
    }

    var clearAll = root.querySelector("#ex-clear-all");
    if (clearAll) clearAll.addEventListener("click", clearAllFilters);

    var filtersClear = root.querySelector("#ex-filters-clear");
    if (filtersClear) {
      filtersClear.addEventListener("click", function () {
        clearExtraFilters();
        renderList(root, state.cache || exercises);
      });
    }

    var filterChips = root.querySelectorAll("[data-filter]");
    for (var fi = 0; fi < filterChips.length; fi++) {
      (function (chip) {
        chip.addEventListener("click", function () {
          state.filter = chip.getAttribute("data-filter") || "all";
          renderList(root, state.cache || exercises);
        });
      })(filterChips[fi]);
    }

    var equipChips = root.querySelectorAll("[data-equipment]");
    for (var ei = 0; ei < equipChips.length; ei++) {
      (function (chip) {
        chip.addEventListener("click", function () {
          var val = chip.getAttribute("data-equipment") || "";
          state.equipmentFilter = state.equipmentFilter === val ? "" : val;
          renderList(root, state.cache || exercises);
        });
      })(equipChips[ei]);
    }

    var muscleChips = root.querySelectorAll("[data-muscle]");
    for (var mi = 0; mi < muscleChips.length; mi++) {
      (function (chip) {
        chip.addEventListener("click", function () {
          var val = chip.getAttribute("data-muscle") || "";
          state.muscleFilter = state.muscleFilter === val ? "" : val;
          renderList(root, state.cache || exercises);
        });
      })(muscleChips[mi]);
    }

    var favOnlyChips = root.querySelectorAll("[data-fav-only]");
    for (var foi = 0; foi < favOnlyChips.length; foi++) {
      (function (chip) {
        chip.addEventListener("click", function () {
          state.favoritesOnly = !state.favoritesOnly;
          renderList(root, state.cache || exercises);
        });
      })(favOnlyChips[foi]);
    }

    var rows = root.querySelectorAll("[data-ex-id]");
    for (var ri = 0; ri < rows.length; ri++) {
      (function (row) {
        row.addEventListener("click", function () {
          state.mode = "detail";
          state.selectedId = row.getAttribute("data-ex-id");
          paint(root);
        });
      })(rows[ri]);
    }

    wireFavoriteButtons(root, exercises, refreshList);

    var addBtn = root.querySelector("#ex-add-btn");
    if (addBtn) addBtn.addEventListener("click", goAdd);
    var emptyAdd = root.querySelector("#ex-empty-add");
    if (emptyAdd) emptyAdd.addEventListener("click", goAdd);
  }

  function instructionsHtml(ex) {
    var steps = Array.isArray(ex.instructions) ? ex.instructions : [];
    var items = [];
    for (var i = 0; i < steps.length; i++) {
      var step = String(steps[i] == null ? "" : steps[i]).trim();
      if (!step) continue;
      items.push("<li>" + esc(step) + "</li>");
    }
    if (!items.length) {
      return '<p class="muted ex-instructions-empty">No step-by-step instructions yet.</p>';
    }
    return '<ol class="ex-instructions">' + items.join("") + "</ol>";
  }

  function bestSetHtml(exerciseId) {
    if (!SL.store || typeof SL.store.bestSet !== "function") return "";
    var best = null;
    try {
      best = SL.store.bestSet(exerciseId);
    } catch (e) {
      best = null;
    }
    if (!best) return "";
    var parts = [
      formatLoad(best.loadKg) + " × " + String(best.reps != null ? best.reps : "—"),
    ];
    if (best.e1rm != null && isFinite(Number(best.e1rm))) {
      parts.push("e1RM " + formatLoad(best.e1rm));
    }
    if (best.dateISO) parts.push(String(best.dateISO));
    return (
      '<section class="field ex-best" aria-labelledby="ex-best-lbl">' +
      '<span class="lbl" id="ex-best-lbl">Best set</span>' +
      '<p class="ex-best-value">' +
      esc(parts.join(" · ")) +
      "</p>" +
      "</section>"
    );
  }

  function prRecordsHtml(exerciseId) {
    if (!(SL.prs && typeof SL.prs.bestFor === "function")) return "";
    var records = null;
    try {
      records = SL.prs.bestFor(exerciseId);
    } catch (e) {
      return "";
    }
    if (!records) return "";

    var rows = [];
    var kinds = [
      { key: "weight", label: "Heaviest" },
      { key: "e1rm", label: "Best e1RM" },
      { key: "volume", label: "Best volume" },
    ];
    for (var i = 0; i < kinds.length; i++) {
      var k = kinds[i];
      var rec = records[k.key];
      if (!rec) continue;
      var valueText = "";
      if (k.key === "volume") {
        var vol = Number(rec.value);
        valueText = isFinite(vol)
          ? String(Math.round(vol * 10) / 10) + " kg·reps"
          : "—";
      } else {
        valueText = formatLoad(rec.value);
      }
      var dateBit = rec.dateISO ? " · " + String(rec.dateISO) : "";
      var badge = "";
      if (SL.prs && typeof SL.prs.badgeHtml === "function") {
        try {
          badge = SL.prs.badgeHtml([{ kind: k.key, value: rec.value }]) || "";
        } catch (e2) {
          badge = "";
        }
      }
      rows.push(
        '<div class="ex-pr-row">' +
          '<span class="ex-pr-label">' +
          esc(k.label) +
          "</span>" +
          '<span class="ex-pr-value">' +
          esc(valueText) +
          esc(dateBit) +
          "</span>" +
          badge +
          "</div>"
      );
    }
    if (!rows.length) return "";
    return (
      '<section class="field ex-prs" aria-labelledby="ex-prs-lbl">' +
      '<span class="lbl" id="ex-prs-lbl">Personal records</span>' +
      '<div class="ex-pr-list">' +
      rows.join("") +
      "</div>" +
      "</section>"
    );
  }

  function restSourceLabel(exerciseId, ex) {
    var es =
      SL.store && typeof SL.store.getExerciseSettings === "function"
        ? SL.store.getExerciseSettings(exerciseId)
        : { restSeconds: null, favorite: false };
    if (es && es.restSeconds != null) return "Custom override";
    if (ex && ex.defaultRestSeconds != null && isFinite(Number(ex.defaultRestSeconds))) {
      return "Exercise default";
    }
    return "Global default";
  }

  function restRowHtml(ex) {
    var effective = 180;
    if (SL.store && typeof SL.store.restSecondsFor === "function") {
      try {
        effective = SL.store.restSecondsFor(ex.id);
      } catch (e) {
        effective = 180;
      }
    }
    var es =
      SL.store && typeof SL.store.getExerciseSettings === "function"
        ? SL.store.getExerciseSettings(ex.id)
        : { restSeconds: null };
    var inputVal = es && es.restSeconds != null ? es.restSeconds : effective;
    var hasOverride = es && es.restSeconds != null;
    return (
      '<section class="ex-rest-row" aria-labelledby="ex-rest-lbl">' +
      '<span class="lbl" id="ex-rest-lbl">Rest timer</span>' +
      '<p class="muted small ex-rest-effective">Effective ' +
      esc(formatRest(effective)) +
      " · " +
      esc(restSourceLabel(ex.id, ex)) +
      "</p>" +
      '<div class="ex-rest-controls">' +
      '<label class="ex-rest-field" for="ex-rest-sec">' +
      '<span class="muted small">Seconds</span>' +
      '<input type="number" id="ex-rest-sec" class="ex-rest-input" min="0" step="5" inputmode="numeric" value="' +
      esc(String(inputVal)) +
      '" aria-describedby="ex-rest-hint" />' +
      "</label>" +
      '<button type="button" class="btn sm" id="ex-rest-save">Set</button>' +
      '<button type="button" class="btn ghost sm" id="ex-rest-reset"' +
      (hasOverride ? "" : " disabled") +
      ">Reset</button>" +
      "</div>" +
      '<p class="muted small" id="ex-rest-hint">Override rest for this lift, or reset to the catalog / global default.</p>' +
      "</section>"
    );
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
      root.innerHTML = emptyStateHtml({
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
      ? '<div class="chip-row ex-muscle-row" role="list" aria-label="Muscles">' +
        musclesArr
          .map(function (m) {
            return (
              '<span class="chip ex-muscle-chip" role="listitem">' + esc(m) + "</span>"
            );
          })
          .join("") +
        "</div>"
      : '<p class="muted">No muscles listed</p>';

    var cuesText = ex.cues ? String(ex.cues).trim() : "";
    var cuesHtml = cuesText
      ? '<div class="ex-cues">' + esc(cuesText) + "</div>"
      : '<p class="muted">No cues yet. Add form reminders when you create a custom exercise.</p>';

    var custom = isCustom(ex);
    var deleteHtml = custom
      ? '<button type="button" class="btn danger block ex-delete-btn" id="ex-delete" aria-label="Delete custom exercise">Delete</button>'
      : "";

    var equipmentHtml =
      '<p class="ex-equipment"><span class="lbl">Equipment</span> ' +
      esc(equipmentLabel(ex.equipment || "other")) +
      "</p>";

    root.innerHTML =
      '<article class="card ex-detail" aria-labelledby="ex-detail-name">' +
      '<div class="ex-detail-head">' +
      '<div class="ex-detail-titles">' +
      '<p class="muted small ex-detail-kicker">' +
      esc(categoryLabel(ex.category)) +
      (custom ? " · Custom" : "") +
      "</p>" +
      '<h2 id="ex-detail-name" class="ex-detail-name">' +
      esc(ex.name) +
      "</h2>" +
      "</div>" +
      favButtonHtml(ex.id, { detail: true }) +
      "</div>" +
      equipmentHtml +
      '<section class="field" aria-labelledby="ex-cues-lbl">' +
      '<span class="lbl" id="ex-cues-lbl">Cues</span>' +
      cuesHtml +
      "</section>" +
      '<section class="field" aria-labelledby="ex-steps-lbl">' +
      '<span class="lbl" id="ex-steps-lbl">Instructions</span>' +
      instructionsHtml(ex) +
      "</section>" +
      '<hr class="weld" />' +
      restRowHtml(ex) +
      '<hr class="weld" />' +
      bestSetHtml(ex.id) +
      prRecordsHtml(ex.id) +
      '<section class="field ex-muscles-section" aria-labelledby="ex-muscles-lbl">' +
      '<span class="lbl" id="ex-muscles-lbl">Muscles</span>' +
      musclesHtml +
      "</section>" +
      deleteHtml +
      "</article>";

    wireFavoriteButtons(root, exercises, function () {
      renderDetail(root, state.cache || exercises);
    });

    var restSave = root.querySelector("#ex-rest-save");
    var restInput = root.querySelector("#ex-rest-sec");
    var restReset = root.querySelector("#ex-rest-reset");

    function applyRest(seconds) {
      if (!SL.store || typeof SL.store.setExerciseSettings !== "function") return;
      SL.store.setExerciseSettings(ex.id, { restSeconds: seconds });
      renderDetail(root, state.cache || exercises);
    }

    if (restSave && restInput) {
      restSave.addEventListener("click", function () {
        var n = Number(restInput.value);
        if (!isFinite(n) || n < 0) {
          restInput.focus();
          return;
        }
        applyRest(Math.round(n));
      });
      restInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          restSave.click();
        }
      });
    }

    if (restReset) {
      restReset.addEventListener("click", function () {
        applyRest(null);
      });
    }

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

  function equipmentOptionsHtml(selected) {
    var html = "";
    for (var i = 0; i < EQUIPMENT_OPTIONS.length; i++) {
      var eq = EQUIPMENT_OPTIONS[i];
      html +=
        '<option value="' +
        esc(eq) +
        '"' +
        (selected === eq ? " selected" : "") +
        ">" +
        esc(equipmentLabel(eq)) +
        "</option>";
    }
    return html;
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
      ? '<p class="muted ex-form-error" id="ex-form-error" role="alert">' +
        esc(state.formError) +
        "</p>"
      : "";

    root.innerHTML =
      '<form class="card" id="ex-add-form" novalidate>' +
      '<h2 id="ex-add-heading">Add custom exercise</h2>' +
      '<p class="muted small ex-form-lead">Name is required. Equipment and instructions match the catalog shape.</p>' +
      errHtml +
      '<label class="field" for="ex-name">' +
      '<span class="lbl">Name <span class="muted">(required)</span></span>' +
      '<input type="text" id="ex-name" name="name" required autocomplete="off" enterkeyhint="next" aria-required="true" aria-describedby="ex-name-hint" placeholder="e.g. Weighted chin-up" />' +
      '<span class="muted small ex-form-hint" id="ex-name-hint">Shown in programs and the log.</span>' +
      "</label>" +
      '<label class="field" for="ex-category">' +
      '<span class="lbl">Category</span>' +
      '<select id="ex-category" name="category" aria-describedby="ex-cat-hint">' +
      '<option value="accessory">Accessory</option>' +
      '<option value="competition">Competition</option>' +
      "</select>" +
      '<span class="muted small ex-form-hint" id="ex-cat-hint">Accessory is the usual pick for custom work.</span>' +
      "</label>" +
      '<label class="field" for="ex-equipment">' +
      '<span class="lbl">Equipment</span>' +
      '<select id="ex-equipment" name="equipment" aria-describedby="ex-equip-hint">' +
      equipmentOptionsHtml("other") +
      "</select>" +
      '<span class="muted small ex-form-hint" id="ex-equip-hint">Used by library filters.</span>' +
      "</label>" +
      '<label class="field" for="ex-muscles">' +
      '<span class="lbl">Muscles</span>' +
      '<input type="text" id="ex-muscles" name="muscles" placeholder="lats, biceps, core" autocomplete="off" enterkeyhint="next" aria-describedby="ex-muscles-hint" />' +
      '<span class="muted small ex-form-hint" id="ex-muscles-hint">Comma-separated. Used by search and muscle filters.</span>' +
      "</label>" +
      '<label class="field" for="ex-cues">' +
      '<span class="lbl">Cues</span>' +
      '<textarea id="ex-cues" name="cues" rows="3" placeholder="Brace hard. Pull elbows to hips." aria-describedby="ex-cues-hint"></textarea>' +
      '<span class="muted small ex-form-hint" id="ex-cues-hint">Short form reminders for the rack.</span>' +
      "</label>" +
      '<label class="field" for="ex-instructions">' +
      '<span class="lbl">Instructions</span>' +
      '<textarea id="ex-instructions" name="instructions" rows="5" placeholder="One step per line" aria-describedby="ex-instructions-hint"></textarea>' +
      '<span class="muted small ex-form-hint" id="ex-instructions-hint">One step per line. Shown as an ordered list.</span>' +
      "</label>" +
      '<div class="stack ex-add-actions">' +
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

    function parseInstructions(raw) {
      var lines = String(raw || "").split(/\r?\n/);
      var out = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line) out.push(line);
      }
      return out;
    }

    function saveExercise(ev) {
      if (ev) ev.preventDefault();
      var catEl = root.querySelector("#ex-category");
      var equipEl = root.querySelector("#ex-equipment");
      var musEl = root.querySelector("#ex-muscles");
      var cuesEl = root.querySelector("#ex-cues");
      var instrEl = root.querySelector("#ex-instructions");
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
      var equipment = equipEl ? String(equipEl.value || "other") : "other";
      if (EQUIPMENT_OPTIONS.indexOf(equipment) === -1) equipment = "other";
      var ex = {
        name: name,
        category: catEl ? catEl.value : "accessory",
        muscles: muscles,
        cues: cuesEl ? String(cuesEl.value || "").trim() : "",
        equipment: equipment,
        instructions: parseInstructions(instrEl ? instrEl.value : ""),
        defaultRestSeconds: null,
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
      getExercises().then(function (exercises) {
        var list = Array.isArray(exercises) ? exercises : [];
        state.cache = list;
        if (state.mode === "detail" || state.mode === "list") {
          if (document.activeElement && document.activeElement.id === "ex-search") {
            return;
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
      paint(root);
    },
  };
})();
