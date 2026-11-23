#!/usr/bin/env node
// Is the guide due for its monthly check? Compares the data's last full check
// with today. Exits 1 when the promised review date has passed, so it can run
// from a scheduled job or a pre-publish step.
//
//   node src/stale.mjs

import { loadData, humanDate } from "./render.mjs";

const data = loadData();
const today = new Date().toISOString().slice(0, 10);
const age = Math.floor((Date.parse(today) - Date.parse(data.checked)) / 86400000);
const overdue = today > data.next_review;

console.log(`Last full check: ${humanDate(data.checked)} (${age} days ago)`);
console.log(`Next check promised by: ${humanDate(data.next_review)}${overdue ? "  << OVERDUE" : ""}`);

const oldest = data.tools
  .flatMap((t) => t.plans.flatMap((p) => Object.entries(p.fields).map(([id, f]) => ({ where: `${p.id}.${id}`, checked: f.checked }))))
  .sort((a, b) => a.checked.localeCompare(b.checked))
  .slice(0, 5);
console.log("Oldest facts:");
for (const f of oldest) console.log(`  ${f.checked}  ${f.where}`);

process.exit(overdue ? 1 : 0);
