// Tests for the "Client data went into an AI tool" kit.
//   node --test 'test/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import vm from "node:vm";
import {
  ROOT, GUIDE_DIR, KIT_DIR, DOWNLOADS, CTA_TAGS, SCHEMA_PATH, recordSchema, loadKit, loadGuide, allSources, render, renderOwner, renderEmployee, kitData, planFacts, recordBlocks, handoutBlocks, guideBlocks,
} from "../src/render.mjs";
import { markdown, crc32 } from "../src/docx.mjs";

const kit = loadKit();
const data = loadGuide();
const sources = allSources(kit, data);
const sourceIds = new Set(sources.map((s) => s.id));
// En and em dash, built from char codes so this file passes the dash hook.
const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const logic = (() => {
  const ctx = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(join(ROOT, "templates", "incident-logic.js"), "utf8"), ctx);
  return ctx.module.exports;
})();
const browserKit = kitData(kit, data);

// Every string in an object, with its path.
function* strings(value, path = "") {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* strings(v, `${path}.${k}`);
}

// ---------------------------------------------------------------- data

test("kit metadata is complete and dated", () => {
  assert.match(kit.version, /^\d+\.\d+\.\d+$/);
  assert.ok(["draft", "release"].includes(kit.status));
  assert.match(kit.checked, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(kit.next_review > kit.checked, "next_review must be after checked");
  assert.ok(kit.changelog.length > 0);
  for (const s of kit.sources) {
    assert.ok(s.url.startsWith("https://"), `${s.id} must use https`);
    assert.match(s.checked, /^\d{4}-\d{2}-\d{2}$/, `${s.id} needs a check date`);
  }
});

test("every cited source exists, and kit ids don't collide with the guide's", () => {
  const cited = [
    ...kit.employee.faq.flatMap((f) => f.sources),
    ...kit.employee.work_account_sources,
    ...kit.owner.steps.flatMap((s) => s.sources),
    ...kit.owner.faq.flatMap((f) => f.sources),
    ...kit.factors.flatMap((f) => f.sources),
  ];
  for (const id of cited) assert.ok(sourceIds.has(id), `unknown source: ${id}`);
  assert.equal(sourceIds.size, sources.length, "duplicate source ids");
});

test("sources still to be checked by hand block a release", () => {
  const pending = kit.sources.filter((s) => s.needs_manual_check);
  if (kit.status === "release") assert.deepEqual(pending.map((s) => s.id), [], "check these by hand before release");
  else for (const s of pending) assert.ok(s.needs_manual_check.length > 20, `${s.id}: say what to check`);
});

test("no en or em dashes in data, templates or generated files", () => {
  for (const [path, s] of strings(kit)) assert.ok(!DASHES.test(s), `dash in data${path}`);
  for (const f of readdirSync(join(ROOT, "templates"))) {
    assert.ok(!DASHES.test(readFileSync(join(ROOT, "templates", f), "utf8")), `dash in templates/${f}`);
  }
  for (const f of readdirSync(KIT_DIR)) assert.ok(!DASHES.test(readFileSync(join(KIT_DIR, f), "utf8")), `dash in ${f}`);
});

test("no safety or compliance claims, no fines, no verdicts", () => {
  const banned = [
    /\b(is|are) (safe|compliant|certified)\b/i,
    /\bguarantee/i,
    /\bfines?\b/i,
    /\bpenalt/i,
    /\bboete/i,
    /\byou must report\b/i,
    /\bno need to report\b/i,
    /\byou don't (have|need) to report\b/i,
  ];
  for (const [path, s] of strings(kit)) for (const re of banned) assert.ok(!re.test(s), `"${s.slice(0, 60)}..." at ${path} matches ${re}`);
});

test("record fields and factor conditions fit together", () => {
  const fields = new Map(kit.record.sections.flatMap((s) => s.fields).map((f) => [f.id, f]));
  assert.equal(fields.size, kit.record.sections.flatMap((s) => s.fields).length, "duplicate field ids");
  for (const f of fields.values()) {
    if (f.options) assert.equal(new Set(f.options.map((o) => o[0])).size, f.options.length, `duplicate options in ${f.id}`);
  }
  const accountValues = ["personal", "work", "unknown"];
  const check = (cond, factor) => {
    if (cond.all || (cond.any && !cond.field)) return (cond.all || cond.any).forEach((c) => check(c, factor));
    const allowed = cond.field === "account" ? accountValues : fields.get(cond.field)?.options?.map((o) => o[0]);
    assert.ok(allowed, `${factor.id}: unknown field ${cond.field}`);
    for (const v of cond.in || cond.any || cond.only) assert.ok(allowed.includes(v), `${factor.id}: ${cond.field} has no option ${v}`);
  };
  for (const f of kit.factors) {
    assert.ok(["up", "down", "unknown"].includes(f.direction), `${f.id}: direction`);
    assert.ok(f.criterion && f.text, `${f.id}: needs a criterion and a text`);
    check(f.when, f);
  }
  assert.equal(new Set(kit.factors.map((f) => f.id)).size, kit.factors.length, "duplicate factor ids");
});

// ---------------------------------------------------------------- logic

test("the 72-hour point counts from awareness", () => {
  const aware = "2026-11-23T09:00";
  const soon = logic.deadline(aware, new Date(2026, 10, 23, 10, 0));
  assert.equal(soon.label, "26 Nov 2026, 09:00");
  assert.equal(soon.passed, false);
  assert.equal(soon.remaining, "2 days 23 hours");
  const late = logic.deadline(aware, new Date(2026, 10, 26, 10, 0));
  assert.equal(late.passed, true);
  assert.equal(late.remaining, "1 hour");
  assert.equal(logic.deadline("", new Date()), null);
});

// Arrays from the vm context have another realm's prototype; copy them.
const ids = (list) => Array.from(list, (f) => f.id).sort();

test("factors: personal account, health data, against the rules", () => {
  const f = logic.factors(browserKit, { account: "personal", training: "on", rules: "against", categories: ["health", "contact"], people: "2-10" });
  assert.deepEqual(ids(f.up), ["against-rules", "no-contract", "special", "training-on"]);
  assert.deepEqual(ids(f.down), []);
  assert.ok(f.up.find((x) => x.id === "special").high_risk);
});

test("factors: work account, within the rules, a few contact details", () => {
  const f = logic.factors(browserKit, { account: "work", training: "na", rules: "allowed", categories: ["contact"], people: "1", actions: { deleted: 1 } });
  assert.deepEqual(ids(f.up), []);
  assert.deepEqual(ids(f.down), ["contact-only", "contained", "within-rules", "work-contract"]);
});

test("factors: no personal data, and things still to find out", () => {
  const f = logic.factors(browserKit, { account: "unknown", rules: "none", categories: ["business"], people: "unknown", role: "unsure" });
  assert.deepEqual(ids(f.down), ["no-personal"]);
  assert.deepEqual(ids(f.unknown), ["no-rules", "people-unknown", "plan-unknown", "role-unsure"]);
});

test("the record holds the facts, the deadline, the vendor facts and the factors", () => {
  const state = {
    aware_at: "2026-11-23T09:00", plan: "chatgpt-personal", account: "personal", training: "unsure", rules: "against",
    categories: ["financial"], people: "11-100", role: "controller", actions: { deleted: new Date(2026, 10, 23, 9, 30).getTime() },
  };
  const text = logic.recordText(browserKit, state, new Date(2026, 10, 23, 10, 0));
  for (const s of kit.record.sections) assert.ok(text.includes(s.title.toUpperCase()), `missing section ${s.title}`);
  assert.ok(text.includes("26 Nov 2026, 09:00"));
  assert.ok(text.includes("Conversation deleted (23 Nov 2026, 09:30)"));
  assert.ok(text.includes("https://help.openai.com/"), "vendor sources in the record");
  assert.ok(text.includes("Point towards reporting:"));
  assert.ok(text.includes("(not filled in)"));
  assert.ok(text.includes("ChatGPT Free, Plus or Pro (personal account)"));
  const asProcessor = logic.recordText(browserKit, { ...state, role: "processor" }, new Date(2026, 10, 23, 10, 0));
  assert.ok(asProcessor.includes("tell the client without undue delay"));
  assert.ok(!/undefined|\[\[|NaN/.test(text));
  assert.ok(!DASHES.test(text));
});

test("every account type in the guide reaches the record builder", () => {
  const plans = planFacts(data);
  assert.equal(plans.length, data.tools.flatMap((t) => t.plans).length);
  for (const p of plans) {
    assert.equal(p.facts.length, 3);
    if (p.account === "personal") assert.ok(p.incident_note, `${p.id}: personal accounts need a note`);
  }
});

// ---------------------------------------------------------------- pages

const pages = { owner: renderOwner(kit, data), employee: renderEmployee(kit, data) };
const slugs = { owner: kit.owner.slug, employee: kit.employee.slug };

for (const [name, html] of Object.entries(pages)) {
  test(`${name} page: structure and metadata`, () => {
    assert.ok(!/\{\{|\[\[cite/.test(html), "unfilled slot or citation");
    const markupOnly = html.replace(/<script[\s\S]*?<\/script>/g, "");
    assert.equal((markupOnly.match(/<h1[ >]/g) || []).length, 1, "exactly one h1");
    assert.ok(html.includes(`<link rel="canonical" href="https://noxiom.com/${slugs[name]}" />`));
    const title = html.match(/<title>(.*?)<\/title>/)[1];
    assert.ok(title.length <= 70, `title too long: ${title.length}`);
    const desc = html.match(/<meta name="description" content="(.*?)"/)[1];
    assert.ok(desc.length >= 110 && desc.length <= 165, `description length ${desc.length}`);
    assert.ok(!DASHES.test(html), "dash in page");
  });

  test(`${name} page: JSON-LD parses and matches the questions`, () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const faq = blocks.find((b) => b["@type"] === "FAQPage");
    assert.equal(faq.mainEntity.length, (name === "owner" ? kit.owner : kit.employee).faq.length);
    const article = blocks.find((b) => b["@type"] === "Article");
    assert.equal(article.author["@id"], "https://noxiom.com/about#founder");
  });

  test(`${name} page: citations are numbered 1..n and all listed`, () => {
    const cited = new Set([...html.matchAll(/href="#src-(\d+)"/g)].map((m) => Number(m[1])));
    const listed = [...html.matchAll(/<li id="src-(\d+)">/g)].map((m) => Number(m[1]));
    assert.deepEqual([...cited].sort((a, b) => a - b), listed);
    assert.deepEqual(listed, listed.map((_, i) => i + 1));
  });

  test(`${name} page: internal links resolve`, () => {
    const guidePages = ["/ai-accounts", ...data.tools.map((t) => `/${t.slug}`)];
    const known = new Set([
      "/", "/about", "/services", "/pricing", "/sample-report", "/contact", "/privacy", "/nl/",
      ...guidePages, `/${kit.owner.slug}`, `/${kit.employee.slug}`, DOWNLOADS.record, DOWNLOADS.handout, SCHEMA_PATH,
    ]);
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
    for (const [, href] of markup.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)) {
      if (/\.(css|png|ico|svg)$/.test(href)) continue;
      assert.ok(known.has(href), `unknown internal link ${href}`);
    }
    const anchors = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    for (const [, id] of markup.matchAll(/href="#([^"]+)"/g)) assert.ok(anchors.has(id), `missing anchor #${id}`);
  });

  test(`${name} page: sends and stores nothing`, () => {
    assert.ok(!/<form[\s>]/i.test(html), "no form element: Enter in a field must never submit anything");
    const scripts = [...html.matchAll(/<script(?![^>]*application\/(?:ld\+)?json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
    for (const bad of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "sendBeacon", "WebSocket", "EventSource", "import(", "postMessage", "geolocation", "serviceWorker"]) {
      assert.ok(!scripts.includes(bad), `script uses ${bad}`);
    }
    const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(srcs, ["scripts.js"], "only the site's own script");
    for (const [tag] of html.matchAll(/<(input|textarea|select)\b[^>]*>/g)) assert.ok(tag.includes('autocomplete="off"'), `autocomplete on: ${tag.slice(0, 60)}`);
  });

  test(`${name} page: only registered call-to-action tags`, () => {
    for (const [, tag] of html.matchAll(/data-cta="([^"]+)"/g)) assert.ok(CTA_TAGS.includes(tag), `unregistered tag ${tag}`);
  });
}

test("every registered tag is used, and the builder's own buttons carry none", () => {
  const all = pages.owner + pages.employee;
  for (const tag of CTA_TAGS) assert.ok(all.includes(`data-cta="${tag}"`), `unused tag ${tag}`);
  assert.ok(!/<button[^>]*data-cta/.test(pages.owner), "the record builder sends nothing, not even a click tag");
});

test("the browser data matches the guide and parses from the page", () => {
  const json = pages.owner.match(/<script type="application\/json" id="kit-data">([\s\S]*?)<\/script>/)[1];
  const parsed = JSON.parse(json);
  assert.equal(parsed.plans.length, planFacts(data).length);
  assert.equal(parsed.factors.length, kit.factors.length);
});

// ---------------------------------------------------------------- downloads

function unzip(buf) {
  const files = {};
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const method = buf.readUInt16LE(p + 10);
    const body = buf.subarray(dataStart, dataStart + size);
    const raw = method === 8 ? inflateRawSync(body) : body;
    assert.equal(crc32(raw), crc, `CRC mismatch in ${name}`);
    files[name] = raw.toString("utf8");
    p += 46 + nameLen;
  }
  return files;
}

function wellFormed(xml, name) {
  const stack = [];
  for (const [, close, tag, selfClose] of xml.replace(/<\?[^>]*\?>/g, "").matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (selfClose) continue;
    if (close) assert.equal(stack.pop(), tag, `${name}: unbalanced </${tag}>`);
    else stack.push(tag);
  }
  assert.deepEqual(stack, [], `${name}: unclosed tags`);
}

const xmlText = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

test("the Word files are valid packages with the expected content", () => {
  const out = mkdtempSync(join(tmpdir(), "kit-"));
  render(out);
  for (const [file, mustHave] of [
    [DOWNLOADS.record, kit.record.sections.map((s) => s.title)],
    [DOWNLOADS.handout, [kit.employee.handout.title, kit.employee.handout.contact_line]],
  ]) {
    const files = unzip(readFileSync(join(out, file)));
    for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels", "docProps/core.xml"]) {
      assert.ok(files[part], `${file}: missing ${part}`);
      wellFormed(files[part], `${file}:${part}`);
    }
    for (const text of mustHave) assert.ok(files["word/document.xml"].includes(xmlText(text)), `${file}: missing "${text}"`);
    assert.ok(!DASHES.test(files["word/document.xml"]), `${file}: dash`);
  }
});

test("the Markdown templates in the repository are up to date", () => {
  const generated = "<!-- Generated from data/client-data-in-ai.json by src/render.mjs. Edit the data, not this file. -->\n\n";
  for (const [file, blocks] of [
    ["incident-record.md", recordBlocks(kit, data)],
    ["staff-handout.md", handoutBlocks(kit)],
    ["first-72-hours.md", guideBlocks(kit)],
  ]) {
    assert.ok(existsSync(join(KIT_DIR, file)), `${file} missing: run node src/render.mjs`);
    assert.equal(readFileSync(join(KIT_DIR, file), "utf8"), generated + markdown(blocks), `${file} is stale: run node src/render.mjs`);
  }
});

test("the guide this kit reads from is where we expect", () => {
  assert.ok(existsSync(join(GUIDE_DIR, "data", "ai-accounts.json")));
});

test("the record builder has no dropdowns or calendar popups, and every account is pickable", () => {
  const html = pages.owner;
  assert.ok(!/<select[\s>]/.test(html), "no native dropdowns");
  assert.ok(!/type="datetime-local"/.test(html), "no native date-time popup");
  for (const plan of planFacts(data)) assert.ok(html.includes(`name="f-plan" value="${plan.id}"`), `account ${plan.id} missing from the picker`);
  for (const o of kit.other_accounts) assert.ok(html.includes(`name="f-plan" value="${o.id}"`), `${o.id} missing from the picker`);
  assert.ok(html.includes("How was it found?"));
});

test("the Word record made in the browser is a valid package", () => {
  const ctx = { module: { exports: {} }, TextEncoder };
  vm.runInNewContext(readFileSync(join(ROOT, "templates", "docx-core.js"), "utf8"), ctx);
  const core = ctx.module.exports;
  const state = { aware_at: "2026-11-23T09:00", plan: "claude-personal", account: "personal", categories: ["health"], people: "1", actions: {} };
  const parts = core.parts(logic.recordBlocks(browserKit, state, new Date(2026, 10, 23, 10, 0)), { title: "AI data incident record", date: "2026-11-23" });
  const files = unzip(Buffer.from(core.zipStored(parts, "2026-11-23")));
  for (const [name, xml] of Object.entries(files)) wellFormed(xml, name);
  const doc = files["word/document.xml"];
  for (const text of ["AI data incident record", "Discovery", "26 Nov 2026, 09:00", "Claude Free, Pro or Max", "Point towards reporting"]) assert.ok(doc.includes(text), `missing "${text}"`);
  assert.ok(!DASHES.test(doc));
});

// ---------------------------------------------------------------- assistants and JSON

const fieldsOf = (k) => k.record.sections.flatMap((sec) => sec.fields);

test("the schema lists every question and every allowed answer", () => {
  const schema = recordSchema(kit, data);
  assert.equal(schema.$id, `https://noxiom.com${SCHEMA_PATH}`);
  for (const f of fieldsOf(kit)) {
    const prop = schema.properties[f.id];
    assert.ok(prop, `schema misses ${f.id}`);
    const values = f.type === "checkbox" ? prop.items.oneOf.map((o) => o.const) : prop.oneOf ? prop.oneOf.map((o) => o.const) : null;
    if (f.options && f.type !== "actions") assert.deepEqual(values, f.options.map((o) => o[0]), `${f.id} values`);
  }
  const plans = schema.properties.plan.oneOf.map((o) => o.const);
  for (const p of planFacts(data)) assert.ok(plans.includes(p.id), `schema misses account ${p.id}`);
  assert.ok(/never ask for the data itself/i.test(schema.description));
  assert.ok(!DASHES.test(JSON.stringify(schema)));
});

test("a saved record loads back exactly", () => {
  const state = {
    aware_at: "2026-11-23T09:15", reported_by: "colleague", plan: "gemini-workspace", how: "connected", rules: "allowed", training: "na", shared: "no",
    categories: ["contact", "hr"], people: "2-10", whose: ["staff"], description: "CVs of two applicants", role: "controller",
    actions: { deleted: new Date(2026, 10, 23, 9, 40).getTime() }, decision: "no", individuals: "no", reasons: "Work account, within our rules", decided_by: "Owner", fix: "",
  };
  const saved = JSON.parse(JSON.stringify(logic.recordJson(browserKit, state, new Date(2026, 10, 23, 10, 0))));
  assert.equal(saved.$schema, `https://noxiom.com${SCHEMA_PATH}`);
  const back = logic.normalizeRecord(browserKit, saved);
  assert.deepEqual(Array.from(back.ignored), []);
  for (const k of Object.keys(state)) {
    if (k === "fix") continue;
    assert.deepEqual(JSON.parse(JSON.stringify(back.state[k])), state[k], k);
  }
  assert.equal(back.state.account, "work");
});

test("loading checks every value and never guesses", () => {
  const res = logic.normalizeRecord(browserKit, {
    aware_at: "yesterday", plan: "chatgpt-premium", rules: "against", categories: ["health", "made-up"], people: "lots", favourite_colour: "blue", actions: { deleted: "2026-11-23T09:40", hacked: "now" },
  });
  assert.equal(res.state.rules, "against");
  assert.deepEqual(Array.from(res.state.categories), ["health"]);
  assert.ok(!res.state.aware_at && !res.state.plan && !res.state.people);
  assert.equal(res.ignored.length, 6);
  assert.equal(logic.normalizeRecord(browserKit, "not an object").applied, 0);
});

test("pasted assistant answers are read with or without a code fence", () => {
  assert.equal(logic.parsePasted('Here is your record:\n```json\n{"rules": "against"}\n```\nCheck it.').rules, "against");
  assert.equal(logic.parsePasted('{"people": "1"}').people, "1");
  assert.equal(logic.parsePasted("no json here"), null);
  assert.equal(logic.parsePasted("{ broken"), null);
});

test("the page tells assistants what to do, and its example loads cleanly", () => {
  const html = pages.owner;
  assert.ok(html.includes('id="for-assistants"'));
  for (const f of fieldsOf(kit)) assert.ok(html.includes(`<code>${f.id}</code>`), `assistant section misses ${f.id}`);
  assert.ok(html.includes(SCHEMA_PATH));
  assert.ok(kit.assistant.prompt.includes(`https://noxiom.com${SCHEMA_PATH}`));
  const example = JSON.parse(html.match(/<pre class="kit-code">([\s\S]*?)<\/pre>/)[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  const res = logic.normalizeRecord(browserKit, example);
  assert.deepEqual(Array.from(res.ignored), []);
  assert.ok(res.applied >= 10);
});

test("the schema file is written next to the pages", () => {
  const out = mkdtempSync(join(tmpdir(), "kit-schema-"));
  render(out);
  const schema = JSON.parse(readFileSync(join(out, SCHEMA_PATH), "utf8"));
  assert.equal(schema.title, "AI data incident record");
});
