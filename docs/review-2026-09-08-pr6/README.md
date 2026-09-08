# PR6 review pack (2026-09-08)

Vendor gates for harsh B01 (keep) plus PR6-R01 / PR6-R02 (fix on PR #5, not by merging #6).

## Files

- `BACKLOG_PR6.json` — PR6-R01, PR6-R02
- `GATE.md` — B01 kept; R01/R02 closed; #6 must not merge
- `qa/pr6-boundaries.test.mjs` — P01–P04, F01–F05

Do not weaken F01–F05 or P01/P03/P04. P02 expects fail-closed BLOCKED for third-state USER_REPAIR (not silent preserve).

## Gate

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test docs/review-2026-09-08-pr6/qa/pr6-boundaries.test.mjs
```

Or `npm run test:review:pr6`. Combined with MAIN:

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test \
  docs/review-2026-09-08-main/qa/core-regression.test.mjs \
  docs/review-2026-09-08-main/qa/main-boundaries.test.mjs \
  docs/review-2026-09-08-pr6/qa/pr6-boundaries.test.mjs
```
