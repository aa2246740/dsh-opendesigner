> **Status.** This file is the current rewrite target. Historical phase checkboxes below the fold in earlier revisions over-claimed. See [SHIPPED.md](./SHIPPED.md).

# OpenDesigner on DeepSeek Harness

## Why DSH

DeepSeek Harness loads capabilities as Cordis plugins. OpenDesigner is one of those plugins. The harness source stays untouched.

## Shape that ships

```
DSH host (unmodified)
  └─ dsh plugin add ./dsh-opendesigner
       └─ cordis.patch.yml inserts id dsh-opendesigner
            └─ src/plugin.ts apply(ctx)
                 ├─ OpenDesignerService (jailed tools, canvas store, AI gateway)
                 └─ ctx.tools.register(opendesigner_*)

Preview (documented designer surface)
  npm run preview → preview.html + CanvasPanel
```

## Host entry

Function form, named exports only:

- `name = "dsh-opendesigner"`
- `inject = ["tools"]`
- `apply(ctx, config)`

`config.autoApprove` defaults to `false`. `autoApprove: true` skips the destructive prompt. It does not allow `..` or absolute paths.

## Client

`lib/client.js` is generated from `src/client` by `npm run build`. Do not edit `lib/client.js` by hand.

## Out of scope

Lunagraph 1:1 parity, asar work, PPT/openkimi-slides, Figma proprietary clipboard.
