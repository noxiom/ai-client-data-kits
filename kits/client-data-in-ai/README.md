# Client data went into an AI tool

**For:** a 10-50 person firm where someone put client or company information into ChatGPT, Copilot, Gemini, Claude, DeepSeek or another AI tool. Written for the Netherlands; the GDPR rules are EU-wide.

**On the web:**
- For the employee: https://noxiom.com/pasted-company-data-into-ai
- For the firm, with the record builder: https://noxiom.com/ai-data-incident

## What's here

| File | What it is |
|---|---|
| `first-72-hours.md` | The six steps, the factors that point towards or away from reporting, and the questions owners ask |
| `incident-record.md` | The incident record template: the same questions as the record builder, to fill in by hand. Also as Word: `site/downloads/ai-incident-record.docx` |
| `staff-handout.md` | Two pages for staff: what to do if you put company information into an AI tool, with a line for your own contact person. Also as Word: `site/downloads/ai-incident-staff-handout.docx` |

These three files are generated from `data/client-data-in-ai.json`. Edit the data, then run `node src/render.mjs`.

## What it says, in short

1. **Employee:** note what went in (without copying it again), tell your firm today, then delete the conversation unless your firm asks you to wait.
2. **Firm:** write it down, contain it, check whether you're the controller or the client's processor, weigh the risk, and decide within 72 hours of becoming aware whether to report it to the Autoriteit Persoonsgegevens. Record the decision either way.

The record builder lists factors that point towards reporting and factors that may lower the risk, following the EDPB's criteria. **It never decides.** If in doubt, the EDPB's guidance is to report.

## Sources

- GDPR (Regulation (EU) 2016/679), Articles 4(12), 33 and 34.
- EDPB, Guidelines 9/2022 on personal data breach notification under GDPR, version 2.0, adopted 28 March 2023.
- Autoriteit Persoonsgegevens, "Caution: use of AI chatbot may lead to data breaches" (6 Aug 2024).
- Vendor facts per account type: the AI accounts guide dataset, checked 22 Nov 2026 (40 vendor pages, each fact dated).

## Privacy

The record builder runs entirely in the browser. It sends nothing, stores nothing (no cookies, no local storage) and uses no form element, so pressing Enter can't submit anything. It asks readers to describe the data by type and never to enter the data itself or anyone's name. The tests check all of this.
