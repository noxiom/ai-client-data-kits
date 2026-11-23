// Tests for kit 2, "A client asks how you use AI with their data", and the
// firm AI facts model it shares with kit 3.
//   node --test 'test/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { ROOT, loadGuide } from "../src/render.mjs";
import {
  KIT2_DIR, FACTS_SCHEMA_PATH, EXAMPLE_PATH, CTA_TAGS_2, EXAMPLE_FACTS, loadKit2, loadFacts, allSources2, statementData, factsSchema, renderStatementPage, renderStatement, exampleBlocks,
} from "../src/statement.mjs";
import { markdown } from "../src/docx.mjs";
import { DASHES, BANNED, strings, unzip, wellFormed, xmlText } from "./helpers.mjs";

const kit = loadKit2();
const facts = loadFacts();
const data = loadGuide();
const sourceIds = new Set(allSources2(kit, data).map((s) => s.id));
const K = statementData(kit, facts, data);
const html = renderStatementPage(kit, facts, data);
const NOW = new Date(2026, 10, 23, 10, 0);

// The logic as the browser runs it: in its own context, without Node.
const L = (() => {
  const ctx = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(join(ROOT, "templates", "statement-logic.js"), "utf8"), ctx);
  return ctx.module.exports;
})();
// Arrays made in the vm context aren't Arrays of this realm; copy before deepEqual.
const plain = (x) => JSON.parse(JSON.stringify(x));

const fields = facts.sections.flatMap((s) => s.fields);
const optionFields = fields.filter((f) => f.options);
const texts = (blocks) => blocks.flatMap((b) => (b.items ? b.items : [b.text]));
const sectionItems = (blocks, title) => {
  const i = blocks.findIndex((b) => b.type === "h1" && b.text === title);
  if (i === -1) return [];
  const out = [];
  for (const b of blocks.slice(i + 1)) {
    if (b.type === "h1") break;
    out.push(...(b.items || [b.text]));
  }
  return out;
};

// ---------------------------------------------------------------- data

test("kit metadata is complete, and unchecked sources keep it a draft", () => {
  assert.match(kit.version, /^\d+\.\d+\.\d+$/);
  assert.ok(kit.next_review > kit.checked);
  for (const s of kit.sources) {
    assert.ok(s.url.startsWith("https://"), s.id);
    assert.match(s.checked, /^\d{4}-\d{2}-\d{2}$/);
  }
  const pending = kit.sources.filter((s) => s.needs_manual_check);
  if (kit.status === "release") assert.deepEqual(pending.map((s) => s.id), [], "check these by hand before release");
  for (const s of pending) assert.ok(s.needs_manual_check.length > 40, `${s.id}: say what to check`);
});

test("every cited source exists, and kit ids don't collide with the guide's", () => {
  const cited = [...kit.page.asks.flatMap((a) => a.sources), ...kit.page.why.flatMap((w) => w.sources), ...kit.page.faq.flatMap((f) => f.sources)];
  for (const id of cited) assert.ok(sourceIds.has(id), id);
  assert.equal(sourceIds.size, allSources2(kit, data).length);
  for (const p of K.plans) for (const f of Object.values(p.facts)) for (const id of f.sources) assert.ok(K.sources[id], `${p.id}: ${id}`);
});

test("no dashes, and no safety or compliance claims, fines or verdicts", () => {
  for (const obj of [kit, facts]) {
    for (const [path, s] of strings(obj)) {
      assert.ok(!DASHES.test(s), `dash at ${path}`);
      for (const re of BANNED) assert.ok(!re.test(s), `"${s.slice(0, 60)}" at ${path} matches ${re}`);
    }
  }
  for (const f of ["statement.html", "statement.js", "statement-logic.js"]) assert.ok(!DASHES.test(readFileSync(join(ROOT, "templates", f), "utf8")), f);
  assert.ok(!DASHES.test(html));
});

// ---------------------------------------------------------------- the fact model

test("every answer has a sentence in English and Dutch, and every question a neutral open point", () => {
  for (const f of optionFields) {
    const lines = facts.lines[f.id];
    assert.ok(lines, `no lines for ${f.id}`);
    assert.ok(lines.missing && lines.missing.check, `${f.id}: a missing answer must become an open point`);
    for (const [v] of f.options) {
      const line = lines[v];
      assert.ok(line, `${f.id}: no line for ${v}`);
      if (line.skip) continue;
      assert.ok(line.en && line.nl, `${f.id}.${v}: both languages`);
    }
    for (const key of Object.keys(lines)) assert.ok(key === "missing" || f.options.some(([v]) => v === key), `${f.id}: line for unknown answer ${key}`);
  }
  for (const q of facts.tool_questions) {
    const lines = facts.tool_lines[q.id];
    assert.ok(lines.unsure && lines.unsure.check, `${q.id}: unsure must be an open point`);
    for (const [v] of q.options) assert.ok(lines[v] && lines[v].en && lines[v].nl, `${q.id}.${v}`);
  }
});

test("'not sure' answers are always open points, never claims", () => {
  const unsure = ["unsure", "unknown", "no_rule", "undecided"];
  for (const f of optionFields) for (const [v] of f.options) if (unsure.includes(v)) assert.ok(facts.lines[f.id][v].check, `${f.id}.${v}`);
  assert.ok(facts.tool_lines.training.default.check, "an unchecked training setting is an open point");
});

test("the guide's vendor wording, plans and names are all covered", () => {
  for (const t of data.tools) {
    for (const p of t.plans) {
      assert.ok(facts.names[p.id] && facts.names[p.id].en && facts.names[p.id].nl, `no client-facing name for ${p.id}`);
      for (const f of ["training", "retention", "location", "contract"]) {
        const short = p.fields[f].short;
        assert.ok(facts.vendor_short[short], `the guide's "${short}" (${p.id}.${f}) has no statement wording: add it to vendor_short`);
      }
    }
  }
});

// ---------------------------------------------------------------- the refusal rule

test("with no answers, the statement claims nothing", () => {
  const blocks = L.statementBlocks(K, {}, NOW);
  const c = L.collect(K, {}, "en");
  assert.equal(c.tools.length, 0);
  for (const title of ["What goes into them", "How we work"]) assert.deepEqual(sectionItems(blocks, title), [], title);
  const open = sectionItems(blocks, "What we are still checking");
  assert.ok(open.length >= 8, `open points: ${open.length}`);
  assert.deepEqual(plain(sectionItems(blocks, "Your choices")), [kit.documents.statement.en.contact_empty]);
  const all = texts(blocks).join("\n");
  for (const claim of ["in place", "switched off", "never", "We have written rules", "A person checks"]) assert.ok(!all.includes(claim), claim);
});

test("each claim appears only for the answer that allows it", () => {
  const groups = optionFields.map((f) => f.id);
  for (const id of groups) {
    for (const [v] of fields.find((f) => f.id === id).options) {
      const line = facts.lines[id][v];
      if (line.skip) continue;
      const state = { role: id === "subprocessors" ? "processor" : undefined, tools: ["chatgpt-business"], [id]: v };
      const all = texts(L.statementBlocks(K, state, NOW));
      assert.ok(all.includes(line.en), `${id}=${v} should say: ${line.en}`);
      for (const [w] of fields.find((f) => f.id === id).options) {
        const other = facts.lines[id][w];
        if (w !== v && !other.skip && other.en !== line.en) assert.ok(!all.includes(other.en), `${id}=${v} must not say: ${other.en}`);
      }
    }
  }
});

test("per tool: a setting nobody checked is an open point, a checked one a fact", () => {
  const base = { tools: ["chatgpt-business"], tool_facts: { "chatgpt-business": { training: "default" } } };
  let all = texts(L.statementBlocks(K, base, NOW)).join("\n");
  assert.ok(!all.includes("switched off"));
  assert.ok(sectionItems(L.statementBlocks(K, base, NOW), "What we are still checking").some((t) => t.startsWith("The training setting in ChatGPT Business")));
  const checked = { tools: ["chatgpt-business"], tool_facts: { "chatgpt-business": { training: "off_checked", dpa: "signed", region: "eu", retention: "set" } } };
  all = texts(L.statementBlocks(K, checked, NOW)).join("\n");
  for (const t of ["switched off. We checked the setting", "Processing agreement with OpenAI: in place", "in the EU or EEA", "we set how long"]) assert.ok(all.includes(t), t);
});

test("vendor promises are labelled as the vendor's, with sources, and kept apart", () => {
  const blocks = L.statementBlocks(K, { tools: ["gemini-personal"] }, NOW);
  const i = blocks.findIndex((b) => b.type === "p" && /What Google states about this account/.test(b.text));
  assert.ok(i > 0, "a labelled vendor block");
  assert.ok(/not checked by us/.test(blocks[i].text));
  for (const item of blocks[i + 1].items) assert.match(item, /\[\d+(, \d+)*\]$/, "every vendor line cites a source");
  const sources = blocks.find((b) => b.type === "numbers");
  assert.ok(sources.items.every((s) => /https:\/\//.test(s) && /checked \d+ \w+ 2026/.test(s)));
  // A personal account has no processing-agreement question: the firm can't sign one.
  assert.ok(!texts(blocks).some((t) => /Processing agreement with Google/.test(t)));
});

test("'each vendor has a processing agreement' only when every tool is a work account with one", () => {
  const line = kit.documents.statement.en.summary_dpa;
  const signed = { dpa: "signed" };
  const say = (state) => texts(L.statementBlocks(K, state, NOW)).includes(line);
  assert.ok(say({ tools: ["chatgpt-business", "claude-work"], tool_facts: { "chatgpt-business": signed, "claude-work": signed } }));
  assert.ok(!say({ tools: ["chatgpt-business", "claude-work"], tool_facts: { "chatgpt-business": signed, "claude-work": { dpa: "unsure" } } }));
  assert.ok(!say({ tools: ["chatgpt-business", "chatgpt-personal"], tool_facts: { "chatgpt-business": signed } }));
});

test("no AI tools: the statement says so and asks nothing about tools", () => {
  const blocks = L.statementBlocks(K, { tools: ["none"], shadow: "checked" }, NOW);
  const all = texts(blocks);
  assert.ok(all.includes(kit.documents.statement.en.tools_none));
  assert.ok(!all.some((t) => /training setting|Our rule on which client data/.test(t)));
});

test("Dutch documents: Dutch throughout, formal to the client, and they say AI wrote the Dutch", () => {
  const state = { ...EXAMPLE_FACTS, language: "nl" };
  const st = L.blocksToText(L.statementBlocks(K, L.normalizeFacts(K, state).state, NOW));
  const lt = L.blocksToText(L.letterBlocks(K, L.normalizeFacts(K, state).state, NOW));
  assert.ok(st.includes("HOE WIJ AI-TOOLS GEBRUIKEN MET KLANTGEGEVENS"));
  assert.ok(st.includes("geschreven met hulp van AI"));
  assert.ok(st.includes("23 november 2026"));
  assert.ok(/gecontroleerd \d+ november 2026/.test(st));
  assert.ok(/\bu\b|\buw\b/.test(lt), "the letter addresses the client formally");
  for (const en of ["What we are still checking", "work account", "Kind regards", "checked 22"]) assert.ok(!st.includes(en) && !lt.includes(en), `English left: ${en}`);
});

test("the letter names the tools, lists confirmed points only, and points to the open ones", () => {
  const { state } = L.normalizeFacts(K, EXAMPLE_FACTS);
  const lt = L.letterBlocks(K, state, NOW);
  const all = texts(lt);
  assert.ok(all.some((t) => t.startsWith("Yes, we use AI tools in our work: ChatGPT Business (work account) and Microsoft 365 Copilot Chat (work account)")));
  assert.ok(all.includes(kit.documents.letter.en.open));
  const c = L.collect(K, state, "en");
  for (const open of c.open) assert.ok(!all.includes(open), "open points stay in the statement");
  assert.ok(all.includes("Example Payroll BV (an invented firm)"));
});

// ---------------------------------------------------------------- JSON and assistants

test("saved facts load back exactly", () => {
  const { state, ignored } = L.normalizeFacts(K, EXAMPLE_FACTS);
  assert.deepEqual(plain(ignored), []);
  const saved = plain(L.factsJson(K, state, NOW));
  assert.equal(saved.$schema, "https://noxiom.com/data/firm-ai-facts.schema.json");
  const { $schema, saved_at, ...rest } = saved;
  assert.deepEqual(rest, EXAMPLE_FACTS);
  const again = L.normalizeFacts(K, saved);
  assert.deepEqual(plain(again.state), plain(state));
});

test("loading checks every value and never guesses", () => {
  const res = L.normalizeFacts(K, {
    tools: ["chatgpt-business", "notion-ai"],
    tool_facts: { "chatgpt-business": { training: "off", dpa: "signed" }, "claude-work": { dpa: "signed" } },
    role: "owner",
    review: "always",
    colour: "blue",
  });
  assert.deepEqual(plain(res.state.tools), ["chatgpt-business"]);
  assert.deepEqual(plain(res.state.tool_facts), { "chatgpt-business": { dpa: "signed" } });
  assert.equal(res.state.role, undefined);
  assert.equal(res.state.review, "always");
  assert.equal(res.ignored.length, 5, plain(res.ignored).join(" | "));
  const both = L.normalizeFacts(K, { tools: ["none", "claude-work"] });
  assert.deepEqual(plain(both.state.tools), ["claude-work"]);
  assert.equal(L.parsePasted("Here you go:\n```json\n{\"review\": \"always\"}\n```").review, "always");
  assert.equal(L.parsePasted("no json here"), null);
});

test("the schema lists every question, every answer and every account's questions", () => {
  const schema = factsSchema(kit, facts, data);
  for (const f of fields) {
    assert.ok(schema.properties[f.id], f.id);
    if (f.options) assert.deepEqual(schema.properties[f.id].oneOf.map((o) => o.const), f.options.map(([v]) => v));
  }
  const accounts = schema.properties.tool_facts.properties;
  for (const p of K.plans) {
    const want = facts.tool_questions.filter((q) => q.accounts.includes(p.account)).map((q) => q.id);
    assert.deepEqual(Object.keys(accounts[p.id].properties), want, p.id);
  }
  assert.ok(accounts["other-work"].properties.name);
  assert.ok(/never record what a vendor promises/i.test(schema.description));
  assert.ok(!DASHES.test(JSON.stringify(schema)));
});

test("the page tells assistants what to do, and its example loads cleanly", () => {
  assert.ok(html.includes(`href="${FACTS_SCHEMA_PATH}"`));
  const example = JSON.parse(html.match(/<pre class="kit-code">([\s\S]*?)<\/pre>/)[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  assert.deepEqual(plain(L.normalizeFacts(K, example).ignored), []);
  assert.ok(kit.assistant.prompt.includes("https://noxiom.com/data/firm-ai-facts.schema.json"));
});

// ---------------------------------------------------------------- the page

test("page: structure and metadata", () => {
  assert.ok(!/\{\{|\[\[cite/.test(html), "unfilled slot or citation");
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.equal((markup.match(/<h1[ >]/g) || []).length, 1);
  assert.ok(html.includes(`<link rel="canonical" href="https://noxiom.com/${kit.page.slug}" />`));
  const title = html.match(/<title>(.*?)<\/title>/)[1];
  assert.ok(title.length <= 70, `title ${title.length}`);
  const desc = html.match(/<meta name="description" content="(.*?)"/)[1];
  assert.ok(desc.length >= 110 && desc.length <= 165, `description ${desc.length}`);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(ld.find((b) => b["@type"] === "FAQPage").mainEntity.length, kit.page.faq.length);
  assert.equal(ld.find((b) => b["@type"] === "Article").author["@id"], "https://noxiom.com/about#founder");
});

test("page: citations are numbered 1..n and all listed", () => {
  const cited = new Set([...html.matchAll(/href="#src-(\d+)"/g)].map((m) => Number(m[1])));
  const listed = [...html.matchAll(/<li id="src-(\d+)">/g)].map((m) => Number(m[1]));
  assert.deepEqual([...cited].sort((a, b) => a - b), listed);
  assert.deepEqual(listed, listed.map((_, i) => i + 1));
});

test("page: internal links resolve", () => {
  const known = new Set(["/", "/about", "/contact", "/sample-report", "/ai-accounts", FACTS_SCHEMA_PATH, EXAMPLE_PATH, ...data.tools.map((t) => `/${t.slug}`)]);
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const [, href] of markup.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)) {
    if (/\.(css|png|ico|svg)$/.test(href)) continue;
    assert.ok(known.has(href), `unknown internal link ${href}`);
  }
  const anchors = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  for (const [, id] of markup.matchAll(/href="#([^"]+)"/g)) assert.ok(anchors.has(id), `missing anchor #${id}`);
});

test("page: sends and stores nothing", () => {
  assert.ok(!/<form[\s>]/i.test(html), "no form element");
  assert.ok(!/<select[\s>]/.test(html), "no native dropdowns");
  const scripts = [...html.matchAll(/<script(?![^>]*application\/(?:ld\+)?json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  for (const bad of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "sendBeacon", "WebSocket", "EventSource", "import(", "postMessage", "geolocation", "serviceWorker"]) {
    assert.ok(!scripts.includes(bad), `script uses ${bad}`);
  }
  assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]), ["scripts.js"]);
  for (const [tag] of html.matchAll(/<(input|textarea|select)\b[^>]*>/g)) assert.ok(tag.includes('autocomplete="off"'), `autocomplete on: ${tag.slice(0, 80)}`);
});

test("page: call-to-action tags are registered and used, and the builder's buttons carry none", () => {
  const used = [...html.matchAll(/data-cta="([^"]+)"/g)].map((m) => m[1]);
  for (const tag of used) assert.ok(CTA_TAGS_2.includes(tag), `unregistered ${tag}`);
  for (const tag of CTA_TAGS_2) assert.ok(used.includes(tag), `unused ${tag}`);
  assert.ok(!/<button[^>]*data-cta/.test(html));
});

test("page: every account in the guide can be ticked, with its own questions", () => {
  for (const p of K.plans) {
    assert.ok(html.includes(`name="f-tools" value="${p.id}"`), p.id);
    assert.ok(html.includes(`data-for="${p.id}"`), `${p.id}: questions`);
  }
  assert.ok(html.includes('name="f-tools" value="none"'));
  assert.ok(html.includes('data-toolname="other-work"'));
});

test("page: the browser data parses and matches the guide", () => {
  const parsed = JSON.parse(html.match(/<script type="application\/json" id="kit-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(parsed.plans.length, data.tools.flatMap((t) => t.plans).length);
  assert.equal(parsed.guideChecked.nl, "22 november 2026");
});

// ---------------------------------------------------------------- files

test("the example Word statement, and Word files made in the browser, are valid", () => {
  const out = mkdtempSync(join(tmpdir(), "kit2-"));
  renderStatement(out);
  const files = unzip(readFileSync(join(out, EXAMPLE_PATH)));
  for (const [name, xml] of Object.entries(files)) wellFormed(xml, name);
  for (const t of ["How we use AI tools with client data", "What we are still checking", "Example Payroll BV (an invented firm)"]) assert.ok(files["word/document.xml"].includes(xmlText(t)), t);
  assert.ok(existsSync(join(out, FACTS_SCHEMA_PATH)));

  const ctx = { module: { exports: {} }, TextEncoder };
  vm.runInNewContext(readFileSync(join(ROOT, "templates", "docx-core.js"), "utf8"), ctx);
  const core = ctx.module.exports;
  const { state } = L.normalizeFacts(K, { ...EXAMPLE_FACTS, language: "nl" });
  for (const blocks of [L.statementBlocks(K, state, NOW), L.letterBlocks(K, state, NOW)]) {
    const made = unzip(Buffer.from(core.zipStored(core.parts(blocks, { title: "AI-verklaring", date: "2026-11-23", lang: "nl-NL" }), "2026-11-23")));
    for (const [name, xml] of Object.entries(made)) wellFormed(xml, name);
    assert.ok(made["word/styles.xml"].includes('w:val="nl-NL"'));
    assert.ok(!DASHES.test(made["word/document.xml"]));
  }
});

test("the Markdown examples in the repository are up to date", () => {
  const generated = "<!-- Generated from data/firm-ai-facts.json and data/client-asks-about-ai.json by src/statement.mjs, with an invented firm. Edit the data, not this file. -->\n\n";
  for (const lang of ["en", "nl"]) {
    const ex = exampleBlocks(kit, facts, data, lang);
    for (const [file, blocks] of [[`example-statement-${lang}.md`, ex.statement], [`example-letter-${lang}.md`, ex.letter]]) {
      assert.ok(existsSync(join(KIT2_DIR, file)), `${file} missing: run node src/render.mjs`);
      assert.equal(readFileSync(join(KIT2_DIR, file), "utf8"), generated + markdown(blocks), `${file} is stale: run node src/render.mjs`);
    }
  }
  for (const f of readdirSync(KIT2_DIR)) assert.ok(!DASHES.test(readFileSync(join(KIT2_DIR, f), "utf8")), f);
});

test("page: carries the site's breadcrumb and 'more in this topic' includes", () => {
  assert.ok(html.includes(`<!-- include: res-${kit.page.slug}-top -->`));
  assert.ok(html.includes(`<!-- include: res-${kit.page.slug}-more -->`));
  assert.ok(!/"BreadcrumbList"/.test(html));
});
