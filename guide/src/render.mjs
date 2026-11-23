#!/usr/bin/env node
// Renders the "Personal or work account?" guide from data/ai-accounts.json.
//
// Output goes to site/ and mirrors the website's src/ layout, so publishing is
// a copy: site/*.html -> website/src/, site/data/ -> website/src/data/,
// site/downloads/ -> website/src/downloads/. The pages use the website's own
// <!-- include: --> partials and its styles.css; build.mjs in the website repo
// resolves them. Zero dependencies, like the website.
//
// Layout principle: the answer and the comparison come first and are visual
// (status pills you can filter and sort); the wording, sources and longer
// guidance sit one click away in <details> sections or on the tool pages.
//
//   node src/render.mjs            render into ./site
//   node src/render.mjs <outDir>   render somewhere else (the tests do this)

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { xlsx, parseCsv } from "./xlsx.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SITE_ORIGIN = "https://noxiom.com";

// data-cta tags used on these pages. The website's visit counter only accepts
// tags listed in counter/src/config.js, so these go there when publishing.
export const CTA_TAGS = ["guide-sample", "guide-intake", "guide-register", "guide-data"];

// Pages that already exist on noxiom.com, which these pages may link to.
export const EXISTING_PAGES = ["/", "/about", "/services", "/pricing", "/sample-report", "/contact", "/privacy", "/nl/", "/nl/ai-gebruiksmeting", "/nl/ai-tools-bedrijfsgegevens", "/ai-data-incident", "/pasted-company-data-into-ai"];

export const HUB_SLUG = "ai-accounts";
// The Dutch counterpart is the site's own article under /nl/ (same research,
// published separately), so this renderer makes no Dutch page of its own.
export const NL_ARTICLE = "/nl/ai-tools-bedrijfsgegevens";

// What a fact means for a firm putting client data in. Every field carries one.
export const TONES = {
  good: { icon: "✓", sr: "In your favour" },
  warning: { icon: "!", sr: "Has a catch" },
  critical: { icon: "✕", sr: "A problem for client data" },
  unknown: { icon: "?", sr: "The vendor doesn't say" },
  neutral: { icon: "", sr: "" },
};
const TONE_RANK = { good: 0, warning: 1, unknown: 2, critical: 3, neutral: 1 };

// Columns of the hub's comparison grid, in order.
const MATRIX_FIELDS = ["training", "contract", "admin", "location"];
const MATRIX_LABELS = {
  training: "Trains on what you type?",
  contract: "Processor agreement with your firm",
  admin: "Your firm controls it",
  location: "Where it's stored",
};

export function loadData(path = join(ROOT, "data", "ai-accounts.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------- helpers

export function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_NL = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

export function humanDate(iso, lang = "en") {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${(lang === "nl" ? MONTHS_NL : MONTHS_EN)[m - 1]} ${y}`;
}

// Citation tokens are written inline as [[cite:id]] and numbered per page in
// order of first appearance, after the whole page has been assembled.
export const cite = (ids = []) => ids.map((id) => `[[cite:${id}]]`).join("");

export function fill(template, slots) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in slots)) throw new Error(`template slot {{${name}}} has no value`);
    return slots[name];
  });
}

export function resolveCitations(html, data, lang = "en") {
  const byId = new Map(data.sources.map((s) => [s.id, s]));
  const order = [];
  const number = (id) => {
    if (!byId.has(id)) throw new Error(`unknown source id: ${id}`);
    let i = order.indexOf(id);
    if (i === -1) i = order.push(id) - 1;
    return i + 1;
  };
  const label = lang === "nl" ? "Bron" : "Source";
  const body = html.replace(/(?:\[\[cite:[\w-]+\]\])+/g, (run) => {
    const ids = [...run.matchAll(/\[\[cite:([\w-]+)\]\]/g)].map((m) => m[1]);
    const links = ids.map((id) => {
      const n = number(id);
      return `<a href="#src-${n}" aria-label="${label} ${n}">${n}</a>`;
    });
    return `<sup class="cite">${links.join(", ")}</sup>`;
  });
  const items = order.map((id, i) => {
    const s = byId.get(id);
    const dated = s.page_date
      ? lang === "nl" ? ` Pagina gedateerd ${humanDate(s.page_date, "nl")}.` : ` Page dated ${humanDate(s.page_date)}.`
      : "";
    const checked = lang === "nl" ? `Gecontroleerd ${humanDate(s.checked, "nl")}.` : `Checked ${humanDate(s.checked)}.`;
    return `<li id="src-${i + 1}"><a href="${esc(s.url)}" rel="noopener">${esc(s.publisher)}: ${esc(s.title)}</a>.${dated} ${checked}</li>`;
  });
  return body.replace("<!-- sources-list -->", `<ol class="guide-sources">\n${items.join("\n")}\n</ol>`);
}

const accountTag = (account, lang = "en") =>
  account === "work"
    ? `<span class="tag tag-work">${lang === "nl" ? "Zakelijk" : "Work"}</span>`
    : `<span class="tag tag-personal">${lang === "nl" ? "Persoonlijk" : "Personal"}</span>`;

// A status pill: icon (colour) + label (text). Never colour alone.
export function pill(text, tone) {
  const t = TONES[tone];
  if (!t) throw new Error(`unknown tone: ${tone}`);
  const icon = t.icon ? `<span class="pill-icon" aria-hidden="true">${t.icon}</span>` : "";
  const sr = t.sr ? `<span class="visually-hidden">${t.sr}: </span>` : "";
  return `<span class="pill pill-${tone}">${icon}${sr}${esc(text)}</span>`;
}

const verdictTone = (status) => (status === "conditional" ? "good" : "critical");
const verdictLabel = (status) => (status === "conditional" ? "With conditions" : "Keep it out");
const verdictPill = (status) => pill(verdictLabel(status), verdictTone(status));

const allPlans = (data) => data.tools.flatMap((t) => t.plans.map((p) => ({ tool: t, plan: p })));
const planHref = (tool, plan) => `/${tool.slug}#plan-${plan.id}`;
const shortTitle = (tool) => tool.page_title.split(":")[0];

export function jsonLd(objects) {
  return objects
    .map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 2).replaceAll("</", "<\\/")}\n</script>`)
    .join("\n");
}

export const publisher = (data) => ({
  "@type": "Organization",
  name: data.publisher.name,
  url: data.publisher.url,
  logo: { "@type": "ImageObject", url: `${SITE_ORIGIN}/img/logo.png` },
});

// The founder, as the same entity the site's structured data declares.
export const founder = (data) => ({ "@type": "Person", "@id": data.author.id, name: data.author.name, url: data.author.url });

export function faqLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

function articleLd(data, { headline, description, url, lang = "en" }) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    url,
    mainEntityOfPage: url,
    inLanguage: lang,
    datePublished: data.changelog[data.changelog.length - 1].date,
    dateModified: [data.checked, data.changelog[0].date].sort().pop(),
    author: founder(data),
    publisher: publisher(data),
    isAccessibleForFree: true,
  };
}

// Questions as click-to-open items; the text stays in the page for search
// engines and assistants.
export function faqHtml(items) {
  return `<div class="guide-accordion">\n${items
    .map((f) => `<details class="guide-faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}${cite(f.sources)}</p></details>`)
    .join("\n")}\n</div>`;
}

const legend = () => `<p class="guide-legend">
  ${pill("In your favour", "good")}
  ${pill("Has a catch", "warning")}
  ${pill("A problem for client data", "critical")}
  ${pill("The vendor doesn't say", "unknown")}
</p>`;

// ---------------------------------------------------------------- hub blocks

function matrix(data) {
  const rows = allPlans(data).map(({ tool, plan }, i) => {
    const cells = MATRIX_FIELDS.map((id) => {
      const f = plan.fields[id];
      return `  <td data-label="${esc(MATRIX_LABELS[id])}" data-sort="${TONE_RANK[f.tone]}">${pill(f.short, f.tone)}</td>`;
    });
    return `<tr data-account="${plan.account}" data-tool="${tool.id}" data-order="${i}">
  <td data-label="Account" data-sort="${i}"><span class="matrix-account">${accountTag(plan.account)}<a href="${planHref(tool, plan)}">${esc(plan.name)}</a></span></td>
${cells.join("\n")}
  <td data-label="Client data in it?" data-sort="${TONE_RANK[verdictTone(plan.verdict.status)]}">${verdictPill(plan.verdict.status)}</td>
</tr>`;
  });
  const sortHead = (label, col) =>
    `<th scope="col" class="sortable" aria-sort="none"><button type="button" class="sort" data-col="${col}">${esc(label)}<span class="sort-mark" aria-hidden="true"></span></button></th>`;
  const heads = [
    sortHead("Account", 0),
    ...MATRIX_FIELDS.map((id, i) => sortHead(MATRIX_LABELS[id], i + 1)),
    sortHead("Client data in it?", MATRIX_FIELDS.length + 1),
  ];
  const toolChips = data.tools
    .map((t) => `<button type="button" data-tool="${t.id}" aria-pressed="false">${esc(t.name.replace("Microsoft ", ""))}</button>`)
    .join("\n    ");
  return `<div class="guide-controls" id="matrixControls" hidden>
  <div class="guide-filter" role="group" aria-label="Account type">
    <button type="button" data-account="all" aria-pressed="true">All accounts</button>
    <button type="button" data-account="personal" aria-pressed="false">Personal</button>
    <button type="button" data-account="work" aria-pressed="false">Work</button>
  </div>
  <div class="guide-filter" role="group" aria-label="Tool">
    <button type="button" data-tool="all" aria-pressed="true">All tools</button>
    ${toolChips}
  </div>
</div>
<div class="report-table-wrap">
<table class="report-table guide-matrix" id="matrix">
<caption class="visually-hidden">AI account types compared. Select a column heading to sort.</caption>
<thead><tr>${heads.join("")}</tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</div>
${legend()}`;
}

function toolLinks(data, current) {
  return `<nav class="guide-chips" aria-label="Tool pages">\n${data.tools
    .filter((t) => !current || t.id !== current.id)
    .map((t) => `<a href="/${t.slug}">${esc(shortTitle(t))} &rarr;</a>`)
    .join("\n")}\n</nav>`;
}

// ---------------------------------------------------------------- tool blocks

const CARD_FIELDS = ["training", "contract", "admin", "location", "retention", "human_review"];

function planCards(data, tool) {
  const label = Object.fromEntries(data.fields.map((f) => [f.id, f.label]));
  return `<div class="guide-plans guide-plans-${tool.plans.length}">\n${tool.plans
    .map((p) => {
      const rows = CARD_FIELDS.map((id) => {
        const f = p.fields[id];
        return `    <div class="plan-row"><dt>${esc(label[id])}</dt><dd>${pill(f.short, f.tone)}</dd></div>`;
      });
      return `<article class="plan-card plan-${p.account}" id="plan-${p.id}">
  <div class="plan-head">${accountTag(p.account)}<h3>${esc(p.name)}</h3></div>
  <p class="plan-verdict"><span class="plan-verdict-label">Client data in it?</span> ${verdictPill(p.verdict.status)}</p>
  <p class="plan-why">${esc(p.verdict.text)}${cite(p.verdict.sources || [])}</p>
  <dl class="plan-rows">
${rows.join("\n")}
  </dl>
  <p class="plan-price"><span>Price</span> ${esc(p.fields.price.short)}</p>
</article>`;
    })
    .join("\n")}\n</div>
${legend()}`;
}

function sideBySide(data, tool) {
  const head = tool.plans
    .map((p) => `<th scope="col">${accountTag(p.account)} ${esc(p.short_name)}</th>`)
    .join("");
  const rows = data.fields.map((field) => {
    const cells = tool.plans.map((p) => {
      const v = p.fields[field.id];
      return `<td data-label="${esc(p.short_name)}">${pill(v.short, v.tone)} ${esc(v.text)}${cite(v.sources)}</td>`;
    });
    return `<tr><th scope="row">${esc(field.label)}</th>${cells.join("")}</tr>`;
  });
  return `<div class="report-table-wrap">
<table class="report-table guide-compare guide-cols-${tool.plans.length}">
<thead><tr><th scope="col"><span class="visually-hidden">Question</span></th>${head}</tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</div>`;
}

const list = (items) => `<ul class="report-list">\n${items.map((i) => `<li>${esc(i)}</li>`).join("\n")}\n</ul>`;

function changelogHtml(data) {
  return `<ul class="report-list">\n${data.changelog
    .map((c) => `<li><strong>${humanDate(c.date)}:</strong> ${esc(c.change)}</li>`)
    .join("\n")}\n</ul>`;
}

// ---------------------------------------------------------------- pages

function common(data) {
  const plans = allPlans(data);
  return {
    guide_css: readFileSync(join(ROOT, "templates", "guide.css"), "utf8").trim(),
    guide_js: readFileSync(join(ROOT, "templates", "guide.js"), "utf8").trim(),
    checked_human: humanDate(data.checked),
    checked_iso: data.checked,
    next_review_human: humanDate(data.next_review),
    tool_count: String(data.tools.length),
    plan_count: String(plans.length),
    hub_url: `/${HUB_SLUG}`,
    nl_url: NL_ARTICLE,
  };
}

function renderHub(data) {
  const url = `${SITE_ORIGIN}/${HUB_SLUG}`;
  const description =
    "ChatGPT, Copilot, Gemini, Claude and DeepSeek handle business data differently per account. A sourced, dated guide for small firms, with a free check.";
  const ld = [
    articleLd(data, { headline: data.title, description, url }),
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "AI accounts and business data",
      description: data.description,
      url,
      license: data.license.url,
      isAccessibleForFree: true,
      creator: publisher(data),
      dateModified: data.checked,
      version: data.version,
      keywords: ["ChatGPT", "Microsoft Copilot", "Gemini", "Claude", "DeepSeek", "GDPR", "data processing agreement", "model training", "data retention"],
      distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: data.urls.data }],
    },
    faqLd(data.hub_faq),
  ];
  const html = fill(readFileSync(join(ROOT, "templates", "hub.html"), "utf8"), {
    ...common(data),
    seo_title: "Personal vs work AI accounts: what happens to business data",
    meta_description: description,
    canonical: url,
    title: esc(data.title),
    jsonld: jsonLd(ld),
    matrix: matrix(data),
    tool_links: toolLinks(data),
    faq: faqHtml(data.hub_faq),
    known_gaps: list(data.known_gaps),
    changelog: changelogHtml(data),
    data_url: "/data/ai-accounts.json",
    register_url: "/downloads/ai-accounts-register.xlsx",
  });
  return resolveCitations(html, data);
}

function renderTool(data, tool) {
  const url = `${SITE_ORIGIN}/${tool.slug}`;
  const ld = [
    articleLd(data, { headline: tool.page_title, description: tool.meta_description, url }),
    faqLd(tool.faq),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Noxiom", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Personal or work account?", item: `${SITE_ORIGIN}/${HUB_SLUG}` },
        { "@type": "ListItem", position: 3, name: tool.name, item: url },
      ],
    },
  ];
  const work = tool.plans.some((p) => p.account === "work");
  const html = fill(readFileSync(join(ROOT, "templates", "tool.html"), "utf8"), {
    ...common(data),
    seo_title: esc(tool.seo_title),
    meta_description: esc(tool.meta_description),
    canonical: url,
    title: esc(tool.page_title),
    vendor: esc(tool.vendor),
    tool_name: esc(tool.name),
    summary: esc(tool.summary),
    jsonld: jsonLd(ld),
    plan_cards: planCards(data, tool),
    side_by_side: sideBySide(data, tool),
    how_to_tell: list(tool.how_to_tell),
    admin_heading: work ? "What an admin should check" : "What to decide",
    admin_checks: list(tool.admin_checks),
    incident_note: `${esc(tool.incident_note)}${cite(tool.incident_sources)}`,
    faq: faqHtml(tool.faq),
    other_tools: toolLinks(data, tool),
  });
  return resolveCitations(html, data);
}

// The accounts register as a spreadsheet, from the CSV template (the source).
export function registerXlsx(data) {
  const rows = parseCsv(readFileSync(join(ROOT, "downloads", "ai-accounts-register.csv"), "utf8"));
  return xlsx(rows, {
    sheet: "AI accounts register",
    title: "AI accounts register",
    date: data.checked,
    widths: [22, 14, 26, 22, 30, 32, 30, 30, 26, 26, 14, 30],
    examples: 4,
  });
}

// Every page this renderer produces, as { file, path } pairs.
export function pageList(data) {
  return [
    { file: `${HUB_SLUG}.html`, path: `/${HUB_SLUG}` },
    ...data.tools.map((t) => ({ file: `${t.slug}.html`, path: `/${t.slug}` })),
  ];
}

export function render(outDir = join(ROOT, "site"), data = loadData()) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "data"), { recursive: true });
  mkdirSync(join(outDir, "downloads"), { recursive: true });

  writeFileSync(join(outDir, `${HUB_SLUG}.html`), renderHub(data));
  for (const tool of data.tools) writeFileSync(join(outDir, `${tool.slug}.html`), renderTool(data, tool));

  copyFileSync(join(ROOT, "data", "ai-accounts.json"), join(outDir, "data", "ai-accounts.json"));
  // The CSV stays at its old address for anyone who saved the link; pages link the Excel file.
  copyFileSync(join(ROOT, "downloads", "ai-accounts-register.csv"), join(outDir, "downloads", "ai-accounts-register.csv"));
  writeFileSync(join(outDir, "downloads", "ai-accounts-register.xlsx"), registerXlsx(data));
  return pageList(data);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] || join(ROOT, "site");
  const pages = render(out);
  console.log(`Rendered ${pages.length} pages into ${out}`);
  for (const p of pages) console.log(`  ${p.path}`);
}
