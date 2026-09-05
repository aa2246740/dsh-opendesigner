import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "src/client/index.ts")],
  outfile: path.join(root, "lib/client.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true
});

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "src/client/previewApp.ts")],
  outfile: path.join(root, "preview/app.js"),
  bundle: true,
  format: "iife",
  globalName: "OpenDesignerPreview",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true
});

fs.mkdirSync(path.join(root, "lib"), { recursive: true });
console.log("bundled lib/client.js and preview/app.js");
