import {validateLedger} from './canonical-import.mjs';
import {monthBounds} from './financial-position-contract.mjs';
import {PARTITION_COLLECTIONS,createPartitionObjectIO,createPartitionValueCodec,validatePartitionRoot,
  validatePartitionSource,validatePartitionDerived,validatePartitionCollection,
  partitionFields,partitionOptions,partitionAbort,partitionFail,partitionCount,partitionOrdinal,
  partitionLimit,partitionDigest,buildPartitionDerived} from './canonical-partitions.mjs';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const checkId = id => { if (typeof id !== 'string' || !ID.test(id)) partitionFail('invalid-partition-record-id'); };
const range = prefix => ({gte:prefix,lt:prefix + '\uffff'});

/** Root-pinned read-only queries. Only fullAudit can establish semantic status.
 * No partial ledger is passed to validateLedger and no caller trust flag exists.
 * Full audit is deliberately a bounded-fixture, materializing reference today.
 */
export async function createCanonicalPartitionReader(store,rootHash,options = {}) {
  const {signal} = partitionOptions(options,['signal']);
  const io = createPartitionObjectIO(store);
  const root = validatePartitionRoot(await io.read(rootHash,{signal}));
  const version = Object.hasOwn(root,'valueCodec') ? 2 : 1;
  const codec = createPartitionValueCodec(store,{version}), {tree} = codec;
  const source = validatePartitionSource(await io.read(root.source,{signal}),version);
  const derived = validatePartitionDerived(await io.read(root.derived,{signal}),root.source,version);
  let sourceState = 'not-semantically-validated', derivedState = 'not-semantically-validated';
  const handles = new WeakSet();
  const verification = () => ({rootHash,bytes:'visited-hashes-and-shapes',source:sourceState,derived:derivedState});
  function freeze(value) {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    return value;
  }
  function handle(ref) {
    const result = Object.freeze({rootHash,ref:freeze(structuredClone(codec.validate(ref)))});
    handles.add(result); return result;
  }
  function owned(value) {
    if (!value || !handles.has(value)) partitionFail('foreign-partition-value-handle');
    return value.ref;
  }
  async function collection(name,signal) {
    if (!Object.hasOwn(PARTITION_COLLECTIONS,name)) partitionFail('unsupported-partition-collection');
    const value = await tree.get(source.collections,name,{signal});
    return value === undefined ? undefined : validatePartitionCollection(name,value);
  }
  async function getRecord(name,id,options = {}) {
    const {signal} = partitionOptions(options,['signal']); checkId(id); partitionAbort(signal);
    const descriptor = await collection(name,signal);
    const ref = descriptor && await tree.get(descriptor.byId,id,{signal});
    return {value:ref === undefined ? null : handle(ref),verification:verification()};
  }
  async function pageCollection(name,options = {}) {
    const {limit = 128,cursor = null,signal} = partitionOptions(options,['limit','cursor','signal']); partitionLimit(limit);
    let inner = null;
    if (cursor !== null) {
      partitionFields(cursor,['format','version','root','collection','inner']);
      if (cursor.format !== 'finance-tracker-canonical-collection-cursor' || cursor.version !== 1 || cursor.root !== rootHash || cursor.collection !== name || !cursor.inner) partitionFail('partition-cursor-mismatch');
      inner = structuredClone(cursor.inner);
    }
    const descriptor = await collection(name,signal);
    if (!descriptor) return {entries:[],cursor:null,present:false,verification:verification()};
    const result = await tree.page(descriptor.order,{limit,cursor:inner,signal}), entries = [];
    for (const [ordinal,id] of result.entries) {
      checkId(id); const ref = await tree.get(descriptor.byId,id,{signal});
      if (!ref) partitionFail('partition-order-target-missing');
      entries.push({ordinal,id,value:handle(ref)});
    }
    return {entries,present:true,cursor:result.cursor ? {format:'finance-tracker-canonical-collection-cursor',version:1,root:rootHash,collection:name,inner:result.cursor} : null,verification:verification()};
  }
  async function pageValue(value,options = {}) {
    const {limit = 128,cursor = null,signal} = partitionOptions(options,['limit','cursor','signal']);
    const ref = owned(value); let inner = null;
    if (cursor !== null) {
      partitionFields(cursor,['format','version','root','valueRoot','inner']);
      if (cursor.format !== 'finance-tracker-canonical-value-cursor' || cursor.version !== 1 || cursor.root !== rootHash || cursor.valueRoot !== (ref.root ?? null) || !cursor.inner) partitionFail('partition-cursor-mismatch');
      inner = structuredClone(cursor.inner);
    }
    const result = await codec.page(ref,{limit,cursor:inner,signal});
    const entries = result.entries.map(([ordinal,item]) => ref.kind === 'string' ? {ordinal,text:item}
      : (ref.kind === 'array' || (ref.kind === 'json' && Array.isArray(ref.value))) ? {ordinal,value:handle(item)} : {ordinal,key:handle(item.key),value:handle(item.value)});
    return {entries,cursor:result.cursor ? {format:'finance-tracker-canonical-value-cursor',version:1,root:rootHash,valueRoot:ref.root ?? null,inner:result.cursor} : null,verification:verification()};
  }
  async function materialize(value,options = {}) {
    return {value:await codec.materialize(owned(value),options),verification:verification()};
  }
  async function field(value,name,options = {}) {
    const {signal} = partitionOptions(options,['signal']);
    const ref = owned(value);
    if ((ref.kind !== 'object' && !(ref.kind === 'json' && ref.value && typeof ref.value === 'object' && !Array.isArray(ref.value))) || typeof name !== 'string') partitionFail('invalid-partition-field-query');
    let cursor = null;
    do {
      const result = await pageValue(value,{cursor,signal});
      for (const entry of result.entries) {
        const key = await materialize(entry.key,{signal});
        if (key.value === name) return {value:entry.value,verification:verification()};
      }
      cursor = result.cursor;
    } while (cursor);
    return {value:null,verification:verification()};
  }
  async function pageMonthActivities(scope,options = {}) {
    const {accountId,month} = partitionOptions(scope,['accountId','month']); checkId(accountId); monthBounds(month);
    const {limit = 128,cursor = null,signal} = partitionOptions(options,['limit','cursor','signal']); partitionLimit(limit); partitionAbort(signal);
    let phase = 0, inner = null;
    if (cursor !== null) {
      partitionFields(cursor,['format','version','root','accountId','month','phase','inner']);
      if (cursor.format !== 'finance-tracker-canonical-month-cursor' || cursor.version !== 1 || cursor.root !== rootHash || cursor.accountId !== accountId || cursor.month !== month || ![0,1].includes(cursor.phase)) partitionFail('partition-cursor-mismatch');
      phase = cursor.phase; inner = structuredClone(cursor.inner);
    }
    const accounts = await collection('accounts',signal);
    if (!accounts || !await tree.get(accounts.byId,accountId,{signal})) partitionFail('unknown-account');
    const entries = [];
    while (phase < 2 && entries.length < limit) {
      const prefix = `${accountId}/${phase === 0 ? month : '@undated'}/`;
      const page = await tree.page(derived.monthActivities,{...range(prefix),limit:limit - entries.length,cursor:inner,signal});
      for (const [key,activityId] of page.entries) {
        checkId(activityId); const ref = await tree.get(derived.effectiveActivities,activityId,{signal});
        if (!ref) partitionFail('partition-activity-target-missing');
        entries.push({ordinal:key.slice(prefix.length),activityId,value:handle(ref)});
      }
      inner = page.cursor;
      if (inner) break;
      phase++;
    }
    return {entries,cursor:phase < 2 ? {format:'finance-tracker-canonical-month-cursor',version:1,root:rootHash,accountId,month,phase,inner} : null,verification:verification()};
  }
  async function getMonthlySummary(scope,options = {}) {
    const {accountId,month,currency} = partitionOptions(scope,['accountId','month','currency']); checkId(accountId); monthBounds(month);
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) partitionFail('invalid-partition-currency');
    const {signal} = partitionOptions(options,['signal']); partitionAbort(signal);
    const accounts = await collection('accounts',signal);
    if (!accounts || !await tree.get(accounts.byId,accountId,{signal})) partitionFail('unknown-account');
    const ref = await tree.get(derived.summaries,`${accountId}/${month}/${currency}`,{signal});
    return {value:ref === undefined ? null : handle(ref),availability:ref === undefined ? 'not-indexed' : 'indexed',verification:verification()};
  }

  async function audit(options = {}) {
    const {signal,maxRecords = 100000,maxValues = 1000000,maxStringCodeUnits = 4000000} = partitionOptions(options,['signal','maxRecords','maxValues','maxStringCodeUnits']);
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) partitionFail('invalid-audit-budget');
    sourceState = 'not-semantically-validated'; derivedState = 'not-semantically-validated'; partitionAbort(signal);
    const expansion = {signal,maxValues,maxStringCodeUnits};
    const ledger = await codec.materialize(source.metadata,expansion);
    if (Object.keys(PARTITION_COLLECTIONS).some(name => Object.hasOwn(ledger,name))) partitionFail('partition-metadata-contains-collection');
    await tree.verify(source.collections,{signal});
    let recordCount = 0n;
    for await (const [name,descriptor] of tree.entries(source.collections,{signal})) {
      validatePartitionCollection(name,descriptor);
      recordCount += partitionCount(descriptor.count);
      if (recordCount > BigInt(maxRecords)) partitionFail('partition-audit-record-budget');
      for (const hash of [descriptor.byId,descriptor.order]) {
        const info = await tree.verify(hash,{signal});
        if (info.count !== descriptor.count) partitionFail('partition-collection-count-mismatch');
      }
      // This audit already materializes the complete ledger. Read each by-ID
      // page once instead of repeatedly parsing the same packed page for every
      // ordered record. The independent order tree still proves exact order,
      // membership and cardinality; this does not relax semantic validation.
      const records = [], seen = new Set(), byId = new Map(); let ordinal = 0n;
      for await (const [id,ref] of tree.entries(descriptor.byId,{signal})) {
        checkId(id);
        const record = await codec.materialize(ref,expansion);
        if (!record || record[descriptor.idField] !== id || byId.has(id)) partitionFail('partition-record-identity-mismatch');
        byId.set(id,record);
      }
      for await (const [key,id] of tree.entries(descriptor.order,{signal})) {
        if (key !== partitionOrdinal(ordinal++) || seen.has(id)) partitionFail('partition-collection-order-mismatch');
        checkId(id); seen.add(id);
        if (!byId.has(id)) partitionFail('partition-order-target-missing');
        records.push(byId.get(id));
      }
      // Equal cardinality + unique ordered targets rules out hidden by-ID rows.
      if (String(ordinal) !== descriptor.count) partitionFail('partition-collection-count-mismatch');
      Object.defineProperty(ledger,name,{value:records,enumerable:true,writable:true,configurable:true});
    }
    if (!Array.isArray(ledger.events) || source.eventFrontier !== String(ledger.events.length) || source.positionEventFrontier !== String(ledger.positionEvents?.length ?? 0)) partitionFail('partition-frontier-mismatch');
    validateLedger(ledger); sourceState = 'full-ledger-validated';
    // Rebuilding uses a private temporary store. An audit never repairs stored
    // bytes or writes to the caller's store. This currently retains full output.
    const expectedObjects = new Map();
    const expectedStore = {async read(hash) { const bytes = expectedObjects.get(hash); if (!bytes) partitionFail('missing-audit-object'); return bytes.slice(); },
      async write(bytes) { const hash = await partitionDigest(bytes); expectedObjects.set(hash,bytes.slice()); return hash; }};
    const expectedHash = await buildPartitionDerived(ledger,root.source,expectedStore,{signal,version});
    if (expectedHash !== root.derived) {
      derivedState = 'invalid';
      return {ledger,verification:verification()};
    }
    // Hash equality binds meaning, but does not prove remote objects exist or
    // still contain those bytes. Read every derived tree and nested value now.
    for (const name of ['effectiveActivities','monthActivities','summaries']) {
      await tree.verify(derived[name],{signal});
      for await (const [,value] of tree.entries(derived[name],{signal})) {
        if (name === 'monthActivities') checkId(value);
        else await codec.materialize(value,expansion);
      }
    }
    derivedState = 'semantic-verified';
    return {ledger,verification:verification()};
  }
  let auditRunning = false;
  async function fullAudit(options = {}) {
    if (auditRunning) partitionFail('partition-audit-in-progress');
    auditRunning = true;
    try { return await audit(options); }
    finally { auditRunning = false; }
  }
  const unsupported = () => partitionFail('partition-position-and-reconciliation-queries-not-implemented');
  return Object.freeze({rootHash,verification,getRecord,pageCollection,pageValue,materialize,field,
    pageMonthActivities,getMonthlySummary,fullAudit,position:unsupported,reconciliation:unsupported});
}
