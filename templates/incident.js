// Incident record builder: the page side. Everything stays in this tab.
// No network requests, no cookies, no storage of any kind: closing the tab
// discards the record, which is why the page asks before it closes. Files
// are only ever made or read here, on the reader's own device.
(function () {
  "use strict";
  var dataEl = document.getElementById("kit-data");
  var app = document.getElementById("record-builder");
  if (!dataEl || !app || !window.KitLogic || !window.DocxCore) return;
  var kit = JSON.parse(dataEl.textContent);
  var L = window.KitLogic;
  var D = window.DocxCore;
  var state = { actions: {} };
  var $ = function (id) { return document.getElementById(id); };

  app.hidden = false;
  var fallback = $("record-fallback");
  if (fallback) fallback.hidden = true;

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function isoDay(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function pill(text, tone) {
    var t = kit.tones[tone] || kit.tones.neutral;
    var icon = t.icon ? '<span class="pill-icon" aria-hidden="true">' + t.icon + "</span>" : "";
    var sr = t.sr ? '<span class="visually-hidden">' + t.sr + ": </span>" : "";
    return '<span class="pill pill-' + tone + '">' + icon + sr + esc(text) + "</span>";
  }

  // Short labels in the factor list; full titles in the vendor facts.
  function sourceLinks(ids, full) {
    var links = ids
      .map(function (id) {
        var s = kit.sources[id];
        if (!s) return "";
        return '<a href="' + esc(s.url) + '" rel="noopener">' + esc(full ? s.publisher + ": " + s.title : s.short) + "</a>";
      })
      .filter(Boolean);
    return links.length ? "Source: " + links.join(", ") : "";
  }

  // ------------------------------------------------------------ date and time controls

  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  app.querySelectorAll("[data-days]").forEach(function (box) {
    var name = box.getAttribute("data-days");
    var today = new Date();
    var html = "";
    for (var i = 0; i < 7; i++) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      var label = i === 0 ? "Today" : i === 1 ? "Yesterday" : WEEKDAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()];
      html += '<label class="kit-chip"><input type="radio" name="' + name + '" value="' + isoDay(d) + '" autocomplete="off" /><span>' + label + "</span></label>";
    }
    html += '<label class="kit-chip"><input type="radio" name="' + name + '" value="earlier" autocomplete="off" /><span>Earlier</span></label>';
    box.innerHTML = html;
  });

  app.querySelectorAll('[data-type="datetime"]').forEach(function (field) {
    var date = field.querySelector(".kit-date");
    var time = field.querySelector(".kit-time");
    field.addEventListener("change", function (event) {
      if (event.target.type !== "radio") return;
      date.hidden = event.target.value !== "earlier";
      if (!date.hidden) date.focus();
    });
    field.querySelector(".kit-now").addEventListener("click", function () {
      var now = new Date();
      field.querySelector('input[type="radio"]').checked = true;
      date.hidden = true;
      time.value = pad(now.getHours()) + ":" + pad(now.getMinutes());
      update();
    });
  });

  function readDateTime(field) {
    var day = field.querySelector('input[type="radio"]:checked');
    var date = field.querySelector(".kit-date").value;
    var time = field.querySelector(".kit-time").value;
    var d = day ? (day.value === "earlier" ? date : day.value) : "";
    return { value: d && time ? d + "T" + time : "", partial: !!(d || time) && !(d && time) };
  }

  function setDateTime(field, value) {
    var day = value.slice(0, 10);
    var chip = field.querySelector('input[type="radio"][value="' + day + '"]');
    var date = field.querySelector(".kit-date");
    if (chip) {
      chip.checked = true;
      date.hidden = true;
    } else {
      field.querySelector('input[type="radio"][value="earlier"]').checked = true;
      date.hidden = false;
      date.value = day;
    }
    field.querySelector(".kit-time").value = value.slice(11, 16);
  }

  // ------------------------------------------------------------ tool, then account

  function showTool(field, tool) {
    field.querySelectorAll("[data-tool]").forEach(function (g) {
      var show = g.getAttribute("data-tool") === tool;
      g.hidden = !show;
      var inputs = g.querySelectorAll("input");
      if (!show) inputs.forEach(function (i) { i.checked = false; });
      else if (inputs.length === 1) inputs[0].checked = true;
    });
  }

  app.querySelectorAll('[data-type="plan"]').forEach(function (field) {
    field.addEventListener("change", function (event) {
      if (/-tool$/.test(event.target.name)) showTool(field, event.target.value);
    });
  });

  function setPlan(field, planId) {
    var input = field.querySelector('input[name="f-plan"][value="' + planId + '"]');
    if (!input) return;
    var tool = input.closest("[data-tool]").getAttribute("data-tool");
    field.querySelector('input[name="f-plan-tool"][value="' + tool + '"]').checked = true;
    showTool(field, tool);
    input.checked = true;
  }

  // ------------------------------------------------------------ reading and setting the fields

  function read() {
    state.partial = {};
    app.querySelectorAll("[data-field]").forEach(function (el) {
      var id = el.getAttribute("data-field");
      var type = el.getAttribute("data-type");
      if (type === "datetime") {
        var dt = readDateTime(el);
        state[id] = dt.value;
        state.partial[id] = dt.partial;
      } else if (type === "radio" || type === "plan") {
        var on = el.querySelector('input[name="f-' + id + '"]:checked');
        state[id] = on ? on.value : "";
      } else if (type === "checkbox") {
        state[id] = Array.prototype.map.call(el.querySelectorAll('input[name="f-' + id + '"]:checked'), function (i) {
          return i.value;
        });
      } else if (type === "actions") {
        var next = {};
        el.querySelectorAll("input").forEach(function (i) {
          if (i.checked) next[i.value] = state.actions[i.value] || new Date().getTime();
          var stamp = el.querySelector('[data-stamp="' + i.value + '"]');
          if (stamp) stamp.textContent = i.checked ? L.formatDateTime(new Date(next[i.value])) : "";
        });
        state.actions = next;
      } else {
        state[id] = el.value;
      }
    });
    state.account = L.accountOf(kit, state.plan);
  }

  function clearControls() {
    app.querySelectorAll(".kit-form input, .kit-form textarea").forEach(function (el) {
      if (el.closest(".kit-assist")) return;
      if (el.type === "radio" || el.type === "checkbox") el.checked = false;
      else el.value = "";
    });
    app.querySelectorAll("[data-tool], .kit-date").forEach(function (el) { el.hidden = true; });
  }

  function setControls(next) {
    clearControls();
    app.querySelectorAll("[data-field]").forEach(function (el) {
      var id = el.getAttribute("data-field");
      var type = el.getAttribute("data-type");
      var v = next[id];
      var tick = function (value) {
        var input = el.querySelector('input[name="f-' + id + '"][value="' + value + '"]');
        if (input) input.checked = true;
      };
      if (type === "datetime") { if (v) setDateTime(el, v); }
      else if (type === "plan") { if (v) setPlan(el, v); }
      else if (type === "radio") { if (v) tick(v); }
      else if (type === "checkbox") (v || []).forEach(tick);
      else if (type === "actions") Object.keys(next.actions || {}).forEach(tick);
      else el.value = v || "";
    });
    state = { actions: Object.assign({}, next.actions) };
    update();
  }

  function hasAnswers() {
    return Array.prototype.some.call(app.querySelectorAll(".kit-form input, .kit-form textarea"), function (el) {
      if (el.closest(".kit-assist")) return false;
      return el.type === "radio" || el.type === "checkbox" ? el.checked : el.value !== "";
    });
  }

  // ------------------------------------------------------------ the summary panel

  function showDeadline() {
    var box = $("deadline");
    var bar = $("kit-bar-text");
    var dl = L.deadline(state.aware_at, new Date());
    if (!dl) {
      var msg = state.partial && state.partial.aware_at ? "Add the day and the time to see the 72-hour point." : "Fill in when the firm became aware, and the 72-hour point appears here.";
      box.innerHTML = '<p class="kit-deadline-empty">' + msg + "</p>";
      bar.textContent = "72-hour point: add when the firm became aware";
      return;
    }
    var processor = state.role === "processor";
    box.innerHTML =
      '<p class="kit-deadline-label">' + (processor ? "72 hours after your firm became aware (for reference)" : "72 hours after becoming aware") + "</p>" +
      '<p class="kit-deadline-time">' + esc(dl.label) + "</p>" +
      '<p class="kit-deadline-left">' +
      (dl.passed
        ? pill("Passed " + dl.remaining + " ago", "warning") + " A late report must give the reasons for the delay."
        : pill(dl.remaining + " left", "neutral")) +
      "</p>";
    bar.innerHTML = "<strong>" + esc(dl.label) + "</strong><span>" + esc(dl.passed ? "passed " + dl.remaining + " ago" : dl.remaining + " left") + "</span>";
  }

  function showRole() {
    $("role-note").hidden = state.role !== "processor";
  }

  function showPlan() {
    var box = $("plan-panel");
    var plan = L.planById(kit, state.plan);
    if (!state.plan) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.className = "kit-card kit-plan";
    if (!plan) {
      var other = kit.other_accounts.filter(function (o) { return o.id === state.plan; })[0];
      box.innerHTML = '<p class="kit-plan-title">' + esc(other ? other.label : "") + '</p><p class="kit-fact">' + esc(other ? other.advice : "") + "</p>";
      return;
    }
    var tag = plan.account === "work" ? '<span class="tag tag-work">Work</span>' : '<span class="tag tag-personal">Personal</span>';
    var rows = plan.facts
      .map(function (f) {
        return '<div class="plan-row"><dt>' + esc(f.label) + "</dt><dd>" + pill(f.short, f.tone) + "</dd></div>";
      })
      .join("");
    var words = plan.facts
      .map(function (f) {
        return '<p class="kit-fact"><strong>' + esc(f.label) + "</strong> " + esc(f.text) + '</p><p class="kit-src">' + sourceLinks(f.sources, true) + "</p>";
      })
      .join("");
    box.innerHTML =
      '<div class="plan-head">' + tag + '<p class="kit-plan-title">' + esc(plan.name) + "</p></div>" +
      '<dl class="plan-rows">' + rows + "</dl>" +
      '<details class="kit-plan-more"><summary>In the vendor\'s words, with sources</summary>' + words + "</details>" +
      (plan.incident_note ? '<p class="kit-plan-todo"><strong>In this account:</strong> ' + esc(plan.incident_note) + "</p>" : "") +
      '<p class="kit-src">From the <a href="/' + esc(plan.slug) + '">' + esc(plan.tool) + " page</a> of the AI accounts guide, checked " + esc(kit.guideCheckedHuman) + ".</p>";
  }

  function showFactors() {
    var f = L.factors(kit, state);
    var groups = [
      ["up", "Point towards reporting", "critical"],
      ["down", "May lower the risk", "good"],
      ["unknown", "Still to find out", "unknown"]
    ];
    $("factors").innerHTML = groups
      .map(function (g) {
        var items = f[g[0]];
        if (!items.length) return "";
        return '<div class="kit-factor-group"><p class="kit-factor-head">' + pill(g[1], g[2]) + '</p><ul class="kit-factor-list">' +
          items
            .map(function (x) {
              return "<li><strong>" + esc(x.criterion) + ".</strong> " + esc(x.text) +
                (x.high_risk ? ' <span class="kit-high">Can point to a high risk: consider telling the people concerned too.</span>' : "") +
                (x.sources.length ? ' <span class="kit-src">' + sourceLinks(x.sources) + "</span>" : "") + "</li>";
            })
            .join("") +
          "</ul></div>";
      })
      .join("") || '<p class="kit-deadline-empty">Answer the questions; the factors appear here as you go.</p>';
  }

  function update() {
    read();
    showDeadline();
    showRole();
    showPlan();
    showFactors();
  }

  app.addEventListener("input", function (event) { if (!event.target.closest(".kit-assist")) update(); });
  app.addEventListener("change", function (event) { if (!event.target.closest(".kit-assist")) update(); });
  setInterval(showDeadline, 30000);

  $("kit-bar-save").addEventListener("click", function () {
    var card = $("save-card");
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.focus({ preventScroll: true });
  });

  // ------------------------------------------------------------ copy buttons

  document.querySelectorAll("[data-copy]").forEach(function (button) {
    var target = $(button.getAttribute("data-copy"));
    var label = button.textContent;
    button.addEventListener("click", function () {
      if (!target || !navigator.clipboard) return;
      navigator.clipboard.writeText(target.textContent.trim()).then(function () {
        button.textContent = button.getAttribute("data-copied") || "Copied";
        setTimeout(function () { button.textContent = label; }, 2500);
      });
    });
  });

  // ------------------------------------------------------------ loading a record

  var result = $("load-result");

  function showResult(text, ok) {
    result.hidden = false;
    result.className = "kit-load-result " + (ok ? "is-ok" : "is-warn");
    result.textContent = text;
  }

  function load(obj) {
    if (!obj) {
      showResult("That doesn't look like a record. Paste the JSON block your assistant gave you, or open a .json file saved from this page.", false);
      return false;
    }
    var res = L.normalizeRecord(kit, obj);
    if (!res.applied) {
      showResult("Nothing in it matches the questions here, so nothing was filled in.", false);
      return false;
    }
    if (hasAnswers() && !window.confirm("Replace what you filled in with this record?")) return false;
    setControls(res.state);
    showResult(
      "Filled in " + res.applied + (res.applied === 1 ? " answer" : " answers") + ". Check them, then save." +
        (res.ignored.length ? " Left out because they didn't match the questions: " + res.ignored.join("; ") + "." : ""),
      !res.ignored.length
    );
    return true;
  }

  var panel = $("paste-panel");
  $("paste-open").addEventListener("click", function () {
    panel.hidden = !panel.hidden;
    this.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) $("paste-box").focus();
  });
  $("paste-cancel").addEventListener("click", function () {
    panel.hidden = true;
    $("paste-open").setAttribute("aria-expanded", "false");
    $("paste-box").value = "";
  });
  $("paste-load").addEventListener("click", function () {
    if (load(L.parsePasted($("paste-box").value))) {
      panel.hidden = true;
      $("paste-open").setAttribute("aria-expanded", "false");
      $("paste-box").value = "";
    }
  });
  $("file-open").addEventListener("change", function () {
    var input = this;
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      load(L.parsePasted(String(reader.result)));
      input.value = "";
    };
    reader.readAsText(file);
  });

  // ------------------------------------------------------------ saving the record

  var DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  function blocks() {
    read();
    return L.recordBlocks(kit, state, new Date());
  }

  function wordFile() {
    var day = isoDay(new Date());
    return { bytes: D.zipStored(D.parts(blocks(), { title: "AI data incident record", date: day }), day), name: "ai-incident-record-" + day + ".docx" };
  }

  function save(bytes, type, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: type }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  $("rec-download").addEventListener("click", function () {
    var w = wordFile();
    save(w.bytes, DOCX, w.name);
  });

  // Share: the phone's own share sheet (mail, chat, files). The page sends nothing itself.
  var shareButton = $("rec-share");
  if (navigator.canShare && navigator.share && typeof File === "function") {
    try {
      if (navigator.canShare({ files: [new File(["x"], "test.docx", { type: DOCX })] })) shareButton.hidden = false;
    } catch (e) { /* not supported */ }
  }
  shareButton.addEventListener("click", function () {
    var w = wordFile();
    navigator.share({ files: [new File([w.bytes], w.name, { type: DOCX })], title: "AI data incident record" }).catch(function () {});
  });

  $("rec-json").addEventListener("click", function () {
    read();
    var now = new Date();
    save(JSON.stringify(L.recordJson(kit, state, now), null, 2) + "\n", "application/json", "ai-incident-record-" + isoDay(now) + ".json");
  });

  $("rec-copy").addEventListener("click", function (event) {
    var button = event.currentTarget;
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(L.blocksToText(blocks())).then(function () {
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = "Copy as text"; }, 2000);
    });
  });

  // The print view: the record as a clean document, nothing else.
  function inline(t) {
    return esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  $("rec-print").addEventListener("click", function () {
    $("print-record").innerHTML = blocks()
      .map(function (b) {
        if (b.type === "title") return "<h1>" + inline(b.text) + "</h1>";
        if (b.type === "h1") return "<h2>" + inline(b.text) + "</h2>";
        if (b.type === "h2") return "<h3>" + inline(b.text) + "</h3>";
        if (b.type === "kv") return '<p class="kv"><strong>' + inline(b.label) + "</strong><br />" + inline(b.value) + "</p>";
        if (b.type === "bullets") return "<ul>" + b.items.map(function (i) { return "<li>" + inline(i) + "</li>"; }).join("") + "</ul>";
        if (b.type === "small") return '<p class="small">' + inline(b.text) + "</p>";
        return "<p>" + inline(b.text) + "</p>";
      })
      .join("");
    window.print();
  });

  $("rec-clear").addEventListener("click", function () {
    if (!window.confirm("Clear everything you filled in? Nothing is saved anywhere, so this can't be undone.")) return;
    clearControls();
    result.hidden = true;
    state = { actions: {} };
    update();
  });

  window.addEventListener("beforeunload", function (event) {
    if (hasAnswers()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  update();
})();
