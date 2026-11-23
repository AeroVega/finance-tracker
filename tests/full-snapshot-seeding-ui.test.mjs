import {fakeGoogleFolderProof} from './helpers/fake-google-folder-proof.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DashboardSyntheticStorage} from '../js/dashboard-synthetic-storage.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {pageController} from './helpers/page-controller.mjs';
import {FULL_SNAPSHOT_MANIFEST_NAME} from '../js/full-snapshot-storage.mjs';

// Run the shipped controller, workspace session, picker/storage bridge and
// protocol against invented HTTP responses. Only Google UI/config are replaced.
async function setup(){
 const http=new HttpFullSnapshotDrive();let storage,session,cancel=false,tokenRequests=0;
 const previous={window:globalThis.window,fetch:globalThis.fetch};
 class View{setIncludeFolders(){return this;}setSelectFolderEnabled(){return this;}setMimeTypes(){return this;}}
 class Picker{addView(){return this;}setOAuthToken(){return this;}setDeveloperKey(){return this;}setAppId(){return this;}setOrigin(){return this;}setTitle(){return this;}setCallback(cb){this.cb=cb;return this;}build(){return this;}setVisible(){queueMicrotask(()=>this.cb(cancel?{action:'cancel'}:{action:'picked',docs:[{id:http.folderId}]}));}}
 const accountPins=new Map();
 globalThis.window={localStorage:{getItem:key=>accountPins.get(key)??null,setItem:(key,value)=>accountPins.set(key,value)},location:{origin:'https://example.invalid'},confirm:()=>true,google:{accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>{tokenRequests++;callback({access_token:'invented-test-token',expires_in:3600});}})}},picker:{DocsView:View,ViewId:{FOLDERS:'folders'},PickerBuilder:Picker,Action:{PICKED:'picked',CANCEL:'cancel'}}}};
 globalThis.fetch=(url,options)=>String(url).includes('/about?')?Promise.resolve(new Response(JSON.stringify({user:{permissionId:'invented-owner',emailAddress:'invented@example.invalid',me:true}}))):String(url).endsWith('?fields=id,name,mimeType,trashed')?Promise.resolve(new Response(JSON.stringify({id:http.folderId,name:'invented synthetic',mimeType:'application/vnd.google-apps.folder',trashed:false}))):(fakeGoogleFolderProof(url, options,{folderId:http.folderId,token:'invented-test-token'}) ?? http.fetch(url,options));
 const imports={};const source=await readFile(new URL('../js/canonical-workspace.mjs',import.meta.url),'utf8');
 for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){const module=await import(new URL('../js/'+match[2],import.meta.url));for(const name of match[1].split(',').map(x=>x.trim()))imports[name]=module[name];}
 imports.DashboardSyntheticStorage=class extends DashboardSyntheticStorage{constructor(options){super(options);storage=this;}async prepare(){this.config={clientId:'invented',apiKey:'invented',projectNumber:'1'};return this.config;}};
 imports.CanonicalWorkspaceSession=class extends CanonicalWorkspaceSession{constructor(options){super(options);session=this;}};
 const page=await pageController('canonical-workspace',imports,{htmlPath:'index.html',scriptPath:'js/canonical-workspace.mjs'});
 return {page,http,get tokenRequests(){return tokenRequests;},get storage(){return storage;},get session(){return session;},cancel(value){cancel=value;},async close(){http.beforeResponse=null;http.reboot();await storage.lifecycle?.release().catch(()=>{});globalThis.window=previous.window;globalThis.fetch=previous.fetch;}};
}

test('visible create action seeds an empty folder through the shipped controller and reopens the exact year',async()=>{
 const h=await setup();try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);const creating=h.page.click('create-ledger');
  assert.equal(h.tokenRequests,1,'OAuth is requested synchronously from the click');await creating;
  assert.equal(h.session.mode,'saved');assert.equal(h.session.canEdit(),true);assert.equal(h.session.store.valueCodec,'full-snapshot-v1');
  assert.ok([...h.http.files.values()].some(f=>f.metadata.name===FULL_SNAPSHOT_MANIFEST_NAME));
  const expected=structuredClone(h.session.ledger);await h.page.click('release-ledger');await h.page.click('open-ledger');
  assert.deepEqual(h.session.ledger,expected);assert.equal(h.session.mode,'saved');
  h.session.correct({activityId:h.session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented-retained',rationale:'Invented retained draft'});
  const draft=structuredClone(h.session.ledger);h.page.observed.confirm=false;
  const tokens=h.tokenRequests;await h.page.click('release-ledger');
  assert.deepEqual(h.session.ledger,draft);assert.equal(h.tokenRequests,tokens,'declining closure preserves the draft without authorizing Drive');
  h.page.observed.confirm=true;await h.page.click('release-ledger');assert.equal(h.session.ledger,null);
 const files=structuredClone([...h.http.files]);const mutations=h.http.mutations;
  await h.page.click('create-ledger');assert.equal(h.http.mutations,mutations);assert.deepEqual([...h.http.files],files,'existing copy is never overwritten');
  assert.equal(h.session.mode,'preview');
 }finally{await h.close();}
});


test('open-existing rejects an empty folder without writes, then the visible create action seeds it',async()=>{
 const h=await setup();try{
  await h.page.until(()=>!h.page.get('open-ledger').disabled);await h.page.click('open-ledger');
  assert.equal(h.http.files.size,0);assert.equal(h.http.mutations,0);assert.equal(h.storage.lifecycle,null);
  assert.match(h.page.get('action-status').textContent,/Create new synthetic year/);
  await h.page.until(()=>!h.page.get('create-ledger').disabled);await h.page.click('create-ledger');
  assert.equal(h.session.mode,'saved');
 }finally{await h.close();}
});

test('cancelling create leaves a local preview and retry saves that exact preview',async()=>{
 const h=await setup();try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);h.cancel(true);await h.page.click('create-ledger');
  assert.equal(h.http.files.size,0);assert.equal(h.session.mode,'preview');h.session.correct({activityId:h.session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented-preview',rationale:'Invented preview correction'});const preview=structuredClone(h.session.ledger);
  assert.equal(h.page.get('create-ledger').textContent,'Save preview to a new folder');
  h.cancel(false);await h.page.click('create-ledger');assert.equal(h.session.mode,'saved');assert.deepEqual(h.session.ledger,preview);
 }finally{await h.close();}
});


test('pending create ignores repeat clicks and preserves newer page navigation',async()=>{
 const h=await setup();let unblock;try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);
  let entered,blocked=false;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>unblock=resolve);
  h.http.beforeResponse=async({category})=>{if(!blocked&&category==='list'){blocked=true;entered();await gate;}};
  const creating=h.page.click('create-ledger');await started;
  assert.equal(h.page.get('create-ledger').disabled,true);await h.page.click('create-ledger');assert.equal(h.tokenRequests,1);
  await h.page.navigate('#storage');unblock();await creating;
  assert.equal(h.session.mode,'saved');assert.equal(h.page.location.hash,'#storage');
 }finally{unblock?.();await h.close();}
});

test('cancelled reconnect through the shipped controller preserves the current writable draft',async()=>{
 const h=await setup();try{
  await h.page.until(()=>!h.page.get('create-ledger').disabled);await h.page.click('create-ledger');
  h.session.correct({activityId:h.session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented-retained',rationale:'Invented current draft'});
  const draft=h.session.ledger,base=h.session.store,lifecycle=h.storage.lifecycle;
  h.cancel(true);await h.page.click('open-ledger');
  assert.equal(h.session.ledger,draft);assert.equal(h.session.store,base);assert.equal(h.storage.lifecycle,lifecycle);
  assert.equal(h.session.needsReopen,false);assert.equal(h.session.canSave(),true);
  assert.equal(h.page.get('save-ledger').disabled,false);
 }finally{await h.close();}
});

test('browser route folder-proof fixture matches only the intended evidence endpoints',async()=>{
 const base='https://www.googleapis.com/drive/v3/files/invented-folder';
 const opts={method:'GET',headers:{authorization:'Bearer invented-test-token'},cache:'no-store'};
 const context={folderId:'invented-folder',token:'invented-test-token'};
 const query='supportsAllDrives=true&includePermissionsForView=published&fields=permissions(id,type,role,pendingOwner,view)';
 const owner=await fakeGoogleFolderProof(base+'/permissions?'+query,opts,context).json();
 assert.deepEqual(owner,{permissions:[{id:'invented-owner',type:'user',role:'owner'}]});
 assert.equal(fakeGoogleFolderProof(base+'-other/permissions?'+query,opts,context),undefined);
 assert.equal(fakeGoogleFolderProof(base+'/permissions?fields=id',opts,context),undefined);
});
