# What ships

This is the product spec for the tree as loaded by DeepSeek Harness **0.1.2-rc.1**. Historical notes in `docs/01`–`docs/07` are not this spec. Original OD-01…OD-18 IDs stay frozen in `docs/review-2026-09-07/`. PR3-01…PR3-14 IDs stay stable in `docs/review-pr3/BACKLOG_PR3.json`. They are not all closed. Mapping there is related-not-closed. Residual holes from that round are **PR4-F01…PR4-F10** in `docs/review-pr4/BACKLOG_PR4.json`. Round-2 refinements are **PR4-R2-01…PR4-R2-05** in `docs/review-pr4-r2/BACKLOG_PR4_R2.json`.

## Required host

| Piece | Pin |
|---|---|
| CLI | `@deepseek-ai/dsh@0.1.2-rc.1` (`npx @deepseek-ai/dsh@0.1.2-rc.1 --version`) |
| Tool registry | `@deepseek-ai/dsh-tools@0.1.2-rc.1` (peer + optionalDependency) |
| Cordis | `@deepseek-ai/cordis@^4.0.2` |
| Node | `>=22.14.0` |

Install with a clean `$DSH_HOME` and `dsh plugin --profile web add`. Do not vendor or patch DSH source. `opendesigner_status` includes `requiredDsh: "0.1.2-rc.1"`.

## Plugin contract

| Piece | Location |
|---|---|
| Host entry | `src/plugin.ts` (`apply`, `name`, `inject`) |
| Bundle patch | `cordis.patch.yml` plus `package.json` `dsh.bundle.patch` |
| Domain service | `src/server/index.ts` `OpenDesignerService` |
| Tool catalog | `src/server/mcpTools.ts` |
| Host adapter | `src/server/dshAdapter.ts` (`defineTool`, JSON Schema `output.schema`) |
| Path jail | `src/server/pathJail.ts` (lstat each component; deny symlink/junction; no realpath-then-jail) |
| Destructive approval | one-shot receipt in `src/server/approvalReceipt.ts`; DSH `tools/pre-execute` asks the host channel |
| Checkpoints / Rewind | `src/server/checkpoints.ts` (deep-copied snapshots plus source overlay) |
| Working-copy autosave | `.designer/canvas.json` via `atomicWrite.ts`; dirty clears only on matching `localEditId`/`ackRevision` |
| Agent batch worktrees | `src/server/agentBatch.ts` (frozen changeset; three-way byte compare; durable apply journal) |
| Client library | `src/client/*`, bundled to `lib/client.js` |
| Live preview | `preview.html` + `src/client/previewApp.ts` + `scripts/preview-server.mjs` |

DSH loads the package main (`dist/plugin.js` after `npm run build`). Tests import TypeScript under `src/`. There is no `dsh.client` declaration. The preview is the designer UI.

## What Apply means now

There are two buttons. They are not aliases.

| UI | Tool | Writes |
|---|---|---|
| **保存设计稿** | `opendesigner_apply_to_project` | `.designer/canvas.json` and `.designer/applied.json`. The design draft. Not project source. |
| **应用到工程** | `opendesigner_batch_apply` | Real file diffs from an open Agent batch, through a durable journal. Shown first via `opendesigner_batch_preview`. Disabled when there are no diffs. |

应用到工程 refuses the whole batch when a main-tree file diverged from `baseRef` (`BATCH_CONFLICT`). User deletion vs Agent modify of a file that existed at `baseRef` is a conflict: the deletion stays, the candidate stays in the batch. Binary files compare raw bytes. Create batch fails with `DIRTY_WORKTREE` when the project has uncommitted files outside `.designer`.

**PR4-F01.** The approval `diffHash` is `hashFrozenChangeset`. It binds project, worktree, batch, `baseRef`, every op kind/path/mode, and before/after content hashes (plus the after-byte map). `toolDiffHash` for copy/edit/`accept_source_patch` also binds source/target, `replace_all`, and after bytes. After a receipt is issued, swapping worktree bytes at the same path changes the hash and consume is `DENIED`.

**PR4-R2-01.** Consume of `batch_apply` captures one frozen changeset, hashes it, consumes the receipt against that hash, and stores an immutable clone (`approvedChangeset`). Commit writes that object. It does not look up “latest pinned” by `batchId`. `apply()` captures then commits in one step. Distinct proposals are distinct `hashFrozenChangeset` identities. `executeTool` / `issueHostReceipt` run on one command queue. Concurrent `captureFrozen(B)` while `commitPrepared(A)` is running still writes A. The old pin map is gone.

**PR4-F02.** Conflict preflight is not the last check. `commitPrepared` re-reads each destination and compares `expected-before`. A user edit after preflight is `BATCH_CONFLICT`. The user bytes stay.

**PR4-R2-02.** The write itself is a managed single-writer boundary: exclusive sibling `.od-write-lock` (`wx`), re-read destination, fail closed on fingerprint mismatch, then write, then drop the lock. Atomic rename alone is not that protocol. A user edit injected after `recordBackup` and before the managed write is still `BATCH_CONFLICT`; the user bytes stay.

A leftover `applying` journal is replayed on load only when every path is evidence-complete (current fingerprint equals `beforeHash` or `afterHash`). Then backups are restored.

**PR4-F03.** Corrupt journal JSON, bad schema, or workspace mismatch is `BATCH_RECOVERY_BLOCKED`. It is not a silent missing journal.

**PR4-R2-03.** Recovery does not pretend success. Hashless old journals, a user repair matching neither hash, a planned write whose file the user deleted, a planned delete whose path the user recreated, and a truncated/half-write (`AGE` vs `AGENT_FULL`) all **BLOCK**. The file, journal, and backups stay. `recovered: true` is not returned and the log is not cleared. The weak hashless auto-restore path (old P02 / PR3-11) is gone. Hashed in-process rollback (C07: later-file failure after an earlier write) still restores from backups when every path matches `beforeHash` or `afterHash`.

**PR4-F04.** Every journal `rel` and `backupRel` goes through `resolveProjectPath` before any write. `../` is `BATCH_RECOVERY_BLOCKED` and does not write outside the project.

## Accept / reject (source ChangeSet)

Local ops (fill, radius, padding, text color, shadow, drag) write the live className and push a checkpoint. **Rewind** undoes them, including source overlays keyed by workspace and worktree. Restore targets the checkpoint’s worktree, not “whatever batch is open now.” Overlay capture stores binary mid-history (hash + bytes). The restore plan is materialized (jail + hashes) before any write and before the checkpoint cursor moves. `MAIN_SNAPSHOT` must not clobber `BATCH_WORK`. Rewind to a mid binary state `81 00` must not fall back to the initial `80 00`.

The model path is a structured source patch bound to a real file:

1. Open a real React page (default `examples/programmer-page`). That example is a multi-element page: `main.p-8`, cards, and a Pay button. The canvas imports `src/App.tsx` nodes with `sourceLocation`.
2. Select a region that maps to a source node.
3. Type intent in zh or en (for example `把按钮改成翠绿`).
4. **提出修改** builds a patch of that file (`sourceHash` + `baseRevision` + `beforeClassName`). It does not write.
5. The preview shows the same unified diff that accept will apply.
6. **拒绝** drops the pending proposal. The repo is unchanged.
7. **接受** reapplies that same patch after the three freshness checks. It writes the real source file, checkpoints, re-imports that file onto the canvas, and refreshes source maps. A stale proposal (`STALE_PROPOSAL`) leaves the file untouched.
8. Quit/reopen, then **Rewind**: the previous checkpoint restores canvas and the source file bytes.

**PR4-F05.** `className` comes from the **selected** opening tag (`extractClassNameAt` / `findBestMatchingOpeningElement`), not the first `className` in the file. Fixture `main.p-8` plus `button.bg-indigo-600`: emerald intent edits the button in source and on the canvas. `p-8` stays on `main`.

**PR4-F06.** `sliceEdits` expands unique context until `old_string` occurs once (or falls back to the whole file). `apply(before, sliceEdits(before, after)) === after`. Inserting `shadow-lg` on a long button label must not duplicate the file suffix. Babel syntax check on apply is unchanged.

**PR4-F10.** Keyword fallback must not invert intent. `不要改颜色，只去掉阴影` drops the shadow category. It does not add `shadow-lg`. Unsupported intents return `UNSUPPORTED_EDIT` with `currentClassName=...`. There is no silent full-page rewrite.

**PR4-R2-05.** Negation / multi-constraint shadow intent is refused. `不要去掉阴影，只改圆角` does not drop shadow and does not apply `rounded-xl`. The error declares `ruleMode: "refuse"`.

There is no fake-accept that only toggles a wrapper className. If the selection has no source map, propose fails with `NO_SOURCE_NODE`.

## Host approval receipts

`approve: true` in tool arguments is ignored. Destructive tools consume a one-shot receipt bound to `projectId`, `storeVersion`, tool name, and a diff hash, with TTL. Reuse after consume is `DENIED`.

**PR4-F08.** Local HTTP `POST /api/approval` mints a **debug** receipt (`receiptKind: "debug-http"`, `humanApproval: false`). That is not human approval of a seen diff. Prefer binding UI confirmation to the exact `diffHash`. Reject/cancel write nothing.

| Host | How a receipt is issued |
|---|---|
| Preview | `POST /api/approval` (Origin/Host/Content-Type checked), then `POST /api/tool` with `approvalReceipt`. Raw `/api/tool` with `approve:true` and no receipt is `DENIED`. |
| DSH | `tools/pre-execute` returns `ask` for gated `opendesigner_*` tools. After the host `allowed-once`, the plugin mints a receipt and `executeTool` consumes it. Missing `ctx.on` does not auto-approve. |
| Operator | `autoApprove` still skips the receipt check. It does not widen the jail. |

## CSS in the iframe (PR3-04)

The canvas stays an isolated `srcdoc` iframe (`sandbox="allow-same-origin"`, scripts denied). Trusted project CSS/tokens are copied into the srcdoc so `getComputedStyle` for background, radius, and shadow matches the parent document. `styleSheets` in the iframe is not empty. Isolation is not removed.

HTML/JSX serialization (`html-render`, `jsx-svg`) always reports `visualProof: false` unless a real browser screenshot is attached (PR3-09).

## Authoritative runtime

One server runtime owns `projectId` and `storeVersion`. Hydrate requires both `projectId` and an exact `baseVersion`. The server alone increments the version. A status poll cannot make a stale canvas body ride a newer version: the client sends `baseVersion: lastSeenVersion` from the last hydrate/tool ack, not from `/api/status`.

**PR4-F07.** One writer per project. A second `OpenDesignerService.init()` on the same root is `RUNTIME_BUSY` while the first pid holds `.designer/runtime.lock`. `saveCanvas` freezes store JSON and version at enqueue. `writeCanvas` persists that snapshot. `ackRevision` equals the version on disk, not a later bump.

**PR4-F09.** Source before-images are keyed by workspace and worktree. Binary files and read errors are stored as `binary` / `unreadable`. They are not recorded as absent.

**PR4-R2-04.** Checkpoints carry the same worktree identity. Capture no longer skips binary files. Restore writes into the snapshot’s worktree directory.

## How to open a real project

```sh
npm install
npm run build
npm test
npm run test:review
npm run test:review:pr3
npm run test:review:pr4
npm run test:review:pr4r2
OPENDESIGNER_PROJECT_ROOT=/absolute/path/to/your/react-app npm run preview
```

Default preview project is `examples/programmer-page`, a real React + Tailwind `App.tsx` with main, cards, and a Pay button. Do not point preview at `test-fixtures`. Open `http://127.0.0.1:4173/`. The preview server only serves `preview.html`, `preview/`, and `lib/`.

## Tools

The catalog still has 38 names so existing call sites keep working. Persistence tools are extra host tools with the `opendesigner_` prefix, including `batch_preview`, `propose_source_patch`, `accept_source_patch`, and `reject_source_patch`.

Honest behavior:

- File tools: real I/O, jailed with lstat-per-component, no symlink/junction follow on read/write/copy/delete. Destructive tools need a host approval receipt (or operator `autoApprove`).
- Canvas tools: in-memory `FlatStore` with bidirectional parent/child maps, a single parent, and a valid `activePageId`.
- `take_screenshot`: `html-render` and `jsx-svg` are not visual proof.
- Claims: overlapping ancestor/descendant locks are conflicts. Releasing an expired claim does not drop a newer live lock.
- `get_theme`, `search_icons`, `set_icon_library`: stubs.

## Review gates

Original OD pack (must stay green):

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test docs/review-2026-09-07/qa/*.test.mjs
```

PR3 re-review pack (C01–C08 plus N01–N03, plus CSS iframe fixture):

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test docs/review-pr3/qa/core-regression.test.mjs
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test docs/review-pr3/qa/css-iframe.test.mjs
```

PR4 gates (R01–R07, P04/P05 as positive tests, F08–F10):

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test docs/review-pr4/qa/*.test.mjs
```

PR4 round-2 gates (B01–B10, including B08):

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test docs/review-pr4-r2/qa/*.test.mjs
```

See `docs/review-pr3/BACKLOG_PR3.json` for PR3-01…PR3-14 and the OD-xx mapping table. Do not treat a mapping row as closing an OD item. Do not claim PR3-01…14 all closed. Do not renumber OD-xx.
