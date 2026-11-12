import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {initializePagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {SyntheticYearSeeder} from '../js/synthetic-year-seeder.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {exportPagedCanonicalArchive,restorePagedCanonicalArchive,withSourceEvidenceVerification} from '../js/paged-canonical-backup.mjs';
import {verifyPagedArchiveInMemory} from '../js/paged-archive-rehearsal.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
const plans=()=>withSourceEvidenceVerification(canonicalPartitionVerificationPlans());
function app(http,manifestFileId) {return new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,verificationPlans:plans(),
  folderName:'Invented synthetic app restore',folderId:http.folderId,manifestFileId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,
  makeManifest:()=>{},initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),
  adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null});}
async function archive(lifecycle) {const chunks=[];await exportPagedCanonicalArchive({sourceAdapter:lifecycle.transactionAdapter,sourceManifestFileId:lifecycle.manifestFileId,
  withSourceLock:fn=>lifecycle.coordinator.withWrite(fn),assertSourceWritable:async()=>{await lifecycle.coordinator.assertCanWrite({online:true});},verificationPlans:plans(),sink:{write:async chunk=>chunks.push(chunk)}});
  const raw=Buffer.concat(chunks);assert.deepEqual([...raw.subarray(0,8)],[70,84,66,83,13,10,3,0]);assert.equal(raw[8],1);
  const root=JSON.parse(raw.subarray(13,13+raw.readUInt32BE(9)).toString('utf8'));
  assert.equal(root.profile,'canonical5-physical4');assert.equal(root.canonical.version,5);assert.equal(root.protocol.version,4);assert.equal(root.catalog,null);
  return chunks;}


test('restored primary opens and edits through actual app lifecycle, retaining offline source provenance',async()=>{
  const source=new HttpCatalogDrive({folderId:'invented-source',idPrefix:'source-'}),first=app(source);let next;
  try {
    await first.start();const ledger=replayFixture(2).ledger;
    const seeder=new SyntheticYearSeeder({createRecipe:async()=>({ledger})});await seeder.admitFreshConnection(first);
    const seeded=await seeder.verifyOrSeed(first);assert.equal(seeded.storageLayout,'partitions-v5');assert.equal(seeded.alreadySaved,false);
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

test('actual workspace batches mixed commands, uploads exact final closures, and cold reopens every source event',async t=>{
 const {inspectFinalClosures}=await import('./helpers/paged-final-closures.mjs');
 const {buildFinancialPosition,buildAccountMonthCoverage}=await import('../js/financial-position.mjs');
 const {summarizeLedgerPeriods,registerAccount,prepareCanonicalImport}=await import('../js/canonical-import.mjs');
 const {replayInput,replayRow}=await import('./helpers/ledger-replay-fixtures.mjs');
 const drive=new HttpCatalogDrive({folderId:'invented-mixed',idPrefix:'mixed-'}),first=app(drive);let cold,restoredApp;
 try {
  await first.start();const fixture=replayFixture(132);let ledger=registerAccount(fixture.ledger,{institutionId:'sofi',displayName:'Invented transfer destination',currency:'USD',accountType:'savings'},fixture.options);
  ledger=prepareCanonicalImport(ledger,replayInput(ledger.accounts.at(-1),[replayRow(0,{amountText:'12.34',sourceDescription:'INVENTED TRANSFER IN'})],'invented-batch-transfer'),fixture.options).ledger;
  const seeder=new SyntheticYearSeeder({createRecipe:async()=>({ledger})});await seeder.admitFreshConnection(first);await seeder.verifyOrSeed(first);
  const session=new CanonicalWorkspaceSession({storage:{lifecycle:first}});await session.loadVerified();
  const base=structuredClone(session.store.base),before=inspectFinalClosures(drive,base);
  session.correct({activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:'-1',rationale:'Invented undo'});session.undoLastStagedChange();assert.deepEqual(session.ledger,ledger);
  session.correct({activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:'-2',rationale:'Invented revert'});session.revertAllStagedChanges();assert.deepEqual(session.ledger,ledger);
  for(let i=0;i<8;i++)session.correct({activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:String(-10-i),rationale:'Invented repeated amount '+i});
  session.correct({activityId:ledger.activities[1].activityId,type:'posting-status-correction',lifecycleStatus:'pending',postedDate:null,rationale:'Invented pending evidence'});
  session.correct({activityId:ledger.activities[2].activityId,type:'category-correction',categoryId:'invented-v5-category',rationale:'Invented category evidence'});
  for(const activity of [ledger.activities[3],ledger.activities.at(-1)])session.correct({activityId:activity.activityId,type:'classification',activityKind:'transfer',rationale:'Invented transfer classification'});
  session.linkTransfer({outgoingActivityId:ledger.activities[3].activityId,counterpartyActivityId:ledger.activities.at(-1).activityId,rationale:'Invented reciprocal transfer evidence'});
  session.addAccount({institutionId:'sofi',accountType:'checking',displayName:'Invented batch position',currency:'USD'});
  const accountId=session.ledger.accounts.at(-1).accountId,source={kind:'statement',reference:'Invented batch statement'};
  for(const effectiveDate of ['2025-12-31','2026-01-31'])session.recordPosition({type:'balance-snapshot',accountId,effectiveDate,amountText:'1000.00',basis:'statement',source});
  const [opening,closing]=session.ledger.positionEvents;
  session.recordPosition({type:'reconciliation',accountId,month:'2026-01',openingBalanceEventId:opening.eventId,closingBalanceEventId:closing.eventId,source});
  const expected=structuredClone(session.ledger),requestStart=drive.requests.length;
  let submitted;
  const save=first.savePartitionedRoot.bind(first);
  first.savePartitionedRoot=input=>save({...input,prepare:async context=>{const prepared=await input.prepare(context);submitted=structuredClone(prepared.objects);return prepared;}});
  await session.save();assert.deepEqual(session.ledger,expected);
  const final=inspectFinalClosures(drive,session.store.base),created=drive.requests.slice(requestStart).filter(row=>row.category==='create');
  const canonicalCreated=created.filter(row=>row.kind==='snapshot-object').map(row=>drive.files.get(row.fileId).metadata.appProperties.financeTrackerHash);
  const required=[...final.canonicalHashes].filter(hash=>!before.retainedData.has(hash)).sort();
  assert.deepEqual(canonicalCreated.toSorted(),required);assert.deepEqual(submitted.filter(d=>!before.retainedData.has(d.sha256)).map(d=>d.sha256).sort(),required);
  for(const d of submitted)assert.ok(final.canonicalHashes.has(d.sha256),'submitted prepared bytes are all final-reachable');
  const locatorCreated=created.filter(row=>['locator-catalog-page','locator-catalog'].includes(row.kind)).map(row=>row.fileId);
  assert.deepEqual(locatorCreated.toSorted(),[...final.locatorFileIds].filter(id=>!before.locatorFileIds.has(id)).sort());
  assert.equal(new Set(canonicalCreated).size,canonicalCreated.length);assert.equal(new Set(locatorCreated).size,locatorCreated.length);
  for(const [hash,ref] of before.retainedData)assert.deepEqual(final.retainedData.get(hash),ref,'all historical objects remain mapped');
  const writes=drive.mutations;await session.store.save(expected);assert.equal(drive.mutations,writes,'no-op save writes nothing');
  const manifestFileId=first.manifestFileId;await first.release();cold=app(drive,manifestFileId);await cold.start();
  const reopened=new CanonicalWorkspaceSession({storage:{lifecycle:cold}});await reopened.loadVerified();assert.deepEqual(reopened.ledger,expected);
  assert.deepEqual(reopened.ledger.observations,ledger.observations);assert.deepEqual(reopened.ledger.activities,ledger.activities);assert.deepEqual(reopened.ledger.events.slice(0,ledger.events.length),ledger.events);
  assert.deepEqual(buildFinancialPosition(reopened.ledger,{asOf:'2026-01-31'}),buildFinancialPosition(expected,{asOf:'2026-01-31'}));
  assert.deepEqual(buildAccountMonthCoverage(reopened.ledger,{month:'2026-01'}),buildAccountMonthCoverage(expected,{month:'2026-01'}));
  assert.deepEqual(summarizeLedgerPeriods(reopened.ledger,[{start:'2026-01-01',end:'2026-12-31',currency:'USD'}]),summarizeLedgerPeriods(expected,[{start:'2026-01-01',end:'2026-12-31',currency:'USD'}]));
  const chunks=await archive(cold);await cold.release();drive.stopped=true;
  const target=new HttpCatalogDrive({folderId:'invented-mixed-restore',idPrefix:'mixed-restore-'});
  const targetAdapter=new GoogleDriveTransactionAdapter({folderId:target.folderId,accessToken:()=> 'invented-test-token',fetchImpl:target.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0});
  const restored=await restorePagedCanonicalArchive({source:chunks,targetAdapter,withTargetLock:fn=>fn(),assertTargetWritable:async()=>{},verificationPlans:plans()});
  restoredApp=app(target,restored.manifestFileId);await restoredApp.start();
  const restoredSession=new CanonicalWorkspaceSession({storage:{lifecycle:restoredApp}});await restoredSession.loadVerified();assert.deepEqual(restoredSession.ledger,expected);
  assert.ok(restored.manifest.sourceEvidence,'restore verifies exact source history without reading the stopped source');
  t.diagnostic(JSON.stringify({canonicalUploads:canonicalCreated.length,locatorUploads:locatorCreated.length,protocolUploads:created.length-canonicalCreated.length-locatorCreated.length,requestBytes:drive.requests.slice(requestStart).reduce((n,row)=>n+(row.requestBytes??0),0),note:'Invented HTTP path only. Full-ledger/history validation and memory remain.'}));
 }finally{if(first.started)await first.release();if(cold?.started)await cold.release();if(restoredApp?.started)await restoredApp.release();}
});
