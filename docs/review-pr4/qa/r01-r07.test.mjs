import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { initGitRepo, loadSrc, makeTempDir, writeAndCommit } from "../../review-pr3/qa/helpers.mjs";

const { AgentBatchRegistry, BatchError } = await loadSrc("server/agentBatch.ts");
const { ApplyJournal, ApplyJournalBlockedError } = await loadSrc("server/applyJournal.ts");
const { OpenDesignerService, RuntimeBusyError } = await loadSrc("server/index.ts");
const { hashFrozenChangeset } = await loadSrc("server/frozenChangeset.ts");
const { sliceEdits, applyBoundEdits, extractClassNameAt, parseIntent, applyIntentToClassName } = await loadSrc(
  "compiler/sourcePatch.ts"
);
const { writeFileNoFollow } = await loadSrc("server/fileBytes.ts");
const { SourceBaselineStore, readBaselinePresence } = await loadSrc("server/sourceBaseline.ts");

async function registry(root) {
  const file = path.join(root, ".designer", "batches.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const batches = new AgentBatchRegistry(root, file);
  await batches.load();
  return batches;
}

describe("R01 content-swap after approval is denied", () => {
  it("binds before/after byte hashes so a worktree swap invalidates the receipt", async () => {
    const root = await makeTempDir("pr4-r01-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "base\n", "base");
    const service = new OpenDesignerService({ projectRoot: root, autoApprove: false });
    await service.init();
    const created = await service.executeTool("batch_create", { label: "r01" });
    assert.equal(created.success, true);
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/app.tsx"), "approved-candidate\n");

    const applyArgs = { batchId: created.batchId };
    const issued = await service.issueHostReceipt("batch_apply", applyArgs);
    assert.equal(issued.success, true);
    const hashBefore = issued.diffHash;

    await fs.writeFile(path.join(worktree, "src/app.tsx"), "swapped-evil\n");
    const swapped = await service.batches.captureFrozen(created.batchId);
    assert.notEqual(hashFrozenChangeset(swapped), hashBefore);

    const applied = await service.executeTool("batch_apply", {
      ...applyArgs,
      approvalReceipt: issued.approvalReceipt
    });
    assert.equal(applied.success, false);
    assert.equal(applied.code, "DENIED");
    assert.equal(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "base\n");
    await service.stop();
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("R02 recovery must not overwrite a user repair", () => {
  it("blocks when a post-crash user edit matches neither before nor after hash", async () => {
    const dir = await makeTempDir("pr4-r02-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src/first.txt"), "orig-first\n");
    const journal = new ApplyJournal(dir, "testworkspace", path.join(dir, ".designer", "apply-journal.json"));
    const staging = journal.stagingDir("batch1");
    await fs.mkdir(path.join(staging, "src"), { recursive: true });
    await writeFileNoFollow(path.join(staging, "src/first.txt"), "orig-first\n");
    const { contentHash } = await loadSrc("server/fileBytes.ts");
    const beforeHash = contentHash(Buffer.from("orig-first\n"));
    const afterHash = contentHash(Buffer.from("agent-new\n"));
    const entry = await journal.begin("batch1", [
      { kind: "write", rel: "src/first.txt", beforeHash, afterHash }
    ]);
    await journal.recordBackup(entry, "src/first.txt", path.join(".designer", "apply-staging", "batch1", "src/first.txt"), {
      beforeHash,
      afterHash
    });
    await fs.writeFile(path.join(dir, "src/first.txt"), "user-repaired\n");
    await assert.rejects(() => journal.recover(), (err) => {
      assert.ok(err instanceof ApplyJournalBlockedError);
      assert.equal(err.code, "BATCH_RECOVERY_BLOCKED");
      return true;
    });
    assert.equal(await fs.readFile(path.join(dir, "src/first.txt"), "utf8"), "user-repaired\n");
    await fs.access(path.join(dir, ".designer", "apply-journal.json"));
    await fs.access(path.join(staging, "src/first.txt"));
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("R03 corrupt journal JSON is BATCH_RECOVERY_BLOCKED", () => {
  it("does not swallow corrupt JSON as a missing journal", async () => {
    const dir = await makeTempDir("pr4-r03-");
    const file = path.join(dir, ".designer", "apply-journal.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not-json");
    const journal = new ApplyJournal(dir, "ws", file);
    await assert.rejects(() => journal.recover(), (err) => {
      assert.ok(err instanceof ApplyJournalBlockedError);
      assert.equal(err.code, "BATCH_RECOVERY_BLOCKED");
      return true;
    });
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("R04 journal path escape is blocked", () => {
  it("does not write outside the project when rel contains parent segments", async () => {
    const tmp = await makeTempDir("pr4-r04-");
    const root = path.join(tmp, "project");
    const outside = path.join(tmp, "outside.txt");
    await fs.mkdir(root, { recursive: true });
    const file = path.join(root, ".designer", "apply-journal.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        workspaceId: "ws",
        batchId: "batch1",
        phase: "applying",
        planned: [{ kind: "write", rel: "../outside.txt" }],
        backups: [{ rel: "../outside.txt", backupRel: "../outside.txt" }],
        updatedAt: new Date().toISOString()
      })
    );
    const journal = new ApplyJournal(root, "ws", file);
    await assert.rejects(() => journal.recover(), (err) => {
      assert.equal(err.code, "BATCH_RECOVERY_BLOCKED");
      return true;
    });
    const leaked = await fs.stat(outside).then(() => true).catch(() => false);
    assert.equal(leaked, false);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe("R05 mid-apply user edit is preserved", () => {
  it("re-checks expected-before at write time after preflight", async () => {
    const root = await makeTempDir("pr4-r05-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "base\n", "base");
    const batches = await registry(root);
    const created = await batches.create("r05");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/app.tsx"), "agent\n");
    const frozen = await batches.prepareApply(created.batchId);
    await fs.writeFile(path.join(root, "src/app.tsx"), "user-mid-apply\n");
    await assert.rejects(() => batches.commitPrepared(frozen), (err) => {
      assert.ok(err instanceof BatchError);
      assert.equal(err.code, "BATCH_CONFLICT");
      return true;
    });
    assert.equal(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "user-mid-apply\n");
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("R06 sliceEdits roundtrip", () => {
  it("apply(before, sliceEdits(before, after)) === after for a long label plus shadow-lg", () => {
    const suffix = "\n".repeat(40) + "export function Extra() { return <span>tail</span>; }\n";
    const before = `export default function App() {\n  return <button className="px-4 bg-indigo-600">Pay now with a very long label that must not duplicate the file suffix</button>;\n}\n${suffix}`;
    const after = `export default function App() {\n  return <button className="px-4 bg-indigo-600 shadow-lg">Pay now with a very long label that must not duplicate the file suffix</button>;\n}\n${suffix}`;
    const edits = sliceEdits(before, after);
    const applied = applyBoundEdits(before, edits);
    assert.equal(applied.ok, true);
    assert.equal(applied.code, after);
    assert.equal(applied.code.split(suffix).length - 1, 1);
  });
});

describe("R07 ackRevision equals the persisted version", () => {
  it("freezes snapshot and version before IO, and refuses a second runtime", async () => {
    const dir = await makeTempDir("pr4-r07-");
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    service.store.setElement({ id: "hero", type: "element", tag: "div", props: { className: "a" } });
    const pending = service.saveCanvas();
    service.bumpStoreVersion();
    const ack = await pending;
    const disk = JSON.parse(await fs.readFile(path.join(dir, ".designer/canvas.json"), "utf8"));
    assert.equal(ack.ackRevision, disk.version);
    assert.notEqual(ack.ackRevision, service.storeVersion);

    const other = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await assert.rejects(() => other.init(), (err) => {
      assert.ok(err instanceof RuntimeBusyError);
      assert.equal(err.code, "RUNTIME_BUSY");
      return true;
    });
    await service.stop();
    await other.init();
    await other.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("P04 selected node className not first in file", () => {
  it("turns the button emerald and leaves main p-8 alone", async () => {
    const dir = await makeTempDir("pr4-p04-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    const source = `export default function App() {\n  return (\n    <main className="p-8">\n      <button className="bg-indigo-600">Pay</button>\n    </main>\n  );\n}\n`;
    await fs.writeFile(path.join(dir, "src/App.tsx"), source);
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const button = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    assert.ok(button);
    const proposed = await service.executeTool("propose_source_patch", {
      elementId: button.id,
      instruction: "把按钮改成翠绿",
      live: false
    });
    assert.equal(proposed.success, true);
    assert.match(proposed.proposal.afterClassName, /bg-emerald-600/);
    assert.doesNotMatch(proposed.proposal.afterClassName, /p-8/);
    const accepted = await service.executeTool("accept_source_patch", { proposalId: proposed.proposal.id });
    assert.equal(accepted.success, true);
    const written = await fs.readFile(path.join(dir, "src/App.tsx"), "utf8");
    assert.match(written, /<button className="bg-emerald-600">Pay<\/button>/);
    assert.match(written, /<main className="p-8">/);
    const canvasButton = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    assert.match(String(canvasButton.props.className), /bg-emerald-600/);
    const canvasMain = Object.values(service.store.toJSON().byId).find((el) => el.tag === "main");
    assert.match(String(canvasMain.props.className), /p-8/);
    assert.doesNotMatch(String(canvasMain.props.className), /bg-emerald-600/);
    const loc = button.sourceLocation;
    assert.equal(extractClassNameAt(written, loc.line, loc.column), "bg-emerald-600");
    await service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("P05 sliceEdits is a positive correctness test", () => {
  it("does not duplicate the file suffix when inserting shadow-lg", () => {
    const before = `export default function App() {\n  return <button className="bg-indigo-600">Pay now with a very long label</button>;\n}\n`;
    const after = `export default function App() {\n  return <button className="bg-indigo-600 shadow-lg">Pay now with a very long label</button>;\n}\n`;
    const applied = applyBoundEdits(before, sliceEdits(before, after));
    assert.equal(applied.ok, true);
    assert.equal(applied.code, after);
  });
});

describe("PR4-F10 keyword fallback must not invert intent", () => {
  it("refuses 不要改颜色，只去掉阴影 instead of adding shadow-lg", async () => {
    const parsed = parseIntent("不要改颜色，只去掉阴影");
    assert.equal(parsed.kind, "dropCategory");
    assert.equal(parsed.category, "shadow");
    assert.equal(applyIntentToClassName("px-4 bg-indigo-600 shadow-lg", parsed), "px-4 bg-indigo-600");
    assert.notEqual(applyIntentToClassName("px-4 bg-indigo-600", parsed), "px-4 bg-indigo-600 shadow-lg");

    const dir = await makeTempDir("pr4-f10-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "src/App.tsx"),
      `export default function App() {\n  return <button className="bg-indigo-600 shadow-lg">Pay</button>;\n}\n`
    );
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const button = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    const proposed = await service.executeTool("propose_source_patch", {
      elementId: button.id,
      instruction: "不要改颜色，只去掉阴影",
      live: false
    });
    assert.equal(proposed.success, true);
    assert.doesNotMatch(proposed.proposal.afterClassName, /shadow-lg/);
    assert.match(proposed.proposal.afterClassName, /bg-indigo-600/);
    await service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refuses unsupported JSX instead of rewriting the whole page", async () => {
    const dir = await makeTempDir("pr4-f10b-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "src/App.tsx"),
      `export default function App() {\n  return <button className="bg-indigo-600">Pay</button>;\n}\n`
    );
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const button = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    const proposed = await service.executeTool("propose_source_patch", {
      elementId: button.id,
      instruction: "rewrite this into a dashboard with three charts",
      live: false
    });
    assert.equal(proposed.success, false);
    assert.equal(proposed.code, "UNSUPPORTED_EDIT");
    assert.match(String(proposed.error), /currentClassName=/);
    assert.equal(
      await fs.readFile(path.join(dir, "src/App.tsx"), "utf8"),
      `export default function App() {\n  return <button className="bg-indigo-600">Pay</button>;\n}\n`
    );
    await service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("PR4-F09 before-images are keyed by worktree and keep binary/unreadable", () => {
  it("does not store binary or a read error as absent", async () => {
    const dir = await makeTempDir("pr4-f09-");
    await fs.mkdir(path.join(dir, "src", "only-dir"), { recursive: true });
    await fs.writeFile(path.join(dir, "src/bin.dat"), Buffer.from([0x80, 0x00, 0x81]));
    const file = path.join(dir, ".designer", "source-baselines.json");
    const store = new SourceBaselineStore(file, "ws-f09");
    store.remember(".", "src/bin.dat", await readBaselinePresence(path.join(dir, "src/bin.dat")));
    store.remember(".designer/worktrees/b1", "src/only-dir", await readBaselinePresence(path.join(dir, "src/only-dir")));
    assert.equal(store.worktrees["."]["src/bin.dat"].kind, "binary");
    assert.notEqual(store.worktrees["."]["src/bin.dat"].kind, "absent");
    assert.equal(store.worktrees[".designer/worktrees/b1"]["src/only-dir"].kind, "unreadable");
    assert.notEqual(store.worktrees[".designer/worktrees/b1"]["src/only-dir"].kind, "absent");
    assert.equal(store.files["src/bin.dat"], undefined);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("PR4-F08 reject writes nothing", () => {
  it("drops the proposal and leaves the repo unchanged", async () => {
    const dir = await makeTempDir("pr4-f08-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    const source = `export default function App() {\n  return <button className="bg-indigo-600">Pay</button>;\n}\n`;
    await fs.writeFile(path.join(dir, "src/App.tsx"), source);
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const button = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    const proposed = await service.executeTool("propose_source_patch", {
      elementId: button.id,
      instruction: "把按钮改成翠绿",
      live: false
    });
    assert.equal(proposed.success, true);
    const issued = await service.issueHostReceipt("accept_source_patch", { proposalId: proposed.proposal.id });
    assert.equal(issued.humanApproval, false);
    assert.equal(issued.receiptKind, "debug-http");
    const rejected = await service.executeTool("reject_source_patch");
    assert.equal(rejected.success, true);
    assert.equal(rejected.wrote, false);
    assert.equal(await fs.readFile(path.join(dir, "src/App.tsx"), "utf8"), source);
    await service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
