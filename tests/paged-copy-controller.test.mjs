import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../prototype/pr25-acceptance.mjs',import.meta.url),'utf8');
const html=await readFile(new URL('../prototype/pr25-acceptance.html',import.meta.url),'utf8');
const importHtml=await readFile(new URL('../prototype/pr28-testing.html',import.meta.url),'utf8');
const hubHtml=await readFile(new URL('../prototype/index.html',import.meta.url),'utf8');
const tick=()=>new Promise(setImmediate);
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
// Actual checked-in routing and event handlers. These tests replace browser,
// permission and storage seams; separate HTTP tests exercise the copy engines.
async function controller(search='?guide=v4') {
  const nodes=new Map(),calls={connect:[],release:0,pick:[],start:0,stop:0,targetRelease:0,backup:[],restore:[],export:[],migrate:[]};
  const state={folders:[],connected:false,paged:true,fail:null,pending:null,sourceOwnership:true,lifecycleState:'ready'};let storage;
  function element(){const handlers=new Map();return {hidden:false,disabled:false,files:[],textContent:'',dataset:{},
    addEventListener(type,fn){handlers.set(type,fn);},async emit(type){return handlers.get(type)?.();},click(){return this.emit('click');}};}
  for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],element());
  const get=id=>{assert.ok(nodes.has(id),id);return nodes.get(id);};
  class Storage {
    constructor(options){this.options=options;this.config={};this.folderId=null;this.lifecycle=null;storage=this;}
    async prepare(){}
    token(){return 'invented-controller-token';}
    async connect(options){calls.connect.push(options);if(state.fail==='connect')throw {code:'ownership-lost'};
      this.folderId='invented-source';this.lifecycle={state:state.lifecycleState,acceptingWrites:state.lifecycleState==='ready',pagedCanonical:state.paged,
        transactionAdapter:{folderId:this.folderId},manifestFileId:'invented-manifest',coordinator:{canWrite:true,
          withWrite:async fn=>{if(!state.sourceOwnership)throw {code:'ownership-lost'};return fn();},
          assertCanWrite:async()=>{if(!state.sourceOwnership)throw {code:'ownership-lost'};return {verified:true};}}};
      state.connected=true;this.options.onStatus?.({message:'Verified synthetic source'});}
    async release(){calls.release++;this.lifecycle=null;this.folderId=null;state.connected=false;}
  }
  class Coordinator {
    constructor({adapter}){this.folderId=adapter.folderId;this.canWrite=false;}
    async start(){calls.start++;if(state.fail==='target-owner')throw {code:'ownership-lost'};this.canWrite=true;}
    startHeartbeat(){return ()=>calls.stop++;}
    async withWrite(fn){return fn();}
    async assertCanWrite(){if(!this.canWrite)throw {code:'ownership-lost'};}
    async release(){calls.targetRelease++;this.canWrite=false;}
  }
  const operation=kind=>async options=>{calls[kind].push(options);
    if(options.assertSourceWritable)assert.equal(await options.assertSourceWritable(),undefined);
    if(state.pending)await state.pending.promise;
    if(state.fail===kind)throw {code:state.errorCode??'ownership-lost'};
    if(kind==='export'){await options.sink.write(new Uint8Array([1,2,3]));await options.sink.close?.();}
    return {objectCount:3};};
  const imports={DashboardSyntheticStorage:Storage,SessionCoordinator:Coordinator,
    createDriveSessionAdapter:options=>options,GoogleDriveTransactionAdapter:class{constructor(options){Object.assign(this,options);}},
    chooseSyntheticFolder:async options=>{calls.pick.push(options);const next=state.folders.shift();if(!next)throw {code:'picker-cancelled'};return {id:next};},
    canonicalPartitionVerificationPlans:()=>new Map(),verifyCanonicalMigrationEvidence(){},withSourceEvidenceVerification:p=>p,
    backupPagedCanonicalCopy:operation('backup'),restorePagedCanonicalArchive:operation('restore'),exportPagedCanonicalArchive:operation('export'),migrateLegacyCanonicalCopy:operation('migrate'),
    authorizeCopyGuide:async()=>{},inspectPagedCanonicalCopy:async()=>({manifestFileId:'invented-backup-manifest',manifest:{role:'backup'}}),
    storageError:(code,message)=>Object.assign(new Error(message),{code})};
  const context={...imports,document:{getElementById:get,createElement:element},location:{search},
    window:{},navigator:{onLine:true},confirm:()=>true,URL,Blob,Uint8Array,setTimeout:()=>0};
  vm.runInNewContext(source.replace(/^import .*;$/gm,''),context,{filename:'pr25-acceptance.mjs'});await tick();
  return {get,state,calls,storage,context,async click(id){if(!get(id).disabled)await get(id).emit('click');await tick();}};
}

for(const [label,page,selector] of [
  ['import next step',importHtml,/\bid="step-copy-guide"/],
  ['import extended tools',importHtml,/\bid="extended-copy-guide"/],
  ['tools menu',hubHtml,/>Guided backup and restore</]
]) {
  test(label+' navigation opens the actual v4 backup controller',async()=>{
    const link=[...page.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(match=>selector.test(match[0]));
    assert.ok(link,label+' link exists');
    const href=link[1].match(/\bhref="([^"]+)"/);
    assert.ok(href,label+' link has a destination');
    const target=new URL(href[1],new URL('../prototype/',import.meta.url));
    assert.equal(target.pathname,new URL('../prototype/pr25-acceptance.html',import.meta.url).pathname);
    assert.equal(target.search,'?guide=v4',label+' selects the v4 source route');
    const h=await controller(target.search);
    assert.equal(h.get('legacy-tools').hidden,true);assert.equal(h.get('v4-copy-tools').hidden,false);
    await h.click('v4-connect');h.state.folders.push('invented-navigation-backup');await h.click('v4-backup');
    assert.equal(h.calls.backup.length,1);assert.equal(h.calls.backup[0].sourceAdapter.folderId,'invented-source');
    assert.match(h.get('v4-result').textContent,/Verified v4 backup/);
  });
}

test('actual guide=v4 route connects only existing source, releases and selects legacy migration explicitly',async()=>{
  const h=await controller();assert.equal(h.get('legacy-tools').hidden,true);assert.equal(h.get('v4-copy-tools').hidden,false);
  assert.equal(h.get('v4-backup').disabled,true);await h.click('v4-connect');
  assert.equal(JSON.stringify(h.calls.connect),JSON.stringify([{requireExisting:true}]));
  assert.equal(h.get('v4-backup').disabled,false);assert.equal(h.get('v4-migrate').disabled,true);
  await h.click('v4-release');assert.equal(h.calls.release,1);assert.equal(h.get('v4-backup').disabled,true);
  h.state.paged=false;await h.click('v4-connect');assert.equal(h.get('v4-migrate').disabled,false);assert.equal(h.get('v4-backup').disabled,true);
});

test('destination picker cancellation performs no destination mutation and permits another attempt',async()=>{
  const h=await controller();await h.click('v4-connect');await h.click('v4-backup');
  assert.match(h.get('v4-result').textContent,/picker-cancelled/);assert.equal(h.calls.start,0);assert.equal(h.calls.backup.length,0);
  assert.equal(h.get('v4-backup').disabled,false);h.state.folders.push('invented-target');await h.click('v4-backup');
  assert.equal(h.calls.backup.length,1);assert.equal(h.calls.targetRelease,1);assert.equal(h.calls.stop,1);
});

test('copy handlers disable competing actions through completion and release destination on ownership failure',async()=>{
  const h=await controller();await h.click('v4-connect');h.state.folders.push('invented-target');h.state.pending=gate();h.state.fail='backup';
  const pending=h.click('v4-backup');await tick();assert.equal(h.calls.backup.length,1);
  for(const id of ['v4-connect','v4-release','v4-backup','v4-restore','v4-archive'])assert.equal(h.get(id).disabled,true,id);
  await h.click('v4-backup');assert.equal(h.calls.backup.length,1);
  h.state.pending.resolve();await pending;assert.equal(h.calls.targetRelease,1);assert.match(h.get('v4-result').textContent,/ownership-lost/);
  assert.equal(h.get('v4-backup').disabled,false);h.state.pending=null;h.state.fail=null;h.state.folders.push('invented-retry-target');await h.click('v4-backup');
  assert.match(h.get('v4-result').textContent,/Verified v4 backup/);assert.equal(h.calls.backup.length,2);
});

test('saved file restore works source-offline and forwards the actual selected stream',async()=>{
  const h=await controller(),stream={inventedStream:true};h.get('v4-archive').files=[{stream:()=>stream}];
  await h.get('v4-archive').emit('change');assert.equal(h.get('v4-restore').disabled,false);
  h.state.folders.push('invented-restore-target');await h.click('v4-restore');
  assert.equal(h.calls.connect.length,0);assert.equal(h.calls.restore.length,1);assert.equal(h.calls.restore[0].source,stream);
  assert.equal(h.calls.targetRelease,1);assert.match(h.get('v4-result').textContent,/No source bytes were read/);
});

test('read-only backup restore uses a fresh target and releases both owned sessions',async()=>{
  const h=await controller();h.state.folders.push('invented-backup','invented-primary');await h.click('v4-restore-backup');
  assert.equal(h.calls.backup.length,1);assert.equal(h.calls.backup[0].role,'primary');assert.equal(h.calls.backup[0].sourceAdapter.folderId,'invented-backup');
  assert.equal(h.calls.targetRelease,2);assert.equal(h.calls.stop,2);assert.equal(h.calls.connect.length,0);
});

test('native file export cancellation cannot claim saved success and retry writes the selected sink',async()=>{
  const h=await controller();await h.click('v4-connect');h.context.window.showSaveFilePicker=async()=>{throw {code:'picker-cancelled'};};
  await h.click('v4-export');assert.equal(h.calls.export.length,0);assert.match(h.get('v4-result').textContent,/Not completed/);
  const chunks=[];let closed=false;h.context.window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async chunk=>chunks.push(chunk),close:async()=>{closed=true;}})});
  await h.click('v4-export');assert.equal(chunks.length,1);assert.equal(closed,true);assert.match(h.get('v4-result').textContent,/written and closed/);
});


test('interrupted source is never announced verified or copied and can release its owned session',async()=>{
  const h=await controller();h.state.lifecycleState='recovery-required';await h.click('v4-connect');
  assert.match(h.get('v4-result').textContent,/not verified and ready/);assert.equal(h.get('v4-backup').disabled,true);
  assert.equal(h.get('v4-release').disabled,false);await h.click('v4-release');assert.equal(h.calls.release,1);
  h.state.lifecycleState='ready';await h.click('v4-connect');assert.equal(h.get('v4-backup').disabled,false);
});


test('unsupported legacy refund migration gives an actionable source-preserving correction',async()=>{
  const h=await controller();h.state.paged=false;await h.click('v4-connect');h.state.folders.push('invented-migration');
  h.state.fail='migrate';h.state.errorCode='unsupported-derived-projection';await h.click('v4-migrate');
  assert.match(h.get('v4-result').textContent,/save an explicit category correction/);assert.match(h.get('v4-result').textContent,/No source evidence was changed/);
  assert.equal(h.calls.targetRelease,1);assert.equal(h.get('v4-migrate').disabled,false);
});
