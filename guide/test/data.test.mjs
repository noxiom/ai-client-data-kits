// The data file is the product: these tests enforce the rules that make it
// trustworthy. Every fact has a source and a check date, every source is real
// and used, nothing is newer than the last full check, and nothing has gone
// unchecked for longer than the review promise allows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadData, ROOT } from "../src/render.mjs";

const data = loadData();
const FIELD_IDS = data.fields.map((f) => f.id);
const sourceIds = new Set(data.sources.map((s) => s.id));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
// En dash (U+2013) and em dash (U+2014), built from codes so this file stays clean.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

// A fact may be at most this many days older than the last full check before
// the tests fail. The guide promises a monthly check; this leaves slack.
const MAX_FACT_AGE_DAYS = 45;

test("top-level metadata is complete", () => {
  for (const key of ["title", "description", "version", "checked", "next_review", "publisher", "license", "urls", "fields", "tools", "sources", "changelog", "known_gaps", "hub_faq"]) {
    assert.ok(key in data, `missing top-level key: ${key}`);
  }
  assert.match(data.checked, ISO);
  assert.match(data.next_review, ISO);
  assert.ok(days(data.next_review, data.checked) > 0 && days(data.next_review, data.checked) <= 35, "next review should be within about a month of the last check");
  assert.equal(data.license.name, "CC BY 4.0");
});

test("tools, slugs and plan ids are unique", () => {
  const ids = data.tools.map((t) => t.id);
  const slugs = data.tools.map((t) => t.slug);
  const plans = data.tools.flatMap((t) => t.plans.map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(new Set(plans).size, plans.length);
  for (const slug of slugs) assert.match(slug, /^[a-z0-9-]+$/, `slug must be flat and lowercase: ${slug}`);
});

test("every tool has the page copy it needs", () => {
  for (const t of data.tools) {
    for (const key of ["name", "vendor", "slug", "page_title", "seo_title", "meta_description", "summary", "incident_note"]) {
      assert.ok(typeof t[key] === "string" && t[key].length > 0, `${t.id}: missing ${key}`);
    }
    assert.ok(t.seo_title.length <= 64, `${t.id}: seo_title is ${t.seo_title.length} chars; keep it short enough for " | Noxiom"`);
    assert.ok(t.meta_description.length >= 110 && t.meta_description.length <= 160, `${t.id}: meta description is ${t.meta_description.length} chars`);
    assert.ok(t.how_to_tell.length >= 1, `${t.id}: how_to_tell is empty`);
    assert.ok(t.admin_checks.length >= 1, `${t.id}: admin_checks is empty`);
    assert.ok(t.faq.length >= 2, `${t.id}: needs at least two FAQ entries`);
    assert.ok(t.plans.length >= 1, `${t.id}: no plans`);
  }
});

test("every plan has every field, each with a short value, text, sources and a check date", () => {
  for (const t of data.tools) {
    for (const p of t.plans) {
      assert.ok(["personal", "work"].includes(p.account), `${p.id}: account must be personal or work`);
      assert.ok(p.name && p.short_name, `${p.id}: needs name and short_name`);
      for (const id of FIELD_IDS) {
        const f = p.fields[id];
        assert.ok(f, `${p.id}: missing field ${id}`);
        assert.ok(f.short && f.short.length <= 40, `${p.id}.${id}: short value missing or longer than 40 chars`);
        assert.ok(["good", "warning", "critical", "unknown", "neutral"].includes(f.tone), `${p.id}.${id}: tone must be good, warning, critical, unknown or neutral`);
        if (id !== "price") assert.notEqual(f.tone, "neutral", `${p.id}.${id}: only price is neutral; say what the fact means for client data`);
        if (/^not stated/i.test(f.short)) assert.equal(f.tone, "unknown", `${p.id}.${id}: "not stated" must show as unknown`);
        assert.ok(f.text && f.text.length >= 10, `${p.id}.${id}: text missing`);
        assert.ok(Array.isArray(f.sources) && f.sources.length > 0, `${p.id}.${id}: a fact without a source`);
        for (const s of f.sources) assert.ok(sourceIds.has(s), `${p.id}.${id}: unknown source ${s}`);
        assert.match(f.checked, ISO, `${p.id}.${id}: checked must be YYYY-MM-DD`);
        assert.ok(days(f.checked, data.checked) <= 0, `${p.id}.${id}: checked after the dataset's own check date`);
        assert.ok(days(data.checked, f.checked) <= MAX_FACT_AGE_DAYS, `${p.id}.${id}: last checked ${f.checked}, more than ${MAX_FACT_AGE_DAYS} days before the last full check`);
      }
      for (const extra of Object.keys(p.fields)) assert.ok(FIELD_IDS.includes(extra), `${p.id}: unexpected field ${extra}`);
      assert.ok(["conditional", "not-for-client-data"].includes(p.verdict.status), `${p.id}: bad verdict status`);
      assert.ok(p.verdict.text.length > 20, `${p.id}: verdict text missing`);
      assert.ok(!/^(Not for client|Can carry|Can work)/.test(p.verdict.text), `${p.id}: verdict text repeats the label the page already shows`);
    }
  }
});

test("a tool without a work plan says so in its copy", () => {
  for (const t of data.tools) {
    const kinds = new Set(t.plans.map((p) => p.account));
    if (!kinds.has("work")) {
      assert.match(t.summary + t.how_to_tell.join(" "), /no (business plan|work account|work version)/i, `${t.id}: no work plan, and the copy doesn't say so`);
    }
  }
});

// FAQ questions repeat what people search ("Is X GDPR compliant?") and the
// answers explain why no tool is; the claims that matter are in the facts,
// summaries and verdicts, so that is where this looks.
test("no tool is ever called safe, compliant or certified", () => {
  const text = JSON.stringify(
    data.tools.map((t) => [t.summary, t.how_to_tell, t.admin_checks, t.plans.map((p) => [p.fields, p.verdict])])
  );
  for (const phrase of [/\bis safe\b/i, /\bare safe\b/i, /\bfully compliant\b/i, /\bis gdpr[- ]compliant\b/i, /\bcertified\b/i, /\bguarantee/i]) {
    assert.ok(!phrase.test(text), `claim not allowed in the data: ${phrase}`);
  }
});

test("sources are well formed, dated and all used", () => {
  const used = new Set();
  const collect = (list = []) => list.forEach((s) => used.add(s));
  for (const t of data.tools) {
    t.faq.forEach((f) => collect(f.sources));
    collect(t.incident_sources);
    for (const p of t.plans) {
      Object.values(p.fields).forEach((f) => collect(f.sources));
      collect(p.verdict.sources);
    }
  }
  data.hub_faq.forEach((f) => collect(f.sources));
  // Sources cited straight from the templates count as used too.
  for (const file of readdirSync(join(ROOT, "templates"))) {
    for (const m of readFileSync(join(ROOT, "templates", file), "utf8").matchAll(/\[\[cite:([\w-]+)\]\]/g)) used.add(m[1]);
  }
  const ids = data.sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate source ids");
  for (const s of data.sources) {
    assert.match(s.url, /^https:\/\//, `${s.id}: url must be https`);
    assert.ok(s.title && s.publisher, `${s.id}: needs title and publisher`);
    assert.match(s.checked, ISO, `${s.id}: checked date`);
    if (s.page_date !== null) assert.match(s.page_date, ISO, `${s.id}: page_date must be YYYY-MM-DD or null`);
    assert.ok(used.has(s.id), `${s.id}: listed but never cited`);
  }
  for (const id of used) assert.ok(sourceIds.has(id), `cited but not listed: ${id}`);
});

test("change log and known gaps are present and dated", () => {
  assert.ok(data.changelog.length >= 1);
  for (const c of data.changelog) {
    assert.match(c.date, ISO);
    assert.ok(c.change.length > 10);
    // Editorial changes (wording, new questions, formats) may come between
    // checks; they must say so, so nobody reads them as a re-check of facts.
    assert.ok(days(c.date, data.checked) <= 0 || /No vendor facts changed/.test(c.change), "a change log entry is dated after the last check");
  }
  const dates = data.changelog.map((c) => c.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "change log must be newest first");
  assert.ok(data.known_gaps.length >= 1, "say what could not be confirmed");
});

test("no en or em dashes anywhere in the data, templates or register", () => {
  const files = [
    join(ROOT, "data", "ai-accounts.json"),
    join(ROOT, "downloads", "ai-accounts-register.csv"),
    ...readdirSync(join(ROOT, "templates")).map((f) => join(ROOT, "templates", f)),
  ];
  for (const file of files) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      assert.ok(!DASHES.test(line), `${file}:${i + 1} contains an en or em dash`);
    });
  }
});

test("the register CSV has a consistent number of columns", () => {
  const rows = readFileSync(join(ROOT, "downloads", "ai-accounts-register.csv"), "utf8").trim().split("\n");
  const count = (row) => {
    let n = 1;
    let quoted = false;
    for (const ch of row) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) n++;
    }
    return n;
  };
  const width = count(rows[0]);
  rows.forEach((row, i) => assert.equal(count(row), width, `row ${i + 1} has ${count(row)} columns, header has ${width}`));
});
