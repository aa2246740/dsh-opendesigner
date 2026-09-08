import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { OpenDesignerService } from "../src/server/index.ts";
import { git } from "../src/server/gitExec.ts";
import { AgentBatchRegistry } from "../src/server/agentBatch.ts";
import { ApprovalLedger } from "../src/server/approvalReceipt.ts";
import { hashFrozenChangeset } from "../src/server/frozenChangeset.ts";
import { ApplyJournal } from "../src/server/applyJournal.ts";
import { contentHash } from "../src/server/fileBytes.ts";

async function tmp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("MAIN-06 acceptSourcePatch while batch open", () => {
  it("refuses main-root accept and leaves the source file unchanged", async () => {
    const dir = await tmp("main06-accept-");
    await git(dir, ["init", "-b", "main"]);
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    const source = `export default function App() {\n  return <button className="px-4 bg-indigo-600">Pay now</button>;\n}\n`;
    await fs.writeFile(path.join(dir, "src/App.tsx"), source);
    await git(dir, ["add", "."]);
    await git(dir, ["-c", "user.name=Review", "-c", "user.email=review@local", "commit", "-m", "base"]);

    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const button = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    assert.ok(button);
    const proposed = await service.executeTool("propose_source_patch", {
      elementId: button!.id,
      instruction: "把按钮改成翠绿",
      live: false
    });
    assert.equal(proposed.success, true);

    const created = await service.executeTool("batch_create", { label: "main06" });
    assert.equal(created.success, true);

    const accepted = await service.executeTool("accept_source_patch", {
      proposalId: proposed.proposal.id
    });
    assert.equal(accepted.success, false);
    assert.equal(accepted.code, "SOURCE_PATCH_MAIN_ROOT_LOCKED");
    assert.equal(await fs.readFile(path.join(dir, "src/App.tsx"), "utf8"), source);

    await service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("B01 approved pin after consume persist race", () => {
  it("apply writes APPROVED_A after worktree swap to NOT_ACCEPTED_B", async () => {
    const dir = await tmp("b01-pin-");
    await git(dir, ["init", "-b", "main"]);
    await fs.writeFile(path.join(dir, "a.txt"), "BASE");
    await git(dir, ["add", "."]);
    await git(dir, ["-c", "user.name=Review", "-c", "user.email=review@local", "commit", "-m", "base"]);
    const reg = new AgentBatchRegistry(dir, path.join(dir, ".designer", "batches.json"));
    const batch = await reg.create();
    const wt = reg.worktreeAbs(batch);
    await fs.writeFile(path.join(wt, "a.txt"), "APPROVED_A");
    const frozenA = await reg.captureFrozen(batch.batchId);
    const hashA = hashFrozenChangeset(frozenA);
    const ledger = new ApprovalLedger(path.join(dir, ".designer", "receipts.json"));
    const fields = { projectId: frozenA.projectId, revision: 1, tool: "batch_apply" as const };
    const receiptA = await ledger.issue({ ...fields, diffHash: hashA });
    ledger.beforePersist = async () => {
      await fs.writeFile(path.join(wt, "a.txt"), "NOT_ACCEPTED_B");
      const frozenB = await reg.captureFrozen(batch.batchId);
      await ledger.issue({ ...fields, diffHash: hashFrozenChangeset(frozenB) });
    };
    await ledger.consume({ ...fields, receiptId: receiptA.id, diffHash: hashA });
    const applied = await reg.apply(batch.batchId);
    assert.equal(applied.status, "applied");
    assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "APPROVED_A");
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("PR6-R01 mixed recovery and PR6-R02 third-state", () => {
  it("mixed USER_REPAIR_A + AGENT_B blocks and keeps USER_REPAIR_A", async () => {
    const dir = await tmp("pr6-r01-");
    const hash = (s: string) => contentHash(Buffer.from(s));
    await fs.writeFile(path.join(dir, "a.txt"), "BASE_A");
    await fs.writeFile(path.join(dir, "b.txt"), "BASE_B");
    const journal = new ApplyJournal(dir, "w", path.join(dir, ".designer", "apply-journal.json"));
    const planned = [
      { rel: "a.txt", kind: "write" as const, beforeHash: hash("BASE_A"), afterHash: hash("AGENT_A") },
      { rel: "b.txt", kind: "write" as const, beforeHash: hash("BASE_B"), afterHash: hash("AGENT_B") }
    ];
    const entry = await journal.begin("b", planned);
    const staging = journal.stagingDir("b");
    const backupA = await journal.backupFile(staging, "a.txt", path.join(dir, "a.txt"));
    await journal.recordBackup(entry, "a.txt", backupA, planned[0]);
    const backupB = await journal.backupFile(staging, "b.txt", path.join(dir, "b.txt"));
    await journal.recordBackup(entry, "b.txt", backupB, planned[1]);
    await fs.writeFile(path.join(dir, "a.txt"), "USER_REPAIR_A");
    await fs.writeFile(path.join(dir, "b.txt"), "AGENT_B");
    await assert.rejects(journal.recover(), (err: { code?: string }) => err.code === "BATCH_RECOVERY_BLOCKED");
    assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "USER_REPAIR_A");
    assert.equal(await fs.readFile(path.join(dir, "b.txt"), "utf8"), "AGENT_B");
    await fs.access(path.join(dir, ".designer", "apply-journal.json"));
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("expanding partial, new-file partial, and directory target all block", async () => {
    const hash = (s: string) => contentHash(Buffer.from(s));
    async function setup(prefix: string, before: string | null, after: string) {
      const dir = await tmp(prefix);
      const target = path.join(dir, "a.txt");
      if (before !== null) await fs.writeFile(target, before);
      const journal = new ApplyJournal(dir, "w", path.join(dir, ".designer", "apply-journal.json"));
      const hashes = { beforeHash: before === null ? null : hash(before), afterHash: hash(after) };
      const entry = await journal.begin("b", [{ rel: "a.txt", kind: "write" as const, ...hashes }]);
      const backup = before === null ? null : await journal.backupFile(journal.stagingDir("b"), "a.txt", target);
      await journal.recordBackup(entry, "a.txt", backup, hashes);
      return { dir, target, journal };
    }

    const expanding = await setup("pr6-r02-exp-", "x", "CANDIDATE_BYTES_22CH!!");
    await fs.writeFile(expanding.target, "CANDIDATE_BYTES_22CH!!".slice(0, 8));
    await assert.rejects(expanding.journal.recover(), (err: { code?: string }) => err.code === "BATCH_RECOVERY_BLOCKED");
    assert.equal(await fs.readFile(expanding.target, "utf8"), "CANDIDAT");
    await fs.access(path.join(expanding.dir, ".designer", "apply-journal.json"));
    await fs.rm(expanding.dir, { recursive: true, force: true });

    const created = await setup("pr6-r02-new-", null, "NEW_FILE_FULL_BYTES");
    await fs.writeFile(created.target, "NEW_");
    await assert.rejects(created.journal.recover(), (err: { code?: string }) => err.code === "BATCH_RECOVERY_BLOCKED");
    assert.equal(await fs.readFile(created.target, "utf8"), "NEW_");
    await fs.access(path.join(created.dir, ".designer", "apply-journal.json"));
    await fs.rm(created.dir, { recursive: true, force: true });

    const typed = await setup("pr6-r02-dir-", "BASE", "AGENT");
    await fs.rm(typed.target);
    await fs.mkdir(typed.target);
    await assert.rejects(typed.journal.recover(), (err: { code?: string }) => err.code === "BATCH_RECOVERY_BLOCKED");
    assert.equal((await fs.lstat(typed.target)).isDirectory(), true);
    await fs.access(path.join(typed.dir, ".designer", "apply-journal.json"));
    await fs.rm(typed.dir, { recursive: true, force: true });
  });
});
