# Code review of `main` — 2026-09-04

Reviewed HEAD: `75aa86f` on `aa2246740/dsh-opendesigner` (7 commits, no open PRs, no issues).  
Scope: repository docs + all of `src/`, `test/`, `lib/client.js`, `preview.html`, `package.json`.  
Constraints honored: no feature work, no Lunagraph unpack/RE, no product patches, no clone-fidelity work, no edits outside this repo. This file is documentation only.

---

## 给仓库主人的摘要（中文）

Cola：当前 `main` 不是一个可运行的 DeepSeek Harness 视觉设计器，而是一套**库级算法 + 大量协议外壳**。几何/吸附/扁平 Store/AST 切片/OCC 锁状态机有真实实现和有效单测；但 README 与 `docs/01`–`08` 所承诺的产品（HTTP MCP、38 个对等工具、真 Figma Kiwi、React 19 活画布、DSH Cordis 宿主、视觉验收闭环）**大部分未交付或被桩/演示页顶替**。

更严重的是两件事：

1. **安全（Standards）**：`src/server/mcpTools.ts` 的读写删工具用 `path.resolve(projectRoot, args.path)`，**不校验路径仍在工程根内**；`autoApprove` 默认 `true` 且调度器从未读取。一旦挂到 Agent 工具面，就是任意文件读写。本 PR **不修代码**，只记录。
2. **合规（Spec）**：README 写明文档来自对 Lunagraph 的完整逆向。`docs/01`–`07` 含官方内部路径、工具清单、锁协议，以及声称摘自官方编译器的代码片段；`src/server/mcpTools.ts` 还注册了 `lunagraph-*` 技能名。以 MIT 公开仓库形态继续扩协议/文档，法律风险高。下一步应走**净室**，而不是继续按逆向文档补功能。

`npm test` 实际跑 **0** 条用例；`npm run build`（`tsc -b`）失败。手工 `node --test --experimental-strip-types test/*.ts` 可过 **93** 条。

---

## Owner summary (English)

Cola: `main` is not a shipped DeepSeek Harness visual designer. It is a **TypeScript library of canvas/compiler primitives** wrapped in marketing that describes Lunagraph parity.

What is real: FlatStore, Babel-backed className/style slicing, in-memory claim locks, affine pan/zoom, 6-line snap, 8-handle resize, an OpenAI-compatible HTTP client with a mock fallback, and a **self-invented** binary packer labeled “Kiwi”.

What is not: no HTTP MCP server, no React 19 runtime (no `react` dependency), no real Figma clipboard schema, no DSH/Cordis package, no live screenshot critique, no import-map sandbox. `preview.html` is a static mock that claims “MCP Server: Online (38 Tools)”.

**Worst Standards issue:** MCP file tools have **path traversal / absolute-path escape** and no authZ gate.  
**Worst Spec issue:** public MIT repo shipping **Lunagraph reverse-engineering docs and protocol names**. Clean-room; do not extend the RE surface.

---

## Standards

Repo docs: README only (no `CONTRIBUTING`, no `LICENSE` file despite `"license": "MIT"` in `package.json`, no `.github` templates). Smell baseline below; README/docs override where they conflict with code (they usually over-claim; see Spec).

### Tests: exist, often assert, but the advertised runner is a no-op

| Claim | Reality |
|---|---|
| Commits `95c05ac` / `b9b8a8c`: “37 then 71 tests, 100% pass” | **93** `it(...)` across **21** `describe` blocks in `test/*.ts` |
| `package.json` `"test": "node --test"` | On Node v22 this discovers **zero** `.ts` files. `npm test` → `# tests 0` |
| Manual run | `node --test --experimental-strip-types test/*.ts` → 93 pass |
| `npm run build` | `tsc -b` fails: `.ts` import extensions (`TS5097`), unused `ASTParser` visitor typing, `STRETCH` not in `FigmaNode` union, missing `@types/babel__traverse` |

**Tests that actually assert behavior** (good):

- `test/compiler.test.ts` — Tailwind slot merge, literal `className` slice, `not-literal` downgrade, same-line JSX targeting, surgical-edit uniqueness + syntax rollback.
- `test/flatStore.test.ts` — attach/move/clone, cycle detection, JSON round-trip.
- `test/client.test.ts`, `test/canvasPanel.test.ts`, `test/canvasInteraction.test.ts` — matrix invert, companion geometry, snap threshold, viewport zoom-at-cursor, overlay SVG strings.
- `test/aiGateway.test.ts` — mock merge, retry-on-syntax, tool_calls parse, R1 markdown JSON, HTTP 429.
- `test/server.test.ts` — claim lifecycle, STALE_READ, parent-claim child delete, persistence of `.designer/canvas.json`.

**Tests that mostly prove the wrapper exists:**

- `test/server.test.ts` “should have all 38 tools defined” — `OPEN_DESIGNER_TOOLS.length === 38` and category set. Does not execute ~25 tools.
- Design/skills case — asserts hardcoded `theme.colors.primary` and `skills.length === 3`.
- Screenshot path — asserts `data:image/png` prefix; implementation always returns a **1×1 PNG**.
- `test/figmaParser.test.ts` — round-trips **this repo’s** `packKiwiBinary`/`unpackKiwiBinary`, not `application/x-figma-schema-kiwi`.
- `test/cordisService.test.ts` — mounts tools into a **local** `Context` stub (`src/server/cordis.ts`), not DeepSeek Harness. The git test calls `syncGitWorkspace({ stageCanvas: true })` on `process.cwd()`; `.designer/` is gitignored so `git add` is a no-op, but it **does write** `.designer/canvas.json` in the developer repo.

No tests for: path confinement, destructive-tool approval, HTTP MCP, real Figma bytes, React mount, `canvas_insert` as documented, `ASTParser`, `autoApprove`.

### DSH plugin boundary

README “环境安全承诺”: self-contained, does not invade the host.

| Check | Finding |
|---|---|
| Cordis / DSH dependency | **None** in `package.json`. `src/server/cordis.ts` is an in-repo `Context`/`Service` lookalike. |
| Plugin exports | `apply` / `name` / `inject = ["tools"]` in `src/server/index.ts` are a convention match only. |
| Network bind | `config.port` defaults to **21209** and is never passed to `listen()`. No `/mcp` HTTP server. |
| Host FS | Intended `local_*` tools (`docs/02`) are documented as whitelist host I/O. Implementation aliases them to `projectRoot` with **no** `isExistingPathAllowed`. |
| Git | `getGitStatus` / `syncGitWorkspace` run `git` with `cwd: projectRoot` and `GIT_CONFIG_GLOBAL=/dev/null` (good). They still mutate the **target project** (write canvas, attempt `git add`). |
| Client bundle | `lib/client.js` is a **hand-maintained duplicate** of `src/client/*` (UMD + `__ModuleLoader__`). Drift risk vs TypeScript. |
| Preview | `preview.html` loads `https://cdn.tailwindcss.com` and is a static mock, not `src/client`. |

The plugin is “self-contained” as a library. It is **not** a proven DSH extension, and its tool surface is unsafe if a host forwards Agent calls into `executeTool`.

### Security

No secrets committed (`.env` gitignored; tests use `sk-mock-key` only in memory). No `eval` / `new Function` in `src/`. Sandbox is an HTML string builder with attribute escaping (`src/client/sandbox.ts`).

**Critical footgun (no code fix in this PR):** MCP project/local file tools in `src/server/mcpTools.ts` (`project_read` / `project_write` / `project_write_batch` / `project_edit` / `project_delete` / `project_copy_asset` / `local_read` / `local_read_batch` / `local_write` / `local_edit`).

```text
path.resolve(projectRoot, args.path)
```

- `path` = `/etc/passwd` → absolute path, **leaves the project**.
- `path` = `../../../.ssh/id_rsa` → traversal, **leaves the project**.
- `docs/02` describes `DESTRUCTIVE_TOOLS` + 120s approval + `isExistingPathAllowed`. **None of that is implemented.** `destructive: true` is metadata only.
- `OpenDesignerService.autoApprove` defaults to `true` (`src/server/index.ts`) and is copied into `MCPContext` but **never read** by `dispatchMCPTool`.

If this dispatcher is mounted on DSH `tools` (the stated product), an Agent can read/write arbitrary files. Treat as **do not expose** until confined.

Other notes (lower than the footgun, still real):

- **SSRF (config-shaped):** `AIGateway` (`src/server/aiGateway.ts`) `POST`s to `baseURL + "/chat/completions"` with `Authorization: Bearer`. `provider: "custom"` defaults to `http://localhost:8000/v1`. No URL allowlist. Severity depends on who can set `aiConfig.baseURL`.
- **MCP authZ:** no session, no `project_pick` binding (always `{ success: true }`), no loopback bind because there is no server.
- **ReDoS:** `project_grep` / `canvas_grep` compile `new RegExp(args.pattern)` on attacker-controlled strings.
- **HTML tag injection:** `renderToHtml` interpolates `el.tag` unsanitized (`src/client/sandbox.ts`). Not `eval`, but XSS if canvas nodes are Agent-supplied.
- **Verification theater:** `take_screenshot` always returns the same 1×1 PNG and sets `verified = true`, which **unlocks** `canvas_release` after mutation (`src/server/mcpTools.ts`, `src/server/claimRegistry.ts`).

### Code smells (judgment; paths)

| Smell | Where |
|---|---|
| **Mysterious Name** | `FEElement`, `covering_hash`, “OCC”, “Kiwi” used for a private codec (`src/store/flatStore.ts`, `src/server/claimRegistry.ts`, `src/compiler/figmaParser.ts`). |
| **Duplicated Code** | `project_glob` ≡ `local_glob`; `project_grep` ≡ `local_grep` (`src/server/mcpTools.ts`). Handle geometry duplicated in `companionGeometry` (`src/client/geometry.ts`) vs `SelectionManager.updateResize` (`src/client/selection.ts`). Guide SVG in `src/client/canvas/overlay.ts` vs `src/client/snappingOverlay.ts`. `lib/client.js` vs `src/client/`. Homegrown `ASTParser` (`src/compiler/astParser.ts`) vs Babel in `sourceEdit.ts` — parser is **never imported** elsewhere. |
| **Feature Envy / Divergent Change** | `dispatchMCPTool` (~530-line `switch`) owns FS, store, claims, theme stubs, skills (`src/server/mcpTools.ts`). `figmaParser.ts` is ~1290 lines of codec + mapping + JSX print. |
| **Primitive Obsession** | MCP `args: Record<string, any>` throughout; 16-hex SHA slice as OCC token. |
| **Repeated Switches** | MCP dispatcher; `StylesPanelManager.applyPropertyChange` (`src/client/stylesPanel.ts`); Tailwind category if-chain (justified). |
| **Shotgun Surgery** | New “official” tool = catalog entry + switch arm + docs/02 + tests. Client change = `.ts` **and** `lib/client.js`. |
| **Speculative Generality** | 38 named tools; unused `ASTParser`; `capture` type with no pipeline; `port` unused; `autoApprove` unused; `canvas_query` “CSS selector” is tag/id equality. |
| **Message Chains** | `CanvasPanel.moveSelected` → `controller.updateDrag` → `selection.moveSelection` → `compute6LineSnapping`. |
| **Middle Man** | `src/client/canvas.ts` re-exports `./canvas/index.ts`. |
| **Refused Bequest** | N/A (no meaningful inheritance beyond stub `Service`). |
| **Data Clumps** | `Rect { left, top, width, height }` is a reasonable clump. |

### Worst issue (Standards)

**Unscoped MCP filesystem tools** in `src/server/mcpTools.ts`: no root jail, no approval gate, `autoApprove` dead. Do not mount `executeTool` on an Agent until this is confined. (No fix in this PR.)

---

## Spec

Compare README + `docs/01`–`08` to `src/`. Verdict tags: **real** / **partial** / **stub** / **missing** / **docs-only (RE)**.

### Product claims vs `src/`

| Claim | Source | In `src/` | Verdict |
|---|---|---|---|
| Zero Handoff: live React 19 DOM canvas | README, `docs/01`, `docs/08` | No `react` / `react-dom` / `next` in `package.json`. `ComponentSandbox` emits HTML strings (`src/client/sandbox.ts`). | **missing** |
| Tier 1 deterministic AST slice | README, `docs/03` | `updateSourceCodeDeterministically` via `@babel/parser` + traverse (`src/compiler/sourceEdit.ts`) | **real** (library, not wired to a live inspector) |
| Tier 2 AI merge / `claudeMerge.ts` | `docs/03`, `docs/08` | `applySurgicalEdits` + `AIGateway` (`src/compiler/aiMerge.ts`, `src/server/aiGateway.ts`). Default `mockMode` when no API key. | **partial** |
| DSH Cordis plugin | README, `docs/08` | Local stub `src/server/cordis.ts` | **stub** |
| HTTP MCP on `127.0.0.1:21209`, protocol `2024-11-05` | `docs/01`, `docs/02` | No server | **missing** (port stored only) |
| **38 MCP tools** | README, `docs/02`, `docs/08` | 38 names in `OPEN_DESIGNER_TOOLS`; dispatcher has a case for each | **partial / mostly stub** — see table below |
| Claim locks + screenshot-before-release | `docs/02` | In-memory `ClaimRegistry` is real; screenshot is fake PNG | **partial** (OCC real; critique **stub**) |
| `.designer/canvas.json` local store | `docs/04`, `docs/08` | Atomic tmp+rename (`src/server/index.ts`) | **real** |
| `ensureV2.ts` / cloud backend replacement | `docs/04` | `flatStore.ts` implements the *idea*, not a port of named official files | **partial** (independent-ish data structure) |
| 6-line snap, 8-handle companion resize | `docs/05` | `src/client/snapping.ts`, `geometry.ts`, `selection.ts` | **real** (pure functions + string SVG, not a DOM app) |
| Flex/Grid flow reorder (`flowLayoutChildren.ts`, `reorderSelection.ts`) | `docs/05` | Absent | **missing** |
| Figma Kiwi clipboard (`application/x-figma-schema-kiwi`) | `docs/06`, README | Custom `KiwiReader` looking for ASCII `"figma"`/`"kiwi"`; pack/unpack **this** layout (`src/compiler/figmaParser.ts`) | **stub / mislabeled** — not Figma’s protocol |
| next-shims + Vite/esm.sh sandbox | `docs/07` | Four stubs: `image.ts`, `link.ts`, `navigation.ts`, `font.ts`. No `dynamic`, no import maps, no iframe compiler | **partial stubs** |
| Multi-model: DeepSeek-V3/R1, GPT-4o, Ollama, custom | README, `docs/08` | Provider URL table + fetch client; R1 skips `tools` | **partial** (plumbing real; no shipped UX; mock by default) |
| `preview.html` / screenshot as product demo | commit `75aa86f` | Static HTML; header **hard-codes** “MCP Server: Online (38 Tools)” | **marketing mock** |
| `docs/08` phase checkboxes | still mostly `[ ]` except “docs written” | Later commits claim Phases 1–3 “complete” | **stale spec** |

### “38 MCP tools” honesty

Catalog: `src/server/mcpTools.ts` `OPEN_DESIGNER_TOOLS`. Behavior is the `switch` in `dispatchMCPTool`.

| Group | Honest status |
|---|---|
| `project_list` | Always one synthetic project (`id: "default"`). |
| `project_pick` | **Stub:** `{ success: true }` — no session. |
| `project_read` / `write` / `edit` / `delete` / `copy_asset` / `glob` / `grep` / `write_batch` | **Real I/O**, naive glob (`*` → `.*`), **no root jail**. |
| `local_*` (7) | **Wrong vs spec:** same as project tools, not host-whitelist FS. |
| `scan_project` | Reads `package.json` keys only — not component inventory. |
| `canvas_list` / `canvas_create_page` / `canvas_read` / `canvas_add` / `canvas_grep` | **Partial:** in-memory FlatStore. `canvas_add` takes `tag`/`props`, **not** documented `jsx`. |
| `canvas_claim` / `release` / `update` / `edit` / `delete` | **Partial:** lock checks work; edits are prop/text string replace, not JSX surgery. |
| `canvas_insert` | **Broken vs its own schema:** parameters list top-level `tag`/`props`; handler reads `args.element`. Callers using the catalog get empty `div`s. No test. |
| `canvas_query` | Tag or id equality, not CSS. |
| `canvas_create_import_scaffold` | Inserts a 3-node dummy page. |
| `get_theme` | **Stub:** hardcoded hex palette — does not read `globals.css`. |
| `get_design_context` / `search_components` | Thin wrappers over stubs + tag-name search. |
| `search_icons` | Hardcoded 10 names. |
| `set_icon_library` | `{ success: true }` — no persistence. |
| `take_screenshot` | **Stub:** 1×1 PNG + marks claim verified. |
| `list_skills` / `read_skill` | **Stub** returning **`lunagraph-*` names** and a one-line markdown. |

Counting **catalog entries** = 38 is true. Counting **product-grade tools** is not.

### Marketing vs shipped (named items)

- **“38 MCP tools”** — catalog **real**; HTTP MCP **missing**; many cases **stub**.  
- **Figma Kiwi** — **not** Figma Kiwi. Self-protocol + JSON/HTML fallback. Tests never feed real clipboard bytes.  
- **next-shims** — **stub objects** `{ type, props }`, not Next module resolution.  
- **Multi-model gateway** — **partial** HTTP client; default mock; not a product gateway.  
- **OCC locks** — **real** in-process maps + hash check; TTL exists (lightly tested); visual OCC is **fake**.

Scope creep vs `docs/08` MVP: extra surface area (hand-rolled parser, packer, preview mock, 38-tool catalog) without the missing runtime spine (host, HTTP, React, confinement).

### IP / compliance note (required)

README § “深度逆向技术全书” states the `docs/` tree was built from **complete reverse-engineering of Lunagraph’s client and compiler**. `docs/01`–`07` describe another vendor’s process layout, MCP tool list, lock state machine, clipboard pipeline, and renderer shims, including **internal file names** and a code block in `docs/03` labeled as coming from that product’s compiler. `src/server/mcpTools.ts` still exposes skill ids `lunagraph-design`, `lunagraph-import-from-project`, `lunagraph-compositions`. `package.json` is MIT.

This review **does not quote, extract, or extend** that material.

**Risk of shipping this in a public repo**

- Documentation that encodes a commercial app’s unpublished protocol, ports, tool schemas, and (claimed) source excerpts is not “inspiration.” It is a **derivative description** of proprietary software. MIT does not wash that.
- Code that **reimplements** those tool names/lock rules/skill ids, even if written from the docs rather than copied binaries, still tracks the RE spec. A rights holder can argue trade secret, ToS, and copyright in non-literal structure.
- Continuing to “complete the 38 tools” or improve Kiwi fidelity **from these docs** increases exposure. Clone-fidelity work is exactly the wrong next step.

**Clean-room next steps (recommended)**

1. **Stop expanding** `docs/01`–`07` and do not paste more vendor internals. Treat them as tainted design notes; legal can decide whether they stay private, get replaced, or get removed.
2. Write a **new independent spec** from public facts only (MCP as a generic pattern, React/Tailwind editing as a generic problem, DSH’s *public* plugin API). New names for tools/skills — not `lunagraph-*`, not vendor filenames.
3. Keep **original** algorithms that do not require the vendor protocol (FlatStore, snap math, Babel className slice) only after counsel agrees they are independent. When in doubt, rewrite from the new spec.
4. **Do not** unpack, decompile, or further document Lunagraph or any other commercial app. Do not use remaining RE notes as an implementation checklist.
5. Add a real `LICENSE` **after** the IP posture is decided; MIT-on-tainted-docs is the worst combination.
6. Until filesystem tools are jailed, do not advertise this as a DSH plugin other people should mount.

This is not legal advice; it is an engineering risk call for a public repo.

### Worst issue (Spec)

**Honest-product + IP:** the public story is “open Lunagraph-class designer with 38 MCP tools and Figma Kiwi.” The tree is a **partial library plus RE-derived docs**. The compliance problem (shipping proprietary-derived protocol documentation and names under MIT) outranks any missing feature.

---

## Commit map (all of `main`)

| SHA | Message vs tree |
|---|---|
| `88f7f49` | RE docs `docs/01`–`08` + first architecture. Origin of IP surface. |
| `95c05ac` | Core library + tests; claims Phases 1–3 complete. `docs/08` checkboxes not updated. |
| `349a8df` | Tailwind categories, column targeting, OCC hash check — real fixes. |
| `b9b8a8c` | “Full-featured DSH-native” — Cordis stub, 38-name dispatcher, hand-rolled client JS. Over-claim. |
| `2af8a91` | “Figma Kiwi + DeepSeek gateway + viewport” — private codec + fetch client + panel classes. |
| `9330784` | Packer/unpacker and snap-back fixes on **that** codec, not Figma. |
| `75aa86f` | `preview.html` + PNG — demo mock, not the engine. |
