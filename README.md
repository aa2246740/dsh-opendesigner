# dsh-opendesigner

A DeepSeek Harness plugin for local-first visual editing of React + Tailwind components.

It is an out-of-tree Cordis plugin. It does not patch DeepSeek Harness. File tools stay inside the project root. Destructive writes need a trusted host/UI approval channel (`approve: true` from the model is ignored) unless you set `autoApprove` (that flag never widens the jail).

## Required host

This package targets published **DeepSeek Harness 0.1.2-rc.1**. Use that CLI and the matching `@deepseek-ai/dsh-tools@0.1.2-rc.1` peer. Do not patch DSH core. Node 22.14 or newer.

Peer range in `package.json`: `@deepseek-ai/dsh-tools` `0.1.2-rc.1`, `@deepseek-ai/cordis` `^4.0.2`.

## What ships

- Host plugin: `apply` / `name` / `inject = ["tools"]` plus `dsh.bundle.patch`.
- Jailed project/local file tools (realpath jail).
- In-session checkpoints and Rewind for canvas plus applied source edits (deep-copied; create/delete tombstones).
- Working-copy autosave at `.designer/canvas.json` (**保存设计稿**). Crash safety only.
- Optional git worktree isolation for an Agent source batch. **应用到工程** copies real file diffs with conflict checks.
- Deterministic Tailwind class slicing and an OpenAI-compatible AI merge client that proposes a ChangeSet.
- A live preview (`npm run preview`) that mounts `CanvasPanel` against a real project path.

## What does not ship

- Lunagraph parity, Figma Kiwi clipboard fidelity, or a React 19 runtime.
- An HTTP MCP server on port 21209.
- A 1x1 PNG that marks canvas claims as visually verified. `take_screenshot` fails closed unless you attach a renderer or set `screenshotMode: "html-render"` (sandbox HTML). `jsx-svg` is a serialization snapshot and is never visual proof.
- A `dsh.client` web-shell plugin. The canvas lives in `npm run preview`. Declaring `dsh.client` against `lib/client.js` would fail host boot.

`docs/01` through `docs/07` are historical notes. Do not treat them as the product spec. See [docs/SHIPPED.md](docs/SHIPPED.md).

## Install on DeepSeek Harness 0.1.2-rc.1

Record the version you boot. It must print `0.1.2-rc.1`.

```sh
npx @deepseek-ai/dsh@0.1.2-rc.1 --version
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
npx @deepseek-ai/dsh@0.1.2-rc.1 plugin --profile web add "$(pwd)"
npx @deepseek-ai/dsh@0.1.2-rc.1 --profile web --dump-config
npx @deepseek-ai/dsh@0.1.2-rc.1 web --no-open
```

`dump-config` must contain a `# == dsh-opendesigner` layer. Settings → Plugins must list the plugin as Enabled.

The bundle patch inserts id `dsh-opendesigner`. Host tools are registered with `ctx.tools.register(defineTool(...))` as `opendesigner_*` (for example `opendesigner_status`, `opendesigner_canvas_list`, `opendesigner_project_read`). `output.schema` is JSON Schema. `opendesigner_status` reports `requiredDsh: "0.1.2-rc.1"` and `hasApiKey` only, never key values.

Scratch overlay while developing against a source checkout:

```yaml
- insert:
    - id: dsh-opendesigner
      name: /absolute/path/to/dsh-opendesigner/dist/plugin.js
```

```sh
pnpm dsh web --patch /absolute/path/to/overlay.yml
```

## Preview

```sh
npm install
npm run build
npm test
npm run test:review
OPENDESIGNER_PROJECT_ROOT=/absolute/path/to/your/react-app npm run preview
```

Default project is `examples/programmer-page`. Open `http://127.0.0.1:4173/`. Use **Fill emerald**, **Radius xl**, or **Shadow lg** for a local className edit, then **Rewind**. Type intent and **提出修改** to see a ChangeSet; **拒绝** leaves no residue; **接受** checkpoints. **保存设计稿** writes `.designer/canvas.json`. **应用到工程** is enabled only when an Agent batch has file diffs. **Create batch** / **Write batch file** / **Discard batch** isolate Agent source. Live AI is gated until a key is configured. `OPENDESIGNER_FORCE_MOCK=1` is test-only.

## AI gateway

Safe default: mock mode when no API key is configured. Preview and `apply()` try live providers in this order when keys exist:

1. `OPENROUTER_ONLYUSE_FREEMODEL_API_KEY` or `OPENROUTER_API_KEY`
2. `MINIMAXCN_API_KEY` or `MINIMAX_CN_API_KEY`
3. `GEMINI_API_KEY` or `GOOGLE_API_KEY`
4. `DEEPSEEK_API_KEY`
5. `OPENAI_API_KEY`
6. `GLM_CN_API_KEY`

Override model with `OPENROUTER_MODEL`, `MINIMAX_MODEL`, or `GEMINI_MODEL`. Never put keys in the repo. `status()` reports `hasApiKey` only.

Ollama has no key. Set `aiConfig.mockMode` to `false` and point `baseURL` at your local server.

## Save, Rewind, and Agent batches

Git worktrees isolate an Agent source batch. They are not Rewind, and they are not created per style tweak.

| Layer | What it does | Git? |
|---|---|---|
| Checkpoints / Rewind | In-session stack of canvas + session source overlay. `opendesigner_rewind` restores a checkpoint. | Not required |
| Working-copy autosave | Atomic write to `.designer/canvas.json`. Crash safety only. | Not required. Never commits. |
| Agent batch worktree | `opendesigner_batch_create` adds a jailed worktree under `.designer/worktrees/<batchId>`. Discard removes it. Apply copies files back, then removes it. | Required. Without git, the tool returns `GIT_REQUIRED`. Layers above still work. |
| Save / 保存设计稿 | `opendesigner_apply_to_project` stamps `.designer/applied.json` after host approval. Canvas only. | Never silent `git commit`. |
| 应用到工程 | `opendesigner_batch_apply` copies batch file diffs if they pass conflict checks. Disabled when there are no diffs. | Never silent `git commit`. |

Approval: canvas style and geometry tools are auto-allowed. Applying source writes, `apply_to_project`, and `batch_apply` stay gated. `autoApprove` does not widen the path jail.

## Path jail

`project_*` and `local_*` resolve through `resolveProjectPath`. Absolute paths, `..` escape, and symlink escape are errors (`PATH_JAIL`). `local_*` is the same jail as `project_*`. There is no host-wide filesystem.

## License

MIT. See [LICENSE](LICENSE).
