// Fresh-copy full-snapshot protocol, used by the explicit experimental application route.
import {persistenceDataClass} from './persistence-data-class.mjs';
import {fail,AppError} from './app-error.mjs';
import {GoogleDriveTransactionAdapter,getNativeDriveReadCheck} from './drive-transaction-engine.mjs';
import {createDriveSessionAdapter} from './drive-session-adapter.mjs';
import {SessionCoordinator,createNativeOwnershipGuard,getNativeOwnershipCapability} from './session-coordination.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {validateLedger,validateProspectiveProductionLedger} from './canonical-import.mjs';
import {assertCanonicalLedgerTransition} from './canonical-history.mjs';
import {utf8ByteLength} from './utf8-length.mjs';

export const FULL_SNAPSHOT_LIMITS=Object.freeze({snapshotBytes:8*1024*1024,envelopeBytes:16384,manifestBytes:16384,maxHistory:10000});
export const FULL_SNAPSHOT_MANIFEST_NAME='finance-tracker-full-snapshot-manifest.json';
const MANIFEST='finance-tracker-full-snapshot-manifest',ENVELOPE='finance-tracker-full-snapshot-commit',PROFILE='canonical-ledger-full-v1';
const SYNTHETIC_PROFILE=Object.freeze({
 class:'synthetic',marker:'syntheticOnly',markerValue:true,version:1,commitProfile:PROFILE,validateLedger
});
const PROVIDER_SIMULATION_PROFILE=Object.freeze({
 class:'reserved-production',marker:'dataClass',markerValue:'production',version:2,
 commitProfile:'canonical-ledger-production-v3',validateLedger:validateProspectiveProductionLedger
});
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const clone=x=>structuredClone(x),same=(a,b)=>canonicalizeJcs(a)===canonicalizeJcs(b);
const metadataFields=['id','name','mimeType','parents','appProperties','size','version','trashed'];
const sameExceptVersion=(a,b)=>{const {version:av,...aa}=a,{version:bv,...bb}=b;return same(aa,bb);};
const changedFields=(a,b)=>metadataFields.filter(k=>!same(a[k]??null,b[k]??null));
const metadataChanged=(a,b,reason='metadata-changed')=>{const error=new AppError('verification-metadata-changed');error.details={reason,fields:changedFields(a,b)};throw error;};
const fields=(x,names)=>{if(!x||Object.getPrototypeOf(x)!==Object.prototype||Object.keys(x).length!==names.length||names.some(k=>!Object.hasOwn(x,k)))fail('invalid-shape');};
const id=x=>{if(typeof x!=='string'||!x.length||x.length>256)fail('invalid-identity');return x;};
const hash=x=>{if(typeof x!=='string'||!(/^[a-f0-9]{64}$/).test(x))fail('invalid-hash');return x;};
const revision=x=>{if(typeof x!=='string'||!(/^(0|[1-9][0-9]*)$/).test(x)||x.length>16)fail('invalid-count');return BigInt(x);};
const bytes=(value,max)=>{const text=canonicalizeJcs(value);if(utf8ByteLength(text)>max)fail('byte-limit');return enc.encode(text);};
const reference=(r,max)=>{fields(r,['fileId','sha256','byteLength']);id(r.fileId);hash(r.sha256);if(!Number.isSafeInteger(r.byteLength)||r.byteLength<1||r.byteLength>max)fail('byte-limit');return r;};
const clean=(profile,databaseId,copyId,rev,head)=>({format:MANIFEST,version:profile.version,[profile.marker]:profile.markerValue,databaseId,copyId,revision:rev,head,pending:null});
function manifest(m,allowPending=true,profile=SYNTHETIC_PROFILE){
 fields(m,['format','version',profile.marker,'databaseId','copyId','revision','head','pending']);
 if(persistenceDataClass('manifest',m)!==profile.class)fail('unsupported-canonical-layout');
 id(m.databaseId);id(m.copyId);const n=revision(m.revision);
 if((n===0n)!==(m.head===null))fail('history-mismatch');if(m.head)reference(m.head,FULL_SNAPSHOT_LIMITS.envelopeBytes);
 if(m.pending!==null){if(!allowPending)fail('recovery-required');fields(m.pending,['state','base']);if(m.pending.state!=='published')fail('invalid-shape');manifest(m.pending.base,false,profile);const b=m.pending.base;if(b.databaseId!==m.databaseId||b.copyId!==m.copyId||revision(b.revision)+1n!==n)fail('history-mismatch');}
 return m;
}
// A bounded read-only admission receipt. It is checked again under ownership
// and is never used as a save baseline or claim of provider atomicity.
const hasExactParent=(value,folderId)=>Array.isArray(value.parents)&&value.parents.length===1&&value.parents[0]===folderId;
export async function inspectSyntheticManifest(adapter,fileId){
 const folderId=id(adapter.folderId);
 const checkMetadata=m=>{
  if(m?.id!==fileId||m.name!==FULL_SNAPSHOT_MANIFEST_NAME||m.trashed!==false||
    m.appProperties?.financeTrackerKind!==MANIFEST||!hasExactParent(m,folderId)||
    typeof m.version!=='string'||!/^[1-9][0-9]*$/.test(m.version)||
    typeof m.size!=='string'||!(/^[1-9][0-9]*$/).test(m.size))fail('manifest-metadata-mismatch');
 };
 const readMetadata=async()=>{const m=await adapter.readMetadata(fileId);checkMetadata(m);return m;};
 const readBody=()=>adapter.readBytes(fileId,{kind:'manifest',maxBytes:FULL_SNAPSHOT_LIMITS.manifestBytes});
 let before=await readMetadata();
 if(BigInt(before.size)>BigInt(FULL_SNAPSHOT_LIMITS.manifestBytes))fail('byte-limit');
 const raw=await readBody();
 if(before.size!==String(raw.length))fail('manifest-version-mismatch');
 let after=await readMetadata();
 // Match the owned reader's bounded settling rule without accepting changed
 // content. Drive may increment a version without changing the body.
 for(let attempt=0;!same(before,after);attempt++){
  if(attempt>=3||!sameExceptVersion(before,after)||BigInt(after.version)<=BigInt(before.version))
   fail('manifest-version-mismatch');
  before=after;
  const next=await readBody();
  if(next.length!==raw.length||next.some((value,index)=>value!==raw[index]))fail('manifest-version-mismatch');
  after=await readMetadata();
 }
 let value;
 try{value=JSON.parse(dec.decode(raw));}catch(cause){fail('invalid-json',{cause});}
 return Object.freeze({folderId,fileId,canonical:canonicalizeJcs(manifest(value))});
}
function envelope(e,m,ref,profile){
 fields(e,['format','version','databaseId','copyId','revision','transactionId','parent','previousManifestHash','snapshot','profile',...(profile===PROVIDER_SIMULATION_PROFILE?['dataClass']:[])]);
 if(e.format!==ENVELOPE||e.version!==profile.version||e.profile!==profile.commitProfile||
  (profile===PROVIDER_SIMULATION_PROFILE&&e.dataClass!==profile.markerValue))fail('unsupported-canonical-profile');
 if(e.databaseId!==m.databaseId||e.copyId!==m.copyId||e.revision!==m.revision||revision(e.revision)===0n)fail('history-mismatch');
 id(e.transactionId);hash(e.previousManifestHash);reference(e.snapshot,FULL_SNAPSHOT_LIMITS.snapshotBytes);
 if((revision(e.revision)===1n)!==(e.parent===null))fail('history-mismatch');if(e.parent)reference(e.parent,FULL_SNAPSHOT_LIMITS.envelopeBytes);
 if(e.snapshot.fileId===ref.fileId)fail('invalid-plan');return e;
}

export function createFullSnapshotStorage({folderId,accessToken,fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,
 setIntervalImpl=globalThis.setInterval,clearIntervalImpl=globalThis.clearInterval,visibilityDelayMs=500}={}) {
 return new FullSnapshotStorage({folderId,accessToken,fetchImpl,cryptoImpl,setIntervalImpl,clearIntervalImpl,visibilityDelayMs},SYNTHETIC_PROFILE);
}

// Not an app configuration switch. It has no production credential parameter,
// no default transport, and only runs under Node's test runner.
export async function createProspectiveStorageForSimulation({folderId,fetchImpl,cryptoImpl}={}){
 const {default:testingProcess}=await import('node:process');
 if(!testingProcess.env.NODE_TEST_CONTEXT||typeof fetchImpl!=='function'||fetchImpl===globalThis.fetch||!cryptoImpl)
  fail('invalid-engine-config');
 return new FullSnapshotStorage({folderId,accessToken:()=> 'invented-test-token',fetchImpl,cryptoImpl,
  visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}},PROVIDER_SIMULATION_PROFILE);
}
class FullSnapshotStorage {
#profile;
 #epoch=Object.freeze({});#context=null;#baseline=null;#busy=false;#recoveryRequired=false;#stopHeartbeat=null;#manifestId=null;#saveAttempt=null;#saveSequence=0;
 constructor({folderId,accessToken,fetchImpl,cryptoImpl,setIntervalImpl,clearIntervalImpl,visibilityDelayMs},profile){
  this.#profile=profile;
  Object.defineProperty(this,'folderId',{value:id(folderId),enumerable:true});this.crypto=cryptoImpl;this.setIntervalImpl=setIntervalImpl;this.clearIntervalImpl=clearIntervalImpl;
  this.coordinator=new SessionCoordinator({adapter:createDriveSessionAdapter({folderId,accessToken,fetchImpl,cryptoImpl})});
  this.adapter=new GoogleDriveTransactionAdapter({folderId,accessToken,fetchImpl,cryptoImpl,visibilityDelayMs,visibilityMaxDelayMs:visibilityDelayMs,
   responseLimits:{'snapshot-object':FULL_SNAPSHOT_LIMITS.snapshotBytes,'commit-record':FULL_SNAPSHOT_LIMITS.envelopeBytes,'stored-object':FULL_SNAPSHOT_LIMITS.manifestBytes,manifest:FULL_SNAPSHOT_LIMITS.manifestBytes},
   captureMutationGuard:()=>this.#capture(),onExpiredMutation:()=>this.invalidate()});
 }
 get saveAttempt(){return this.#saveAttempt?clone(this.#saveAttempt):null;}
 get manifestFileId(){return this.#manifestId;}
 get recoveryRequired(){return this.#recoveryRequired;}
 #assertBaseline(){const record=this.#baseline,epoch=this.#epoch,adapter=this.adapter,coordinator=this.coordinator,transport=getNativeDriveReadCheck(adapter);
  const check=()=>{if(!record||!transport||this.#baseline!==record||this.#epoch!==epoch||this.adapter!==adapter||this.coordinator!==coordinator||Object.getOwnPropertyDescriptor(adapter,'folderId')?.value!==this.folderId)fail('verified-base-required');transport();};
  check();record.owner();check();return record;
 }
 get verifiedManifest(){return this.#baseline?clone(this.#assertBaseline().manifest):null;}
 assertVerifiedBaseline(expected){const record=this.#assertBaseline();if(!same(record.manifest,expected)||this.#assertBaseline()!==record)fail('verified-base-required');}
 invalidate(){this.#epoch=Object.freeze({});this.#baseline=null;}
 #capture(){const context=this.#context;return ()=>{if(!context||this.#context!==context||this.#epoch!==context.epoch||this.adapter!==context.adapter||this.coordinator!==context.coordinator||Object.getOwnPropertyDescriptor(this.adapter,'folderId')?.value!==this.folderId)fail('verification-scope-closed');context.transport();context.owner();context.transport();if(this.#context!==context||this.#epoch!==context.epoch||this.adapter!==context.adapter||this.coordinator!==context.coordinator)fail('verification-scope-closed');};}
 async #digest(raw){return Array.from(new Uint8Array(await this.crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');}
 async #owned(){const check=this.#capture();check();await this.coordinator.assertCanWrite({online:true});check();}
 async #run(operation){
  this.adapter.assertMutationsSettled();if(this.#busy)fail('operation-in-progress');this.#busy=true;
  try{return await this.coordinator.withWrite(async()=>{
   const guard=createNativeOwnershipGuard(this.coordinator);if(!guard)fail('verification-scope-closed');
   const owner=getNativeOwnershipCapability(guard).capture(),transport=getNativeDriveReadCheck(this.adapter);if(!transport)fail('verification-scope-closed');const context={owner,transport,adapter:this.adapter,coordinator:this.coordinator,epoch:this.#epoch,used:new Map(),revalidationBytes:0,revalidationReads:0,manifestRevalidationReads:0};this.#context=context;
   try{const result=await operation();this.#capture()();return result;}
   finally{if(this.#context===context)this.#context=null;}
  });}catch(error){this.#recoveryRequired=true;this.invalidate();throw error;}finally{this.#busy=false;}
 }
 #metadata(m,fileId,kind,sha,transactionId){
  if(m?.id!==fileId||m.trashed!==false||!m.parents?.includes(this.folderId)||
    (this.#profile===PROVIDER_SIMULATION_PROFILE&&!hasExactParent(m,this.folderId))||typeof m.version!=='string'||!(/^[1-9][0-9]*$/).test(m.version)||!(/^(0|[1-9][0-9]*)$/).test(m.size))fail('metadata-mismatch');
  if(kind&&m.appProperties?.financeTrackerKind!==kind)fail('metadata-mismatch');
  if(sha&&(m.appProperties?.financeTrackerHash!==sha||m.name!=='ft-full-'+sha+'.bin'||m.mimeType!=='application/octet-stream'))fail('metadata-mismatch');
  if(transactionId&&m.appProperties?.financeTrackerTransaction!==transactionId)fail('metadata-mismatch');return m;
 }
 // Drive version includes invisible server-side changes. Never ignore drift:
 // re-read the exact immutable object under stable metadata, within a per-run
 // byte/attempt budget. All non-version bindings remain exact; authority does
 // not use this exception.
 async #settleImmutable(expected,current,ref,kind,transactionId){
  const check=this.#capture(),max=kind==='snapshot-object'?FULL_SNAPSHOT_LIMITS.snapshotBytes:FULL_SNAPSHOT_LIMITS.envelopeBytes;
  for(let attempt=0;attempt<3;attempt++){
   check();this.#metadata(current,ref.fileId,kind,ref.sha256,transactionId);
   if(same(expected,current))return current;
   if(!sameExceptVersion(expected,current)||BigInt(current.version)<=BigInt(expected.version))metadataChanged(expected,current);
   if(this.#context.revalidationReads>=8||this.#context.revalidationBytes+ref.byteLength>3*FULL_SNAPSHOT_LIMITS.snapshotBytes)metadataChanged(expected,current,'revalidation-limit');
   this.#context.revalidationBytes+=ref.byteLength;this.#context.revalidationReads++;
   const raw=await this.adapter.readBytes(ref.fileId,{kind,maxBytes:max});check();
   if(raw.length!==ref.byteLength||String(raw.length)!==current.size||await this.#digest(raw)!==ref.sha256)fail('hash-mismatch');check();
   const after=this.#metadata(await this.adapter.readMetadata(ref.fileId),ref.fileId,kind,ref.sha256,transactionId);check();
   if(same(current,after))return after;
   if(!sameExceptVersion(current,after)||BigInt(after.version)<=BigInt(current.version))metadataChanged(current,after);
   expected=current;current=after;
  }
  metadataChanged(expected,current,'metadata-unstable');
 }
 #remember(ref,kind,transactionId,metadata){this.#context.used.set(ref.fileId,{ref:clone(ref),kind,transactionId,metadata:clone(metadata)});}
 async #read(ref,kind,transactionId){
  const max=kind==='snapshot-object'?FULL_SNAPSHOT_LIMITS.snapshotBytes:FULL_SNAPSHOT_LIMITS.envelopeBytes;reference(ref,max);
  const check=this.#capture();check();const before=this.#metadata(await this.adapter.readMetadata(ref.fileId),ref.fileId,kind,ref.sha256,transactionId);check();
  const raw=await this.adapter.readBytes(ref.fileId,{kind,maxBytes:max});check();
  if(raw.length!==ref.byteLength||String(raw.length)!==before.size||await this.#digest(raw)!==ref.sha256)fail('hash-mismatch');check();
  const observed=this.#metadata(await this.adapter.readMetadata(ref.fileId),ref.fileId,kind,ref.sha256,transactionId);check();
  const after=await this.#settleImmutable(before,observed,ref,kind,transactionId);check();
  this.#remember(ref,kind,transactionId,after);return {value:JSON.parse(dec.decode(raw)),metadata:after};
 }
 async #selected(){
  const check=this.#capture();check();
  const readMetadata=async()=>{
   const m=this.#metadata(await this.adapter.readMetadata(this.#manifestId),this.#manifestId,MANIFEST);check();
   if(!hasExactParent(m,this.folderId))fail('manifest-metadata-mismatch');
   return m;
  };
  let before=await readMetadata();
  if(before.name!==FULL_SNAPSHOT_MANIFEST_NAME)fail('manifest-metadata-mismatch');
  const raw=await this.adapter.readBytes(this.#manifestId,{kind:'manifest',maxBytes:FULL_SNAPSHOT_LIMITS.manifestBytes});check();
  const mismatch=(reason,after)=>{const error=new AppError('manifest-version-mismatch');error.details={reason,fields:changedFields(before,after)};throw error;};
  if(before.size!==String(raw.length))mismatch('content-size-mismatch',before);
  let after=await readMetadata();
  // The first actual body is the authority anchor. A server-only version change
  // may settle, but a different body never becomes this read's authority.
  for(let attempt=0;!same(before,after);attempt++){
   if(!sameExceptVersion(before,after)||BigInt(after.version)<=BigInt(before.version))mismatch('metadata-changed',after);
   if(attempt>=3)mismatch('metadata-unstable',after);
   if(this.#context.manifestRevalidationReads>=8)mismatch('revalidation-limit',after);
   this.#context.manifestRevalidationReads++;
   before=after;
   const reread=await this.adapter.readBytes(this.#manifestId,{kind:'manifest',maxBytes:FULL_SNAPSHOT_LIMITS.manifestBytes});check();
   if(reread.length!==raw.length||reread.some((value,index)=>value!==raw[index]))mismatch('content-changed',before);
   after=await readMetadata();
  }
  return manifest(JSON.parse(dec.decode(raw)),true,this.#profile);
 }
 async #exact(expected){await this.#owned();if(!same(await this.#selected(),expected))fail('base-conflict');this.#capture()();}
 async #close(expected){
  const check=this.#capture(),witnesses=[...this.#context.used];
  // Only independent metadata GETs overlap. Drain each pair even on failure so
  // no read survives this operation; content settling and its budgets stay serial.
  for(let offset=0;offset<witnesses.length;offset+=2){
   check();const pair=witnesses.slice(offset,offset+2);
   const results=await Promise.allSettled(pair.map(([fileId])=>this.adapter.readMetadata(fileId)));check();
   const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
   for(let index=0;index<pair.length;index++){
    check();const witness=pair[index][1],fresh=results[index].value;
    const settled=await this.#settleImmutable(witness.metadata,fresh,witness.ref,witness.kind,witness.transactionId);check();witness.metadata=clone(settled);
   }
  }
  await this.#exact(expected);check();
 }
 async #current(m){
  if(m.head===null)return {ledger:null,envelope:null};
  const read=await this.#read(m.head,'commit-record'),e=envelope(read.value,m,m.head,this.#profile);
  if(read.metadata.appProperties?.financeTrackerTransaction!==e.transactionId)fail('metadata-mismatch');
  const {value:ledger}=await this.#read(e.snapshot,'snapshot-object',e.transactionId);this.#profile.validateLedger(ledger);
  const prior=clean(this.#profile,m.databaseId,m.copyId,String(revision(m.revision)-1n),e.parent);
  if(await this.#digest(bytes(prior,FULL_SNAPSHOT_LIMITS.manifestBytes))!==e.previousManifestHash)fail('history-mismatch');
  if(m.pending&&!same(m.pending.base,prior))fail('history-mismatch');this.#capture()();return {ledger,envelope:e};
 }
 async #audit(m){
  let cursor=m,current=await this.#current(cursor),selected=current.ledger,seen=new Set(),count=0;
  while(cursor.head!==null){
   if(++count>FULL_SNAPSHOT_LIMITS.maxHistory||seen.has(cursor.head.fileId))fail('history-mismatch');seen.add(cursor.head.fileId);
   const prior=clean(this.#profile,m.databaseId,m.copyId,String(revision(cursor.revision)-1n),current.envelope.parent);
   const previous=await this.#current(prior);assertCanonicalLedgerTransition(previous.ledger,current.ledger);this.#capture()();cursor=prior;current=previous;
  }
  return selected;
 }
 async #create(raw,kind,transactionId,expected){
  const check=this.#capture(),fileId=await this.adapter.allocateFileId();check();const sha256=await this.#digest(raw);check();
  const ref={fileId,sha256,byteLength:raw.length};
  let receipt,dispatched=false;try{receipt=await this.adapter.createImmutable({fileId,name:'ft-full-'+sha256+'.bin',kind,transactionId,content:raw,expectedSha256:sha256,maxBytes:kind==='snapshot-object'?FULL_SNAPSHOT_LIMITS.snapshotBytes:FULL_SNAPSHOT_LIMITS.envelopeBytes,beforeMutation:async()=>{check();dispatched=true;}});check();}
  catch(error){if(dispatched){this.#recoveryRequired=true;fail('write-unresolved',{cause:error});}throw error;}
  // Native receipt contains detached bytes from the actual exact-ID GET, not
  // upload bytes or the POST response. Bind it independently, then bracket the
  // receipt with a fresh metadata observation before enrolling its witness.
  const actual=receipt?.readback?.bytes;
  if(receipt?.fileId!==fileId||receipt.sha256!==sha256||receipt.size!==raw.length||!(actual instanceof Uint8Array)||actual.length!==raw.length)fail('immutable-readback-mismatch');
  const before=this.#metadata(receipt.readback.metadata,fileId,kind,sha256,transactionId);
  if(before.size!==String(actual.length)||await this.#digest(actual)!==sha256)fail('hash-mismatch');check();
  const after=this.#metadata(await this.adapter.readMetadata(fileId),fileId,kind,sha256,transactionId);check();
  const settled=await this.#settleImmutable(before,after,ref,kind,transactionId);check();this.#remember(ref,kind,transactionId,settled);return ref;
 }
 async #publish(next,expected,{saveAttempt=false}={}){
  await this.#close(expected);this.#capture()();
  let dispatched=false;try{await this.adapter.publishManifest(this.#manifestId,next,{beforeMutation:async()=>{await this.#exact(expected);dispatched=true;if(saveAttempt&&this.#saveAttempt)this.#saveAttempt.authorityDispatched=true;this.#recoveryRequired=true;}});this.#capture()();
   if(!same(await this.#selected(),next))fail('manifest-readback-mismatch');
  }catch(error){if(dispatched)fail('write-unresolved',{cause:error});throw error;}
 }
 async #verifyRecoveryManifest(m){
  const ledger=await this.#audit(m);
  const manifest=m.pending?{...m,pending:null}:m;
  if(m.pending)await this.#publish(manifest,m);
  await this.#close(manifest);
  return {manifest,ledger};
 }
 async start({initialize=false,recoverStale=false,admission}={}){
  if(initialize&&(recoverStale||admission))fail('invalid-initialization');
  const priorSessionId=this.coordinator.session?.sessionId,hadUnresolved=this.#recoveryRequired;
  if(recoverStale)await this.coordinator.recoverStale({confirm:true});else await this.coordinator.start();
  const claimedSessionId=this.coordinator.session?.sessionId;
  this.#stopHeartbeat?.();this.#stopHeartbeat=this.coordinator.startHeartbeat({setIntervalImpl:this.setIntervalImpl,clearIntervalImpl:this.clearIntervalImpl,isOnline:()=>true,onError:()=>this.invalidate()});
  let checkingAdmission=false;
  try{return await this.#run(async()=>{
   checkingAdmission=Boolean(admission);
   await this.#owned();const files=await this.adapter.listChildren();this.#capture()();
   const candidates=files.filter(f=>f.name===FULL_SNAPSHOT_MANIFEST_NAME||f.appProperties?.financeTrackerKind===MANIFEST);
   if(candidates.length>1)fail('ambiguous-manifest');
   if(candidates.length){this.#manifestId=candidates[0].id;if(initialize)fail('new-empty-folder-required');}
   else {
    if(!initialize||files.some(f=>f.appProperties?.financeTrackerSession!=='v1'))fail('new-empty-folder-required');
    this.#manifestId=await this.adapter.allocateFileId();this.#capture()();const m=clean(this.#profile,this.crypto.randomUUID(),this.crypto.randomUUID(),'0',null),raw=bytes(m,FULL_SNAPSHOT_LIMITS.manifestBytes);
    let dispatched=false;try{await this.adapter.createImmutable({fileId:this.#manifestId,name:FULL_SNAPSHOT_MANIFEST_NAME,kind:MANIFEST,transactionId:this.crypto.randomUUID(),content:raw,expectedSha256:await this.#digest(raw),maxBytes:FULL_SNAPSHOT_LIMITS.manifestBytes,beforeMutation:async()=>{await this.#owned();const latest=await this.adapter.listChildren();this.#capture()();if(latest.some(f=>f.appProperties?.financeTrackerSession!=='v1'))fail('new-empty-folder-required');dispatched=true;}});}
    catch(error){if(dispatched){this.#recoveryRequired=true;fail('write-unresolved',{cause:error});}throw error;}
   }
   const m=await this.#selected();
   this.#assertAdmission(admission,m);
   checkingAdmission=false;
   if(m.pending&&!recoverStale)fail('recovery-required');
   const {manifest,ledger}=await this.#verifyRecoveryManifest(m);
   this.#baseline={manifest:clone(manifest),owner:this.#context.owner};this.#recoveryRequired=false;return clone(ledger);
  });}catch(error){
   this.invalidate();
   if(checkingAdmission&&!hadUnresolved){
    // No publication was attempted by this invocation. Preserve any prior
    // unresolved evidence, and never release a reused or unverified marker.
    this.#recoveryRequired=false;
    if(claimedSessionId&&claimedSessionId!==priorSessionId&&this.coordinator.canWrite&&
      this.coordinator.session?.sessionId===claimedSessionId){
     try{await this.release();}
     catch{
      // Do not keep renewing a newly claimed but unusable session if release
      // cannot be verified. The original admission failure remains visible.
      this.#stopHeartbeat?.();this.#stopHeartbeat=null;
     }
    }
   }
   throw error;
  }
 }
 async open(){return this.#run(async()=>{const m=await this.#selected();if(m.pending)fail('recovery-required');const ledger=await this.#audit(m);await this.#close(m);this.#baseline={manifest:clone(m),owner:this.#context.owner};this.#recoveryRequired=false;return clone(ledger);});}
 async save(input){
  // Size admission precedes detached byte-buffer allocation and all writes. The
  // serializer may allocate a string; this is not a constant-memory promise.
  this.#profile.validateLedger(input);const raw=bytes(input,FULL_SNAPSHOT_LIMITS.snapshotBytes),candidate=JSON.parse(dec.decode(raw));
  return this.#run(async()=>{
   this.#saveAttempt=null;
   const baseline=this.#baseline;if(!baseline)fail('verified-base-required');baseline.owner();const base=await this.#selected();if(!same(base,baseline.manifest)||base.pending)fail('base-conflict');
   this.#saveAttempt={sequence:++this.#saveSequence,base:clone(base),candidate:null,authorityDispatched:false};
   if(revision(base.revision)>=BigInt(FULL_SNAPSHOT_LIMITS.maxHistory))fail('byte-limit');
   const current=await this.#current(base);assertCanonicalLedgerTransition(current.ledger,candidate);await this.#close(base);
   if(same(current.ledger,candidate))return clone(current.ledger);
   const transactionId=this.crypto.randomUUID(),snapshot=await this.#create(raw,'snapshot-object',transactionId,base);
   const value={format:ENVELOPE,version:this.#profile.version,databaseId:base.databaseId,copyId:base.copyId,revision:String(revision(base.revision)+1n),transactionId,parent:base.head,previousManifestHash:await this.#digest(bytes(base,FULL_SNAPSHOT_LIMITS.manifestBytes)),snapshot,profile:this.#profile.commitProfile,
    ...(this.#profile===PROVIDER_SIMULATION_PROFILE?{dataClass:this.#profile.markerValue}:{})};
   const head=await this.#create(bytes(value,FULL_SNAPSHOT_LIMITS.envelopeBytes),'commit-record',transactionId,base);
   const next=clean(this.#profile,base.databaseId,base.copyId,value.revision,head),published={...next,pending:{state:'published',base:clone(base)}};
   manifest(published,true,this.#profile);envelope(value,published,head,this.#profile);this.#capture()();this.#saveAttempt.candidate=clone(next);
   // Candidate and transition were validated above; both immutable canonical
   // encodings have independently bound actual GET receipts. Publication still
   // closes all witnesses, then the actual base/new bodies are read below.
   await this.#publish(published,base,{saveAttempt:true});
   // Re-read actual base and new bytes after publication, not a cached upload.
   const old=await this.#current(base),after=await this.#current(published);assertCanonicalLedgerTransition(old.ledger,after.ledger);if(!same(after.ledger,candidate))fail('canonical-preparation-mismatch');
   await this.#publish(next,published,{saveAttempt:true});await this.#close(next);this.#baseline={manifest:clone(next),owner:this.#context.owner};this.#recoveryRequired=false;return clone(after.ledger);
  });
 }
 #assertAdmission(admission,m){
  if(admission&&(admission.folderId!==this.folderId||admission.fileId!==this.#manifestId||
    admission.canonical!==canonicalizeJcs(m)))fail('base-conflict');
 }
 async recover({admission}={}){
  this.#baseline=null;return this.#run(async()=>{const m=await this.#selected();this.#assertAdmission(admission,m);
   const {ledger}=await this.#verifyRecoveryManifest(m);
   // Recovery never seeds a save baseline. An explicit full open is required.
   this.#recoveryRequired=false;return clone(ledger);
  });
 }
 async release(){
  const requireResolved=()=>{if(this.#recoveryRequired)fail('recovery-required');this.adapter.assertMutationsSettled();};
  requireResolved();
  // Keep ownership and renewal alive while admitted writes drain. Their outcome
  // must still be resolved before the coordinator relinquishes the session.
  const result=await this.coordinator.release({beforeRelease:requireResolved});
  this.invalidate();this.#stopHeartbeat?.();this.#stopHeartbeat=null;return result;
 }
}
