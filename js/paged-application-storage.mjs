import {canonicalizeJcs} from './transaction-protocol.mjs';
import {partitionDigest} from './canonical-partitions.mjs';
import {EMPTY_CANONICAL_BYTES, PAGED_CANONICAL_VERIFIER, canonicalProfileForVerifier} from './paged-canonical-format.mjs';
import {PhysicalRootBinding, validatePhysicalRootManifest, createPhysicalRootManifest, createPortableLogicalCommit, PORTABLE_COMMIT_FORMAT, PHYSICAL_MANIFEST_FORMAT} from './physical-root-binding.mjs';
import {createPagedPhysicalLocators} from './paged-physical-locators.mjs';
const enc = new TextEncoder(), dec = new TextDecoder();
const encode = x => enc.encode(canonicalizeJcs(x));
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
import {createPhysicalDriveAdapter,PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND} from './physical-drive-adapter.mjs';
export {createPhysicalDriveAdapter,PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND} from './physical-drive-adapter.mjs';
export const PAGED_INITIALIZATION_FORMAT = 'finance-tracker-paged-initialization';
const same = (a,b) => canonicalizeJcs(a) === canonicalizeJcs(b);
const failureOwners=new WeakMap();
export const isObsoletePagedVerificationFailure=error=>error!==null&&typeof error==='object'&&failureOwners.get(error)?.()===true;
export function currentPagedVerificationFailure(error) {return error!==null&&typeof error==='object'&&failureOwners.has(error)?Object.assign(new Error('Current application verification failed.',{cause:error}),{code:error.code}):error;}
function obsolete(error) {
  const result=Object.assign(new Error('An older application verification was invalidated.',{cause:error}),{code:error?.code??'verification-scope-closed'});
  failureOwners.set(result,()=>true);return result;
}



function validateInitialization(m,folderId) {
  const keys = ['format','version','syntheticOnly','folderId','databaseId','copyId','transactionId','rootFileId','commitFileId','canonicalProfile'];
  if (Object.keys(m).length !== keys.length || keys.some(k => !Object.hasOwn(m,k)) || m.version!==2 || m.canonicalProfile!=='partitions-v5' || m.folderId !== folderId ||
      ['folderId','databaseId','copyId','transactionId','rootFileId','commitFileId'].some(k => typeof m[k] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(m[k])) || m.rootFileId === m.commitFileId) fail('invalid-initialization', 'Initialization identity is invalid.');
}

export async function inspectPagedCanonicalCopy(adapter) {
  const files = await adapter.listChildren();
  const selected = files.filter(f => f.name === PAGED_MANIFEST_NAME);
  if (selected.length > 1) fail('ambiguous-manifest', 'Multiple paged manifests exist. Preserve this folder for inspection.');
  if (!selected.length) return null;
  if (files.some(f => f.name === 'ft-synthetic-dashboard-manifest.json')) fail('ambiguous-manifest','Legacy and paged manifests cannot coexist in one copy.');
  const file = selected[0];
  if (file.appProperties?.financeTrackerKind !== PAGED_MANIFEST_KIND) fail('invalid-manifest-metadata', 'Paged manifest metadata is invalid.');
  const manifest = await adapter.readJson(file.id, {kind:'manifest',maxBytes:16384});
  if (![PHYSICAL_MANIFEST_FORMAT,PAGED_INITIALIZATION_FORMAT].includes(manifest.format) || manifest.syntheticOnly !== true) fail('unsupported-manifest', 'Unrecognized paged copy.');
  if (manifest.format === PAGED_INITIALIZATION_FORMAT) {
    if (manifest.version !== 2 || manifest.canonicalProfile !== 'partitions-v5') fail('unsupported-canonical-profile','Only canonical v5 is supported. This folder was left untouched.');
    validateInitialization(manifest,adapter.folderId);
  } else {
    validatePhysicalRootManifest(manifest);
    if (manifest.storageBinding.folderId !== adapter.folderId) fail('copy-mismatch','The manifest belongs to a different folder.');
    const readonly = async () => fail('read-only-inspection','Folder inspection cannot write.');
    const physical = createPhysicalDriveAdapter(adapter,{manifestFileId:file.id,assertWritable:readonly});
    const tree = createPagedPhysicalLocators(physical,{databaseId:manifest.databaseId,copyId:manifest.copyId,folderId:adapter.folderId,assertWritable:readonly});
    const head = JSON.parse(dec.decode(await tree.readObject(manifest.locatorRoot,{kind:'commit-record',sha256:manifest.headCommit?.sha256})));
    if (manifest.headCommit.format !== PORTABLE_COMMIT_FORMAT || manifest.headCommit.version !== 4 || head.format !== PORTABLE_COMMIT_FORMAT || head.version !== 4) fail('unsupported-commit','Only portable physical protocol 4 commits are supported.');
    canonicalProfileForVerifier(head.semanticVersion);
  }
  return {manifestFileId:file.id,manifest};
}

/** Initialization intent is the discoverable restart boundary. Never delete its
 * staged objects after an interruption. Rebuilding orphan locator pages is safe. */
export async function initializePagedCanonicalCopy({adapter, guard, cryptoImpl = globalThis.crypto}) {
  let found = await inspectPagedCanonicalCopy(adapter);
  if (!found) {
    const files = await adapter.listChildren();
    if (files.some(f => f.appProperties?.financeTrackerSession !== 'v1')) fail('nonempty-folder', 'A fresh paged copy requires an empty synthetic folder.');
    const marker = {format:PAGED_INITIALIZATION_FORMAT,version:2,canonicalProfile:'partitions-v5',syntheticOnly:true,folderId:adapter.folderId,
      databaseId:cryptoImpl.randomUUID(),copyId:cryptoImpl.randomUUID(),transactionId:cryptoImpl.randomUUID(),
      rootFileId:await adapter.allocateFileId(),commitFileId:await adapter.allocateFileId()};
    const manifestFileId = await adapter.allocateFileId(), raw = encode(marker);
    await guard();
    await adapter.createImmutable({fileId:manifestFileId,name:PAGED_MANIFEST_NAME,kind:PAGED_MANIFEST_KIND,transactionId:marker.transactionId,content:raw,expectedSha256:await partitionDigest(raw),maxBytes:16384,beforeMutation:guard});
    found = {manifestFileId,manifest:marker};
  }
  if (found.manifest.format === PHYSICAL_MANIFEST_FORMAT) return found.manifestFileId;
  const m = found.manifest;
  validateInitialization(m,adapter.folderId);
  const exactGuard = async () => { await guard(); if (!same(JSON.parse(dec.decode(await physical.readManifest())),m)) fail('base-conflict','Initialization marker changed.'); };
  const physical = createPhysicalDriveAdapter(adapter,{manifestFileId:found.manifestFileId,assertWritable:guard});
  const root = await partitionDigest(EMPTY_CANONICAL_BYTES);
  const commit = createPortableLogicalCommit({databaseId:m.databaseId,parent:null,revision:'0',previousRoot:null,root,transactionId:m.transactionId,operation:'genesis',semanticVersion:PAGED_CANONICAL_VERIFIER});
  const commitBytes = encode(commit), commitHash = await partitionDigest(commitBytes), entries=[];
  for (const [fileId,kind,bytes,sha256] of [[m.rootFileId,'data-object',EMPTY_CANONICAL_BYTES,root],[m.commitFileId,'commit-record',commitBytes,commitHash]]) {
    await exactGuard();
    await adapter.createImmutable({fileId,name:'ft-paged-'+sha256+'.bin',kind:kind === 'data-object' ? 'snapshot-object':kind,transactionId:m.transactionId,content:bytes,expectedSha256:sha256,maxBytes:65536,beforeMutation:exactGuard});
    entries.push({fileId,kind,identity:sha256,sha256});
  }
  const tree = createPagedPhysicalLocators(physical,{databaseId:m.databaseId,copyId:m.copyId,folderId:m.folderId,assertWritable:exactGuard});
  const locatorRoot = await tree.build(entries.sort((a,b) => a.kind < b.kind ? -1 : 1));
  const manifest = createPhysicalRootManifest({databaseId:m.databaseId,copyId:m.copyId,folderId:m.folderId,provider:'google-drive',revision:'0',root,
    headCommit:{format:PORTABLE_COMMIT_FORMAT,version:4,sha256:commitHash},locatorRoot});
  await exactGuard(); await adapter.publishManifest(found.manifestFileId,manifest,{beforeMutation:exactGuard});
  return found.manifestFileId;
}

export class PagedApplicationStorage {
  #physical; #selectedManifest; #plans; #planEntries; #beginSemantic; #endSemantic;
  #generation=Object.freeze({});
  #current=null; #closures=new WeakMap(); #results=new WeakMap(); #snapshots=new WeakMap();
  constructor({adapter,assertWritable,verificationPlans,manifestFileId,onReadFailure = () => {},cryptoImpl = globalThis.crypto}) {
    Object.defineProperty(this,'adapter',{value:adapter,enumerable:true});
    Object.defineProperty(this,'physical',{enumerable:true,get:()=>this.#physical});
    Object.defineProperty(this,'manifestFileId',{enumerable:true,get:()=>this.#selectedManifest,set:value=>{
      if(this.#selectedManifest!==undefined&&value!==this.#selectedManifest){this.invalidateHistory();fail('copy-mismatch','Selected manifest cannot change within an application session.');}
      this.#selectedManifest=value;
    }});
    Object.defineProperty(this,'assertWritable',{value:async()=>{await assertWritable();}});
    this.verificationPlans=verificationPlans;this.#plans=verificationPlans;
    this.#planEntries=[...Map.prototype.entries.call(verificationPlans)];
    this.#beginSemantic=verificationPlans.beginVerification;this.#endSemantic=verificationPlans.endVerification;
    this.onReadFailure=onReadFailure;this.manifestFileId=manifestFileId;this.crypto=cryptoImpl;this.recoveryRequired=false;
  }
  #checkPlans() {
    const entries=[...Map.prototype.entries.call(this.#plans)];
    if(this.verificationPlans!==this.#plans||this.#plans.beginVerification!==this.#beginSemantic||this.#plans.endVerification!==this.#endSemantic||
      entries.length!==this.#planEntries.length||entries.some(([k,v],i)=>k!==this.#planEntries[i][0]||v!==this.#planEntries[i][1]))
      fail('verification-plan-changed','Installed verification plans cannot change during an application session.');
  }
  verificationGeneration() {return this.#generation;}
  captureMutationGuard() {
    const generation=this.#generation,context=this.#current,physicalGuard=context?.physicalGuard??this.#physical?.captureVerificationLifetime();
    return ()=>{this.assertVerificationGeneration(generation);this.#checkPlans();if(context){this.#assertOpen(context);if(context.preparing)fail('verification-scope-closed','Preparation reads have not finished.');}else physicalGuard?.();};
  }
  #assertOpen(context) {
    this.#live(context);
    if(context.closed||context.closing)fail('verification-scope-closed','The application verification is closing or closed.');
    context.physicalGuard();
  }
  verificationFailure(error) {
    // Always create a per-call result. Reusing an Error object from a different
    // callback must not transfer its old operation or alter another catch.
    const generation=this.#generation;
    const result=Object.assign(new Error(error?.message??'Application verification failed.',{cause:error}),{code:error?.code,...(error?.details===undefined?{}:{details:error.details})});
    failureOwners.set(result,()=>this.#generation!==generation);return result;
  }
  assertVerificationGeneration(generation) {if(generation!==this.#generation)throw obsolete(Object.assign(new Error('Application session changed.'),{code:'verification-scope-closed'}));}
  async readManifest() {
    const generation=this.#generation;
    try {const bytes=await this.physical.readManifest();this.assertVerificationGeneration(generation);return bytes;}
    catch(error){this.assertVerificationGeneration(generation);throw this.verificationFailure(error);}
  }
  #end(context) {this.#endSemantic?.call(this.#plans,context.semanticToken);}
  #live(context) {
    if(!context||this.#current!==context)throw obsolete(Object.assign(new Error('Application verification was invalidated.'),{code:'verification-scope-closed'}));
    this.#checkPlans();
  }
  invalidateHistory(context) {
    if(context!==undefined&&this.#current!==context)return false;
    const prior=this.#current;this.#current=null;this.#generation=Object.freeze({});
    this.physical?.invalidateReadCache();
    if(prior)this.#end(prior);
    return true;
  }
  binding(manifestFileId=this.manifestFileId) {
    this.#checkPlans();this.manifestFileId=manifestFileId;
    if(!this.#physical)this.#physical=createPhysicalDriveAdapter(this.adapter,{manifestFileId,assertWritable:this.assertWritable});
    if(!this.engine)this.engine=new PhysicalRootBinding({adapter:this.physical,assertWritable:this.assertWritable,
      verificationPlans:this.#plans,verifySourceEvidence:this.#plans.verifySourceEvidence,
      captureOperationGuard:()=>{const context=this.#current;return ()=>this.#assertOpen(context);}});
    return this.engine;
  }
  async #begin() {
    this.#checkPlans();
    if(this.#current){
      if(!this.#current.closed)fail('verification-scope-open','Finish the previous application verification.');
      this.#current=null;
    }
    const context={physicalToken:null,semanticToken:null,closed:false,manifest:null,reads:new Set(),handle:Object.freeze({})};
    this.#current=context;this.#generation=Object.freeze({});context.generation=this.#generation;
    try {
      context.physicalToken=await this.physical.beginVerification();
      context.physicalGuard=this.#physical.captureVerificationLifetime(context.physicalToken);this.#assertOpen(context);
      context.semanticToken=this.#beginSemantic?.call(this.#plans);
      this.#assertOpen(context);
      return context;
    }catch(error){if(!this.invalidateHistory(context))throw obsolete(error);throw this.verificationFailure(error);}
  }
  #trackRead(context,read) {
    context.reads.add(read);read.then(()=>context.reads.delete(read),()=>context.reads.delete(read));
    this.physical.trackRead(context.physicalToken,read);return read;
  }
  async #close(context) {
    // A locator lookup may admit its bounded body proof only after walking its
    // pages. Finish those already-owned operations before closing physical
    // proof admission. Snapshot entry points reject new reads while draining.
    try {await Promise.all([...context.reads]);this.#live(context);await this.physical.closeVerification(context.physicalToken);this.#live(context);context.closed=true;}
    finally {this.#end(context);}
  }
  async recover({manifestFileId=this.manifestFileId}={}) {
    this.invalidateHistory();this.recoveryRequired=true;
    const engine=this.binding(manifestFileId),context=await this.#begin();
    try {
      this.#live(context);
      const result=await engine.recover();this.#live(context);
      await engine.verifyBaseline();this.#live(context);await this.#close(context);
      this.#live(context);this.#current=null;this.recoveryRequired=false;return result;
    }catch(error){if(!this.invalidateHistory(context))throw obsolete(error);throw this.verificationFailure(error);}
  }
  async readSnapshot() {
    const engine=this.binding(),generation=this.#generation;
    try {await this.assertWritable();this.assertVerificationGeneration(generation);}
    catch(error){this.assertVerificationGeneration(generation);throw this.verificationFailure(error);}
    await this.finishSnapshot();this.assertVerificationGeneration(generation);
    const context=await this.#begin();
    try {
      this.#live(context);
      const manifest=JSON.parse(dec.decode(await this.physical.readManifest()));this.#live(context);
      await engine.verifyBaseline();this.#live(context);
      const current=JSON.parse(dec.decode(await this.physical.readManifest()));this.#live(context);
      if(!same(manifest,current))fail('base-conflict','Root changed during full verification.');
      if(manifest.pending!==null)fail('recovery-required','Finish paged recovery before reading.');
      context.manifest=structuredClone(manifest);this.#closures.set(context.handle,context);
      const tree=createPagedPhysicalLocators(this.physical,{databaseId:manifest.databaseId,copyId:manifest.copyId,folderId:this.adapter.folderId,assertWritable:this.assertWritable});
      const head=JSON.parse(dec.decode(await tree.readObject(manifest.locatorRoot,{kind:'commit-record',sha256:manifest.headCommit.sha256})));
      this.#live(context);
      const profile=canonicalProfileForVerifier(head.semanticVersion);
      const snapshot={manifest,rootHash:manifest.root,semanticVersion:profile.verifier,
      store:{read:async(hash,opts={})=>{
        this.#live(context);if(context.closing)fail('verification-scope-closed','Snapshot is closing.');this.physical.assertVerification(context.physicalToken);
        const read=(async()=>{try {
          const bytes=await tree.readObject(manifest.locatorRoot,{kind:'data-object',sha256:hash},{signal:opts.signal});
          this.#live(context);
          if(opts.maxBytes!==undefined&&bytes.length>opts.maxBytes)fail('byte-limit','Object exceeds requested bound.');return bytes;
        }catch(error){if(this.invalidateHistory(context)){this.recoveryRequired=true;error=this.verificationFailure(error);this.onReadFailure(error);}else error=obsolete(error);throw error;}})();
        return this.#trackRead(context,read);
      }}};
      this.#snapshots.set(snapshot,context);return snapshot;
    }catch(error){if(!this.invalidateHistory(context))throw obsolete(error);throw this.verificationFailure(error);}
  }
  assertSnapshotCurrent(snapshot) {
    const context=this.#snapshots.get(snapshot);
    if(!context)fail('verification-scope-closed','Snapshot result is not owned by this application.');
    this.#live(context);
  }
  async finishSnapshot() {
    const context=this.#current;
    if(!context?.manifest)return;
    if(context.closing)return context.closing;
    if(context.closed)return context.handle;
    context.closing=(async()=>{
      try {await this.#close(context);this.#live(context);return context.handle;}
      catch(error){if(!this.invalidateHistory(context))throw obsolete(error);throw this.verificationFailure(error);}
    })();
    return context.closing;
  }
  completeSnapshot(handle,manifest) {
    const context=this.#closures.get(handle);
    if(!context)return;
    this.assertVerificationGeneration(context.generation);
    if(context.completed)return;
    this.#live(context);
    if(!context.closed||!same(context.manifest,manifest))fail('base-conflict','Snapshot completion does not match its closed manifest.');
    context.completed=true;this.#current=null;
  }
  discardSnapshot(handle,generation) {
    const context=this.#closures.get(handle);
    if(context)return this.invalidateHistory(context);
    return generation===this.#generation?this.invalidateHistory():false;
  }
  assertTransactionCurrent(result) {
    const context=this.#results.get(result);
    if(!context)fail('verification-scope-closed','Transaction result is not owned by this application.');
    this.#live(context);
  }
  completeTransaction(result) {
    this.assertTransactionCurrent(result);
    const context=this.#results.get(result);
    this.#live(context);
    if(!context.closed||!same(context.manifest,result.manifest))fail('base-conflict','Transaction completion does not match its closed manifest.');
    this.#current=null;this.#results.delete(result);
  }
  discardTransaction(result) {const context=this.#results.get(result);if(context)this.invalidateHistory(context);}
  async #prepareRoot(context,prepare,base,semanticVersion,tree) {
    const pending=new Set();let accepting=true,failed=false,failure,callbackFailed=false,callbackFailure,result;
    const remember=error=>{if(!failed){failed=true;failure=error;}};
    const reject=error=>{const promise=Promise.reject(error);promise.catch(()=>{});return promise;};
    const guard=()=>{this.assertVerificationGeneration(context.generation);this.#assertOpen(context);this.physical.assertVerification(context.physicalToken);};
    const read=(hash,options={})=>{
      if(!accepting)return reject(Object.assign(new Error('Preparation reader is closed.'),{code:'verification-scope-closed'}));
      let signal,maxBytes;
      try {
        guard();({signal,maxBytes}=options);
        if(maxBytes!==undefined&&(!Number.isSafeInteger(maxBytes)||maxBytes<1))fail('byte-limit','Expected a positive object byte bound.');
        guard();
      }catch(error){remember(error);return reject(error);}
      // Register before starting asynchronous work. Return this same Promise so
      // unawaited failures are observed without leaving an untracked wrapper.
      const operation=Promise.resolve().then(async()=>{
        guard();const bytes=await tree.readObject(base.locatorRoot,{kind:'data-object',sha256:hash},{signal});guard();
        if(maxBytes!==undefined&&bytes.length>maxBytes)fail('byte-limit','Object exceeds requested bound.');return bytes;
      }).catch(error=>{remember(error);throw error;});
      pending.add(operation);operation.then(()=>pending.delete(operation),()=>pending.delete(operation));
      try {this.#trackRead(context,operation);}catch(error){remember(error);return reject(error);}
      return operation;
    };
    const own=result=>{
      if(!result||Object.keys(result).length!==3||!['rootHash','objects','preparationStore'].every(key=>Object.hasOwn(result,key)))
        fail('invalid-preparation','Preparation must return a root, descriptors and owned bytes.');
      const {rootHash,objects,preparationStore}=result,read=preparationStore?.read;
      if(typeof rootHash!=='string'||!Array.isArray(objects)||typeof read!=='function')
        fail('invalid-preparation','Callback preparation requires a root, descriptor array and byte reader.');
      return {rootHash,objects:structuredClone(objects),preparationStore:Object.freeze({read:read.bind(preparationStore)})};
    };
    context.preparing=true;
    try {
      try {
        const returned=prepare(Object.freeze({rootHash:base.root,semanticVersion,store:Object.freeze({read})}));
        // A synchronous callback loses read admission before any queued work.
        const settled=returned&&typeof returned.then==='function'?await returned:returned;
        accepting=false;result=own(settled);
      }catch(error){callbackFailed=true;callbackFailure=error;}
      finally {accepting=false;await Promise.allSettled([...pending]);}
      guard();
      if(callbackFailed)throw callbackFailure;
      if(failed)throw failure;
      return result;
    }finally{accepting=false;context.preparing=false;}
  }
  async transact({expectedBase,rootHash,objects,preparationStore,prepare,transactionId=this.crypto.randomUUID(),operation='synthetic-canonical-import',semanticVersion=PAGED_CANONICAL_VERIFIER}) {
    expectedBase=structuredClone(expectedBase);
    if(prepare!==undefined&&(typeof prepare!=='function'||rootHash!==undefined||objects!==undefined||preparationStore!==undefined))
      fail('invalid-preparation','Provide either a preparation callback or prepared root inputs.');
    const engine=this.binding(),generation=this.#generation;
    await this.finishSnapshot();this.assertVerificationGeneration(generation);
    const context=await this.#begin();
    try {
    this.#live(context);
    const current=JSON.parse(dec.decode(await this.physical.readManifest()));this.#live(context);
    if (!same(expectedBase,current)) fail('base-conflict','Reopen the current root before saving.');
    this.recoveryRequired=true;
    const verifiedBase=await engine.verifyBaseline({expectedManifest:current});this.#live(context);
    const tree=createPagedPhysicalLocators(this.physical,{databaseId:current.databaseId,copyId:current.copyId,folderId:current.storageBinding.folderId,assertWritable:this.assertWritable});
    if(prepare!==undefined) {
      const head=JSON.parse(dec.decode(await tree.readObject(current.locatorRoot,{kind:'commit-record',sha256:current.headCommit.sha256})));this.#assertOpen(context);
      const profile=canonicalProfileForVerifier(head.semanticVersion);
      if(profile.verifier!==semanticVersion)fail('canonical-profile-mismatch','Preparation must preserve the selected canonical profile.');
      const prepared=await this.#prepareRoot(context,prepare,current,profile.verifier,tree);this.#assertOpen(context);
      ({rootHash,objects,preparationStore}=prepared);
    }
    const readPreparation=preparationStore?.read?.bind(preparationStore);
    if(typeof readPreparation!=='function')fail('invalid-preparation','Preparation requires a byte reader.');
    const typedStore={read:(q,opts)=>readPreparation(q.sha256,opts)};
    const additions=(async function* () { for await (const d of objects) {
      const existing=await tree.get(current.locatorRoot,{kind:d.kind,sha256:d.sha256});
      if (!existing) yield d;
    }})();
    const intent=await engine.prepare({verifiedBase,root:rootHash,transactionId,operation,semanticVersion,objects:additions,preparationStore:typedStore});this.#live(context);
    const result=await engine.transact({intent,preparationStore:typedStore});this.#live(context);
    await this.#close(context);this.#live(context);
    const after=JSON.parse(dec.decode(await this.physical.readManifest()));this.#live(context);
    if(!same(result.manifest,after))fail('base-conflict','Root changed after transaction closure.');
    await this.assertWritable();this.#live(context);
    context.manifest=structuredClone(result.manifest);this.#results.set(result,context);
    this.recoveryRequired=false;return result;
    }catch(error){if(!this.invalidateHistory(context))throw obsolete(error);throw this.verificationFailure(error);}
  }
}
