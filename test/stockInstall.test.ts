import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const root = path.resolve(process.cwd());

describe("stock DSH github: install contract", () => {
  it("declares dsh.bundle.patch and ships compiled Host entry without prepare", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      main?: string;
      scripts?: Record<string, string>;
      files?: string[];
      dsh?: { bundle?: { patch?: string } };
    };
    assert.equal(pkg.dsh?.bundle?.patch, "./cordis.patch.yml");
    assert.equal(pkg.main, "./dist/plugin.js");
    assert.equal(pkg.scripts?.prepare, undefined);
    assert.ok(pkg.files?.includes("dist"));
    assert.ok(pkg.files?.includes("lib/client.js"));
    assert.ok(pkg.files?.includes("cordis.patch.yml"));

    const patch = readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
    assert.match(patch, /id:\s*dsh-opendesigner/);
    assert.match(patch, /name:\s*dsh-opendesigner/);
    assert.doesNotMatch(patch, /\/Users\//);

    assert.equal(existsSync(path.join(root, "dist/plugin.js")), true);
    assert.equal(existsSync(path.join(root, "lib/client.js")), true);
    const plugin = readFileSync(path.join(root, "dist/plugin.js"), "utf8");
    assert.match(plugin, /export function apply\b/);
    assert.match(plugin, /export const name = "dsh-opendesigner"/);
    assert.match(plugin, /export const inject = \["tools"\]/);
  });

  it("README leads with the stock dsh plugin add command", () => {
    const readme = readFileSync(path.join(root, "README.md"), "utf8");
    const lead = readme.slice(0, readme.indexOf("\n## "));
    assert.match(
      lead,
      /^# dsh-opendesigner\n\n```sh\ndsh plugin --profile web add github:aa2246740\/dsh-opendesigner\n```/
    );
    assert.match(lead, /pnpm/);
    assert.match(lead, /重启这个 Host/);
    assert.match(lead, /刷新页面/);
    assert.doesNotMatch(readme, /dshx|DSHX_HARNESS|my-plugins/i);
    assert.doesNotMatch(readme, /add "\$\(pwd\)"/);
  });
});
