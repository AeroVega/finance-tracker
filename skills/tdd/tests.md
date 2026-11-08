# Good and bad tests

Use the existing `node:test` and `node:assert/strict` patterns. These examples use invented input and illustrative function names, not a new test framework.

## Good tests

Test observable behavior through the module's supported interface. Expected values come from an independent worked example, not a copy of the calculation under test.

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

test('totals the two invented amounts exactly', () => {
  assert.equal(totalMinorUnits([125, 275]), 400);
});

test('importing the same invented export twice preserves one record', () => {
  const ledger = createLedger();
  ledger.importRows(inventedRows);
  ledger.importRows(inventedRows);
  assert.equal(ledger.listRecords().length, 1);
});
```

Good tests explain the behavior they protect and survive internal refactoring. Prefer assertions about a result that callers can observe. Preserve lower-level financial-invariant, recovery, fault-injection, privacy, and request-budget tests when those assertions are part of a real contract.

## Bad tests

An implementation-coupled test checks an incidental helper call rather than the behavior. Do not confuse this with a required storage-protocol ordering or request-budget assertion; those can be externally significant contracts.

```javascript
// BAD: a private helper can change while the public result stays correct.
assert.equal(privateHelperCallCount, 1);

// BAD: the expected result repeats the algorithm under test.
const amounts = [125, 275];
const expected = amounts.reduce((sum, amount) => sum + amount, 0);
assert.equal(totalMinorUnits(amounts), expected);

// GOOD: a separately worked expected value can catch a wrong algorithm.
assert.equal(totalMinorUnits([125, 275]), 400);
```

When a test must inspect a lower-level contract, document why that level matters. Do not delete a test merely because it fails an interface-design heuristic.
