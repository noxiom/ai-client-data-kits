// Uses the statement builder the way a person would, in a real browser:
// headless Edge (or Chrome) over the DevTools protocol. It ticks accounts,
// answers questions, pastes the page's own assistant example, switches to
// Dutch, downloads both Word files and the JSON, and shoots a 1280 px and a
// 500 px (phone) view. Prints a JSON report; files land in <outdir>.
//
//   node src/preview.mjs && (cd preview && python3 serve.py 8813 &)
//   node scripts/browser-check.mjs <outdir> [url]
//
// Written for WSL with Edge on Windows (paths go through wslpath). Set EDGE
// to another Chromium binary elsewhere.
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const EDGE = process.env.EDGE || "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const WIN = EDGE.startsWith("/mnt/");
const WOUT = WIN ? execFileSync("wslpath", ["-w", OUT]).toString().trim() : OUT;
const PORT = 9333;
const URL0 = process.argv[3] || "http://localhost:8813/client-asks-about-ai";

const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", `--user-data-dir=${join(WOUT, "profile")}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 40; i++) {
  try {
    targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
    if (targets.some((t) => t.type === "page")) break;
  } catch {}
  await sleep(500);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const events = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else events.push(msg);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
const shot = async (name, width, full = false) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await sleep(300);
  let clip;
  if (full) {
    const h = await evaluate("document.documentElement.scrollHeight");
    clip = { x: 0, y: 0, width, height: Math.min(h, 16000), scale: 1 };
  }
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full, ...(clip ? { clip } : {}) });
  writeFileSync(join(OUT, name), Buffer.from(r.result.data, "base64"));
};

await send("Page.enable");
await send("Runtime.enable");
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: WOUT });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL0 });
await sleep(2500);

const report = {};
report.errors = events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails.exception?.description);
report.initialOpen = await evaluate("document.querySelector('.kit-open-count').textContent");
report.builderVisible = await evaluate("!document.getElementById('statement-builder').hidden");

// A person: ticks two accounts, answers some questions, leaves others open.
await evaluate(`(() => {
  const click = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.click(); };
  click('input[name="f-tools"][value="copilot-chat-work"]');
  click('input[name="f-tools"][value="chatgpt-business"]');
  click('input[name="t-copilot-chat-work-dpa"][value="signed"]');
  click('input[name="t-copilot-chat-work-training"][value="off_checked"]');
  click('input[name="t-chatgpt-business-dpa"][value="signed"]');
  click('input[name="f-role"][value="processor"]');
  click('input[name="f-review"][value="always"]');
  click('input[name="f-client_data"][value="deidentified"]');
  const firm = document.querySelector('[data-field="firm_name"]');
  firm.value = 'Test Firm BV'; firm.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(300);
report.afterOpen = await evaluate("document.querySelector('.kit-open-count').textContent");
report.questionsShown = await evaluate("[...document.querySelectorAll('.kit-toolq')].filter(b => !b.hidden).map(b => b.dataset.for)");
report.previewHasClaim = await evaluate("document.getElementById('preview').textContent.includes('switched off. We checked the setting')");
report.previewHighlights = await evaluate("document.querySelectorAll('#preview .is-open').length");
report.gapCardShown = await evaluate("!document.getElementById('gap-card').hidden");
await shot("desktop-filled.png", 1280);
await evaluate("document.getElementById('builder').scrollIntoView()");
await shot("desktop-builder.png", 1280);

// None excludes the accounts.
await evaluate("document.querySelector('input[name=\"f-tools\"][value=\"none\"]').click()");
await sleep(100);
report.noneClearsOthers = await evaluate("[...document.querySelectorAll('input[name=\"f-tools\"]:checked')].map(i => i.value)");
await evaluate("document.querySelector('input[name=\"f-tools\"][value=\"chatgpt-business\"]').click()");
report.accountClearsNone = await evaluate("[...document.querySelectorAll('input[name=\"f-tools\"]:checked')].map(i => i.value)");

// Paste the example from the page, as an assistant's answer would arrive.
await evaluate("window.confirm = () => true; true");
await evaluate(`(() => {
  document.getElementById('paste-open').click();
  const ex = document.querySelector('pre.kit-code').textContent;
  document.getElementById('paste-box').value = 'Here is your record:\\n\`\`\`json\\n' + ex + '\\n\`\`\`';
  document.getElementById('paste-load').click();
  return true;
})()`);
await sleep(300);
report.pasteResult = await evaluate("document.getElementById('load-result').textContent");
report.pastedOpen = await evaluate("document.querySelector('.kit-open-count').textContent");

// Dutch, then the letter tab.
await evaluate("document.querySelector('input[name=\"f-language\"][value=\"nl\"]').click()");
await sleep(200);
report.dutchTitle = await evaluate("document.querySelector('#preview h3').textContent");
await evaluate("document.getElementById('tab-letter').click()");
await sleep(200);
report.letterStart = await evaluate("document.getElementById('preview').textContent.slice(0, 160)");

// Downloads: both Word files and the JSON.
for (const b of ["st-download", "lt-download", "st-json"]) {
  await evaluate(`document.getElementById('${b}').click()`);
  await sleep(1200);
}
report.downloads = readdirSync(OUT).filter((f) => /\.(docx|json)$/.test(f));

// Phone.
await evaluate("document.getElementById('tab-statement').click(); document.querySelector('input[name=\"f-language\"][value=\"en\"]').click(); window.scrollTo(0, 0)");
await shot("phone-full.png", 500, true);
report.phoneOverflow = await evaluate("document.documentElement.scrollWidth > window.innerWidth");
report.barVisible = await evaluate("getComputedStyle(document.getElementById('kit-bar')).display");
report.barText = await evaluate("document.getElementById('kit-bar-text').textContent");
report.lateErrors = events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails.exception?.description);

console.log(JSON.stringify(report, null, 2));
ws.close();
edge.kill();
process.exit(0);
