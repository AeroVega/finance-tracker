import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerSessionOwner, validateLedger } from '../js/canonical-import.mjs';
import { applyPositionEvent } from '../js/financial-position.mjs';
import { fixture, now } from './helpers/canonical-storage-fixture.mjs';

for (const collision of ['eventId', 'commandId']) {
  test(`optimized activity session rejects a ${collision} already used by position history atomically`, async () => {
    const original = (await fixture()).ledger;
    const ledger = applyPositionEvent(original, { type: 'balance-snapshot', commandId: 'invented-position-command',
      accountId: original.accounts[0].accountId, effectiveDate: '2026-01-31', amountText: '100.00',
      basis: 'statement', source: { kind: 'statement', reference: 'Invented statement' } }, { now });
    const position = ledger.positionEvents[0];
    const session = createLedgerSessionOwner().open(JSON.stringify(ledger), 'invented-storage-binding');
    const entry = { eventId: crypto.randomUUID(), recordedAt: now, command: {
      type: 'category-correction', commandId: 'invented-activity-command',
      activityId: ledger.activities[0].activityId, categoryId: 'invented-reviewed' } };
    if (collision === 'eventId') entry.eventId = position.eventId;
    else entry.command.commandId = position.commandId;
    assert.throws(() => session.applyBatchJson(JSON.stringify([entry]), 0),
      collision === 'eventId' ? /invalid-or-duplicate-record-id/ : /event-command-conflict/);
    assert.equal(session.revision(), 0);
    assert.deepEqual(session.snapshot(), ledger);
    assert.equal(validateLedger(session.validatedSnapshot()), true);
    entry.eventId = crypto.randomUUID(); entry.command.commandId = 'invented-safe-command';
    assert.equal(session.applyBatchJson(JSON.stringify([entry]), 0), 1);
    assert.equal(validateLedger(session.validatedSnapshot()), true);
    assert.deepEqual(session.snapshot().positionEvents, ledger.positionEvents);
  });
}
