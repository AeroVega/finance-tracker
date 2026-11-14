import test from 'node:test';
import assert from 'node:assert/strict';
import {storageWriteDiagnostic} from '../js/storage-write-diagnostic.mjs';

test('unresolved create visibility and later read failure retain separate safe codes', () => {
  const result = storageWriteDiagnostic({code: 'write-unresolved', details: {createFailed: true,
    createError: {code: 'visibility-timeout', details: {createRequest: {status: 200, returnedId: 'private-id'}, lastStatus: 404, attempts: 8}},
    readbackError: {code: 'object-not-found'}}});
  assert.deepEqual(result, {code: 'write-unresolved', create: 'visibility-timeout', createHttp: 200,
    createVisibilityHttp: 404, createVisibilityChecks: 8, readback: 'object-not-found', readbackHttp: null});
});

test('diagnostic never copies IDs, hashes, messages, arbitrary codes, bodies or nested objects', () => {
  const secret = 'private-identifier';
  const result = storageWriteDiagnostic({code: 'write-unresolved', message: secret, details: {
    fileId: secret, sha256: secret, response: {secret}, createFailed: true,
    createError: {code: secret, message: secret, details: {status: secret, attempts: 1000000}},
    readbackError: {code: {toString() { throw Error('must not coerce'); }}, message: secret, details: {status: {secret}}}}});
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.create, 'unknown'); assert.equal(result.readback, 'unknown');
  assert.equal(result.createHttp, null);
  assert.ok(Object.isFrozen(result));
  assert.equal(storageWriteDiagnostic({code: 'unknown'}), null);
});

test('root-binding and wrapped failures use the same diagnostic without raw exception serialization', () => {
  const source = {code: 'write-unresolved', details: {failed: false, readFailure: {code: 'authorization-required', details: {status: 403}}}};
  assert.equal(storageWriteDiagnostic(source).create, 'completed');
  assert.equal(storageWriteDiagnostic({code: 'write-unresolved', cause: source}).readbackHttp, 403);
});
