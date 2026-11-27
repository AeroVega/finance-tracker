// Fresh-copy full-snapshot protocol, used by the explicit experimental application route.
import {persistenceDataClass} from './persistence-data-class.mjs';
import {releasedDataClass} from './release-profile.mjs';
import {fail,AppError} from './app-error.mjs';
import {GoogleDriveTransactionAdapter,getNativeDriveReadCheck} from './drive-transaction-engine.mjs';
import {createDriveSessionAdapter} from './drive-session-adapter.mjs';
import {SessionCoordinator,createNativeOwnershipGuard,getNativeOwnershipCapability} from './session-coordination.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {validateLedger,validateProductionLedger} from './canonical-import.mjs';
import {assertCanonicalLedgerTransition} from './canonical-history.mjs';
import {utf8ByteLength} from './utf8-length.mjs';

export const FULL_SNAPSHOT_LIMITS=Object.freeze({snapshotBytes:8*1024*1024,envelopeBytes:16384,manifestBytes:16384,maxHistory:10000});
export const FULL_SNAPSHOT_MANIFEST_NAME='finance-tracker-full-snapshot-manifest.json';
const MANIFEST='finance-tracker-full-snapshot-manifest',ENVELOPE='finance-tracker-full-snapshot-commit',PROFILE='canonical-ledger-full-v1';
const SYNTHETIC_PROFILE=Object.freeze({
 class:'synthetic',marker:'syntheticOnly',markerValue:true,version:1,commitProfile:PROFILE,validateLedger
});
// Same immutable references, ownership, pending publication and readback as
// synthetic. Only the class-bound headers and ledger validator differ.
const PRODUCTION_PROFILE=Object.freeze({
 class:'production',marker:'dataClass',markerValue:'production',version:2,
 commitProfile:'canonical-ledger-production-v3',validateLedger:validateProductionLedger
});
const PROFILES=Object.freeze({synthetic:SYNTHETIC_PROFILE,production:PRODUCTION_PROFILE});
// Read concurrency bounds. Closing checks read witness metadata in groups of
// WITNESS_READS. A history audit holds at most SNAPSHOT_READS snapshots, read
// or in flight, which bounds its memory to a few snapshots.
const WITNESS_READS=8,SNAPSHOT_READS=2;
// Settle every started request before judging any result, so no read outlives
// the operation that issued it. The first rejection in argument order wins.
const settled=async promises=>{const results=await Promise.allSettled(promises),failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return results.map(r=>r.value);};
const profileFor=dataClass=>Object.hasOwn(PROFILES,dataClass)?PROFILES[dataClass]:fail('invalid-engine-config');
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
 // A recognized header of the other class is refused as such, before shape.
 const declared=persistenceDataClass('manifest',m);if(declared&&declared!==profile.class)fail('data-class-mismatch');
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
export async function inspectManifest(adapter,fileId,{dataClass='synthetic'}={}){
 const profile=profileFor(dataClass),folderId=id(adapter.folderId);
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
 return Object.freeze({folderId,fileId,dataClass,canonical:canonicalizeJcs(manifest(value,true,profile))});
}
function envelope(e,m,ref,profile){
 fields(e,['format','version','databaseId','copyId','revision','transactionId','parent','previousManifestHash','snapshot','profile',...(profile===PRODUCTION_PROFILE?['dataClass']:[])]);
 if(e.format!==ENVELOPE||e.version!==profile.version||e.profile!==profile.commitProfile||
  (profile===PRODUCTION_PROFILE&&e.dataClass!==profile.markerValue))fail('unsupported-canonical-profile');
 if(e.databaseId!==m.databaseId||e.copyId!==m.copyId||e.revision!==m.revision||revision(e.revision)===0n)fail('history-mismatch');
 id(e.transactionId);hash(e.previousManifestHash);reference(e.snapshot,FULL_SNAPSHOT_LIMITS.snapshotBytes);
 if((revision(e.revision)===1n)!==(e.parent===null))fail('history-mismatch');if(e.parent)reference(e.parent,FULL_SNAPSHOT_LIMITS.envelopeBytes);
 if(e.snapshot.fileId===ref.fileId)fail('invalid-plan');return e;
}

// The data class is fixed per engine. Every constructor applies the release
// gate, so a synthetic-only build cannot build a production engine here either.
export function createFullSnapshotStorage({folderId,accessToken,fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,
 setIntervalImpl=globalThis.setInterval,clearIntervalImpl=globalThis.clearInterval,visibilityDelayMs=500,dataClass='synthetic',release}={}) {
 return new FullSnapshotStorage({folderId,accessToken,fetchImpl,cryptoImpl,setIntervalImpl,clearIntervalImpl,visibilityDelayMs},profileFor(releasedDataClass(dataClass,release)));
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
   captureMutationGuard:()=>this.#capture({write:true}),onExpiredMutation:()=>this.invalidate()});
 }
 get dataClass(){return this.#profile.class;}
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
 // A read context opened before the session claim has no owner until #run
 // adopts it. It permits reads only; a mutation guard refuses it.
 #capture({write=false}={}){const context=this.#context;return ()=>{if(!context||this.#context!==context||this.#epoch!==context.epoch||this.adapter!==context.adapter||this.coordinator!==context.coordinator||Object.getOwnPropertyDescriptor(this.adapter,'folderId')?.value!==this.folderId)fail('verification-scope-closed');context.transport();if(context.owner)context.owner();else if(write)fail('verification-scope-closed');context.transport();if(this.#context!==context||this.#epoch!==context.epoch||this.adapter!==context.adapter||this.coordinator!==context.coordinator)fail('verification-scope-closed');};}
 async #digest(raw){return Array.from(new Uint8Array(await this.crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');}
 async #owned(){const check=this.#capture();check();await this.coordinator.assertCanWrite({online:true});check();}
 #readContext(transport,controller){return {owner:null,controller,transport,adapter:this.adapter,coordinator:this.coordinator,epoch:this.#epoch,used:new Map(),revalidationBytes:0,revalidationReads:0,manifestRevalidationReads:0};}
 // An early read context, still current, is adopted with its witnesses and budgets.
 async #run(operation,early=null){
  this.adapter.assertMutationsSettled();if(this.#busy)fail('operation-in-progress');this.#busy=true;
  try{return await this.coordinator.withWrite(async()=>{
   const guard=createNativeOwnershipGuard(this.coordinator);if(!guard)fail('verification-scope-closed');
   const owner=getNativeOwnershipCapability(guard).capture(),transport=getNativeDriveReadCheck(this.adapter);if(!transport)fail('verification-scope-closed');
   if(early&&(this.#context!==early||early.owner||early.epoch!==this.#epoch||early.adapter!==this.adapter||early.coordinator!==this.coordinator))fail('verification-scope-closed');
   const context=early?Object.assign(early,{owner,transport}):{...this.#readContext(transport),owner};this.#context=context;
   try{const result=await operation();this.#capture()();return result;}
   finally{if(this.#context===context)this.#context=null;}
  });}catch(error){this.#recoveryRequired=true;this.invalidate();throw error;}finally{this.#busy=false;}
 }
 #metadata(m,fileId,kind,sha,transactionId){
  if(m?.id!==fileId||m.trashed!==false||!m.parents?.includes(this.folderId)||
    (this.#profile===PRODUCTION_PROFILE&&!hasExactParent(m,this.folderId))||typeof m.version!=='string'||!(/^[1-9][0-9]*$/).test(m.version)||!(/^(0|[1-9][0-9]*)$/).test(m.size))fail('metadata-mismatch');
  if(kind&&m.appProperties?.financeTrackerKind!==kind)fail('metadata-mismatch');
  if(sha&&(m.appProperties?.financeTrackerHash!==sha||m.name!=='ft-full-'+sha+'.bin'||m.mimeType!=='application/octet-stream'))fail('metadata-mismatch');
  if(transactionId&&m.appProperties?.financeTrackerTransaction!==transactionId)fail('metadata-mismatch');return m;
 }
 // Drive version includes invisible server-side changes. Never ignore drift:
 // re-read the exact immutable object under stable metadata, within a per-run
 // byte/attempt budget. All non-version bindings remain exact; authority does
 // not use this exception.
 async #settleImmutable(expected,current,ref,kind,transactionId){
  const check=this.#capture(),max=kind==='snapshot-object'?FULL_SNAPSHOT_LIMITS.snapshotBytes:FULL_SNAPSHOT_LIMITS.envelopeBytes,signal=this.#context.controller?.signal;
  for(let attempt=0;attempt<3;attempt++){
   check();this.#metadata(current,ref.fileId,kind,ref.sha256,transactionId);
   if(same(expected,current))return current;
   if(!sameExceptVersion(expected,current)||BigInt(current.version)<=BigInt(expected.version))metadataChanged(expected,current);
   if(this.#context.revalidationReads>=8||this.#context.revalidationBytes+ref.byteLength>3*FULL_SNAPSHOT_LIMITS.snapshotBytes)metadataChanged(expected,current,'revalidation-limit');
   this.#context.revalidationBytes+=ref.byteLength;this.#context.revalidationReads++;
   const raw=await this.adapter.readBytes(ref.fileId,{kind,maxBytes:max,signal});check();
   if(raw.length!==ref.byteLength||String(raw.length)!==current.size||await this.#digest(raw)!==ref.sha256)fail('hash-mismatch');check();
   const after=this.#metadata(await this.adapter.readMetadata(ref.fileId,{signal}),ref.fileId,kind,ref.sha256,transactionId);check();
   if(same(current,after))return after;
   if(!sameExceptVersion(current,after)||BigInt(after.version)<=BigInt(current.version))metadataChanged(current,after);
   expected=current;current=after;
  }
  metadataChanged(expected,current,'metadata-unstable');
 }
 #remember(ref,kind,transactionId,metadata){this.#context.used.set(ref.fileId,{ref:clone(ref),kind,transactionId,metadata:clone(metadata)});}
 // Returns a hash-verified immutable body, its opening metadata, and a promise
 // for the closing half of the metadata bracket. The SHA-256 binds the content,
 // so the opening metadata read overlaps the media read. The closing metadata
 // read starts after both settle and enrolls the witness.
 async #fetch(ref,kind,transactionId){
  const max=kind==='snapshot-object'?FULL_SNAPSHOT_LIMITS.snapshotBytes:FULL_SNAPSHOT_LIMITS.envelopeBytes;reference(ref,max);
  const check=this.#capture();check();
  const signal=this.#context.controller?.signal;
  const [opening,raw]=await settled([this.adapter.readMetadata(ref.fileId,{signal}),this.adapter.readBytes(ref.fileId,{kind,maxBytes:max,signal})]);check();
  const before=this.#metadata(opening,ref.fileId,kind,ref.sha256,transactionId);
  if(raw.length!==ref.byteLength||String(raw.length)!==before.size||await this.#digest(raw)!==ref.sha256)fail('hash-mismatch');check();
  const value=JSON.parse(dec.decode(raw)),closing=(async()=>{
   const observed=this.#metadata(await this.adapter.readMetadata(ref.fileId,{signal}),ref.fileId,kind,ref.sha256,transactionId);check();
   const after=await this.#settleImmutable(before,observed,ref,kind,transactionId);check();
   this.#remember(ref,kind,transactionId,after);return after;
  })();
  closing.catch(()=>{});return {value,metadata:before,closing};
 }
 async #read(ref,kind,transactionId){const {value,closing}=await this.#fetch(ref,kind,transactionId);return {value,metadata:await closing};}
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
 // Ownership and the exact manifest are independent reads of the current state.
 async #exact(expected,readback=false){const [,current]=await settled([this.#owned(),this.#selected()]);if(!same(current,expected))fail(readback?'manifest-readback-mismatch':'base-conflict');this.#capture()();}
 async #witnessMetadata(witnesses){
  const check=this.#capture(),fresh=[];
  for(let offset=0;offset<witnesses.length;offset+=WITNESS_READS){
   check();fresh.push(...await settled(witnesses.slice(offset,offset+WITNESS_READS).map(([fileId])=>this.adapter.readMetadata(fileId))));check();
  }
  return fresh;
 }
 // The closing check reads every witness, ownership and the exact manifest
 // together. Content settling and its budgets stay serial. When a witness
 // needed settling reads, the exact check runs again after them.
 async #close(expected,readback=false){
  const check=this.#capture(),witnesses=[...this.#context.used];
  const [fresh]=await settled([this.#witnessMetadata(witnesses),this.#exact(expected,readback)]);check();
  let settling=false;
  for(let index=0;index<witnesses.length;index++){
   check();const witness=witnesses[index][1];settling||=!same(witness.metadata,fresh[index]);
   const current=await this.#settleImmutable(witness.metadata,fresh[index],witness.ref,witness.kind,witness.transactionId);check();witness.metadata=clone(current);
  }
  if(settling)await this.#exact(expected,readback);check();
 }
 // Reads and binds the head envelope of manifest m and the clean manifest before
 // it. With tails, the closing metadata read is left running and pushed there.
 async #envelope(m,tails){
  let read;if(tails){read=await this.#fetch(m.head,'commit-record');tails.push(read.closing);}else read=await this.#read(m.head,'commit-record');
  const e=envelope(read.value,m,m.head,this.#profile);
  if(read.metadata.appProperties?.financeTrackerTransaction!==e.transactionId)fail('metadata-mismatch');
  const prior=clean(this.#profile,m.databaseId,m.copyId,String(revision(m.revision)-1n),e.parent);
  if(await this.#digest(bytes(prior,FULL_SNAPSHOT_LIMITS.manifestBytes))!==e.previousManifestHash)fail('history-mismatch');
  if(m.pending&&!same(m.pending.base,prior))fail('history-mismatch');this.#capture()();return {envelope:e,prior};
 }
 async #snapshot(e){const {value:ledger}=await this.#read(e.snapshot,'snapshot-object',e.transactionId);this.#profile.validateLedger(ledger);this.#capture()();return ledger;}
 // A known envelope names the snapshot, so both reads run together. The head
 // hash binds the envelope, and the envelope read must return exactly it.
 async #current(m,known){
  if(m.head===null)return {ledger:null,envelope:null};
  if(known){const [{envelope:e},ledger]=await settled([this.#envelope(m),this.#snapshot(known)]);if(!same(e,known))fail('history-mismatch');return {ledger,envelope:e};}
  const {envelope:e}=await this.#envelope(m);return {ledger:await this.#snapshot(e),envelope:e};
 }
 // Walks the envelope chain from the head. The walk moves to the parent once a
 // body is hash-verified; each closing metadata read finishes before the audit
 // returns. Each snapshot read starts when its envelope names it. Transitions
 // are checked newest first, as each snapshot arrives in chain order. Returns
 // the selected ledger and its head envelope.
 async #audit(m){
  const reads=[],tails=[],seen=new Set();let cursor=m,count=0,newer,selected=null,head=null;
  const next=async()=>{const ledger=await reads.shift();if(newer===undefined)selected=ledger;else assertCanonicalLedgerTransition(ledger,newer);newer=ledger;this.#capture()();};
  try{
   while(cursor.head!==null){
    if(++count>FULL_SNAPSHOT_LIMITS.maxHistory||seen.has(cursor.head.fileId))fail('history-mismatch');seen.add(cursor.head.fileId);
    const {envelope:e,prior}=await this.#envelope(cursor,tails),read=this.#snapshot(e);read.catch(()=>{});reads.push(read);head??=e;
    while(reads.length>=SNAPSHOT_READS)await next();
    cursor=prior;
   }
   while(reads.length)await next();
   await settled(tails);
  }catch(error){await Promise.allSettled([...reads,...tails]);throw error;}
  if(newer!==undefined)assertCanonicalLedgerTransition(null,newer);
  return {ledger:selected,envelope:head};
 }
 // Allocates the file ID and digest before any upload, so a parent can name it.
 async #plan(raw){const check=this.#capture(),fileId=await this.adapter.allocateFileId();check();const sha256=await this.#digest(raw);check();return {fileId,sha256,byteLength:raw.length};}
 async #create(raw,ref,kind,transactionId){
  const check=this.#capture(),{fileId,sha256}=ref;
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
  const current=await this.#settleImmutable(before,after,ref,kind,transactionId);check();this.#remember(ref,kind,transactionId,current);return ref;
 }
 // The complete closing check runs immediately before dispatch, unless the
 // caller has just run it. With readback, a complete closing check of the new
 // manifest follows; without it, the caller runs that check.
 async #publish(next,expected,{saveAttempt=false,checked=false,readback=true}={}){
  let dispatched=false;try{await this.adapter.publishManifest(this.#manifestId,next,{beforeMutation:async()=>{if(!checked)await this.#close(expected);dispatched=true;if(saveAttempt&&this.#saveAttempt)this.#saveAttempt.authorityDispatched=true;this.#recoveryRequired=true;}});this.#capture()();
   if(readback)await this.#close(next,true);
  }catch(error){if(dispatched)fail('write-unresolved',{cause:error});throw error;}
 }
 async #verifyRecoveryManifest(m,audit=this.#audit(m)){
  const {ledger,envelope:e}=await audit;
  const manifest=m.pending?{...m,pending:null}:m;
  if(m.pending)await this.#publish(manifest,m);else await this.#close(manifest);
  return {manifest,ledger,envelope:e};
 }
 // An admitted copy names its manifest, so the folder listing, the manifest
 // read and the history audit, which only read, run while the session is
 // claimed. #run adopts those reads. The closing check then reads every
 // witness, ownership and the exact manifest again under ownership.
 #earlyAudit(admission,recoverStale){
  const transport=getNativeDriveReadCheck(this.adapter);
  if(!admission||this.#context||!transport||admission.folderId!==this.folderId||admission.dataClass!==this.#profile.class)return null;
  let m;try{m=manifest(JSON.parse(admission.canonical),true,this.#profile);}catch{return null;}
  if(m.pending&&!recoverStale)return null;
  const context=this.#readContext(transport,new AbortController());this.#context=context;this.#manifestId=admission.fileId;
  const reads=[this.adapter.listChildren(),this.#selected(),this.#audit(m)];for(const read of reads)read.catch(()=>{});
  const [listing,selected,audit]=reads;return {context,listing,selected,audit,reads};
 }
 // Cancels and settles an early audit that will not be used.
 async #dropEarly(early){if(!early)return;this.invalidate();early.context.controller.abort();await Promise.allSettled(early.reads);if(this.#context===early.context)this.#context=null;}
 async start({initialize=false,recoverStale=false,admission,expectedStaleSessionId}={}){
  if(initialize&&(recoverStale||admission))fail('invalid-initialization');
  if(expectedStaleSessionId!==undefined&&!recoverStale)fail('invalid-initialization');
  const priorSessionId=this.coordinator.session?.sessionId,hadUnresolved=this.#recoveryRequired;
  const early=this.#earlyAudit(admission,recoverStale);
  try{
   if(recoverStale)await this.coordinator.recoverStale({confirm:true,...(expectedStaleSessionId===undefined?{}:{expectedSessionId:expectedStaleSessionId})});else await this.coordinator.start();
   this.#stopHeartbeat?.();this.#stopHeartbeat=this.coordinator.startHeartbeat({setIntervalImpl:this.setIntervalImpl,clearIntervalImpl:this.clearIntervalImpl,isOnline:()=>true,onError:()=>this.invalidate()});
  }catch(error){await this.#dropEarly(early);throw error;}
  const claimedSessionId=this.coordinator.session?.sessionId;
  let checkingAdmission=false;
  try{return await this.#run(async()=>{try{
   checkingAdmission=Boolean(admission);
   // withWrite verified remote ownership immediately before this operation.
   this.#capture()();
   const [listed,admitted]=await Promise.allSettled(early?[early.listing,early.selected]:[this.adapter.listChildren()]);this.#capture()();
   if(listed.status==='rejected')throw listed.reason;const files=listed.value;
   const candidates=files.filter(f=>f.name===FULL_SNAPSHOT_MANIFEST_NAME||f.appProperties?.financeTrackerKind===MANIFEST);
   if(candidates.length>1)fail('ambiguous-manifest');
   if(candidates.length){this.#manifestId=candidates[0].id;if(initialize)fail('new-empty-folder-required');}
   else {
    if(!initialize||files.some(f=>f.appProperties?.financeTrackerSession!=='v1'))fail('new-empty-folder-required');
    this.#manifestId=await this.adapter.allocateFileId();this.#capture()();const m=clean(this.#profile,this.crypto.randomUUID(),this.crypto.randomUUID(),'0',null),raw=bytes(m,FULL_SNAPSHOT_LIMITS.manifestBytes);
    let dispatched=false;try{await this.adapter.createImmutable({fileId:this.#manifestId,name:FULL_SNAPSHOT_MANIFEST_NAME,kind:MANIFEST,transactionId:this.crypto.randomUUID(),content:raw,expectedSha256:await this.#digest(raw),maxBytes:FULL_SNAPSHOT_LIMITS.manifestBytes,beforeMutation:async()=>{await this.#owned();const latest=await this.adapter.listChildren();this.#capture()();if(latest.some(f=>f.appProperties?.financeTrackerSession!=='v1'))fail('new-empty-folder-required');dispatched=true;}});}
    catch(error){if(dispatched){this.#recoveryRequired=true;fail('write-unresolved',{cause:error});}throw error;}
   }
   let m;if(early&&this.#manifestId===admission.fileId){if(admitted.status==='rejected')throw admitted.reason;m=admitted.value;}else m=await this.#selected();
   this.#assertAdmission(admission,m);
   checkingAdmission=false;
   if(m.pending&&!recoverStale)fail('recovery-required');
   const {manifest,ledger,envelope:e}=await this.#verifyRecoveryManifest(m,early?.audit);
   this.#baseline={manifest:clone(manifest),owner:this.#context.owner,envelope:clone(e)};this.#recoveryRequired=false;return clone(ledger);
  }catch(error){if(early){this.invalidate();early.context.controller.abort();await Promise.allSettled(early.reads);}throw error;}},early?.context);}catch(error){
   this.invalidate();await this.#dropEarly(early);
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
 async open(){return this.#run(async()=>{const m=await this.#selected();if(m.pending)fail('recovery-required');const {ledger,envelope:e}=await this.#audit(m);await this.#close(m);this.#baseline={manifest:clone(m),owner:this.#context.owner,envelope:clone(e)};this.#recoveryRequired=false;return clone(ledger);});}
 async save(input){
  // Size admission precedes detached byte-buffer allocation and all writes. The
  // serializer may allocate a string; this is not a constant-memory promise.
  this.#profile.validateLedger(input);const raw=bytes(input,FULL_SNAPSHOT_LIMITS.snapshotBytes),candidate=JSON.parse(dec.decode(raw));
  return this.#run(async()=>{
   this.#saveAttempt=null;
   const baseline=this.#baseline;if(!baseline)fail('verified-base-required');baseline.owner();
   // The verified baseline names the base objects, so they are read while the
   // manifest is checked. A changed manifest still refuses the save.
   this.#saveAttempt={sequence:++this.#saveSequence,base:clone(baseline.manifest),candidate:null,authorityDispatched:false};
   const [base,current]=await settled([this.#selected(),this.#current(baseline.manifest,baseline.envelope)]);if(!same(base,baseline.manifest)||base.pending)fail('base-conflict');
   if(revision(base.revision)>=BigInt(FULL_SNAPSHOT_LIMITS.maxHistory))fail('byte-limit');
   assertCanonicalLedgerTransition(current.ledger,candidate);
   // An unchanged ledger is verified and returned. Otherwise the closing check
   // before the first publication covers the base.
   if(same(current.ledger,candidate)){await this.#close(base);return clone(current.ledger);}
   const transactionId=this.crypto.randomUUID(),snapshot=await this.#plan(raw);
   const value={format:ENVELOPE,version:this.#profile.version,databaseId:base.databaseId,copyId:base.copyId,revision:String(revision(base.revision)+1n),transactionId,parent:base.head,previousManifestHash:await this.#digest(bytes(base,FULL_SNAPSHOT_LIMITS.manifestBytes)),snapshot,profile:this.#profile.commitProfile,
    ...(this.#profile===PRODUCTION_PROFILE?{dataClass:this.#profile.markerValue}:{})};
   const sealed=bytes(value,FULL_SNAPSHOT_LIMITS.envelopeBytes),head=await this.#plan(sealed);
   const next=clean(this.#profile,base.databaseId,base.copyId,value.revision,head),published={...next,pending:{state:'published',base:clone(base)}};
   manifest(published,true,this.#profile);envelope(value,published,head,this.#profile);this.#capture()();
   // The envelope names the snapshot by its planned reference, so the two
   // immutable uploads are independent and run together.
   await settled([this.#create(raw,snapshot,'snapshot-object',transactionId),this.#create(sealed,head,'commit-record',transactionId)]);
   this.#capture()();this.#saveAttempt.candidate=clone(next);
   // Candidate and transition were validated above; both immutable canonical
   // encodings have independently bound actual GET receipts. Publication still
   // closes all witnesses, then the actual base/new bodies are read below.
   await this.#publish(published,base,{saveAttempt:true,readback:false});
   // Re-read actual base and new bytes after publication, not a cached upload.
   // The readback of the first publication runs with them. It is the complete
   // closing check that the second publication needs before dispatch.
   const readback=this.#close(published,true).catch(cause=>fail('write-unresolved',{cause}));
   const [,[old,after]]=await settled([readback,settled([this.#current(base,current.envelope),this.#current(published,value)])]);
   assertCanonicalLedgerTransition(old.ledger,after.ledger);if(!same(after.ledger,candidate))fail('canonical-preparation-mismatch');
   await this.#publish(next,published,{saveAttempt:true,checked:true});this.#baseline={manifest:clone(next),owner:this.#context.owner,envelope:clone(value)};this.#recoveryRequired=false;return clone(after.ledger);
  });
 }
 #assertAdmission(admission,m){
  if(admission&&(admission.folderId!==this.folderId||admission.fileId!==this.#manifestId||admission.dataClass!==this.#profile.class||
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
