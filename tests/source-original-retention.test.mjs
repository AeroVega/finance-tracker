import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceOriginalExpiry, sourceOriginalDisposition, isUnretainedSyntheticSource} from '../js/source-original-retention.mjs';

const retainedAt = '2023-01-01T00:00:00.000Z';
const expiresAt = '2024-06-24T00:00:00.000Z';
const pre = '2024-06-23T23:59:59.999Z';
const record = {retainedAt, expiresAt, status:'retained'};
test('540 full days, including leap day, are exact at the millisecond boundary', () => {
  assert.equal(sourceOriginalExpiry(retainedAt), expiresAt);
  assert.equal(sourceOriginalDisposition({...record, now:pre}), 'unexpired');
  assert.equal(sourceOriginalDisposition({...record, now:expiresAt}), 'expired');
  assert.equal(sourceOriginalDisposition({...record, now:'2024-06-24T00:00:00.001Z'}), 'expired');
});
test('checking again on restore cannot extend the original expiry or resurrect deleted/pending bytes', () => {
  assert.equal(sourceOriginalDisposition({...record, now:pre}), 'unexpired');
  assert.equal(sourceOriginalDisposition({...record, now:expiresAt}), 'expired');
  assert.equal(sourceOriginalDisposition({...record, status:'deleted', now:pre}), 'deleted');
  assert.equal(sourceOriginalDisposition({...record, status:'deletion-pending', now:pre}), 'deletion-pending');
  assert.equal(sourceOriginalDisposition({...record, expiresAt:'2025-01-01T00:00:00.000Z', now:pre}), 'invalid-evidence');
});
test('rejects invalid or noncanonical UTC timestamps, unsupported lifecycle states and inconsistent clocks', () => {
  for (const date of ['2023-02-29T00:00:00.000Z','2024-01-01T00:00:00Z','2024-01-01T24:00:00.000Z',
    '2024-01-01T00:00:00.000+00:00','9999-12-31T00:00:00.000Z',undefined]) {
    assert.equal(sourceOriginalExpiry(date), null);
  }
  assert.equal(sourceOriginalDisposition({...record, now:'2022-12-31T23:59:59.999Z'}), 'invalid-evidence');
  assert.equal(sourceOriginalDisposition({...record, now:pre, status:'unknown'}), 'invalid-evidence');
});
test('synthetic import only accepts explicit not-retained evidence with null locator and timestamps', () => {
  const run = {sourceFileRetentionStatus:'not-retained',privateSourceFileRef:null,sourceFileRetainedAt:null,
    sourceFileRetentionExpiresAt:null,sourceFileDeletedAt:null};
  assert.equal(isUnretainedSyntheticSource(run),true);
  for (const key of Object.keys(run)) assert.equal(isUnretainedSyntheticSource({...run,[key]:undefined}),false);
  assert.equal(isUnretainedSyntheticSource({...run,sourceFileRetentionStatus:'retained'}),false);
});
