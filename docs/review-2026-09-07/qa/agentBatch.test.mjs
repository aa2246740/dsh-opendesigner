import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { git, initGitRepo, loadSrc, makeTempDir, writeAndCommit } from "./helpers.mjs";

const { AgentBatchRegistry, BatchError } = await loadSrc("server/agentBatch.ts");

async function registry(root) {
  const file = path.join(root, ".designer", "batches.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const batches = new AgentBatchRegistry(root, file);
  await batches.load();
  return batches;
}

describe("CONTROL unchanged-root uncommitted batch file", () => {
  let root;
  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("applies a new file when the main tree is clean", async () => {
    root = await makeTempDir("od-ctrl-batch-");
    await initGitRepo(root);
    const batches = await registry(root);
    const created = await batches.create("control");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.mkdir(path.join(worktree, "src"), { recursive: true });
    await fs.writeFile(path.join(worktree, "src/agent-batch-demo.txt"), "from-worktree\n");

    const applied = await batches.apply(created.batchId);
    assert.ok(applied.copied.includes("src/agent-batch-demo.txt"));
    assert.equal(await fs.readFile(path.join(root, "src/agent-batch-demo.txt"), "utf8"), "from-worktree\n");
  });
});

describe("R08 dirty project", () => {
  it("includes dirty files in the batch base or rejects creation", async () => {
    const root = await makeTempDir("od-r08-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "export const n = 1;\n", "app");
    await fs.writeFile(path.join(root, "src/app.tsx"), "export const n = dirty;\n");

    const batches = await registry(root);
    let created;
    try {
      created = await batches.create("dirty");
    } catch (err) {
      assert.ok(err instanceof BatchError);
      assert.match(err.code, /DIRTY/);
      await fs.rm(root, { recursive: true, force: true });
      return;
    }

    const worktreeFile = path.join(root, created.worktreeRelPath, "src/app.tsx");
    const worktreeBytes = await fs.readFile(worktreeFile, "utf8");
    assert.equal(worktreeBytes, "export const n = dirty;\n");
    await batches.discard(created.batchId);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("R09 concurrent user modification", () => {
  it("must not silently overwrite a concurrent user edit", async () => {
    const root = await makeTempDir("od-r09-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "base\n", "base");

    const batches = await registry(root);
    const created = await batches.create("conflict");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/app.tsx"), "agent\n");
    await fs.writeFile(path.join(root, "src/app.tsx"), "user\n");

    await assert.rejects(() => batches.apply(created.batchId), (err) => {
      assert.ok(err instanceof BatchError);
      assert.match(err.code, /CONFLICT/);
      return true;
    });

    assert.equal(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "user\n");
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("R10 committed worktree changes", () => {
  it("must not disappear on apply", async () => {
    const root = await makeTempDir("od-r10-");
    await initGitRepo(root);
    const batches = await registry(root);
    const created = await batches.create("committed");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.mkdir(path.join(worktree, "src"), { recursive: true });
    await fs.writeFile(path.join(worktree, "src/from-agent.tsx"), "committed-in-worktree\n");
    await git(worktree, ["add", "src/from-agent.tsx"]);
    await git(worktree, [
      "-c",
      "user.email=od@test",
      "-c",
      "user.name=OpenDesigner",
      "commit",
      "-m",
      "agent commit"
    ]);

    const applied = await batches.apply(created.batchId);
    assert.ok(applied.copied.includes("src/from-agent.tsx"));
    assert.equal(await fs.readFile(path.join(root, "src/from-agent.tsx"), "utf8"), "committed-in-worktree\n");
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("R11 staged rename", () => {
  it("must remove the old filename", async () => {
    const root = await makeTempDir("od-r11-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/old-name.tsx", "same\n", "old");

    const batches = await registry(root);
    const created = await batches.create("rename");
    const worktree = path.join(root, created.worktreeRelPath);
    await git(worktree, ["mv", "src/old-name.tsx", "src/new-name.tsx"]);

    const applied = await batches.apply(created.batchId);
    assert.ok(applied.copied.includes("src/new-name.tsx"));
    assert.ok(applied.deleted.includes("src/old-name.tsx"));
    assert.equal(await fs.readFile(path.join(root, "src/new-name.tsx"), "utf8"), "same\n");
    await assert.rejects(() => fs.readFile(path.join(root, "src/old-name.tsx")));
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("R12 Chinese filename", () => {
  it("applies without treating Git quoting as JSON", async () => {
    const root = await makeTempDir("od-r12-");
    await initGitRepo(root);
    const batches = await registry(root);
    const created = await batches.create("zh");
    const worktree = path.join(root, created.worktreeRelPath);
    const rel = "src/按钮.tsx";
    await fs.mkdir(path.join(worktree, "src"), { recursive: true });
    await fs.writeFile(path.join(worktree, rel), "export const 标签 = 1;\n");

    const applied = await batches.apply(created.batchId);
    assert.ok(applied.copied.includes(rel));
    assert.equal(await fs.readFile(path.join(root, rel), "utf8"), "export const 标签 = 1;\n");
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("R17 atomic apply", () => {
  it("failure on a later file must not leave an earlier file overwritten", async () => {
    const root = await makeTempDir("od-r17-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/first.txt", "orig-first\n", "first");
    await writeAndCommit(root, "src/second.txt", "orig-second\n", "second");

    const batches = await registry(root);
    const created = await batches.create("atomic");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/first.txt"), "new-first\n");
    await fs.writeFile(path.join(worktree, "src/second.txt"), "new-second\n");

    await fs.rm(path.join(root, "src/second.txt"));
    await fs.mkdir(path.join(root, "src/second.txt"));

    await assert.rejects(() => batches.apply(created.batchId));
    assert.equal(await fs.readFile(path.join(root, "src/first.txt"), "utf8"), "orig-first\n");
    await fs.rm(root, { recursive: true, force: true });
  });
});
