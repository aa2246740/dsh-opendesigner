import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadSrc, makeTempDir } from "./helpers.mjs";

const { PathJailError, resolveProjectPath } = await loadSrc("server/pathJail.ts");

describe("CONTROL pathJail", () => {
  it("rejects parent-directory escape and resolves in-root paths", () => {
    const root = "/tmp/opendesigner-review-jail";
    const resolved = resolveProjectPath(root, "src/button.tsx");
    assert.equal(resolved, path.resolve(root, "src/button.tsx"));
    assert.throws(() => resolveProjectPath(root, "../secrets.txt"), PathJailError);
    assert.throws(() => resolveProjectPath(root, "foo/../../etc/passwd"), PathJailError);
  });
});

describe("R01 symlink realpath jail", () => {
  it("cannot expose files outside the project root through a symlink", async () => {
    const tmp = await makeTempDir("od-r01-");
    const root = path.join(tmp, "project");
    const outside = path.join(tmp, "outside");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(outside);
    const secretPath = path.join(outside, "secret.txt");
    await fs.writeFile(secretPath, "classified\n");
    await fs.symlink(outside, path.join(root, "escape"));

    assert.throws(() => resolveProjectPath(root, "escape/secret.txt"), PathJailError);
    assert.throws(() => resolveProjectPath(root, "escape"), PathJailError);

    const inside = resolveProjectPath(root, "src/ok.tsx");
    assert.equal(inside, path.resolve(root, "src/ok.tsx"));

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
