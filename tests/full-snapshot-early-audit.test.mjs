// An admitted Open audits history while it claims the session. Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFullSnapshotStorage} from '../js/full-snapshot-storage.mjs';
import {inspectFullSnapshotFolder} from '../js/full-snapshot-application.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {applyFinancialEvent,getEffectiveActivities} from '../js/canonical-import.mjs';

const make=http=>createFullSnapshotStorage({folderId:http.folderId,accessToken:()=> 'invented-test-token',
 fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
const admit=http=>inspectFullSnapshotFolder(new GoogleDriveTransactionAdapter({folderId:http.folderId,
 accessToken:()=> 'invented-test-token',fetchImpl:http.fetch}),{requireExisting:true}).then(result=>result.admission);
const financialWrites=(http,start)=>http.requests.slice(start).filter(r=>['create','update'].includes(r.category)&&r.kind!=='session-marker');
let sequence=0;
const correction=ledger=>applyFinancialEvent(ledger,{activityId:getEffectiveActivities(ledger)[0].activityId,type:'category-correction',
 categoryId:'invented-early-'+(++sequence),commandId:'invented-early-command-'+sequence,evidence:{rationale:'Invented early audit test'}},
 {now:()=> '2026-11-26T00:00:00.000Z',idFactory:()=> 'f0110001-0000-4000-8000-'+String(sequence).padStart(12,'0')});

// Three saved revisions, released, so another engine can claim the folder.
async function saved({release=true}={}){
 const http=new HttpFullSnapshotDrive(),owner=make(http);await owner.start({initialize:true});
 let ledger=replayFixture(1).ledger;await owner.save(ledger);
 for(let i=0;i<2;i++){ledger=correction(ledger);await owner.save(ledger);}
 if(release)await owner.release();
 return {http,owner,ledger};
}

test('an admitted open reads history before its session claim completes and returns the serial result',async()=>{
 const {http,ledger}=await saved(),admission=await admit(http),store=make(http),start=http.requests.length;
 try{
  assert.deepEqual(await store.start({admission}),ledger);
  const rows=http.requests.slice(start),claim=rows.findIndex(r=>r.kind==='session-marker'&&r.category==='update');
  const firstSnapshot=rows.findIndex(r=>r.kind==='snapshot-object'&&r.category==='media');
  assert.ok(claim>0&&firstSnapshot>=0&&firstSnapshot<claim,'history reads overlap the claim');
  assert.equal(financialWrites(http,start).length,0);assert.equal(store.recoveryRequired,false);
  assert.deepEqual(store.verifiedManifest,http.json(store.manifestFileId));
  await store.release();
  // The serial path, without admission, verifies the same ledger.
  const serial=make(http);try{assert.deepEqual(await serial.start(),ledger);}finally{await serial.release().catch(()=>{});}
 }finally{await store.release().catch(()=>{});}
});

test('a refused claim cancels the early audit and leaves no read running',async()=>{
 const {http,owner}=await saved({release:false}),admission=await admit(http),store=make(http),start=http.requests.length;
 try{
  await assert.rejects(store.start({admission}),{code:'session-active'});
  assert.equal(http.active,0,'every early read settled before the refusal');
  assert.equal(http.requests.slice(start).filter(r=>r.method!=='GET').length,0,'no marker or ledger write');
  assert.equal(store.verifiedManifest,null);
 }finally{await owner.release().catch(()=>{});}
});

test('corruption found by an early audit fails the open as a serial audit does',async()=>{
 const codes=[];
 for(const early of [true,false]){
  const {http}=await saved(),admission=await admit(http);
  const id=[...http.files.values()].find(f=>f.metadata.appProperties?.financeTrackerKind==='finance-tracker-full-snapshot-manifest').metadata.id;
  const head=http.json(http.json(id).head.fileId),file=http.files.get(http.json(head.parent.fileId).snapshot.fileId);
  file.bytes=file.bytes.slice();file.bytes[0]^=1;
  const store=make(http),start=http.requests.length;
  // A failed audit keeps its session for recovery, so each path has its own folder.
  await assert.rejects(store.start(early?{admission}:{}),error=>{codes.push(error.code);return true;});
  assert.equal(http.active,0);assert.equal(financialWrites(http,start).length,0);
  assert.equal(store.verifiedManifest,null);assert.equal(store.recoveryRequired,true);
 }
 assert.deepEqual(codes,['hash-mismatch','hash-mismatch']);
});

test('a manifest changed after admission is refused and the new claim is released',async()=>{
 const {http,owner,ledger}=await saved({release:false}),admission=await admit(http);
 await owner.save(correction(ledger));await owner.release();
 const store=make(http),start=http.requests.length;
 await assert.rejects(store.start({admission}),{code:'base-conflict'});
 assert.equal(http.active,0);assert.equal(financialWrites(http,start).length,0);
 assert.equal(store.coordinator.canWrite,false,'the unusable claim is released');
});
