// Read-only compatibility for archived evidence in already-migrated canonical v5 copies.
// These functions accept authenticated archive bytes, never adapters or live folders.
import {CANONICAL_COLLECTIONS} from './canonical-history.mjs';
import {validateLedger} from './canonical-import.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {isMonthIndexPath} from './canonical-month-index.mjs';
import {reassembleCanonicalObjects,FRAGMENT_OBJECT_BYTES} from './legacy-canonical-fragments.mjs';
import {partitionDigest} from './canonical-partitions.mjs';
import {verifyCatalogArchive} from './catalog-backup.mjs';
const MAX=65536,enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const bytes=value=>enc.encode(canonicalizeJcs(value)),json=raw=>JSON.parse(dec.decode(raw));
const same=(a,b)=>canonicalizeJcs(a)===canonicalizeJcs(b);
const abort=signal=>{if(signal?.aborted)throw new DOMException('Evidence verification cancelled.','AbortError');};
const CANONICAL_PREFIX = "synthetic/canonical-v1/";
const CANONICAL_INDEX = CANONICAL_PREFIX + "index.json";


// Position history is optional so historical six-collection ledgers retain
// their exact representation. If present it must be indexed, never metadata.
const REQUIRED_COLLECTIONS = Object.keys(CANONICAL_COLLECTIONS).filter(name => name !== "positionEvents");
function indexCollections(index) {
  const collections = index?.collections;
  if (!collections || typeof collections !== "object" || Array.isArray(collections) ||
      REQUIRED_COLLECTIONS.some(name => !Object.hasOwn(collections, name)) ||
      Object.keys(collections).some(name => !Object.hasOwn(CANONICAL_COLLECTIONS, name) || !Array.isArray(collections[name])) ||
      !index.metadata || typeof index.metadata !== "object" || Array.isArray(index.metadata) ||
      Object.keys(CANONICAL_COLLECTIONS).some(name => Object.hasOwn(index.metadata, name))) {
    fail("invalid-canonical-index", "The canonical index has an invalid collection inventory or embedded collection metadata.");
  }
  return Object.keys(CANONICAL_COLLECTIONS).filter(name => Object.hasOwn(collections, name));
}

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function safeId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    fail("invalid-record-id", "A record has an invalid opaque identity.");
  }
  return value;
}
function recordPath(collection, id) { return CANONICAL_PREFIX + collection + "/" + safeId(id) + ".json"; }

const CANONICAL_GROUP_RECORDS=64;
const groupPath=(collection,ordinal)=>CANONICAL_PREFIX+'chunks/'+collection+'/'+String(ordinal).padStart(6,'0')+'.json';
const legacyGroupPath=groupPath;
function validateFragmentedIndex(index) {
  if (!index || index.format !== "finance-tracker-canonical-index" || index.version !== 3 ||
      index.syntheticOnly !== true || index.metadata?.syntheticOnly !== true ||
      Object.keys(index).sort().join(",") !== "collections,format,groups,metadata,syntheticOnly,version" ||
      !index.collections || !index.groups || typeof index.collections !== "object" || typeof index.groups !== "object") {
    fail("invalid-canonical-index", "The fragmented v3 logical index is invalid.");
  }
  const names = indexCollections(index);
  if (Object.keys(index.collections).length !== names.length || Object.keys(index.groups).length !== names.length ||
      names.some(name => !Array.isArray(index.collections[name]) || !Array.isArray(index.groups[name]))) {
    fail("invalid-canonical-index", "The fragmented v3 group inventory is incomplete.");
  }
  for (const name of names) {
    const ids = index.collections[name];
    ids.forEach(safeId);
    if (new Set(ids).size !== ids.length ||
        index.groups[name].length !== Math.ceil(ids.length / CANONICAL_GROUP_RECORDS) ||
        index.groups[name].some((path, ordinal) => path !== groupPath(name, ordinal))) {
      fail("invalid-canonical-index", "Fragmented v3 group paths or record identities are invalid.");
    }
  }
}

function validateLegacyV3Index(index) {
  const names = indexCollections(index);
  if (!index || index.format !== "finance-tracker-canonical-index" || index.version !== 2 ||
      index.syntheticOnly !== true || index.metadata?.syntheticOnly !== true ||
      Object.keys(index).sort().join(",") !== "chunks,collections,format,metadata,syntheticOnly,version" ||
      !index.collections || !index.chunks || Object.keys(index.collections).length !== names.length ||
      Object.keys(index.chunks).length !== names.length) {
    fail("invalid-canonical-index", "The legacy v3 logical index is invalid.");
  }
  for (const name of names) {
    const ids = index.collections[name], paths = index.chunks[name];
    if (!Array.isArray(ids) || !Array.isArray(paths)) fail("invalid-canonical-index", "The legacy v3 group inventory is incomplete.");
    ids.forEach(safeId);
    if (new Set(ids).size !== ids.length || paths.length !== Math.ceil(ids.length / CANONICAL_GROUP_RECORDS) ||
        paths.some((path, ordinal) => path !== legacyGroupPath(name, ordinal))) {
      fail("invalid-canonical-index", "The legacy v3 group paths or record identities are invalid.");
    }
  }
}

function legacyV3GroupRecords(index, name, ordinal, value) {
  if (value?.format !== "finance-tracker-canonical-chunk" || value.version !== 1 || value.collection !== name ||
      Object.keys(value).sort().join(",") !== "collection,format,records,version" || !Array.isArray(value.records)) {
    fail("invalid-canonical-group", "A legacy v3 logical group has an invalid envelope.");
  }
  const ids = index.collections[name].slice(ordinal * CANONICAL_GROUP_RECORDS, (ordinal + 1) * CANONICAL_GROUP_RECORDS);
  if (value.records.length !== ids.length || value.records.some((record, position) => record?.[CANONICAL_COLLECTIONS[name]] !== ids[position])) {
    fail("canonical-identity-mismatch", "Legacy grouped records do not match their indexed order and identities.");
  }
  return value.records;
}

function groupRecords(index, name, ordinal, value) {
  if (value?.format !== "finance-tracker-canonical-group" || value.version !== 1 || value.collection !== name ||
      Object.keys(value).sort().join(",") !== "collection,format,records,version" || !Array.isArray(value.records)) {
    fail("invalid-canonical-group", "A fragmented v3 canonical group has an invalid envelope.");
  }
  const ids = index.collections[name].slice(ordinal * CANONICAL_GROUP_RECORDS, (ordinal + 1) * CANONICAL_GROUP_RECORDS);
  if (value.records.length !== ids.length || value.records.some((record, position) => record?.[CANONICAL_COLLECTIONS[name]] !== ids[position])) {
    fail("canonical-identity-mismatch", "Grouped records do not match their exact indexed order and identities.");
  }
  return value.records;
}

function validateIndex(index) {
  if (!index || index.format !== "finance-tracker-canonical-index" || index.version !== 1 ||
      index.syntheticOnly !== true || index.metadata?.syntheticOnly !== true ||
      Object.keys(index).sort().join(",") !== "collections,format,metadata,syntheticOnly,version" ||
      !index.collections || typeof index.collections !== "object") {
    fail("invalid-canonical-index", "The canonical index is not a supported synthetic record set.");
  }
  const names = indexCollections(index);
  if (Object.keys(index.collections).length !== names.length || names.some((name) => !Array.isArray(index.collections[name]))) {
    fail("invalid-canonical-index", "The canonical index has an invalid collection inventory.");
  }
  for (const name of names) {
    const ids = index.collections[name];
    ids.forEach(safeId);
    if (new Set(ids).size !== ids.length) fail("duplicate-record-id", "The canonical index repeats an identity.");
  }
}

function validateSnapshotObjects(objects, fragmented) {
  const paths = Object.keys(objects || {}).filter((path) => path.startsWith(CANONICAL_PREFIX));
  if (!paths.length) return null; // Genesis and retained pre-import snapshots.
  if (!Object.hasOwn(objects, CANONICAL_INDEX)) fail("canonical-index-missing", "Canonical history is missing its index.");
  const read = (path) => {
    if (!Object.hasOwn(objects, path)) fail("canonical-record-missing", "A retained snapshot is missing a canonical record.");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(objects[path])); }
    catch { fail("invalid-canonical-object", "A retained canonical object is invalid."); }
  };
  const index = read(CANONICAL_INDEX);
  if (index?.version === 2 && !fragmented) {
    fail("deprecated-canonical-layout", "Standalone grouped canonical storage v2 is no longer supported. Use a fragmented v3 synthetic copy.");
  }
  if (index?.version === 3 && !fragmented) {
    if (!index.fragments) fail("invalid-canonical-fragments", "A fragmented v3 root is missing its physical inventory.");
    const physical = new Map(paths.map(path => {
      if (objects[path].byteLength > FRAGMENT_OBJECT_BYTES) fail("invalid-canonical-fragments", "A physical fragment exceeds its byte limit.");
      return [path, new TextDecoder("utf-8", { fatal: true }).decode(objects[path])];
    }));
    const logical = reassembleCanonicalObjects(index, physical);
    const inner = JSON.parse(logical.get(CANONICAL_INDEX));
    if (inner?.version !== 3 && inner?.version !== 2) fail("invalid-canonical-index", "Fragmented v3 copies require a supported v3 logical index.");
    return validateSnapshotObjects(Object.fromEntries([...logical].map(([path, text]) => [path, new TextEncoder().encode(text)])), true);
  }
  const ledger = {};
  const expected = new Set([CANONICAL_INDEX]);
  if (fragmented && index?.version === 2) {
    validateLegacyV3Index(index);
    Object.assign(ledger, index.metadata);
    for (const name of indexCollections(index)) {
      ledger[name] = index.chunks[name].flatMap((path, ordinal) => {
        expected.add(path);
        return legacyV3GroupRecords(index, name, ordinal, read(path));
      });
    }
  } else if (fragmented && index?.version === 3) {
    validateFragmentedIndex(index);
    Object.assign(ledger, index.metadata);
    for (const name of indexCollections(index)) {
      ledger[name] = index.groups[name].flatMap((path, ordinal) => {
        expected.add(path);
        return groupRecords(index, name, ordinal, read(path));
      });
    }
  } else {
    validateIndex(index);
    Object.assign(ledger, index.metadata);
    for (const name of indexCollections(index)) {
      const idField = CANONICAL_COLLECTIONS[name];
      ledger[name] = index.collections[name].map((id) => {
        const path = recordPath(name, id);
        expected.add(path);
        const value = read(path);
        if (value?.[idField] !== id) fail("canonical-identity-mismatch", "A retained record has the wrong identity.");
        return value;
      });
    }
  }
  if (paths.some((path) => !expected.has(path))) fail("unindexed-canonical-record", "A snapshot contains unindexed canonical records.");
  validateLedger(ledger);
  return ledger;
}


export function validateLegacyApplicationSnapshot({objects}) {
  if(!objects||typeof objects!=='object'||Array.isArray(objects))return false;
  for(const [path,raw] of Object.entries(objects)) {
    if(path.startsWith(CANONICAL_PREFIX)||isMonthIndexPath(path))continue;
    if(path!=='synthetic/dashboard-transactions.json')return false;
    try {
      const value=json(raw);
      if(!(value&&value.format==='finance-tracker-dashboard-snapshot'&&value.syntheticOnly===true&&Array.isArray(value.transactions)&&
        value.transactions.every(row=>row&&row.syntheticOnly===true&&typeof row.id==='string'&&typeof row.date==='string'&&typeof row.description==='string'&&Number.isFinite(row.amount))))return false;
    } catch{return false;}
  }
  validateSnapshotObjects(objects,false);return true;
}
export const LEGACY_MIGRATION_FORMAT='finance-tracker-legacy-archive-evidence';
function matchesLegacyManifest(source,portable) {
  const {locatorCatalog,copyPreparationFileId,...logical}=source;
  logical.storageBinding={provider:'portable-archive',folderId:null};
  return same(logical,portable);
}
export async function verifyLegacyMigrationEvidence({evidenceRoot,readObject,signal}) {
  const read=async hash=>{abort(signal);const raw=await readObject({kind:'data-object',sha256:hash});if(raw.length>MAX||await partitionDigest(raw)!==hash) fail('migration-evidence-hash');return json(raw);};
  const fields=(value,keys,code)=>{
    if((!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))))fail(code);
  };
  const evidence=await read(evidenceRoot);
  // Existing v5 evidence pins every envelope field.
  fields(evidence,['format','version','databaseId','sourceCopyId','sourceRevision','sourceManifestHash','archiveSha256','payloadSha256','payloadBytes','first'],'migration-evidence-format');
  if(evidence.format!==LEGACY_MIGRATION_FORMAT||evidence.version!==1||!/^\d+$/.test(evidence.payloadBytes)) fail('migration-evidence-format');
  if((typeof evidence.payloadBytes!=='string'||!(/^(0|[1-9][0-9]*)$/).test(evidence.payloadBytes)))fail('migration-evidence-format');
  // Legacy decoder already has whole-archive semantics. The exact stated byte
  // length also bounds cycle attacks without a growing visited-hash set.
  const chunks=[];let length=0n,next=evidence.first;
  while(next!==null) {
    const chunk=await read(next);
    fields(chunk,['format','version','next','base64'],'migration-chunk-format');
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
  fields(payload,['archive','sourceManifest'],'migration-payload-format');
  if(!matchesLegacyManifest(sourceManifest,archive.manifest)||await partitionDigest(bytes(sourceManifest))!==evidence.sourceManifestHash||archive.archiveSha256!==evidence.archiveSha256||archive.manifest.databaseId!==evidence.databaseId||archive.sourceCopyId!==evidence.sourceCopyId||archive.manifest.revision!==evidence.sourceRevision) fail('migration-source-mismatch');
  if(archive.originalImports?.some(item=>item.contentBase64!==null&&item.contentBase64!==undefined)) fail('retained-original-migration-not-supported');
  const verified=await verifyCatalogArchive(archive,{validateStructure:validateLegacyApplicationSnapshot});
  return {...verified,archive,sourceManifest,evidence};
}
export async function legacyMigrationLedger(verified) {
  const objects={};
  for(const [path,hash] of Object.entries(verified.manifest.snapshot)) {
    const raw=verified.objects.get('data-object:'+hash);if(!raw)fail('migration-snapshot-missing');objects[path]=raw;
  }
  return validateSnapshotObjects(objects,false);
}
export function* legacyCopyOrigins(verified) {
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
  if(commit.semanticVersion!=='canonical-partitions-v5'||commit.operation!=='migrate-legacy-v5'||commit.revision!=='0'||!commit.changeEvidenceRoot)fail('migration-commit-mismatch');
  const verified=await verifyLegacyMigrationEvidence({evidenceRoot:commit.changeEvidenceRoot,readObject,signal});
  assertLegacyCopyIdentity(verified,manifest?.copyId);
  if(verified.manifest.databaseId!==commit.databaseId||!same(await legacyMigrationLedger(verified),currentLedger))fail('migration-latest-ledger-mismatch');
}
