import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createLedger,applyFinancialEvent,getEffectiveActivities,validateLedger,validateProspectiveProductionLedger} from '../js/canonical-import.mjs';
import {
 createProspectiveGenesis,appendProspectiveSnapshot,verifyProspectiveSnapshotChain
} from '../js/prospective-production-snapshot.mjs';
import {
 encodeFullSnapshotBackup,decodeFullSnapshotBackup,
 encodeProspectiveProductionBackup,decodeProspectiveProductionBackup
} from '../js/full-snapshot-backup.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

const options={cryptoImpl:webcrypto,password:'invented-backup-password'};
const source=()=>createProspectiveGenesis({databaseId:'invented-database',copyId:'invented-copy'});
const fixture=()=>replayFixture(1).ledger;
// Fixture data only; no application conversion or relabelling entry point.
function productionFixture({syntheticOnly,...sample}){
 return {...sample,version:3,dataClass:'production'};
}

test('detached chain verifies invented history and archive restore creates different physical lineage',async()=>{
 const orig=fixture();
 const changed=applyFinancialEvent(orig,{
  activityId:getEffectiveActivities(orig)[0].activityId,type:'category-correction',categoryId:'invented-corrected',
  commandId:'invented-prospective-commit',evidence:{rationale:'Fixture correction'}
 },{now:'2026-11-23T01:00:00Z',idFactory:()=> '99999999-0000-4000-8000-000000000001'});
 const genesis=source();
 const original=await appendProspectiveSnapshot(genesis,[],productionFixture(orig),options);
 const next=productionFixture(changed);
 const second=await appendProspectiveSnapshot(genesis,[original],next,options);
 const verified=await verifyProspectiveSnapshotChain(genesis,[original,second],options);
 assert.deepEqual(verified.ledger,next);
 assert.equal(second.commit.parent,original.manifest.head);
 assert.equal(verified.manifest.revision,'2');
 const archive=await encodeProspectiveProductionBackup(next,options);
 const restored=await decodeProspectiveProductionBackup(archive,options);
 const destination=createProspectiveGenesis({databaseId:'invented-database',copyId:'fresh-invented-copy'});
 const restoredFrame=await appendProspectiveSnapshot(destination,[],restored,options);
 assert.deepEqual((await verifyProspectiveSnapshotChain(destination,[restoredFrame],options)).ledger,next);
 assert.notEqual(restoredFrame.manifest.head,second.manifest.head);
 assert.equal(restoredFrame.commit.copyId,destination.copyId);
 assert.equal(restoredFrame.commit.parent,null);
});

test('cross-class ledgers, manifests and archives refuse in both directions',async()=>{
 const synthetic=fixture(),production=productionFixture(synthetic),genesis=source();
 assert.throws(()=>validateLedger(production),{code:'invalid-canonical-ledger'});
 assert.throws(()=>validateProspectiveProductionLedger(synthetic),{code:'invalid-canonical-ledger'});
 await assert.rejects(appendProspectiveSnapshot(genesis,[],synthetic,options),{code:'invalid-canonical-ledger'});
 const {dataClass,...manifest}=genesis;
 await assert.rejects(verifyProspectiveSnapshotChain({...manifest,version:1,syntheticOnly:true},[],options),{code:'unsupported-canonical-layout'});
 const oldArchive=await encodeFullSnapshotBackup(synthetic,options);
 const newArchive=await encodeProspectiveProductionBackup(production,options);
 await assert.rejects(decodeFullSnapshotBackup(newArchive,options),{code:'unsupported-archive'});
 await assert.rejects(decodeProspectiveProductionBackup(oldArchive,options),{code:'unsupported-archive'});
 await assert.rejects(encodeProspectiveProductionBackup(production,{cryptoImpl:webcrypto}),{code:'backup-password-required'});
 await assert.rejects(decodeProspectiveProductionBackup(newArchive,{...options,password:'incorrect-fixture-password'}),{code:'backup-decryption-failed'});
});

test('prospective chain refuses wrong copy, missing history and mismatched ledger class',async()=>{
 const genesis=source();
 const frame=await appendProspectiveSnapshot(genesis,[],productionFixture(createLedger()),options);
 await assert.rejects(verifyProspectiveSnapshotChain({...genesis,copyId:'different-invented-copy'},[frame],options),{code:'history-mismatch'});
 await assert.rejects(verifyProspectiveSnapshotChain(frame.manifest,[],options),{code:'history-mismatch'});
 await assert.rejects(verifyProspectiveSnapshotChain(genesis,[{...frame,ledger:createLedger()}],options),{code:'invalid-canonical-ledger'});
});
