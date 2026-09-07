# What ships

This is the product spec for the tree as loaded by DeepSeek Harness **0.1.2-rc.1**. Historical notes in `docs/01`–`docs/07` are not this spec.

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
| Path jail | `src/server/pathJail.ts` (realpath, then jail) |
| Destructive approval | `src/server/approval.ts` (host/UI channel only) |
| Checkpoints / Rewind | `src/server/checkpoints.ts` (deep-copied snapshots) |
| Working-copy autosave | `.designer/canvas.json` via `atomicWrite.ts` |
| Agent batch worktrees | `src/server/agentBatch.ts` |
| Client library | `src/client/*`, bundled to `lib/client.js` |
| Live preview | `preview.html` + `src/client/previewApp.ts` + `scripts/preview-server.mjs` |

DSH loads the package main (`dist/plugin.js` after `npm run build`). Tests import TypeScript under `src/`. There is no `dsh.client` declaration. The preview is the designer UI.

## What Apply means now

There are two buttons. They are not aliases.

| UI | Tool | Writes |
|---|---|---|
| **保存设计稿** | `opendesigner_apply_to_project` | `.designer/canvas.json` and `.designer/applied.json`. The design draft. Not project source. |
| **应用到工程** | `opendesigner_batch_apply` | Real file diffs from an open Agent batch. Shown first via `opendesigner_batch_preview`. Disabled when there are no diffs. |

应用到工程 refuses the whole batch when a main-tree file diverged from `baseRef` (`BATCH_CONFLICT`). It includes committed worktree changes, treats rename as delete+write, parses Git paths with `-z`, and rolls back earlier files if a later copy fails.

Create batch fails with `DIRTY_WORKTREE` when the project has uncommitted files outside `.designer`.

## Accept / reject

Local ops (fill, radius, padding, text color, shadow, drag) write the live className and push a checkpoint. **Rewind** undoes them.

The model path is a ChangeSet:

1. Select a node.
2. Type intent in zh or en.
3. **提出修改** asks the live model for a scoped className proposal. It does not mutate the store.
4. **接受** applies the proposal and checkpoints. Rewind undoes it.
5. **拒绝** drops the proposal. The store is unchanged.

If no live provider is configured, **提出修改** stays disabled. There is no hardcoded `Add shadow-lg to the button className` demo. Shadow is a local inspector chip.

`approve: true` in model tool arguments is ignored. Preview `/api/tool` is the trusted host channel.

## How to open a real project

```sh
npm install
npm run build
npm test
npm run test:review
OPENDESIGNER_PROJECT_ROOT=/absolute/path/to/your/react-app npm run preview
```

Default preview project is `examples/programmer-page`, a real React + Tailwind `App.tsx`. Do not point preview at `test-fixtures`. The UI and Agent share one `projectId` and `storeVersion`. A stale whole-canvas POST is rejected (`STALE_HYDRATE`).

Open `http://127.0.0.1:4173/`. The preview server only serves `preview.html`, `preview/`, and `lib/`.

## Tools

The catalog still has 38 names so existing call sites keep working. Persistence tools are extra host tools with the `opendesigner_` prefix, including `batch_preview`.

Honest behavior:

- File tools: real I/O, jailed with realpath, destructive tools need a host approval channel or `autoApprove`.
- Canvas tools: in-memory `FlatStore` with graph validation (missing parents, cycles, dangling page roots).
- `take_screenshot`: `html-render` is bound to `ComponentSandbox` HTML and may verify a claim. `jsx-svg` never counts as visual proof. `none` fails closed.
- Claims: overlapping ancestor/descendant locks are conflicts. Releasing an expired claim does not drop a newer live lock.
- `get_theme`, `search_icons`, `set_icon_library`: stubs.

## Review gate

```sh
REVIEW_SOURCE_ROOT=$PWD/src node --experimental-strip-types --test docs/review-2026-09-07/qa/*.test.mjs
```

See `docs/review-2026-09-07/BACKLOG.json` for OD-01…OD-18.
