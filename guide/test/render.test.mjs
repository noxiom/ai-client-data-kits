// Renders the pages into a temporary folder and checks what a publisher would
// check by hand: every slot filled, every citation resolved, one h1, sane
// titles and descriptions, valid JSON-LD, internal links that go somewhere,
// and data-cta tags the counter will accept once they are added to it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, loadData, CTA_TAGS, EXISTING_PAGES } from "../src/render.mjs";

const data = loadData();
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
let out;
let pages;

before(() => {
  out = mkdtempSync(join(tmpdir(), "ai-accounts-"));
  pages = render(out, data).map((p) => ({ ...p, html: readFileSync(join(out, p.file), "utf8") }));
});
after(() => rmSync(out, { recursive: true, force: true }));

test("renders the hub, one page per tool and the downloads", () => {
  assert.equal(pages.length, data.tools.length + 1);
  assert.ok(existsSync(join(out, "data", "ai-accounts.json")));
  assert.ok(existsSync(join(out, "downloads", "ai-accounts-register.csv")));
  assert.ok(existsSync(join(out, "downloads", "ai-accounts-register.xlsx")));
});

test("no unfilled slots, unresolved citations or dashes", () => {
  for (const p of pages) {
    assert.ok(!/\{\{\w+\}\}/.test(p.html), `${p.file}: unfilled template slot`);
    assert.ok(!p.html.includes("[[cite:"), `${p.file}: unresolved citation`);
    assert.ok(!p.html.includes("<!-- sources-list -->"), `${p.file}: sources list not rendered`);
    assert.ok(!DASHES.test(p.html), `${p.file}: contains an en or em dash`);
  }
});

test("each page uses the site's partials and has one h1, a canonical URL and a title", () => {
  for (const p of pages) {
    for (const partial of ["head-meta", "header", "footer"]) {
      assert.ok(p.html.includes(`<!-- include: ${partial} -->`), `${p.file}: missing ${partial} partial`);
    }
    assert.equal((p.html.match(/<h1[\s>]/g) || []).length, 1, `${p.file}: needs exactly one h1`);
    assert.ok(p.html.includes(`<link rel="canonical" href="https://noxiom.com${p.path}" />`), `${p.file}: canonical should be ${p.path}`);
    const title = p.html.match(/<title>(.*?)<\/title>/)[1];
    assert.ok(title.length <= 75, `${p.file}: title is ${title.length} chars`);
    const desc = p.html.match(/<meta name="description" content="(.*?)"/)[1];
    assert.ok(desc.length >= 110 && desc.length <= 160, `${p.file}: description is ${desc.length} chars`);
  }
});

test("every citation points at a listed source, and every listed source is cited", () => {
  for (const p of pages) {
    const listed = [...p.html.matchAll(/<li id="src-(\d+)">/g)].map((m) => Number(m[1]));
    const cited = new Set([...p.html.matchAll(/href="#src-(\d+)"/g)].map((m) => Number(m[1])));
    assert.ok(listed.length > 0, `${p.file}: no sources listed`);
    assert.deepEqual(listed, listed.map((_, i) => i + 1), `${p.file}: sources not numbered 1..n`);
    for (const n of cited) assert.ok(listed.includes(n), `${p.file}: cites [${n}] which is not listed`);
    for (const n of listed) assert.ok(cited.has(n), `${p.file}: lists source ${n} without citing it`);
  }
});

test("JSON-LD blocks parse and carry the right types", () => {
  for (const p of pages) {
    const blocks = [...p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const types = blocks.map((b) => b["@type"]);
    assert.ok(types.includes("Article"), `${p.file}: no Article`);
    for (const b of blocks.filter((b) => b["@type"] === "Article")) {
      assert.equal(b.dateModified, [data.checked, data.changelog[0].date].sort().pop());
      assert.equal(b.author["@id"], "https://noxiom.com/about#founder", "author is the founder entity");
      assert.equal(b.url, `https://noxiom.com${p.path}`);
    }
  }
  const hub = pages[0];
  assert.match(hub.html, /"@type": "Dataset"/);
  assert.match(hub.html, /"@type": "FAQPage"/);
});

test("internal links point at these pages, existing site pages, anchors or the downloads", () => {
  const allowed = new Set([...pages.map((p) => p.path), ...EXISTING_PAGES, "/data/ai-accounts.json", "/downloads/ai-accounts-register.xlsx", "/downloads/ai-accounts-register.csv"]);
  for (const p of pages) {
    for (const m of p.html.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)) {
      const path = m[1];
      if (/^\/(styles\.css|favicon|apple-touch-icon|icons\.svg)/.test(path)) continue;
      assert.ok(allowed.has(path), `${p.file}: link to unknown path ${path}`);
    }
    for (const m of p.html.matchAll(/href="#([^"]+)"/g)) {
      if (m[1].startsWith("src-")) continue;
      assert.ok(p.html.includes(`id="${m[1]}"`), `${p.file}: anchor #${m[1]} has no target`);
    }
  }
  // Links into another page's section (/slug#id) land on an element that exists.
  for (const p of pages) {
    for (const m of p.html.matchAll(/href="(\/[^"#]+)#([^"]+)"/g)) {
      const target = pages.find((q) => q.path === m[1]);
      if (target) assert.ok(target.html.includes(`id="${m[2]}"`), `${p.file}: ${m[1]}#${m[2]} has no target`);
    }
  }
  // Cross-page anchors used from the tool pages exist on the hub.
  const hub = pages[0].html;
  for (const anchor of ["already-happened", "check", "changes"]) assert.ok(hub.includes(`id="${anchor}"`), `hub is missing #${anchor}`);
});

test("data-cta tags are the known set, ready to add to the counter config", () => {
  for (const p of pages) {
    for (const m of p.html.matchAll(/data-cta="([^"]+)"/g)) {
      assert.ok(CTA_TAGS.includes(m[1]), `${p.file}: unexpected data-cta ${m[1]}`);
    }
  }
});

test("the hub grid has one row per account type, each with five status pills", () => {
  const hub = pages[0].html;
  const rows = [...hub.matchAll(/<tr data-account="(personal|work)" data-tool="([\w-]+)"[^>]*>([\s\S]*?)<\/tr>/g)];
  const plans = data.tools.flatMap((t) => t.plans);
  assert.equal(rows.length, plans.length);
  for (const r of rows) assert.equal((r[3].match(/class="pill pill-/g) || []).length, 5, "each row: four facts and a verdict");
});

test("every plan and every tool appears on the hub, and each tool page shows all its plans", () => {
  const hub = pages[0].html;
  for (const t of data.tools) {
    assert.ok(hub.includes(`href="/${t.slug}"`), `hub doesn't link to ${t.slug}`);
    const page = pages.find((p) => p.path === `/${t.slug}`).html;
    for (const plan of t.plans) {
      assert.ok(hub.includes(plan.name.replaceAll("&", "&amp;")), `hub is missing ${plan.name}`);
      assert.ok(page.includes(plan.short_name.replaceAll("&", "&amp;")), `${t.slug} is missing ${plan.short_name}`);
    }
  }
});

test("inline scripts only toggle rows and touch no storage or network", () => {
  const scripts = pages.flatMap((p) => [...p.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]));
  for (const s of scripts) {
    assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB|navigator\.|fetch\(|XMLHttpRequest/.test(s), "an inline script reads or writes something it shouldn't");
  }
});
