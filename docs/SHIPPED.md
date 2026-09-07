# What ships

This is the product spec for the tree as loaded by DeepSeek Harness **0.1.2-rc.1**. Historical notes in `docs/01`–`docs/07` are not this spec. Original OD-01…OD-18 IDs stay frozen in `docs/review-2026-09-07/`. This round’s findings are PR3-01…PR3-14 in `docs/review-pr3/BACKLOG_PR3.json`.

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
| Agent batch worktrees | `src/server/agentBatch.ts` (three-way byte compare; durable apply journal) |
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

A leftover `applying` journal is replayed on load. If restore fails, the runtime surfaces `BATCH_RECOVERY_BLOCKED` instead of pretending the tree is clean.

## Accept / reject (source ChangeSet)

Local ops (fill, radius, padding, text color, shadow, drag) write the live className and push a checkpoint. **Rewind** undoes them, including source overlays.

The model path is a structured source patch bound to a real file:

1. Open a real React page (default `examples/programmer-page`). The canvas imports `src/App.tsx` nodes with `sourceLocation`.
2. Select a region that maps to a source node.
3. Type intent in zh or en (for example `把按钮改成翠绿`).
4. **提出修改** builds a patch of that file (`sourceHash` + `baseRevision` + `beforeClassName`). It does not write. Unsupported edits error. A model that returns a `<button>` wrapper is not accepted; the deterministic mapper is used when the intent is known.
5. The preview shows the same unified diff that accept will apply.
6. **拒绝** drops the pending proposal. The repo is unchanged.
7. **接受** reapplies that same patch after the three freshness checks. It writes the real source file, checkpoints, and updates the canvas from the file. A stale proposal (`STALE_PROPOSAL`) leaves the file untouched.
8. Quit/reopen, then **Rewind**: the previous checkpoint restores canvas and the source file bytes.

There is no fake-accept that only toggles a wrapper className. If the selection has no source map, propose fails with `NO_SOURCE_NODE`.

## Host approval receipts (PR3-08)

`approve: true` in tool arguments is ignored. Destructive tools consume a one-shot receipt bound to `projectId`, `storeVersion`, tool name, and a diff hash, with TTL. Reuse after consume is `DENIED`.

| Host | How a receipt is issued |
|---|---|
| Preview | `POST /api/approval` (Origin/Host/Content-Type checked), then `POST /api/tool` with `approvalReceipt`. Raw `/api/tool` with `approve:true` and no receipt is `DENIED`. |
| DSH | `tools/pre-execute` returns `ask` for gated `opendesigner_*` tools. After the host `allowed-once`, the plugin mints a receipt and `executeTool` consumes it. Missing `ctx.on` does not auto-approve. |
| Operator | `autoApprove` still skips the receipt check. It does not widen the jail. |

## CSS in the iframe (PR3-04)

The canvas stays an isolated `srcdoc` iframe (`sandbox="allow-same-origin"`, scripts denied). Trusted project CSS/tokens are copied into the srcdoc so `getComputedStyle` for background, radius, and shadow matches the parent document. `styleSheets` in the iframe is not empty. Isolation is not removed.

HTML/JSX serialization (`html-render`, `jsx-svg`) always reports `visualProof: false` unless a real browser screenshot is attached (PR3-09).

## Authoritative runtime (PR3-07)

One server runtime owns `projectId` and `storeVersion`. Hydrate requires both `projectId` and an exact `baseVersion`. The server alone increments the version. A status poll cannot make a stale canvas body ride a newer version: the client sends `baseVersion: lastSeenVersion` from the last hydrate/tool ack, not from `/api/status`.

## How to open a real project

```sh
npm install
npm run build
npm test
npm run test:review
npm run test:review:pr3
OPENDESIGNER_PROJECT_ROOT=/absolute/path/to/your/react-app npm run preview
```

Default preview project is `examples/programmer-page`, a real React + Tailwind `App.tsx`. Do not point preview at `test-fixtures`. Open `http://127.0.0.1:4173/`. The preview server only serves `preview.html`, `preview/`, and `lib/`.

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

See `docs/review-pr3/BACKLOG_PR3.json` for PR3-01…PR3-14 and the OD-xx mapping table. Do not renumber OD-xx.
