import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const source = process.env.REVIEW_SOURCE_ROOT || path.resolve(import.meta.dirname, '../source');
const load = p => import(pathToFileURL(path.join(source, p)));
const { AgentBatchRegistry } = await load('server/agentBatch.ts');
const { ApplyJournal } = await load('server/applyJournal.ts');
const { ApprovalLedger } = await load('server/approvalReceipt.ts');
const { hashFrozenChangeset } = await load('server/frozenChangeset.ts');
const { contentHash } = await load('server/fileBytes.ts');
const { git } = await load('server/gitExec.ts');
const hash = s => contentHash(Buffer.from(s));
async function tmp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'od-pr6-review-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function fixture(t) { const root = await tmp(t); await git(root, ['init', '-b', 'main']); await fs.writeFile(path.join(root, 'a.txt'), 'BASE'); await git(root, ['add', '.']); await git(root, ['-c', 'user.name=Review', '-c', 'user.email=review@local', 'commit', '-m', 'base']); const reg = new AgentBatchRegistry(root, path.join(root, '.designer', 'batches.json')); const b = await reg.create(); return { root, reg, b, wt: reg.worktreeAbs(b) }; }
async function journal(t, { before = 'BASE', after = 'AGENT', kind = 'write' } = {}) { const root = await tmp(t); const file = path.join(root, '.designer', 'apply-journal.json'); const target = path.join(root, 'a.txt'); if (before !== null)
    await fs.writeFile(target, before); const j = new ApplyJournal(root, 'w', file); const hashes = { beforeHash: before === null ? null : hash(before), afterHash: after === null ? null : hash(after) }; const entry = await j.begin('b', [{ rel: 'a.txt', kind, ...hashes }]); const backup = before === null ? null : await j.backupFile(j.stagingDir('b'), 'a.txt', target); await j.recordBackup(entry, 'a.txt', backup, hashes); if (after === null)
    await fs.rm(target, { force: true });
else
    await fs.writeFile(target, after); return { root, file, target, j, backup }; }
async function mixedJournal(t, files) {
    const root = await tmp(t);
    const file = path.join(root, '.designer', 'apply-journal.json');
    const j = new ApplyJournal(root, 'w', file);
    const planned = files.map(f => ({ rel: f.rel, kind: 'write', beforeHash: f.before === null ? null : hash(f.before), afterHash: hash(f.after) }));
    const entry = await j.begin('b', planned);
    const staging = j.stagingDir('b');
    for (const f of files) {
        const target = path.join(root, f.rel);
        if (f.before !== null)
            await fs.writeFile(target, f.before);
        const backup = f.before === null ? null : await j.backupFile(staging, f.rel, target);
        await j.recordBackup(entry, f.rel, backup, { beforeHash: f.before === null ? null : hash(f.before), afterHash: hash(f.after) });
        await fs.writeFile(target, f.current);
    }
    return { root, file, j };
}
async function blockedRecover(f) { let code = null; try {
        await f.j.recover();
    }
    catch (e) {
        code = e.code;
    } return code; }
async function exists(p) { return fs.stat(p).then(() => true, () => false); }
test('P01 consume persist race still writes APPROVED_A not NOT_ACCEPTED_B', async (t) => { const f = await fixture(t); await fs.writeFile(path.join(f.wt, 'a.txt'), 'APPROVED_A'); const frozenA = await f.reg.captureFrozen(f.b.batchId); const hashA = hashFrozenChangeset(frozenA); const ledger = new ApprovalLedger(path.join(f.root, '.designer', 'receipts.json')); const fields = { projectId: frozenA.projectId, revision: 1, tool: 'batch_apply' }; const receiptA = await ledger.issue({ ...fields, diffHash: hashA }); ledger.beforePersist = async () => { await fs.writeFile(path.join(f.wt, 'a.txt'), 'NOT_ACCEPTED_B'); const frozenB = await f.reg.captureFrozen(f.b.batchId); const hashB = hashFrozenChangeset(frozenB); assert.notEqual(hashB, hashA); await ledger.issue({ ...fields, diffHash: hashB }); }; await ledger.consume({ ...fields, receiptId: receiptA.id, diffHash: hashA }); const applied = await f.reg.apply(f.b.batchId); assert.equal(applied.status, 'applied'); const main = await fs.readFile(path.join(f.root, 'a.txt'), 'utf8'); console.log('P01 observed', JSON.stringify({ status: applied.status, main })); assert.equal(main, 'APPROVED_A'); assert.notEqual(main, 'NOT_ACCEPTED_B'); });
test('P02 third-state USER_REPAIR is fail-closed: BLOCKED, bytes and journal retained', async (t) => { const f = await journal(t); await fs.writeFile(f.target, 'USER_REPAIR'); const code = await blockedRecover(f); const observation = { code, content: await fs.readFile(f.target, 'utf8'), journalRetained: await exists(f.file) }; console.log('P02 observed', JSON.stringify(observation)); assert.deepEqual(observation, { code: 'BATCH_RECOVERY_BLOCKED', content: 'USER_REPAIR', journalRetained: true }); });
test('P03 fully evidenced two-file interrupt still restores both backups', async (t) => { const f = await mixedJournal(t, [{ rel: 'a.txt', before: 'BASE_A', after: 'AGENT_A', current: 'AGENT_A' }, { rel: 'b.txt', before: 'BASE_B', after: 'AGENT_B', current: 'AGENT_B' }]); const result = await f.j.recover(); const observation = { recovered: result.recovered, a: await fs.readFile(path.join(f.root, 'a.txt'), 'utf8'), b: await fs.readFile(path.join(f.root, 'b.txt'), 'utf8'), journalRetained: await exists(f.file) }; console.log('P03 observed', JSON.stringify(observation)); assert.deepEqual(observation, { recovered: true, a: 'BASE_A', b: 'BASE_B', journalRetained: false }); });
test('P04 classic truncated half-write AGE vs AGENT_FULL stays BLOCKED', async (t) => { const f = await journal(t, { after: 'AGENT_FULL' }); await fs.writeFile(f.target, 'AGE'); const code = await blockedRecover(f); const observation = { code, content: await fs.readFile(f.target, 'utf8'), journalRetained: await exists(f.file) }; console.log('P04 observed', JSON.stringify(observation)); assert.deepEqual(observation, { code: 'BATCH_RECOVERY_BLOCKED', content: 'AGE', journalRetained: true }); });
test('F01 mixed USER_REPAIR_A + AGENT_B must not overwrite a with BASE_A', async (t) => { const orders = [[{ rel: 'a.txt', before: 'BASE_A', after: 'AGENT_A', current: 'USER_REPAIR_A' }, { rel: 'b.txt', before: 'BASE_B', after: 'AGENT_B', current: 'AGENT_B' }], [{ rel: 'b.txt', before: 'BASE_B', after: 'AGENT_B', current: 'AGENT_B' }, { rel: 'a.txt', before: 'BASE_A', after: 'AGENT_A', current: 'USER_REPAIR_A' }]]; for (const files of orders) {
        const f = await mixedJournal(t, files);
        const code = await blockedRecover(f);
        const a = await fs.readFile(path.join(f.root, 'a.txt'), 'utf8');
        const b = await fs.readFile(path.join(f.root, 'b.txt'), 'utf8');
        const journalRetained = await exists(f.file);
        console.log('F01 observed', JSON.stringify({ order: files.map(x => x.rel).join(','), code, a, b, journalRetained }));
        assert.equal(code, 'BATCH_RECOVERY_BLOCKED');
        assert.equal(a, 'USER_REPAIR_A');
        assert.equal(b, 'AGENT_B');
        assert.equal(journalRetained, true);
        assert.notEqual(a, 'BASE_A');
    } });
test('F02 expanding partial (before=x, 22-byte candidate, first 8 bytes) blocks and keeps journal', async (t) => { const after = 'CANDIDATE_BYTES_22CH!!'; assert.equal(after.length, 22); const f = await journal(t, { before: 'x', after }); await fs.writeFile(f.target, after.slice(0, 8)); const code = await blockedRecover(f); const observation = { code, content: await fs.readFile(f.target, 'utf8'), journalRetained: await exists(f.file) }; console.log('F02 observed', JSON.stringify(observation)); assert.deepEqual(observation, { code: 'BATCH_RECOVERY_BLOCKED', content: after.slice(0, 8), journalRetained: true }); });
test('F03 new-file partial NEW_ blocks and keeps journal', async (t) => { const f = await journal(t, { before: null, after: 'NEW_FILE_FULL_BYTES' }); await fs.writeFile(f.target, 'NEW_'); const code = await blockedRecover(f); const observation = { code, content: await fs.readFile(f.target, 'utf8'), journalRetained: await exists(f.file) }; console.log('F03 observed', JSON.stringify(observation)); assert.deepEqual(observation, { code: 'BATCH_RECOVERY_BLOCKED', content: 'NEW_', journalRetained: true }); });
test('F04 file replaced by directory blocks and keeps journal', async (t) => { const f = await journal(t); await fs.rm(f.target); await fs.mkdir(f.target); const code = await blockedRecover(f); const st = await fs.lstat(f.target); const observation = { code, isDirectory: st.isDirectory(), journalRetained: await exists(f.file) }; console.log('F04 observed', JSON.stringify(observation)); assert.deepEqual(observation, { code: 'BATCH_RECOVERY_BLOCKED', isDirectory: true, journalRetained: true }); });
