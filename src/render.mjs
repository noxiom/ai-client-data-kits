#!/usr/bin/env node
// Renders the "Client data went into an AI tool" kit from one data file:
//   site/<slug>.html          two web pages, mirroring website/src/
//   site/downloads/*.docx     the Word templates (also linked from the pages)
//   kits/client-data-in-ai/*.md   the same templates as Markdown, for the repository
//
// It reuses the AI accounts guide: its dataset (vendor facts per account),
// its stylesheet and its page helpers. Nothing is copied or forked: the
// guide's folder (guide/ in this repository) is read in place.
//
//   node src/render.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { docx, markdown } from "./docx.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GUIDE_DIR = resolve(process.env.GUIDE_DIR || join(ROOT, "guide"));
const guide = await import(pathToFileURL(join(GUIDE_DIR, "src", "render.mjs")).href);
const { esc, pill, humanDate, fill, resolveCitations, jsonLd, faqLd, faqHtml, cite, publisher, founder, TONES, SITE_ORIGIN, HUB_SLUG } = guide;

export const KIT_DIR = join(ROOT, "kits", "client-data-in-ai");
export const DOWNLOADS = {
  record: "/downloads/ai-incident-record.docx",
  handout: "/downloads/ai-incident-staff-handout.docx",
};
// The record's questions and answers, machine-readable, for AI assistants.
export const SCHEMA_PATH = "/data/ai-incident-record.schema.json";
// Every data-cta tag these pages use. Each must be registered in the
// website's counter config before release (website CLAUDE.md).
export const CTA_TAGS = ["incident-template", "incident-handout", "incident-check", "incident-sample", "incident-intake", "pasted-handout"];

export function loadKit(path = join(ROOT, "data", "client-data-in-ai.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
}
export const loadGuide = () => guide.loadData(join(GUIDE_DIR, "data", "ai-accounts.json"));

// One source list for citations: the guide's sources plus the kit's own.
export function allSources(kit, data) {
  const ids = new Set(data.sources.map((s) => s.id));
  for (const s of kit.sources) if (ids.has(s.id)) throw new Error(`kit source id collides with the guide: ${s.id}`);
  return [...data.sources, ...kit.sources];
}

const tpl = (name) => readFileSync(join(ROOT, "templates", name), "utf8");
const guideTpl = (name) => readFileSync(join(GUIDE_DIR, "templates", name), "utf8").trim();

// ---------------------------------------------------------------- shared bits

function common(kit, data) {
  return {
    guide_css: guideTpl("guide.css"),
    kit_css: tpl("kit.css").trim(),
    checked_iso: kit.checked,
    checked_human: humanDate(kit.checked),
    next_review_human: humanDate(kit.next_review),
    guide_url: `/${HUB_SLUG}`,
    guide_checked_human: humanDate(data.checked),
    owner_url: `/${kit.owner.slug}`,
    employee_url: `/${kit.employee.slug}`,
    record_url: DOWNLOADS.record,
    handout_url: DOWNLOADS.handout,
    version: esc(kit.version),
    changelog: `<ul class="report-list">\n${kit.changelog.map((c) => `<li><strong>${humanDate(c.date)}:</strong> ${esc(c.change)}</li>`).join("\n")}\n</ul>`,
  };
}

function articleLd(kit, data, { headline, description, url }) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    url,
    mainEntityOfPage: url,
    inLanguage: "en",
    datePublished: kit.changelog[kit.changelog.length - 1].date,
    dateModified: kit.checked,
    author: founder(data),
    publisher: publisher({ publisher: { name: "Noxiom", url: SITE_ORIGIN } }),
    isAccessibleForFree: true,
    license: kit.license.url,
  };
}

const breadcrumb = (name, url) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Noxiom", item: `${SITE_ORIGIN}/` },
    { "@type": "ListItem", position: 2, name, item: url },
  ],
});

// The guide's account types, flattened for the record builder and the notes.
export function planFacts(data) {
  const label = Object.fromEntries(data.fields.map((f) => [f.id, f.label]));
  return data.tools.flatMap((tool) =>
    tool.plans.map((plan) => ({
      id: plan.id,
      tool: tool.name,
      slug: tool.slug,
      name: plan.name,
      account: plan.account,
      facts: ["training", "retention", "contract"].map((id) => ({
        id,
        label: label[id],
        short: plan.fields[id].short,
        tone: plan.fields[id].tone,
        text: plan.fields[id].text,
        sources: plan.fields[id].sources,
      })),
      incident_note: plan.account === "personal" ? tool.incident_note : null,
      incident_sources: plan.account === "personal" ? tool.incident_sources : [],
    })),
  );
}

// ---------------------------------------------------------------- employee page

function toolNotes(data) {
  return data.tools
    .filter((t) => t.plans.some((p) => p.account === "personal"))
    .map((t) => `<li><strong>${esc(t.name)}:</strong> ${esc(t.incident_note)}${cite(t.incident_sources)} <a href="/${t.slug}">More on ${esc(t.name)}</a></li>`)
    .join("\n");
}

function stepCards(steps, extra = {}) {
  return steps
    .map((s, i) => {
      const items = s.items && s.items.length ? `<ul>\n${s.items.map((x) => `<li>${esc(x)}</li>`).join("\n")}\n</ul>` : "";
      return `<div class="step-card">
              <span class="step-num" aria-hidden="true">${i + 1}</span>
              <span class="kit-when">${esc(s.when)}</span>
              <h3>${esc(s.title)}</h3>
              <p>${esc(s.text)}</p>
              ${items}${extra[i] || ""}
            </div>`;
    })
    .join("\n");
}

export function renderEmployee(kit, data) {
  const e = kit.employee;
  const url = `${SITE_ORIGIN}/${e.slug}`;
  const ld = [articleLd(kit, data, { headline: e.title, description: e.meta_description, url }), faqLd(e.faq), breadcrumb(e.title, url)];
  const extra = {
    1: `<p class="kit-message" id="msg">${esc(e.message)}</p>
              <button type="button" class="kit-copy" data-copy="msg" hidden>Copy the message</button>`,
    2: `<details>
                <summary>What deleting does, per tool</summary>
                <ul class="kit-tools">
${toolNotes(data)}
                </ul>
              </details>`,
  };
  const html = fill(tpl("employee.html"), {
    ...common(kit, data),
    seo_title: esc(e.seo_title),
    meta_description: esc(e.meta_description),
    canonical: url,
    title: esc(e.title),
    lead: esc(e.lead),
    jsonld: jsonLd(ld),
    answer: `<ol>\n${e.answer.map((a) => `<li>${esc(a)}</li>`).join("\n")}\n</ol>`,
    why_today: `${esc(e.why_today)}${cite(["gdpr", "edpb-breach"])}`,
    steps: stepCards(e.steps, extra),
    work_account: `${esc(e.work_account)}${cite(e.work_account_sources)}`,
    next: `<ol class="report-list">\n${e.next.map((n) => `<li>${esc(n)}</li>`).join("\n")}\n</ol>`,
    faq: faqHtml(e.faq),
    kit_js: tpl("kit.js").trim(),
  });
  return resolveCitations(html, { sources: allSources(kit, data) });
}

// ---------------------------------------------------------------- owner page

function ownerSteps(kit) {
  return kit.owner.steps
    .map(
      (s, i) => `<div class="step-card" id="step-${s.id}">
              <span class="step-num" aria-hidden="true">${i + 1}</span>
              <span class="kit-when">${esc(s.when)}</span>
              <h3>${esc(s.title)}</h3>
              <p>${esc(s.text)}</p>
              <details>
                <summary>Why and how</summary>
                <p>${esc(s.detail)}${cite(s.sources)}</p>
              </details>
            </div>`,
    )
    .join("\n");
}

// Form controls. No native dropdowns or calendar popups: single and multiple
// choices are tappable chips (short options) or a grouped list (long ones),
// built on real radio and checkbox inputs so the keyboard works as usual.
const useRows = (f) => f.type === "actions" || f.options.length > 6 || f.options.some(([, l]) => l.length > 32);

function choiceList(name, input, options, rows, stamps = false) {
  if (rows) {
    return `<div class="kit-rows">${options
      .map(
        ([v, l, extra = ""]) =>
          `<label class="kit-row"><input type="${input}" name="${name}" value="${esc(v)}" autocomplete="off" /><span class="kit-ind" aria-hidden="true"></span><span class="kit-row-text">${esc(l)}</span>${extra}${stamps ? `<span class="kit-stamp" data-stamp="${esc(v)}"></span>` : ""}</label>`,
      )
      .join("")}</div>`;
  }
  return `<div class="kit-chips">${options
    .map(([v, l]) => `<label class="kit-chip"><input type="${input}" name="${name}" value="${esc(v)}" autocomplete="off" /><span>${esc(l)}</span></label>`)
    .join("")}</div>`;
}

// Tool first, then the account: two short choices instead of one long list.
function planPicker(field, data, kit) {
  const tools = [...data.tools.map((t) => [t.id, t.name]), ["other", "Another tool"], ["unknown", "Not sure"]];
  const tag = (account) => `<span class="tag tag-${account}">${account === "work" ? "Work" : "Personal"}</span>`;
  const groups = [
    ...data.tools.map((t) => [t.id, t.plans.map((p) => [p.id, p.name, tag(p.account)])]),
    ["other", kit.other_accounts.filter((o) => o.account !== "unknown").map((o) => [o.id, o.label.replace(/^Another AI tool: /, ""), tag(o.account)])],
    ["unknown", kit.other_accounts.filter((o) => o.account === "unknown").map((o) => [o.id, o.label])],
  ];
  return `<div class="kit-chips" role="radiogroup" aria-label="Tool">${tools
    .map(([v, l]) => `<label class="kit-chip"><input type="radio" name="f-${field.id}-tool" value="${esc(v)}" autocomplete="off" /><span>${esc(l)}</span></label>`)
    .join("")}</div>
${groups.map(([tool, opts]) => `<div class="kit-accounts" data-tool="${esc(tool)}" role="radiogroup" aria-label="Account" hidden>${choiceList(`f-${field.id}`, "radio", opts, true)}</div>`).join("\n")}`;
}

function fieldHtml(field, kit, data) {
  const opt = field.optional ? ' <span class="kit-optional">optional</span>' : "";
  const label = `<span class="kit-label" id="l-${field.id}">${esc(field.label)}${opt}</span>`;
  const hint = field.hint ? `<span class="kit-hint">${esc(field.hint)}</span>` : "";
  const group = (type, role, body) =>
    `<div class="kit-field" role="${role}" aria-labelledby="l-${field.id}" data-field="${field.id}" data-type="${type}">${label}${hint}${body}</div>`;
  switch (field.type) {
    case "datetime":
      return group(
        "datetime",
        "group",
        `<div class="kit-chips kit-days" data-days="f-${field.id}-day"></div>
<div class="kit-clock"><input type="date" class="kit-input kit-date" aria-label="Date" autocomplete="off" hidden /><input type="time" class="kit-input kit-time" aria-label="Time" autocomplete="off" /><button type="button" class="kit-now">Now</button></div>`,
      );
    case "text":
      return `<label class="kit-field">${label}${hint}<input type="text" class="kit-input" id="f-${field.id}" data-field="${field.id}" data-type="text" autocomplete="off" spellcheck="false" /></label>`;
    case "textarea":
      return `<label class="kit-field">${label}${hint}<textarea class="kit-input" id="f-${field.id}" data-field="${field.id}" data-type="textarea" rows="3" autocomplete="off" spellcheck="false"></textarea></label>`;
    case "plan":
      return group("plan", "group", planPicker(field, data, kit));
    case "select":
    case "radio":
      return group("radio", "radiogroup", choiceList(`f-${field.id}`, "radio", field.options, useRows(field)));
    case "checkbox":
      return group("checkbox", "group", choiceList(`f-${field.id}`, "checkbox", field.options, useRows(field)));
    case "actions":
      return group("actions", "group", choiceList(`f-${field.id}`, "checkbox", field.options, true, true));
    default:
      throw new Error(`unknown field type: ${field.type}`);
  }
}

function formHtml(kit, data) {
  return kit.record.sections
    .map((s) => `<fieldset class="kit-section" id="sec-${s.id}"><legend>${esc(s.title)}</legend><div class="kit-group">${s.fields.map((f) => fieldHtml(f, kit, data)).join("")}</div></fieldset>`)
    .join("\n");
}

// The same factors as a readable list, for readers without JavaScript and
// for search engines and assistants.
function staticFactors(kit) {
  const group = (dir, title, tone) => {
    const items = kit.factors.filter((f) => f.direction === dir);
    return `<h3>${pill(title, tone)}</h3>
            <ul class="kit-static-factors">
${items.map((f) => `<li><strong>${esc(f.criterion)}.</strong> ${esc(f.text)}${cite(f.sources)}</li>`).join("\n")}
            </ul>`;
  };
  return [group("up", "Point towards reporting", "critical"), group("down", "May lower the risk", "good"), group("unknown", "Still to find out", "unknown")].join("\n");
}

// Short source names for the factor list in the record builder.
const SHORT = { "edpb-breach": "EDPB breach guidelines", "ap-chatbots": "Dutch DPA (AP)", "ap-report": "Dutch DPA (AP)", gdpr: "GDPR" };

// What the browser needs, and nothing more.
export function kitData(kit, data) {
  const sources = {};
  for (const s of allSources(kit, data)) {
    sources[s.id] = { publisher: s.publisher, short: SHORT[s.id] || s.publisher, title: s.title, url: s.url, checkedHuman: humanDate(s.checked) };
  }
  return {
    id: kit.id,
    schemaUrl: `${SITE_ORIGIN}${SCHEMA_PATH}`,
    pageUrl: `noxiom.com/${kit.owner.slug}`,
    guideCheckedHuman: humanDate(data.checked),
    plans: planFacts(data),
    other_accounts: kit.other_accounts,
    factors: kit.factors,
    record: kit.record,
    sources,
    tones: TONES,
  };
}

// ---------------------------------------------------------------- for AI assistants

const allFields = (kit) => kit.record.sections.flatMap((s) => s.fields);

function planChoices(kit, data) {
  return [
    ...planFacts(data).map((p) => [p.id, `${p.name} (${p.account} account)`]),
    ...kit.other_accounts.map((o) => [o.id, o.label]),
  ];
}

const LOCAL_TIME = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$";

// JSON Schema for a record: what an assistant fills in and the page loads back.
export function recordSchema(kit, data) {
  const oneOf = (options) => options.map(([v, l]) => ({ const: v, title: l }));
  const properties = {
    $schema: { const: `${SITE_ORIGIN}${SCHEMA_PATH}` },
    kit: { const: kit.id },
    version: { const: 1 },
    saved_at: { type: "string", pattern: LOCAL_TIME, description: "When the record was saved, local time." },
  };
  for (const f of allFields(kit)) {
    const base = { title: f.label, ...(f.hint ? { description: f.hint } : {}) };
    if (f.type === "datetime") properties[f.id] = { ...base, type: "string", pattern: LOCAL_TIME, description: `${f.hint ? f.hint + " " : ""}Local time, written as YYYY-MM-DDTHH:MM.` };
    else if (f.type === "plan") properties[f.id] = { ...base, oneOf: oneOf(planChoices(kit, data)) };
    else if (f.type === "checkbox") properties[f.id] = { ...base, type: "array", uniqueItems: true, items: { oneOf: oneOf(f.options) } };
    else if (f.type === "actions") {
      properties[f.id] = {
        ...base,
        type: "object",
        description: "The containment steps already taken, each with the local time it was done (YYYY-MM-DDTHH:MM).",
        properties: Object.fromEntries(f.options.map(([v, l]) => [v, { title: l, type: "string", pattern: LOCAL_TIME }])),
        additionalProperties: false,
      };
    } else if (f.options) properties[f.id] = { ...base, oneOf: oneOf(f.options) };
    else properties[f.id] = { ...base, type: "string", maxLength: 2000 };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${SITE_ORIGIN}${SCHEMA_PATH}`,
    title: "AI data incident record",
    description:
      `The record from ${SITE_ORIGIN}/${kit.owner.slug}: what a small firm writes down when client or company data went into an AI tool. ` +
      "For AI assistants helping someone fill it in: ask the questions one at a time in plain words; describe the data by type only and never ask for the data itself or anyone's name; " +
      "use only the listed values (const) for choices; leave out what the person doesn't know instead of guessing; give the result as one JSON object. " +
      "The person pastes it into the record builder on the page, which checks it and fills the form in their browser. The page never decides whether to report a breach; neither should you.",
    "x-version": kit.version,
    "x-license": kit.license.url,
    type: "object",
    properties,
    additionalProperties: false,
  };
}

function assistantSection(kit, data) {
  const fields = allFields(kit);
  const values = (options) => options.map(([v, l]) => `<code>${esc(v)}</code> (${esc(l)})`).join(", ");
  const items = fields.map((f) => {
    let how;
    if (f.type === "datetime") how = "local time, <code>YYYY-MM-DDTHH:MM</code>";
    else if (f.type === "plan") how = `one of: ${values(planChoices(kit, data))}`;
    else if (f.type === "checkbox") how = `a list, any of: ${values(f.options)}`;
    else if (f.type === "actions") how = `an object of step: local time, steps: ${values(f.options)}`;
    else if (f.options) how = `one of: ${values(f.options)}`;
    else how = "free text, by type only";
    return `<li><code>${esc(f.id)}</code>: ${esc(f.label)}${f.optional ? " (optional)" : ""} ${how}.</li>`;
  });
  const example = {
    kit: kit.id,
    version: 1,
    aware_at: "2026-11-23T09:15",
    reported_by: "self",
    plan: "chatgpt-personal",
    how: "upload",
    rules: "against",
    training: "unsure",
    categories: ["contact", "financial"],
    people: "11-100",
    whose: ["client"],
    description: "Payroll export with names, salaries and bank account numbers of about 40 employees of a client",
    role: "processor",
    actions: { deleted: "2026-11-23T09:40" },
  };
  return `<p>The record is one JSON object. The full list of questions and allowed answers is published as a JSON Schema: <a href="${SCHEMA_PATH}">${SITE_ORIGIN}${SCHEMA_PATH}</a>.</p>
            <ol class="report-list">
              <li>Ask the questions one at a time, in plain words, and offer the allowed answers.</li>
              <li>Describe the data by type only. Never ask for the data itself, or for the names of the people or the client.</li>
              <li>Use only the listed values. If the person doesn't know, use the "not sure" value or leave the question out. Don't guess.</li>
              <li>Don't decide whether the breach must be reported. The page shows the factors; the firm decides.</li>
              <li>Give the result as one JSON code block. The person pastes it into "Paste a record" on this page, which checks it and fills the form in their browser.</li>
            </ol>
            <p><strong>Fields:</strong></p>
            <ul class="kit-assist-fields">
${items.join("\n")}
            </ul>
            <p><strong>Example:</strong></p>
            <pre class="kit-code">${esc(JSON.stringify(example, null, 2))}</pre>`;
}

export function renderOwner(kit, data) {
  const o = kit.owner;
  const url = `${SITE_ORIGIN}/${o.slug}`;
  const ld = [articleLd(kit, data, { headline: o.title, description: o.meta_description, url }), faqLd(o.faq), breadcrumb(o.title, url)];
  const html = fill(tpl("incident.html"), {
    ...common(kit, data),
    seo_title: esc(o.seo_title),
    meta_description: esc(o.meta_description),
    canonical: url,
    title: esc(o.title),
    lead: esc(o.lead),
    jsonld: jsonLd(ld),
    answer: esc(o.answer),
    steps: ownerSteps(kit),
    record_intro: esc(kit.record.intro),
    assistant_intro: esc(kit.assistant.intro),
    assistant_caution: esc(kit.assistant.caution),
    assistant_prompt: esc(kit.assistant.prompt),
    assistant_section: assistantSection(kit, data),
    schema_url: SCHEMA_PATH,
    form: formHtml(kit, data),
    static_factors: staticFactors(kit),
    faq: faqHtml(o.faq),
    kit_data: JSON.stringify(kitData(kit, data)).replaceAll("</", "<\\/"),
    logic_js: tpl("incident-logic.js").trim(),
    docx_js: tpl("docx-core.js").trim(),
    incident_js: tpl("incident.js").trim(),
  });
  return resolveCitations(html, { sources: allSources(kit, data) });
}

// ---------------------------------------------------------------- templates as Word and Markdown

export function recordBlocks(kit, data) {
  const blocks = [
    { type: "title", text: "AI data incident record" },
    { type: "small", text: `One record per incident. Keep it with your firm's breach register, also when you decide not to report. Template version ${kit.version}, ${humanDate(kit.checked)}, from noxiom.com/${kit.owner.slug} (CC BY 4.0). Not legal advice.` },
    { type: "p", text: kit.record.intro },
  ];
  for (const section of kit.record.sections) {
    blocks.push({ type: "h1", text: section.title });
    for (const f of section.fields) {
      const label = f.label + (f.optional ? " (optional)" : "");
      if (f.type === "datetime" || f.type === "text") blocks.push({ type: "field", label, hint: f.hint, lines: 1 });
      else if (f.type === "textarea") blocks.push({ type: "field", label, hint: f.hint, lines: 3 });
      else if (f.type === "plan") blocks.push({ type: "field", label, hint: "Tool, and account: personal, work, or not sure. " + (f.hint || ""), lines: 1 });
      else if (f.type === "actions") blocks.push({ type: "p", text: `**${f.label.split(".")[0]}.** Add the date and time to each.` }, { type: "checks", items: f.options.map(([, l]) => `${l}: ____________`) });
      else blocks.push({ type: "p", text: `**${label}**${f.type === "checkbox" ? " Tick all that apply." : ""}` }, { type: "checks", items: f.options.map(([, l]) => l) });
      if (f.id === "aware_at") blocks.push({ type: "field", label: "72 hours after awareness", hint: "The latest point for reporting, where feasible. A later report must give the reasons for the delay.", lines: 1 });
    }
  }
  blocks.push(
    { type: "h1", text: "Factors considered" },
    { type: "p", text: "Tick what applies. These are the criteria the European data protection authorities use; they inform the decision, they don't make it. If in doubt, the European guidance is to report." },
    { type: "h2", text: "Point towards reporting" },
    { type: "checks", items: kit.factors.filter((f) => f.direction === "up").map((f) => `${f.criterion}: ${f.text}`) },
    { type: "h2", text: "May lower the risk" },
    { type: "checks", items: kit.factors.filter((f) => f.direction === "down").map((f) => `${f.criterion}: ${f.text}`) },
    { type: "h1", text: "Sources" },
    { type: "bullets", items: allSources(kit, data).filter((s) => ["gdpr", "edpb-breach", "ap-chatbots"].includes(s.id)).map((s) => `${s.publisher}: ${s.title}. ${s.url}`) },
  );
  return blocks;
}

export function handoutBlocks(kit) {
  const e = kit.employee;
  const h = e.handout;
  const [note, tell, del] = e.steps;
  return [
    { type: "title", text: h.title },
    { type: "p", text: h.intro },
    { type: "p", text: `**${h.contact_line}**` },
    { type: "h1", text: `1. ${note.title} (${note.when.toLowerCase()})` },
    { type: "p", text: note.text },
    { type: "bullets", items: note.items },
    { type: "h1", text: `2. ${tell.title} (${tell.when.toLowerCase()})` },
    { type: "p", text: "Tell the person named above. You can use this message:" },
    { type: "p", text: e.message },
    { type: "h1", text: `3. ${del.title} (${del.when.toLowerCase()})` },
    { type: "p", text: del.text },
    { type: "h2", text: "Why today?" },
    { type: "p", text: e.why_today },
    { type: "h2", text: "If you used a work account" },
    { type: "p", text: e.work_account },
    { type: "small", text: h.footer },
  ];
}

export function guideBlocks(kit) {
  const o = kit.owner;
  return [
    { type: "title", text: o.title },
    { type: "p", text: o.answer },
    ...o.steps.flatMap((s, i) => [
      { type: "h1", text: `${i + 1}. ${s.title} (${s.when.toLowerCase()})` },
      { type: "p", text: s.text },
      { type: "p", text: s.detail },
    ]),
    { type: "h1", text: "Factors that point towards reporting" },
    { type: "bullets", items: kit.factors.filter((f) => f.direction === "up").map((f) => `**${f.criterion}.** ${f.text}`) },
    { type: "h1", text: "Factors that may lower the risk" },
    { type: "bullets", items: kit.factors.filter((f) => f.direction === "down").map((f) => `**${f.criterion}.** ${f.text}`) },
    { type: "h1", text: "Questions" },
    ...o.faq.flatMap((f) => [{ type: "h2", text: f.q }, { type: "p", text: f.a }]),
    { type: "small", text: `From noxiom.com/${o.slug}, version ${kit.version}, checked ${humanDate(kit.checked)}. CC BY 4.0. Not legal advice.` },
  ];
}

// ---------------------------------------------------------------- render all

export function pageList(kit) {
  return [
    { file: `${kit.owner.slug}.html`, path: `/${kit.owner.slug}` },
    { file: `${kit.employee.slug}.html`, path: `/${kit.employee.slug}` },
  ];
}

export function render(outDir = join(ROOT, "site"), kit = loadKit(), data = loadGuide()) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "downloads"), { recursive: true });
  mkdirSync(KIT_DIR, { recursive: true });

  mkdirSync(join(outDir, "data"), { recursive: true });
  writeFileSync(join(outDir, SCHEMA_PATH), JSON.stringify(recordSchema(kit, data), null, 2) + "\n");
  writeFileSync(join(outDir, `${kit.owner.slug}.html`), renderOwner(kit, data));
  writeFileSync(join(outDir, `${kit.employee.slug}.html`), renderEmployee(kit, data));

  const record = recordBlocks(kit, data);
  const handout = handoutBlocks(kit);
  writeFileSync(join(outDir, DOWNLOADS.record), docx(record, { title: "AI data incident record", date: kit.checked }));
  writeFileSync(join(outDir, DOWNLOADS.handout), docx(handout, { title: kit.employee.handout.title, date: kit.checked }));

  const generated = "<!-- Generated from data/client-data-in-ai.json by src/render.mjs. Edit the data, not this file. -->\n\n";
  writeFileSync(join(KIT_DIR, "incident-record.md"), generated + markdown(record));
  writeFileSync(join(KIT_DIR, "staff-handout.md"), generated + markdown(handout));
  writeFileSync(join(KIT_DIR, "first-72-hours.md"), generated + markdown(guideBlocks(kit)));
  return pageList(kit);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pages = render(process.argv[2] || join(ROOT, "site"));
  console.log(`Rendered ${pages.length} pages, 2 Word files and 3 Markdown files`);
  for (const p of pages) console.log(`  ${p.path}`);
}
