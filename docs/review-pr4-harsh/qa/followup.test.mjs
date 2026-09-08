import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const source = process.env.REVIEW_SOURCE_ROOT || path.resolve(import.meta.dirname, "../../../src");
const load = (p) => import(pathToFileURL(path.join(source, p)));

const { AgentBatchRegistry, BatchError } = await load("server/agentBatch.ts");
const { ApplyJournal, ApplyJournalBlockedError } = await load("server/applyJournal.ts");
const { ApprovalLedger } = await load("server/approvalReceipt.ts");
const { RuntimeLock } = await load("server/runtimeLock.ts");
const { hashFrozenChangeset, cloneFrozenChangeset } = await load("server/frozenChangeset.ts");
const { contentHash, writeFileNoFollow } = await load("server/fileBytes.ts");
const { captureOverlayFiles, materializeRestorePlan, applyRestorePlan, overlayRoot } = await load(
  "server/sourceOverlay.ts"
);
const { SourceBaselineStore } = await load("server/sourceBaseline.ts");
const { git } = await load("server/gitExec.ts");
const { OpenDesignerService } = await load("server/index.ts");
const { parseIntent, applyIntentToClassName } = await load("compiler/sourcePatch.ts");

const hash = (s) => contentHash(Buffer.from(s));

async function tmp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "od-pr4-harsh-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function fixture(t) {
  const root = await tmp(t);
  await git(root, ["init", "-b", "main"]);
  await fs.writeFile(path.join(root, "a.txt"), "BASE");
  await git(root, ["add", "."]);
  await git(root, ["-c", "user.name=Review", "-c", "user.email=review@local", "commit", "-m", "base"]);
  const reg = new AgentBatchRegistry(root, path.join(root, ".designer", "batches.json"));
  const b = await reg.create();
  return { root, reg, b, wt: reg.worktreeAbs(b) };
}

async function journal(t, { before = "BASE", after = "AGENT", kind = "write" } = {}) {
  const root = await tmp(t);
  const file = path.join(root, ".designer", "apply-journal.json");
  const target = path.join(root, "a.txt");
  if (before !== null) await fs.writeFile(target, before);
  const j = new ApplyJournal(root, "w", file);
  const hashes = {
    beforeHash: before === null ? null : hash(before),
    afterHash: after === null ? null : hash(after)
  };
  const entry = await j.begin("b", [{ rel: "a.txt", kind, ...hashes }]);
  const backup = before === null ? null : await j.backupFile(j.stagingDir("b"), "a.txt", target);
  await j.recordBackup(entry, "a.txt", backup, hashes);
  if (after === null) await fs.rm(target, { force: true });
  else await fs.writeFile(target, after);
  return { root, file, target, j, backup };
}

async function blockedRecover(f) {
  let code = null;
  try {
    await f.j.recover();
  } catch (e) {
    code = e.code;
  }
  return code;
}

async function exists(p) {
  return fs.stat(p).then(
    () => true,
    () => false
  );
}

test("G01 changed candidate bytes invalidate a previously issued receipt", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.wt, "a.txt"), "APPROVED_A");
  const a = await f.reg.captureFrozen(f.b.batchId);
  const ledger = new ApprovalLedger(path.join(f.root, ".designer", "receipts.json"));
  const fields = { projectId: a.projectId, revision: 1, tool: "batch_apply" };
  const receipt = await ledger.issue({ ...fields, diffHash: hashFrozenChangeset(a) });
  await fs.writeFile(path.join(f.wt, "a.txt"), "NOT_ACCEPTED_B");
  const b = await f.reg.captureFrozen(f.b.batchId);
  await assert.rejects(
    ledger.consume({ ...fields, receiptId: receipt.id, diffHash: hashFrozenChangeset(b) }),
    (e) => e.code === "DENIED"
  );
  assert.equal(await fs.readFile(path.join(f.root, "a.txt"), "utf8"), "BASE");
});

test("G02 capture B during commit of frozen A cannot substitute B", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.wt, "a.txt"), "APPROVED_A");
  const a = cloneFrozenChangeset(await f.reg.prepareApply(f.b.batchId));
  f.reg.beforeManagedWrite = async () => {
    await fs.writeFile(path.join(f.wt, "a.txt"), "NOT_ACCEPTED_B");
    await f.reg.captureFrozen(f.b.batchId);
  };
  await f.reg.commitPrepared(a);
  assert.equal(await fs.readFile(path.join(f.root, "a.txt"), "utf8"), "APPROVED_A");
});

test("G03 edit after recordBackup and before managed write is preserved", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.wt, "a.txt"), "AGENT");
  f.reg.beforeManagedWrite = async (abs) => fs.writeFile(abs, "USER_AFTER_BACKUP");
  await assert.rejects(f.reg.apply(f.b.batchId), (e) => e.code === "BATCH_CONFLICT");
  assert.equal(await fs.readFile(path.join(f.root, "a.txt"), "utf8"), "USER_AFTER_BACKUP");
});

test("G04 malformed journal blocks and remains on disk", async (t) => {
  const f = await journal(t);
  await fs.writeFile(f.file, '{"workspaceId":');
  assert.equal(await blockedRecover(f), "BATCH_RECOVERY_BLOCKED");
  assert.equal(await exists(f.file), true);
});

test("G05 hashed journal user repair is quietly preserved", async (t) => {
  const f = await journal(t);
  await fs.writeFile(f.target, "USER_REPAIR");
  const result = await f.j.recover();
  assert.notEqual(result.recovered, true);
  assert.equal(result.preserved, true);
  assert.equal(await fs.readFile(f.target, "utf8"), "USER_REPAIR");
  assert.notEqual(await fs.readFile(f.target, "utf8"), "BASE");
  assert.notEqual(await fs.readFile(f.target, "utf8"), "AGENT");
});

test("G06 recovery preserves user deletion after planned write", async (t) => {
  const f = await journal(t);
  await fs.rm(f.target);
  assert.equal(await blockedRecover(f), "BATCH_RECOVERY_BLOCKED");
  assert.equal(await exists(f.target), false);
});

test("G07 recovery preserves user creation after planned deletion", async (t) => {
  const f = await journal(t, { after: null, kind: "delete" });
  await fs.writeFile(f.target, "USER_NEW");
  assert.equal(await blockedRecover(f), "BATCH_RECOVERY_BLOCKED");
  assert.equal(await fs.readFile(f.target, "utf8"), "USER_NEW");
});

test("G08 recovery blocks truncated half-write that matches neither hash", async (t) => {
  const f = await journal(t, { after: "AGENT_FULL" });
  await fs.writeFile(f.target, "AGE");
  assert.equal(await blockedRecover(f), "BATCH_RECOVERY_BLOCKED");
  assert.equal(await fs.readFile(f.target, "utf8"), "AGE");
  assert.equal(await exists(f.file), true);
});

test("G09 fully evidenced interrupted write restores before bytes", async (t) => {
  const f = await journal(t);
  assert.equal((await f.j.recover()).recovered, true);
  assert.equal(await fs.readFile(f.target, "utf8"), "BASE");
  assert.equal(await exists(f.file), false);
});

test("G10 source overlay keeps worktree identity and binary intermediate bytes", async (t) => {
  const root = await tmp(t);
  const key = ".designer/worktrees/b";
  const wt = path.join(root, key);
  await fs.mkdir(wt, { recursive: true });
  await fs.writeFile(path.join(root, "asset.bin"), Buffer.from([0x80, 0]));
  await fs.writeFile(path.join(wt, "asset.bin"), Buffer.from([0x81, 0]));
  const overlay = { workspaceId: "w", worktreeKey: key, files: await captureOverlayFiles(wt, ["asset.bin"]) };
  await fs.writeFile(path.join(wt, "asset.bin"), Buffer.from([0x82, 0]));
  const readback = JSON.parse(JSON.stringify(overlay));
  await applyRestorePlan(materializeRestorePlan(overlayRoot(root, readback.worktreeKey), readback));
  assert.deepEqual(await fs.readFile(path.join(wt, "asset.bin")), Buffer.from([0x81, 0]));
  assert.deepEqual(await fs.readFile(path.join(root, "asset.bin")), Buffer.from([0x80, 0]));
});

test("G11 sequential second runtime is rejected while first holds lock", async (t) => {
  const root = await tmp(t);
  const file = path.join(root, "runtime.lock");
  const a = new RuntimeLock(file);
  const b = new RuntimeLock(file);
  await a.acquire();
  try {
    await assert.rejects(b.acquire(), (e) => e.code === "RUNTIME_BUSY");
  } finally {
    await a.release();
  }
  await b.acquire();
  await b.release();
});

test("G12 before-images are kept separate across worktrees after reload", async (t) => {
  const root = await tmp(t);
  const file = path.join(root, "baselines.json");
  const a = new SourceBaselineStore(file, "w");
  a.remember(".", "a.txt", { kind: "text", text: "MAIN" });
  a.remember(".designer/worktrees/b", "a.txt", { kind: "text", text: "BATCH" });
  await a.persist();
  const b = new SourceBaselineStore(file, "w");
  await b.load();
  assert.equal(b.overlay(".")["a.txt"].text, "MAIN");
  assert.equal(b.overlay(".designer/worktrees/b")["a.txt"].text, "BATCH");
});

test("B01 consume persist race still writes APPROVED_A not NOT_ACCEPTED_B", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.wt, "a.txt"), "APPROVED_A");
  const frozenA = await f.reg.captureFrozen(f.b.batchId);
  const hashA = hashFrozenChangeset(frozenA);
  const ledger = new ApprovalLedger(path.join(f.root, ".designer", "receipts.json"));
  const fields = { projectId: frozenA.projectId, revision: 1, tool: "batch_apply" };
  const receiptA = await ledger.issue({ ...fields, diffHash: hashA });
  ledger.beforePersist = async () => {
    await fs.writeFile(path.join(f.wt, "a.txt"), "NOT_ACCEPTED_B");
    const frozenB = await f.reg.captureFrozen(f.b.batchId);
    const hashB = hashFrozenChangeset(frozenB);
    assert.notEqual(hashB, hashA);
    await ledger.issue({ ...fields, diffHash: hashB });
  };
  await ledger.consume({ ...fields, receiptId: receiptA.id, diffHash: hashA });
  const applied = await f.reg.apply(f.b.batchId);
  assert.equal(applied.status, "applied");
  const main = await fs.readFile(path.join(f.root, "a.txt"), "utf8");
  assert.equal(main, "APPROVED_A");
  assert.notEqual(main, "NOT_ACCEPTED_B");
});

test("B02 user edit after last check must survive", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.wt, "a.txt"), "AGENT");
  const frozen = await f.reg.prepareApply(f.b.batchId);
  f.reg.beforeManagedWrite = async (abs) => fs.writeFile(abs, "USER_AFTER_LAST_CHECK");
  await assert.rejects(f.reg.commitPrepared(frozen), (err) => {
    assert.ok(err instanceof BatchError);
    assert.equal(err.code, "BATCH_CONFLICT");
    return true;
  });
  assert.equal(await fs.readFile(path.join(f.root, "a.txt"), "utf8"), "USER_AFTER_LAST_CHECK");
});

test("B03 hashless old journal plus user repair must not restore backup", async (t) => {
  const root = await tmp(t);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/first.txt"), "orig-first\n");
  const journalFile = path.join(root, ".designer", "apply-journal.json");
  const j = new ApplyJournal(root, "testworkspace", journalFile);
  const staging = j.stagingDir("batch1");
  await fs.mkdir(path.join(staging, "src"), { recursive: true });
  await writeFileNoFollow(path.join(staging, "src/first.txt"), "orig-first\n");
  const entry = await j.begin("batch1", [{ kind: "write", rel: "src/first.txt" }]);
  await j.recordBackup(entry, "src/first.txt", path.join(".designer", "apply-staging", "batch1", "src/first.txt"));
  await fs.writeFile(path.join(root, "src/first.txt"), "user-repaired\n");
  await assert.rejects(() => j.recover(), (err) => {
    assert.ok(err instanceof ApplyJournalBlockedError);
    assert.equal(err.code, "BATCH_RECOVERY_BLOCKED");
    return true;
  });
  assert.equal(await fs.readFile(path.join(root, "src/first.txt"), "utf8"), "user-repaired\n");
  await fs.access(journalFile);
  await fs.access(path.join(staging, "src/first.txt"));
});

test("B04 planned write but user deleted must not resurrect", async (t) => {
  const f = await journal(t, { before: "orig-first\n", after: "agent-new\n" });
  await fs.rm(f.target);
  assert.equal(await blockedRecover(f), "BATCH_RECOVERY_BLOCKED");
  assert.equal(await exists(f.target), false);
  await fs.access(f.file);
});

test("B05 planned delete but user created must not overwrite", async (t) => {
  const f = await journal(t, { before: "orig-first\n", after: null, kind: "delete" });
  await fs.writeFile(f.target, "user-created\n");
  assert.equal(await blockedRecover(f), "BATCH_RECOVERY_BLOCKED");
  assert.equal(await fs.readFile(f.target, "utf8"), "user-created\n");
});

test("B06 truncated half-write matching neither hash must block", async (t) => {
  const f = await journal(t, { before: "orig-first\n", after: "AGENT_FULL\n" });
  await fs.writeFile(f.target, "AGE");
  let recovered = null;
  await assert.rejects(
    async () => {
      recovered = await f.j.recover();
    },
    (err) => {
      assert.ok(err instanceof ApplyJournalBlockedError);
      assert.equal(err.code, "BATCH_RECOVERY_BLOCKED");
      return true;
    }
  );
  assert.equal(recovered, null);
  assert.equal(await fs.readFile(f.target, "utf8"), "AGE");
  await fs.access(f.file);
});

test("B07 distinct proposals are distinct changeset identities", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.wt, "a.txt"), "PROPOSAL_A");
  const frozenA = await f.reg.captureFrozen(f.b.batchId);
  await fs.writeFile(path.join(f.wt, "a.txt"), "PROPOSAL_B");
  const frozenB = await f.reg.captureFrozen(f.b.batchId);
  assert.notEqual(hashFrozenChangeset(frozenA), hashFrozenChangeset(frozenB));
  const applied = await f.reg.commitPrepared(frozenA);
  assert.equal(applied.status, "applied");
  assert.equal(await fs.readFile(path.join(f.root, "a.txt"), "utf8"), "PROPOSAL_A");
});

test("B08 negation must not drop shadow", async () => {
  const keepDrop = parseIntent("不要改颜色，只去掉阴影");
  assert.equal(keepDrop.kind, "dropCategory");
  assert.equal(keepDrop.category, "shadow");
  assert.equal(applyIntentToClassName("px-4 bg-indigo-600 shadow-lg", keepDrop), "px-4 bg-indigo-600");

  const refused = parseIntent("不要去掉阴影，只改圆角");
  assert.equal(refused.kind, "unsupported");
  assert.equal(refused.ruleMode, "refuse");
  assert.equal(applyIntentToClassName("px-4 bg-indigo-600 shadow-lg", refused), null);
});

test("B09 MAIN_SNAPSHOT must not clobber BATCH_WORK", async (t) => {
  const root = await tmp(t);
  await git(root, ["init", "-b", "main"]);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/app.tsx"), "MAIN_BASE\n");
  await git(root, ["add", "--", "src/app.tsx"]);
  await git(root, ["-c", "user.name=Review", "-c", "user.email=review@local", "commit", "-m", "main"]);
  const service = new OpenDesignerService({ projectRoot: root, autoApprove: true });
  await service.init();
  t.after(() => service.stop());
  const writeMain = await service.executeTool("project_write", { path: "src/app.tsx", content: "MAIN_SNAPSHOT\n" });
  assert.equal(writeMain.success, true);
  await git(root, ["add", "--", "src/app.tsx"]);
  await git(root, ["-c", "user.name=Review", "-c", "user.email=review@local", "commit", "-m", "main-snapshot"]);
  const snap = await service.executeTool("checkpoint", { label: "main-snapshot" });
  assert.equal(snap.success, true);
  assert.equal(snap.checkpoint.kind === "session" || snap.success, true);

  const created = await service.executeTool("batch_create", { label: "b09" });
  assert.equal(created.success, true);
  const worktree = path.join(root, created.worktreeRelPath);
  await fs.writeFile(path.join(worktree, "src/app.tsx"), "BATCH_WORK\n");

  const rewind = await service.executeTool("rewind", { checkpointId: snap.checkpoint.id });
  assert.equal(rewind.success, true);
  assert.equal(await fs.readFile(path.join(worktree, "src/app.tsx"), "utf8"), "BATCH_WORK\n");
  assert.equal(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "MAIN_SNAPSHOT\n");
});

test("B10 binary mid-history restores 81 00 not 80 00", async (t) => {
  const dir = await tmp(t);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
  await service.init();
  t.after(() => service.stop());
  const seed = await service.executeTool("project_write", { path: "src/mid.bin", content: "placeholder" });
  assert.equal(seed.success, true);
  await fs.writeFile(path.join(dir, "src/mid.bin"), Buffer.from([0x80, 0x00]));
  await service.executeTool("checkpoint", { label: "bin-80" });
  await fs.writeFile(path.join(dir, "src/mid.bin"), Buffer.from([0x81, 0x00]));
  await service.executeTool("checkpoint", { label: "bin-81" });
  await fs.writeFile(path.join(dir, "src/mid.bin"), Buffer.from([0x82, 0x00]));
  await service.executeTool("checkpoint", { label: "bin-82" });

  const rewind = await service.executeTool("rewind");
  assert.equal(rewind.success, true);
  const mid = await fs.readFile(path.join(dir, "src/mid.bin"));
  assert.deepEqual([...mid], [0x81, 0x00]);
  assert.notDeepEqual([...mid], [0x80, 0x00]);
});
