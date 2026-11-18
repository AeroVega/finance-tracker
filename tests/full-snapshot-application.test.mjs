import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {FullSnapshotApplication,inspectFullSnapshotFolder} from '../js/full-snapshot-application.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
function setup(onStatus=()=>{}){const http=new HttpFullSnapshotDrive(),target=new EventTarget();const lifecycle=new FullSnapshotApplication({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto,isOnline:()=>true,lifecycleTarget:target,onStatus,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},visibilityDelayMs:0});return {http,lifecycle,target};}
const close=async h=>{h.http.beforeResponse=null;h.http.reboot();await h.lifecycle.release().catch(()=>{});};
test('full snapshot bridge seeds preview, edits, saves and reopens through real workspace session',async()=>{
 const h=setup(),storage={lifecycle:null,async connect(){this.lifecycle=h.lifecycle;await h.lifecycle.start({initialize:true});},createLedgerStore(){return this.lifecycle.createLedgerStore();}};
 const session=new CanonicalWorkspaceSession({storage,online:()=>true});try{
  session.preview(replayFixture(1).ledger);await session.savePreviewToNewCopy();assert.equal(session.mode,'saved');assert.equal(session.store.valueCodec,'full-snapshot-v1');assert.equal(session.canEdit(),true);
  session.correct({activityId:session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented',rationale:'Invented correction'});const expected=structuredClone(session.ledger);
  assert.equal(session.dirty,true);const window=h.lifecycle.requestMetrics.openWindow();await session.save();assert.equal(window.manifestPatches(),2);assert.equal(session.dirty,false);await session.reopen();assert.deepEqual(session.ledger,expected);
 }finally{await close(h);}
});
test('one-shot start handoff is detached and consumed without repeating the first audit',async()=>{const h=setup();try{
 await h.lifecycle.start({initialize:true});const count=h.http.requests.length;const store=h.lifecycle.createLedgerStore();assert.equal(await store.load(),null);assert.equal(h.http.requests.length,count);
 store.base.revision='99';assert.equal(h.lifecycle.engine.verifiedManifest.revision,'0');await h.lifecycle.createLedgerStore().load();assert.ok(h.http.requests.length>count);
 }finally{await close(h);}});
test('status reentrancy cannot publish a start handoff after invalidation',async()=>{let h;h=setup(status=>{if(status.state==='ready')h.lifecycle.invalidate();});try{await assert.rejects(h.lifecycle.start({initialize:true}));assert.equal(h.lifecycle.acceptingWrites,false);assert.equal(h.lifecycle.engine.verifiedManifest,null);}finally{await close(h);}});
test('offline invalidates baseline and preserves an unsaved local draft',async()=>{const h=setup();try{await h.lifecycle.start({initialize:true});const store=h.lifecycle.createLedgerStore();await store.load();await store.save(replayFixture(1).ledger);h.target.dispatchEvent(new Event('offline'));assert.equal(h.lifecycle.state,'offline');await assert.rejects(store.save(replayFixture(1).ledger));}finally{await close(h);}});
test('old and nonempty folders are rejected by new route before writes',async()=>{let reads=0;const adapter={async listChildren(){reads++;return [{id:'old',name:'finance-tracker-paged-manifest.json'}];}};await assert.rejects(inspectFullSnapshotFolder(adapter,{requireExisting:true}),{code:'unsupported-canonical-layout'});assert.equal(reads,1);});

test('actual Dashboard picker route initializes only new full-snapshot format',async()=>{
 const {DashboardSyntheticStorage}=await import('../js/dashboard-synthetic-storage.mjs');const http=new HttpFullSnapshotDrive();
 const previous={window:globalThis.window,fetch:globalThis.fetch};
 class View{setIncludeFolders(){return this;}setSelectFolderEnabled(){return this;}setMimeTypes(){return this;}}
 class Picker{addView(){return this;}setOAuthToken(){return this;}setDeveloperKey(){return this;}setAppId(){return this;}setOrigin(){return this;}setTitle(){return this;}setCallback(cb){this.cb=cb;return this;}build(){return this;}setVisible(){queueMicrotask(()=>this.cb({action:'picked',docs:[{id:http.folderId}]}));}}
 const accountPins=new Map();
 globalThis.window={localStorage:{getItem:key=>accountPins.get(key)??null,setItem:(key,value)=>accountPins.set(key,value)},location:{origin:'https://example.invalid'},confirm:()=>true,google:{accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:'invented-test-token',expires_in:3600})})}},picker:{DocsView:View,ViewId:{FOLDERS:'folders'},PickerBuilder:Picker,Action:{PICKED:'picked',CANCEL:'cancel'}}}};
 globalThis.fetch=(url,options)=>String(url).includes('/about?')?Promise.resolve(new Response(JSON.stringify({user:{permissionId:'invented-owner',emailAddress:'invented@example.invalid',me:true}}))):String(url).endsWith('?fields=id,name,mimeType,trashed')?Promise.resolve(new Response(JSON.stringify({id:http.folderId,name:'invented synthetic',mimeType:'application/vnd.google-apps.folder',trashed:false}))):http.fetch(url,options);
 const storage=new DashboardSyntheticStorage({fullSnapshot:true,maintainOriginals:false});storage.config={clientId:'invented',apiKey:'invented',projectNumber:'1'};
 const session=new CanonicalWorkspaceSession({storage,online:()=>true});try{session.preview(replayFixture(1).ledger);await session.savePreviewToNewCopy();assert.equal(storage.lifecycle.fullSnapshot,true);assert.equal(session.store.base.format,'finance-tracker-full-snapshot-manifest');assert.equal(session.canEdit(),true);await session.reopen();assert.deepEqual(session.ledger,replayFixture(1).ledger);}finally{await storage.release().catch(()=>{});globalThis.window=previous.window;globalThis.fetch=previous.fetch;}
});
test('interrupted save preserves draft until safe explicit outcome recheck',async()=>{
 const h=setup(),storage={lifecycle:null,async connect(){this.lifecycle=h.lifecycle;await h.lifecycle.start({initialize:true});},createLedgerStore(){return this.lifecycle.createLedgerStore();}};const session=new CanonicalWorkspaceSession({storage,online:()=>true});try{
 session.preview(replayFixture(1).ledger);await session.savePreviewToNewCopy();session.correct({activityId:session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented',rationale:'Invented correction'});const draft=structuredClone(session.ledger);
 h.http.beforeResponse=({category,fileId})=>{if(category==='update'&&fileId===h.lifecycle.engine.manifestFileId)h.http.stopAfterMutation=h.http.mutations+1;};
 await assert.rejects(session.save());assert.equal(session.unverified,true);assert.deepEqual(session.ledger,draft);assert.equal(h.lifecycle.state,'recovery-required');
 h.http.beforeResponse=null;h.http.reboot();const outcome=await session.resolveUncertainSave();assert.equal(outcome.outcome,'saved');assert.deepEqual(session.ledger,draft);assert.equal(session.canSave(),false);assert.equal(session.unverified,false);assert.equal(session.canEdit(),true);
 }finally{await close(h);}
});
test('failed release never reports released and a null event target is supported',async()=>{const h=setup();try{await h.lifecycle.start({initialize:true});h.http.beforeResponse=({category})=>{if(category==='update')throw Error('invented release failure');};await assert.rejects(h.lifecycle.release());assert.notEqual(h.lifecycle.state,'released');assert.equal(h.lifecycle.acceptingWrites,false);}finally{await close(h);}const other=new HttpFullSnapshotDrive();assert.doesNotThrow(()=>new FullSnapshotApplication({folderId:other.folderId,accessToken:()=> 'invented-test-token',fetchImpl:other.fetch,lifecycleTarget:null}));});

test('new app navigation never sends a fresh-copy test to a legacy seeder or storage workbench',async()=>{
 const {readFile}=await import('node:fs/promises');const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 for(const path of ['prototype/synthetic-year.html','prototype/pr28-import.html','prototype/pr25-acceptance.html?guide=v5','prototype/acceptance.html','prototype/'])assert.ok(!html.includes(`href="${path}"`),path);
 assert.match(html,/full-snapshot v1/);assert.match(html,/Old-format folders are unsupported/);
});

test('unresolved save refuses release without relinquishing recovery ownership',async()=>{
 const h=setup();try{
  await h.lifecycle.start({initialize:true});const store=h.lifecycle.createLedgerStore();await store.load();
  h.http.beforeResponse=({category,fileId})=>{if(category==='update'&&fileId===h.lifecycle.engine.manifestFileId)h.http.stopAfterMutation=h.http.mutations+1;};
  await assert.rejects(store.save(replayFixture(1).ledger));
  assert.equal(h.lifecycle.engine.recoveryRequired,true);h.http.beforeResponse=null;h.http.reboot();
  await assert.rejects(h.lifecycle.release(),{code:'recovery-required'});
  assert.equal(h.lifecycle.state,'recovery-required');assert.equal(h.lifecycle.coordinator.canWrite,true);
  await h.lifecycle.recover();await h.lifecycle.load();assert.equal(h.lifecycle.engine.recoveryRequired,false);
  assert.equal((await h.lifecycle.release()).released,true);
 }finally{await close(h);}
});

test('release waits for an admitted save and retains ownership if that save fails',async()=>{
 const h=setup();let unblock;try{
  await h.lifecycle.start({initialize:true});await h.lifecycle.load();
  let entered,blocked=false;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>unblock=resolve);
  h.http.beforeResponse=async({category,fileId})=>{if(!blocked&&category==='media'&&fileId===h.lifecycle.engine.manifestFileId){blocked=true;entered();await gate;throw Error('Invented admitted save failure');}};
  const saving=h.lifecycle.save(replayFixture(1).ledger).then(()=>null,error=>error);await started;
  const releasing=h.lifecycle.release().then(result=>result,error=>error);
  assert.equal(h.lifecycle.coordinator.releasing,true);unblock();
  assert.equal((await saving).code,'drive-network-error');assert.equal((await releasing).code,'recovery-required');
  assert.equal(h.lifecycle.coordinator.canWrite,true);assert.equal(h.lifecycle.state,'recovery-required');
  h.http.beforeResponse=null;await h.lifecycle.recover();await h.lifecycle.load();
  assert.equal((await h.lifecycle.release()).released,true);
 }finally{unblock?.();await close(h);}
});

test('expired existing-session reconnect exposes explicit stale recovery without changing saved data',async()=>{
 const realNow=Date.now;let now=realNow();Date.now=()=>now;
 const h=setup();try{
  await h.lifecycle.start({initialize:true});await h.lifecycle.load();const expected=replayFixture(1).ledger;await h.lifecycle.save(expected);
  now+=120001;const mutations=h.http.mutations;
  await assert.rejects(h.lifecycle.handleOnline(),{code:'stale-session'});
  assert.equal(h.lifecycle.state,'stale-session');assert.equal(h.lifecycle.acceptingWrites,false);assert.equal(h.http.mutations,mutations);
  await h.lifecycle.recoverStaleSession({confirm:true});assert.deepEqual(await h.lifecycle.load(),expected);
 }finally{await close(h);Date.now=realNow;}
});
for(const code of ['authorization-required','ownership-lost','ownership-unknown'])test(`reconnect ${code} never exposes stale takeover or starts a new session`,async()=>{
 const h=setup();try{
  await h.lifecycle.start({initialize:true});const mutations=h.http.mutations;
  h.lifecycle.coordinator.resume=async()=>{throw Object.assign(new Error('Invented reconnect failure'),{code});};
  await assert.rejects(h.lifecycle.handleOnline(),{code});assert.equal(h.lifecycle.state,'reconnecting');assert.equal(h.lifecycle.acceptingWrites,false);assert.equal(h.http.mutations,mutations);
 }finally{await close(h);}
});
