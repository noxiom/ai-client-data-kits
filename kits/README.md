# Kits

Each kit answers one situation a small firm runs into with AI tools and client data. A kit is a web page on noxiom.com (the front door), plus templates you can download, adapt and keep.

| Kit | Situation | Status |
|---|---|---|
| [client-data-in-ai](client-data-in-ai/) | Someone put client or company data into an AI tool. What now? English, and a Dutch staff page | Live, 1.2.0 |
| [client-asks-about-ai](client-asks-about-ai/) | A client asks: "do you use AI with our data?" A one-page AI statement and answer letter, English or Dutch, built only from what the firm confirmed | Draft, 0.1.0 |
| questionnaire-ai-answers | A client's security or supplier questionnaire has an AI section. An answer bank, built on the same firm AI facts as client-asks-about-ai | Planned |
| staff-ai-one-pager | "Can I use my own ChatGPT for work?" A one-page staff rule sheet built around accounts and data types | Planned |
| new-tool-check | A colleague asks to use a new AI tool. Ten questions that decide it, and a one-paragraph record | Considered |

The reasoning behind this list is in Noxiom's research notes; the short version: each one is a moment that actually happens to a 10-50 person firm, where the free answers are thin, generic or written for large companies.

Kits 2 and 3 share one fact model about the firm's own AI tools: `data/firm-ai-facts.json` (questions, allowed answers, and one sentence per answer in English and Dutch). A firm saves its answers once and reuses them.

All kits share one dataset of vendor facts per account type: the [AI accounts guide](https://noxiom.com/ai-accounts), checked monthly.
