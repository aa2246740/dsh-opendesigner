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
const { CheckpointLog } = await load('server/checkpoints.ts');
const { materializeRestorePlan, validateRestorePlan, applyRestorePlan } = await load('server/sourceOverlay.ts');
const { git } = await load('server/gitExec.ts');
const hash = s => contentHash(Buffer.from(s));
const exists = p => fs.stat(p).then(() => true, () => false);
async function tmp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'od-pr6-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function fixture(t) {
  const root = await tmp(t);
  await git(root, ['init', '-b', 'main']);
  await fs.writeFile(path.join(root, 'a.txt'), 'BASE');
  await git(root, ['add', '.']);
  await git(root, ['-c', 'user.name=Review', '-c', 'user.email=review@local', 'commit', '-m', 'base']);
  const reg = new AgentBatchRegistry(root, path.join(root, '.designer', 'batches.json'));
  const b = await reg.create();
  return { root, reg, b, wt: reg.worktreeAbs(b) };
}
async function recoveryFixture(t, rows) {
  const root = await tmp(t);
  const file = path.join(root, '.designer', 'apply-journal.json');
  const j = new ApplyJournal(root, 'w', file);
  const ops = rows.map(row => ({kind: 'write', rel: row.rel,
    beforeHash: row.before === null ? null : hash(row.before), afterHash: hash(row.after)}));
  for (const row of rows) {
    if (row.before !== null) await fs.writeFile(path.join(root, row.rel), row.before);
  }
  const entry = await j.begin('batch-test', ops);
  const backups = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], target = path.join(root, row.rel);
    const backup = row.before === null ? null : await j.backupFile(j.stagingDir('batch-test'), row.rel, target);
    backups[row.rel] = backup;
    await j.recordBackup(entry, row.rel, backup, ops[i]);
  }
  for (const row of rows) await fs.writeFile(path.join(root, row.rel), row.current ?? row.after);
  return {root, file, j, backups};
}
async function recoverObservation(f) {
  let code = null, result = null;
  try { result = await f.j.recover(); } catch (e) { code = e.code ?? e.message; }
  return { code, result, journalRetained: await exists(f.file) };
}

test('P01 approved A survives consume-persist hook that captures and issues unconsumed B', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.wt, 'a.txt'), 'APPROVED_A');
  const a = await f.reg.captureFrozen(f.b.batchId);
  const ledger = new ApprovalLedger(path.join(f.root, '.designer', 'receipts.json'));
  const fields = {projectId: a.projectId, revision: 1, tool: 'batch_apply'};
  const hA = hashFrozenChangeset(a);
  const receipt = await ledger.issue({...fields, diffHash: hA});
  let invoked = false, hB;
  ledger.beforePersist = async () => {
    if (invoked) return;
    invoked = true;
    await fs.writeFile(path.join(f.wt, 'a.txt'), 'NOT_ACCEPTED_B');
    const b = await f.reg.captureFrozen(f.b.batchId);
    hB = hashFrozenChangeset(b);
    await ledger.issue({...fields, diffHash: hB});
  };
  await ledger.consume({...fields, receiptId: receipt.id, diffHash: hA});
  assert.notEqual(hA, hB);
  await f.reg.apply(f.b.batchId);
  const content = await fs.readFile(path.join(f.root, 'a.txt'), 'utf8');
  console.log('P01 observed', JSON.stringify({content, hookRan:invoked}));
  assert.equal(content, 'APPROVED_A');
});

test('P02 new single-file quiet-preserve branch keeps USER_REPAIR', async t => {
  const f = await recoveryFixture(t, [{rel:'a.txt',before:'BASE',after:'AGENT',current:'USER_REPAIR'}]);
  const r = await recoverObservation(f);
  assert.equal(r.code, 'BATCH_RECOVERY_BLOCKED');
  assert.equal(await fs.readFile(path.join(f.root, 'a.txt'), 'utf8'), 'USER_REPAIR');
  assert.equal(r.journalRetained, true);
});

test('P03 valid two-file rollback restores both before images', async t => {
  const f = await recoveryFixture(t, [
    {rel:'a.txt',before:'BASE_A',after:'AGENT_A'},
    {rel:'b.txt',before:'BASE_B',after:'AGENT_B'}
  ]);
  assert.equal((await f.j.recover()).recovered, true);
  assert.equal(await fs.readFile(path.join(f.root,'a.txt'),'utf8'),'BASE_A');
  assert.equal(await fs.readFile(path.join(f.root,'b.txt'),'utf8'),'BASE_B');
});

test('P04 checkpoint fallback metadata survives serialization without overlay files', async t => {
  const root = await tmp(t), file = path.join(root, 'checkpoints.json');
  const store = {byId:{},childrenByParent:{},parentByChild:{},pages:[],activePageId:''};
  const first = new CheckpointLog(file);
  await first.push({label:'identity',kind:'source',store,workspaceId:'w',worktreeKey:'.designer/worktrees/b'});
  const second = new CheckpointLog(file);
  await second.load();
  assert.equal(second.current().workspaceId, 'w');
  assert.equal(second.current().worktreeKey, '.designer/worktrees/b');
});

test('F01 mixed recovery must not overwrite the file it classified as user repair', async t => {
  const f = await recoveryFixture(t, [
    {rel:'a.txt',before:'BASE_A',after:'AGENT_A',current:'USER_REPAIR_A'},
    {rel:'b.txt',before:'BASE_B',after:'AGENT_B'}
  ]);
  const r = await recoverObservation(f);
  const a = await fs.readFile(path.join(f.root,'a.txt'),'utf8');
  const b = await fs.readFile(path.join(f.root,'b.txt'),'utf8');
  console.log('F01 observed',JSON.stringify({...r,a,b}));
  assert.equal(a,'USER_REPAIR_A','may block the whole transaction, but must preserve user bytes');
});

test('F02 grown file truncated after old length must remain blocked with journal', async t => {
  const after = 'AGENT_FULL_NEW_PAYLOAD';
  const partial = after.slice(0,8);
  const f = await recoveryFixture(t,[{rel:'a.txt',before:'x',after,current:partial}]);
  const r = await recoverObservation(f);
  console.log('F02 observed',JSON.stringify({...r,beforeLength:1,partialLength:partial.length,afterLength:after.length}));
  assert.equal(r.code,'BATCH_RECOVERY_BLOCKED');
  assert.equal(r.journalRetained,true);
  assert.equal(await fs.readFile(path.join(f.root,'a.txt'),'utf8'),partial);
});

test('F03 partially written newly created file must not clear recovery evidence', async t => {
  const after = 'NEW_FILE_COMPLETE_CONTENT';
  const partial = after.slice(0,4);
  const f = await recoveryFixture(t,[{rel:'a.txt',before:null,after,current:partial}]);
  const r = await recoverObservation(f);
  console.log('F03 observed',JSON.stringify({...r,partial,afterLength:after.length}));
  assert.equal(r.code,'BATCH_RECOVERY_BLOCKED');
  assert.equal(r.journalRetained,true);
});

test('F04 unreadable current state must block rather than silently clearing journal', async t => {
  const f = await recoveryFixture(t,[{rel:'a.txt',before:'BASE',after:'AGENT'}]);
  await fs.rm(path.join(f.root,'a.txt'));
  await fs.mkdir(path.join(f.root,'a.txt'));
  const r = await recoverObservation(f);
  console.log('F04 observed',JSON.stringify(r));
  assert.equal(r.code,'BATCH_RECOVERY_BLOCKED');
  assert.equal(r.journalRetained,true);
  assert.equal((await fs.stat(path.join(f.root,'a.txt'))).isDirectory(),true);
});

test('F05 added validateRestorePlan must prevent the existing directory-conflict partial rewind', async t => {
  const root = await tmp(t);
  await fs.writeFile(path.join(root,'a.txt'),'CURRENT_A');
  await fs.mkdir(path.join(root,'b.txt'));
  const overlay = {workspaceId:'w',worktreeKey:'.',files:{
    'a.txt':{kind:'text',text:'OLD_A'}, 'b.txt':{kind:'text',text:'OLD_B'}
  }};
  let code = null, validatorAccepted = false;
  try {
    const plan = materializeRestorePlan(root,overlay);
    validateRestorePlan(plan);
    validatorAccepted = true;
    await applyRestorePlan(plan);
  } catch(e) { code = e.code ?? e.message; }
  const content = await fs.readFile(path.join(root,'a.txt'),'utf8');
  console.log('F05 observed',JSON.stringify({code,validatorAccepted,content}));
  assert.ok(code);
  assert.equal(content,'CURRENT_A');
});
