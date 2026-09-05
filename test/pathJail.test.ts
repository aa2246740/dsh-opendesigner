import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { PathJailError, resolveProjectPath } from "../src/server/pathJail.ts";

const ROOT = "/tmp/opendesigner-jail-root";

describe("Path jail", () => {
  it("allows relative files inside the project root", () => {
    const resolved = resolveProjectPath(ROOT, "src/button.tsx");
    assert.equal(resolved, path.resolve(ROOT, "src/button.tsx"));
  });

  it("rejects absolute paths even when they point inside the root", () => {
    assert.throws(() => resolveProjectPath(ROOT, path.join(ROOT, "src/button.tsx")), PathJailError);
  });

  it("rejects parent-directory escape", () => {
    assert.throws(() => resolveProjectPath(ROOT, "../secrets.txt"), PathJailError);
    assert.throws(() => resolveProjectPath(ROOT, "foo/../../etc/passwd"), PathJailError);
  });

  it("rejects empty and null-byte paths", () => {
    assert.throws(() => resolveProjectPath(ROOT, ""), PathJailError);
    assert.throws(() => resolveProjectPath(ROOT, "foo\0bar"), PathJailError);
  });
});
