import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { git, initGitRepo, loadSrc, makeTempDir, writeAndCommit } from "../../review-pr3/qa/helpers.mjs";

const { AgentBatchRegistry, BatchError } = await loadSrc("server/agentBatch.ts");
const { ApplyJournal, ApplyJournalBlockedError } = await loadSrc("server/applyJournal.ts");
const { OpenDesignerService } = await loadSrc("server/index.ts");
const { hashFrozenChangeset } = await loadSrc("server/frozenChangeset.ts");
const { parseIntent, applyIntentToClassName } = await loadSrc("compiler/sourcePatch.ts");
const { writeFileNoFollow, contentHash } = await loadSrc("server/fileBytes.ts");

async function registry(root) {
  const file = path.join(root, ".designer", "batches.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const batches = new AgentBatchRegistry(root, file);
  await batches.load();
  return batches;
}

async function hashedJournal(dir, rel, beforeBytes, afterBytes, currentBytes, kind = "write") {
  const journal = new ApplyJournal(dir, "testworkspace", path.join(dir, ".designer", "apply-journal.json"));
  const staging = journal.stagingDir("batch1");
  await fs.mkdir(path.join(staging, path.dirname(rel)), { recursive: true });
  const beforeHash = beforeBytes ? contentHash(Buffer.from(beforeBytes)) : null;
  const afterHash = afterBytes ? contentHash(Buffer.from(afterBytes)) : null;
  if (beforeBytes) {
    await writeFileNoFollow(path.join(staging, rel), beforeBytes);
  }
  const entry = await journal.begin("batch1", [{ kind, rel, beforeHash, afterHash }]);
  await journal.recordBackup(
    entry,
    rel,
    beforeBytes ? path.join(".designer", "apply-staging", "batch1", rel) : null,
    { beforeHash, afterHash }
  );
  const dest = path.join(dir, rel);
  if (currentBytes === null) {
    await fs.rm(dest, { force: true });
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, currentBytes);
  }
  return { journal, staging };
}

describe("B01 approved A must not execute B", () => {
  it("denies A's receipt after capture B and does not write B to main", async () => {
    const root = await makeTempDir("pr4r2-b01-receipt-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "base\n", "base");
    const service = new OpenDesignerService({ projectRoot: root, autoApprove: false });
    await service.init();
    const created = await service.executeTool("batch_create", { label: "b01" });
    assert.equal(created.success, true);
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/app.tsx"), "NOT_ACCEPTED_A\n");

    const applyArgs = { batchId: created.batchId };
    const issued = await service.issueHostReceipt("batch_apply", applyArgs);
    assert.equal(issued.success, true);

    await fs.writeFile(path.join(worktree, "src/app.tsx"), "NOT_ACCEPTED_B\n");
    const frozenB = await service.batches.captureFrozen(created.batchId);
    assert.notEqual(hashFrozenChangeset(frozenB), issued.diffHash);

    const applied = await service.executeTool("batch_apply", {
      ...applyArgs,
      approvalReceipt: issued.approvalReceipt
    });
    assert.equal(applied.success, false);
    assert.equal(applied.code, "DENIED");
    assert.equal(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "base\n");
    assert.notEqual(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "NOT_ACCEPTED_B\n");
    await service.stop();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("commitPrepared(frozenA) still writes A when captureFrozen B runs mid-commit", async () => {
    const root = await makeTempDir("pr4r2-b01-object-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "base\n", "base");
    const batches = await registry(root);
    const created = await batches.create("b01-object");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/app.tsx"), "NOT_ACCEPTED_A\n");
    const frozenA = await batches.prepareApply(created.batchId);
    const hashA = hashFrozenChangeset(frozenA);

    batches.beforeManagedWrite = async () => {
      await fs.writeFile(path.join(worktree, "src/app.tsx"), "NOT_ACCEPTED_B\n");
      const frozenB = await batches.captureFrozen(created.batchId);
      assert.notEqual(hashFrozenChangeset(frozenB), hashA);
    };

    const applied = await batches.commitPrepared(frozenA);
    assert.equal(applied.status, "applied");
    assert.equal(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "NOT_ACCEPTED_A\n");
    assert.notEqual(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "NOT_ACCEPTED_B\n");
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("B02 user edit after last check must survive", () => {
  it("fails closed when USER_AFTER_LAST_CHECK is injected after recordBackup", async () => {
    const root = await makeTempDir("pr4r2-b02-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "base\n", "base");
    const batches = await registry(root);
    const created = await batches.create("b02");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/app.tsx"), "AGENT\n");
    const frozen = await batches.prepareApply(created.batchId);
    const dest = path.join(root, "src/app.tsx");

    batches.beforeManagedWrite = async () => {
      await fs.writeFile(dest, "USER_AFTER_LAST_CHECK\n");
    };

    await assert.rejects(() => batches.commitPrepared(frozen), (err) => {
      assert.ok(err instanceof BatchError);
      assert.equal(err.code, "BATCH_CONFLICT");
      return true;
    });
    assert.equal(await fs.readFile(dest, "utf8"), "USER_AFTER_LAST_CHECK\n");
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("B03 hashless old journal plus user repair must not restore backup", () => {
  it("blocks and keeps the user bytes, journal, and backups", async () => {
    const dir = await makeTempDir("pr4r2-b03-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src/first.txt"), "orig-first\n");
    const journalFile = path.join(dir, ".designer", "apply-journal.json");
    const journal = new ApplyJournal(dir, "testworkspace", journalFile);
    const staging = journal.stagingDir("batch1");
    await fs.mkdir(path.join(staging, "src"), { recursive: true });
    await writeFileNoFollow(path.join(staging, "src/first.txt"), "orig-first\n");
    const entry = await journal.begin("batch1", [{ kind: "write", rel: "src/first.txt" }]);
    await journal.recordBackup(entry, "src/first.txt", path.join(".designer", "apply-staging", "batch1", "src/first.txt"));
    await fs.writeFile(path.join(dir, "src/first.txt"), "user-repaired\n");
    await assert.rejects(() => journal.recover(), (err) => {
      assert.ok(err instanceof ApplyJournalBlockedError);
      assert.equal(err.code, "BATCH_RECOVERY_BLOCKED");
      return true;
    });
    assert.equal(await fs.readFile(path.join(dir, "src/first.txt"), "utf8"), "user-repaired\n");
    await fs.access(journalFile);
    await fs.access(path.join(staging, "src/first.txt"));
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("B04 planned write but user deleted must not resurrect", () => {
  it("blocks and leaves the file deleted", async () => {
    const dir = await makeTempDir("pr4r2-b04-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src/first.txt"), "orig-first\n");
    const { journal, staging } = await hashedJournal(
      dir,
      "src/first.txt",
      "orig-first\n",
      "agent-new\n",
      null
    );
    await assert.rejects(() => journal.recover(), (err) => {
      assert.equal(err.code, "BATCH_RECOVERY_BLOCKED");
      return true;
    });
    const exists = await fs.stat(path.join(dir, "src/first.txt")).then(() => true).catch(() => false);
    assert.equal(exists, false);
    await fs.access(path.join(dir, ".designer", "apply-journal.json"));
    await fs.access(path.join(staging, "src/first.txt"));
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("B05 planned delete but user created must not overwrite", () => {
  it("blocks and keeps the new user file", async () => {
    const dir = await makeTempDir("pr4r2-b05-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src/first.txt"), "orig-first\n");
    const { journal, staging } = await hashedJournal(
      dir,
      "src/first.txt",
      "orig-first\n",
      null,
      "user-created\n",
      "delete"
    );
    await assert.rejects(() => journal.recover(), (err) => {
      assert.equal(err.code, "BATCH_RECOVERY_BLOCKED");
      return true;
    });
    assert.equal(await fs.readFile(path.join(dir, "src/first.txt"), "utf8"), "user-created\n");
    await fs.access(path.join(dir, ".designer", "apply-journal.json"));
    await fs.access(path.join(staging, "src/first.txt"));
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("B06 truncated half-write matching neither hash must block", () => {
  it("retains AGE bytes, journal, and backups and never recovered:true", async () => {
    const dir = await makeTempDir("pr4r2-b06-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src/first.txt"), "orig-first\n");
    const { journal, staging } = await hashedJournal(
      dir,
      "src/first.txt",
      "orig-first\n",
      "AGENT_FULL\n",
      "AGE"
    );
    let recovered = null;
    await assert.rejects(
      async () => {
        recovered = await journal.recover();
      },
      (err) => {
        assert.ok(err instanceof ApplyJournalBlockedError);
        assert.equal(err.code, "BATCH_RECOVERY_BLOCKED");
        return true;
      }
    );
    assert.equal(recovered, null);
    assert.equal(await fs.readFile(path.join(dir, "src/first.txt"), "utf8"), "AGE");
    await fs.access(path.join(dir, ".designer", "apply-journal.json"));
    await fs.access(path.join(staging, "src/first.txt"));
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("B07 distinct proposals are distinct changeset identities", () => {
  it("commit of frozen A after a later capture B still writes A", async () => {
    const root = await makeTempDir("pr4r2-b07-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "base\n", "base");
    const batches = await registry(root);
    const created = await batches.create("b07");
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/app.tsx"), "PROPOSAL_A\n");
    const frozenA = await batches.captureFrozen(created.batchId);
    await fs.writeFile(path.join(worktree, "src/app.tsx"), "PROPOSAL_B\n");
    const frozenB = await batches.captureFrozen(created.batchId);
    assert.notEqual(hashFrozenChangeset(frozenA), hashFrozenChangeset(frozenB));
    const applied = await batches.commitPrepared(frozenA);
    assert.equal(applied.status, "applied");
    assert.equal(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "PROPOSAL_A\n");
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("B08 negation must not drop shadow", () => {
  it("refuses 不要去掉阴影，只改圆角 and keeps the prior drop-shadow fix", async () => {
    const keepDrop = parseIntent("不要改颜色，只去掉阴影");
    assert.equal(keepDrop.kind, "dropCategory");
    assert.equal(keepDrop.category, "shadow");
    assert.equal(applyIntentToClassName("px-4 bg-indigo-600 shadow-lg", keepDrop), "px-4 bg-indigo-600");

    const refused = parseIntent("不要去掉阴影，只改圆角");
    assert.equal(refused.kind, "unsupported");
    assert.equal(refused.ruleMode, "refuse");
    assert.equal(applyIntentToClassName("px-4 bg-indigo-600 shadow-lg", refused), null);

    const dir = await makeTempDir("pr4r2-b08-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    const source = `export default function App() {\n  return <button className="bg-indigo-600 shadow-lg">Pay</button>;\n}\n`;
    await fs.writeFile(path.join(dir, "src/App.tsx"), source);
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const button = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    const proposed = await service.executeTool("propose_source_patch", {
      elementId: button.id,
      instruction: "不要去掉阴影，只改圆角",
      live: false
    });
    assert.equal(proposed.success, false);
    assert.equal(proposed.code, "UNSUPPORTED_EDIT");
    assert.equal(proposed.ruleMode, "refuse");
    assert.match(String(proposed.error), /currentClassName=/);
    assert.equal(await fs.readFile(path.join(dir, "src/App.tsx"), "utf8"), source);
    const className = String(Object.values(service.store.toJSON().byId).find((el) => el.tag === "button").props.className);
    assert.match(className, /shadow-lg/);
    assert.doesNotMatch(className, /rounded-xl/);
    await service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("B09 MAIN_SNAPSHOT must not clobber BATCH_WORK", () => {
  it("restores the checkpoint worktree, not the currently open batch", async () => {
    const root = await makeTempDir("pr4r2-b09-");
    await initGitRepo(root);
    await writeAndCommit(root, "src/app.tsx", "MAIN_BASE\n", "main");
    const service = new OpenDesignerService({ projectRoot: root, autoApprove: true });
    await service.init();
    const writeMain = await service.executeTool("project_write", {
      path: "src/app.tsx",
      content: "MAIN_SNAPSHOT\n"
    });
    assert.equal(writeMain.success, true);
    await git(root, ["add", "--", "src/app.tsx"]);
    await git(root, ["-c", "user.email=od@test", "-c", "user.name=OpenDesigner", "commit", "-m", "main-snapshot"]);
    const snap = await service.executeTool("checkpoint", { label: "main-snapshot" });
    assert.equal(snap.success, true);

    const created = await service.executeTool("batch_create", { label: "b09" });
    assert.equal(created.success, true);
    const worktree = path.join(root, created.worktreeRelPath);
    await fs.writeFile(path.join(worktree, "src/app.tsx"), "BATCH_WORK\n");

    const rewind = await service.executeTool("rewind", { checkpointId: snap.checkpoint.id });
    assert.equal(rewind.success, true);
    assert.equal(await fs.readFile(path.join(worktree, "src/app.tsx"), "utf8"), "BATCH_WORK\n");
    assert.equal(await fs.readFile(path.join(root, "src/app.tsx"), "utf8"), "MAIN_SNAPSHOT\n");
    await service.stop();
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("B10 binary mid-history restores 81 00", () => {
  it("does not fall back to the initial 80 00 bytes", async () => {
    const dir = await makeTempDir("pr4r2-b10-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const seed = await service.executeTool("project_write", {
      path: "src/mid.bin",
      content: "placeholder"
    });
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
    await service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
