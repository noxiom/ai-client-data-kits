#!/usr/bin/env node
// Builds a local preview of the guide inside a COPY of the live website.
// The website's main branch is exported with `git archive` (read-only; the
// checkout and its current branch are never touched), the guide's rendered
// pages are copied in, and the site's own build.mjs runs.
//
//   node src/preview.mjs [path/to/website-repo] [git-ref]
//   cd preview && python3 serve.py 8812   then open http://localhost:8812/ai-accounts
//
// To preview the guide and the kits together, use ../src/preview.mjs instead.

import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { ROOT, render } from "./render.mjs";

const website = resolve(process.argv[2] || process.env.WEBSITE_DIR || join(ROOT, "..", "..", "..", "..", "..", "website"));
const ref = process.argv[3] || "origin/main";
if (!existsSync(join(website, ".git"))) throw new Error(`${website} is not the website repository (pass its path, or set WEBSITE_DIR)`);

const site = join(ROOT, "site");
render(site);

const preview = join(ROOT, "preview");
rmSync(preview, { recursive: true, force: true });
mkdirSync(preview, { recursive: true });
execSync(`git -C "${website}" archive ${ref} | tar -x -C "${preview}"`, { stdio: "inherit" });
cpSync(site, join(preview, "src"), { recursive: true });

execFileSync(process.execPath, ["build.mjs"], {
  cwd: preview,
  stdio: "inherit",
  env: { ...process.env, COUNTER_URL: "off", WEB3FORMS_ACCESS_KEY: "" },
});
console.log(`\nPreview of ${ref} plus the guide built in ${join(preview, "dist")}`);
console.log(`Serve it with: cd "${preview}" && python3 serve.py 8812`);
console.log("Then open http://localhost:8812/ai-accounts");
