# AI accounts guide: data, pages and tests

**What it is.** A free, sourced reference on what ChatGPT, Microsoft Copilot, Gemini, Claude and DeepSeek do with business data, organised around the question small firms actually face: is a colleague using a **personal account** or the company's **work account**? One data file drives seven web pages, an open dataset and a one-page register.

**Status:** version 1.0.0, every fact checked against the vendors' own pages on 22 November 2026. Published 23 November 2026 (noxiom.com/website PR #9). To publish an update, re-render and copy `site/` into the website repo (steps in Noxiom's research notes, `first-public-asset/publishing-checklist.md`). This folder moved here, into the kits repository, on 23 Nov 2026.

## What's here

```
data/ai-accounts.json          the dataset: 5 tools, 11 account types, 40 sources (CC BY 4.0)
downloads/ai-accounts-register.csv   one-page accounts register with 4 example rows (the source;
                               rendered to an Excel file, which is what the pages link)
templates/                     hub.html, tool.html, nl.html, guide.css (page copy lives here)
src/render.mjs                 data + templates -> site/ (zero dependencies)
src/preview.mjs                builds a local preview inside a copy of the website
src/stale.mjs                  says whether the monthly check is due (exit 1 if overdue)
test/                          20 tests on the data and the rendered pages
site/                          rendered output, mirrors website/src/ (generated)
preview/                       local preview build (generated)
screenshots/                   desktop and phone screenshots of the preview
```

## The pages

| Path | What it is | Main searches it answers |
|---|---|---|
| `/ai-accounts` | Hub: the account argument, overview table with a personal/work filter, tool cards, 20-minute check, "already happened" steps, limits, FAQ, change log, sources, data download | using personal AI accounts at work; does a business plan cover staff; is it a data breach |
| `/chatgpt-personal-vs-business` | Free/Plus/Pro vs Business vs Enterprise | workspace vs personal account chatgpt; using personal chatgpt account for work; chatgpt business can admin see chats; does chatgpt plus/business train on your data |
| `/copilot-personal-vs-work` | Consumer app vs Copilot Chat (work) vs Microsoft 365 Copilot | copilot work vs personal account; green shield copilot meaning; copilot chat vs copilot 365 / business; is m365 copilot gdpr compliant |
| `/gemini-personal-vs-workspace` | Personal Google account vs Workspace | gemini personal vs workspace; gemini pro personal vs workspace |
| `/claude-personal-vs-team` | Free/Pro/Max vs Team/Enterprise | claude personal vs team plan / account / pricing; claude data retention team plan / 5 years |
| `/deepseek-business-data` | The DeepSeek app (no work version) | deepseek gdpr compliance |
| `/nl/ai-tools-bedrijfsgegevens` | Not rendered here: the website's own Dutch article on the same research is the Dutch counterpart; the hub links to it and it links back | datalek chatgpt; persoonsgegevens in chatgpt; chatgpt business avg |

The search phrases come from Google autocomplete captured on 22 Nov 2026 (`../research/autocomplete-2026-11-22.txt`). They show that people search this way; they say nothing about volume.

## Commands

Node 22 or later, no install step.

```bash
node src/render.mjs            # render into site/
node --test 'test/*.test.mjs'  # 20 tests
node src/preview.mjs [website]  # build a preview inside a copy of the live site (git archive)
cd preview && python3 serve.py 8812   # then open http://localhost:8812/ai-accounts
node src/stale.mjs             # is the monthly check due?
```

## The rules the tests enforce

- Every fact (7 fields x 11 account types) has a short value, a sentence, at least one source and a check date.
- No fact is dated after the dataset's last full check, or more than 45 days before it.
- Every listed source is cited somewhere, every cited source is listed, and every URL is https.
- No tool is called safe, compliant, certified or guaranteed in the facts, summaries or verdicts.
- A tool without a work plan says so.
- No en or em dashes anywhere (the website's house rule).
- Rendered pages: no unfilled slots or unresolved citations, exactly one h1, the right canonical URL, a title and description of sensible length, JSON-LD that parses, internal links that resolve, citations numbered 1..n with nothing cited but unlisted or listed but uncited, only the four known `data-cta` tags, and inline scripts that touch no storage or network.

## How to update it (the monthly check)

About 60 to 90 minutes a month: 40 sources at roughly two minutes each, plus writing up anything that changed.

1. Run `node src/stale.mjs` to see what's due.
2. Open each source URL in a browser. Several vendor sites block automated fetching, so this is a manual job by design. Compare what the page says with the `text` of each fact that cites it.
3. If a fact changed: edit its `short` and `text`, set its `checked` to today, and add a line to `changelog` (newest first) saying what changed and when the vendor changed it, if known. If a fact didn't change, set its `checked` to today anyway.
4. Update the source's `checked` date, and its `page_date` if the vendor shows one.
5. Set top-level `checked` to today and `next_review` to about a month later. Bump `version`: patch for wording, minor for a changed fact, major for added or removed tools.
6. Run the tests, render, preview, then publish (see the checklist).
7. If a change is newsworthy (a vendor starts or stops training on business data, a new EU storage option), it's a LinkedIn post. See `../distribution-plan.md`.

**Adding a tool:** add an object to `tools` with the same shape (including `faq`, `how_to_tell`, `admin_checks`, `incident_note`), add its sources, and run the tests. They will tell you what is missing. The renderer creates its page automatically; the publishing checklist lists the website files to update for a new page.

## Not built (deliberately)

- **Automatic change monitoring** (fetch, hash and diff vendor pages). The audit specified it, but several of these pages block automated requests or render client-side, so v1 relies on the monthly manual check plus vendor announcements. Revisit if the day-45 go/no-go says go.
- **A hosted survey.** Running the staff survey for other companies would make Noxiom a processor of their staff data. The guide gives the questions; firms run them in their own form tool.

## Privacy and security

- The pages collect nothing. No forms, no cookies, no third-party requests. The only script is the overview filter, which shows and hides table rows and stores nothing (a test checks this).
- The pages carry the website's existing visit counter snippet through `scripts.js`, which sends page path, referring hostname and `data-cta` tags only, as `/privacy` already describes. No `/privacy` change is needed.
- The register CSV is a blank template that the user fills in on their own computer.
- Nothing from any client engagement is used here, and nothing ever should be.

## Licence

Data and guide text: CC BY 4.0. Code: MIT. See `LICENSE.md`.
