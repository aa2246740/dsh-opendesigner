# What ships

This is the product spec for the tree as loaded by DeepSeek Harness. Historical notes in `docs/01`–`docs/07` are not this spec.

## Plugin contract

| Piece | Location |
|---|---|
| Host entry | `src/plugin.ts` (`apply`, `name`, `inject`) |
| Bundle patch | `cordis.patch.yml` |
| Domain service | `src/server/index.ts` `OpenDesignerService` |
| Tool catalog | `src/server/mcpTools.ts` |
| Path jail | `src/server/pathJail.ts` |
| Destructive approval | `src/server/approval.ts` |
| Client library | `src/client/*`, bundled to `lib/client.js` (no Babel; Tailwind merge lives in `src/compiler/tailwindMerge.ts`) |
| Live preview | `preview.html` + `src/client/previewApp.ts` + `scripts/preview-server.mjs` |

DSH loads the package main (`dist/plugin.js` after `npm run build`). Tests import TypeScript under `src/`.

## Tools

The catalog still has 38 names so existing call sites keep working. Host registration prefixes them with `opendesigner_`. That prefix avoids colliding with DSH built-ins.

Honest behavior:

- File tools: real I/O, jailed, destructive tools need `approve: true` or `autoApprove`.
- Canvas tools: in-memory `FlatStore`. `canvas_insert` uses top-level `tag` / `props` / `textContent`.
- `take_screenshot`: fail closed, or `jsx-svg` snapshot.
- `get_theme`, `search_icons`, `set_icon_library`: stubs. Marked here so README cannot claim otherwise.
- Skills: `opendesigner-design`, `opendesigner-import-from-project`, `opendesigner-compositions`.

## AI

`AIGateway` is an OpenAI-compatible `chat/completions` client. Mock mode is the default without a key. Provider detection lives in `detectAiConfigFromEnv`.
