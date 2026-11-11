/** Synthetic v4 copies. Traversal and transport are bounded per object; the
 * registered application semantic verifier may materialize a legacy ledger. */
import {createImmutablePageTree} from './immutable-page-tree.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {createPagedPhysicalLocators} from './paged-physical-locators.mjs';
import {createPhysicalRootManifest,createPortableLogicalCommit,PORTABLE_COMMIT_FORMAT,PhysicalRootBinding} from './physical-root-binding.mjs';
import {encodeFramedBackup,writeFramedBackup,restoreFramedBackup} from './framed-backup-stream.mjs';
import {partitionDigest} from './canonical-partitions.mjs';
import {PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND,createPhysicalDriveAdapter} from './paged-application-storage.mjs';
import {verifyCatalogArchive} from './catalog-backup.mjs';
const enc = new TextEncoder(), dec = new TextDecoder('utf-8',{fatal:true});
const MAX = 65536;
const fail = code => {throw Object.assign(new Error(code),{code});};
const bytes = value => enc.encode(canonicalizeJcs(value));
const json = raw => JSON.parse(dec.decode(raw));
const same = (a,b) => canonicalizeJcs(a) === canonicalizeJcs(b);
const abort = signal => {if(signal?.aborted) throw new DOMException('Copy cancelled.','AbortError');};
const physicalKind = kind => kind === 'data-object' ? 'snapshot-object' : kind;
function treeFor(adapter,manifest,guard) {
  return createPagedPhysicalLocators(adapter,{databaseId:manifest.databaseId,copyId:manifest.copyId,folderId:adapter.folderId,...(guard?{assertWritable:guard}:{})});
}
function descriptor(entry) {
  return {kind:entry.kind,identity:entry.identity,...(entry.kind === 'journal-event'?{transactionId:entry.transactionId,sequence:entry.sequence}:{})};
}
async function readManifest(adapter,id) {
  const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:id,assertWritable:async()=>{}});
  const raw = await physical.readManifest({maxBytes:16384});
  if(raw.length>16384) fail('manifest-byte-limit');
  const m=json(raw);
  if(m.format!=='finance-tracker-physical-root-manifest'||m.version!==4||m.pending!==null||m.syntheticOnly!==true||m.storageBinding.folderId!==adapter.folderId) fail('clean-v4-manifest-required');
  return m;
}
async function sourceWitness(adapter,id,legacy=false) {
  const before=await adapter.readMetadata(id,{maxBytes:16384});
  if(legacy&&(before.id!==id||before.name!=='ft-synthetic-dashboard-manifest.json'||before.appProperties?.financeTrackerKind!=='dashboard-synthetic-manifest'||before.trashed!==false||!before.parents?.includes(adapter.folderId)||typeof before.version!=='string'||!(/^[1-9][0-9]*$/).test(before.version)||typeof before.size!=='string'||!(/^(0|[1-9][0-9]*)$/).test(before.size))) fail('manifest-metadata-mismatch');
  const manifest=legacy?await adapter.readJson(id,{kind:'manifest'}):await readManifest(adapter,id);
  const after=await adapter.readMetadata(id,{maxBytes:16384});
  if(!same(before,after)) fail('source-version-changed');
  return {manifest,metadata:after};
}
export const SOURCE_PHYSICAL_EVIDENCE_FORMAT='finance-tracker-source-physical-evidence';
/** These are historical addresses, never live destination authority. The only
 * resolver below is the authenticated evidence index; it has no network route. */
async function verifySourcePhysicalEvidenceInner({manifest,evidenceRoot,readObject,verificationPlans,lineageVerifiers=new Map(),signal,observe,checkLegacy,recursiveVerifier}) {
  // Fixed private byte reuse inside this one exact evidence audit. No witness
  // or approval escapes the call, and outer physical scopes still close fresh.
  const cache=new Map();let cacheBytes=0;
  const readData=async(hash,options={})=>{
    abort(signal);abort(options.signal);const maximum=options.maxBytes??MAX;
    const hit=cache.get(hash);
    if(hit){if(hit.length>maximum)fail('source-evidence-byte-limit');cache.delete(hash);cache.set(hash,hit);return hit.slice();}
    const supplied=await readObject({kind:'data-object',sha256:hash},options);
    if(!(supplied instanceof Uint8Array)||supplied.length>maximum)fail('source-evidence-byte-limit');
    const raw=new Uint8Array(supplied);
    if(await partitionDigest(raw)!==hash)fail('source-evidence-hash-mismatch');
    while((cacheBytes+raw.length>1024*1024||cache.size>=128)&&cache.size){const key=cache.keys().next().value;cacheBytes-=cache.get(key).length;cache.delete(key);}
    cache.set(hash,raw);cacheBytes+=raw.length;return raw.slice();
  };
  const evidence=json(await readData(evidenceRoot));
  const keys=['format','version','manifestFileId','manifestSha256','metadataRoot','sourceCopyId','databaseId','root','headCommit','revision'];
  if(!evidence||Object.keys(evidence).length!==keys.length||keys.some(key=>!Object.hasOwn(evidence,key))||evidence.format!==SOURCE_PHYSICAL_EVIDENCE_FORMAT||evidence.version!==1) fail('source-evidence-format');
  observe?.(evidence);
  if(manifest&&manifest.copyId===evidence.sourceCopyId) fail('invalid-copy-identity');
  if(manifest&&manifest.databaseId!==evidence.databaseId)fail('source-evidence-database-mismatch');
  const map=createImmutablePageTree({read:readData});
  await map.verify(evidence.metadataRoot,{signal});
  const selected=json(await readData(evidence.manifestSha256,{maxBytes:16384}));
  if(selected.copyId!==evidence.sourceCopyId||selected.databaseId!==evidence.databaseId||selected.root!==evidence.root||selected.revision!==evidence.revision||!same(selected.headCommit,evidence.headCommit)) fail('source-evidence-binding-mismatch');
  const consulted=new Set();
  // Parsed descriptors are owned by this exact evidence/root/read-source audit.
  // This caches no proof: full tree verification and final exact closure remain
  // mandatory. Oversized records use the ordinary uncached lookup path.
  const lookupCache=new Map(),lookupMaxEntries=128,lookupMaxBytes=1024*1024;
  let lookupBytes=0;
  const freezeOwned=value=>{
    if(value&&typeof value==='object') {
      for(const child of Object.values(value))freezeOwned(child);
      Object.freeze(value);
    }
    return value;
  };
  const lookup=async id=>{
    abort(signal);consulted.add(id);
    const hit=lookupCache.get(id);
    if(hit){lookupCache.delete(id);lookupCache.set(id,hit);return hit.value;}
    const value=await map.get(evidence.metadataRoot,id,{signal});
    if(!value||Object.keys(value).length!==2||!value.metadata||typeof value.sha256!=='string'||value.metadata.id!==id) fail('source-evidence-missing-file');
    const owned=freezeOwned(structuredClone(value)),size=bytes(owned).length;
    if(size<=lookupMaxBytes) {
      while(lookupCache.size&&(lookupCache.size>=lookupMaxEntries||lookupBytes+size>lookupMaxBytes)) {
        const key=lookupCache.keys().next().value;
        lookupBytes-=lookupCache.get(key).size;lookupCache.delete(key);
      }
      lookupCache.set(id,{value:owned,size});lookupBytes+=size;
    }
    return owned;
  };
  const deny=async()=>fail('source-evidence-read-only');
  const inert={folderId:selected.storageBinding.folderId,
    readMetadata:async(id,{maxBytes=16384}={})=>{const m=(await lookup(id)).metadata;if(bytes(m).length>maxBytes)fail('source-evidence-byte-limit');return structuredClone(m);},
    readBytes:async(id,options={})=>readData((await lookup(id)).sha256,options),
    readManifest:async()=>{
      const ref=await lookup(evidence.manifestFileId);
      if(ref.sha256!==evidence.manifestSha256||ref.metadata.id!==evidence.manifestFileId||ref.metadata.name!==PAGED_MANIFEST_NAME||ref.metadata.appProperties?.financeTrackerKind!==PAGED_MANIFEST_KIND||ref.metadata.trashed!==false||!ref.metadata.parents?.includes(selected.storageBinding.folderId))fail('source-evidence-manifest-mismatch');
      const raw=await readData(ref.sha256,{maxBytes:16384});
      if(ref.metadata.size!==String(raw.length)||typeof ref.metadata.version!=='string'||!(/^[1-9][0-9]*$/).test(ref.metadata.version))fail('source-evidence-manifest-mismatch');return raw;
    },allocateFileId:deny,createImmutable:deny,writeManifest:deny};
  const sourcePlans=new Map([...verificationPlans].map(([name,verify])=>[name,async input=>{
    await verify(input);
    if(input.commit?.operation==='migrate-legacy-v4'&&checkLegacy) {
      const {validateSyntheticApplicationSnapshot}=await import('./synthetic-application-structure.mjs');
      const old=await verifyLegacyMigrationEvidence({evidenceRoot:input.commit.changeEvidenceRoot,readObject:input.readObject,validateStructure:validateSyntheticApplicationSnapshot,signal});
      checkLegacy(old);
    }
  }]));
  await new PhysicalRootBinding({adapter:inert,assertWritable:async()=>{},verificationPlans:sourcePlans,lineageVerifiers,verifySourceEvidence:recursiveVerifier}).verifyCopy({signal});
  // Every recorded dependency, including prior retained evidence, must exist.
  for await(const [id,entry] of map.entries(evidence.metadataRoot,{signal})) {
    if(!consulted.has(id))fail('source-evidence-unreferenced-file');
    if(!entry||Object.keys(entry).length!==2||entry.metadata?.id!==id||entry.metadata.trashed!==false||!entry.metadata.parents?.includes(selected.storageBinding.folderId)||typeof entry.metadata.version!=='string'||!(/^[1-9][0-9]*$/).test(entry.metadata.version))fail('source-evidence-metadata-mismatch');
    const raw=await readData(entry.sha256);
    if(entry.metadata.size!==String(raw.length))fail('source-evidence-size-mismatch');
  }
  return evidence;
}
export async function verifySourcePhysicalEvidence(input) {
  return withSourceEvidenceVerification(input.verificationPlans).verifySourceEvidence(input);
}
export function withSourceEvidenceVerification(plans) {
  if(!(plans instanceof Map))fail('verification-plan-unavailable');
  if(typeof plans.verifySourceEvidence!=='function') {
    const verifyInContext=async(input,state)=>{
      const target=input.manifest?.copyId,hash=input.evidenceRoot,frame={origins:new Set()};
      if(target)state.targets.set(target,(state.targets.get(target)??0)+1);
      const observe=evidence=>{
        if(state.targets.has(evidence.sourceCopyId))fail('invalid-copy-identity');
        for(const parent of state.frames)parent.origins.add(evidence.sourceCopyId);
      };
      try {
        if(state.active.has(hash))fail('source-evidence-cycle');
        const cached=state.done.get(hash);
        if(cached) {
          if(input.manifest?.databaseId!==cached.evidence.databaseId)fail('source-evidence-database-mismatch');
          for(const origin of cached.origins)observe({sourceCopyId:origin});
          return;
        }
        state.active.add(hash);state.frames.push(frame);
        try {
          const evidence=await verifySourcePhysicalEvidenceInner({...input,verificationPlans:plans,observe,
            recursiveVerifier:next=>verifyInContext(next,state),
            checkLegacy:verified=>{for(const origin of legacyCopyOrigins(verified))observe({sourceCopyId:origin});}});
          state.done.set(hash,{evidence,origins:frame.origins});return;
        }finally{state.frames.pop();state.active.delete(hash);}
      }finally{
        if(target){const count=state.targets.get(target)-1;if(count)state.targets.set(target,count);else state.targets.delete(target);}
      }
    };
    // Each public invocation owns fresh proof state. Only the internally bound
    // recursive callback can share it; overlapping callers cannot borrow proof.
    Object.defineProperty(plans,'verifySourceEvidence',{value:input=>verifyInContext(input,
      {active:new Set(),done:new Map(),targets:new Map(),frames:[]})});
  }
  return plans;
}

function capturePhysicalReads(physical) {
  const records=new Map();
  const observe=(id,metadata)=>{
    const prior=records.get(id);
    if(prior?.metadata&&!same(prior.metadata,metadata))fail('source-evidence-version-changed');
    records.set(id,{...prior,metadata:structuredClone(metadata)});
  };
  const adapter={...physical,
    readMetadata:async(id,options)=>{const metadata=await physical.readMetadata(id,options);observe(id,metadata);return metadata;},
    readBytes:async(id,options)=>{const raw=await physical.readBytes(id,options),sha256=await partitionDigest(raw),prior=records.get(id);
      if(prior?.sha256&&prior.sha256!==sha256)fail('source-evidence-bytes-changed');records.set(id,{...prior,sha256});return raw;}
  };
  return {adapter,records,observe};
}
async function prepareSourceEvidence({captured,pinned,sourceAdapter,manifestFileId,signal}) {
  const raw=await sourceAdapter.readBytes(manifestFileId,{kind:'manifest',maxBytes:16384,signal});
  if(!same(json(raw),pinned.manifest)||String(raw.length)!==pinned.metadata.size)fail('source-evidence-manifest-mismatch');
  const manifestSha256=await partitionDigest(raw);
  captured.observe(manifestFileId,pinned.metadata);
  captured.records.set(manifestFileId,{metadata:structuredClone(pinned.metadata),sha256:manifestSha256});
  const prepared=new Map([[manifestSha256,new Uint8Array(raw)]]);
  const store={read:async hash=>{const raw=prepared.get(hash);if(!raw)fail('source-evidence-missing-object');return raw;},write:async raw=>{if(raw.length>MAX)fail('source-evidence-byte-limit');const hash=await partitionDigest(raw);prepared.set(hash,new Uint8Array(raw));return hash;}};
  const tree=createImmutablePageTree(store);
  const entries=[...captured.records].filter(([,record])=>record.sha256).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const metadataRoot=await tree.build(entries,{signal});
  const m=pinned.manifest;
  const root=await store.write(bytes({format:SOURCE_PHYSICAL_EVIDENCE_FORMAT,version:1,manifestFileId,manifestSha256,metadataRoot,
    sourceCopyId:m.copyId,databaseId:m.databaseId,root:m.root,headCommit:m.headCommit,revision:m.revision}));
  return {root,prepared,entries};
}
/** Complete logical ancestry, including semantic validation of every root. */
export async function verifyPagedCopy({adapter,manifest,verificationPlans,lineageVerifiers=new Map(),signal}) {
  const tree=treeFor(adapter,manifest);
  await tree.verify(manifest.locatorRoot,{signal});
  const readObject=(q)=>tree.readObject(manifest.locatorRoot,q,{signal});
  let head=manifest.headCommit, revision=BigInt(manifest.revision), root=manifest.root;
  while(head!==null) {
    abort(signal);
    const raw=await readObject({kind:'commit-record',sha256:head.sha256});
    let c=json(raw);
    if(head.format===PORTABLE_COMMIT_FORMAT&&head.version===4) {
      if(!same(createPortableLogicalCommit(c),c)||!bytes(c).every((value,index)=>value===raw[index])||bytes(c).length!==raw.length) fail('invalid-portable-commit');
      const verify=verificationPlans?.get(c.semanticVersion);
      if(!verify) fail('verification-plan-unavailable');
      if(await verify({manifest:{...manifest,root,revision:String(revision),headCommit:head},commit:c,readObject,signal,phase:'history'})!==undefined)fail('invalid-verification-result');
    } else {
      const verify=lineageVerifiers.get(head.format+':'+head.version);
      if(!verify) fail('lineage-verifier-unavailable');
      c=await verify({reference:head,bytes:raw,readObject,signal});
    }
    if(c.databaseId!==manifest.databaseId||c.revision!==String(revision)||c.root!==root||(c.parent===null)!==(revision===0n)||(c.previousRoot===null)!==(revision===0n)) fail('history-mismatch');
    await readObject({kind:'data-object',sha256:root});
    head=c.parent;root=c.previousRoot;revision--;
  }
  if(revision!==-1n) fail('history-mismatch');
  let count=0n;
  for await(const e of tree.entries(manifest.locatorRoot,{signal})) if(e.kind==='commit-record') count++;
  if(count!==BigInt(manifest.revision)+1n) fail('disconnected-history');
  if(manifest.sourceEvidence) {
    const plans=withSourceEvidenceVerification(verificationPlans);
    if(await plans.verifySourceEvidence({manifest,evidenceRoot:manifest.sourceEvidence.sha256,readObject,signal})!==undefined)fail('invalid-verification-result');
  }
  return true;
}
async function requireCatalogOnlyOriginals(adapter) {
  for await(const file of adapter.iterateChildren()) {
    if(['synthetic-original-import-index','retained-original'].includes(file.appProperties?.financeTrackerKind)||file.name==='ft-synthetic-original-imports.json') fail('external-original-retention-not-supported');
  }
}
async function writeExact(adapter,raw,kind,transactionId,guard,signal,name='ft-v4-copy-object.bin') {
  abort(signal);if(!(raw instanceof Uint8Array)||raw.length>MAX) fail('object-byte-limit');
  raw=new Uint8Array(raw);const sha256=await partitionDigest(raw);
  await guard();const fileId=await adapter.allocateFileId({signal});
  let guarded=false;
  await adapter.createImmutable({fileId,name,kind:physicalKind(kind),transactionId,content:raw,expectedSha256:sha256,maxBytes:MAX,signal,
    beforeMutation:async()=>{abort(signal);await guard();guarded=true;}});
  if(!guarded) fail('unguarded-copy-write');
  const visible=await adapter.readBytes(fileId,{kind:physicalKind(kind),maxBytes:MAX,signal});
  if(visible.length>MAX||await partitionDigest(visible)!==sha256) fail('copy-readback-mismatch');
  return {fileId,sha256};
}
/** Pin under the caller's session gate for the complete streaming export. */
export async function exportPagedCanonicalArchive({sourceAdapter,sourceManifestFileId,withSourceLock,assertSourceWritable,verificationPlans,lineageVerifiers,sink,signal}) {
  if(typeof withSourceLock!=='function'||typeof assertSourceWritable!=='function'||!sink) fail('source-lock-and-sink-required');
  return withSourceLock(async()=>{
    await assertSourceWritable();
    const pinned=await sourceWitness(sourceAdapter,sourceManifestFileId),manifest=pinned.manifest;
    await requireCatalogOnlyOriginals(sourceAdapter);
    verificationPlans=withSourceEvidenceVerification(verificationPlans);
    const physical=createPhysicalDriveAdapter(sourceAdapter,{manifestFileId:sourceManifestFileId,assertWritable:assertSourceWritable});
    const captured=capturePhysicalReads(physical);
    const scope=await physical.beginVerification();
    try {
    const semanticScope=verificationPlans?.beginVerification?.();
    try {await new PhysicalRootBinding({adapter:captured.adapter,assertWritable:assertSourceWritable,verificationPlans,lineageVerifiers,verifySourceEvidence:verificationPlans.verifySourceEvidence}).verifyCopy({signal});}
    finally {verificationPlans?.endVerification?.(semanticScope);}
    if(!same(pinned,await sourceWitness(sourceAdapter,sourceManifestFileId))) fail('source-changed');
    const tree=treeFor(captured.adapter,manifest);
    const evidence=await prepareSourceEvidence({captured,pinned,sourceAdapter,manifestFileId:sourceManifestFileId,signal});
    async function* objects() {
      const sentData=new Set();
      for await(const entry of tree.entries(manifest.locatorRoot,{signal})) {
        if(entry.kind==='data-object')sentData.add(entry.sha256);
        yield {hash:entry.sha256,bytes:await tree.readObject(manifest.locatorRoot,{kind:entry.kind,sha256:entry.sha256},{signal}),descriptor:descriptor(entry)};
      }
      for(const [fileId,ref] of evidence.entries) {
        if(sentData.has(ref.sha256))continue;sentData.add(ref.sha256);
        const raw=evidence.prepared.get(ref.sha256)??await captured.adapter.readBytes(fileId,{maxBytes:MAX,signal});
        yield {hash:ref.sha256,bytes:raw,descriptor:{kind:'data-object',identity:ref.sha256}};
      }
      for(const [hash,raw] of evidence.prepared) {if(sentData.has(hash))continue;sentData.add(hash);yield {hash,bytes:raw,descriptor:{kind:'data-object',identity:hash}};}
    }
    const root={profile:'canonical4-physical4',databaseId:manifest.databaseId,sourceCopyId:manifest.copyId,revision:manifest.revision,
      canonical:{version:4,sha256:manifest.root},catalog:null,protocol:{version:4,sha256:manifest.headCommit.sha256},sourceEvidence:{version:1,sha256:evidence.root}};
    await writeFramedBackup({sink,root,objects:objects(),limits:{maxObjectBytes:MAX},signal,beforeSeal:async()=>{
      await assertSourceWritable();
      await requireCatalogOnlyOriginals(sourceAdapter);
      await physical.closeVerification(scope);
      if(!same(pinned,await sourceWitness(sourceAdapter,sourceManifestFileId))) fail('source-changed');
    }});
    return {root};
    } finally {physical.invalidateReadCache();}
  });
}
/** New destination only. Incomplete markers and copied bytes are preserved on
 * failure. A manifest is created exactly once, after complete EOF verification. */
export async function restorePagedCanonicalArchive({source,targetAdapter,withTargetLock,assertTargetWritable,newCopyId=globalThis.crypto.randomUUID(),role='primary',verificationPlans,lineageVerifiers,signal,beforePublish=async()=>{},beforeTargetPreparation=async()=>{}}) {
  if(typeof withTargetLock!=='function'||typeof assertTargetWritable!=='function') fail('target-lock-required');
  verificationPlans=withSourceEvidenceVerification(verificationPlans);
  return withTargetLock(async()=>{
    const staged=new Map();
    let tree,locatorRoot,manifest,root,physical,scope,objectCount=0n;
    const transactionId=globalThis.crypto.randomUUID();
    const guard=async()=>{abort(signal);await assertTargetWritable();};
    const staging={
      async begin(input) {
        root=input.root;
        if(root.profile!=='canonical4-physical4'||newCopyId===root.sourceCopyId||!['primary','backup'].includes(role)) fail('invalid-copy-identity');
        for await(const file of targetAdapter.iterateChildren()) {
          if(!(file.name==='finance-tracker-active-session.json'&&file.appProperties?.financeTrackerSession==='v1')) fail('fresh-destination-required');
        }
        await beforeTargetPreparation();
        await writeExact(targetAdapter,bytes({format:'finance-tracker-v4-copy-preparation',version:1,state:'incomplete',databaseId:root.databaseId,copyId:newCopyId,sourceCopyId:root.sourceCopyId}),
          'copy-preparation',transactionId,guard,signal,'ft-v4-copy-preparation.json');
        physical=createPhysicalDriveAdapter(targetAdapter,{manifestFileId:null,assertWritable:guard});
        scope=await physical.beginVerification();
        tree=createPagedPhysicalLocators(physical,{databaseId:root.databaseId,copyId:newCopyId,folderId:targetAdapter.folderId,assertWritable:guard});
      },
      async write(raw,{descriptor:d}) {
        const hash=await partitionDigest(raw);
        const existing=staged.get(d.kind+':'+hash);
        if(existing) {
          if(!same(descriptor(existing),d)) fail('duplicate-object-identity');
          return hash;
        }
        const ref=await writeExact(targetAdapter,raw,d.kind,d.transactionId??transactionId,guard,signal);
        staged.set(d.kind+':'+hash,{...d,...ref});objectCount++;
        return hash;
      },
      async read(hash,{maxBytes}) {
        for(const kind of ['data-object','commit-record','journal-event','migration-record','protocol-object']) {
          const ref=staged.get(kind+':'+hash);
          if(ref) {
            const before=await physical.readMetadata(ref.fileId,{maxBytes:16384,signal});
            const raw=await physical.readBytes(ref.fileId,{maxBytes,kind:physicalKind(kind),signal});
            const after=await physical.readMetadata(ref.fileId,{maxBytes:16384,signal});
            if(!same(before,after)||before.appProperties?.financeTrackerHash!==hash||before.appProperties?.financeTrackerKind!==physicalKind(kind)||raw.length>maxBytes||await partitionDigest(raw)!==hash)fail('staged-object-mismatch');
            return raw;
          }
        }
        fail('missing-archive-object');
      }
    };
    try {
    await restoreFramedBackup({source,staging,signal,limits:{maxObjectBytes:MAX},verifyStructure:async()=>{
      locatorRoot=await tree.build([...staged.values()].sort((a,b)=>a.kind+':'+a.sha256<b.kind+':'+b.sha256?-1:1),{signal});
      manifest=createPhysicalRootManifest({databaseId:root.databaseId,copyId:newCopyId,folderId:targetAdapter.folderId,provider:'google-drive',role,
        revision:root.revision,root:root.canonical.sha256,headCommit:{format:PORTABLE_COMMIT_FORMAT,version:4,sha256:root.protocol.sha256},locatorRoot,sourceEvidence:root.sourceEvidence});
      if(targetAdapter.provider==='google-drive') manifest.storageBinding.provider='google-drive';
      const head=json(await tree.readObject(locatorRoot,{kind:'commit-record',sha256:root.protocol.sha256},{signal}));
      if(root.sourceEvidence===null) {
        if(head.operation!=='migrate-legacy-v4'||head.revision!=='0'||!head.changeEvidenceRoot)fail('source-evidence-required');
        const origin=json(await tree.readObject(locatorRoot,{kind:'data-object',sha256:head.changeEvidenceRoot},{signal}));
        if(origin.format!==LEGACY_MIGRATION_FORMAT||origin.version!==1||origin.sourceCopyId!==root.sourceCopyId||origin.databaseId!==root.databaseId)fail('source-evidence-required');
      }
      if(root.sourceEvidence){const provenance=json(await tree.readObject(locatorRoot,{kind:'data-object',sha256:root.sourceEvidence.sha256},{signal}));
        if(provenance.sourceCopyId!==root.sourceCopyId||provenance.databaseId!==root.databaseId||provenance.root!==root.canonical.sha256||provenance.headCommit.sha256!==root.protocol.sha256||provenance.revision!==root.revision)fail('source-evidence-binding-mismatch');}
      const semanticScope=verificationPlans?.beginVerification?.();
      try {return await verifyPagedCopy({adapter:physical,manifest,verificationPlans,lineageVerifiers,signal});}
      finally {verificationPlans?.endVerification?.(semanticScope);}
    }});
    await beforePublish();
    await physical.closeVerification(scope);
    await guard();
    const pointer=await writeExact(targetAdapter,bytes(manifest),PAGED_MANIFEST_KIND,transactionId,guard,signal,PAGED_MANIFEST_NAME);
    const reopened=await readManifest(targetAdapter,pointer.fileId);
    if(!same(reopened,manifest)) fail('published-copy-mismatch');
    scope=await physical.beginVerification();
    const semanticScope=verificationPlans?.beginVerification?.();
    try {await verifyPagedCopy({adapter:physical,manifest:reopened,verificationPlans,lineageVerifiers,signal});}
    finally {verificationPlans?.endVerification?.(semanticScope);}
    await physical.closeVerification(scope);
    return {manifest:reopened,manifestFileId:pointer.fileId,objectCount:String(objectCount)};
    } finally {physical?.invalidateReadCache();}
  });
}
/** Direct copy uses backpressure rather than constructing a Blob or JSON archive. */
export async function backupPagedCanonicalCopy(options) {
  if(typeof options.withSourceLock!=='function'||typeof options.assertSourceWritable!=='function') fail('source-lock-required');
  return options.withSourceLock(async()=>{
    const pinned=await sourceWitness(options.sourceAdapter,options.sourceManifestFileId);
    const checkSource=async()=>{
      await options.assertSourceWritable();
      if(!same(pinned,await sourceWitness(options.sourceAdapter,options.sourceManifestFileId))) fail('source-changed');
    };
    const stream=new TransformStream(undefined,{highWaterMark:1},{highWaterMark:0});
    const controller=new AbortController();
    const cancel=()=>controller.abort(options.signal?.reason);
    if(options.signal?.aborted) cancel();else options.signal?.addEventListener('abort',cancel,{once:true});
    const common={...options,withSourceLock:fn=>fn(),signal:controller.signal};
    const exporting=exportPagedCanonicalArchive({...common,sink:stream.writable});
    const restoring=restorePagedCanonicalArchive({...common,source:stream.readable,role:options.role??'backup',
      beforeTargetPreparation:async()=>{await options.beforeTargetPreparation?.();await checkSource();},
      beforePublish:async()=>{await options.beforePublish?.();await checkSource();}});
    exporting.catch(()=>controller.abort());restoring.catch(()=>controller.abort());
    try {const results=await Promise.allSettled([exporting,restoring]);
      const failed=results.find(x=>x.status==='rejected');if(failed) throw failed.reason;
      return results[1].value;
    } finally {options.signal?.removeEventListener('abort',cancel);}
  });
}

export const LEGACY_MIGRATION_FORMAT='finance-tracker-legacy-archive-evidence';
function matchesLegacyManifest(source,portable) {
  const {locatorCatalog,copyPreparationFileId,...logical}=source;
  logical.storageBinding={provider:'portable-archive',folderId:null};
  return same(logical,portable);
}
/** Compatibility boundary: archive2 construction/verification materializes its
 * legacy input. Stored evidence is chunked, so subsequent v4 transport remains
 * bounded and source-independent. No source file ID is rebound or trusted. */
export async function writeLegacyMigrationEvidence({archive,sourceManifest,store,validateStructure,signal}) {
  await verifyCatalogArchive(archive,{validateStructure});
  if(archive.originalImports?.some(item=>item.contentBase64!==null&&item.contentBase64!==undefined)) fail('retained-original-migration-not-supported');
  if(!matchesLegacyManifest(sourceManifest,archive.manifest)||sourceManifest.copyId!==archive.sourceCopyId) fail('migration-source-mismatch');
  const raw=bytes({archive,sourceManifest});
  let next=null;
  // Linked chunks allow bounded traversal without an in-memory hash inventory.
  for(let end=raw.length;end>0;) {
    abort(signal);const start=Math.max(0,end-24000);
    let binary='';for(const byte of raw.subarray(start,end)) binary+=String.fromCharCode(byte);
    next=await store.write(bytes({format:'finance-tracker-legacy-evidence-chunk',version:1,next,base64:btoa(binary)}),{signal});end=start;
  }
  return store.write(bytes({format:LEGACY_MIGRATION_FORMAT,version:1,databaseId:archive.manifest.databaseId,sourceCopyId:archive.sourceCopyId,
    sourceRevision:archive.manifest.revision,sourceManifestHash:await partitionDigest(bytes(sourceManifest)),archiveSha256:archive.archiveSha256,
    payloadSha256:await partitionDigest(raw),payloadBytes:String(raw.length),first:next}),{signal});
}
export async function verifyLegacyMigrationEvidence({evidenceRoot,readObject,validateStructure,signal}) {
  const read=async hash=>{abort(signal);const raw=await readObject({kind:'data-object',sha256:hash});if(raw.length>MAX||await partitionDigest(raw)!==hash) fail('migration-evidence-hash');return json(raw);};
  const evidence=await read(evidenceRoot);
  if(evidence.format!==LEGACY_MIGRATION_FORMAT||evidence.version!==1||!/^\d+$/.test(evidence.payloadBytes)) fail('migration-evidence-format');
  // Legacy decoder already has whole-archive semantics. The exact stated byte
  // length also bounds cycle attacks without a growing visited-hash set.
  const chunks=[];let length=0n,next=evidence.first;
  while(next!==null) {
    const chunk=await read(next);
    if(chunk.format!=='finance-tracker-legacy-evidence-chunk'||chunk.version!==1||typeof chunk.base64!=='string'||chunk.base64.length>32000) fail('migration-chunk-format');
    const binary=atob(chunk.base64),raw=Uint8Array.from(binary,c=>c.charCodeAt(0));
    if(raw.length===0) fail('migration-empty-chunk');
    length+=BigInt(raw.length);if(length>BigInt(evidence.payloadBytes)) fail('migration-length-mismatch');
    chunks.push(raw);next=chunk.next;
  }
  if(length!==BigInt(evidence.payloadBytes)||length>BigInt(Number.MAX_SAFE_INTEGER)) fail('migration-length-mismatch');
  const raw=new Uint8Array(Number(length));let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
  if(await partitionDigest(raw)!==evidence.payloadSha256) fail('migration-payload-mismatch');
  const payload=json(raw),{archive,sourceManifest}=payload;
  if(!matchesLegacyManifest(sourceManifest,archive.manifest)||await partitionDigest(bytes(sourceManifest))!==evidence.sourceManifestHash||archive.archiveSha256!==evidence.archiveSha256||archive.manifest.databaseId!==evidence.databaseId||archive.sourceCopyId!==evidence.sourceCopyId||archive.manifest.revision!==evidence.sourceRevision) fail('migration-source-mismatch');
  if(archive.originalImports?.some(item=>item.contentBase64!==null&&item.contentBase64!==undefined)) fail('retained-original-migration-not-supported');
  const verified=await verifyCatalogArchive(archive,{validateStructure});
  return {...verified,archive,sourceManifest,evidence};
}
/** Decode only the independently verified latest legacy snapshot. Its physical
 * file IDs are ignored: logical snapshot hashes resolve through archive bytes. */
export async function legacyMigrationLedger(verified) {
  const {CanonicalLedgerStore}=await import('./canonical-ledger-storage.mjs');
  const manifest=verified.manifest;
  const readObject=async path=>{
    const hash=manifest.snapshot[path];const raw=verified.objects.get('data-object:'+hash);
    if(!raw) fail('migration-snapshot-missing');return raw;
  };
  const store=new CanonicalLedgerStore({lifecycle:{readManifest:async()=>manifest,readObject,transact:()=>fail('read-only-migration')}});
  return store.load();
}
function* legacyCopyOrigins(verified) {
  for(const m of [verified.manifest,verified.sourceManifest,verified.archive?.manifest]) {
    if(typeof m?.copyId==='string')yield m.copyId;
    if(typeof m?.restoredFromCopyId==='string')yield m.restoredFromCopyId;
  }
  if(typeof verified.archive?.sourceCopyId==='string')yield verified.archive.sourceCopyId;
  if(typeof verified.evidence?.sourceCopyId==='string')yield verified.evidence.sourceCopyId;
  for(const [key,raw] of verified.objects) {
    if(!['journal-event:','migration-record:','commit-record:'].some(prefix=>key.startsWith(prefix))) continue;
    const record=json(raw);
    if(record.eventType==='transaction-started'&&typeof record.payload?.copyId==='string')yield record.payload.copyId;
    if(['finance-tracker-manifest','finance-tracker-commit'].includes(record.format)) {
      if(typeof record.copyId==='string')yield record.copyId;
      if(typeof record.restoredFromCopyId==='string')yield record.restoredFromCopyId;
    }
  }
}
export function assertLegacyCopyIdentity(verified,targetCopyId) {
  if(typeof targetCopyId!=='string'||!targetCopyId) fail('migration-target-identity-required');
  for(const origin of legacyCopyOrigins(verified))if(origin===targetCopyId)fail('invalid-copy-identity');
}

export async function verifyCanonicalMigrationEvidence({manifest,commit,currentLedger,readObject,signal}) {
  if(commit.operation!=='migrate-legacy-v4'||commit.revision!=='0'||!commit.changeEvidenceRoot) fail('migration-commit-mismatch');
  const {validateSyntheticApplicationSnapshot}=await import('./synthetic-application-structure.mjs');
  const verified=await verifyLegacyMigrationEvidence({evidenceRoot:commit.changeEvidenceRoot,readObject,validateStructure:validateSyntheticApplicationSnapshot,signal});
  assertLegacyCopyIdentity(verified,manifest?.copyId);
  if(verified.manifest.databaseId!==commit.databaseId||!same(await legacyMigrationLedger(verified),currentLedger)) fail('migration-latest-ledger-mismatch');
}
/** Explicit fresh-copy compatibility migration, never called by open/connect.
 * Legacy archive and ledger decoding necessarily materialize legacy data. */
export async function migrateLegacyCanonicalCopy(options) {
  const {sourceAdapter,sourceManifestFileId,withSourceLock,assertSourceWritable,signal}=options;
  if(typeof withSourceLock!=='function'||typeof assertSourceWritable!=='function') fail('source-lock-required');
  return withSourceLock(async()=>{
    await assertSourceWritable();
    const {exportCatalogArchive}=await import('./catalog-backup.mjs');
    const {validateSyntheticApplicationSnapshot}=await import('./synthetic-application-structure.mjs');
    const {buildCompactPartitionedCanonicalLedger}=await import('./canonical-partitions.mjs');
    const {EMPTY_CANONICAL_BYTES,PAGED_CANONICAL_VERIFIER}=await import('./paged-canonical-format.mjs');
    await requireCatalogOnlyOriginals(sourceAdapter);
    const sourcePin=await sourceWitness(sourceAdapter,sourceManifestFileId,true),original=sourcePin.manifest;
    if(original.version===4||original.syntheticOnly!==true) fail('legacy-source-required');
    const archive=await exportCatalogArchive({adapter:sourceAdapter,manifestFileId:sourceManifestFileId,withSourceLock:fn=>fn(),validateStructure:validateSyntheticApplicationSnapshot});
    const verified=await verifyCatalogArchive(archive,{validateStructure:validateSyntheticApplicationSnapshot});
    const newCopyId=options.newCopyId??globalThis.crypto.randomUUID();
    assertLegacyCopyIdentity({...verified,archive,sourceManifest:original},newCopyId);
    const ledger=await legacyMigrationLedger(verified), prepared=new Map();
    if(!ledger) fail('canonical-legacy-ledger-required');
    const store={write:async raw=>{abort(signal);if(raw.length>MAX)fail('object-byte-limit');const owned=new Uint8Array(raw),hash=await partitionDigest(owned);prepared.set(hash,owned);return hash;},
      read:async hash=>{const raw=prepared.get(hash);if(!raw)fail('missing-preparation-object');return raw.slice();}};
    const rootHash=ledger?(await buildCompactPartitionedCanonicalLedger(ledger,store,{signal})).rootHash:await store.write(EMPTY_CANONICAL_BYTES);
    const evidenceRoot=await writeLegacyMigrationEvidence({archive,sourceManifest:original,store,validateStructure:validateSyntheticApplicationSnapshot,signal});
    const commit=createPortableLogicalCommit({databaseId:original.databaseId,parent:null,revision:'0',previousRoot:null,root:rootHash,
      transactionId:globalThis.crypto.randomUUID(),operation:'migrate-legacy-v4',semanticVersion:PAGED_CANONICAL_VERIFIER,changeEvidenceRoot:evidenceRoot});
    const rawCommit=bytes(commit),head=await partitionDigest(rawCommit);
    async function* objects(){for(const [hash,raw] of prepared) yield {hash,bytes:raw,descriptor:{kind:'data-object',identity:hash}};
      yield {hash:head,bytes:rawCommit,descriptor:{kind:'commit-record',identity:head}};}
    const root={profile:'canonical4-physical4',databaseId:original.databaseId,sourceCopyId:original.copyId,revision:'0',canonical:{version:4,sha256:rootHash},catalog:null,protocol:{version:4,sha256:head},sourceEvidence:null};
    const source=encodeFramedBackup({root,objects:objects(),limits:{maxObjectBytes:MAX},signal,beforeSeal:async()=>{
      await assertSourceWritable();
      await requireCatalogOnlyOriginals(sourceAdapter);
      if(!same(sourcePin,await sourceWitness(sourceAdapter,sourceManifestFileId,true))) fail('source-changed');
    }});
    const checkSource=async()=>{await assertSourceWritable();await requireCatalogOnlyOriginals(sourceAdapter);if(!same(sourcePin,await sourceWitness(sourceAdapter,sourceManifestFileId,true))) fail('source-changed');};
    return restorePagedCanonicalArchive({...options,newCopyId,source,role:'primary',
      beforeTargetPreparation:async()=>{await options.beforeTargetPreparation?.();await checkSource();},
      beforePublish:async()=>{await options.beforePublish?.();await checkSource();}});
  });
}
