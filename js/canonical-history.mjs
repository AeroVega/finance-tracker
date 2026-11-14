import {canonicalizeJcs} from './transaction-protocol.mjs';

export const CANONICAL_COLLECTIONS = Object.freeze({accounts:'accountId',imports:'importRunId',observations:'observationId',activities:'activityId',events:'eventId',reviewDecisions:'reviewDecisionId',positionEvents:'eventId'});
const collections = CANONICAL_COLLECTIONS;
const immutable = new Set(['accounts','activities','events','reviewDecisions','positionEvents']);
const observationMutable = new Set(['activityId','disposition','reasonCode','resolved']);
const importMutable = new Set(['status','counts','latestActivityDate','errorCode','retryAttempts']);
const immutableFields = (record,mutable) => Object.fromEntries(Object.entries(record).filter(([key])=>!mutable.has(key)));
const same = (a,b) => canonicalizeJcs(a) === canonicalizeJcs(b);
const fail = code => { throw Object.assign(new Error(code),{code}); };
const metadata = ledger => Object.fromEntries(Object.entries(ledger).filter(([name]) => !Object.hasOwn(collections,name)));

/** Validate a transition, not just two individually valid ledgers. Retained
 * commits use this same check on cold open and independent archive restore. */
export function assertCanonicalLedgerTransition(before,after) {
  if (before === null) return;
  if (!after) fail('history-removal-refused');
  if (before.ledgerId !== after.ledgerId) fail('ledger-identity-mismatch');
  if (!same(metadata(before),metadata(after))) fail('ledger-metadata-rewrite-refused');
  for (const [name,idField] of Object.entries(collections)) {
    if (Object.hasOwn(before,name) && !Object.hasOwn(after,name)) fail('history-removal-refused');
    const prior = before[name] ?? [], next = after[name] ?? [];
    if (next.length < prior.length) fail('history-removal-refused');
    for (let ordinal = 0; ordinal < prior.length; ordinal++) {
      const old = prior[ordinal], value = next[ordinal];
      if (old[idField] !== value?.[idField]) fail('history-order-change-refused');
      if (immutable.has(name) && !same(old,value)) fail('history-rewrite-refused');
      if (name === 'observations' && !same(immutableFields(old,observationMutable),immutableFields(value,observationMutable))) fail('source-evidence-rewrite-refused');
      if (name === 'imports') {
        if (!same(immutableFields(old,importMutable),immutableFields(value,importMutable))) fail('import-evidence-rewrite-refused');
        if (old.retryAttempts.some((attempt,index) => !same(attempt,value.retryAttempts[index] ?? null))) fail('retry-history-rewrite-refused');
      }
    }
  }
}
