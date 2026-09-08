# PR6 2026-09-08 gate (on Gate A / PR #5)

PR #6 (`de41f016`) pinned the approved FrozenChangeset (harsh B01) but introduced recovery regressions PR6-R01 / PR6-R02. This pack lands B01 on PR #5 and forbids those recovery mistakes.

**Supersedes PR #6. Do not merge #6.**

## Closed in this PR (together with MAIN-01…04 and MAIN-06 short)

| ID | Severity | Result |
|---|---|---|
| B01 | P0 | `apply(batchId)` writes the hash-pinned APPROVED_A snapshot after a consume persist-hook swaps the worktree to NOT_ACCEPTED_B. |
| PR6-R01 | P0 | Mixed recovery builds a per-file plan. Any unknown/third-party file blocks the whole batch. USER_REPAIR_A is not overwritten with BASE_A. |
| PR6-R02 | P0 | Length / a third hash is not proof of intentional repair. Expanding partials, new-file partials, and file→directory all BLOCK and keep the journal. |
| F05 | P0 | `validateRestorePlan` `lstat`s every restore target and refuses directories/symlinks before any write. `a.txt` stays CURRENT_A. |

P02 is fail-closed third-state (BLOCKED + USER_REPAIR retained + journal kept), not PR #6’s silent `preserved:true`. Unknown third state must not auto-declare the transaction resolved. F01–F05 and P01/P03/P04 are not weakened.

## Must stay green

MAIN-01…04 and MAIN-06 short-term, already on this PR. MAIN-05 full and MAIN-07 remain deferred. Do not remove the runtime lock.

## Run

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test \
  docs/review-2026-09-08-main/qa/core-regression.test.mjs \
  docs/review-2026-09-08-main/qa/main-boundaries.test.mjs \
  docs/review-2026-09-08-pr6/qa/pr6-boundaries.test.mjs
```

Target: 27 main + 9 pr6, all pass. Also `npm test` and existing `test:review*`.
