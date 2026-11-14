import test from 'node:test';
import assert from 'node:assert/strict';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {fixture,now} from './helpers/canonical-storage-fixture.mjs';
import {setupHttpCanonicalWorkbench} from './helpers/pr28-http-workbench.mjs';
import {createPagedFixture} from './helpers/paged-canonical-fixture.mjs';
import {restorePagedLedger} from './helpers/paged-http-roundtrip.mjs';
import {applyPositionEvent} from '../js/financial-position.mjs';
import {createSyntheticFinancialPosition} from '../js/synthetic-financial-position.mjs';
const appendBalance=(ledger,n)=>applyPositionEvent(ledger,{type:'balance-snapshot',commandId:'invented-position-'+n,
 accountId:ledger.accounts[0].accountId,effectiveDate:'2026-01-31',amountText:n===1?'100.00':'101.00',
 basis:'statement',source:{kind:'statement',reference:'Invented statement '+n}},{now});

test('v5 retains optional position history exactly and refuses removing it',async()=>{
 const {ledger}=await fixture(),h=await createPagedFixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
 await store.load();await store.save(ledger);
 assert.equal(Object.hasOwn(await new CanonicalLedgerStore({lifecycle:h.lifecycle}).load(),'positionEvents'),false);
 const indexed={...ledger,positionEvents:[]};await store.save(indexed);
 assert.deepEqual(await new CanonicalLedgerStore({lifecycle:h.lifecycle}).load(),indexed);
 await assert.rejects(store.save(ledger),{code:'history-removal-refused'});
});
test('v5 position amendments survive portable restore and refuse rewritten evidence',async()=>{
 const {ledger}=await fixture(),h=await setupHttpCanonicalWorkbench(),store=h.store;
 await store.save(ledger);const first=appendBalance(ledger,1);await store.save(first);
 const amended=appendBalance(first,2);await store.save(amended);
 assert.deepEqual(amended.positionEvents[0],first.positionEvents[0]);
 assert.deepEqual(await restorePagedLedger(h.lifecycle),amended);
 const before=h.http.mutations;
 for(const [mutate,code] of [[x=>{x.positionEvents[0].source.reference='invented rewrite';},'history-rewrite-refused'],[x=>x.positionEvents.pop(),'history-removal-refused'],[x=>delete x.positionEvents,'history-removal-refused']]) {
   const bad=structuredClone(amended);mutate(bad);await assert.rejects(store.save(bad),{code});
   await store.load();
 }
 assert.equal(h.http.mutations,before);await h.lifecycle.release();
});
test('v5 multi-account reconciliation and holdings preserve exact source references',async()=>{
 const {ledger}=await createSyntheticFinancialPosition(),h=await createPagedFixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
 await store.load();await store.save(ledger);assert.deepEqual(await new CanonicalLedgerStore({lifecycle:h.lifecycle}).load(),ledger);
});
test('v5 position history preserves identities and order across paged boundaries',async()=>{
 let {ledger}=await fixture();for(let n=0;n<65;n++)ledger=appendBalance(ledger,n);
 const h=await createPagedFixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});await store.load();await store.save(ledger);
 assert.deepEqual(await new CanonicalLedgerStore({lifecycle:h.lifecycle}).load(),ledger);
 assert.ok([...h.objects.values()].every(bytes=>bytes.length<=65536));
});
test('v5 full-month coverage and holdings resolution retain references through portable restore',async()=>{
    const { createSyntheticFinancialPosition } = await import('../js/synthetic-financial-position.mjs');
    const { applyPositionEvent } = await import('../js/financial-position.mjs');
    const scenario = await createSyntheticFinancialPosition();
    let ledger = scenario.ledger;
    const accountId = scenario.accounts.brokerage;
    const source = { kind: 'statement', reference: 'Invented complete January brokerage statement' };
    const closing = ledger.positionEvents.find(event => event.accountId === accountId && event.eventType === 'balance-snapshot');
    const originalHoldings = ledger.positionEvents.find(event => event.accountId === accountId && event.eventType === 'holdings-snapshot');
    const append = command => {
      ledger = applyPositionEvent(ledger, { accountId, ...command }, { now });
      return ledger.positionEvents.at(-1);
    };
    const opening = append({ type: 'balance-snapshot', commandId: 'invented-covered-opening',
      effectiveDate: '2024-12-31', amountText: '4900.00', basis: 'statement', source });
    const reconciliation = append({ type: 'reconciliation', commandId: 'invented-covered-january', month: '2025-01',
      openingBalanceEventId: opening.eventId, closingBalanceEventId: closing.eventId,
      method: 'statement-components', source, statementCoverage: { start: '2025-01-01', end: '2025-01-31' },
      components: [{ kind: 'market-value-change', amountText: '100.00', source }] });
    const correctedHoldings = append({ type: 'holdings-snapshot', commandId: 'invented-corrected-holdings',
      effectiveDate: '2025-01-31', scope: 'complete', source,
      holdings: [{ symbol: 'INVENTED', assetType: 'stock', quantity: '47', valueText: '4700.00' },
        { symbol: 'CASH', assetType: 'cash', quantity: '300', valueText: '300.00' }] });
    const setup = await setupHttpCanonicalWorkbench(), store = setup.store;
    await store.load(); await store.save(ledger);
    const resolution = append({ type: 'holdings-resolution', commandId: 'invented-choose-corrected-holdings',
      effectiveDate: '2025-01-31', selectedEventId: correctedHoldings.eventId,
      candidateEventIds: [originalHoldings.eventId, correctedHoldings.eventId], reason: 'Invented corrected statement replaces allocation' });
    await store.save(ledger);
    const assertPreserved = actual => {
      assert.deepEqual(actual, ledger);
      const byId = new Map(actual.positionEvents.map(event => [event.eventId, event]));
      assert.deepEqual(byId.get(reconciliation.eventId), reconciliation);
      assert.deepEqual(byId.get(reconciliation.eventId).statementCoverage, { start: '2025-01-01', end: '2025-01-31' });
      assert.deepEqual(byId.get(reconciliation.openingBalanceEventId), opening);
      assert.deepEqual(byId.get(reconciliation.closingBalanceEventId), closing);
      assert.deepEqual(byId.get(resolution.eventId), resolution);
      assert.deepEqual(resolution.candidateEventIds.map(id => byId.get(id)), [originalHoldings, correctedHoldings]);
      assert.deepEqual(byId.get(resolution.selectedEventId), correctedHoldings);
    };
    assertPreserved(await new CanonicalLedgerStore({ lifecycle: setup.lifecycle }).load());
    assertPreserved(await restorePagedLedger(setup.lifecycle));
    await setup.lifecycle.release();
});

for (const kind of ['corrupt','missing']) test(`v5 rejects ${kind} retained position root even after a newer position save`,async()=>{
 const {ledger}=await fixture(),h=await setupHttpCanonicalWorkbench(),store=h.store;
 await store.save(ledger);const first=appendBalance(ledger,1);await store.save(first);
 const retainedRoot=store.base.root;await store.save(appendBalance(first,2));assert.notEqual(store.base.root,retainedRoot);
 const [id,file]=[...h.http.files].find(([,file])=>file.metadata.appProperties?.financeTrackerHash===retainedRoot);
 const before=structuredClone(file),mutations=h.http.mutations;
 if(kind==='missing')h.http.files.delete(id);
 else {file.bytes[0]^=1;file.metadata.version=String(BigInt(file.metadata.version)+1n);}
 await assert.rejects(new CanonicalLedgerStore({lifecycle:h.lifecycle}).load());
 assert.equal(h.http.mutations,mutations);
 h.http.files.set(id,before);await h.lifecycle.recover();await h.lifecycle.release();
});
