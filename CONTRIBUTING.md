# Corrections and suggestions

These kits are only useful if they are right and current. Corrections are welcome, and they are the most valuable thing you can send.

## Something is wrong or out of date

Two ways, whichever is easier:

- **Email** contact@noxiom.com with the page or file, what is wrong, and a link to the source (the vendor's or regulator's own page). No GitHub account needed.
- **Open an issue** in this repository with the same information.

What happens next:

1. We read the source you point to (or the current version of the source we cite).
2. If you're right, we correct the data, bump the version, and add a line to `CHANGELOG.md` and to the change log on the web page, with the date.
3. We reply either way, usually within a week.

We don't need your name to make a correction, and we don't publish who sent one unless you ask us to.

## Suggesting a new situation

Open an issue or email with:

- the situation, in one sentence, in the words someone would use when it happens;
- who faces it (owner, office manager, employee, adviser);
- what you looked for and didn't find.

The list of situations we're considering is in `kits/README.md`.

## Pull requests

Welcome for typos, broken links and code. For changes to facts, please include the source; every fact in `data/` carries a source and a check date, and the tests fail without them.

```bash
node src/render.mjs            # rebuild the pages, Word files and Markdown
node --test 'test/*.test.mjs'  # all tests must pass
```

House rules the tests enforce: no en or em dashes; no tool is called safe, compliant or certified; no fines or fear; the record builder never decides for the reader; nothing a reader types is sent or stored.

## Please never send

Real incident details, client names or anyone's personal data. The kits never need them, and neither do we.
