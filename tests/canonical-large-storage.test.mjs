import test from 'node:test';
import assert from 'node:assert/strict';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {createPagedFixture} from './helpers/paged-canonical-fixture.mjs';
import {PAGE_TREE_MAX_BYTES} from '../js/immutable-page-tree.mjs';

test('v5 preserves large Unicode evidence across bounded pages and independent reopen',async()=>{
  const h=await createPagedFixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
  h.ledger.accounts[0].inventedEvidence='漢😀é\\\n'.repeat(30000);
  await store.load();await store.save(h.ledger);
  assert.ok([...h.objects.values()].every(bytes=>bytes.length<=PAGE_TREE_MAX_BYTES));
  assert.deepEqual(await new CanonicalLedgerStore({lifecycle:h.lifecycle}).load(),h.ledger);
  const count=h.commits.length;await store.save(h.ledger);assert.equal(h.commits.length,count);
});
