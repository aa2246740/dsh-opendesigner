# dsh-opendesigner

A DeepSeek Harness plugin for local-first visual editing of React + Tailwind components.

It is an out-of-tree Cordis plugin. It does not patch DeepSeek Harness. File tools stay inside the project root. Destructive writes need an explicit `approve: true` unless you set `autoApprove` (that flag never widens the jail).

## What ships

- Host plugin: `apply` / `name` / `inject = ["tools"]` plus `dsh.bundle.patch`.
- Jailed project/local file tools.
- In-session checkpoints and Rewind for canvas plus applied source edits.
- Working-copy autosave at `.designer/canvas.json` (atomic write, crash safety, not version history).
- Optional git worktree isolation for an Agent source batch under `.designer/worktrees/<batchId>`.
- Explicit Save / Apply to project. Timed autosave never `git commit`.
- Deterministic Tailwind class slicing (`src/compiler/sourceEdit.ts`) and an OpenAI-compatible AI merge client.
- A live preview (`npm run preview`) that mounts `CanvasPanel`, not a static marketing mock.

## What does not ship

- Lunagraph parity, Figma Kiwi clipboard fidelity, or a React 19 runtime.
- An HTTP MCP server on port 21209.
- A 1x1 PNG that marks canvas claims as visually verified. `take_screenshot` fails closed unless you attach a renderer or set `screenshotMode: "jsx-svg"` (a serialization snapshot, not pixels).

`docs/01` through `docs/07` are historical notes. Do not treat them as the product spec. See [docs/SHIPPED.md](docs/SHIPPED.md).

## Install on DeepSeek Harness

Use unmodified DSH. Record the version you boot.

```sh
npx @deepseek-ai/dsh --version
dsh plugin --profile web add "$(pwd)"
dsh --profile web --dump-config
npx @deepseek-ai/dsh web
```

The bundle patch inserts id `dsh-opendesigner`. Host tools are registered as `opendesigner_*` (for example `opendesigner_status`, `opendesigner_canvas_list`, `opendesigner_project_read`).

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
npm run preview
```

Open `http://127.0.0.1:4173/`. Use **Fill emerald** or **Radius xl** for a deterministic className edit, then **Rewind**. Use **Create batch** / **Write batch file** / **Apply batch** or **Discard batch** for the Agent-batch path.

## AI gateway

Safe default: mock mode when no API key is configured. `apply()` reads, in order:

1. `GEMINI_API_KEY` or `GOOGLE_API_KEY`
2. `OPENROUTER_ONLYUSE_FREEMODEL_API_KEY` or `OPENROUTER_API_KEY`
3. `MINIMAXCN_API_KEY` or `MINIMAX_CN_API_KEY`
4. `DEEPSEEK_API_KEY`
5. `OPENAI_API_KEY`

Override model with `GEMINI_MODEL`, `OPENROUTER_MODEL`, or `MINIMAX_MODEL`. Never put keys in the repo. `status()` reports `hasApiKey` only.

Ollama has no key. Set `aiConfig.mockMode` to `false` and point `baseURL` at your local server.

## Save, Rewind, and Agent batches

Git worktrees isolate an Agent source batch. They are not Rewind, and they are not created per style tweak.

| Layer | What it does | Git? |
|---|---|---|
| Checkpoints / Rewind | In-session stack of canvas + session source overlay. `opendesigner_rewind` restores a checkpoint. | Not required |
| Working-copy autosave | Atomic write to `.designer/canvas.json`. Crash safety only. | Not required. Never commits. |
| Agent batch worktree | `opendesigner_batch_create` adds a jailed worktree under `.designer/worktrees/<batchId>`. Discard removes it. Apply copies files back, then removes it. | Required. Without git, the tool returns `GIT_REQUIRED`. Layers above still work. |
| Save / Apply to project | `opendesigner_apply_to_project` stamps `.designer/applied.json` after an explicit approve. | Never silent `git commit`. |

Approval: canvas style and geometry tools are auto-allowed. Applying source writes, `apply_to_project`, and `batch_apply` stay gated. `autoApprove` does not widen the path jail.

## Path jail

`project_*` and `local_*` resolve through `resolveProjectPath`. Absolute paths and `..` escape are errors (`PATH_JAIL`). `local_*` is the same jail as `project_*`. There is no host-wide filesystem.

## License

MIT. See [LICENSE](LICENSE).
