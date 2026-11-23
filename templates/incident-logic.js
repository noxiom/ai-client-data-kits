// Incident record builder: the logic, with no access to the page.
// Shared by the browser (inlined into /ai-data-incident) and the tests
// (loaded with node:vm). It reads nothing from the network or the device,
// and it never decides whether to report: it lists factors.
(function (root) {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // "2026-11-23T09:15" (a datetime-local value, read as local time) -> Date
  function parseLocal(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }

  function formatDateTime(date) {
    return date.getDate() + " " + MONTHS[date.getMonth()] + " " + date.getFullYear() + ", " + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function duration(ms) {
    var minutes = Math.round(Math.abs(ms) / 60000);
    var days = Math.floor(minutes / 1440);
    var hours = Math.floor((minutes % 1440) / 60);
    var mins = minutes % 60;
    var parts = [];
    if (days) parts.push(days + (days === 1 ? " day" : " days"));
    if (hours) parts.push(hours + (hours === 1 ? " hour" : " hours"));
    if (!days && mins) parts.push(mins + (mins === 1 ? " minute" : " minutes"));
    return parts.length ? parts.join(" ") : "less than a minute";
  }

  // The 72-hour point counted from awareness (Art. 33(1) GDPR).
  function deadline(awareValue, now) {
    var aware = parseLocal(awareValue);
    if (!aware) return null;
    var at = new Date(aware.getTime() + 72 * 3600 * 1000);
    var left = at.getTime() - now.getTime();
    return { aware: aware, at: at, msLeft: left, passed: left < 0, label: formatDateTime(at), remaining: duration(left) };
  }

  function values(state, field) {
    var v = state[field];
    if (v == null || v === "") return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "object") return Object.keys(v);
    return [String(v)];
  }

  // Conditions: {field, in:[..]} | {field, any:[..]} | {field, only:[..]} | {all:[..]} | {any:[..]}
  function match(cond, state) {
    if (cond.all) return cond.all.every(function (c) { return match(c, state); });
    if (cond.any && !cond.field) return cond.any.some(function (c) { return match(c, state); });
    var got = values(state, cond.field);
    if (cond["in"]) return got.length === 1 && cond["in"].indexOf(got[0]) !== -1;
    if (cond.any) return got.some(function (v) { return cond.any.indexOf(v) !== -1; });
    if (cond.only) return got.length > 0 && got.every(function (v) { return cond.only.indexOf(v) !== -1; });
    throw new Error("unknown condition: " + JSON.stringify(cond));
  }

  function factors(kit, state) {
    var out = { up: [], down: [], unknown: [] };
    kit.factors.forEach(function (f) {
      if (match(f.when, state)) out[f.direction].push(f);
    });
    return out;
  }

  // The account type behind the chosen option: personal, work or unknown.
  function accountOf(kit, planId) {
    if (!planId) return "";
    for (var i = 0; i < kit.plans.length; i++) if (kit.plans[i].id === planId) return kit.plans[i].account;
    for (var j = 0; j < kit.other_accounts.length; j++) if (kit.other_accounts[j].id === planId) return kit.other_accounts[j].account;
    return "unknown";
  }

  function planById(kit, planId) {
    for (var i = 0; i < kit.plans.length; i++) if (kit.plans[i].id === planId) return kit.plans[i];
    return null;
  }

  function optionLabel(field, value) {
    for (var i = 0; i < (field.options || []).length; i++) if (field.options[i][0] === value) return field.options[i][1];
    return value;
  }

  function sourceLine(kit, id) {
    var s = kit.sources[id];
    return s ? s.publisher + ": " + s.title + " (" + s.url + "), checked " + s.checkedHuman : id;
  }

  function fieldValue(kit, field, state) {
    var v = state[field.id];
    if (field.type === "datetime") {
      var d = parseLocal(v);
      return d ? formatDateTime(d) : "";
    }
    if (field.type === "plan") {
      var plan = planById(kit, v);
      var other = null;
      kit.other_accounts.forEach(function (o) { if (o.id === v) other = o; });
      return plan ? plan.name + " (" + plan.account + " account)" : other ? other.label : "";
    }
    if (field.type === "checkbox") return values(state, field.id).map(function (x) { return optionLabel(field, x); }).join("; ");
    if (field.type === "actions") {
      var done = state.actions || {};
      return field.options
        .filter(function (o) { return done[o[0]]; })
        .map(function (o) { return o[1] + " (" + formatDateTime(new Date(done[o[0]])) + ")"; })
        .join("; ");
    }
    if (field.options) return v ? optionLabel(field, v) : "";
    return v || "";
  }

  // The record a firm keeps (Art. 33(5) GDPR: facts, effects, remedial action),
  // as blocks. The same blocks become the Word file, the text and the print view.
  function recordBlocks(kit, state, now) {
    var b = [];
    b.push({ type: "title", text: "AI data incident record" });
    b.push({ type: "small", text: "Made with " + kit.pageUrl + " on " + formatDateTime(now) + ". The page sent and stored nothing. Keep this record with your firm's breach register." });
    b.push({ type: "small", text: "Client and people concerned: add names in your own copy, not on the website." });

    kit.record.sections.forEach(function (section) {
      b.push({ type: "h1", text: section.title });
      section.fields.forEach(function (field) {
        var v = state[field.id];
        b.push({ type: "kv", label: field.label, value: fieldValue(kit, field, state) || "(not filled in)" });
        if (field.id === "aware_at") {
          var dl = deadline(v, now);
          if (dl) b.push({ type: "kv", label: "72 hours after awareness", value: dl.label + (dl.passed ? " (passed " + dl.remaining + " ago at the time of this record)" : "") });
        }
        if (field.id === "role" && v === "processor") {
          b.push({ type: "p", text: "As the client's processor: tell the client without undue delay. The client assesses the risk and decides about reporting (GDPR Art. 33(2))." });
        }
        if (field.type === "plan") {
          var p = planById(kit, v);
          if (p) {
            b.push({ type: "h2", text: "What the vendor states about this account (from the AI accounts guide, checked " + kit.guideCheckedHuman + ")" });
            b.push({
              type: "bullets",
              items: p.facts.map(function (fact) {
                return "**" + fact.label + "** " + fact.short + ". " + fact.text + " Source: " + fact.sources.map(function (sid) { return sourceLine(kit, sid); }).join("; ");
              }).concat(p.incident_note ? ["**In this account:** " + p.incident_note] : [])
            });
          }
        }
      });
    });

    var f = factors(kit, state);
    b.push({ type: "h1", text: "Factors considered" });
    b.push({ type: "p", text: "The firm decides; these are not a verdict. If in doubt, the European guidance is to report." });
    [["up", "Point towards reporting"], ["down", "May lower the risk"], ["unknown", "Still to find out"]].forEach(function (group) {
      b.push({ type: "h2", text: group[1] });
      var items = f[group[0]].map(function (x) {
        return "**" + x.criterion + ".** " + x.text + (x.high_risk ? " Can point to a high risk: consider telling the people concerned too." : "");
      });
      b.push(items.length ? { type: "bullets", items: items } : { type: "p", text: "(none from the answers given)" });
    });
    b.push({ type: "small", text: "Legal basis: GDPR Articles 33 and 34; EDPB Guidelines 9/2022 on personal data breach notification. Made with a free tool; not legal advice." });
    return b;
  }

  // Plain text, for "Copy as text".
  function blocksToText(blocks) {
    var rule = "------------------------------------------------------------";
    var plain = function (t) { return String(t).replace(/\*\*/g, ""); };
    var out = [];
    blocks.forEach(function (b) {
      if (b.type === "title") out.push(plain(b.text).toUpperCase());
      else if (b.type === "h1") out.push("", rule, plain(b.text).toUpperCase(), rule);
      else if (b.type === "h2") out.push(plain(b.text) + ":");
      else if (b.type === "kv") out.push(plain(b.label), "  " + plain(b.value));
      else if (b.type === "bullets") b.items.forEach(function (i) { out.push("  - " + plain(i)); });
      else out.push(plain(b.text));
    });
    return out.join("\n");
  }

  function recordText(kit, state, now) {
    return blocksToText(recordBlocks(kit, state, now));
  }

  // ---------------------------------------------------------------- records as JSON
  // JSON is for continuing later and for AI assistants: the builder can load
  // it back. People keep the Word file. Times are local, "YYYY-MM-DDTHH:MM".

  function allFields(kit) {
    var out = [];
    kit.record.sections.forEach(function (s) { s.fields.forEach(function (f) { out.push(f); }); });
    return out;
  }

  function localStamp(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function recordJson(kit, state, now) {
    var out = { "$schema": kit.schemaUrl, kit: kit.id, version: 1, saved_at: localStamp(now) };
    allFields(kit).forEach(function (f) {
      var v = state[f.id];
      if (f.type === "actions") {
        var acts = {};
        Object.keys(state.actions || {}).forEach(function (k) { acts[k] = localStamp(new Date(state.actions[k])); });
        if (Object.keys(acts).length) out.actions = acts;
      } else if (Array.isArray(v)) {
        if (v.length) out[f.id] = v.slice();
      } else if (v) {
        out[f.id] = v;
      }
    });
    return out;
  }

  var MAX_TEXT = 2000;

  // Check a record from a file or an assistant against the questions. Unknown
  // fields and values are left out and reported, never guessed.
  function normalizeRecord(kit, input) {
    var state = { actions: {} };
    var ignored = [];
    var applied = 0;
    if (!input || typeof input !== "object" || Array.isArray(input)) return { state: state, applied: 0, ignored: ["the record is not a JSON object"] };
    var fields = {};
    allFields(kit).forEach(function (f) { fields[f.id] = f; });
    var planIds = kit.plans.map(function (p) { return p.id; }).concat(kit.other_accounts.map(function (o) { return o.id; }));
    var isOption = function (f, v) { return (f.options || []).some(function (o) { return o[0] === v; }); };
    Object.keys(input).forEach(function (key) {
      if (key === "$schema" || key === "kit" || key === "version" || key === "saved_at") return;
      var f = fields[key];
      var v = input[key];
      if (!f) { ignored.push(key + " (not a question in this record)"); return; }
      if (f.type === "datetime") {
        if (typeof v === "string" && parseLocal(v.slice(0, 16))) { state[key] = v.slice(0, 16); applied++; }
        else ignored.push(key + " (use YYYY-MM-DDTHH:MM)");
      } else if (f.type === "plan") {
        if (planIds.indexOf(v) !== -1) { state.plan = v; applied++; }
        else ignored.push(key + ": " + String(v));
      } else if (f.type === "checkbox") {
        var list = Array.isArray(v) ? v : [v];
        var ok = list.filter(function (x) { return isOption(f, x); });
        list.filter(function (x) { return !isOption(f, x); }).forEach(function (x) { ignored.push(key + ": " + String(x)); });
        if (ok.length) { state[key] = ok.filter(function (x, i) { return ok.indexOf(x) === i; }); applied++; }
      } else if (f.type === "actions") {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          Object.keys(v).forEach(function (k) {
            var d = parseLocal(String(v[k]).slice(0, 16));
            if (isOption(f, k) && d) { state.actions[k] = d.getTime(); applied++; }
            else ignored.push("actions." + k);
          });
        } else ignored.push(key + " (expected an object of step: time)");
      } else if (f.options) {
        if (isOption(f, v)) { state[key] = v; applied++; }
        else ignored.push(key + ": " + String(v));
      } else {
        if (typeof v === "string" || typeof v === "number") { state[key] = String(v).slice(0, MAX_TEXT); applied++; }
        else ignored.push(key);
      }
    });
    state.account = accountOf(kit, state.plan);
    return { state: state, applied: applied, ignored: ignored };
  }

  // Pull the JSON object out of whatever was pasted: an assistant's answer
  // often wraps it in a code fence or a sentence.
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
    parseLocal: parseLocal,
    formatDateTime: formatDateTime,
    duration: duration,
    deadline: deadline,
    match: match,
    factors: factors,
    accountOf: accountOf,
    planById: planById,
    recordBlocks: recordBlocks,
    blocksToText: blocksToText,
    recordText: recordText,
    recordJson: recordJson,
    normalizeRecord: normalizeRecord,
    parsePasted: parsePasted
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KitLogic = api;
})(this);
