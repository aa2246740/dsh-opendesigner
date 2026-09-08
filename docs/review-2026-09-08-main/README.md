# MAIN review pack (2026-09-08)

Gate A for write-path safety. New MAIN numbers refine leftovers. They do not replace OD / PR3 / PR4 / R2 numbers. M01–M04 are test numbers.

## Files

- `BACKLOG_MAIN.json` — MAIN-01…MAIN-07
- `GATE.md` — closed vs deferred for this PR
- `qa/core-regression.test.mjs` — C01–C08, N01–N03
- `qa/main-boundaries.test.mjs` — V01–V12, M01–M04

Do not weaken M01–M04. Do not skip assertions. `verify-source.mjs` blob match is review-time source freeze only. Skip it on the fixed branch.

## Gate

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test docs/review-2026-09-08-main/qa/core-regression.test.mjs docs/review-2026-09-08-main/qa/main-boundaries.test.mjs
```

Or `npm run test:review:main`.

## Baseline on `bf3abd72a09c09d6b3cab413984637a02bc8afbe`

core-regression 11/11 pass. main-boundaries 12 pass / 4 fail (M01–M04). Combined 23/27.

Target after Gate A: 27/27. Also keep `npm test` and existing `test:review*` green.

## Closed vs deferred

Closed in this PR: MAIN-01, MAIN-02, MAIN-03, MAIN-04, MAIN-06 (short-term refuse main-root accept while a batch is open).

Deferred: MAIN-05 full unified browser↔DSH runtime (keep the single-writer lock; do not remove it to share sessions). MAIN-07 JSX/canvas expand (out of scope).
