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

test('receipt mismatch reports field names but never their values',()=>{
 const result=storageWriteDiagnostic({code:'hash-mismatch',details:{reason:'metadata-changed',fields:['name','mimeType','size','private-secret'],name:'private-secret',mimeType:'private-secret',size:'private-secret'}});
 assert.deepEqual(result,{code:'hash-mismatch',reason:'metadata-changed',fields:['name','mimeType','size']});
 assert.doesNotMatch(JSON.stringify(result),/private-secret/);
});

test('MIME evidence exports fixed classes only at the immutable receipt stage',async()=>{
  const {diagnosticMimeClass}=await import('../js/storage-write-diagnostic.mjs');
  for(const value of ['private-canary',{},Symbol('private-canary'),{toString(){throw Error('must not coerce')}}])assert.equal(diagnosticMimeClass(value),'other');
  for(const value of [undefined,null,''])assert.equal(diagnosticMimeClass(value),'missing');
  assert.equal(diagnosticMimeClass('application/octet-stream'),'octet-stream');
  const details={reason:'metadata-changed',fields:['mimeType'],stage:'immutable-create-receipt',expectedMimeClass:'octet-stream',actualMimeClass:'json'};
  assert.deepEqual(storageWriteDiagnostic({code:'hash-mismatch',details}),{code:'hash-mismatch',...details});
  for(const key of ['expectedMimeClass','actualMimeClass','stage']){
    const result=storageWriteDiagnostic({code:'hash-mismatch',details:{...details,[key]:'private-canary'}});
    assert.doesNotMatch(JSON.stringify(result),/private-canary/);
    assert.equal(Object.hasOwn(result,key),false);
  }
  const result=storageWriteDiagnostic({code:'hash-mismatch',details:{...details,fields:['size']}});
  assert.equal(Object.hasOwn(result,'stage'),false);
  assert.equal(Object.hasOwn(result,'actualMimeClass'),false);
});
