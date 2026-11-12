import test from 'node:test';
import assert from 'node:assert/strict';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {createPagedFixture} from './helpers/paged-canonical-fixture.mjs';

for (const layout of ['records-v1','grouped-v2','fragments-v3','partitions-v4']) {
  test(`unsupported ${layout} request fails before reads or writes`, async () => {
    let calls=0;
    const lifecycle=new Proxy({pagedCanonical:true},{get(target,key){if(key==='pagedCanonical')return true;calls++;return async()=>{calls++;};}});
    assert.throws(()=>new CanonicalLedgerStore({lifecycle,layout}),{code:'unsupported-canonical-layout'});
    assert.equal(calls,0);
  });
}
test('flat canonical lifecycle cannot silently open or initialize a v5 copy',()=>{
  let calls=0;
  const lifecycle={readManifest(){calls++;},readObject(){calls++;},transact(){calls++;}};
  assert.throws(()=>new CanonicalLedgerStore({lifecycle}),{code:'unsupported-canonical-layout'});
  assert.equal(calls,0);
});
test('default application adapter writes v5 and independently reopens exact source',async()=>{
  const h=await createPagedFixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
  await store.load();await store.save(h.ledger);
  assert.equal(store.layout,'partitions-v5');
  assert.equal(JSON.parse(new TextDecoder().decode(h.objects.get(store.base.root))).version,5);
  assert.deepEqual(await new CanonicalLedgerStore({lifecycle:h.lifecycle}).load(),h.ledger);
});
