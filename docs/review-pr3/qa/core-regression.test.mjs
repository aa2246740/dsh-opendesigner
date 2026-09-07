import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { git, initGitRepo, loadSrc, makeTempDir, writeAndCommit, el } from "./helpers.mjs";

const { PathJailError, resolveProjectPath } = await loadSrc("server/pathJail.ts");
const { AgentBatchRegistry, BatchError } = await loadSrc("server/agentBatch.ts");
const { CheckpointLog } = await loadSrc("server/checkpoints.ts");
const { FlatStore } = await loadSrc("store/flatStore.ts");
const { OpenDesignerService } = await loadSrc("server/index.ts");

async function registry(root) {
  const file = path.join(root, ".designer", "batches.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const batches = new AgentBatchRegistry(root, file);
  await batches.load();
  return batches;
}

describe("C01 in-project file access", () => {
  it("resolves in-root paths and rejects parent-directory escape", () => {
    const root = "/tmp/opendesigner-pr3-jail";
    const resolved = resolveProjectPath(root, "src/button.tsx");
    assert.equal(resolved, path.resolve(root, "src/button.tsx"));
    assert.throws(() => resolveProjectPath(root, "../secrets.txt"), PathJailError);
    assert.throws(() => resolveProjectPath(root, "foo/../../etc/passwd"), PathJailError);
  });
});

describe("C02 existing external symlink rejected", () => {
  it("cannot expose files outside the project root through a symlink", async () => {
    const tmp = await makeTempDir("pr3-c02-");
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

describe("C03 dirty worktree create fails DIRTY_WORKTREE", () => {
  it("rejects batch create when the project has uncommitted files", async () => {
    const root = await makeTempDir("pr3-c03-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "export const n = 1;\n", "app");
    await fs.writeFile(path.join(root, "src/app.tsx"), "export const n = dirty;\n");

    const batches = await registry(root);
    await assert.rejects(() => batches.create("dirty"), (err) => {
      assert.ok(err instanceof BatchError);
      assert.match(err.code, /DIRTY/);
      return true;
    });
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("C04 text edit conflict protects main", () => {
  it("must not silently overwrite a concurrent user edit", async () => {
    const root = await makeTempDir("pr3-c04-");
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

describe("C05 committed Agent worktree changes apply", () => {
  it("must not disappear on apply", async () => {
    const root = await makeTempDir("pr3-c05-");
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

describe("C06 Chinese rename removes old + keeps new", () => {
  it("applies a staged rename of a Chinese filename", async () => {
    const root = await makeTempDir("pr3-c06-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/旧名.tsx", "same\n", "old");

    const batches = await registry(root);
    const created = await batches.create("rename");
    const worktree = path.join(root, created.worktreeRelPath);
    await git(worktree, ["mv", "src/旧名.tsx", "src/新名.tsx"]);

    const applied = await batches.apply(created.batchId);
    assert.ok(applied.copied.includes("src/新名.tsx"));
    assert.ok(applied.deleted.includes("src/旧名.tsx"));
    assert.equal(await fs.readFile(path.join(root, "src/新名.tsx"), "utf8"), "same\n");
    await assert.rejects(() => fs.readFile(path.join(root, "src/旧名.tsx")));
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("C07 caught later-file failure rolls back earlier write", () => {
  it("failure on a later file must not leave an earlier file overwritten", async () => {
    const root = await makeTempDir("pr3-c07-");
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

describe("C08 checkpoints isolate inputs and rewind return values", () => {
  it("mutating live nodes or rewind payloads must not change stored checkpoints", async () => {
    const dir = await makeTempDir("pr3-c08-");
    const log = new CheckpointLog(path.join(dir, "checkpoints.json"));
    const store = new FlatStore();
    store.setElement(el("hero", { props: { className: "bg-slate-900" } }));

    await log.push({
      label: "seed",
      kind: "canvas",
      store: store.toJSON()
    });

    store.setElement(el("hero", { props: { className: "bg-emerald-600" } }));
    await log.push({
      label: "fill",
      kind: "canvas",
      store: store.toJSON()
    });

    const live = store.getElement("hero");
    live.props.className = "bg-rose-600";
    store.setElement(live);
    assert.equal(log.entries[0].store.byId.hero.props.className, "bg-slate-900");
    assert.equal(log.entries[1].store.byId.hero.props.className, "bg-emerald-600");

    const restored = await log.rewind();
    restored.store.byId.hero.props.className = "mutated-return";
    assert.equal(log.entries[log.cursor].store.byId.hero.props.className, "bg-slate-900");

    const payload = {
      byId: { hero: el("hero", { props: { className: "rounded-xl" } }) },
      childrenByParent: {},
      parentByChild: {},
      pages: [{ id: "p1", name: "Home", isLoaded: true, rootElementId: "hero" }],
      activePageId: "p1"
    };
    const isolated = new FlatStore();
    isolated.fromJSON(payload);
    payload.byId.hero.props.className = "rounded-none";
    assert.equal(isolated.getElement("hero").props.className, "rounded-xl");

    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("N01 dangling external symlink must not create a file outside the project", () => {
  it("lstat-denies a dangling symlink and never materializes the outside target", async () => {
    const tmp = await makeTempDir("pr3-n01-");
    const root = path.join(tmp, "project");
    const outside = path.join(tmp, "outside");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(outside);
    const leakTarget = path.join(outside, "created-by-jail-bug.txt");
    await fs.symlink(leakTarget, path.join(root, "leak"));

    assert.throws(() => resolveProjectPath(root, "leak"), (err) => {
      assert.ok(err instanceof PathJailError);
      return true;
    });

    const service = new OpenDesignerService({ projectRoot: root, autoApprove: true });
    const written = await service.executeTool("project_write", {
      path: "leak",
      content: "pwned\n"
    });
    assert.equal(written.success, false);
    assert.equal(written.code, "PATH_JAIL");

    const exists = await fs.stat(leakTarget).then(() => true).catch(() => false);
    assert.equal(exists, false);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe("N02 concurrent user deletion vs Agent modify", () => {
  it("returns BATCH_CONFLICT and keeps the file deleted", async () => {
    const root = await makeTempDir("pr3-n02-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/keep.tsx", "base-keep\n", "keep");

    const batches = await registry(root);
    const created = await batches.create("delete-vs-modify");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/keep.tsx"), "agent-keep\n");
    await fs.rm(path.join(root, "src/keep.tsx"));

    await assert.rejects(() => batches.apply(created.batchId), (err) => {
      assert.ok(err instanceof BatchError);
      assert.equal(err.code, "BATCH_CONFLICT");
      return true;
    });

    await assert.rejects(() => fs.readFile(path.join(root, "src/keep.tsx")));
    assert.equal(await fs.readFile(path.join(worktree, "src/keep.tsx"), "utf8"), "agent-keep\n");
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("N03 binary conflict compares bytes", () => {
  it("base 80 00 / user 81 00 / agent 82 00 is BATCH_CONFLICT and keeps user bytes", async () => {
    const root = await makeTempDir("pr3-n03-");
    await initGitRepo(root);
    const rel = "src/blob.bin";
    await writeAndCommit(root, rel, Buffer.from([0x80, 0x00]), "base-bin");

    const batches = await registry(root);
    const created = await batches.create("binary");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, rel), Buffer.from([0x82, 0x00]));
    await fs.writeFile(path.join(root, rel), Buffer.from([0x81, 0x00]));

    await assert.rejects(() => batches.apply(created.batchId), (err) => {
      assert.ok(err instanceof BatchError);
      assert.equal(err.code, "BATCH_CONFLICT");
      return true;
    });

    const kept = await fs.readFile(path.join(root, rel));
    assert.deepEqual([...kept], [0x81, 0x00]);
    await fs.rm(root, { recursive: true, force: true });
  });
});
