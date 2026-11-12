import {locatorDecodeProfile,decodeLocatorBytes} from './locator-codec.mjs';
import {copyOwnedBytes} from './byte-ownership.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {partitionDigest} from './canonical-partitions.mjs';
const enc=new TextEncoder(),dec=new TextDecoder();
const encode=x=>enc.encode(canonicalizeJcs(x));
const fail=(code,message,details)=>{throw Object.assign(new Error(message),{code,...(details?{details}: {})});};
const same=(a,b)=>canonicalizeJcs(a)===canonicalizeJcs(b);
const withoutVersion=value=>{const copy={...value};delete copy.version;return copy;};
const sameExceptVersion=(a,b)=>same(withoutVersion(a),withoutVersion(b));
const changedMetadataFields=(expected,actual)=>{
  const fields=[];
  for(const field of ['id','name','mimeType','parents','appProperties','size','version','trashed'])
    if(Object.hasOwn(actual,field)!==Object.hasOwn(expected,field)||
       Object.hasOwn(actual,field)&&!same(actual[field],expected[field]))fields.push(field);
  return fields;
};
const intrinsicByteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get;
function ownedBytes(raw,maximum) {
  let length;try{length=intrinsicByteLength.call(raw);}catch{fail('invalid-bytes','Expected an owned Uint8Array.');}
  if(!(raw instanceof Uint8Array))fail('invalid-bytes','Expected Uint8Array bytes.');
  if(!Number.isSafeInteger(maximum)||maximum<=0||length>maximum)fail('byte-limit','Physical bytes exceed their intrinsic byte budget.');
  try{return copyOwnedBytes(raw);}catch{fail('invalid-bytes','Detached or shared bytes cannot be admitted.');}
}
export const PAGED_MANIFEST_NAME='ft-synthetic-paged-manifest.json';
export const PAGED_MANIFEST_KIND='paged-canonical-manifest';
const ownedBodyVerifiers=new WeakMap(),ownedLocatorDecoders=new WeakMap();
export const getOwnedLocatorDecoder=adapter=>ownedLocatorDecoders.get(adapter)??null;
// Lookup only. There is deliberately no public registration or proof-mint API.
export const getOwnedPhysicalBodyVerifier=adapter=>ownedBodyVerifiers.get(adapter)??null;
// Construct a fixed method snapshot, never register a caller-supplied target or
// verifier. Only factory-owned sources can transfer their existing capability.
export function snapshotPhysicalAdapter(adapter) {
  const view=Object.fromEntries(['readMetadata','readBytes','allocateFileId','createImmutable','readManifest','writeManifest'].map(k=>[k,adapter[k].bind(adapter)]));
  Object.defineProperty(view,'folderId',{get:()=>adapter.folderId});
  const verifier=ownedBodyVerifiers.get(adapter);if(verifier)ownedBodyVerifiers.set(view,verifier);
  const decoder=ownedLocatorDecoders.get(adapter);if(decoder)ownedLocatorDecoders.set(view,decoder);
  return Object.freeze(view);
}

export function createPhysicalDriveAdapter(adapter, {manifestFileId, assertWritable}) {
  // Private finite byte reuse. Metadata is fresh directly or owned by a
  // complete opening/closing verification bracket. Manifest bytes have a
  // separate single-entry cache gated by strict fresh metadata on every read.
  const cache = new Map(), metadata = new Map(); let cacheBytes=0;
  const cacheBudget=8*1024*1024,maxVersionRevalidations=32;
  let scope=null, generation=0, manifestCache=null;
  const proofEntryBudget=512, proofByteBudget=1024*1024, selectedFolderId=adapter.folderId;
  const decodedNodes=new Map();let decodedBytes=0,decodeEpoch=0;
  const clearDecoded=()=>{decodeEpoch++;decodedNodes.clear();decodedBytes=0;};
  const sessionFacts=new Map();let sessionFactBytes=0;
  const clearFacts=()=>{clearDecoded();sessionFacts.clear();sessionFactBytes=0;};
  const factCost=(key,fingerprint)=>encode(key).length+encode(fingerprint).length;
  const promoteFacts=current=>{for(const [key,fingerprint]of current.proofs){
    const old=sessionFacts.get(key),oldCost=old===undefined?0:factCost(key,old);
    const cost=factCost(key,fingerprint);
    if((old!==undefined||sessionFacts.size<proofEntryBudget)&&sessionFactBytes-oldCost+cost<=proofByteBudget){sessionFacts.set(key,fingerprint);sessionFactBytes+=cost-oldCost;}
  }};
  const resetProofs=current=>{if(current){current.proofs.clear();current.proofBytes=0;current.phase++;}};
  // Every awaited read belongs to the scope/phase captured before dispatch.
  // Neither late bytes nor late cleanup may mutate a successor's evidence.
  const capture=()=>({current:scope,epoch:generation,phase:scope?.phase});
  const currentOwner=owner=>owner.epoch===generation&&owner.current===scope&&owner.phase===scope?.phase&&!owner.current?.closed;
  const liveRead=(owner,signal)=>{
    if(signal?.aborted)throw new DOMException('Physical read cancelled.','AbortError');
    if(!currentOwner(owner))fail('verification-scope-closed','Physical read belongs to an expired scope.');
    if(adapter.folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed.');
    if(owner.current?.failed)throw owner.current.failed;
  };
  const poison = (code,message,owner) => {const error=Object.assign(new Error(message),{code});if(currentOwner(owner)){clearFacts();if(owner.current){owner.current.failed=error;resetProofs(owner.current);}cache.clear();metadata.clear();cacheBytes=0;manifestCache=null;}throw error;};
  const validateMetadata = (m,id,owner) => {
    if (!m || m.id!==id || m.trashed!==false || !Array.isArray(m.parents) || !m.parents.includes(adapter.folderId) ||
        typeof m.version!=='string' || !/^[1-9][0-9]*$/.test(m.version) || typeof m.size!=='string' || !/^(0|[1-9][0-9]*)$/.test(m.size)) poison('metadata-mismatch','Physical metadata identity, size or version is invalid.',owner);
    return m;
  };
  const reverifyVersionChange=async(id,expected,owner)=>{
    for(let attempt=0;attempt<3;attempt++) {
      if(attempt)await new Promise(resolve=>setTimeout(resolve,100*attempt));
      liveRead(owner);
      const before=validateMetadata(await adapter.readMetadata(id,{maxBytes:16384}),id,owner);liveRead(owner);
      if(!sameExceptVersion(before,expected))fail('verification-metadata-changed','Physical evidence binding changed during revalidation.',{
        reason:'metadata-changed',fields:changedMetadataFields(expected,before)
      });
      const hash=before.appProperties?.financeTrackerHash;
      if(typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash))fail('verification-metadata-changed','Immutable content hash is unavailable for revalidation.',{
        reason:'content-proof-unavailable'
      });
      const bytes=ownedBytes(await adapter.readBytes(id,{maxBytes:65536}),65536);liveRead(owner);
      const contentMatches=String(bytes.length)===before.size&&await partitionDigest(bytes)===hash;
      const after=validateMetadata(await adapter.readMetadata(id,{maxBytes:16384}),id,owner);liveRead(owner);
      if(!sameExceptVersion(after,expected))fail('verification-metadata-changed','Physical evidence binding changed during revalidation.',{
        reason:'metadata-changed',fields:changedMetadataFields(expected,after)
      });
      if(same(before,after)) {
        if(!contentMatches)fail('hash-mismatch','Physical evidence bytes failed immutable hash revalidation.');
        return after;
      }
    }
    fail('verification-metadata-changed','Drive version kept changing during bounded content revalidation.',{
      reason:'metadata-unstable',fields:['version']
    });
  };
  const checkScope = async () => {
    if(!scope)return;
    const current=scope,owner=capture();
    if(current.phaseClose)return current.phaseClose;
    current.phaseClosing=true;
    const closing=(async()=>{
      await Promise.all([...current.pending]);
      if(scope!==current||current.closed)fail('verification-scope-closed','Phase changed while draining immutable reads.');
      if(current.failed)throw current.failed;
      const fresh=await adapter.readMetadataSnapshot();
      if(scope!==current||current.closed)fail('verification-scope-closed','Verification scope changed.');
      for(const [id,expected]of current.used) {
        if(!fresh.has(id))fail('verification-metadata-changed','Physical evidence changed during verification.',{reason:'object-missing'});
        const actual=validateMetadata(fresh.get(id),id,owner);
        if(!same(actual,expected)) {
          const fields=changedMetadataFields(expected,actual);
          if(fields.length===1&&fields[0]==='version') {
            if(current.versionRevalidations>=maxVersionRevalidations)fail('verification-metadata-changed','Too many version-only changes required content revalidation.',{
              reason:'revalidation-limit',fields:['version']
            });
            current.versionRevalidations++;
            const reverified=await reverifyVersionChange(id,actual,owner);
            fresh.set(id,reverified);current.used.set(id,structuredClone(reverified));
            current.proofs.clear();current.proofBytes=0;
            continue;
          }
          fail('verification-metadata-changed','Physical evidence changed during verification.',{reason:'metadata-changed',fields});
        }
      }
      await assertWritable();
      if(scope!==current||current.closed)fail('verification-scope-closed','Verification was invalidated during its final ownership check.');
      if(current.failed)throw current.failed;
      if(adapter.folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed before closure.');
      promoteFacts(current);
      current.opening=fresh;current.used.clear();metadata.clear();resetProofs(current);current.versionRevalidations=0;
    })();
    current.phaseClose=closing;
    try {await closing;}
    catch(error){if(currentOwner(owner)){clearFacts();current.failed=error;resetProofs(current);}throw error;}
    finally{if(current.phaseClose===closing)current.phaseClose=null;}
  };
  const missing = async (fn,owner) => {try {const result=await fn();liveRead(owner);return result;}catch(error){
    if(currentOwner(owner)){clearFacts();manifestCache=null;
      if(owner.current&&!(error?.code==='drive-request-failed'&&error.details?.status===404))owner.current.failed=error;
    }
    if(error?.code==='drive-request-failed'&&error.details?.status===404)fail('object-not-found','The exact physical object is absent.');
    throw error;
  }};
  const physical = {
    get folderId() { return adapter.folderId; },
    invalidateReadCache() { clearFacts();generation++; manifestCache=null; cache.clear(); metadata.clear(); cacheBytes=0; if(scope){scope.closed=true;resetProofs(scope);} scope=null; },
    async beginVerification() {
      let owner=capture();
      try {
      if(adapter.folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed before opening.');
      if(scope) fail('verification-scope-open','Finish the current verification before starting another.');
      // Also distinguish null-scope reads across a complete intervening scope.
      generation++;owner=capture();
      const token=Object.freeze({}), openedAt=generation;
      const opening=await adapter.readMetadataSnapshot();
      if(adapter.folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed while opening.');
      if(openedAt!==generation) fail('verification-scope-closed','Verification was invalidated while opening.');
      if(scope) fail('verification-scope-open','Verification scopes cannot overlap.');
      metadata.clear();
      scope={token,opening,used:new Map(),closed:false,closing:false,phaseClosing:false,phaseClose:null,pending:new Set(),phase:0,proofs:new Map(),proofBytes:0,versionRevalidations:0}; return token;
      }catch(error){if(currentOwner(owner))clearFacts();throw error;}
    },
    async closeVerification(token) {
      if(scope?.token!==token || scope.closed) {fail('verification-scope-closed','Verification scope is closed.');}
      const current=scope,owner=capture(); current.closing=true;
      try { await Promise.all([...current.pending]);
        if(scope!==current || current.closed) fail('verification-scope-closed','Verification was invalidated while draining.');
        await checkScope(); }
      catch(error){if(currentOwner(owner))clearFacts();throw error;}
      finally {current.closed=true;resetProofs(current);if(scope===current&&owner.epoch===generation){scope=null;metadata.clear();}}
    },
    // Publication changes phases inside one scope. It must not revive a scope
    // that was closed, failed, invalidated or moved to another physical copy.
    captureVerificationLifetime(token) {
      const current=scope,epoch=generation;
      if(token!==undefined&&current?.token!==token)fail('verification-scope-closed','Verification token is not current.');
      return ()=>{
        if(epoch!==generation||scope!==current||current?.closed||current?.closing)fail('verification-scope-closed','Verification lifetime is closed.');
        if(adapter.folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed.');
        if(current?.failed)throw current.failed;
      };
    },
    assertVerification(token) { if(scope?.token!==token || scope.closed || scope.closing || scope.phaseClosing) fail('verification-scope-closed','Verification scope is closed.'); },
    trackRead(token,read) {
      if(scope?.token!==token || scope.closed || scope.closing || scope.phaseClosing) fail('verification-scope-closed','Verification scope is closed.');
      const pending=scope.pending; pending.add(read); read.then(()=>pending.delete(read),()=>pending.delete(read));
    },
    allocateFileId: (...args) => adapter.allocateFileId(...args),
    readMetadata: async (id, opts) => {
      const owner=capture(),current=owner.current;
      try {
      liveRead(owner,opts?.signal);let value;
      if(current) {
        value=current.used.get(id)??current.opening.get(id);
        if(!value)value=await missing(()=>adapter.readMetadata(id,opts),owner);
        liveRead(owner,opts?.signal);value=structuredClone(value);current.used.set(id,structuredClone(value));
      } else {value=await missing(()=>adapter.readMetadata(id,opts),owner);liveRead(owner,opts?.signal);}
      validateMetadata(value,id,owner);
      if(opts?.maxBytes !== undefined && encode(value).length>opts.maxBytes) poison('byte-limit','Physical metadata exceeds its requested bound.',owner);
      metadata.delete(id); metadata.set(id,canonicalizeJcs(value));
      while(metadata.size>128) metadata.delete(metadata.keys().next().value);
      return value;
      }catch(error){if(currentOwner(owner)){clearFacts();if(current&&error?.code!=='object-not-found'){current.failed=error;resetProofs(current);}}throw error;}
    },
    readBytes: async (id, opts={}) => {
      const owner=capture(),current=owner.current;
      try {
      liveRead(owner,opts.signal);
      const fingerprint=metadata.get(id); metadata.delete(id);
      const hit=cache.get(id);
      if (fingerprint && hit?.fingerprint===fingerprint && hit.bytes.length <= (opts.maxBytes ?? 65536)) {
        cache.delete(id); cache.set(id,hit); return hit.bytes.slice();
      }
      const bytes=ownedBytes(await missing(() => adapter.readBytes(id,opts),owner),Math.min(opts.maxBytes??65536,65536));
      liveRead(owner,opts.signal);
      if (fingerprint && bytes.length<=65536) {
        const evidence=JSON.parse(fingerprint);
        const sha256=await partitionDigest(bytes);liveRead(owner,opts.signal);
        if(evidence.size!==String(bytes.length)||evidence.appProperties?.financeTrackerHash!==sha256)poison('hash-mismatch','Physical bytes do not match metadata before cache admission.',owner);
        if (hit) {cache.delete(id); cacheBytes-=hit.bytes.length;}
        while(cacheBytes+bytes.length>cacheBudget && cache.size) {const key=cache.keys().next().value; cacheBytes-=cache.get(key).bytes.length; cache.delete(key);}
        cache.set(id,{fingerprint,bytes:bytes.slice()}); cacheBytes+=bytes.length;
      }
      return bytes;
      } catch(error) {if(currentOwner(owner)){clearFacts();if(current){current.failed=error;resetProofs(current);}cache.clear();metadata.clear();cacheBytes=0;manifestCache=null;}throw error;}
    },
    verifyImmutableObject: input => {
      const owner=capture(),current=owner.current;
      const operation=(async()=>{
        try {
          const {fileId,sha256,kind,transactionId,folderId=selectedFolderId,maxBytes=65536,signal}=input;
          const maximum=Math.min(maxBytes,65536);
          const live=()=>{
            if(signal?.aborted)throw new DOMException('Immutable verification cancelled.','AbortError');
            if(adapter.folderId!==selectedFolderId||folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed.');
            if(!currentOwner(owner))fail('verification-scope-closed','Immutable verification phase changed.');
            if(current?.failed)throw current.failed;
          };
          live();if(current?.closing||current?.phaseClosing)fail('verification-scope-closed','Verification is closing.');
          if(typeof fileId!=='string'||!fileId||typeof sha256!=='string'||!/^[0-9a-f]{64}$/.test(sha256)||
             !['snapshot-object','commit-record','journal-event','migration-record','protocol-object'].includes(kind)||
             !Number.isSafeInteger(maximum)||maximum<=0)fail('invalid-immutable-query','Expected an exact bounded immutable reference.');
          const validate=m=>{
            validateMetadata(m,fileId,owner);
            if(m.appProperties?.financeTrackerKind!==kind || m.appProperties?.financeTrackerHash!==sha256 ||
               typeof m.appProperties?.financeTrackerTransaction!=='string' ||
               (transactionId!==undefined&&m.appProperties.financeTrackerTransaction!==transactionId))fail('metadata-mismatch','Immutable reference does not match its typed binding.');
            if(BigInt(m.size)>BigInt(maximum))fail('byte-limit','Immutable body exceeds its requested bound.');
            return m;
          };
          let before=validate(await physical.readMetadata(fileId,{maxBytes:16384,signal}));live();
          let fingerprint=canonicalizeJcs(before);
          const key=canonicalizeJcs([selectedFolderId,fileId,kind,before.appProperties.financeTrackerTransaction,sha256]);
          let bytes,stable=false;
          if(current && (current.proofs.get(key)===fingerprint || sessionFacts.get(key)===fingerprint))return {byteLength:Number(before.size)};
          for(let attempt=0;attempt<3;attempt++) {
            if(attempt)await new Promise(resolve=>setTimeout(resolve,100*attempt));
            live();before=validate(await physical.readMetadata(fileId,{maxBytes:16384,signal}));live();
            fingerprint=canonicalizeJcs(before);
            bytes=ownedBytes(await physical.readBytes(fileId,{kind,maxBytes:maximum,signal}),maximum);live();
            const contentMatches=String(bytes.length)===before.size&&await partitionDigest(bytes)===sha256;
            live();const after=validate(await physical.readMetadata(fileId,{maxBytes:16384,signal}));live();
            if(fingerprint!==canonicalizeJcs(after)) {
              if(sameExceptVersion(before,after))continue;
              fail('verification-metadata-changed','Immutable metadata binding changed while reading its bytes.',{
                reason:'metadata-changed',fields:changedMetadataFields(before,after)
              });
            }
            if(!contentMatches)fail('hash-mismatch','Immutable body failed exact hash/size verification.');
            before=after;stable=true;break;
          }
          if(!stable)fail('version-mismatch','Drive version did not settle across bounded immutable-byte revalidation.');
          // This is the only mint site. No caller supplies a proof or bytes.
          const cost=encode(key).length+encode(fingerprint).length;
          if(current && current.proofs.size<proofEntryBudget && current.proofBytes+cost<=proofByteBudget) {
            current.proofs.set(key,fingerprint);current.proofBytes+=cost;
          }
          return {byteLength:bytes.length};
        } catch(error) {
          if(currentOwner(owner)){clearFacts();if(current){current.failed=error;resetProofs(current);}}
          throw error;
        }
      })();
      if(current){current.pending.add(operation);operation.then(()=>current.pending.delete(operation),()=>current.pending.delete(operation));}
      return operation;
    },
    createImmutable: input => adapter.createImmutable(input),
    readManifest: async (opts = {}) => {
      const owner=capture();
      try {
      liveRead(owner,opts.signal);
      const validate = m => {
        if (m.id !== manifestFileId || m.trashed !== false || !Array.isArray(m.parents) || !m.parents.includes(adapter.folderId) ||
            m.name !== PAGED_MANIFEST_NAME || m.appProperties?.financeTrackerKind !== PAGED_MANIFEST_KIND ||
            typeof m.version !== 'string' || typeof m.size !== 'string' || !/^[1-9][0-9]*$/.test(m.version) || !/^(0|[1-9][0-9]*)$/.test(m.size)) fail('manifest-metadata-mismatch','Manifest identity, location or version is invalid.');
        return m;
      };
      const maximum=Math.min(opts.maxBytes ?? 16384,16384);
      if(!Number.isSafeInteger(maximum)||maximum<=0)fail('invalid-response-limits','A finite manifest byte budget is required.');
      let before=validate(await adapter.readMetadata(manifestFileId,{...opts,maxBytes:16384}));liveRead(owner,opts.signal);
      if(opts.signal?.aborted)throw new DOMException('Manifest read cancelled.','AbortError');
      liveRead(owner,opts.signal);
      let fingerprint=canonicalizeJcs(before);
      if(manifestCache?.fingerprint===fingerprint) {
        if(manifestCache.bytes.length>maximum)fail('drive-response-too-large','Manifest exceeds the requested byte budget.');
        return manifestCache.bytes.slice();
      }
      for(let attempt=0;attempt<3;attempt++) {
        if(attempt) {
          await new Promise(resolve=>setTimeout(resolve,100*attempt));liveRead(owner,opts.signal);
          before=validate(await adapter.readMetadata(manifestFileId,{...opts,maxBytes:16384}));liveRead(owner,opts.signal);
          fingerprint=canonicalizeJcs(before);
        }
        const bytes=ownedBytes(await adapter.readBytes(manifestFileId,{...opts,kind:'manifest',maxBytes:maximum}),maximum);liveRead(owner,opts.signal);
        const after=validate(await adapter.readMetadata(manifestFileId,{...opts,maxBytes:16384}));liveRead(owner,opts.signal);
        if(opts.signal?.aborted)throw new DOMException('Manifest read cancelled.','AbortError');
        const metadataChanged=fingerprint!==canonicalizeJcs(after), contentSizeMismatch=before.size!==String(bytes.length);
        if(!metadataChanged&&!contentSizeMismatch) {
          manifestCache={fingerprint,bytes:bytes.slice()};
          return bytes;
        }
        const fields=changedMetadataFields(before,after);
        if(metadataChanged&&fields.length===1&&fields[0]==='version') {
          before=after;
          if(attempt<2)continue;
          fail('manifest-version-mismatch','Drive version did not settle across bounded manifest-read retries.',{
            reason:'metadata-unstable',fields:['version']
          });
        }
        fail('manifest-version-mismatch','Manifest changed while being read.',{
          reason:metadataChanged?(contentSizeMismatch?'metadata-and-size-mismatch':'metadata-changed'):'content-size-mismatch'
        });
      }
      fail('manifest-version-mismatch','Manifest did not pass bounded stable-read verification.',{reason:'metadata-unstable'});
      } catch(error) {if(currentOwner(owner)){clearFacts();if(owner.current)owner.current.failed=error;manifestCache=null;cache.clear();metadata.clear();cacheBytes=0;}throw error;}
    },
    writeManifest: async (bytes, opts={}) => {
      const current=scope,epoch=generation;let phase,publicationMayHaveDispatched=false,publisherEntered=false,firstGuardRejected=false;
      const live=()=>{
        if(opts.signal?.aborted)throw new DOMException('Manifest publication cancelled.','AbortError');
        if(adapter.folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed.');
        if(epoch!==generation||scope!==current||current?.closed||(phase!==undefined&&current.phase!==phase))fail('verification-scope-closed','Publication verification phase changed.');
        if(current?.failed)throw current.failed;
      };
      manifestCache=null;
      try {
        live();await checkScope();live();phase=current?.phase;
        await assertWritable();live();
        publisherEntered=true;
        const result=await adapter.publishManifest(manifestFileId,JSON.parse(dec.decode(bytes)),{...opts,beforeMutation:async()=>{
          try {live();await assertWritable();live();await opts.beforeMutation?.();live();}
          catch(error){if(!publicationMayHaveDispatched)firstGuardRejected=true;throw error;}
          // A conforming publisher cannot dispatch until this complete guard
          // succeeds. Keep uncertainty sticky across later retry rejections.
          publicationMayHaveDispatched=true;
        }});
        publicationMayHaveDispatched=true;
        live();metadata.clear();
        if(current) {
          const opening=await adapter.readMetadataSnapshot();live();
          current.opening=opening;current.used.clear();resetProofs(current);current.phaseClosing=false;current.versionRevalidations=0;
        }
        return result;
      } catch(error) {
        // A publication past its complete guard may have changed authority even when
        // its caller expired. Do not preserve a successor's cached evidence.
        if(publicationMayHaveDispatched||publisherEntered&&!firstGuardRejected||epoch===generation&&scope===current)clearFacts();
        if(epoch===generation&&scope===current&&current){current.failed=error;resetProofs(current);}
        throw error;
      }finally{if(publicationMayHaveDispatched||publisherEntered&&!firstGuardRejected||epoch===generation&&scope===current)manifestCache=null;}

    }
  };
  const locatorDecoder=Object.freeze({invalidate:clearDecoded,captureRead:()=>{
    const owner=capture(),epoch=decodeEpoch;
    return Object.freeze({assertCurrent:()=>liveRead(owner),invalidate:()=>{if(currentOwner(owner)&&epoch===decodeEpoch)clearDecoded();}});
  },decode:input=>{
    const owner=capture(),epoch=decodeEpoch,openedAt=owner.epoch,current=owner.current,phase=owner.phase,signal=input.signal;
    const operation=(async()=>{
    const live=()=>{
      if(signal?.aborted)throw new DOMException('Locator decode cancelled.','AbortError');
      if(epoch!==decodeEpoch||openedAt!==generation||adapter.folderId!==selectedFolderId||scope!==current||current?.closed||current?.failed||(current&&current.phase!==phase))fail('verification-scope-closed','Locator decoder was invalidated.');
    };
    try {
      live();if(current?.phaseClosing)fail('verification-scope-closed','Locator verification is closing.');const profile=locatorDecodeProfile(input.profile),maximum=profile.schema==='root'?16384:profile.maxNodeBytes;
      const bytes=ownedBytes(input.bytes,maximum),expected=input.sha256;
      if(typeof expected!=='string'||!/^[0-9a-f]{64}$/.test(expected))fail('invalid-hash','Expected exact locator hash.');
      if(await partitionDigest(bytes)!==expected)fail('hash-mismatch','Locator decode bytes do not match their hash.');live();
      const key=canonicalizeJcs([expected,profile]),hit=decodedNodes.get(key);
      if(hit){decodedNodes.delete(key);decodedNodes.set(key,hit);return structuredClone(hit.value);}
      const value=decodeLocatorBytes(bytes,profile);live();
      const owned=structuredClone(value),cost=bytes.length;
      while(decodedNodes.size>=128||decodedBytes+cost>2*1024*1024){const first=decodedNodes.keys().next().value;if(first===undefined)break;decodedBytes-=decodedNodes.get(first).cost;decodedNodes.delete(first);}
      if(cost<=2*1024*1024){decodedNodes.set(key,{value:owned,cost});decodedBytes+=cost;}
      return structuredClone(owned);
    }catch(error){if(currentOwner(owner)&&epoch===decodeEpoch){clearFacts();if(current){current.failed=error;resetProofs(current);}}throw error;}
    })();
    if(current){current.pending.add(operation);operation.then(()=>current.pending.delete(operation),()=>current.pending.delete(operation));}
    return operation;
  }});
  ownedLocatorDecoders.set(physical,locatorDecoder);
  ownedBodyVerifiers.set(physical,physical.verifyImmutableObject);
  return Object.freeze(physical);
}
