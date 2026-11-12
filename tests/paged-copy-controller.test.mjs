import { requireEmptySyntheticFolder } from '../js/dashboard-synthetic-storage.mjs';
import { showDiagnostic, clearDiagnostic } from '../js/app-diagnostics.mjs';
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
async function controller(search='?guide=v5') {
  const nodes=new Map(),calls={connect:[],release:0,pick:[],start:0,stop:0,targetRelease:0,backup:[],restore:[],export:[],migrate:[]};
  const state={folderFiles:[],folders:[],connected:false,paged:true,fail:null,pending:null,sourceOwnership:true,lifecycleState:'ready'};let storage;
  function element(){const handlers=new Map();return {hidden:false,disabled:false,files:[],textContent:'',dataset:{},children:[],attributes:{},
    append(...items){this.children.push(...items);},setAttribute(key,value){this.attributes[key]=value;},
    insertAdjacentElement(position,node){this.diagnosticPanel=node;},remove(){},focus(){},select(){},
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
    async release(){calls.targetRelease++;if(state.fail==='target-release')throw {code:'ownership-lost'};this.canWrite=false;}
  }
  const operation=kind=>async options=>{calls[kind].push(options);
    if(options.assertSourceWritable)assert.equal(await options.assertSourceWritable(),undefined);
    if(state.pending)await state.pending.promise;
    if(state.fail===kind)throw {code:state.errorCode??'ownership-lost'};
    if(kind==='export'){await options.sink.write(new Uint8Array([1,2,3]));await options.sink.close?.();}
    return {objectCount:3};};
  const imports={requireEmptySyntheticFolder,DashboardSyntheticStorage:Storage,SessionCoordinator:Coordinator,
    createDriveSessionAdapter:options=>options,GoogleDriveTransactionAdapter:class{constructor(options){Object.assign(this,options);}async listChildren(){return state.folderFiles;}},
    chooseSyntheticFolder:async options=>{calls.pick.push(options);const next=state.folders.shift();if(!next)throw {code:'picker-cancelled'};return {id:next};},
    canonicalPartitionVerificationPlans:()=>new Map(),withSourceEvidenceVerification:p=>p,
    backupPagedCanonicalCopy:operation('backup'),restorePagedCanonicalArchive:operation('restore'),exportPagedCanonicalArchive:operation('export'),
    authorizeCopyGuide:async()=>{},inspectPagedCanonicalCopy:async()=>({manifestFileId:'invented-backup-manifest',manifest:{role:'backup'}}),
    storageError:(code,message)=>Object.assign(new Error(message),{code})};
  const context={...imports,document:{getElementById:get,createElement:element},location:{search},
    window:{},navigator:{onLine:true},confirm:()=>true,URL,Blob,Uint8Array,setTimeout:()=>0};
  context.clearDiagnostic=clearDiagnostic;
  context.showDiagnostic=(error,options)=>showDiagnostic(error,{...options,document:context.document,navigator:context.navigator});
  vm.runInNewContext(source.replace(/^import .*;$/gm,''),context,{filename:'pr25-acceptance.mjs'});await tick();
  return {get,state,calls,storage,context,async click(id){if(!get(id).disabled)await get(id).emit('click');await tick();}};
}

for(const [label,page,selector] of [
  ['import next step',importHtml,/\bid="step-copy-guide"/],
  ['import extended tools',importHtml,/\bid="extended-copy-guide"/],
  ['tools menu',hubHtml,/>Guided backup and restore</]
]) {
  test(label+' navigation opens the actual v5 backup controller',async()=>{
    const link=[...page.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(match=>selector.test(match[0]));
    assert.ok(link,label+' link exists');
    const href=link[1].match(/\bhref="([^"]+)"/);
    assert.ok(href,label+' link has a destination');
    const target=new URL(href[1],new URL('../prototype/',import.meta.url));
    assert.equal(target.pathname,new URL('../prototype/pr25-acceptance.html',import.meta.url).pathname);
    assert.equal(target.search,'?guide=v5',label+' selects the v5 source route');
    const h=await controller(target.search);
    assert.equal(h.get('v5-copy-tools').hidden,false);
    await h.click('v5-connect');h.state.folders.push('invented-navigation-backup');await h.click('v5-backup');
    assert.equal(h.calls.backup.length,1);assert.equal(h.calls.backup[0].sourceAdapter.folderId,'invented-source');
    assert.match(h.get('v5-result').textContent,/Verified paged backup/);
  });
}

test('actual guide=v5 route connects only existing source, and releases without legacy migration controls',async()=>{
  const h=await controller();assert.equal(h.get('v5-copy-tools').hidden,false);
  assert.equal(h.get('v5-backup').disabled,true);await h.click('v5-connect');
  assert.equal(JSON.stringify(h.calls.connect),JSON.stringify([{requireExisting:true}]));
  assert.equal(h.get('v5-backup').disabled,false);
  await h.click('v5-release');assert.equal(h.calls.release,1);assert.equal(h.get('v5-backup').disabled,true);
});

test('destination picker cancellation performs no destination mutation and permits another attempt',async()=>{
  const h=await controller();await h.click('v5-connect');await h.click('v5-backup');
  assert.match(h.get('v5-result').textContent,/picker-cancelled/);assert.equal(h.calls.start,0);assert.equal(h.calls.backup.length,0);
  const panel=h.get('v5-result').diagnosticPanel;
  assert.equal(panel.attributes['aria-label'],'Safe error diagnostics');
  assert.equal(panel.children[2].textContent,'Copy diagnostics');
  assert.equal(JSON.parse(panel.children[1].children[0].value).surface,'developer-tool');
  assert.equal(h.get('v5-backup').disabled,false);h.state.folders.push('invented-target');await h.click('v5-backup');
  assert.equal(panel.hidden,true,'new action removes the old diagnostic panel');
  assert.equal(h.calls.backup.length,1);assert.equal(h.calls.targetRelease,1);assert.equal(h.calls.stop,1);
});

test('copy handlers disable competing actions through completion and release destination on ownership failure',async()=>{
  const h=await controller();await h.click('v5-connect');h.state.folders.push('invented-target');h.state.pending=gate();h.state.fail='backup';
  const pending=h.click('v5-backup');await tick();assert.equal(h.calls.backup.length,1);
  for(const id of ['v5-connect','v5-release','v5-backup','v5-restore','v5-archive'])assert.equal(h.get(id).disabled,true,id);
  await h.click('v5-backup');assert.equal(h.calls.backup.length,1);
  h.state.pending.resolve();await pending;assert.equal(h.calls.targetRelease,1);assert.match(h.get('v5-result').textContent,/ownership-lost/);
  assert.equal(h.get('v5-backup').disabled,false);h.state.pending=null;h.state.fail=null;h.state.folders.push('invented-retry-target');await h.click('v5-backup');
  assert.match(h.get('v5-result').textContent,/Verified paged backup/);assert.equal(h.calls.backup.length,2);
});

test('saved file restore works source-offline and forwards the actual selected stream',async()=>{
  const h=await controller(),stream={inventedStream:true};h.get('v5-archive').files=[{stream:()=>stream}];
  await h.get('v5-archive').emit('change');assert.equal(h.get('v5-restore').disabled,false);
  h.state.folders.push('invented-restore-target');await h.click('v5-restore');
  assert.equal(h.calls.connect.length,0);assert.equal(h.calls.restore.length,1);assert.equal(h.calls.restore[0].source,stream);
  assert.equal(h.calls.targetRelease,1);assert.match(h.get('v5-result').textContent,/No source bytes were read/);
});

test('read-only backup restore uses a fresh target and releases both owned sessions',async()=>{
  const h=await controller();h.state.folders.push('invented-backup','invented-primary');await h.click('v5-restore-backup');
  assert.equal(h.calls.backup.length,1);assert.equal(h.calls.backup[0].role,'primary');assert.equal(h.calls.backup[0].sourceAdapter.folderId,'invented-backup');
  assert.equal(h.calls.targetRelease,2);assert.equal(h.calls.stop,2);assert.equal(h.calls.connect.length,0);
});

test('native file export cancellation cannot claim saved success and retry writes the selected sink',async()=>{
  const h=await controller();await h.click('v5-connect');h.context.window.showSaveFilePicker=async()=>{throw {code:'picker-cancelled'};};
  await h.click('v5-export');assert.equal(h.calls.export.length,0);assert.match(h.get('v5-result').textContent,/Error code: picker-cancelled/);
  const chunks=[];let closed=false;h.context.window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async chunk=>chunks.push(chunk),close:async()=>{closed=true;}})});
  await h.click('v5-export');assert.equal(chunks.length,1);assert.equal(closed,true);assert.match(h.get('v5-result').textContent,/written and closed/);
});


test('interrupted source is never announced verified or copied and can release its owned session',async()=>{
  const h=await controller();h.state.lifecycleState='recovery-required';await h.click('v5-connect');
  assert.match(h.get('v5-result').textContent,/not verified and ready/);assert.equal(h.get('v5-backup').disabled,true);
  assert.equal(h.get('v5-release').disabled,false);await h.click('v5-release');assert.equal(h.calls.release,1);
  h.state.lifecycleState='ready';await h.click('v5-connect');assert.equal(h.get('v5-backup').disabled,false);
});



test('copy page exposes only v5 controls and no legacy migration entry point',()=>{
  assert.doesNotMatch(html,/legacy-tools|migrate|guide=pr28/);
  assert.doesNotMatch(source,/migrateLegacy|catalog-backup|pr25-copy-guide/);
});

test('same-folder destination is refused before claiming or copying',async()=>{
 const h=await controller();await h.click('v5-connect');h.state.folders.push('invented-source');await h.click('v5-backup');
 assert.equal(h.calls.start,0);assert.equal(h.calls.backup.length,0);assert.match(h.get('v5-result').textContent,/Action did not complete/);
});

test('destination release failure cannot become a successful copy result',async()=>{
 const h=await controller();await h.click('v5-connect');h.state.folders.push('invented-release-failure');h.state.fail='target-release';await h.click('v5-backup');
 assert.equal(h.calls.backup.length,1);assert.equal(h.calls.targetRelease,1);assert.equal(h.calls.stop,1);assert.match(h.get('v5-result').textContent,/ownership-lost/);
 assert.doesNotMatch(h.get('v5-result').textContent,/Verified paged backup/);assert.equal(h.get('v5-backup').disabled,false);
});

test('failed saved-file verification never announces restore success',async()=>{
 const h=await controller();h.get('v5-archive').files=[{stream:()=>({invalid:true})}];await h.get('v5-archive').emit('change');
 h.state.folders.push('invented-invalid-file');h.state.fail='restore';h.state.errorCode='restore-incomplete';await h.click('v5-restore');
 assert.match(h.get('v5-result').textContent,/Action did not complete/);assert.doesNotMatch(h.get('v5-result').textContent,/independently restored/);assert.equal(h.calls.targetRelease,1);
});

for(const [name,file] of [
 ['legacy manifest',{name:'ft-synthetic-dashboard-manifest.json'}],
 ['unknown file',{name:'invented-unknown.bin'}],
 ['existing session',{name:'finance-tracker-active-session.json',appProperties:{financeTrackerSession:'v1'}}]
])test(`${name} destination is refused without claiming a session or copying`,async()=>{
 const h=await controller();await h.click('v5-connect');h.state.folders.push('invented-nonempty-target');h.state.folderFiles=[file];
 await h.click('v5-backup');
 assert.equal(h.calls.start,0);assert.equal(h.calls.targetRelease,0);assert.equal(h.calls.backup.length,0);
 assert.equal(h.state.folderFiles[0],file);assert.match(h.get('v5-result').textContent,/empty-folder-required/);
 h.state.folderFiles=[];h.state.folders.push('invented-new-empty-target');await h.click('v5-backup');
 assert.equal(h.calls.start,1);assert.equal(h.calls.backup.length,1);
});
