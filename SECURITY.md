# Security and privacy

## Reporting a problem

If you find a security or privacy problem in these pages or tools (for example, a way the record builder could send or keep what someone types), please **don't open a public issue**. Use GitHub's "Report a vulnerability" button on the Security tab of this repository, or email contact@noxiom.com. We reply within a week and fix confirmed problems before discussing them publicly.

## What the tools promise

- The interactive pages run entirely in the visitor's browser. They make no network requests, set no cookies and use no browser storage.
- Files are only created or opened when the visitor asks (save, share, copy, open).
- The tests in `test/` and `guide/test/` check these promises on every build.

## What never belongs in this repository

Client data, incident details, names, email addresses of people who wrote to us, credentials or keys. The IndexNow key on noxiom.com is public by design and lives in the website repository, not here.
