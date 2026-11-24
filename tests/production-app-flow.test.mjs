import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {DashboardSyntheticStorage} from '../js/dashboard-synthetic-storage.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {RELEASE_PROFILE,releasedDataClass} from '../js/release-profile.mjs';
import {createFullSnapshotStorage,FULL_SNAPSHOT_MANIFEST_NAME} from '../js/full-snapshot-storage.mjs';
import {encodeFullSnapshotBackup,decodeFullSnapshotBackup} from '../js/full-snapshot-backup.mjs';
import {createLedger} from '../js/canonical-import.mjs';
import {mountProviderImportWorkflow} from '../js/provider-csv-import-workflow.mjs';
import {recentReports} from '../js/error-reporting.mjs';
import {ScenarioFullSnapshotDrive} from './helpers/scenario-full-snapshot-drive.mjs';
import {fakeGoogleFolderProof} from './helpers/fake-google-folder-proof.mjs';
import {pageController} from './helpers/page-controller.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

// The shipped controller, workspace session, Picker/Drive bridge, storage
// engine and backup codec run against invented HTTP responses. Only Google
// libraries, the deployment config and the release profile are substituted.
// The test release profile stands in for a future approved release; the
// shipped profile is asserted separately below.
const TEST_RELEASE=Object.freeze({dataClasses:Object.freeze(['synthetic','production'])});
const TOKEN='invented-test-token',OWNER='invented-owner',PASSWORD='invented archive password';
const RAW_HEADER='DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS';
const RAW_CSV=RAW_HEADER+'\n01/15/2026,INVENTED PAYROLL ROW,1234.56,,Posted\n01/16/2026,INVENTED GROCER ROW,-45.67,,Posted\n';
const decode=bytes=>new TextDecoder().decode(bytes);

async function setup({release=TEST_RELEASE}={}){
 const folders=new Map(),bodies=[],pins=new Map(),previous={window:globalThis.window,fetch:globalThis.fetch};
 let picked=null,pickerAction=null,oauth=null,account=OWNER,tokenRequests=0,confirmAnswer=()=>true,storage,session;
 const folder=(key,name,{shared=false,proofStatus=200}={})=>{
  const http=new ScenarioFullSnapshotDrive({folderId:'invented-folder-'+key,idPrefix:'invented-'+key+'-file-'});
  folders.set(http.folderId,{http,name,shared,proofStatus});return http;
 };
 const current=()=>folders.get(picked);
 class View{setIncludeFolders(){return this;}setSelectFolderEnabled(){return this;}setMimeTypes(){return this;}}
 class Picker{addView(){return this;}setOAuthToken(){return this;}setDeveloperKey(){return this;}setAppId(){return this;}setOrigin(){return this;}setTitle(title){this.title=title;return this;}setCallback(cb){this.cb=cb;return this;}build(){return this;}
  setVisible(){queueMicrotask(()=>this.cb(pickerAction?{action:pickerAction}:{action:'picked',docs:[{id:picked}]}));}}
 const confirmations=[];
 globalThis.window={localStorage:{getItem:key=>pins.get(key)??null,setItem:(key,value)=>pins.set(key,value)},location:{origin:'https://example.invalid'},
  confirm:question=>{confirmations.push(question);return confirmAnswer(question);},
  google:{accounts:{oauth2:{initTokenClient:({callback,error_callback})=>({requestAccessToken:()=>{tokenRequests++;
   if(oauth==='access_denied')callback({error:oauth});else if(oauth)error_callback({type:oauth});else callback({access_token:TOKEN,expires_in:3600});}})}},
  picker:{DocsView:View,ViewId:{FOLDERS:'folders'},PickerBuilder:Picker,Action:{PICKED:'picked',CANCEL:'cancel',ERROR:'error',LOADED:'loaded'}}}};
 globalThis.fetch=async(url,options={})=>{
  const text=String(url);
  if(text.includes('/about?'))return Response.json({user:{permissionId:account,emailAddress:'invented@example.invalid',me:true}});
  if(text.endsWith('?fields=id,name,mimeType,trashed'))return Response.json({id:picked,name:current().name,mimeType:'application/vnd.google-apps.folder',trashed:false});
  for(const [folderId,entry] of folders){
   const proof=fakeGoogleFolderProof(url,options,{folderId,token:TOKEN,shared:entry.shared});
   if(proof)return entry.proofStatus===200?proof:new Response('{}',{status:entry.proofStatus});
  }
  const body=options.body;
  if(body!==undefined)bodies.push(typeof body==='string'?body:decode(body instanceof Blob?new Uint8Array(await body.arrayBuffer()):body));
  return current().http.fetch(url,options);
 };
 const imports={};const source=await readFile(new URL('../js/canonical-workspace.mjs',import.meta.url),'utf8');
 for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){const module=await import(new URL('../js/'+match[2],import.meta.url));for(const name of match[1].split(',').map(x=>x.trim()))imports[name]=module[name];}
 imports.RELEASE_PROFILE=release;
 imports.DashboardSyntheticStorage=class extends DashboardSyntheticStorage{constructor(options){super(options);storage=this;}async prepare(){this.config={clientId:'invented',apiKey:'invented',projectNumber:'1'};return this.config;}};
 imports.CanonicalWorkspaceSession=class extends CanonicalWorkspaceSession{constructor(options){super(options);session=this;}};
 const page=await pageController('canonical-workspace',imports,{htmlPath:'index.html',scriptPath:'js/canonical-workspace.mjs'});
 await page.until(()=>!page.get('open-ledger').disabled);
 return {page,folders,bodies,pins,confirmations,folder,
  get storage(){return storage;},get session(){return session;},get tokenRequests(){return tokenRequests;},
  pick(http){picked=http.folderId;},picker(value){pickerAction=value;},oauth(value){oauth=value;},account(value){account=value;},confirm(fn){confirmAnswer=fn;},
  writes:http=>http.requests.filter(row=>row.method!=='GET').length,
  async close(){for(const {http} of folders.values()){http.beforeResponse=null;http.reboot();}await storage.lifecycle?.release().catch(()=>{});storage.lifecycle?.coordinator.heartbeatStop?.();globalThis.window=previous.window;globalThis.fetch=previous.fetch;}};
}
// Staging happened outside the controller; ask it to re-render its controls.
async function rerender(h){await h.page.get('backup-file').emit('change');}
async function choosePrivate(h){await h.page.choose('data-class','production');assert.equal(h.storage.dataClass,'production');}
async function createPrivate(h,http){h.pick(http);await h.page.click('create-ledger');assert.equal(h.session.mode,'saved',h.page.get('action-status').textContent);}
// The real provider workflow against the session's own staging boundary.
async function importCsv(h,accountId,csv=RAW_CSV){
 const doc={createElement:tag=>new Element(tag)};
 class Element{constructor(tag){this.tag=tag;this.children=[];this.ownerDocument=doc;this.events={};this.value='';this.checked=false;this.disabled=false;this.innerHTML='';this.dataset={};}
  setAttribute(k,v){this[k]=k==='disabled'?true:v;}append(...c){this.children.push(...c);}replaceChildren(...c){this.children=c;this.innerHTML='';}
  removeChild(child){this.children=this.children.filter(x=>x!==child);}contains(){return true;}querySelector(){return {focus(){}};}
  addEventListener(t,f){(this.events[t]??=[]).push(f);}removeEventListener(t,f){this.events[t]=(this.events[t]??[]).filter(x=>x!==f);}
  async emit(t,e={}){for(const f of this.events[t]??[])await f(e);}}
 const root=new Element('div');
 mountProviderImportWorkflow({root,getLedger:()=>h.session.ledger,canStage:()=>h.session.canEdit(),stageImport:proposal=>h.session.stageCanonicalImport(proposal)});
 const all=()=>{const list=[];(function walk(n){list.push(n);n.children.forEach(walk);})(root);return list;},one=p=>all().find(p);
 const file=one(n=>n.type==='file');file.files=[{arrayBuffer:async()=>new TextEncoder().encode(csv).buffer}];await file.emit('change');
 const select=one(n=>n.tag==='select');select.value=accountId;await select.emit('change');
 const container=one(n=>n.className==='provider-import-coverage');
 for(const [field,value] of [['start','2026-01-01'],['end','2026-01-31']])await container.emit('change',{target:{dataset:{field},value}});
 await container.emit('click',{target:{dataset:{action:'confirm'},closest(){return this;}}});
 const stage=one(n=>n.textContent==='Stage import for review');assert.equal(stage.disabled,false);await stage.emit('click');
 await rerender(h);
}
const manifestOf=http=>http.json([...http.files.values()].find(f=>f.metadata.name===FULL_SNAPSHOT_MANIFEST_NAME).metadata.id);
async function independentOpen(http,dataClass){
 const store=createFullSnapshotStorage({folderId:http.folderId,accessToken:()=>TOKEN,fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},dataClass});
 // A refused claim has nothing to release; never mask its refusal.
 const ledger=await store.start(),manifest=store.verifiedManifest;await store.release();return {ledger,manifest};
}

test('the shipped release profile is synthetic-only and cannot construct a private session',async()=>{
 // Changing this assertion is part of a separately approved release decision.
 assert.deepEqual(RELEASE_PROFILE.dataClasses,['synthetic']);
 assert.ok(Object.isFrozen(RELEASE_PROFILE)&&Object.isFrozen(RELEASE_PROFILE.dataClasses));
 assert.throws(()=>releasedDataClass('production'),{code:'data-class-not-released'});
 assert.throws(()=>new DashboardSyntheticStorage({dataClass:'production'}),{code:'data-class-not-released'});
 assert.throws(()=>new FullSnapshotApplication({folderId:'invented-folder',accessToken:()=>TOKEN,dataClass:'production'}),{code:'data-class-not-released'});
 assert.throws(()=>new DashboardSyntheticStorage().setDataClass('production'),{code:'data-class-not-released'});
 assert.throws(()=>releasedDataClass('production',{dataClasses:['synthetic','reserved-production']}),{code:'data-class-not-released'});
});

test('locked default UI hides the class choice and keeps the synthetic route',async()=>{
 const h=await setup({release:RELEASE_PROFILE});try{
  assert.equal(h.page.get('data-class-choice').hidden,true);assert.equal(h.page.get('data-class').disabled,true);
  assert.equal(h.storage.dataClass,'synthetic');assert.equal(h.page.get('open-ledger').textContent,'Open saved synthetic year');
  assert.doesNotMatch(h.page.get('release-classes').textContent,/private database/i);
  // Even a forced change event cannot select an unreleased class.
  h.page.get('data-class').value='production';await h.page.get('data-class').emit('change');
  assert.equal(h.storage.dataClass,'synthetic');assert.equal(h.page.get('data-class').value,'synthetic');
 }finally{await h.close();}
});

test('private database: create, CSV import, explicit save, release, independent reopen, keeping originals local',async()=>{
 const h=await setup();const a=h.folder('a','invented private ledger');try{
  assert.equal(h.page.get('data-class-choice').hidden,false);
  await choosePrivate(h);assert.equal(h.page.get('create-ledger').textContent,'Create new private database');
  assert.equal(h.page.get('preview-year').disabled,true);assert.equal(h.page.get('start-preview').disabled,true);
  await createPrivate(h,a);
  assert.equal(manifestOf(a).dataClass,'production');assert.equal(manifestOf(a).version,2);
  assert.equal(h.session.ledger.dataClass,'production');assert.equal(h.session.ledger.activities.length,0);
  assert.equal(h.page.get('data-class').disabled,true);
  // Designation is a hash; never the folder ID, account ID or email.
  const pinned=[...h.pins.values()];assert.ok(pinned.every(value=>/^[a-f0-9]{64}$/.test(value)));assert.equal(pinned.length,2);
  h.session.addAccount({institutionId:'wells-fargo',accountType:'checking',displayName:'Invented checking',currency:'USD'});
  await importCsv(h,h.session.ledger.accounts[0].accountId);
  assert.equal(h.page.get('save-ledger').disabled,false);
  assert.equal(h.session.ledger.activities.length,2);assert.equal(h.session.dirty,true);
  const run=h.session.ledger.imports[0];
  assert.equal(run.sourceFileRetentionStatus,'not-retained');assert.equal(run.privateSourceFileRef,null);
  await h.page.click('save-ledger');assert.equal(h.session.dirty,false,h.page.get('action-status').textContent);
  const saved=structuredClone(h.session.ledger);
  assert.equal(manifestOf(a).revision,'2');
  await h.page.click('release-ledger');
  assert.equal(h.storage.lifecycle,null);assert.equal(h.session.ledger,null);assert.equal(h.storage.accessToken,'');
  await h.page.click('open-ledger');
  assert.deepEqual(h.session.ledger,saved);assert.equal(h.session.mode,'saved');
  await h.page.click('release-ledger');
  const independent=await independentOpen(a,'production');assert.deepEqual(independent.ledger,saved);
  // Normalized rows and provenance persist; the original file does not.
  const uploads=h.bodies.join('\n');
  assert.ok(uploads.includes('INVENTED PAYROLL ROW'));
  assert.equal(uploads.includes(RAW_HEADER),false);assert.equal(uploads.includes(RAW_CSV),false);assert.equal(uploads.includes('1234.56,,Posted'),false);
  assert.equal(uploads.includes(TOKEN),false);assert.equal(uploads.includes('invented@example.invalid'),false);
 }finally{await h.close();}
});

test('cross-class folders are refused in both directions before any write or session change',async()=>{
 const h=await setup();const privateHttp=h.folder('a','invented private ledger'),syntheticHttp=h.folder('s','invented synthetic copy'),neutral=h.folder('n','invented plain folder');
 try{
  // Seed one folder of each class through the real app paths.
  await choosePrivate(h);await createPrivate(h,privateHttp);await h.page.click('release-ledger');
  await h.page.choose('data-class','synthetic');h.pick(syntheticHttp);
  await h.page.click('preview-year');await h.page.click('create-ledger');assert.equal(h.session.mode,'saved');await h.page.click('release-ledger');
  // A synthetic manifest moved into a neutrally named folder still fails on class.
  neutral.files=structuredClone(syntheticHttp.files);for(const f of neutral.files.values())f.metadata.parents=[neutral.folderId];
  const mutations=[privateHttp,syntheticHttp,neutral].map(x=>x.mutations);
  // Synthetic session -> private database (name allowed): manifest class refuses.
  h.folders.get(privateHttp.folderId).name='invented synthetic-named private';
  h.pick(privateHttp);await assert.rejects(h.session.open(),{code:'data-class-mismatch'});
  assert.equal(h.storage.lifecycle,null);
  // Private session -> synthetic copy in a neutral folder: designation refuses first;
  // with no designation the manifest class refuses before claiming.
  await h.page.choose('data-class','production');h.pins.clear();
  h.pick(neutral);await assert.rejects(h.session.open(),{code:'data-class-mismatch'});
  // Private session -> folder named synthetic is refused before any Drive read.
  h.pick(syntheticHttp);const requests=syntheticHttp.requests.length;
  await assert.rejects(h.session.open(),{code:'data-class-mismatch'});assert.equal(syntheticHttp.requests.length,requests);
  assert.deepEqual([privateHttp,syntheticHttp,neutral].map(x=>x.mutations),mutations);
  assert.equal(h.storage.lifecycle,null);assert.equal(h.session.ledger,null);
 }finally{await h.close();}
});

test('cross-class ledgers and backups are refused before replacing the draft or touching storage',async()=>{
 const h=await setup();const a=h.folder('a','invented private ledger');try{
  const syntheticLedger=replayFixture(1).ledger,privateLedger=createLedger({dataClass:'production'});
  const syntheticArchive=await encodeFullSnapshotBackup(syntheticLedger,{password:PASSWORD});
  const privateArchive=await encodeFullSnapshotBackup(privateLedger,{password:PASSWORD,dataClass:'production'});
  await assert.rejects(encodeFullSnapshotBackup(privateLedger,{dataClass:'production'}),{code:'backup-password-required'});
  // Synthetic session: private archive and ledger refused; no password needed to refuse.
  await h.session.importBackup(syntheticArchive,{password:PASSWORD});const preview=structuredClone(h.session.ledger);
  await assert.rejects(h.session.importBackup(privateArchive),{code:'data-class-mismatch'});
  assert.throws(()=>h.session.preview(privateLedger),{code:'data-class-mismatch'});
  assert.deepEqual(h.session.ledger,preview);assert.equal(h.session.backupPreview,true);
  // A checksummed archive cannot relabel its inner ledger.
  await assert.rejects(decodeFullSnapshotBackup(privateArchive,{password:PASSWORD}),{code:'data-class-mismatch'});
  // Private session: synthetic archive and ledger refused, draft retained.
  h.session.ledger=null;h.session.mode='empty';h.session.backupPreview=false;h.session.backupSource=null;
  await choosePrivate(h);await h.session.importBackup(privateArchive,{password:PASSWORD});
  const privatePreview=structuredClone(h.session.ledger);
  await assert.rejects(h.session.importBackup(syntheticArchive,{password:PASSWORD}),{code:'data-class-mismatch'});
  assert.throws(()=>h.session.preview(syntheticLedger),{code:'data-class-mismatch'});
  assert.deepEqual(h.session.ledger,privatePreview);
  await assert.rejects(h.session.importBackup(privateArchive,{password:'wrong invented password'}),{code:'backup-decryption-failed'});
  assert.deepEqual(h.session.ledger,privatePreview);
  // A synthetic preview can never be saved into a private destination.
  h.session.ledger=structuredClone(syntheticLedger);h.session.backupPreview=false;
  assert.equal(h.session.canEdit(),false);assert.throws(()=>h.session.addAccount({institutionId:'sofi',accountType:'checking',displayName:'Invented',currency:'USD'}),{code:'reopen-before-editing'});
  h.pick(a);await assert.rejects(h.session.savePreviewToNewCopy(),{code:'data-class-mismatch'});
  assert.equal(a.requests.length,0);assert.equal(h.storage.lifecycle,null);
 }finally{await h.close();}
});

test('wrong, shared, unverifiable or undesignated folders and canceled authorization change nothing',async()=>{
 const h=await setup();const a=h.folder('a','invented private ledger'),b=h.folder('b','invented other private'),shared=h.folder('c','invented shared',{shared:true}),broken=h.folder('d','invented broken',{proofStatus:500});
 try{
  await choosePrivate(h);await createPrivate(h,a);
  const draft=structuredClone(h.session.addAccount({institutionId:'sofi',accountType:'savings',displayName:'Invented savings',currency:'USD'}));
  const lifecycle=h.storage.lifecycle,writes=h.writes(a);
  // Another private folder is refused locally: not the designated database.
  b.files=structuredClone(a.files);for(const f of b.files.values())f.metadata.parents=[b.folderId];
  h.pick(b);const bRequests=b.requests.length;
  await assert.rejects(h.session.open(),{code:'designated-folder-mismatch'});
  assert.equal(b.requests.length,bRequests);
  for(const [http,code] of [[shared,'private-folder-proof-failed'],[broken,'private-folder-proof-failed']]){
   h.pick(http);await assert.rejects(h.session.open(),{code:'designated-folder-mismatch'});
  }
  // Canceled authorization, Picker cancellation and a declined designation.
  h.pick(a);h.oauth('access_denied');await assert.rejects(h.session.open(),{code:'authorization-cancelled'});h.oauth(null);
  h.picker('cancel');await assert.rejects(h.session.open());h.picker(null);
  for(const value of [h.storage.lifecycle===lifecycle,h.session.ledger.accounts.length===draft.accounts.length,h.session.dirty])assert.equal(value,true);
  assert.equal(h.writes(a),writes);
  // A wrong Google account is refused before any folder work.
  h.account('invented-other-account');await assert.rejects(h.session.open(),{code:'account-mismatch'});h.account(OWNER);
  assert.equal(h.storage.lifecycle,lifecycle);assert.equal(h.writes(a),writes);assert.equal(h.session.canSave(),true);
  // Without a designation, shared and unverifiable folders still fail closed.
  await h.session.save();await rerender(h);await h.page.click('release-ledger');assert.equal(h.storage.lifecycle,null);h.pins.clear();
  for(const http of [shared,broken]){h.pick(http);await assert.rejects(h.session.open(),{code:'private-folder-proof-failed'});assert.equal(h.writes(http),0);}
  h.confirm(question=>!/Designate/.test(question));h.pick(a);await assert.rejects(h.session.open(),{code:'authorization-cancelled'});
  assert.equal(h.storage.lifecycle,null);
 }finally{await h.close();}
});

test('private expiry blocks writes, reauthorization keeps the folder, and an interrupted save is recovered without retry',async()=>{
 const h=await setup();const a=h.folder('a','invented private ledger');try{
  await choosePrivate(h);await createPrivate(h,a);
  h.session.addAccount({institutionId:'fidelity',accountType:'brokerage',displayName:'Invented brokerage',currency:'USD'});
  const draft=structuredClone(h.session.ledger),writes=h.writes(a),requests=h.tokenRequests;
  h.storage.tokenExpiresAt=1;
  await assert.rejects(h.session.save(),error=>error.code==='ownership-lost'||error.code==='authorization-required');
  assert.equal(h.writes(a),writes);assert.equal(h.tokenRequests,requests);assert.deepEqual(h.session.ledger,draft);assert.equal(h.session.dirty,true);
  // Explicit reconnect re-verifies the same account and folder, then saves once.
  await h.page.click('open-ledger');
  assert.equal(h.session.mode,'saved');
  h.session.addAccount({institutionId:'fidelity',accountType:'brokerage',displayName:'Invented brokerage',currency:'USD'});
  const expected=structuredClone(h.session.ledger),lifecycle=h.storage.lifecycle;
  a.fault({category:'update',kind:'finance-tracker-full-snapshot-manifest',after:true,effect:'lost-response'});
  // A lost publication response is resolved by reading Drive, never by resubmitting.
  const before=a.requests.filter(row=>row.category==='create').length;
  await h.session.save();
  assert.equal(h.session.recoveryOutcome,'saved');assert.equal(a.requests.filter(row=>row.category==='create').length-before,2);assert.deepEqual(h.session.ledger,expected);assert.equal(h.storage.lifecycle,lifecycle);
  assert.equal(manifestOf(a).pending,null);
  // Unverifiable outcome preserves the draft and blocks release and retry.
  h.session.addAccount({institutionId:'sofi',accountType:'checking',displayName:'Invented second',currency:'USD'});
  const second=structuredClone(h.session.ledger);
  a.fault({category:'update',kind:'finance-tracker-full-snapshot-manifest',after:true,effect:'lost-response'});
  const original=a.applyRules.bind(a);a.applyRules=async(...args)=>{try{return await original(...args);}catch(error){h.storage.tokenExpiresAt=1;throw error;}};
  await assert.rejects(h.session.save());a.applyRules=original;
  assert.equal(h.session.recoveryOutcome,'unverifiable');assert.deepEqual(h.session.ledger,second);
  await assert.rejects(h.session.release(),{code:'recovery-required'});
  await assert.rejects(h.session.retryUncertainSave({confirm:true}),{code:'verified-retry-required'});
  const result=await h.session.resolveUncertainSave();
  assert.equal(result.outcome,'saved');assert.equal(h.storage.lifecycle,lifecycle);assert.deepEqual(h.session.ledger,second);
  await h.session.release();
  assert.deepEqual((await independentOpen(a,'production')).ledger,second);
 }finally{await h.close();}
});

test('private ownership: an active session refuses another device; an expired one is reclaimed without the abandoned draft',async()=>{
 const realNow=Date.now;let now=realNow();const h=await setup();const a=h.folder('a','invented private ledger');let other;
 try{
  Date.now=()=>now;
  await choosePrivate(h);await createPrivate(h,a);
  const saved=structuredClone(h.session.ledger);
  h.session.addAccount({institutionId:'sofi',accountType:'savings',displayName:'Abandoned invented draft',currency:'USD'});
  other=new DashboardSyntheticStorage({dataClass:'production',release:TEST_RELEASE});other.config=h.storage.config;
  const writes=a.requests.filter(row=>row.method!=='GET'&&row.kind!=='session-marker').length;
  await assert.rejects(other.connect({requireExisting:true}),{code:'session-active'});
  assert.equal(other.lifecycle.acceptingWrites,false);
  h.storage.lifecycle.coordinator.heartbeatStop?.();now+=120001;
  await other.connect({requireExisting:true});
  assert.equal(other.lifecycle.acceptingWrites,true);assert.equal(other.lifecycle.dataClass,'production');
  assert.deepEqual(await other.createLedgerStore().load(),saved);
  assert.equal(a.requests.filter(row=>row.method!=='GET'&&row.kind!=='session-marker').length,writes);
  // The stale first device cannot save its abandoned draft.
  await assert.rejects(h.session.save());assert.deepEqual((await (async()=>{await other.release();return independentOpen(a,'production');})()).ledger,saved);
 }finally{
  try{if(other?.lifecycle)await other.release();}finally{other?.lifecycle?.coordinator.heartbeatStop?.();await h.close();Date.now=realNow;}
 }
});

test('encrypted private backup restores to a fresh empty folder, verifies independently and moves designation only after verification',async()=>{
 const h=await setup();const a=h.folder('a','invented private ledger'),b=h.folder('b','invented restore target'),c=h.folder('c','invented failed target');
 try{
  await choosePrivate(h);await createPrivate(h,a);
  h.session.addAccount({institutionId:'wells-fargo',accountType:'checking',displayName:'Invented checking',currency:'USD'});
  await importCsv(h,h.session.ledger.accounts[0].accountId);await h.session.save();
  assert.equal(h.page.get('backup-encrypt').checked,true);assert.equal(h.page.get('backup-encrypt').disabled,true);
  const raw=await h.session.exportBackup({password:PASSWORD}),archive=JSON.parse(decode(raw));
  assert.equal(archive.dataClass,'production');assert.equal(archive.protection,'aes-256-gcm');assert.equal('ledger' in archive,false);
  assert.equal(decode(raw).includes('INVENTED PAYROLL ROW'),false);assert.equal(decode(raw).includes(RAW_HEADER),false);
  const source=structuredClone(h.session.ledger),sourceManifest=structuredClone(manifestOf(a)),sourceStart=a.requests.length;
  await h.page.click('release-ledger');const pinsBefore=new Map(h.pins);
  await assert.rejects(h.session.importBackup(raw,{password:'wrong invented password'}),{code:'backup-decryption-failed'});
  await h.session.importBackup(raw,{password:PASSWORD});
  // A failed restore leaves the previous designation in place.
  c.fault({category:'update',kind:'finance-tracker-full-snapshot-manifest',effect:'status',status:503});
  h.pick(c);await assert.rejects(h.session.restoreBackupToNewCopy());
  assert.deepEqual(h.pins,pinsBefore);
  await h.storage.lifecycle?.release().catch(()=>{});h.storage.lifecycle=null;
  h.session.unverified=false;h.session.needsReopen=false;h.session.recoveryOutcome=null;h.session.restoreExpected=null;h.session.restoreFolderId=null;h.session.pendingSave=null;h.session.mode='preview';h.session.store=null;
  h.pick(b);await h.session.restoreBackupToNewCopy();
  assert.deepEqual(h.session.ledger,source);assert.equal(h.session.unverified,false);
  assert.notDeepEqual(h.pins,pinsBefore);
  await h.session.release();
  // Independent comparison: the source is unchanged; the copy is equal with new lineage.
  const restored=await independentOpen(b,'production'),original=await independentOpen(a,'production');
  assert.deepEqual(restored.ledger,source);assert.deepEqual(original.ledger,source);
  assert.notEqual(restored.manifest.copyId,original.manifest.copyId);
  // Restore never writes the source: only its session marker changed hands.
  assert.deepEqual(manifestOf(a),sourceManifest);
  assert.deepEqual(a.requests.slice(sourceStart).filter(row=>row.method!=='GET'&&row.kind!=='session-marker'),[]);
  // The previous folder is no longer designated in this browser.
  h.pick(a);await assert.rejects(h.session.open(),{code:'designated-folder-mismatch'});
  h.pick(b);await h.session.open();assert.deepEqual(h.session.ledger,source);
 }finally{await h.close();}
});

test('diagnostics and browser storage carry no private identifiers, credentials or financial values',async()=>{
 const h=await setup();const a=h.folder('a','invented private ledger'),shared=h.folder('c','invented shared',{shared:true});try{
  await choosePrivate(h);await createPrivate(h,a);
  h.session.addAccount({institutionId:'wells-fargo',accountType:'checking',displayName:'Invented checking',currency:'USD'});
  await importCsv(h,h.session.ledger.accounts[0].accountId);await h.page.click('save-ledger');
  h.pick(shared);await h.page.click('open-ledger');
  h.storage.tokenExpiresAt=1;await h.page.click('save-ledger');
  const exported=JSON.stringify(recentReports())+JSON.stringify([...h.pins])+h.page.get('action-status').textContent+h.page.get('connection-status').textContent;
  for(const secret of [TOKEN,OWNER,'invented@example.invalid',a.folderId,shared.folderId,'invented private ledger','INVENTED PAYROLL ROW','1234.56','45.67',PASSWORD])
   assert.equal(exported.includes(secret),false,secret);
 }finally{await h.close();}
});
