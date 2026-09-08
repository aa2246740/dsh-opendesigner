import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const src=process.env.REVIEW_SOURCE_ROOT||path.resolve(import.meta.dirname,'../source');
const {AgentBatchRegistry}=await import(pathToFileURL(path.join(src,'server/agentBatch.ts')));
const {CheckpointLog}=await import(pathToFileURL(path.join(src,'server/checkpoints.ts')));
const {resolveProjectPath}=await import(pathToFileURL(path.join(src,'server/pathJail.ts')));
const {git}=await import(pathToFileURL(path.join(src,'server/gitExec.ts')));
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'pr3-review-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function fixture(t,files={}){
 const root=await temp(t);await git(root,['init','-b','main']);
 for(const [rel,data] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,rel)),{recursive:true});await fs.writeFile(path.join(root,rel),data);}
 await git(root,['add','.']);await git(root,['-c','user.name=Review','-c','user.email=review@local','commit','--allow-empty','-m','base']);
 const reg=new AgentBatchRegistry(root,path.join(root,'.designer','batches.json'));
 return {root,reg};
}
async function batch(f){const b=await f.reg.create('review');return {...f,b,wt:f.reg.worktreeAbs(b)};}
const snapshot=()=>({byId:{x:{id:'x',props:{color:'red'}}},childrenByParent:{},parentByChild:{},pages:[],activePageId:''});

test('C01 normal in-project file access remains available',async t=>{const root=await temp(t);await fs.writeFile(path.join(root,'a.txt'),'ok');assert.equal(await fs.readFile(resolveProjectPath(root,'a.txt'),'utf8'),'ok');});
test('C02 existing external symlink target is rejected',async t=>{const root=await temp(t);const project=path.join(root,'project');await fs.mkdir(project);await fs.writeFile(path.join(root,'outside.txt'),'outside');await fs.symlink(path.join(root,'outside.txt'),path.join(project,'link'));assert.throws(()=>resolveProjectPath(project,'link'),e=>e.code==='PATH_JAIL');});
test('N01 dangling external symlink must not create a file outside the project',async t=>{const root=await temp(t);const project=path.join(root,'project');await fs.mkdir(project);const target=path.join(root,'outside-new.txt');await fs.symlink(target,path.join(project,'link'));let denied=false;try{await fs.writeFile(resolveProjectPath(project,'link'),'OUTSIDE_WRITE');}catch(e){if(e.code==='PATH_JAIL')denied=true;else throw e;}assert.equal(denied,true,'external target did not exist: realpath fell back to project and write escaped');});
test('C03 dirty worktree creation fails closed',async t=>{const f=await fixture(t,{'a.txt':'base'});await fs.writeFile(path.join(f.root,'a.txt'),'user');await assert.rejects(f.reg.create(),e=>e.code==='DIRTY_WORKTREE');assert.equal(await fs.readFile(path.join(f.root,'a.txt'),'utf8'),'user');});
test('C04 text edit conflict protects the main file',async t=>{const f=await batch(await fixture(t,{'a.txt':'base'}));await fs.writeFile(path.join(f.wt,'a.txt'),'agent');await fs.writeFile(path.join(f.root,'a.txt'),'user');await assert.rejects(f.reg.apply(f.b.batchId),e=>e.code==='BATCH_CONFLICT');assert.equal(await fs.readFile(path.join(f.root,'a.txt'),'utf8'),'user');});
test('N02 concurrent user deletion must be a modify/delete conflict',async t=>{const f=await batch(await fixture(t,{'a.txt':'base'}));await fs.writeFile(path.join(f.wt,'a.txt'),'agent');await fs.unlink(path.join(f.root,'a.txt'));let denied=false;try{await f.reg.apply(f.b.batchId);}catch(e){if(e.code==='BATCH_CONFLICT')denied=true;else throw e;}const exists=await fs.stat(path.join(f.root,'a.txt')).then(()=>true,()=>false);assert.deepEqual({denied,exists},{denied:true,exists:false},'apply silently resurrected a file deliberately deleted by the user');});
test('N03 binary conflict detection must compare bytes, not lossy UTF-8 text',async t=>{const f=await batch(await fixture(t,{'asset.bin':Buffer.from([0x80,0])}));const user=Buffer.from([0x81,0]),agent=Buffer.from([0x82,0]);await fs.writeFile(path.join(f.root,'asset.bin'),user);await fs.writeFile(path.join(f.wt,'asset.bin'),agent);let denied=false;try{await f.reg.apply(f.b.batchId);}catch(e){if(e.code==='BATCH_CONFLICT')denied=true;else throw e;}const actual=await fs.readFile(path.join(f.root,'asset.bin'));assert.deepEqual({denied,hex:actual.toString('hex')},{denied:true,hex:user.toString('hex')},'different byte sequences became the same UTF-8 replacement string');});
test('C05 committed Agent worktree changes are applied',async t=>{const f=await batch(await fixture(t,{'a.txt':'base'}));await fs.writeFile(path.join(f.wt,'a.txt'),'agent');await git(f.wt,['add','.']);await git(f.wt,['-c','user.name=Review','-c','user.email=review@local','commit','-m','agent']);await f.reg.apply(f.b.batchId);assert.equal(await fs.readFile(path.join(f.root,'a.txt'),'utf8'),'agent');});
test('C06 Chinese rename removes the old file and keeps the new file',async t=>{const f=await batch(await fixture(t,{'旧名.txt':'base'}));await git(f.wt,['mv','旧名.txt','按钮.tsx']);await f.reg.apply(f.b.batchId);assert.equal(await fs.readFile(path.join(f.root,'按钮.tsx'),'utf8'),'base');await assert.rejects(fs.stat(path.join(f.root,'旧名.txt')),e=>e.code==='ENOENT');});
test('C07 caught later-file failure rolls back earlier write',async t=>{const f=await batch(await fixture(t,{'a.txt':'base-a','b.txt':'base-b'}));await fs.writeFile(path.join(f.wt,'a.txt'),'agent-a');await fs.writeFile(path.join(f.wt,'b.txt'),'agent-b');await fs.unlink(path.join(f.root,'b.txt'));await fs.mkdir(path.join(f.root,'b.txt'));await assert.rejects(f.reg.apply(f.b.batchId));assert.equal(await fs.readFile(path.join(f.root,'a.txt'),'utf8'),'base-a');});
test('C08 checkpoints isolate inputs and rewind return values',async t=>{const root=await temp(t);const log=new CheckpointLog(path.join(root,'history.json'));const s=snapshot();await log.push({label:'base',kind:'canvas',store:s});s.byId.x.props.color='blue';await log.push({label:'next',kind:'canvas',store:s});const restored=await log.rewind();assert.equal(restored.store.byId.x.props.color,'red');restored.store.byId.x.props.color='yellow';assert.equal(log.entries[0].store.byId.x.props.color,'red');});
