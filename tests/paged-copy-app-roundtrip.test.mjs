import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {initializePagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {SyntheticYearSeeder} from '../js/synthetic-year-seeder.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {exportPagedCanonicalArchive,restorePagedCanonicalArchive,verifyCanonicalMigrationEvidence,withSourceEvidenceVerification} from '../js/paged-canonical-backup.mjs';
import {verifyPagedArchiveInMemory} from '../js/paged-archive-rehearsal.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
const plans=()=>withSourceEvidenceVerification(canonicalPartitionVerificationPlans({verifyMigrationEvidence:verifyCanonicalMigrationEvidence}));
function app(http,manifestFileId) {return new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,verificationPlans:plans(),
  folderName:'Invented synthetic app restore',folderId:http.folderId,manifestFileId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,
  makeManifest:()=>{},initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),
  adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},lifecycleTarget:null});}
async function archive(lifecycle) {const chunks=[];await exportPagedCanonicalArchive({sourceAdapter:lifecycle.transactionAdapter,sourceManifestFileId:lifecycle.manifestFileId,
  withSourceLock:fn=>lifecycle.coordinator.withWrite(fn),assertSourceWritable:async()=>{await lifecycle.coordinator.assertCanWrite({online:true});},verificationPlans:plans(),sink:{write:async chunk=>chunks.push(chunk)}});return chunks;}

test('restored primary opens and edits through actual app lifecycle, retaining offline source provenance',async()=>{
  const source=new HttpCatalogDrive({folderId:'invented-source',idPrefix:'source-'}),first=app(source);let next;
  try {
    await first.start();const ledger=replayFixture(2).ledger;
    const seeder=new SyntheticYearSeeder({createRecipe:async()=>({ledger})});await seeder.admitFreshConnection(first);
    const seeded=await seeder.verifyOrSeed(first);assert.equal(seeded.storageLayout,'partitions-v4');assert.equal(seeded.alreadySaved,false);
    const mutations=source.mutations;assert.equal((await seeder.verifyOrSeed(first)).alreadySaved,true);assert.equal(source.mutations,mutations);
    const chunks=await archive(first);await first.release();source.stopped=true;
    const target=new HttpCatalogDrive({folderId:'invented-target',idPrefix:'target-'});
    const adapter=new GoogleDriveTransactionAdapter({folderId:target.folderId,accessToken:()=> 'invented-test-token',fetchImpl:target.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0});
    const restored=await restorePagedCanonicalArchive({source:chunks,targetAdapter:adapter,withTargetLock:fn=>fn(),assertTargetWritable:async()=>{},verificationPlans:plans()});
    assert.ok(restored.manifest.sourceEvidence);next=app(target,restored.manifestFileId);await next.start();
    const session=new CanonicalWorkspaceSession({storage:{lifecycle:next}});await session.loadVerified();assert.deepEqual(session.ledger,ledger);
    session.correct({activityId:ledger.activities[0].activityId,type:'posting-status-correction',lifecycleStatus:'pending',postedDate:null,rationale:'Invented restored correction'});
    const expected=structuredClone(session.ledger);await session.save();await session.reopen();assert.deepEqual(session.ledger,expected);
    assert.deepEqual(session.store.base.sourceEvidence,restored.manifest.sourceEvidence);
    const second=await archive(next);await next.release();target.stopped=true;
    await verifyPagedArchiveInMemory(second,{verificationPlans:plans()});
  } finally {if(first.started&&!source.stopped)await first.release();if(next?.started)await next.release();}
});
