import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFullSnapshotStorage} from '../js/full-snapshot-storage.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {applyFinancialEvent,getEffectiveActivities} from '../js/canonical-import.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

for(const failure of ['first-read-rejection','invalidation','second-binding-change'])test('paired closure drains both reads and fails closed: '+failure,async()=>{
 const http=new HttpFullSnapshotDrive();
 const store=createFullSnapshotStorage({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
 let unblock;const gate=new Promise(resolve=>{unblock=resolve;});
 try{
  await store.start({initialize:true});const ledger=replayFixture(1).ledger;await store.save(ledger);
  const candidate=applyFinancialEvent(ledger,{activityId:getEffectiveActivities(ledger)[0].activityId,type:'category-correction',categoryId:'invented-pair',commandId:'invented-pair-command',evidence:{rationale:'Invented concurrency test'}},{now:()=> '2026-11-17T00:00:00.000Z',idFactory:()=> 'f0110001-0000-4000-8000-000000000001'});
  const mutations=http.mutations;let seen={},enteredResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;});
  http.beforeResponse=async({category,fileId,row})=>{
   if(category!=='metadata'||!['commit-record','snapshot-object'].includes(row.kind))return;
   seen[row.kind]=(seen[row.kind]||0)+1;if(seen[row.kind]!==3)return;
   if(row.kind==='commit-record'&&failure==='first-read-rejection')throw Error('invented witness failure');
   if(row.kind==='snapshot-object'){
    enteredResolve();await gate;
    if(failure==='second-binding-change')http.files.get(fileId).metadata.name='invented changed binding';
   }
  };
  let settled=false;const saving=store.save(candidate).finally(()=>{settled=true;});
  const rejected=assert.rejects(saving);await entered;
  let released=false;const releasing=store.release().finally(()=>{released=true;});const releaseRejected=assert.rejects(releasing);
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(settled,false,'must drain second in-flight metadata read');assert.equal(released,false,'release must wait for admitted save');
  if(failure==='invalidation')store.invalidate();
  unblock();await rejected;await releaseRejected;
  assert.equal(http.mutations,mutations,'no writes after failed closure');
  assert.equal(store.recoveryRequired,true);assert.equal(store.verifiedManifest,null);
 }finally{unblock();http.beforeResponse=null;http.reboot();await store.release().catch(()=>{});}
});

test('both paired witnesses can settle version-only drift without concurrent content reads',async()=>{
 const http=new HttpFullSnapshotDrive();const store=createFullSnapshotStorage({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
 try{
  await store.start({initialize:true});const ledger=replayFixture(1).ledger;await store.save(ledger);let seen={},bumps=0,active=0,peak=0;
  http.beforeResponse=async({category,fileId,row})=>{
   if(!['commit-record','snapshot-object'].includes(row.kind))return;
   if(category==='metadata'&&(seen[row.kind]=(seen[row.kind]||0)+1)===3){const m=http.files.get(fileId).metadata;m.version=String(BigInt(m.version)+1n);bumps++;}
   if(category==='media'){peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,1));active--;}
  };
  assert.deepEqual(await store.save(ledger),ledger);assert.equal(bumps,2);assert.equal(peak,1);assert.equal(store.recoveryRequired,false);
 }finally{http.beforeResponse=null;http.reboot();await store.release().catch(()=>{});}
});
