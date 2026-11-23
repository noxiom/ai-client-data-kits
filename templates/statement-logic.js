// AI statement builder: the logic, with no access to the page.
// Shared by the browser (inlined into /client-asks-about-ai) and the tests
// (loaded with node:vm). It reads nothing from the network or the device.
//
// The one rule: a sentence appears only for an answer the firm gave. A
// missing or "not sure" answer becomes an open point under "What we are
// still checking". What a vendor states is shown apart, with its source,
// and never as the firm's own fact.
(function (root) {
  "use strict";

  var MONTHS = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    nl: ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"]
  };

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function humanDate(date, lang) {
    return date.getDate() + " " + MONTHS[lang === "nl" ? "nl" : "en"][date.getMonth()] + " " + date.getFullYear();
  }

  function localStamp(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }

  function langOf(state) {
    return state && state.language === "nl" ? "nl" : "en";
  }

  // ------------------------------------------------------------ the questions

  function allFields(K) {
    var out = [];
    K.facts.sections.forEach(function (s) { s.fields.forEach(function (f) { out.push(f); }); });
    K.letter_fields.forEach(function (f) { out.push(f); });
    return out;
  }

  function planById(K, id) {
    for (var i = 0; i < K.plans.length; i++) if (K.plans[i].id === id) return K.plans[i];
    return null;
  }

  function accountOf(K, id) {
    if (id === K.facts.other_tool.id) return K.facts.other_tool.account;
    var p = planById(K, id);
    return p ? p.account : "";
  }

  // The short questions asked for one account.
  function questionsFor(K, id) {
    var account = accountOf(K, id);
    return K.facts.tool_questions.filter(function (q) { return q.accounts.indexOf(account) !== -1; });
  }

  // ------------------------------------------------------------ sentences

  // One line for one answer: {text, check} or null (nothing to say).
  function factLine(K, group, value, lang, vars) {
    var lines = K.facts.lines[group];
    var line = (value && lines[value]) || lines.missing;
    if (!line || line.skip) return null;
    return { text: fill(line[lang], vars || {}), check: !!line.check };
  }

  function toolLine(K, q, value, lang, vars) {
    var lines = K.facts.tool_lines[q];
    var line = (value && lines[value]) || lines.unsure;
    return { text: fill(line[lang], vars), check: !!line.check };
  }

  // The tools the firm ticked, in the order of the guide.
  function chosenTools(K, state) {
    var ticked = state.tools || [];
    var ids = K.plans.map(function (p) { return p.id; }).concat([K.facts.other_tool.id]);
    return ids.filter(function (id) { return ticked.indexOf(id) !== -1; });
  }

  function toolName(K, id, state, lang) {
    var named = K.facts.names[id];
    if (named) return named[lang];
    var name = ((state.tool_facts || {})[id] || {}).name;
    return name || K.documents.statement[lang].other_tool;
  }

  function vendorName(K, id, state, lang) {
    var p = planById(K, id);
    if (p) return p.vendor;
    var name = ((state.tool_facts || {})[id] || {}).name;
    return name || K.documents.statement[lang].other_vendor;
  }

  // Everything the firm said, sorted into the statement's sections, with the
  // open points collected separately.
  function collect(K, state, lang) {
    var out = { tools: [], toolsLine: null, afterTools: [], data: [], how: [], choices: [], open: [] };
    var put = function (bucket, line) {
      if (!line) return;
      if (line.check) out.open.push(line.text);
      else out[bucket].push(line.text);
    };
    var D = K.documents.statement[lang];
    var tools = chosenTools(K, state);
    var none = (state.tools || []).indexOf(K.facts.no_tools.id) !== -1 && !tools.length;

    if (none) out.toolsLine = D.tools_none;
    else if (!tools.length) out.open.push(D.tools_empty);

    tools.forEach(function (id) {
      var facts = (state.tool_facts || {})[id] || {};
      var vars = { tool: toolName(K, id, state, lang), vendor: vendorName(K, id, state, lang) };
      var entry = { id: id, name: vars.tool, account: accountOf(K, id), lines: [], vendor: [] };
      questionsFor(K, id).forEach(function (q) {
        var line = toolLine(K, q.id, facts[q.id], lang, vars);
        if (line.check) out.open.push(line.text);
        else entry.lines.push(line.text);
      });
      var p = planById(K, id);
      if (p) {
        ["training", "retention", "location", "contract"].forEach(function (f) {
          var fact = p.facts[f];
          var short = K.facts.vendor_short[fact.short];
          entry.vendor.push({ label: K.facts.vendor_labels[f][lang], text: short ? short[lang] : fact.short, sources: fact.sources });
        });
      }
      out.tools.push(entry);
    });

    if (!none) {
      put("afterTools", factLine(K, "shadow", state.shadow, lang));
      put("afterTools", factLine(K, "personal", state.personal, lang));
      put("data", factLine(K, "client_data", state.client_data, lang));
      put("data", factLine(K, "special", state.special, lang));
    } else {
      // No tools: only what still matters without them.
      put("afterTools", factLine(K, "shadow", state.shadow, lang));
      put("afterTools", factLine(K, "personal", state.personal, lang));
    }
    if (!none) {
      put("how", factLine(K, "review", state.review, lang));
      put("how", factLine(K, "policy", state.policy, lang));
      put("how", factLine(K, "literacy", state.literacy, lang));
    }
    put("how", factLine(K, "role", state.role, lang));
    var processor = state.role === "processor" || state.role === "both";
    if (state.subprocessors || processor) put("how", factLine(K, "subprocessors", state.subprocessors, lang));
    put("how", factLine(K, "incidents", state.incidents, lang));
    if (!none) put("choices", factLine(K, "opt_out", state.opt_out, lang));
    return out;
  }

  function listJoin(items, lang) {
    if (items.length <= 1) return items.join("");
    var and = lang === "nl" ? " en " : " and ";
    return items.slice(0, -1).join(", ") + and + items[items.length - 1];
  }

  function toolList(K, c, lang) {
    var D = K.documents.statement[lang];
    return listJoin(c.tools.map(function (t) { return t.name + " (" + D[t.account] + ")"; }), lang);
  }

  // The few lines that open the statement and fill the letter, each with
  // its kind: "tools" (which tools), "point" (a confirmed fact), "open".
  function summary(K, state, c, lang) {
    var D = K.documents.statement[lang];
    var out = [];
    if (c.toolsLine) out.push({ kind: "tools", text: D.summary_none });
    if (c.tools.length) out.push({ kind: "tools", text: fill(D.summary_tools, { list: toolList(K, c, lang) }) });
    var allSigned = c.tools.length > 0 && c.tools.every(function (t) {
      return t.account === "work" && ((state.tool_facts || {})[t.id] || {}).dpa === "signed";
    });
    if (allSigned) out.push({ kind: "point", text: D.summary_dpa });
    var keep = function (group) {
      var l = factLine(K, group, state[group], lang);
      if (l && !l.check) out.push({ kind: "point", text: l.text });
    };
    if (c.tools.length) {
      keep("client_data");
      keep("review");
    }
    if (c.open.length) out.push({ kind: "open", text: c.open.length === 1 ? D.summary_open_one : fill(D.summary_open_many, { n: c.open.length }) });
    return out;
  }

  var texts = function (lines) { return lines.map(function (l) { return l.text; }); };

  // ------------------------------------------------------------ the two documents

  function isoToDate(iso) {
    var p = String(iso).split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function sourceText(K, id, lang) {
    var s = K.sources[id];
    var checked = fill(K.documents.statement[lang].checked, { date: humanDate(isoToDate(s.checked), lang) });
    return s.publisher + ": " + s.title + ". " + s.url + " (" + checked + ")";
  }

  function statementBlocks(K, state, now) {
    var lang = langOf(state);
    var D = K.documents.statement[lang];
    var c = collect(K, state, lang);
    var date = humanDate(now, lang);
    var b = [];
    b.push({ type: "title", text: D.title });
    b.push({ type: "small", text: (state.firm_name ? state.firm_name + ". " : "") + fill(D.of, { date: date }) + "." });
    b.push({ type: "h1", text: D.in_short });
    b.push({ type: "bullets", items: texts(summary(K, state, c, lang)) });

    b.push({ type: "h1", text: D.tools });
    if (c.toolsLine) b.push({ type: "p", text: c.toolsLine });
    if (c.tools.length) b.push({ type: "p", text: D.tools_intro });
    var cited = [];
    c.tools.forEach(function (t) {
      b.push({ type: "h2", text: t.name + " (" + D[t.account] + ")" });
      if (t.lines.length) b.push({ type: "bullets", items: t.lines });
      if (t.vendor.length) {
        b.push({ type: "p", text: "**" + fill(D.vendor_says, { vendor: vendorName(K, t.id, state, lang) }) + "**" });
        b.push({
          type: "bullets",
          items: t.vendor.map(function (v) {
            v.sources.forEach(function (s) { if (cited.indexOf(s) === -1) cited.push(s); });
            return v.label + ": " + v.text + " [" + v.sources.map(function (s) { return cited.indexOf(s) + 1; }).join(", ") + "]";
          })
        });
      }
    });
    if (c.afterTools.length) {
      if (c.tools.length) b.push({ type: "h2", text: D.beyond });
      b.push({ type: "bullets", items: c.afterTools });
    }

    if (c.data.length) {
      b.push({ type: "h1", text: D.data });
      b.push({ type: "bullets", items: c.data });
    }
    if (c.how.length) {
      b.push({ type: "h1", text: D.how });
      b.push({ type: "bullets", items: c.how });
    }
    b.push({ type: "h1", text: D.choices });
    var choices = c.choices.slice();
    choices.push(state.contact ? fill(D.contact, { contact: state.contact }) : D.contact_empty);
    b.push({ type: "bullets", items: choices });

    b.push({ type: "h1", text: D.open });
    b.push(c.open.length ? { type: "bullets", items: c.open } : { type: "p", text: D.open_none });

    if (cited.length) {
      b.push({ type: "h2", text: D.sources });
      b.push({ type: "numbers", items: cited.map(function (id) { return sourceText(K, id, lang); }) });
    }
    b.push({ type: "small", text: fill(D.footer, { guide_date: K.guideChecked[lang] }) });
    return b;
  }

  function letterBlocks(K, state, now) {
    var lang = langOf(state);
    var D = K.documents.letter[lang];
    var c = collect(K, state, lang);
    var date = humanDate(now, lang);
    var b = [];
    b.push({ type: "p", text: fill(D.place_date, { date: date }) });
    b.push({ type: "p", text: "**" + D.subject + "**" });
    b.push({ type: "p", text: D.dear });
    b.push({ type: "p", text: D.thanks });
    if (c.toolsLine) b.push({ type: "p", text: D.none });
    else if (c.tools.length) b.push({ type: "p", text: fill(D.yes, { list: toolList(K, c, lang) }) });
    else b.push({ type: "p", text: D.empty });
    b.push({ type: "p", text: fill(D.attached, { date: date }) });
    // The tools were named above, and open points get their own paragraph.
    var points = texts(summary(K, state, c, lang).filter(function (l) { return l.kind === "point"; }));
    var opt = factLine(K, "opt_out", state.opt_out, lang);
    if (opt && !opt.check && c.tools.length) points.push(opt.text);
    if (points.length) b.push({ type: "bullets", items: points });
    if (c.open.length) b.push({ type: "p", text: D.open });
    b.push({ type: "p", text: state.contact ? fill(D.contact, { contact: state.contact }) : D.contact_empty });
    b.push({ type: "p", text: D.regards });
    b.push({ type: "p", text: state.signer || D.signer_empty });
    b.push({ type: "p", text: state.firm_name || D.firm_empty });
    return b;
  }

  // Plain text, for "Copy as text".
  function blocksToText(blocks) {
    var plain = function (t) { return String(t).replace(/\*\*/g, ""); };
    var out = [];
    blocks.forEach(function (b) {
      if (b.type === "title") out.push(plain(b.text).toUpperCase(), "");
      else if (b.type === "h1") out.push("", plain(b.text).toUpperCase());
      else if (b.type === "h2") out.push("", plain(b.text));
      else if (b.type === "bullets") b.items.forEach(function (i) { out.push("- " + plain(i)); });
      else if (b.type === "numbers") b.items.forEach(function (i, n) { out.push(n + 1 + ". " + plain(i)); });
      else out.push(plain(b.text), "");
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // ------------------------------------------------------------ facts as JSON
  // The saved file is the firm's facts, to continue later, to hand to an
  // assistant, and (later) to answer the AI section of a client questionnaire.

  function factsJson(K, state, now) {
    var out = { "$schema": K.schemaUrl, facts: K.facts.id, version: K.facts.version, saved_at: localStamp(now) };
    allFields(K).forEach(function (f) {
      var v = state[f.id];
      if (f.type === "tools") {
        var tools = (state.tools || []).slice();
        if (tools.length) out.tools = tools;
        var tf = {};
        chosenTools(K, state).forEach(function (id) {
          var facts = (state.tool_facts || {})[id];
          if (!facts) return;
          var keep = {};
          Object.keys(facts).forEach(function (k) { if (facts[k]) keep[k] = facts[k]; });
          if (Object.keys(keep).length) tf[id] = keep;
        });
        if (Object.keys(tf).length) out.tool_facts = tf;
      } else if (v) out[f.id] = v;
    });
    if (state.language) out.language = state.language;
    return out;
  }

  var MAX_TEXT = 300;

  // Check facts from a file or an assistant against the questions. Unknown
  // fields and values are left out and reported, never guessed.
  function normalizeFacts(K, input) {
    var state = { tools: [], tool_facts: {} };
    var ignored = [];
    var applied = 0;
    if (!input || typeof input !== "object" || Array.isArray(input)) return { state: state, applied: 0, ignored: ["the file is not a JSON object"] };
    var fields = {};
    allFields(K).forEach(function (f) { fields[f.id] = f; });
    var toolIds = K.plans.map(function (p) { return p.id; }).concat([K.facts.other_tool.id, K.facts.no_tools.id]);
    var isOption = function (options, v) { return (options || []).some(function (o) { return o[0] === v; }); };
    Object.keys(input).forEach(function (key) {
      if (key === "$schema" || key === "facts" || key === "version" || key === "saved_at") return;
      var v = input[key];
      if (key === "language") {
        if (v === "en" || v === "nl") state.language = v;
        else ignored.push("language: " + String(v));
        return;
      }
      if (key === "tool_facts") {
        if (!v || typeof v !== "object" || Array.isArray(v)) { ignored.push("tool_facts (expected an object per account)"); return; }
        Object.keys(v).forEach(function (id) {
          if (toolIds.indexOf(id) === -1 || id === K.facts.no_tools.id) { ignored.push("tool_facts." + id); return; }
          var qs = {};
          questionsFor(K, id).forEach(function (q) { qs[q.id] = q; });
          var got = v[id] || {};
          var keep = {};
          Object.keys(got).forEach(function (k) {
            if (k === "name" && id === K.facts.other_tool.id && typeof got[k] === "string") { keep.name = got[k].slice(0, 80); applied++; }
            else if (qs[k] && isOption(qs[k].options, got[k])) { keep[k] = got[k]; applied++; }
            else ignored.push("tool_facts." + id + "." + k + ": " + String(got[k]));
          });
          state.tool_facts[id] = keep;
        });
        return;
      }
      var f = fields[key];
      if (!f) { ignored.push(key + " (not a question here)"); return; }
      if (f.type === "tools") {
        var list = Array.isArray(v) ? v : [v];
        list.forEach(function (x) {
          if (toolIds.indexOf(x) !== -1 && state.tools.indexOf(x) === -1) state.tools.push(x);
          else if (toolIds.indexOf(x) === -1) ignored.push("tools: " + String(x));
        });
        if (state.tools.length > 1 && state.tools.indexOf(K.facts.no_tools.id) !== -1) {
          state.tools = state.tools.filter(function (x) { return x !== K.facts.no_tools.id; });
          ignored.push("tools: none (other accounts were ticked too)");
        }
        if (state.tools.length) applied++;
      } else if (f.options) {
        if (isOption(f.options, v)) { state[key] = v; applied++; }
        else ignored.push(key + ": " + String(v));
      } else if (typeof v === "string") {
        state[key] = v.slice(0, MAX_TEXT);
        applied++;
      } else ignored.push(key);
    });
    // Facts about accounts that aren't ticked are dropped, and said so.
    Object.keys(state.tool_facts).forEach(function (id) {
      if (state.tools.indexOf(id) === -1) {
        delete state.tool_facts[id];
        ignored.push("tool_facts." + id + " (that account isn't in tools)");
      }
    });
    return { state: state, applied: applied, ignored: ignored };
  }

  function parsePasted(text) {
    var t = String(text || "").trim();
    var fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fence) t = fence[1].trim();
    var start = t.indexOf("{");
    var end = t.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { return null; }
  }

  var api = {
    humanDate: humanDate,
    allFields: allFields,
    planById: planById,
    accountOf: accountOf,
    questionsFor: questionsFor,
    chosenTools: chosenTools,
    collect: collect,
    summary: summary,
    statementBlocks: statementBlocks,
    letterBlocks: letterBlocks,
    blocksToText: blocksToText,
    factsJson: factsJson,
    normalizeFacts: normalizeFacts,
    parsePasted: parsePasted
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StatementLogic = api;
})(this);
