// Invented full-year data and synthetic HTTP only. Backend guide paths use real
// session coordinators/heartbeats; this is not a rendered browser/device test.
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {initializePagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {SessionCoordinator} from '../js/session-coordination.mjs';
import {createDriveSessionAdapter} from '../js/drive-session-adapter.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {backupPagedCanonicalCopy,exportPagedCanonicalArchive,restorePagedCanonicalArchive,withSourceEvidenceVerification} from '../js/paged-canonical-backup.mjs';
const plans=()=>withSourceEvidenceVerification(canonicalPartitionVerificationPlans());
const token=()=> 'invented-test-token';
function sourceFingerprint(){
  const files=['tests/benchmark-paged-copy.mjs'];
  function visit(path){for(const entry of readdirSync(new URL('../'+path+'/',import.meta.url),{withFileTypes:true})){
    const child=path+'/'+entry.name;if(entry.isDirectory())visit(child);else if(entry.isFile()&&entry.name.endsWith('.mjs'))files.push(child);
  }}
  for(const path of ['js','prototype','tests/helpers'])visit(path);
  const hash=createHash('sha256');for(const path of files.sort()){hash.update(path+'\0');hash.update(readFileSync(new URL('../'+path,import.meta.url)));}
  return hash.digest('hex');
}
const initialFingerprint=sourceFingerprint();
const providers=[];
function destination(name){const http=new HttpCatalogDrive({folderId:name,idPrefix:name+'-'});providers.push(http);return {http,adapter:new GoogleDriveTransactionAdapter({folderId:name,accessToken:token,fetchImpl:http.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0})};}
function lifecycle(http,{manifestFileId}={}) {return new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,
  verificationPlans:plans(),folderName:'Invented synthetic copy benchmark',folderId:http.folderId,manifestFileId,
  accessToken:token,fetchImpl:http.fetch,lifecycleTarget:null,adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},makeManifest:()=>{},
  initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard})});}
async function withDestination(target,operation) {
  const coordinator=new SessionCoordinator({adapter:createDriveSessionAdapter({folderId:target.http.folderId,accessToken:token,fetchImpl:target.http.fetch})});let stop;
  try {await coordinator.start();stop=coordinator.startHeartbeat();return await operation({targetAdapter:target.adapter,
    withTargetLock:fn=>coordinator.withWrite(fn),assertTargetWritable:async()=>{await coordinator.assertCanWrite({online:true});},verificationPlans:plans()});}
  finally {try{if(coordinator.canWrite)await coordinator.release();}finally{stop?.();}}
}
function source(app) {return {sourceAdapter:app.transactionAdapter,sourceManifestFileId:app.manifestFileId,
  withSourceLock:fn=>app.coordinator.withWrite(fn),assertSourceWritable:async()=>{await app.coordinator.assertCanWrite({online:true});},verificationPlans:plans()};}
async function phase(name,operation) {
  for(const http of providers)http.phase=name;
  const started=performance.now(),cpu=process.cpuUsage(),memoryBefore=process.memoryUsage();let status='failed';
  try {const result=await operation();status='verified';return result;}
  finally {console.log(JSON.stringify({phase:name,status,elapsedMs:performance.now()-started,cpuMicroseconds:process.cpuUsage(cpu),memoryBefore,
    memoryAfter:process.memoryUsage(),cumulativeProcessMaxRssKiB:process.resourceUsage().maxRSS,
    providers:providers.map(http=>({folderId:http.folderId,...http.summary(name)}))}));}
}
console.log(JSON.stringify({runtime:{node:process.version,v8:process.versions.v8,execArgv:process.execArgv},
  sourceFingerprint:initialFingerprint,
  configuration:{fixture:'invented-standard-one-year',syntheticHttpDelayMs:0,heartbeat:'real source and target session timers',
    ownedPhysicalByteCacheBytes:8*1024*1024,ownedBodyFactEntries:512,ownedBodyFactSerializedBytes:1024*1024,
    ownedLocatorDecodedEntries:128,ownedLocatorDecodedSerializedBytes:2*1024*1024,evidenceLookupEntries:128,evidenceLookupSerializedBytes:1024*1024},
  comparisonNote:'Earlier copy logs used no-op ownership callbacks. These guide-backend totals are a different, stricter boundary and cannot be attributed solely to runtime optimization.',
  concurrencyNote:'Other local worker workloads are not controlled. CPU and wall time are synthetic, not live Drive or device acceptance.',
  cacheNote:'These are encoded-content accounting limits, not heap RAM guarantees. Owned decoder capability is absent from inert foreign evidence adapters.',
  memoryNote:'Per-phase memory is boundary snapshots, not phase peaks. OS max RSS is cumulative for this process and includes all HTTP fixtures, logs and buffered archive chunks.'}));
const original=destination('invented-year-v5'),opened=lifecycle(original.http);
try {
  const {ledger}=await createSyntheticFinancialYear();
  await phase('prepare-v5-source',async()=>{await opened.start();const store=new CanonicalLedgerStore({lifecycle:opened});await store.load();await store.save(ledger);});
  const backup=destination('invented-year-backup');
  await phase('backup-full-year',()=>withDestination(backup,target=>backupPagedCanonicalCopy({...source(opened),...target})));
  const chunks=[];
  await phase('export-full-year',()=>exportPagedCanonicalArchive({...source(opened),sink:{write:async raw=>chunks.push(raw)}}));
  console.log(JSON.stringify({archiveBytes:chunks.reduce((n,b)=>n+b.length,0)}));
  await opened.release();original.http.stopped=true;
  const restored=destination('invented-year-restored');
  await phase('restore-full-year-source-offline',()=>withDestination(restored,target=>restorePagedCanonicalArchive({source:chunks,...target})));
} finally {
  if(opened?.started)await opened.release().catch(error=>{console.error('Source release:',error.code);process.exitCode=1;});
  console.log(JSON.stringify({finalMemorySnapshot:process.memoryUsage(),wholeProcessCumulativeMaxRssKiB:process.resourceUsage().maxRSS,
    finalSourceFingerprint:sourceFingerprint(),sourceFilesUnchangedDuringRun:initialFingerprint===sourceFingerprint()}));
}
