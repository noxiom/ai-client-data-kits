// AI statement builder: the page side. Everything stays in this tab.
// No network requests, no cookies, no storage of any kind: closing the tab
// discards the answers, which is why the page asks before it closes. Files
// are only ever made or read here, on the reader's own device.
(function () {
  "use strict";
  var dataEl = document.getElementById("kit-data");
  var app = document.getElementById("statement-builder");
  if (!dataEl || !app || !window.StatementLogic || !window.DocxCore) return;
  var K = JSON.parse(dataEl.textContent);
  var L = window.StatementLogic;
  var D = window.DocxCore;
  var state = { tools: [], tool_facts: {} };
  var showing = "statement";
  var $ = function (id) { return document.getElementById(id); };
  var NONE = K.facts.no_tools.id;

  app.hidden = false;
  var fallback = $("builder-fallback");
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

  // ------------------------------------------------------------ reading and setting the fields

  function showToolQuestions() {
    app.querySelectorAll(".kit-toolq").forEach(function (box) {
      var on = app.querySelector('input[name="f-tools"][value="' + box.getAttribute("data-for") + '"]');
      box.hidden = !(on && on.checked);
    });
  }

  function read() {
    var next = { tools: [], tool_facts: {} };
    app.querySelectorAll("[data-field]").forEach(function (el) {
      var id = el.getAttribute("data-field");
      var type = el.getAttribute("data-type");
      if (type === "tools") {
        next.tools = Array.prototype.map.call(el.querySelectorAll('input[name="f-tools"]:checked'), function (i) { return i.value; });
      } else if (type === "radio") {
        var on = el.querySelector('input[name="f-' + id + '"]:checked');
        if (on) next[id] = on.value;
      } else if (el.value) {
        next[id] = el.value.trim();
      }
    });
    next.tools.forEach(function (tool) {
      var facts = {};
      L.questionsFor(K, tool).forEach(function (q) {
        var on = app.querySelector('input[name="t-' + tool + "-" + q.id + '"]:checked');
        if (on) facts[q.id] = on.value;
      });
      var name = app.querySelector('[data-toolname="' + tool + '"]');
      if (name && name.value.trim()) facts.name = name.value.trim();
      next.tool_facts[tool] = facts;
    });
    state = next;
  }

  function clearControls() {
    app.querySelectorAll(".kit-form input, .kit-form textarea").forEach(function (el) {
      if (el.closest(".kit-assist")) return;
      if (el.type === "radio" || el.type === "checkbox") el.checked = false;
      else el.value = "";
    });
  }

  function setControls(next) {
    clearControls();
    var tick = function (name, value) {
      var input = app.querySelector('input[name="' + name + '"][value="' + value + '"]');
      if (input) input.checked = true;
    };
    L.allFields(K).forEach(function (f) {
      var v = next[f.id];
      if (!v) return;
      if (f.type === "tools") v.forEach(function (t) { tick("f-tools", t); });
      else if (f.options) tick("f-" + f.id, v);
      else {
        var input = app.querySelector('[data-field="' + f.id + '"]');
        if (input) input.value = v;
      }
    });
    if (next.language) tick("f-language", next.language);
    Object.keys(next.tool_facts || {}).forEach(function (tool) {
      var facts = next.tool_facts[tool];
      Object.keys(facts).forEach(function (q) {
        if (q === "name") {
          var name = app.querySelector('[data-toolname="' + tool + '"]');
          if (name) name.value = facts.name;
        } else tick("t-" + tool + "-" + q, facts[q]);
      });
    });
    update();
  }

  function hasAnswers() {
    return Array.prototype.some.call(app.querySelectorAll(".kit-form input, .kit-form textarea"), function (el) {
      if (el.closest(".kit-assist") || el.name === "f-language") return false;
      return el.type === "radio" || el.type === "checkbox" ? el.checked : el.value !== "";
    });
  }

  // "None" and the accounts exclude each other.
  app.addEventListener("change", function (event) {
    var t = event.target;
    if (t.name !== "f-tools" || !t.checked) return;
    if (t.value === NONE) {
      app.querySelectorAll('input[name="f-tools"]').forEach(function (i) { if (i !== t) i.checked = false; });
    } else {
      var none = app.querySelector('input[name="f-tools"][value="' + NONE + '"]');
      if (none) none.checked = false;
    }
  });

  // ------------------------------------------------------------ the summary column

  function inline(t) {
    return esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  function blocksHtml(blocks, openTexts) {
    var isOpen = function (t) { return openTexts.indexOf(t) !== -1; };
    var li = function (i) { return "<li" + (isOpen(i) ? ' class="is-open"' : "") + ">" + inline(i) + "</li>"; };
    return blocks
      .map(function (b) {
        if (b.type === "title") return "<h3>" + inline(b.text) + "</h3>";
        if (b.type === "h1") return "<h4>" + inline(b.text) + "</h4>";
        if (b.type === "h2") return "<h5>" + inline(b.text) + "</h5>";
        if (b.type === "bullets") return "<ul>" + b.items.map(li).join("") + "</ul>";
        if (b.type === "numbers") return "<ol>" + b.items.map(function (i) { return "<li>" + inline(i) + "</li>"; }).join("") + "</ol>";
        if (b.type === "small") return '<p class="small">' + inline(b.text) + "</p>";
        return "<p>" + inline(b.text) + "</p>";
      })
      .join("");
  }

  function currentBlocks(kind) {
    var now = new Date();
    return kind === "letter" ? L.letterBlocks(K, state, now) : L.statementBlocks(K, state, now);
  }

  function lang() {
    return state.language === "nl" ? "nl" : "en";
  }

  function update() {
    read();
    showToolQuestions();
    var c = L.collect(K, state, lang());
    var n = c.open.length;
    var wasOpen = !!$("open-points").querySelector("details[open]");
    $("open-points").innerHTML =
      '<p class="kit-open-count">' + n + "</p>" +
      (n
        ? '<p class="kit-save-why">These go in the statement under "What we are still checking". Answer them above if you can.</p>' +
          (n > 5 ? '<details class="kit-plan-more"' + (wasOpen ? " open" : "") + "><summary>Show them</summary>" : "") +
          '<ul class="kit-open-list">' + c.open.map(function (o) { return "<li>" + esc(o) + "</li>"; }).join("") + "</ul>" +
          (n > 5 ? "</details>" : "")
        : '<p class="kit-save-why">Every line in the statement is one your firm confirmed.</p>');
    $("gap-card").hidden = state.shadow === "checked";
    $("preview").innerHTML = blocksHtml(currentBlocks(showing), c.open);
    $("kit-bar-text").innerHTML = "<strong>" + n + (n === 1 ? " open point" : " open points") + "</strong><span>" + (c.tools.length ? c.tools.length + (c.tools.length === 1 ? " AI tool" : " AI tools") : "No tools ticked yet") + "</span>";
  }

  app.addEventListener("input", function (event) { if (!event.target.closest(".kit-assist")) update(); });
  app.addEventListener("change", function (event) { if (!event.target.closest(".kit-assist")) update(); });

  ["statement", "letter"].forEach(function (kind) {
    $("tab-" + kind).addEventListener("click", function () {
      showing = kind;
      $("tab-statement").setAttribute("aria-selected", String(kind === "statement"));
      $("tab-letter").setAttribute("aria-selected", String(kind === "letter"));
      update();
    });
  });

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

  // ------------------------------------------------------------ loading facts

  var result = $("load-result");

  function showResult(text, ok) {
    result.hidden = false;
    result.className = "kit-load-result " + (ok ? "is-ok" : "is-warn");
    result.textContent = text;
  }

  function load(obj) {
    if (!obj) {
      showResult("That doesn't look like saved facts. Paste the JSON block your assistant gave you, or open a .json file saved from this page.", false);
      return false;
    }
    var res = L.normalizeFacts(K, obj);
    if (!res.applied) {
      showResult("Nothing in it matches the questions here, so nothing was filled in.", false);
      return false;
    }
    if (hasAnswers() && !window.confirm("Replace what you filled in with these answers?")) return false;
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

  // ------------------------------------------------------------ saving

  var DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  var NAMES = {
    statement: { en: "ai-statement", nl: "ai-verklaring" },
    letter: { en: "ai-letter", nl: "ai-brief" }
  };
  var TITLES = {
    statement: { en: "AI statement", nl: "AI-verklaring" },
    letter: { en: "Letter about AI", nl: "Brief over AI" }
  };

  function wordFile(kind) {
    read();
    var now = new Date();
    var day = isoDay(now);
    var l = lang();
    var blocks = currentBlocks(kind);
    return {
      bytes: D.zipStored(D.parts(blocks, { title: TITLES[kind][l], date: day, lang: l === "nl" ? "nl-NL" : "en-GB" }), day),
      name: NAMES[kind][l] + "-" + day + ".docx"
    };
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

  $("st-download").addEventListener("click", function () {
    var w = wordFile("statement");
    save(w.bytes, DOCX, w.name);
  });
  $("lt-download").addEventListener("click", function () {
    var w = wordFile("letter");
    save(w.bytes, DOCX, w.name);
  });

  // Share: the phone's own share sheet. The page sends nothing itself.
  var shareButton = $("st-share");
  if (navigator.canShare && navigator.share && typeof File === "function") {
    try {
      if (navigator.canShare({ files: [new File(["x"], "test.docx", { type: DOCX })] })) shareButton.hidden = false;
    } catch (e) { /* not supported */ }
  }
  shareButton.addEventListener("click", function () {
    var s = wordFile("statement");
    var l = wordFile("letter");
    navigator.share({
      files: [new File([s.bytes], s.name, { type: DOCX }), new File([l.bytes], l.name, { type: DOCX })],
      title: TITLES.statement[lang()]
    }).catch(function () {});
  });

  $("st-json").addEventListener("click", function () {
    read();
    var now = new Date();
    save(JSON.stringify(L.factsJson(K, state, now), null, 2) + "\n", "application/json", "firm-ai-facts-" + isoDay(now) + ".json");
  });

  $("st-copy").addEventListener("click", function (event) {
    var button = event.currentTarget;
    if (!navigator.clipboard) return;
    read();
    navigator.clipboard.writeText(L.blocksToText(currentBlocks(showing))).then(function () {
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = "Copy as text"; }, 2000);
    });
  });

  // The print view: the document on the preview tab, nothing else.
  $("st-print").addEventListener("click", function () {
    read();
    $("print-record").innerHTML = blocksHtml(currentBlocks(showing), []);
    window.print();
  });

  $("st-clear").addEventListener("click", function () {
    if (!window.confirm("Clear everything you filled in? Nothing is saved anywhere, so this can't be undone.")) return;
    clearControls();
    result.hidden = true;
    update();
  });

  window.addEventListener("beforeunload", function (event) {
    if (hasAnswers()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  var en = app.querySelector('input[name="f-language"][value="en"]');
  if (en) en.checked = true;
  update();
})();
