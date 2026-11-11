import {canonicalizeJcs} from './transaction-protocol.mjs';
import {buildCompactPartitionedCanonicalLedger,partitionDigest,createPartitionObjectIO} from './canonical-partitions.mjs';
import {createCanonicalPartitionReader} from './canonical-partition-reader.mjs';
import {createCanonicalMonthIndex} from './canonical-month-index.mjs';
import {validateLedger} from './canonical-import.mjs';
import {assertCanonicalLedgerTransition} from './canonical-history.mjs';
import {PAGED_CANONICAL_LAYOUT,PAGED_CANONICAL_VERIFIER,isEmptyCanonicalRoot} from './paged-canonical-format.mjs';

const fail = code => { throw Object.assign(new Error(code),{code}); };
const same = (a,b) => canonicalizeJcs(a) === canonicalizeJcs(b);

/** The current workspace requires a complete ledger. This is a materializing
 * semantic audit, not a bounded-memory audit. Explicit expansion budgets protect
 * one requested record; no record-count/database-size ceiling is configured. */
export async function readVerifiedPartitionedLedger(store,rootHash,{signal} = {}) {
  const root = await createPartitionObjectIO(store).read(rootHash,{signal});
  if (isEmptyCanonicalRoot(root)) return {ledger:null,reader:null};
  const reader = await createCanonicalPartitionReader(store,rootHash,{signal});
  const result = await reader.fullAudit({signal,maxRecords:Number.MAX_SAFE_INTEGER});
  if (result.verification.source !== 'full-ledger-validated' || result.verification.derived !== 'semantic-verified') fail('canonical-derived-mismatch');
  return {ledger:result.ledger,reader,valueCodec:root.valueCodec??null};
}

/** Each retained logical edge must preserve immutable evidence. Individually
 * valid historical snapshots alone cannot establish append-only history. */
async function verifyCanonicalCommit({manifest,commit,readObject,readBaseObject,signal,verifyMigrationEvidence},auditLedger) {
  if (commit.semanticVersion !== PAGED_CANONICAL_VERIFIER || commit.root !== manifest.root) fail('canonical-commit-mismatch');
  const store = {read:(hash,options) => readObject({kind:'data-object',sha256:hash},options)};
  const current = await auditLedger(store,commit.root,{signal});
  if (commit.revision === '0') {
    if (commit.previousRoot !== null) fail('canonical-genesis-mismatch');
    if (commit.operation === 'migrate-legacy-v4') {
      if (!current.ledger || !commit.changeEvidenceRoot || typeof verifyMigrationEvidence !== 'function') fail('migration-verifier-required');
      await verifyMigrationEvidence({manifest,commit,currentLedger:current.ledger,readObject,signal});
    } else if (commit.operation !== 'genesis' || current.ledger !== null || commit.changeEvidenceRoot !== null) fail('canonical-genesis-mismatch');
    return;
  }
  if (commit.operation !== 'synthetic-canonical-import' || commit.changeEvidenceRoot !== null || commit.previousRoot === null) fail('canonical-commit-mismatch');
  if (commit.previousRoot !== null) {
    const previousStore = {read:(hash,options) => (readBaseObject ?? readObject)({kind:'data-object',sha256:hash},options)};
    const previous = await auditLedger(previousStore,commit.previousRoot,{signal});
    assertCanonicalLedgerTransition(previous.ledger,current.ledger);
  } else if (commit.revision !== '0') fail('canonical-genesis-mismatch');
}
export function verifyPartitionedCanonicalCommit(input) {
  return verifyCanonicalCommit(input,readVerifiedPartitionedLedger);
}

/** The lifecycle may reuse exact semantic results only inside its owned
 * physical verification scope. It still verifies every referenced body's bytes
 * and freshly closes metadata witnesses before publication/authority. No proof
 * or cached ledger can be supplied by the caller, and no result escapes here. */
export function canonicalPartitionVerificationPlans({verifyMigrationEvidence} = {}) {
  let active=null;
  const audited=new Map();
  const verifiedEdges=new Map();
  const auditLedger=async(store,rootHash,options,owner)=>{
    if(owner&&active===owner&&audited.has(rootHash)) {
      const result=audited.get(rootHash);audited.delete(rootHash);audited.set(rootHash,result);return result;
    }
    const result=await readVerifiedPartitionedLedger(store,rootHash,options);
    if(options?.signal?.aborted)throw new DOMException('Verification cancelled.','AbortError');
    if(owner&&active===owner&&result.ledger!==null) {
      // Null genesis sentinels are checked normally but do not occupy either
      // materialized-ledger slot or displace an expensive current/previous root.
      // The app already materializes a ledger; retain at most the two roots
      // needed for one immutable edge. This is not a total database limit.
      audited.set(rootHash,result);
      while(audited.size>2)audited.delete(audited.keys().next().value);
    }
    return result;
  };
  const verify=async input=>{
    const owner=active;
    // A successful immutable edge proof avoids repeating complete ledger
    // materialization at each physical publication phase. The physical engine
    // still visits every retained body and verifies every binding on each pass.
    // Migration evidence depends on the destination identity and stays fresh.
    try {
      // Own the proof's complete input before its first asynchronous read. A
      // caller mutation must not make the audited edge differ from its key.
      input={...input,manifest:structuredClone(input.manifest),commit:JSON.parse(canonicalizeJcs(input.commit))};
      if(input.signal?.aborted)throw new DOMException('Verification cancelled.','AbortError');
      if(input.commit.root!==input.manifest.root)fail('canonical-commit-mismatch');
      const key=owner&&input.commit.operation!=='migrate-legacy-v4'?canonicalizeJcs(input.commit):null;
      if(key&&verifiedEdges.has(key))return;
      await verifyCanonicalCommit({...input,verifyMigrationEvidence},(store,hash,options)=>auditLedger(store,hash,options,owner));
      if(input.signal?.aborted)throw new DOMException('Verification cancelled.','AbortError');
      if(key&&active===owner){verifiedEdges.set(key,true);while(verifiedEdges.size>128)verifiedEdges.delete(verifiedEdges.keys().next().value);}
    } catch(error) {
      if(active===owner){active=null;audited.clear();verifiedEdges.clear();}
      throw error;
    }
  };
  const plans=new Map([[PAGED_CANONICAL_VERIFIER,verify]]);
  Object.defineProperties(plans,{
    beginVerification:{value:()=>{if(active)fail('semantic-scope-open');audited.clear();verifiedEdges.clear();active=Object.freeze({});return active;}},
    endVerification:{value:owner=>{if(owner!==active)return;active=null;audited.clear();verifiedEdges.clear();}}
  });
  return plans;
}

/** Actual application adapter for canonical v4. The physical lifecycle owns
 * session checks, publication, retained-history verification and recovery. */
export class PagedCanonicalLedgerStore {
  constructor({lifecycle,cryptoImpl = globalThis.crypto}) {
    if (!lifecycle?.pagedCanonical || typeof lifecycle.readPartitionedSnapshot !== 'function' ||
        typeof lifecycle.savePartitionedRoot !== 'function') fail('paged-lifecycle-required');
    this.lifecycle=lifecycle;this.crypto=cryptoImpl;this.layout=PAGED_CANONICAL_LAYOUT;
    this.base=null;this.ledger=null;this.reader=null;this.valueCodec=null;this.monthIndex=null;this.monthIndexStatus='missing';this.busy=false;
  }
  async load() {
    if(this.busy) fail('operation-in-progress');this.busy=true;
    try{return await this.loadVerified();}finally{this.busy=false;}
  }
  async loadVerified() {
    this.base=null;this.reader=null;this.monthIndex=null;
    const snapshot=await this.lifecycle.readPartitionedSnapshot();
    const result=await readVerifiedPartitionedLedger(snapshot.store,snapshot.rootHash);
    // Do not retain a stale writable baseline when ownership or the root changes
    // while the application materializes its view.
    await this.lifecycle.assertCurrentManifest(snapshot.manifest);
    this.base=structuredClone(snapshot.manifest);this.ledger=result.ledger;this.reader=result.reader;this.valueCodec=result.valueCodec??null;
    this.monthIndex=result.ledger?createCanonicalMonthIndex(result.ledger):null;
    this.monthIndexStatus=result.ledger?'verified':'missing';
    return structuredClone(result.ledger);
  }
  async save(input) {
    if(this.busy) fail('operation-in-progress');
    if(!this.base) fail('verified-base-required');
    const ledger=structuredClone(input);validateLedger(ledger);assertCanonicalLedgerTransition(this.ledger,ledger);
    this.busy=true;
    try {
      if(same(ledger,this.ledger)) {await this.lifecycle.assertCurrentManifest(this.base);return structuredClone(this.ledger);}
      // Preparation is private memory until the lifecycle durably stages exact
      // fixed-ID bodies. A lost tab must not be needed to recover publication.
      const prepared=new Map();
      const preparationStore={
        read:async hash=>{const raw=prepared.get(hash);if(!raw)fail('missing-preparation-object');return raw.slice();},
        write:async raw=>{const owned=new Uint8Array(raw),hash=await partitionDigest(owned);prepared.set(hash,owned);return hash;}
      };
      const {rootHash}=await buildCompactPartitionedCanonicalLedger(ledger,preparationStore);
      const descriptors=[...prepared].map(([sha256,raw])=>({kind:'data-object',identity:sha256,sha256,byteLength:raw.length}))
        .sort((a,b)=>a.sha256<b.sha256?-1:a.sha256>b.sha256?1:0);
      const expectedBase=this.base;
      await this.lifecycle.assertCurrentManifest(expectedBase);
      this.base=null;
      await this.lifecycle.savePartitionedRoot({expectedBase,rootHash,objects:descriptors,preparationStore,
        semanticVersion:PAGED_CANONICAL_VERIFIER,operation:'synthetic-canonical-import',transactionId:this.crypto.randomUUID()});
      const verified=await this.loadVerified();
      if(!same(verified,ledger)){this.base=null;fail('canonical-readback-mismatch');}
      return verified;
    }finally{this.busy=false;}
  }
}
