import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFullSnapshotStorage} from '../js/full-snapshot-storage.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {applyFinancialEvent,getEffectiveActivities} from '../js/canonical-import.mjs';

const bump=file=>{file.metadata.version=String(BigInt(file.metadata.version)+1n);};
const make=http=>createFullSnapshotStorage({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,
 cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
async function setup(){const http=new HttpFullSnapshotDrive(),store=make(http);await store.start({initialize:true});return {http,store,ledger:replayFixture(1).ledger};}
const patches=http=>http.requests.filter(r=>r.category==='update'&&r.kind==='finance-tracker-full-snapshot-manifest');
async function cleanup(h){h.http.beforeResponse=null;h.http.reboot();await h.store.release().catch(()=>{});}
const immutable=row=>['snapshot-object','commit-record'].includes(row.kind);

for(const phase of ['create-media','read-media','close-witness'])test('version-only drift converges with exact bytes at '+phase,async()=>{
 const h=await setup();try{
  if(phase==='read-media')await h.store.save(h.ledger);
  let changed=false,metadataCount=0;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(row.kind!=='snapshot-object'||changed)return;
   if(category==='metadata')metadataCount++;
   if((phase!=='close-witness'&&category==='media')||(phase==='close-witness'&&category==='metadata'&&metadataCount===3)){
    bump(h.http.files.get(fileId));changed=true;
   }
  };
  assert.deepEqual(await (phase==='read-media'?h.store.open():h.store.save(h.ledger)),h.ledger);
  assert.equal(changed,true,'provider drift was exercised');
  assert.equal(h.store.recoveryRequired,false);
  h.http.beforeResponse=null;
  assert.deepEqual(await h.store.open(),h.ledger);
 }finally{await cleanup(h);}
});

test('version drift with changed bytes never reaches authority publication',async()=>{
 const h=await setup();try{
  let changed=false;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(!changed&&category==='metadata'&&row.kind==='snapshot-object'&&h.http.requests.some(r=>r.fileId===fileId&&r.category==='media')){
    const file=h.http.files.get(fileId);file.bytes=file.bytes.slice();file.bytes[0]^=1;bump(file);changed=true;
   }
  };
  await assert.rejects(h.store.save(h.ledger),{code:'hash-mismatch'});
  assert.equal(changed,true);assert.equal(patches(h.http).length,0);assert.equal(h.store.recoveryRequired,true);
 }finally{await cleanup(h);}
});

for(const field of ['name','mimeType','appProperties','unexpectedProviderField'])test('version drift cannot hide immutable binding change: '+field,async()=>{
 const h=await setup();try{
  let changed=false;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(!changed&&category==='metadata'&&row.kind==='snapshot-object'&&h.http.requests.some(r=>r.fileId===fileId&&r.category==='media')){
    const file=h.http.files.get(fileId);bump(file);
    if(field==='appProperties')file.metadata.appProperties.extra='unexpected';
    else file.metadata[field]='unexpected';
    changed=true;
   }
  };
  await assert.rejects(h.store.save(h.ledger));
  assert.equal(changed,true);assert.equal(patches(h.http).length,0);assert.equal(h.store.recoveryRequired,true);
 }finally{await cleanup(h);}
});

test('continuously drifting versions stop after bounded reads without authority publication',async()=>{
 const h=await setup();try{
  let changes=0;
  h.http.beforeResponse=({category,fileId,row})=>{if(category==='metadata'&&immutable(row)){bump(h.http.files.get(fileId));changes++;}};
  await assert.rejects(h.store.save(h.ledger),{code:'verification-metadata-changed'});
  assert.ok(changes>2);assert.ok(changes<=12,'version checks must be bounded');assert.equal(patches(h.http).length,0);
 }finally{await cleanup(h);}
});

test('a backwards immutable version is refused rather than accepted after matching bytes',async()=>{
 const h=await setup();try{
  let reads=0;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(category==='metadata'&&row.kind==='snapshot-object')h.http.files.get(fileId).metadata.version=++reads===1?'9':'8';
  };
  await assert.rejects(h.store.save(h.ledger),{code:'verification-metadata-changed'});
  assert.equal(patches(h.http).length,0);
 }finally{await cleanup(h);}
});

test('recovery cannot bless changed snapshot bytes behind a version-only metadata change',async()=>{
 const h=await setup();try{
  await h.store.save(h.ledger);
  let changed=false;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(!changed&&category==='media'&&row.kind==='snapshot-object'){
    const file=h.http.files.get(fileId);file.bytes=file.bytes.slice();file.bytes[0]^=1;bump(file);changed=true;
   }
  };
  const before=patches(h.http).length;
  await assert.rejects(h.store.recover(),{code:'hash-mismatch'});
  assert.equal(changed,true);assert.equal(patches(h.http).length,before);assert.equal(h.store.recoveryRequired,true);
  assert.equal(h.store.verifiedManifest,null);
 }finally{await cleanup(h);}
});

test('manifest non-version metadata drift remains strict',async()=>{
 const h=await setup();try{
  let changed=false;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(!changed&&category==='media'&&row.kind==='finance-tracker-full-snapshot-manifest'){const file=h.http.files.get(fileId);bump(file);file.metadata.appProperties.extra='unexpected';changed=true;}
  };
  await assert.rejects(h.store.save(h.ledger),{code:'manifest-version-mismatch'});
  assert.equal(changed,true);assert.equal(patches(h.http).length,0);
 }finally{await cleanup(h);}
});

test('scope invalidation during version-only revalidation cannot publish or restore baseline',async()=>{
 const h=await setup();try{
  let mediaReads=0;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(category==='media'&&row.kind==='snapshot-object'){
    mediaReads++;
    if(mediaReads===1)bump(h.http.files.get(fileId));
    else h.store.invalidate();
   }
  };
  await assert.rejects(h.store.save(h.ledger),{code:'verification-scope-closed'});
  assert.equal(mediaReads,2);assert.equal(patches(h.http).length,0);assert.equal(h.store.verifiedManifest,null);
 }finally{await cleanup(h);}
});


test('version-only revalidation has a whole-operation read budget across history objects',async()=>{
 const h=await setup();try{
  let ledger=h.ledger;
  await h.store.save(ledger);
  for(let n=1;n<5;n++){
   ledger=applyFinancialEvent(ledger,{activityId:getEffectiveActivities(ledger)[0].activityId,type:'category-correction',
    categoryId:'invented-budget-'+n,commandId:'invented-budget-command-'+n,evidence:{rationale:'Invented budget test'}},
    {now:()=> '2026-11-17T00:00:00.000Z',idFactory:()=> 'f0110001-0000-4000-8000-'+String(n).padStart(12,'0')});
   await h.store.save(ledger);
  }
  const media=new Map(),start=h.http.requests.length;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(category==='media'&&immutable(row)){
    media.set(fileId,(media.get(fileId)||0)+1);
    if(media.get(fileId)===1)bump(h.http.files.get(fileId));
   }
  };
  await assert.rejects(h.store.open(),{code:'verification-metadata-changed'});
  assert.equal([...media.values()].filter(count=>count===2).length,8,'at most eight revalidation media reads');
  assert.equal([...media.values()].filter(count=>count===1).length,1,'ninth object hits budget before reread');
  assert.equal(h.http.requests.slice(start).filter(r=>r.method==='PATCH'||r.method==='POST').length,0);
  assert.equal(h.store.recoveryRequired,true);assert.equal(h.store.verifiedManifest,null);
 }finally{await cleanup(h);}
});
