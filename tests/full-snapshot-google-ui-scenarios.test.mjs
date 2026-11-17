import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DashboardSyntheticStorage} from '../js/dashboard-synthetic-storage.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {ScenarioFullSnapshotDrive} from './helpers/scenario-full-snapshot-drive.mjs';
import {pageController} from './helpers/page-controller.mjs';
import {FULL_SNAPSHOT_MANIFEST_NAME} from '../js/full-snapshot-storage.mjs';

// Run the shipped controller, workspace session, picker/storage bridge and
// protocol against invented HTTP responses. Only Google UI/config are replaced.
async function setup({oauthFailure=null,pickerAction=null}={}){
 const http=new ScenarioFullSnapshotDrive();let storage,session,cancel=false,tokenRequests=0;
 const previous={window:globalThis.window,fetch:globalThis.fetch};
 class View{setIncludeFolders(){return this;}setSelectFolderEnabled(){return this;}setMimeTypes(){return this;}}
 class Picker{addView(){return this;}setOAuthToken(){return this;}setDeveloperKey(){return this;}setAppId(){return this;}setOrigin(){return this;}setTitle(){return this;}setCallback(cb){this.cb=cb;return this;}build(){return this;}setVisible(){queueMicrotask(()=>this.cb(pickerAction?{action:pickerAction}:cancel?{action:'cancel'}:{action:'picked',docs:[{id:http.folderId}]}));}}
 globalThis.window={location:{origin:'https://example.invalid'},confirm:()=>true,google:{accounts:{oauth2:{initTokenClient:({callback,error_callback})=>({requestAccessToken:()=>{tokenRequests++;if(oauthFailure==='access_denied')callback({error:oauthFailure});else if(oauthFailure)error_callback({type:oauthFailure});else callback({access_token:'invented-test-token',expires_in:3600});}})}},picker:{DocsView:View,ViewId:{FOLDERS:'folders'},PickerBuilder:Picker,Action:{PICKED:'picked',CANCEL:'cancel',ERROR:'error',LOADED:'loaded'}}}};
 globalThis.fetch=(url,options)=>String(url).endsWith('?fields=id,name,mimeType,trashed')?Promise.resolve(new Response(JSON.stringify({id:http.folderId,name:'invented synthetic',mimeType:'application/vnd.google-apps.folder',trashed:false}))):http.fetch(url,options);
 const imports={};const source=await readFile(new URL('../js/canonical-workspace.mjs',import.meta.url),'utf8');
 for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){const module=await import(new URL('../js/'+match[2],import.meta.url));for(const name of match[1].split(',').map(x=>x.trim()))imports[name]=module[name];}
 imports.DashboardSyntheticStorage=class extends DashboardSyntheticStorage{constructor(options){super(options);storage=this;}async prepare(){this.config={clientId:'invented',apiKey:'invented',projectNumber:'1'};return this.config;}};
 imports.CanonicalWorkspaceSession=class extends CanonicalWorkspaceSession{constructor(options){super(options);session=this;}};
 const page=await pageController('canonical-workspace',imports,{htmlPath:'index.html',scriptPath:'js/canonical-workspace.mjs'});
 return {page,http,get tokenRequests(){return tokenRequests;},get storage(){return storage;},get session(){return session;},cancel(value){cancel=value;},async close(){http.beforeResponse=null;http.reboot();await storage.lifecycle?.release().catch(()=>{});storage.lifecycle?.coordinator.heartbeatStop?.();globalThis.window=previous.window;globalThis.fetch=previous.fetch;}};
}

for (const oauthFailure of ['access_denied','popup_failed_to_open','popup_closed']) test('create handles OAuth '+oauthFailure+' without writes or stuck busy state', async()=>{
 const h=await setup({oauthFailure});try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);await h.page.click('create-ledger');
  assert.equal(h.http.mutations,0);assert.equal(h.storage.lifecycle,null);assert.equal(h.session.busy,false);
  assert.equal(h.session.mode,'preview');assert.equal(h.page.get('create-ledger').disabled,false);
 }finally{await h.close();}
});
for (const pickerAction of ['cancel','error']) test('create handles Picker '+pickerAction+' without writes or stuck busy state', async()=>{
 const h=await setup({pickerAction});try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);
  let timer;try{await Promise.race([h.page.click('create-ledger'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Picker terminal event left create pending')),200);})]);}finally{clearTimeout(timer);}
  assert.equal(h.http.mutations,0);assert.equal(h.storage.lifecycle,null);assert.equal(h.session.busy,false);
  assert.equal(h.session.mode,'preview');assert.equal(h.page.get('create-ledger').disabled,false);
 }finally{await h.close();}
});

test('expired token blocks saved-copy writes without silently reauthorizing or losing draft',async()=>{
 const h=await setup();try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);await h.page.click('create-ledger');
  h.session.correct({activityId:h.session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented',rationale:'Invented'});
  const draft=structuredClone(h.session.ledger),mutations=h.http.mutations,requests=h.tokenRequests;
  h.storage.tokenExpiresAt=1;
  await assert.rejects(h.session.save(),error=>{assert.equal(error.code,'ownership-lost');assert.equal(error.cause?.code,'authorization-required');return true;});
  assert.equal(h.http.mutations,mutations);assert.equal(h.tokenRequests,requests);
  assert.deepEqual(h.session.ledger,draft);assert.equal(h.session.busy,false);assert.equal(h.session.dirty,true);
  assert.equal(h.storage.accessToken,'');
 }finally{await h.close();}
});

test('token expiry during a suspension-shaped read delay fails closed before publication',async()=>{
 const h=await setup();try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);await h.page.click('create-ledger');
  h.session.correct({activityId:h.session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented',rationale:'Invented'});
  const draft=structuredClone(h.session.ledger),mutations=h.http.mutations;let fired=false;
  h.http.beforeResponse=async({category})=>{if(!fired&&category==='list'){fired=true;await new Promise(resolve=>setTimeout(resolve,1));h.storage.tokenExpiresAt=1;}};
  await assert.rejects(h.session.save(),{code:'authorization-required'});
  assert.equal(fired,true);assert.equal(h.http.mutations,mutations);assert.deepEqual(h.session.ledger,draft);
  assert.equal(h.session.busy,false);assert.equal(h.storage.lifecycle.acceptingWrites,false);
 }finally{await h.close();}
});

test('backup restore uses shipped Google Picker bridge and independent fresh lifecycle',async()=>{
 const {encodeFullSnapshotBackup}=await import('../js/full-snapshot-backup.mjs');const {replayFixture}=await import('./helpers/ledger-replay-fixtures.mjs');
 const h=await setup();try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);const source=replayFixture(2).ledger;
  await h.session.importBackup(await encodeFullSnapshotBackup(source));
  let old;const reopen=h.storage.reopenIndependent.bind(h.storage);h.storage.reopenIndependent=async()=>{old=h.storage.lifecycle;return reopen();};
  await h.session.restoreBackupToNewCopy();assert.notEqual(h.storage.lifecycle,old);assert.equal(old.state,'released');assert.deepEqual(h.session.ledger,source);assert.equal(h.session.unverified,false);assert.equal(h.session.backupPreview,false);
 }finally{await h.close();}
});
for(const pickerAction of ['cancel','error'])test('restore Picker '+pickerAction+' preserves validated source without mutations',async()=>{
 const {encodeFullSnapshotBackup}=await import('../js/full-snapshot-backup.mjs');const {replayFixture}=await import('./helpers/ledger-replay-fixtures.mjs');
 const h=await setup({pickerAction});try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);const source=replayFixture(1).ledger;await h.session.importBackup(await encodeFullSnapshotBackup(source));
  await assert.rejects(h.session.restoreBackupToNewCopy());assert.equal(h.http.mutations,0);assert.equal(h.session.backupPreview,true);assert.deepEqual(h.session.backupSource,source);assert.equal(h.session.busy,false);
 }finally{await h.close();}
});

test('explicit outcome recheck refreshes expired authorization without changing folder or retrying save',async()=>{
 const h=await setup();try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);await h.page.click('create-ledger');
  h.session.correct({activityId:h.session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented',rationale:'Invented'});const expected=structuredClone(h.session.ledger),lifecycle=h.storage.lifecycle,requests=h.tokenRequests;
  h.http.fault({category:'update',kind:'finance-tracker-full-snapshot-manifest',after:true,effect:'lost-response'});
  const original=h.http.applyRules.bind(h.http);h.http.applyRules=async(...args)=>{try{return await original(...args);}catch(error){h.storage.tokenExpiresAt=1;throw error;}};
  await assert.rejects(h.session.save());assert.equal(h.session.recoveryOutcome,'unverifiable');assert.equal(h.tokenRequests,requests);
  h.http.applyRules=original;const result=await h.session.resolveUncertainSave();assert.equal(result.outcome,'saved');assert.equal(h.tokenRequests,requests+1);assert.equal(h.storage.lifecycle,lifecycle);assert.deepEqual(h.session.ledger,expected);assert.equal(h.session.dirty,false);
 }finally{await h.close();}
});
