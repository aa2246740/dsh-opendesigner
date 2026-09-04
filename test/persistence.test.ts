import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OpenDesignerService } from "../src/server/index.ts";
import { atomicWriteFile } from "../src/server/atomicWrite.ts";
import { catalogApprovalMode, persistApprovalMode } from "../src/server/approval.ts";
import { OPEN_DESIGNER_TOOLS } from "../src/server/mcpTools.ts";
import * as os from "node:os";
import { git } from "../src/server/gitExec.ts";

const ROOT = path.resolve(process.cwd(), "test-fixtures/persistence");

async function emptyDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function initGitRepo(dir: string): Promise<void> {
  await emptyDir(dir);
  await git(dir, ["init", "-b", "main"]);
  await git(dir, [
    "-c",
    "user.email=od@test",
    "-c",
    "user.name=OpenDesigner",
    "commit",
    "--allow-empty",
    "-m",
    "init"
  ]);
}

describe("Persistence - approval policy", () => {
  it("auto-allows canvas style/geometry tools and gates source writes", () => {
    const canvasUpdate = OPEN_DESIGNER_TOOLS.find((tool) => tool.name === "canvas_update");
    const projectWrite = OPEN_DESIGNER_TOOLS.find((tool) => tool.name === "project_write");
    assert.equal(catalogApprovalMode(canvasUpdate!), "auto");
    assert.equal(catalogApprovalMode(projectWrite!), "gated");
    assert.equal(persistApprovalMode("checkpoint"), "auto");
    assert.equal(persistApprovalMode("rewind"), "auto");
    assert.equal(persistApprovalMode("autosave"), "auto");
    assert.equal(persistApprovalMode("apply_to_project"), "gated");
    assert.equal(persistApprovalMode("batch_create"), "auto");
    assert.equal(persistApprovalMode("batch_discard"), "auto");
    assert.equal(persistApprovalMode("batch_apply"), "gated");
  });
});

describe("Persistence - checkpoints, autosave, apply", () => {
  const dir = path.join(ROOT, "session");

  before(async () => {
    await emptyDir(dir);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rewinds canvas and session source without creating a worktree", async () => {
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();

    service.store.setElement({
      id: "hero",
      type: "element",
      tag: "div",
      props: { className: "bg-slate-900" }
    });
    const seed = await service.executeTool("checkpoint", { label: "seed" });
    const seedId = seed.checkpoint.id as string;

    service.store.setElement({
      id: "hero",
      type: "element",
      tag: "div",
      props: { className: "bg-emerald-600" }
    });
    await service.executeTool("checkpoint", { label: "fill" });

    const write = await service.executeTool("project_write", {
      path: "src/button.tsx",
      content: "export const n = 1;\n"
    });
    assert.equal(write.success, true);

    const overwrite = await service.executeTool("project_write", {
      path: "src/button.tsx",
      content: "export const n = 2;\n"
    });
    assert.equal(overwrite.success, true);

    const rewindFill = await service.executeTool("rewind");
    assert.equal(rewindFill.success, true);
    const afterSourceRewind = await fs.readFile(path.join(dir, "src/button.tsx"), "utf-8");
    assert.equal(afterSourceRewind, "export const n = 1;\n");

    const rewindCanvas = await service.executeTool("rewind", { checkpointId: seedId });
    assert.equal(rewindCanvas.success, true);
    assert.equal(service.store.getElement("hero")?.props.className, "bg-slate-900");

    const worktrees = path.join(dir, ".designer/worktrees");
    const worktreeExists = await fs.stat(worktrees).then(() => true).catch(() => false);
    assert.equal(worktreeExists, false);
    assert.equal(rewindCanvas.worktreeCreated, false);
  });

  it("writes working copy atomically and never git-commits", async () => {
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    service.store.setElement({
      id: "atom",
      type: "element",
      tag: "span",
      props: { className: "text-white" }
    });
    await service.executeTool("autosave");

    const designer = path.join(dir, ".designer");
    const names = await fs.readdir(designer);
    assert.equal(names.some((name) => name.endsWith(".tmp")), false);

    const canvasPath = path.join(designer, "canvas.json");
    const parsed = JSON.parse(await fs.readFile(canvasPath, "utf-8"));
    assert.equal(parsed.byId.atom.tag, "span");
    assert.equal(typeof parsed.savedAt, "string");

    const first = `${"x".repeat(8000)}\n`;
    const second = `${"y".repeat(200)}\n`;
    await atomicWriteFile(canvasPath, first);
    await atomicWriteFile(canvasPath, second);
    assert.equal(await fs.readFile(canvasPath, "utf-8"), second);

    const autosave = await service.executeTool("autosave");
    assert.equal(autosave.gitCommit, false);
  });

  it("gates apply_to_project and still keeps the path jail under autoApprove", async () => {
    const gated = new OpenDesignerService({ projectRoot: dir, autoApprove: false });
    const denied = await gated.executeTool("apply_to_project");
    assert.equal(denied.success, false);
    assert.equal(denied.code, "APPROVAL_REQUIRED");

    const approved = await gated.executeTool("apply_to_project", { approve: true });
    assert.equal(approved.success, true);
    assert.equal(approved.gitCommit, false);
    const stamp = JSON.parse(await fs.readFile(path.join(dir, ".designer/applied.json"), "utf-8"));
    assert.equal(stamp.gitCommit, false);

    const auto = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    const escaped = await auto.executeTool("project_read", { path: "/etc/passwd" });
    assert.equal(escaped.success, false);
    assert.equal(escaped.code, "PATH_JAIL");
    const batchJail = await auto.executeTool("project_write", {
      path: "../outside.tsx",
      content: "nope"
    });
    assert.equal(batchJail.success, false);
    assert.equal(batchJail.code, "PATH_JAIL");
  });
});

describe("Persistence - agent batch worktrees", () => {
  const gitDir = path.join(ROOT, "git-batch");
  const nonGitDir = path.join(os.tmpdir(), `od-nongit-batch-${process.pid}`);

  after(async () => {
    await fs.rm(gitDir, { recursive: true, force: true });
    await fs.rm(nonGitDir, { recursive: true, force: true });
  });

  it("returns GIT_REQUIRED when the project is not a git repo", async () => {
    await emptyDir(nonGitDir);
    const service = new OpenDesignerService({ projectRoot: nonGitDir, autoApprove: true });
    const created = await service.executeTool("batch_create", { label: "no-git" });
    assert.equal(created.success, false);
    assert.equal(created.code, "GIT_REQUIRED");
    const stillWorks = await service.executeTool("checkpoint", { label: "nongit-canvas" });
    assert.equal(stillWorks.success, true);
  });

  it("does not attach a worktree to a parent git repo", async () => {
    const nested = path.join(ROOT, "nested-not-root");
    await emptyDir(nested);
    const service = new OpenDesignerService({ projectRoot: nested, autoApprove: true });
    const created = await service.executeTool("batch_create", { label: "parent-git" });
    assert.equal(created.success, false);
    assert.equal(created.code, "GIT_REQUIRED");
  });

  it("creates, discards, and applies a jailed worktree without committing", async () => {
    await initGitRepo(gitDir);
    const service = new OpenDesignerService({ projectRoot: gitDir, autoApprove: false });
    await service.init();

    const created = await service.executeTool("batch_create", { label: "demo" });
    assert.equal(created.success, true);
    assert.equal(created.isolation, "worktree");
    const batchId = created.batchId as string;
    const worktreeAbs = path.join(gitDir, created.worktreeRelPath as string);
    assert.equal(worktreeAbs.startsWith(path.join(gitDir, ".designer/worktrees")), true);

    const write = await service.executeTool("project_write", {
      path: "src/agent-batch-demo.txt",
      content: "from-worktree\n",
      approve: true
    });
    assert.equal(write.success, true);
    const inWorktree = await fs.readFile(path.join(worktreeAbs, "src/agent-batch-demo.txt"), "utf-8");
    assert.equal(inWorktree, "from-worktree\n");
    const mainMissing = await fs
      .readFile(path.join(gitDir, "src/agent-batch-demo.txt"), "utf-8")
      .then(() => true)
      .catch(() => false);
    assert.equal(mainMissing, false);

    const gatedApply = await service.executeTool("batch_apply", { batchId });
    assert.equal(gatedApply.success, false);
    assert.equal(gatedApply.code, "APPROVAL_REQUIRED");

    const discarded = await service.executeTool("batch_discard", { batchId });
    assert.equal(discarded.success, true);
    const afterDiscard = await fs.stat(worktreeAbs).then(() => true).catch(() => false);
    assert.equal(afterDiscard, false);
    const stillMissing = await fs
      .readFile(path.join(gitDir, "src/agent-batch-demo.txt"), "utf-8")
      .then(() => true)
      .catch(() => false);
    assert.equal(stillMissing, false);

    const created2 = await service.executeTool("batch_create", { label: "apply-demo" });
    assert.equal(created2.success, true);
    const batchId2 = created2.batchId as string;
    const write2 = await service.executeTool("project_write", {
      path: "src/agent-batch-demo.txt",
      content: "applied\n",
      approve: true
    });
    assert.equal(write2.success, true);

    const applied = await service.executeTool("batch_apply", { batchId: batchId2, approve: true });
    assert.equal(applied.success, true);
    assert.ok(applied.copied.includes("src/agent-batch-demo.txt"));
    const mainCopy = await fs.readFile(path.join(gitDir, "src/agent-batch-demo.txt"), "utf-8");
    assert.equal(mainCopy, "applied\n");

    const { stdout: log } = await git(gitDir, ["log", "--oneline"]);
    assert.equal(log.trim().split("\n").length, 1);
  });
});
