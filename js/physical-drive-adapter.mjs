import {locatorDecodeProfile,decodeLocatorBytes} from './locator-codec.mjs';
import {copyOwnedBytes} from './byte-ownership.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {partitionDigest} from './canonical-partitions.mjs';
const enc=new TextEncoder(),dec=new TextDecoder();
const encode=x=>enc.encode(canonicalizeJcs(x));
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const same=(a,b)=>canonicalizeJcs(a)===canonicalizeJcs(b);
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
  const cacheBudget=8*1024*1024;
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
  const poison = (code,message) => { clearFacts(); const error=Object.assign(new Error(message),{code}); if(scope){scope.failed=error;resetProofs(scope);} cache.clear();metadata.clear();cacheBytes=0;manifestCache=null; throw error; };
  const validateMetadata = (m,id) => {
    if (!m || m.id!==id || m.trashed!==false || !Array.isArray(m.parents) || !m.parents.includes(adapter.folderId) ||
        typeof m.version!=='string' || !/^[1-9][0-9]*$/.test(m.version) || typeof m.size!=='string' || !/^(0|[1-9][0-9]*)$/.test(m.size)) poison('metadata-mismatch','Physical metadata identity, size or version is invalid.');
    return m;
  };
  const checkScope = async () => {
    if(!scope)return;
    const current=scope;
    if(current.phaseClose)return current.phaseClose;
    current.phaseClosing=true;
    const closing=(async()=>{
      await Promise.all([...current.pending]);
      if(scope!==current||current.closed)fail('verification-scope-closed','Phase changed while draining immutable reads.');
      if(current.failed)throw current.failed;
      const fresh=await adapter.readMetadataSnapshot();
      if(scope!==current||current.closed)fail('verification-scope-closed','Verification scope changed.');
      for(const [id,expected]of current.used) {
        if(!fresh.has(id)||!same(validateMetadata(fresh.get(id),id),expected))fail('verification-metadata-changed','Physical evidence changed during verification.');
      }
      await assertWritable();
      if(scope!==current||current.closed)fail('verification-scope-closed','Verification was invalidated during its final ownership check.');
      if(current.failed)throw current.failed;
      if(adapter.folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed before closure.');
      promoteFacts(current);
      current.opening=fresh;current.used.clear();metadata.clear();resetProofs(current);
    })();
    current.phaseClose=closing;
    try {await closing;}
    catch(error){clearFacts();if(scope===current){current.failed=error;resetProofs(current);}throw error;}
    finally{if(current.phaseClose===closing)current.phaseClose=null;}
  };
  const missing = async fn => { try { return await fn(); } catch(e) {
    clearFacts();manifestCache=null;
    if(scope && !(e?.code === "drive-request-failed" && e.details?.status === 404)) scope.failed=e;
    if (e?.code === 'drive-request-failed' && e.details?.status === 404) fail('object-not-found', 'The exact physical object is absent.'); throw e;
  }};
  const physical = {
    get folderId() { return adapter.folderId; },
    invalidateReadCache() { clearFacts();generation++; manifestCache=null; cache.clear(); metadata.clear(); cacheBytes=0; if(scope){scope.closed=true;resetProofs(scope);} scope=null; },
    async beginVerification() {
      try {
      if(adapter.folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed before opening.');
      if(scope) fail('verification-scope-open','Finish the current verification before starting another.');
      const token=Object.freeze({}), openedAt=generation;
      const opening=await adapter.readMetadataSnapshot();
      if(adapter.folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed while opening.');
      if(openedAt!==generation) fail('verification-scope-closed','Verification was invalidated while opening.');
      if(scope) fail('verification-scope-open','Verification scopes cannot overlap.');
      metadata.clear();
      scope={token,opening,used:new Map(),closed:false,closing:false,phaseClosing:false,phaseClose:null,pending:new Set(),phase:0,proofs:new Map(),proofBytes:0}; return token;
      }catch(error){clearFacts();throw error;}
    },
    async closeVerification(token) {
      if(scope?.token!==token || scope.closed) {clearFacts();fail('verification-scope-closed','Verification scope is closed.');}
      const current=scope; current.closing=true;
      try { await Promise.all([...current.pending]);
        if(scope!==current || current.closed) fail('verification-scope-closed','Verification was invalidated while draining.');
        await checkScope(); }
      catch(error){clearFacts();throw error;}
      finally {current.closed=true;resetProofs(current);if(scope===current)scope=null;metadata.clear();}
    },
    assertVerification(token) { if(scope?.token!==token || scope.closed || scope.closing || scope.phaseClosing) fail('verification-scope-closed','Verification scope is closed.'); },
    trackRead(token,read) {
      if(scope?.token!==token || scope.closed || scope.closing || scope.phaseClosing) fail('verification-scope-closed','Verification scope is closed.');
      const pending=scope.pending; pending.add(read); read.then(()=>pending.delete(read),()=>pending.delete(read));
    },
    allocateFileId: (...args) => adapter.allocateFileId(...args),
    readMetadata: async (id, opts) => {
      try {
      let value;
      if(scope) {
        value=scope.used.get(id) ?? scope.opening.get(id);
        if(!value) value=await missing(() => adapter.readMetadata(id,opts));
        value=structuredClone(value); scope.used.set(id,structuredClone(value));
      } else value=await missing(() => adapter.readMetadata(id, opts));
      validateMetadata(value,id);
      if(opts?.maxBytes !== undefined && encode(value).length>opts.maxBytes) poison('byte-limit','Physical metadata exceeds its requested bound.');
      metadata.delete(id); metadata.set(id,canonicalizeJcs(value));
      while(metadata.size>128) metadata.delete(metadata.keys().next().value);
      return value;
      }catch(error){clearFacts();if(scope&&error?.code!=='object-not-found'){scope.failed=error;resetProofs(scope);}throw error;}
    },
    readBytes: async (id, opts={}) => {
      try {
      const fingerprint=metadata.get(id); metadata.delete(id);
      const hit=cache.get(id);
      if (fingerprint && hit?.fingerprint===fingerprint && hit.bytes.length <= (opts.maxBytes ?? 65536)) {
        cache.delete(id); cache.set(id,hit); return hit.bytes.slice();
      }
      const bytes=ownedBytes(await missing(() => adapter.readBytes(id,opts)),Math.min(opts.maxBytes??65536,65536));
      if (fingerprint && bytes.length<=65536) {
        const evidence=JSON.parse(fingerprint);
        if(evidence.size!==String(bytes.length) || evidence.appProperties?.financeTrackerHash!==await partitionDigest(bytes)) poison('hash-mismatch','Physical bytes do not match metadata before cache admission.');
        if (hit) {cache.delete(id); cacheBytes-=hit.bytes.length;}
        while(cacheBytes+bytes.length>cacheBudget && cache.size) {const key=cache.keys().next().value; cacheBytes-=cache.get(key).bytes.length; cache.delete(key);}
        cache.set(id,{fingerprint,bytes:bytes.slice()}); cacheBytes+=bytes.length;
      }
      return bytes;
      } catch(error) {clearFacts();if(scope){scope.failed=error;resetProofs(scope);}cache.clear();metadata.clear();cacheBytes=0;manifestCache=null;throw error;}
    },
    verifyImmutableObject: input => {
      const current=scope,phase=current?.phase,epoch=generation;
      const operation=(async()=>{
        try {
          const {fileId,sha256,kind,transactionId,folderId=selectedFolderId,maxBytes=65536,signal}=input;
          const maximum=Math.min(maxBytes,65536);
          const live=()=>{
            if(signal?.aborted)throw new DOMException('Immutable verification cancelled.','AbortError');
            if(adapter.folderId!==selectedFolderId||folderId!==selectedFolderId)fail('copy-mismatch','Physical destination changed.');
            if(epoch!==generation || (current && (scope!==current || current.closed || current.phase!==phase)))fail('verification-scope-closed','Immutable verification phase changed.');
            if(current?.failed)throw current.failed;
          };
          live();if(current?.closing||current?.phaseClosing)fail('verification-scope-closed','Verification is closing.');
          if(typeof fileId!=='string'||!fileId||typeof sha256!=='string'||!/^[0-9a-f]{64}$/.test(sha256)||
             !['snapshot-object','commit-record','journal-event','migration-record','protocol-object'].includes(kind)||
             !Number.isSafeInteger(maximum)||maximum<=0)fail('invalid-immutable-query','Expected an exact bounded immutable reference.');
          const validate=m=>{
            validateMetadata(m,fileId);
            if(m.appProperties?.financeTrackerKind!==kind || m.appProperties?.financeTrackerHash!==sha256 ||
               typeof m.appProperties?.financeTrackerTransaction!=='string' ||
               (transactionId!==undefined&&m.appProperties.financeTrackerTransaction!==transactionId))fail('metadata-mismatch','Immutable reference does not match its typed binding.');
            if(BigInt(m.size)>BigInt(maximum))fail('byte-limit','Immutable body exceeds its requested bound.');
            return m;
          };
          const before=validate(await physical.readMetadata(fileId,{maxBytes:16384,signal}));live();
          const fingerprint=canonicalizeJcs(before),key=canonicalizeJcs([selectedFolderId,fileId,kind,before.appProperties.financeTrackerTransaction,sha256]);
          if(current && (current.proofs.get(key)===fingerprint || sessionFacts.get(key)===fingerprint))return {byteLength:Number(before.size)};
          const bytes=ownedBytes(await physical.readBytes(fileId,{kind,maxBytes:maximum,signal}),maximum);live();
          if(String(bytes.length)!==before.size||await partitionDigest(bytes)!==sha256)fail('hash-mismatch','Immutable body failed exact hash/size verification.');
          live();const after=validate(await physical.readMetadata(fileId,{maxBytes:16384,signal}));live();
          if(fingerprint!==canonicalizeJcs(after))fail('version-mismatch','Immutable metadata changed while reading its bytes.');
          // This is the only mint site. No caller supplies a proof or bytes.
          const cost=encode(key).length+encode(fingerprint).length;
          if(current && current.proofs.size<proofEntryBudget && current.proofBytes+cost<=proofByteBudget) {
            current.proofs.set(key,fingerprint);current.proofBytes+=cost;
          }
          return {byteLength:bytes.length};
        } catch(error) {
          clearFacts();
          if(current && scope===current){current.failed=error;resetProofs(current);}
          throw error;
        }
      })();
      if(current){current.pending.add(operation);operation.then(()=>current.pending.delete(operation),()=>current.pending.delete(operation));}
      return operation;
    },
    createImmutable: input => adapter.createImmutable(input),
    readManifest: async (opts = {}) => {
      try {
      const validate = m => {
        if (m.id !== manifestFileId || m.trashed !== false || !Array.isArray(m.parents) || !m.parents.includes(adapter.folderId) ||
            m.name !== PAGED_MANIFEST_NAME || m.appProperties?.financeTrackerKind !== PAGED_MANIFEST_KIND ||
            typeof m.version !== 'string' || typeof m.size !== 'string' || !/^[1-9][0-9]*$/.test(m.version) || !/^(0|[1-9][0-9]*)$/.test(m.size)) fail('manifest-metadata-mismatch','Manifest identity, location or version is invalid.');
        return m;
      };
      const maximum=Math.min(opts.maxBytes ?? 16384,16384);
      if(!Number.isSafeInteger(maximum)||maximum<=0)fail('invalid-response-limits','A finite manifest byte budget is required.');
      const openedAt=generation;
      const before=validate(await adapter.readMetadata(manifestFileId,{...opts,maxBytes:16384}));
      if(opts.signal?.aborted)throw new DOMException('Manifest read cancelled.','AbortError');
      if(openedAt!==generation)fail('verification-scope-closed','Manifest read was invalidated.');
      const fingerprint=canonicalizeJcs(before);
      if(manifestCache?.fingerprint===fingerprint) {
        if(manifestCache.bytes.length>maximum)fail('drive-response-too-large','Manifest exceeds the requested byte budget.');
        return manifestCache.bytes.slice();
      }
      const bytes=ownedBytes(await adapter.readBytes(manifestFileId,{...opts,kind:'manifest',maxBytes:maximum}),maximum);
      const after=validate(await adapter.readMetadata(manifestFileId,{...opts,maxBytes:16384}));
      if(opts.signal?.aborted)throw new DOMException('Manifest read cancelled.','AbortError');
      if (fingerprint!==canonicalizeJcs(after) || before.size!==String(bytes.length)) fail('manifest-version-mismatch','Manifest changed while being read.');
      if(openedAt!==generation)fail('verification-scope-closed','Manifest read was invalidated.');
      manifestCache={fingerprint,bytes:bytes.slice()};
      return bytes;
      } catch(error) { clearFacts();if(scope)scope.failed=error; manifestCache=null;cache.clear();metadata.clear();cacheBytes=0;throw error; }
    },
    writeManifest: async (bytes, opts={}) => {
      const current=scope,epoch=generation;let phase;
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
        const result=await adapter.publishManifest(manifestFileId,JSON.parse(dec.decode(bytes)),{...opts,beforeMutation:async()=>{
          live();await assertWritable();live();await opts.beforeMutation?.();live();
        }});
        live();metadata.clear();
        if(current) {
          const opening=await adapter.readMetadataSnapshot();live();
          current.opening=opening;current.used.clear();resetProofs(current);current.phaseClosing=false;
        }
        return result;
      } catch(error) {clearFacts();if(current&&scope===current){current.failed=error;resetProofs(current);}throw error;}
      finally {manifestCache=null;}

    }
  };
  const locatorDecoder=Object.freeze({invalidate:clearDecoded,decode:input=>{
    const epoch=decodeEpoch,openedAt=generation,current=scope,phase=current?.phase,signal=input.signal;
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
    }catch(error){clearFacts();if(current&&scope===current){current.failed=error;resetProofs(current);}throw error;}
    })();
    if(current){current.pending.add(operation);operation.then(()=>current.pending.delete(operation),()=>current.pending.delete(operation));}
    return operation;
  }});
  ownedLocatorDecoders.set(physical,locatorDecoder);
  ownedBodyVerifiers.set(physical,physical.verifyImmutableObject);
  return Object.freeze(physical);
}
