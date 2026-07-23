/* Streetlifting — program list / edit view. */
(function () {
  "use strict";

  window.SL = window.SL || {};
  window.SL.views = window.SL.views || {};

  var state = {
    mode: "list", // list | edit
    programId: null,
    dayIndex: null, // null = program meta; number = editing that day
    exercises: null,
    exercisesError: null,
  };

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function refresh() {
    if (typeof SL.refresh === "function") SL.refresh();
  }

  function cloneProgram(p) {
    return JSON.parse(JSON.stringify(p));
  }

  function getEditingProgram() {
    if (!state.programId) return null;
    var list = SL.store.listPrograms();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.programId) return cloneProgram(list[i]);
    }
    return null;
  }

  function ensureExercises(cb) {
    if (state.exercises) {
      cb(state.exercises);
      return;
    }
    var result = SL.store.listExercises();
    if (result && typeof result.then === "function") {
      result
        .then(function (list) {
          state.exercises = Array.isArray(list) ? list : [];
          state.exercisesError = null;
          cb(state.exercises);
        })
        .catch(function (err) {
          state.exercisesError = (err && err.message) || "Failed to load exercises";
          state.exercises = [];
          cb(state.exercises);
        });
    } else {
      state.exercises = Array.isArray(result) ? result : [];
      cb(state.exercises);
    }
  }

  function exerciseName(id, catalog) {
    if (!catalog) return id;
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i].id === id) return catalog[i].name;
    }
    return id;
  }

  function findFacePullId(catalog) {
    var ids = ["face-pull", "face_pull", "facepull"];
    for (var i = 0; i < catalog.length; i++) {
      var id = catalog[i].id;
      if (ids.indexOf(id) >= 0) return id;
      var name = String(catalog[i].name || "").toLowerCase();
      if (name.indexOf("face pull") >= 0 || name.indexOf("face-pull") >= 0) return id;
    }
    return null;
  }

  function progEx(exerciseId, sets, repMin, repMax, progression, startLoadKg, linearIncrementKg) {
    var row = {
      exerciseId: exerciseId,
      sets: sets,
      repMin: repMin,
      repMax: repMax,
      progression: progression,
      startLoadKg: startLoadKg,
      linearIncrementKg: linearIncrementKg != null ? linearIncrementKg : 0,
    };
    return row;
  }

  function loadStarterTemplate() {
    ensureExercises(function (catalog) {
      var faceId = findFacePullId(catalog);
      var dayAEx = [
        progEx("pullup", 4, 4, 6, "double", 5, 0),
        progEx("dip", 4, 4, 6, "double", 5, 0),
      ];
      if (faceId) {
        dayAEx.push(progEx(faceId, 3, 10, 15, "double", 0, 0));
      }
      var dayBEx = [
        progEx("pullup", 5, 5, 8, "double", 5, 0),
        progEx("dip", 5, 5, 8, "double", 5, 0),
      ];
      if (faceId) {
        dayBEx.push(progEx(faceId, 3, 10, 15, "double", 0, 0));
      }

      var program = {
        id: uid(),
        name: "Double Progression Pull+Dip",
        active: false,
        days: [
          { id: uid(), name: "Day A", exercises: dayAEx },
          { id: uid(), name: "Day B", exercises: dayBEx },
        ],
      };
      SL.store.upsertProgram(program);
      SL.store.setActiveProgram(program.id);
      state.mode = "list";
      state.programId = null;
      state.dayIndex = null;
      refresh();
    });
  }

  function renderList(root) {
    var programs = SL.store.listPrograms();
    var html = "";

    html += '<div class="card">';
    html += "<h2>Programs</h2>";
    if (!programs.length) {
      html += '<p class="muted">No programs yet. Create one or load the starter template.</p>';
    } else {
      for (var i = 0; i < programs.length; i++) {
        var p = programs[i];
        var dayCount = (p.days && p.days.length) || 0;
        html += '<div class="session-card" data-action="edit" data-id="' + esc(p.id) + '" style="cursor:default">';
        html += '<div class="head">';
        html += '<span class="date">' + esc(p.name);
        if (p.active) html += '<span class="badge">Active</span>';
        html += "</span>";
        html += '<span class="muted small">' + dayCount + " day" + (dayCount === 1 ? "" : "s") + "</span>";
        html += "</div>";
        html += '<div class="row" style="flex-wrap:wrap;margin-top:8px">';
        if (!p.active) {
          html +=
            '<button type="button" class="btn sm secondary" data-action="set-active" data-id="' +
            esc(p.id) +
            '">Set Active</button>';
        }
        html +=
          '<button type="button" class="btn sm secondary" data-action="edit" data-id="' +
          esc(p.id) +
          '">Edit</button>';
        html +=
          '<button type="button" class="btn sm danger" data-action="delete" data-id="' +
          esc(p.id) +
          '">Delete</button>';
        html += "</div>";
        html += "</div>";
      }
    }
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Create</h2>";
    html += '<label class="field"><span class="lbl">Program name</span>';
    html += '<input type="text" id="prog-new-name" placeholder="e.g. Pull + Dip block" /></label>';
    html += '<button type="button" class="btn block" id="prog-create">Create program</button>';
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Template</h2>";
    html +=
      '<p class="muted" style="margin-bottom:12px">2-day double progression: pull-ups + dips (face pull if available).</p>';
    html +=
      '<button type="button" class="btn block secondary" id="prog-starter">Load starter template</button>';
    html += "</div>";

    root.innerHTML = html;

    root.querySelector("#prog-create").addEventListener("click", function () {
      var input = root.querySelector("#prog-new-name");
      var name = (input && input.value ? input.value : "").trim();
      if (!name) {
        if (input) input.focus();
        return;
      }
      var program = {
        id: uid(),
        name: name,
        active: SL.store.listPrograms().length === 0,
        days: [],
      };
      SL.store.upsertProgram(program);
      if (program.active) SL.store.setActiveProgram(program.id);
      state.mode = "edit";
      state.programId = program.id;
      state.dayIndex = null;
      refresh();
    });

    root.querySelector("#prog-starter").addEventListener("click", function () {
      loadStarterTemplate();
    });

    root.querySelectorAll("[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var action = btn.getAttribute("data-action");
        var id = btn.getAttribute("data-id");
        if (action === "set-active") {
          SL.store.setActiveProgram(id);
          refresh();
        } else if (action === "edit") {
          state.mode = "edit";
          state.programId = id;
          state.dayIndex = null;
          refresh();
        } else if (action === "delete") {
          if (!confirm("Delete this program?")) return;
          SL.store.deleteProgram(id);
          refresh();
        }
      });
    });
  }

  function renderDayEditor(root, program, dayIndex, catalog) {
    var day = program.days[dayIndex];
    if (!day) {
      state.dayIndex = null;
      renderEdit(root);
      return;
    }

    var html = "";
    html += '<div class="card">';
    html +=
      '<button type="button" class="btn sm secondary" id="day-back" style="margin-bottom:12px">Back to program</button>';
    html += "<h2>Edit day</h2>";
    html += '<label class="field"><span class="lbl">Day name</span>';
    html +=
      '<input type="text" id="day-name" value="' + esc(day.name || "") + '" /></label>';
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Exercises</h2>";
    if (!day.exercises || !day.exercises.length) {
      html += '<p class="muted">No exercises yet.</p>';
    }
    for (var i = 0; i < (day.exercises || []).length; i++) {
      var ex = day.exercises[i];
      var prog = ex.progression || "double";
      html += '<div class="exercise-block" data-ex-idx="' + i + '">';
      html += '<div class="ex-head">';
      html += '<span class="title">' + esc(exerciseName(ex.exerciseId, catalog)) + "</span>";
      html +=
        '<button type="button" class="btn sm danger" data-action="remove-ex" data-idx="' +
        i +
        '">Remove</button>';
      html += "</div>";
      html += '<div class="row" style="flex-wrap:wrap;align-items:flex-end">';
      html +=
        '<label class="field grow" style="margin-bottom:8px"><span class="lbl">Sets</span>' +
        '<input type="number" min="1" data-field="sets" data-idx="' +
        i +
        '" value="' +
        esc(ex.sets) +
        '" /></label>';
      html +=
        '<label class="field grow" style="margin-bottom:8px"><span class="lbl">Rep min</span>' +
        '<input type="number" min="1" data-field="repMin" data-idx="' +
        i +
        '" value="' +
        esc(ex.repMin) +
        '" /></label>';
      html +=
        '<label class="field grow" style="margin-bottom:8px"><span class="lbl">Rep max</span>' +
        '<input type="number" min="1" data-field="repMax" data-idx="' +
        i +
        '" value="' +
        esc(ex.repMax) +
        '" /></label>';
      html += "</div>";
      html +=
        '<label class="field"><span class="lbl">Progression</span><select data-field="progression" data-idx="' +
        i +
        '">' +
        '<option value="double"' +
        (prog === "double" ? " selected" : "") +
        ">Double</option>" +
        '<option value="linear"' +
        (prog === "linear" ? " selected" : "") +
        ">Linear</option>" +
        '<option value="manual"' +
        (prog === "manual" ? " selected" : "") +
        ">Manual</option>" +
        "</select></label>";
      html +=
        '<label class="field"><span class="lbl">Start load (kg)</span>' +
        '<input type="number" step="0.5" data-field="startLoadKg" data-idx="' +
        i +
        '" value="' +
        esc(ex.startLoadKg != null ? ex.startLoadKg : 0) +
        '" /></label>';
      html +=
        '<label class="field linear-inc"' +
        (prog === "linear" ? "" : ' style="display:none"') +
        '><span class="lbl">Linear increment (kg)</span>' +
        '<input type="number" step="0.5" data-field="linearIncrementKg" data-idx="' +
        i +
        '" value="' +
        esc(ex.linearIncrementKg != null ? ex.linearIncrementKg : 0) +
        '" /></label>';
      html += "</div>";
    }
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Add exercise</h2>";
    if (state.exercisesError) {
      html += '<p class="muted">' + esc(state.exercisesError) + "</p>";
    }
    html += '<label class="field"><span class="lbl">Exercise</span><select id="add-ex-select">';
    html += '<option value="">Select…</option>';
    for (var j = 0; j < catalog.length; j++) {
      var c = catalog[j];
      html +=
        '<option value="' +
        esc(c.id) +
        '">' +
        esc(c.name) +
        (c.category ? " (" + esc(c.category) + ")" : "") +
        "</option>";
    }
    html += "</select></label>";
    html += '<button type="button" class="btn block" id="add-ex-btn">Add exercise</button>';
    html += "</div>";

    html += '<button type="button" class="btn block" id="day-save">Save day</button>';

    root.innerHTML = html;

    function readDayFromDom() {
      var nameEl = root.querySelector("#day-name");
      day.name = nameEl ? nameEl.value.trim() || day.name : day.name;
      var blocks = root.querySelectorAll(".exercise-block");
      for (var b = 0; b < blocks.length; b++) {
        var idx = Number(blocks[b].getAttribute("data-ex-idx"));
        if (!day.exercises[idx]) continue;
        var fields = blocks[b].querySelectorAll("[data-field]");
        for (var f = 0; f < fields.length; f++) {
          var field = fields[f].getAttribute("data-field");
          var val = fields[f].value;
          if (field === "progression") {
            day.exercises[idx].progression = val;
          } else {
            var num = parseFloat(val);
            day.exercises[idx][field] = isFinite(num) ? num : 0;
          }
        }
      }
    }

    root.querySelector("#day-back").addEventListener("click", function () {
      state.dayIndex = null;
      refresh();
    });

    root.querySelectorAll('[data-field="progression"]').forEach(function (sel) {
      sel.addEventListener("change", function () {
        var block = sel.closest(".exercise-block");
        var inc = block && block.querySelector(".linear-inc");
        if (inc) inc.style.display = sel.value === "linear" ? "" : "none";
      });
    });

    root.querySelectorAll('[data-action="remove-ex"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        readDayFromDom();
        var idx = Number(btn.getAttribute("data-idx"));
        day.exercises.splice(idx, 1);
        program.days[dayIndex] = day;
        SL.store.upsertProgram(program);
        refresh();
      });
    });

    root.querySelector("#add-ex-btn").addEventListener("click", function () {
      var sel = root.querySelector("#add-ex-select");
      var exId = sel && sel.value;
      if (!exId) return;
      readDayFromDom();
      if (!day.exercises) day.exercises = [];
      day.exercises.push(progEx(exId, 3, 5, 8, "double", 0, 0));
      program.days[dayIndex] = day;
      SL.store.upsertProgram(program);
      refresh();
    });

    root.querySelector("#day-save").addEventListener("click", function () {
      readDayFromDom();
      program.days[dayIndex] = day;
      SL.store.upsertProgram(program);
      state.dayIndex = null;
      refresh();
    });
  }

  function renderEdit(root) {
    var program = getEditingProgram();
    if (!program) {
      state.mode = "list";
      state.programId = null;
      renderList(root);
      return;
    }

    if (state.dayIndex != null) {
      root.innerHTML = '<p class="muted">Loading exercises…</p>';
      ensureExercises(function (catalog) {
        program = getEditingProgram();
        if (!program) {
          state.mode = "list";
          state.programId = null;
          state.dayIndex = null;
          renderList(root);
          return;
        }
        renderDayEditor(root, program, state.dayIndex, catalog);
      });
      return;
    }

    var html = "";
    html += '<div class="card">';
    html +=
      '<button type="button" class="btn sm secondary" id="prog-back" style="margin-bottom:12px">Back</button>';
    html += "<h2>Edit program</h2>";
    html += '<label class="field"><span class="lbl">Name</span>';
    html +=
      '<input type="text" id="prog-name" value="' + esc(program.name || "") + '" /></label>';
    if (program.active) {
      html += '<p class="muted"><span class="badge">Active</span> This is your current program.</p>';
    } else {
      html +=
        '<button type="button" class="btn sm secondary" id="prog-set-active" style="margin-top:4px">Set Active</button>';
    }
    html += "</div>";

    html += '<div class="card">';
    html += '<div class="spread" style="margin-bottom:12px"><h2 style="margin:0">Days</h2>';
    html += '<button type="button" class="btn sm" id="prog-add-day">Add day</button></div>';
    if (!program.days || !program.days.length) {
      html += '<p class="muted">No days yet. Add a day to build the template.</p>';
    }
    for (var i = 0; i < (program.days || []).length; i++) {
      var d = program.days[i];
      var nEx = (d.exercises && d.exercises.length) || 0;
      html += '<div class="session-card" style="cursor:default">';
      html += '<div class="head">';
      html += '<span class="date">' + esc(d.name || "Day " + (i + 1)) + "</span>";
      html += '<span class="muted small">' + nEx + " exercise" + (nEx === 1 ? "" : "s") + "</span>";
      html += "</div>";
      html += '<div class="row" style="flex-wrap:wrap;margin-top:8px">';
      html +=
        '<button type="button" class="btn sm secondary" data-action="edit-day" data-idx="' +
        i +
        '">Edit</button>';
      html +=
        '<button type="button" class="btn sm danger" data-action="delete-day" data-idx="' +
        i +
        '">Delete</button>';
      html += "</div></div>";
    }
    html += "</div>";

    html += '<button type="button" class="btn block" id="prog-save">Save program</button>';

    root.innerHTML = html;

    root.querySelector("#prog-back").addEventListener("click", function () {
      state.mode = "list";
      state.programId = null;
      state.dayIndex = null;
      refresh();
    });

    var setActiveBtn = root.querySelector("#prog-set-active");
    if (setActiveBtn) {
      setActiveBtn.addEventListener("click", function () {
        SL.store.setActiveProgram(program.id);
        refresh();
      });
    }

    root.querySelector("#prog-add-day").addEventListener("click", function () {
      var nameEl = root.querySelector("#prog-name");
      if (nameEl) program.name = nameEl.value.trim() || program.name;
      if (!program.days) program.days = [];
      var n = program.days.length + 1;
      program.days.push({ id: uid(), name: "Day " + n, exercises: [] });
      SL.store.upsertProgram(program);
      state.dayIndex = program.days.length - 1;
      refresh();
    });

    root.querySelectorAll('[data-action="edit-day"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.dayIndex = Number(btn.getAttribute("data-idx"));
        refresh();
      });
    });

    root.querySelectorAll('[data-action="delete-day"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Delete this day?")) return;
        var idx = Number(btn.getAttribute("data-idx"));
        program.days.splice(idx, 1);
        SL.store.upsertProgram(program);
        refresh();
      });
    });

    root.querySelector("#prog-save").addEventListener("click", function () {
      var nameEl = root.querySelector("#prog-name");
      program.name = nameEl ? nameEl.value.trim() || program.name : program.name;
      SL.store.upsertProgram(program);
      state.mode = "list";
      state.programId = null;
      refresh();
    });
  }

  function render(root) {
    if (!root) return;
    if (state.mode === "edit") {
      renderEdit(root);
    } else {
      renderList(root);
    }
  }

  function title() {
    if (state.mode === "edit" && state.dayIndex != null) return "Edit day";
    if (state.mode === "edit") return "Edit program";
    return "Programs";
  }

  window.SL.views.program = {
    render: render,
    title: title,
  };
})();
