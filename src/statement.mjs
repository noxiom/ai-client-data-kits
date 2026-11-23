#!/usr/bin/env node
// Renders kit 2, "A client asks how you use AI with their data":
//   site/client-asks-about-ai.html          the page, with the statement builder
//   site/data/firm-ai-facts.schema.json     the firm's facts, for AI assistants
//   site/downloads/ai-statement-example.docx   an example statement (invented firm)
//   kits/client-asks-about-ai/*.md          the example statement and letter, EN and NL
//
// The questions and sentences live in data/firm-ai-facts.json, the fact model
// that kit 3 (client questionnaires) will reuse. Vendor statements come from
// the AI accounts guide's dataset, read in place.
//
//   node src/statement.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { docx, markdown } from "./docx.mjs";
import { ROOT, GUIDE_DIR, writeIfChanged, tpl, guideTpl, loadGuide, articleLd, fieldHtml, choiceList, resKey } from "./render.mjs";

const guide = await import(pathToFileURL(join(GUIDE_DIR, "src", "render.mjs")).href);
const { esc, pill, humanDate, fill, resolveCitations, jsonLd, faqLd, faqHtml, cite, SITE_ORIGIN, HUB_SLUG } = guide;

export const KIT2_DIR = join(ROOT, "kits", "client-asks-about-ai");
export const FACTS_SCHEMA_PATH = "/data/firm-ai-facts.schema.json";
export const EXAMPLE_PATH = "/downloads/ai-statement-example.docx";
// Every data-cta tag on this page; each must be registered in the website's
// counter config before release. The builder's own buttons carry none.
export const CTA_TAGS_2 = ["statement-example", "statement-check", "statement-sample", "statement-intake"];

export const loadKit2 = () => JSON.parse(readFileSync(join(ROOT, "data", "client-asks-about-ai.json"), "utf8"));
export const loadFacts = () => JSON.parse(readFileSync(join(ROOT, "data", "firm-ai-facts.json"), "utf8"));

export function allSources2(kit, data) {
  const ids = new Set(data.sources.map((s) => s.id));
  for (const s of kit.sources) if (ids.has(s.id)) throw new Error(`kit source id collides with the guide: ${s.id}`);
  return [...data.sources, ...kit.sources];
}

// ---------------------------------------------------------------- browser data

export function statementData(kit, facts, data) {
  const sources = {};
  for (const s of data.sources) sources[s.id] = { publisher: s.publisher, title: s.title, url: s.url, checked: s.checked };
  const plans = data.tools.flatMap((t) =>
    t.plans.map((p) => ({
      id: p.id,
      tool: t.name,
      slug: t.slug,
      vendor: t.vendor,
      name: p.name,
      account: p.account,
      facts: Object.fromEntries(["training", "retention", "location", "contract"].map((f) => [f, { short: p.fields[f].short, tone: p.fields[f].tone, sources: p.fields[f].sources }])),
    })),
  );
  const { description, rules, ...factModel } = facts;
  return {
    id: kit.id,
    schemaUrl: `${SITE_ORIGIN}${FACTS_SCHEMA_PATH}`,
    pageUrl: `noxiom.com/${kit.page.slug}`,
    guideChecked: { en: humanDate(data.checked), nl: humanDate(data.checked, "nl") },
    plans,
    facts: factModel,
    letter_fields: kit.builder.letter_fields,
    documents: kit.documents,
    sources,
    tones: guide.TONES,
  };
}

// ---------------------------------------------------------------- the form

const tag = (account) => `<span class="tag tag-${account}">${account === "work" ? "Work" : "Personal"}</span>`;

function toolQuestions(facts, id, account, isOther) {
  const qs = facts.tool_questions.filter((q) => q.accounts.includes(account));
  const name = isOther
    ? `<label class="kit-field"><span class="kit-label">${esc(facts.other_tool.name_label)}</span><input type="text" class="kit-input" data-toolname="${esc(id)}" autocomplete="off" spellcheck="false" maxlength="80" /></label>`
    : "";
  return `<div class="kit-toolq" data-for="${esc(id)}" hidden>${name}${qs
    .map(
      (q) => `<div class="kit-field" role="radiogroup" aria-label="${esc(q.label)}"><span class="kit-hint kit-toolq-label">${esc(q.label)}</span>${choiceList(`t-${id}-${q.id}`, "radio", q.options, false)}</div>`,
    )
    .join("")}</div>`;
}

function toolsPicker(field, facts, data) {
  const row = (id, label, account, isOther = false) =>
    `<label class="kit-row"><input type="checkbox" name="f-tools" value="${esc(id)}" autocomplete="off" /><span class="kit-ind" aria-hidden="true"></span><span class="kit-row-text">${esc(label)}</span>${account ? tag(account) : ""}</label>` +
    (account ? toolQuestions(facts, id, account, isOther) : "");
  const groups = data.tools.map(
    (t) => `<p class="kit-tool-head">${esc(t.name)}</p><div class="kit-rows">${t.plans.map((p) => row(p.id, p.name, p.account)).join("")}</div>`,
  );
  groups.push(`<p class="kit-tool-head">Other</p><div class="kit-rows">${row(facts.other_tool.id, facts.other_tool.label, facts.other_tool.account, true)}${row(facts.no_tools.id, facts.no_tools.label, "")}</div>`);
  const opt = "";
  return `<div class="kit-field" role="group" aria-labelledby="l-${field.id}" data-field="${field.id}" data-type="tools"><span class="kit-label" id="l-${field.id}">${esc(field.label)}${opt}</span><span class="kit-hint">${esc(field.hint)}</span>${groups.join("")}</div>`;
}

function formHtml(kit, facts, data) {
  const lang = `<fieldset class="kit-section" id="sec-language"><legend>Output</legend><div class="kit-group">${fieldHtml(
    { id: "language", type: "radio", label: kit.builder.language_label, hint: kit.builder.language_note, options: [["en", "English"], ["nl", "Nederlands"]] },
    null,
    data,
  )}</div></fieldset>`;
  const sections = facts.sections.map(
    (s) =>
      `<fieldset class="kit-section" id="sec-${s.id}"><legend>${esc(s.title)}</legend><div class="kit-group">${s.fields
        .map((f) => (f.type === "tools" ? toolsPicker(f, facts, data) : fieldHtml(f, null, data)))
        .join("")}</div></fieldset>`,
  );
  const letter = `<fieldset class="kit-section" id="sec-letter"><legend>The letter</legend><div class="kit-group">${kit.builder.letter_fields.map((f) => fieldHtml(f, null, data)).join("")}</div></fieldset>`;
  return [lang, ...sections, letter].join("\n");
}

// ---------------------------------------------------------------- for AI assistants

const allFields = (kit, facts) => [...facts.sections.flatMap((s) => s.fields), ...kit.builder.letter_fields];

function toolIds(facts, data) {
  return [...data.tools.flatMap((t) => t.plans.map((p) => [p.id, `${p.name} (${p.account} account)`])), [facts.other_tool.id, facts.other_tool.label], [facts.no_tools.id, facts.no_tools.label]];
}

export function factsSchema(kit, facts, data) {
  const oneOf = (options) => options.map(([v, l]) => ({ const: v, title: l }));
  const properties = {
    $schema: { const: `${SITE_ORIGIN}${FACTS_SCHEMA_PATH}` },
    facts: { const: facts.id },
    version: { const: facts.version },
    saved_at: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$", description: "When the facts were saved, local time." },
    language: { title: kit.builder.language_label, enum: ["en", "nl"] },
  };
  for (const f of allFields(kit, facts)) {
    const base = { title: f.label, ...(f.hint ? { description: f.hint } : {}) };
    if (f.type === "tools") properties[f.id] = { ...base, type: "array", uniqueItems: true, items: { oneOf: oneOf(toolIds(facts, data)) } };
    else if (f.options) properties[f.id] = { ...base, oneOf: oneOf(f.options) };
    else properties[f.id] = { ...base, type: "string", maxLength: 300 };
  }
  const perAccount = (account, other = false) => ({
    type: "object",
    properties: {
      ...(other ? { name: { type: "string", maxLength: 80, title: facts.other_tool.name_label } } : {}),
      ...Object.fromEntries(facts.tool_questions.filter((q) => q.accounts.includes(account)).map((q) => [q.id, { title: q.label, oneOf: oneOf(q.options) }])),
    },
    additionalProperties: false,
  });
  properties.tool_facts = {
    title: "The short questions per account, for each account in tools",
    type: "object",
    properties: {
      ...Object.fromEntries(data.tools.flatMap((t) => t.plans.map((p) => [p.id, perAccount(p.account)]))),
      [facts.other_tool.id]: perAccount(facts.other_tool.account, true),
    },
    additionalProperties: false,
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${SITE_ORIGIN}${FACTS_SCHEMA_PATH}`,
    title: "Firm AI facts",
    description:
      `What a small firm has confirmed about the AI tools it uses with client data, from ${SITE_ORIGIN}/${kit.page.slug}. ` +
      "For AI assistants helping someone fill it in: ask the questions one at a time in plain words; for each account in tools, ask its questions under tool_facts; " +
      "record only what the person has confirmed, and use the not sure value or leave a question out otherwise; never record what a vendor promises as the firm's own fact; " +
      "don't ask for client names or client data; give the result as one JSON object. The person pastes it into the statement builder on the page, which checks it in their browser. " +
      "Any answer left out becomes an open point in the statement, never a claim.",
    "x-version": facts.version,
    "x-license": kit.license.url,
    type: "object",
    properties,
    additionalProperties: false,
  };
}

export const EXAMPLE_FACTS = {
  facts: "firm-ai-facts",
  version: 1,
  language: "en",
  firm_name: "Example Payroll BV (an invented firm)",
  contact: "our office manager, privacy@example.nl",
  role: "processor",
  tools: ["copilot-chat-work", "chatgpt-business"],
  tool_facts: {
    "copilot-chat-work": { dpa: "signed", training: "off_checked", region: "eu", retention: "set" },
    "chatgpt-business": { dpa: "signed", training: "default", region: "unsure", retention: "default" },
  },
  shadow: "asked",
  personal: "not_allowed",
  client_data: "deidentified",
  special: "never",
  opt_out: "honour",
  review: "always",
  policy: "yes",
  literacy: "planned",
  subprocessors: "not_yet",
  incidents: "procedure",
};

function assistantSection(kit, facts, data) {
  const values = (options) => options.map(([v, l]) => `<code>${esc(v)}</code> (${esc(l)})`).join(", ");
  const items = allFields(kit, facts).map((f) => {
    let how;
    if (f.type === "tools") how = `a list, any of: ${values(toolIds(facts, data))}`;
    else if (f.options) how = `one of: ${values(f.options)}`;
    else how = "short free text";
    return `<li><code>${esc(f.id)}</code>: ${esc(f.label)}${f.optional ? " (optional)" : ""} ${how}.</li>`;
  });
  const q = facts.tool_questions.map((x) => `<li><code>${esc(x.id)}</code>: ${esc(x.label)} (${x.accounts.join(" and ")} accounts) ${values(x.options)}.</li>`);
  return `<p>The facts are one JSON object. The questions and allowed answers are published as a JSON Schema: <a href="${FACTS_SCHEMA_PATH}">${SITE_ORIGIN}${FACTS_SCHEMA_PATH}</a>.</p>
            <ol class="report-list">
              <li>Ask the questions one at a time, in plain words, and offer the allowed answers.</li>
              <li>For each account in <code>tools</code>, ask its short questions and put the answers under <code>tool_facts</code>, keyed by the account.</li>
              <li>Record only what the person has confirmed. If they aren't sure, use the "not sure" value or leave the question out. Don't fill in what a vendor promises as the firm's own fact.</li>
              <li>Don't ask for client names or client data. The questions are about the firm's own setup.</li>
              <li>Give the result as one JSON code block. The person pastes it into "Paste facts" on this page, which checks it in their browser. Anything left out becomes an open point in the statement, never a claim.</li>
            </ol>
            <p><strong>Questions:</strong></p>
            <ul class="kit-assist-fields">
${items.join("\n")}
            </ul>
            <p><strong>Per account, under <code>tool_facts</code>:</strong></p>
            <ul class="kit-assist-fields">
${q.join("\n")}
            </ul>
            <p><strong>Example</strong> (an invented firm):</p>
            <pre class="kit-code">${esc(JSON.stringify(EXAMPLE_FACTS, null, 2))}</pre>`;
}

// ---------------------------------------------------------------- the page

function asksTable(kit) {
  return `<ul class="kit-asks">
${kit.page.asks.map((a) => `<li><span class="kit-asks-q">&ldquo;${esc(a.q)}&rdquo;${cite(a.sources)}</span><span class="kit-asks-a">Your statement: ${esc(a.where)}</span></li>`).join("\n")}
            </ul>`;
}

function whyCards(kit) {
  return kit.page.why
    .map((w) => `<div class="step-card"><h3>${esc(w.title)}</h3><p>${esc(w.text)}${cite(w.sources)}</p></div>`)
    .join("\n");
}

function changelog(kit) {
  return `<ul class="report-list">\n${kit.changelog.map((c) => `<li><strong>${humanDate(c.date)}:</strong> ${esc(c.change)}</li>`).join("\n")}\n</ul>`;
}

export function renderStatementPage(kit, facts, data) {
  const p = kit.page;
  const url = `${SITE_ORIGIN}/${p.slug}`;
  // The breadcrumb comes from the website's free-resources index (res_key).
  const ld = [articleLd(kit, data, { headline: p.title, description: p.meta_description, url }), faqLd(p.faq)];
  const html = fill(tpl("statement.html"), {
    res_key: resKey(p.slug),
    guide_css: guideTpl("guide.css"),
    kit_css: tpl("kit.css").trim(),
    seo_title: esc(p.seo_title),
    meta_description: esc(p.meta_description),
    canonical: url,
    title: esc(p.title),
    lead: esc(p.lead),
    jsonld: jsonLd(ld),
    checked_iso: kit.checked,
    checked_human: humanDate(kit.checked),
    next_review_human: humanDate(kit.next_review),
    version: esc(kit.version),
    answer: esc(p.answer),
    asks_intro: esc(p.asks_intro),
    asks: asksTable(kit),
    why: whyCards(kit),
    builder_intro: esc(kit.builder.intro),
    assistant_intro: esc(kit.assistant.intro),
    assistant_caution: esc(kit.assistant.caution),
    assistant_prompt: esc(kit.assistant.prompt),
    assistant_section: assistantSection(kit, facts, data),
    form: formHtml(kit, facts, data),
    gap_title: esc(p.gap_title),
    gap_text: esc(p.gap_text),
    faq: faqHtml(p.faq),
    guide_url: `/${HUB_SLUG}`,
    guide_checked_human: humanDate(data.checked),
    example_url: EXAMPLE_PATH,
    open_pill: pill("Open point", "unknown"),
    changelog: changelog(kit),
    kit_data: JSON.stringify(statementData(kit, facts, data)).replaceAll("</", "<\\/"),
    logic_js: tpl("statement-logic.js").trim(),
    docx_js: tpl("docx-core.js").trim(),
    statement_js: tpl("statement.js").trim(),
  });
  return resolveCitations(html, { sources: allSources2(kit, data) });
}

// ---------------------------------------------------------------- example documents

const logic = createRequire(import.meta.url)("../templates/statement-logic.js");
// The example is dated with the kit, so a rebuild gives the same bytes.
const exampleDate = (kit) => {
  const [y, m, d] = kit.checked.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0);
};

export function exampleBlocks(kit, facts, data, lang = "en") {
  const K = statementData(kit, facts, data);
  const firm_name = lang === "nl" ? "Voorbeeld Salarisadministratie BV (een verzonnen bedrijf)" : EXAMPLE_FACTS.firm_name;
  const contact = lang === "nl" ? "onze officemanager, privacy@example.nl" : EXAMPLE_FACTS.contact;
  const { state } = logic.normalizeFacts(K, { ...EXAMPLE_FACTS, language: lang, firm_name, contact });
  return { statement: logic.statementBlocks(K, state, exampleDate(kit)), letter: logic.letterBlocks(K, state, exampleDate(kit)) };
}

export function renderStatement(outDir = join(ROOT, "site"), kit = loadKit2(), facts = loadFacts(), data = loadGuide()) {
  mkdirSync(join(outDir, "downloads"), { recursive: true });
  mkdirSync(join(outDir, "data"), { recursive: true });
  mkdirSync(KIT2_DIR, { recursive: true });
  writeFileSync(join(outDir, `${kit.page.slug}.html`), renderStatementPage(kit, facts, data));
  writeFileSync(join(outDir, FACTS_SCHEMA_PATH), JSON.stringify(factsSchema(kit, facts, data), null, 2) + "\n");
  const en = exampleBlocks(kit, facts, data, "en");
  const nl = exampleBlocks(kit, facts, data, "nl");
  writeFileSync(join(outDir, EXAMPLE_PATH), docx(en.statement, { title: "Example AI statement", date: kit.checked }));
  const generated = "<!-- Generated from data/firm-ai-facts.json and data/client-asks-about-ai.json by src/statement.mjs, with an invented firm. Edit the data, not this file. -->\n\n";
  writeIfChanged(join(KIT2_DIR, "example-statement-en.md"), generated + markdown(en.statement));
  writeIfChanged(join(KIT2_DIR, "example-letter-en.md"), generated + markdown(en.letter));
  writeIfChanged(join(KIT2_DIR, "example-statement-nl.md"), generated + markdown(nl.statement));
  writeIfChanged(join(KIT2_DIR, "example-letter-nl.md"), generated + markdown(nl.letter));
  return [{ file: `${kit.page.slug}.html`, path: `/${kit.page.slug}` }];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pages = renderStatement(process.argv[2] || join(ROOT, "site"));
  console.log(`Rendered ${pages.map((p) => p.path).join(", ")}, the facts schema, an example Word statement and 4 Markdown examples`);
}
