import test from 'node:test';
import assert from 'node:assert/strict';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {createPagedFixture} from './helpers/paged-canonical-fixture.mjs';

for(const damage of ['missing','malformed','changed'])test(`v5 snapshot ${damage} bytes invalidate the writable baseline`,async()=>{
  const h=await createPagedFixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
  await store.load();await store.save(h.ledger);
  if(damage==='missing')h.objects.delete(store.base.root);
  else if(damage==='malformed')h.objects.set(store.base.root,new TextEncoder().encode('{'));
  else h.objects.get(store.base.root)[0]^=1;
  await assert.rejects(store.load());assert.equal(store.base,null);
  await assert.rejects(store.save(h.ledger),{code:'verified-base-required'});
});
for(const reason of ['base-conflict','session-lost'])test(`v5 load closes ${reason} after materialization`,async()=>{
  const h=await createPagedFixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
  await store.load();await store.save(h.ledger);
  h.lifecycle.assertCurrentManifest=async()=>{throw Object.assign(new Error(reason),{code:reason});};
  await assert.rejects(store.load(),{code:reason});assert.equal(store.base,null);
  await assert.rejects(store.save(h.ledger),{code:'verified-base-required'});
});
test('v5 reopen returns detached ledger bytes and rechecks the source',async()=>{
  const h=await createPagedFixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
  await store.load();await store.save(h.ledger);
  const first=await store.load();first.accounts[0].displayName='caller mutation';
  assert.deepEqual(await store.load(),h.ledger);
  h.objects.get(store.base.root)[0]^=1;await assert.rejects(store.load());
});
