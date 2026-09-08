# MAIN 2026-09-08 gate (Gate A)

Write-path safety for every entry: `apply()`, receipt/credential `commitPrepared`, UI/API batch apply, source Accept, Rewind/restore.

## Closed in this PR

| ID | Severity | Result |
|---|---|---|
| MAIN-01 | P0 | Receipt/`commitPrepared` runs the same three-way conflict guard as `apply()`. Ordinary approval is not force-overwrite. |
| MAIN-02 | P1 | `recover()` validates every backup path/type/mode/hash against `beforeHash` before any restore write, then read-back verifies before clearing the journal. |
| MAIN-03 | P0 | Multi-file restore preflights all targets, then applies through a restore journal with compensation. Fail leaves files unchanged or an explicit blocked journal. |
| MAIN-04 | P1 | Runtime lock distinguishes missing / creating / corrupt / held / proven-dead. Creating and undecidable refuse. Reclaim/release require holder token + lock identity. |
| MAIN-06 | P1 | Short-term: `acceptSourcePatch` targeting main root is refused while a batch is open (`SOURCE_PATCH_MAIN_ROOT_LOCKED`). |

## Deferred

| ID | Why |
|---|---|
| MAIN-05 | Full unified browser↔DSH RPC so preview and the plugin share one authoritative Service. This PR keeps the single-writer lock. Do not remove it to share sessions. |
| MAIN-07 | Static JSX projection vs real React preview. Out of scope. No JSX/canvas expand. |
| MAIN-05/06 full | Binding each proposal to an explicit workspace/worktree, and a thin preview client over one Service, remain follow-up work. |

## Run

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test docs/review-2026-09-08-main/qa/core-regression.test.mjs docs/review-2026-09-08-main/qa/main-boundaries.test.mjs
```

Combined with the PR6 pack (B01 + PR6-R01/R02) on this same PR:

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test \
  docs/review-2026-09-08-main/qa/core-regression.test.mjs \
  docs/review-2026-09-08-main/qa/main-boundaries.test.mjs \
  docs/review-2026-09-08-pr6/qa/pr6-boundaries.test.mjs
```

Target: 27/27 MAIN. Also `npm test` and existing `test:review*`. PR #6 must not merge; this PR is the single Gate A PR.

Crash leftover lock: if `.designer/runtime.lock` is empty or corrupt and no OpenDesigner process is running, delete that file and retry. Do not delete it while a writer is still creating the payload.
