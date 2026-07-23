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
  };

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
    return cat || "";
  }

  function matchesQuery(ex, q) {
    if (!q) return true;
    var name = String(ex.name || "").toLowerCase();
    var muscles = (ex.muscles || []).join(" ").toLowerCase();
    return name.indexOf(q) !== -1 || muscles.indexOf(q) !== -1;
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

  function renderList(root, exercises) {
    setBackVisible(false);
    syncTitle();
    var q = String(state.query || "").trim().toLowerCase();
    var filtered = exercises.filter(function (ex) {
      return matchesFilter(ex, state.filter) && matchesQuery(ex, q);
    });

    var chips = [
      { id: "all", label: "All" },
      { id: "competition", label: "Competition" },
      { id: "accessory", label: "Accessory" },
    ];

    var chipsHtml = chips
      .map(function (c) {
        var active = state.filter === c.id ? " active" : "";
        return (
          '<button type="button" class="chip' +
          active +
          '" data-filter="' +
          esc(c.id) +
          '">' +
          esc(c.label) +
          "</button>"
        );
      })
      .join("");

    var listHtml;
    if (!filtered.length) {
      listHtml = '<div class="empty">No exercises match.</div>';
    } else {
      listHtml = filtered
        .map(function (ex) {
          var muscles = (ex.muscles || []).map(esc).join(", ");
          var badge = isCustom(ex)
            ? '<span class="badge">Custom</span>'
            : "";
          return (
            '<button type="button" class="session-card" data-ex-id="' +
            esc(ex.id) +
            '" style="width:100%;text-align:left">' +
            '<div class="head">' +
            '<span class="date">' +
            esc(ex.name) +
            badge +
            "</span>" +
            '<span class="muted small">' +
            esc(categoryLabel(ex.category)) +
            "</span>" +
            "</div>" +
            (muscles
              ? '<div class="ex-line">' + muscles + "</div>"
              : "") +
            "</button>"
          );
        })
        .join("");
    }

    root.innerHTML =
      '<label class="field">' +
      '<span class="lbl">Search</span>' +
      '<input type="text" id="ex-search" placeholder="Name or muscle…" value="' +
      esc(state.query) +
      '" autocomplete="off" />' +
      "</label>" +
      '<div class="chip-row" id="ex-chips">' +
      chipsHtml +
      "</div>" +
      '<div id="ex-list">' +
      listHtml +
      "</div>" +
      '<button type="button" class="btn block" id="ex-add-btn" style="margin-top:12px">Add custom exercise</button>';

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
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        state.mode = "add";
        paint(root);
      });
    }
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
        '<div class="empty">Exercise not found.</div>' +
        '<button type="button" class="btn secondary block" id="ex-back">Back</button>';
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

    var muscles = (ex.muscles || []).map(esc).join(", ") || "—";
    var custom = isCustom(ex);
    var deleteHtml = custom
      ? '<button type="button" class="btn danger block" id="ex-delete" style="margin-top:16px">Delete</button>'
      : "";

    root.innerHTML =
      '<div class="card">' +
      "<h2>" +
      esc(ex.name) +
      "</h2>" +
      '<p class="muted" style="margin-bottom:12px">' +
      esc(categoryLabel(ex.category)) +
      (custom ? ' · Custom' : "") +
      "</p>" +
      '<label class="field"><span class="lbl">Muscles</span>' +
      "<div>" +
      muscles +
      "</div></label>" +
      '<label class="field"><span class="lbl">Cues</span>' +
      '<div style="white-space:pre-wrap">' +
      (ex.cues ? esc(ex.cues) : "—") +
      "</div></label>" +
      deleteHtml +
      "</div>";

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
      paint(root);
    });

    root.innerHTML =
      '<div class="card">' +
      "<h2>Add custom exercise</h2>" +
      '<label class="field"><span class="lbl">Name</span>' +
      '<input type="text" id="ex-name" required autocomplete="off" /></label>' +
      '<label class="field"><span class="lbl">Category</span>' +
      '<select id="ex-category">' +
      '<option value="accessory">Accessory</option>' +
      '<option value="competition">Competition</option>' +
      "</select></label>" +
      '<label class="field"><span class="lbl">Muscles (comma-separated)</span>' +
      '<input type="text" id="ex-muscles" placeholder="e.g. lats, biceps" autocomplete="off" /></label>' +
      '<label class="field"><span class="lbl">Cues</span>' +
      '<textarea id="ex-cues" rows="4" placeholder="Form cues…"></textarea></label>' +
      '<button type="button" class="btn block" id="ex-save">Save</button>' +
      "</div>";

    var save = root.querySelector("#ex-save");
    if (save) {
      save.addEventListener("click", function () {
        var nameEl = root.querySelector("#ex-name");
        var catEl = root.querySelector("#ex-category");
        var musEl = root.querySelector("#ex-muscles");
        var cuesEl = root.querySelector("#ex-cues");
        var name = nameEl ? String(nameEl.value || "").trim() : "";
        if (!name) {
          if (nameEl) nameEl.focus();
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
        state.cache = null;
        if (typeof SL.refresh === "function") SL.refresh();
        else paint(root, { force: true });
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

    root.innerHTML = '<div class="empty muted">Loading…</div>';
    getExercises().then(
      function (exercises) {
        show(Array.isArray(exercises) ? exercises : []);
      },
      function () {
        root.innerHTML =
          '<div class="empty">Could not load exercises.</div>';
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
