import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {ERRORS, getEntry} from '../js/error-registry.mjs';
import {isSafeDiagnosticCode, safeDiagnosticCode, safeDiagnosticErrorName} from '../js/app-diagnostic-codes.mjs';
import {messagesForSurface} from '../js/app-diagnostic-messages.mjs';
import {auditErrorCodes, scanSource} from '../scripts/audit-error-codes.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
test('all literal error sites in application modules have one registry entry',()=>{
  const result=auditErrorCodes(root,ERRORS);
  assert.deepEqual(result.unregistered,[]);
  // Computed/forwarded codes are reported honestly, not claimed statically proved.
  assert.ok(Array.isArray(result.dynamic));
});
test('registry metadata is complete and immutable with conservative outcome/retry defaults',()=>{
  const areas=new Set(['drive','session','lifecycle','catalog','paged','backup','import','workspace','csv','startup','diag']);
  const kinds=new Set(['input','state','integrity','defect']);
  assert.ok(Object.keys(ERRORS).length>600);
  assert.equal(Object.getPrototypeOf(ERRORS),null);
  for(const [code,entry] of Object.entries(ERRORS)){
    assert.match(code,/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    assert.ok(areas.has(entry.area));assert.ok(kinds.has(entry.kind));
    assert.equal(typeof entry.message,'string');assert.ok(entry.message.length);
    assert.equal(typeof entry.userAction,'string');assert.ok(entry.userAction.length);
    assert.equal(entry.retryable,false);assert.equal(entry.writeOutcome,'unknown');
    assert.ok(Object.isFrozen(entry));assert.ok(Object.isFrozen(entry.context));assert.ok(Object.isFrozen(entry.messages));
    assert.equal(getEntry(code),entry);assert.equal(isSafeDiagnosticCode(code),true);assert.equal(safeDiagnosticCode(code),code);
  }
});
test('hostile names and input objects never coerce or resolve as codes',()=>{
  for(const value of ['constructor','__proto__','toString',null,undefined,{},new Proxy({}, {get(){throw Error('private')}}),Symbol('private')]) {
    assert.equal(getEntry(value),null);assert.equal(isSafeDiagnosticCode(value),false);assert.equal(safeDiagnosticCode(value),'unknown');
  }
});
test('app error classes are allowlisted without accepting invented names',()=>{
  for(const name of ['AppError','AggregateError','PageTreeError','PortableBackupError','TransactionProtocolError','LocatorCatalogError','FramedBackupError','RetentionPolicyError','DriveFolderDiscoveryError','DriveFeasibilityError'])assert.equal(safeDiagnosticErrorName({name}),name);
  assert.equal(safeDiagnosticErrorName({name:'private-token'}),null);
});
test('surface-specific recovery text stays distinct and exact',()=>{
  assert.equal(messagesForSurface('workspace')['category-required'],'Enter a category for this transaction.');
  assert.equal(messagesForSurface('synthetic-year')['ownership-unknown'],'Session ownership could not be verified. A session marker may already have been written even when this counter shows zero. Preserve this folder and marker for inspection. Do not delete the marker or blindly retry or reconnect.');
  assert.match(messagesForSurface('copy-guide')['stale-session'],/Confirm stopped sessions below/);
  assert.doesNotMatch(getEntry('stale-session').message,/Confirm stopped sessions below/);
  assert.deepEqual(messagesForSurface('constructor'),{});
});
test('only deliberately reviewed input codes suppress technical panels',()=>{
  assert.equal(getEntry('category-required').kind,'input');
  assert.equal(getEntry('offline').kind,'state');
  for(const code of ['invalid-amount','invalid-account','invalid-json','node-byte-limit','ownership-unknown','write-unresolved'])assert.equal(getEntry(code).kind,'integrity');
  assert.equal(getEntry('invalid-options').kind,'defect');
  assert.equal(getEntry('unknown').kind,'defect');
});
test('audit handles multiline calls, ternaries, code fields and regex quotes, ignoring comments and prose',()=>{
  const source=`
    // fail('comment-fake')
    const prose = "fail('prose-fake')";
    const escaped = value.replace(/'/g, "'");
    fail(
      ready ? 'ready-failure' : 'waiting-failure', 'not-a-code');
    throw new PageTreeError('tree-failure', 'not-a-code');
    throw Object.assign(new Error('Human prose'), {code:'field-failure'});
    err.code = 'assigned-failure';
    /* new Error('comment-too') */
    poison('scope-failure', 'human explanation');
    fail(computedCode);
  `;
  const {sites,dynamic}=scanSource(source,'fixture.mjs');
  assert.deepEqual([...new Set(sites.map(s=>s.code))],['ready-failure','waiting-failure','tree-failure','field-failure','assigned-failure','scope-failure']);
  assert.equal(dynamic.length,1);assert.equal(dynamic[0].helper,'fail');
});

test('source location allowlist covers shipped modules without accepting arbitrary paths',async()=>{
 const {DIAGNOSTIC_FILES}=await import('../js/diagnostic-files.mjs');
 const actual=[];for(const dir of ['js','prototype'])for(const file of fs.readdirSync(path.join(root,dir))){if(/\.(?:mjs|js)$/.test(file))actual.push(dir+'/'+file);}
 assert.deepEqual([...DIAGNOSTIC_FILES].sort(),actual.sort());
});
