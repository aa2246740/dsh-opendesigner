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
| Path jail | `src/server/pathJail.ts` |
| Destructive approval | `src/server/approval.ts` |
| Checkpoints / Rewind | `src/server/checkpoints.ts` |
| Working-copy autosave | `.designer/canvas.json` via `atomicWrite.ts` |
| Agent batch worktrees | `src/server/agentBatch.ts` |
| Client library | `src/client/*`, bundled to `lib/client.js` (no Babel; Tailwind merge lives in `src/compiler/tailwindMerge.ts`) |
| Live preview | `preview.html` + `src/client/previewApp.ts` + `scripts/preview-server.mjs` |

DSH loads the package main (`dist/plugin.js` after `npm run build`). Tests import TypeScript under `src/`. There is no `dsh.client` declaration. The preview is the designer UI. A malformed `dsh.client` row fails web boot.

## Tools

The catalog still has 38 names so existing call sites keep working. Host registration prefixes them with `opendesigner_` and wraps each with `defineTool` from `@deepseek-ai/dsh-tools@0.1.2-rc.1`. That prefix avoids colliding with DSH built-ins. `output.schema` is `{ type: "object", additionalProperties: true }`. Execute honors `exec.signal` abort.

Honest behavior:

- File tools: real I/O, jailed, destructive tools need `approve: true` or `autoApprove`.
- Canvas tools: in-memory `FlatStore`. `canvas_insert` uses top-level `tag` / `props` / `textContent`.
- `take_screenshot`: fail closed, or `jsx-svg` snapshot.
- `get_theme`, `search_icons`, `set_icon_library`: stubs. Marked here so README cannot claim otherwise.
- Skills: `opendesigner-design`, `opendesigner-import-from-project`, `opendesigner-compositions`.

## AI

`AIGateway` is an OpenAI-compatible `chat/completions` client. Mock mode is the default without a key. Provider detection lives in `detectLiveProvidersFromEnv`. Preview `/api/ai-merge` is live-only unless `OPENDESIGNER_FORCE_MOCK=1`.

## Save model

Worktrees are for Agent batches that may rewrite project source. They are not the only Rewind, and they are not spawned per canvas gesture.

1. **Checkpoints / Rewind.** `CheckpointLog` is a bounded stack (50) of canvas JSON plus optional session source files. Host tools: `opendesigner_checkpoint`, `opendesigner_rewind`, `opendesigner_list_checkpoints`. Canvas and source mutations push a checkpoint. Rewind restores the snapshot. No worktree is created.
2. **Working-copy autosave.** `opendesigner_autosave` and canvas tools write `.designer/canvas.json` with temp-file rename. This is crash safety, not history. Timed preview autosave calls this only.
3. **Agent batch worktree.** `opendesigner_batch_create` runs `git worktree add` at `.designer/worktrees/<batchId>` on branch `opendesigner/batch-*`. The project root must be the git toplevel. File tools then jail to that worktree. `opendesigner_batch_discard` removes it. `opendesigner_batch_apply` copies jailed files into the main tree, then removes the worktree. No git commit. If the project is not a git repo, create returns `{ code: "GIT_REQUIRED" }`.
4. **Explicit Save / Apply to project.** `opendesigner_apply_to_project` is gated. It writes the working copy and `.designer/applied.json`. It does not `git commit`.
5. **Approval policy.** Canvas style/geometry tools are auto-allowed (`destructive` unset). Source writes, apply-to-project, and batch apply are gated. `autoApprove` skips the prompt only. Path jail is always on.

The 38-name catalog is unchanged. Persistence tools are extra host tools with the `opendesigner_` prefix.
