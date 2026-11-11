import {canonicalizeJcs} from './transaction-protocol.mjs';
import {partitionDigest} from './canonical-partitions.mjs';
import {EMPTY_CANONICAL_BYTES, PAGED_CANONICAL_VERIFIER} from './paged-canonical-format.mjs';
import {PhysicalRootBinding, createPhysicalRootManifest, createPortableLogicalCommit, PORTABLE_COMMIT_FORMAT, PHYSICAL_MANIFEST_FORMAT} from './physical-root-binding.mjs';
import {createPagedPhysicalLocators} from './paged-physical-locators.mjs';
const enc = new TextEncoder(), dec = new TextDecoder();
const encode = x => enc.encode(canonicalizeJcs(x));
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
import {createPhysicalDriveAdapter,PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND} from './physical-drive-adapter.mjs';
export {createPhysicalDriveAdapter,PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND} from './physical-drive-adapter.mjs';
export const PAGED_INITIALIZATION_FORMAT = 'finance-tracker-paged-initialization';
const same = (a,b) => canonicalizeJcs(a) === canonicalizeJcs(b);


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
  return {manifestFileId:file.id,manifest};
}

/** Initialization intent is the discoverable restart boundary. Never delete its
 * staged objects after an interruption. Rebuilding orphan locator pages is safe. */
export async function initializePagedCanonicalCopy({adapter, guard, cryptoImpl = globalThis.crypto}) {
  let found = await inspectPagedCanonicalCopy(adapter);
  if (!found) {
    const files = await adapter.listChildren();
    if (files.some(f => f.appProperties?.financeTrackerSession !== 'v1')) fail('nonempty-folder', 'A fresh paged copy requires an empty synthetic folder.');
    const marker = {format:PAGED_INITIALIZATION_FORMAT,version:1,syntheticOnly:true,folderId:adapter.folderId,
      databaseId:cryptoImpl.randomUUID(),copyId:cryptoImpl.randomUUID(),transactionId:cryptoImpl.randomUUID(),
      rootFileId:await adapter.allocateFileId(),commitFileId:await adapter.allocateFileId()};
    const manifestFileId = await adapter.allocateFileId(), raw = encode(marker);
    await guard();
    await adapter.createImmutable({fileId:manifestFileId,name:PAGED_MANIFEST_NAME,kind:PAGED_MANIFEST_KIND,transactionId:marker.transactionId,content:raw,expectedSha256:await partitionDigest(raw),maxBytes:16384,beforeMutation:guard});
    found = {manifestFileId,manifest:marker};
  }
  if (found.manifest.format === PHYSICAL_MANIFEST_FORMAT) return found.manifestFileId;
  const m = found.manifest;
  const keys = ['format','version','syntheticOnly','folderId','databaseId','copyId','transactionId','rootFileId','commitFileId'];
  if (Object.keys(m).length !== keys.length || keys.some(k => !Object.hasOwn(m,k)) || m.version !== 1 || m.folderId !== adapter.folderId ||
      keys.slice(3).some(k => typeof m[k] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(m[k])) || m.rootFileId === m.commitFileId) fail('invalid-initialization', 'Initialization identity is invalid.');
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
  #selectedManifest;
  constructor({adapter,assertWritable,verificationPlans,manifestFileId,onReadFailure = () => {},cryptoImpl = globalThis.crypto}) {
    Object.defineProperty(this,'adapter',{value:adapter,enumerable:true});
    Object.defineProperty(this,'manifestFileId',{enumerable:true,get:()=>this.#selectedManifest,set:value=>{
      if(this.#selectedManifest!==undefined&&value!==this.#selectedManifest){this.invalidateHistory();fail('copy-mismatch','Selected manifest cannot change within an application session.');}
      this.#selectedManifest=value;
    }});
    this.assertWritable=async () => { await assertWritable(); }; this.verificationPlans=verificationPlans; this.onReadFailure=onReadFailure; this.manifestFileId=manifestFileId; this.crypto=cryptoImpl; this.recoveryRequired=false;
  }
  invalidateHistory() { this.physical?.invalidateReadCache(); this.snapshotToken=null; this.verificationPlans?.endVerification?.(this.semanticToken); this.semanticToken=null; }
  binding(manifestFileId=this.manifestFileId) {
    this.manifestFileId=manifestFileId;
    if (!this.physical) this.physical=createPhysicalDriveAdapter(this.adapter,{manifestFileId,assertWritable:this.assertWritable});
    if (!this.engine) this.engine=new PhysicalRootBinding({adapter:this.physical,assertWritable:this.assertWritable,verificationPlans:this.verificationPlans,verifySourceEvidence:this.verificationPlans?.verifySourceEvidence});
    return this.engine;
  }
  async recover({manifestFileId=this.manifestFileId}={}) {
    this.recoveryRequired=true;
    const engine=this.binding(manifestFileId), token=await this.physical.beginVerification();
    const semanticToken=this.verificationPlans?.beginVerification?.();this.semanticToken=semanticToken;
    try { const result=await engine.recover(); await engine.verifyBaseline(); await this.physical.closeVerification(token); this.verificationPlans?.endVerification?.(semanticToken); if(this.semanticToken===semanticToken)this.semanticToken=null; this.recoveryRequired=false; return result; }
    catch(error) {this.invalidateHistory();throw error;}
  }
  async readSnapshot() {
    await this.assertWritable();
    await this.finishSnapshot();
    const token=await this.physical.beginVerification();
    const semanticToken=this.verificationPlans?.beginVerification?.();this.semanticToken=semanticToken;
    const manifest=JSON.parse(dec.decode(await this.physical.readManifest()));
    await this.binding().verifyBaseline();
    if (!same(manifest,JSON.parse(dec.decode(await this.physical.readManifest())))) fail('base-conflict','Root changed during full verification.');
    if (manifest.pending !== null) fail('recovery-required','Finish paged recovery before reading.');
    const tree=createPagedPhysicalLocators(this.physical,{databaseId:manifest.databaseId,copyId:manifest.copyId,folderId:this.adapter.folderId,assertWritable:this.assertWritable});
    this.snapshotToken=token;
    return {manifest,rootHash:manifest.root,store:{read:async (hash,opts={}) => {
      this.physical.assertVerification(token);
      const read=(async()=>{try {
        // Immutable reads are provisional inside this owned scope. Fresh
        // ownership is checked at opening/closure, never inferred from a read.
        const bytes=await tree.readObject(manifest.locatorRoot,{kind:'data-object',sha256:hash},{signal:opts.signal});
        if (opts.maxBytes !== undefined && bytes.length > opts.maxBytes) fail('byte-limit','Object exceeds requested bound.'); return bytes;
      }catch(error){this.recoveryRequired=true;this.invalidateHistory();this.onReadFailure(error);throw error;}})();
      this.physical.trackRead(token,read);return read;
    }}};
  }

  async finishSnapshot() {
    if(this.snapshotClosing) return this.snapshotClosing;
    if(!this.snapshotToken) return;
    const token=this.snapshotToken, semanticToken=this.semanticToken;
    const closing=(async()=>{
      try {await this.physical.closeVerification(token);}
      finally {this.verificationPlans?.endVerification?.(semanticToken);if(this.semanticToken===semanticToken)this.semanticToken=null;}
    })();
    this.snapshotClosing=closing;
    try {await closing;}
    finally {if(this.snapshotClosing===closing)this.snapshotClosing=null;if(this.snapshotToken===token)this.snapshotToken=null;}
  }

  async transact({expectedBase,rootHash,objects,preparationStore,transactionId=this.crypto.randomUUID(),operation='synthetic-canonical-import',semanticVersion=PAGED_CANONICAL_VERIFIER}) {
    const engine=this.binding();
    await this.finishSnapshot();
    const token=await this.physical.beginVerification();
    const semanticToken=this.verificationPlans?.beginVerification?.();this.semanticToken=semanticToken;
    try {
    if (!same(expectedBase,JSON.parse(dec.decode(await this.physical.readManifest())))) fail('base-conflict','Reopen the current root before saving.');
    this.recoveryRequired=true;
    const verifiedBase=await engine.verifyBaseline();
    const typedStore={read: (q,opts) => preparationStore.read(q.sha256,opts)};
    const tree=createPagedPhysicalLocators(this.physical,{databaseId:expectedBase.databaseId,copyId:expectedBase.copyId,folderId:this.adapter.folderId,assertWritable:this.assertWritable});
    const additions=(async function* () { for await (const d of objects) {
      const existing=await tree.get(expectedBase.locatorRoot,{kind:d.kind,sha256:d.sha256});
      if (!existing) yield d;
    }})();
    const intent=await engine.prepare({verifiedBase,root:rootHash,transactionId,operation,semanticVersion,objects:additions,preparationStore:typedStore});
    const result=await engine.transact({intent,preparationStore:typedStore}); await this.physical.closeVerification(token); this.verificationPlans?.endVerification?.(semanticToken); if(this.semanticToken===semanticToken)this.semanticToken=null; this.recoveryRequired=false; return result;
    } catch(error) { this.invalidateHistory(); throw error; }
  }
}
