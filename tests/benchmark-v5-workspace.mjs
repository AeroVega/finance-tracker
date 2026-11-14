/** Canonical v5 workspace benchmark. Actual app controllers and synthetic HTTP, never a live provider. Run with
 * node --max-old-space-size=768 tests/benchmark-v5-workspace.mjs.
 * Optional V5_BENCH_REVISIONS adds amount corrections to retained history. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {initializePagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {getEffectiveActivities,summarizeLedger} from '../js/canonical-import.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';

const dense=process.env.V5_BENCH_DENSE==='1',coldReopen=process.env.V5_BENCH_COLD_REOPEN==='1';
function sourceFingerprint() {
  const paths=['tests/benchmark-v5-workspace.mjs'];
  function visit(path){for(const entry of readdirSync(new URL('../'+path+'/',import.meta.url),{withFileTypes:true})){
    const child=path+'/'+entry.name;if(entry.isDirectory())visit(child);else if(entry.isFile()&&entry.name.endsWith('.mjs'))paths.push(child);
  }}
  for(const path of ['js','prototype','tests/helpers'])visit(path);
  const hash=createHash('sha256');for(const path of paths.sort()){hash.update(path+'\0');hash.update(readFileSync(new URL('../'+path,import.meta.url)));}
  return {sha256:hash.digest('hex'),fileCount:paths.length};
}
const initialFingerprint=sourceFingerprint();
console.log(JSON.stringify({runtime:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,execArgv:process.execArgv},
  sourceFingerprint:initialFingerprint,
  configuration:{layout:'partitions-v5',dense,coldReopen,retainedCorrections:Number(process.env.V5_BENCH_REVISIONS??0),syntheticHttpDelayMs:0,
    physicalByteCacheBytes:8*1024*1024,
    physicalBodyFactEntries:512,physicalBodyFactSerializedBytes:1024*1024,
    locatorDecodedNodeEntries:128,locatorDecodedSerializedBytes:2*1024*1024,heartbeat:'real lifecycle timer'},
  concurrentLoad:process.env.V5_BENCH_CONCURRENCY_NOTE??'Other local workloads were not controlled; wall time is not an isolated CPU comparison.',
  coldReopenNote:'Optional cold-adapter reopen creates a fresh lifecycle and storage caches after release. It is in the same process, not a new browser/device or a clean process-memory peak.',
  cacheNote:'Serialized key/metadata/node budgets are not bounds on JavaScript heap RAM. Canonical semantic results remain scoped to a single verification operation.',
  memoryNote:'RSS/heap/external/arrayBuffers are per-phase boundary snapshots, not phase peaks. OS max RSS is cumulative for this whole process, in KiB on Linux. HTTP fixture files and request logs are included.'}));
const http=new HttpCatalogDrive();
const app=new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,verificationPlans:canonicalPartitionVerificationPlans(),
  folderName:'invented synthetic benchmark',folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,
  makeManifest:()=>{},initializeManifest:async({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),
  adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},lifecycleTarget:null});
let coldApp=null,appReleased=false;
let commandSequence=0;
function stageCorrection(session,command) {
  // Only the synchronous financial-controller call receives invented stable
  // event IDs/timestamps. Lease clocks, timers and physical IDs stay real.
  const randomUUID=crypto.randomUUID,RealDate=globalThis.Date;
  crypto.randomUUID=()=>`be000001-0000-4000-8000-${String(++commandSequence).padStart(12,'0')}`;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-11-11T00:00:00.000Z']));}};
  try {session.correct(command);} finally {crypto.randomUUID=randomUUID;globalThis.Date=RealDate;}
}
async function phase(name,operation) {
  http.phase=name;const start=performance.now(),cpuStart=process.cpuUsage(),memoryBefore=process.memoryUsage();let status='failed';
  try {const result=await operation();status='verified';return result;}
  finally {console.log(JSON.stringify({phase:name,status,ms:performance.now()-start,cpuMicroseconds:process.cpuUsage(cpuStart),
    memoryBefore,memoryAfter:process.memoryUsage(),cumulativeProcessMaxRssKiB:process.resourceUsage().maxRSS,files:http.files.size,...http.summary(name)}));}
}
try {
  await phase('initialize',()=>app.start());
  const store=new CanonicalLedgerStore({lifecycle:app});await phase('empty-open',()=>store.load());
  const {ledger}=dense?denseLedgerFixture(1):await createSyntheticFinancialYear();
  console.log(JSON.stringify({fixture:dense?'dense-one-year':'standard-one-year',layout:'partitions-v5',activities:ledger.activities.length,events:ledger.events.length,jsonBytes:new TextEncoder().encode(JSON.stringify(ledger)).length}));
  await phase('seed-'+ledger.activities.length+'-activities',()=>store.save(ledger));
  console.log(JSON.stringify({storedSnapshotBytes:[...http.files.values()].filter(file=>file.metadata.appProperties?.financeTrackerKind==='snapshot-object').reduce((sum,file)=>sum+file.bytes.length,0)}));
  const session=new CanonicalWorkspaceSession({storage:{lifecycle:app}});
  await phase('open',()=>session.loadVerified());
  const activity=getEffectiveActivities(session.ledger).find(a=>a.sourceDescription===(dense?'INVENTED FEE':'INVENTED BROKERAGE FEE'));
  stageCorrection(session,{activityId:activity.activityId,type:'classification',activityKind:'spending',rationale:'Invented benchmark classification'});
  stageCorrection(session,{activityId:activity.activityId,type:'category-correction',categoryId:'invented-fees',rationale:'Invented benchmark category'});
  await phase('save-two-staged-edits',()=>session.save());
  await phase('no-op-save',()=>session.store.save(session.ledger));
  const revisions=Number(process.env.V5_BENCH_REVISIONS??0);assert.ok(Number.isSafeInteger(revisions)&&revisions>=0);
  for(let index=0;index<revisions;index++) {
    stageCorrection(session,{activityId:activity.activityId,type:'bank-correction',amountText:String(-100-index),rationale:'Invented retained revision'});
    await phase('retained-save-'+(index+1),()=>session.save());
  }
  const expected=structuredClone(session.ledger);await phase('reopen',()=>session.reopen());
  assert.deepEqual(session.ledger,expected);assert.deepEqual(session.ledger.activities,ledger.activities);
  assert.deepEqual(session.ledger.observations,ledger.observations);assert.deepEqual(session.ledger.events.slice(0,ledger.events.length),ledger.events);
  const january={start:dense?'2015-01-01':'2025-01-01',end:dense?'2015-01-31':'2025-01-31',currency:'USD'};
  assert.deepEqual(session.store.monthIndex.report(january).report,summarizeLedger(session.ledger,january));
  if(coldReopen) {
    await app.release();
    appReleased=true;
    coldApp=new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,
      verificationPlans:canonicalPartitionVerificationPlans(),folderName:'Invented synthetic cold reopen',folderId:http.folderId,
      manifestFileId:app.manifestFileId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,makeManifest:()=>{},
      adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},lifecycleTarget:null});
    await phase('cold-adapter-reopen',async()=>{await coldApp.start();const coldStore=new CanonicalLedgerStore({lifecycle:coldApp});assert.deepEqual(await coldStore.load(),expected);});
  }
} finally {
  if(coldApp)await coldApp.release().catch(error=>{console.error('Cold release failed:',error.code);process.exitCode=1;});
  if(!appReleased)await app.release().catch(error=>{console.error('Release failed:',error.code);process.exitCode=1;});
  const finalFingerprint=sourceFingerprint();
  console.log(JSON.stringify({finalMemorySnapshot:process.memoryUsage(),wholeProcessCumulativeMaxRssKiB:process.resourceUsage().maxRSS,
    finalSourceFingerprint:finalFingerprint,sourceFilesUnchangedDuringRun:initialFingerprint.sha256===finalFingerprint.sha256}));
}
