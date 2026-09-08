import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
const source = process.env.REVIEW_SOURCE_ROOT || path.resolve(import.meta.dirname, '../source');
const load = p => import(pathToFileURL(path.join(source, p)));
const { AgentBatchRegistry } = await load('server/agentBatch.ts');
const { ApplyJournal } = await load('server/applyJournal.ts');
const { ApprovalLedger } = await load('server/approvalReceipt.ts');
const { RuntimeLock } = await load('server/runtimeLock.ts');
const { hashFrozenChangeset, cloneFrozenChangeset } = await load('server/frozenChangeset.ts');
const { contentHash } = await load('server/fileBytes.ts');
const { captureOverlayFiles, materializeRestorePlan, applyRestorePlan, overlayRoot } = await load('server/sourceOverlay.ts');
const { SourceBaselineStore } = await load('server/sourceBaseline.ts');
const { git } = await load('server/gitExec.ts');
const hash = s => contentHash(Buffer.from(s));
async function tmp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'od-main-review-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function fixture(t) { const root = await tmp(t); await git(root, ['init', '-b', 'main']); await fs.writeFile(path.join(root, 'a.txt'), 'BASE'); await git(root, ['add', '.']); await git(root, ['-c', 'user.name=Review', '-c', 'user.email=review@local', 'commit', '-m', 'base']); const reg = new AgentBatchRegistry(root, path.join(root, '.designer', 'batches.json')); const b = await reg.create(); return { root, reg, b, wt: reg.worktreeAbs(b) }; }
async function journal(t, { before = 'BASE', after = 'AGENT', kind = 'write' } = {}) { const root = await tmp(t); const file = path.join(root, '.designer', 'apply-journal.json'); const target = path.join(root, 'a.txt'); if (before !== null)
    await fs.writeFile(target, before); const j = new ApplyJournal(root, 'w', file); const hashes = { beforeHash: before === null ? null : hash(before), afterHash: after === null ? null : hash(after) }; const entry = await j.begin('b', [{ rel: 'a.txt', kind, ...hashes }]); const backup = before === null ? null : await j.backupFile(j.stagingDir('b'), 'a.txt', target); await j.recordBackup(entry, 'a.txt', backup, hashes); if (after === null)
    await fs.rm(target, { force: true });
else
    await fs.writeFile(target, after); return { root, file, target, j, backup }; }
async function blockedRecover(f) { let code = null; try {
    await f.j.recover();
}
catch (e) {
    code = e.code;
} return code; }
async function exists(p) { return fs.stat(p).then(() => true, () => false); }
test('V01 changed candidate bytes invalidate a previously issued receipt', async (t) => { const f = await fixture(t); await fs.writeFile(path.join(f.wt, 'a.txt'), 'APPROVED_A'); const a = await f.reg.captureFrozen(f.b.batchId); const ledger = new ApprovalLedger(path.join(f.root, '.designer', 'receipts.json')); const fields = { projectId: a.projectId, revision: 1, tool: 'batch_apply' }; const receipt = await ledger.issue({ ...fields, diffHash: hashFrozenChangeset(a) }); await fs.writeFile(path.join(f.wt, 'a.txt'), 'NOT_APPROVED_B'); const b = await f.reg.captureFrozen(f.b.batchId); await assert.rejects(ledger.consume({ ...fields, receiptId: receipt.id, diffHash: hashFrozenChangeset(b) }), e => e.code === 'DENIED'); assert.equal(await fs.readFile(path.join(f.root, 'a.txt'), 'utf8'), 'BASE'); });
test('V02 capture B during commit of frozen A cannot substitute B', async (t) => { const f = await fixture(t); await fs.writeFile(path.join(f.wt, 'a.txt'), 'APPROVED_A'); const a = cloneFrozenChangeset(await f.reg.prepareApply(f.b.batchId)); f.reg.beforeManagedWrite = async () => { await fs.writeFile(path.join(f.wt, 'a.txt'), 'NOT_APPROVED_B'); await f.reg.captureFrozen(f.b.batchId); }; await f.reg.commitPrepared(a); assert.equal(await fs.readFile(path.join(f.root, 'a.txt'), 'utf8'), 'APPROVED_A'); });
test('V03 edit after recordBackup and before managed write is preserved', async (t) => { const f = await fixture(t); await fs.writeFile(path.join(f.wt, 'a.txt'), 'AGENT'); f.reg.beforeManagedWrite = async (abs) => fs.writeFile(abs, 'USER_AFTER_BACKUP'); await assert.rejects(f.reg.apply(f.b.batchId), e => e.code === 'BATCH_CONFLICT'); assert.equal(await fs.readFile(path.join(f.root, 'a.txt'), 'utf8'), 'USER_AFTER_BACKUP'); });
test('V04 malformed journal blocks and remains on disk', async (t) => { const f = await journal(t); await fs.writeFile(f.file, '{"workspaceId":'); assert.equal(await blockedRecover(f), 'BATCH_RECOVERY_BLOCKED'); assert.equal(await exists(f.file), true); });
test('V05 recovery preserves user repair and retains evidence', async (t) => { const f = await journal(t); await fs.writeFile(f.target, 'USER_REPAIR'); assert.equal(await blockedRecover(f), 'BATCH_RECOVERY_BLOCKED'); assert.equal(await fs.readFile(f.target, 'utf8'), 'USER_REPAIR'); assert.equal(await exists(f.file), true); });
test('V06 recovery preserves user deletion after planned write', async (t) => { const f = await journal(t); await fs.rm(f.target); assert.equal(await blockedRecover(f), 'BATCH_RECOVERY_BLOCKED'); assert.equal(await exists(f.target), false); });
test('V07 recovery preserves user creation after planned deletion', async (t) => { const f = await journal(t, { after: null, kind: 'delete' }); await fs.writeFile(f.target, 'USER_NEW'); assert.equal(await blockedRecover(f), 'BATCH_RECOVERY_BLOCKED'); assert.equal(await fs.readFile(f.target, 'utf8'), 'USER_NEW'); });
test('V08 recovery blocks partial bytes that match neither hash', async (t) => { const f = await journal(t, { after: 'AGENT_FULL' }); await fs.writeFile(f.target, 'AGE'); assert.equal(await blockedRecover(f), 'BATCH_RECOVERY_BLOCKED'); assert.equal(await fs.readFile(f.target, 'utf8'), 'AGE'); assert.equal(await exists(f.file), true); });
test('V09 fully evidenced interrupted write restores before bytes', async (t) => { const f = await journal(t); assert.equal((await f.j.recover()).recovered, true); assert.equal(await fs.readFile(f.target, 'utf8'), 'BASE'); assert.equal(await exists(f.file), false); });
test('V10 source overlay keeps worktree identity and binary intermediate bytes', async (t) => { const root = await tmp(t); const key = '.designer/worktrees/b'; const wt = path.join(root, key); await fs.mkdir(wt, { recursive: true }); await fs.writeFile(path.join(root, 'asset.bin'), Buffer.from([0x80, 0])); await fs.writeFile(path.join(wt, 'asset.bin'), Buffer.from([0x81, 0])); const overlay = { workspaceId: 'w', worktreeKey: key, files: await captureOverlayFiles(wt, ['asset.bin']) }; await fs.writeFile(path.join(wt, 'asset.bin'), Buffer.from([0x82, 0])); const readback = JSON.parse(JSON.stringify(overlay)); await applyRestorePlan(materializeRestorePlan(overlayRoot(root, readback.worktreeKey), readback)); assert.deepEqual(await fs.readFile(path.join(wt, 'asset.bin')), Buffer.from([0x81, 0])); assert.deepEqual(await fs.readFile(path.join(root, 'asset.bin')), Buffer.from([0x80, 0])); });
test('V11 sequential second runtime is rejected while first holds lock', async (t) => { const root = await tmp(t); const file = path.join(root, 'runtime.lock'); const a = new RuntimeLock(file), b = new RuntimeLock(file); await a.acquire(); try {
    await assert.rejects(b.acquire(), e => e.code === 'RUNTIME_BUSY');
}
finally {
    await a.release();
} await b.acquire(); await b.release(); });
test('V12 before-images are kept separate across worktrees after reload', async (t) => { const root = await tmp(t); const file = path.join(root, 'baselines.json'); const a = new SourceBaselineStore(file, 'w'); a.remember('.', 'a.txt', { kind: 'text', text: 'MAIN' }); a.remember('.designer/worktrees/b', 'a.txt', { kind: 'text', text: 'BATCH' }); await a.persist(); const b = new SourceBaselineStore(file, 'w'); await b.load(); assert.equal(b.overlay('.')['a.txt'].text, 'MAIN'); assert.equal(b.overlay('.designer/worktrees/b')['a.txt'].text, 'BATCH'); });
// This is the exact module composition used by Service.assertReceipt(batch_apply)
// and applyOpenBatchFiles: capture -> hash -> consume -> clone -> commitPrepared.
// It is not an end-to-end browser/DSH test.
test('M01 receipt-backed apply must retain the same three-way conflict guard as apply()', async (t) => { const f = await fixture(t); await fs.writeFile(path.join(f.wt, 'a.txt'), 'AGENT'); await fs.writeFile(path.join(f.root, 'a.txt'), 'USER_CONCURRENT'); const ledger = new ApprovalLedger(path.join(f.root, '.designer', 'receipts.json')); const fields = { projectId: 'p', revision: 1, tool: 'batch_apply' }; let code = null; try {
    const issuedSnapshot = await f.reg.captureFrozen(f.b.batchId);
    const receipt = await ledger.issue({ ...fields, diffHash: hashFrozenChangeset(issuedSnapshot) });
    const checked = await f.reg.captureFrozen(f.b.batchId);
    await ledger.consume({ ...fields, diffHash: hashFrozenChangeset(checked), receiptId: receipt.id });
    await f.reg.commitPrepared(cloneFrozenChangeset(checked));
}
catch (e) {
    code = e.code;
} const content = await fs.readFile(path.join(f.root, 'a.txt'), 'utf8'); console.log('M01 observed', JSON.stringify({ code, content })); assert.deepEqual({ code, content }, { code: 'BATCH_CONFLICT', content: 'USER_CONCURRENT' }); });
test('M02 restore must validate backup bytes before overwriting target or clearing journal', async (t) => { const f = await journal(t); await fs.writeFile(path.join(f.root, f.backup), 'CORRUPTED_BACKUP'); const code = await blockedRecover(f); const observation = { code, content: await fs.readFile(f.target, 'utf8'), journalRetained: await exists(f.file) }; console.log('M02 observed', JSON.stringify(observation)); assert.deepEqual(observation, { code: 'BATCH_RECOVERY_BLOCKED', content: 'AGENT', journalRetained: true }); });
test('M03 failed multi-file checkpoint restore must not leave earlier files reverted', async (t) => { const root = await tmp(t); await fs.writeFile(path.join(root, 'a.txt'), 'CURRENT_A'); await fs.mkdir(path.join(root, 'b.txt')); const overlay = { workspaceId: 'w', worktreeKey: '.', files: { 'a.txt': { kind: 'text', text: 'OLD_A' }, 'b.txt': { kind: 'text', text: 'OLD_B' } } }; let error = null; try {
    await applyRestorePlan(materializeRestorePlan(root, overlay));
}
catch (e) {
    error = e.code || e.message;
} const content = await fs.readFile(path.join(root, 'a.txt'), 'utf8'); console.log('M03 observed', JSON.stringify({ error, content })); assert.ok(error, 'restoring over directory must fail'); assert.equal(content, 'CURRENT_A', 'a.txt was changed before later restore failed'); });
test('M04 concurrent acquire must not steal a live lock while its payload is being written', async (t) => { const root = await tmp(t); const file = path.join(root, 'runtime.lock'); const first = new RuntimeLock(file), second = new RuntimeLock(file); const originalOpen = fs.open; let signalReady; const ready = new Promise(r => signalReady = r); let resume; const barrier = new Promise(r => resume = r); let intercepted = false; fs.open = async (...args) => { const h = await originalOpen(...args); if (String(args[0]) === file && args[1] === 'wx' && !intercepted) {
    intercepted = true;
    const write = h.writeFile.bind(h);
    h.writeFile = async (...a) => { signalReady(); await barrier; return write(...a); };
} return h; }; syncBuiltinESMExports(); let secondCode = null, secondAcquired = false; const pending = first.acquire(); try {
    await ready;
    try {
        await second.acquire();
        secondAcquired = true;
    }
    catch (e) {
        secondCode = e.code;
    }
    resume();
    await pending;
}
finally {
    resume();
    fs.open = originalOpen;
    syncBuiltinESMExports();
    await pending.catch(() => undefined);
    await first.release();
    await second.release();
} console.log('M04 observed', JSON.stringify({ firstAcquired: true, secondAcquired, secondCode })); assert.deepEqual({ secondAcquired, secondCode }, { secondAcquired: false, secondCode: 'RUNTIME_BUSY' }); });
