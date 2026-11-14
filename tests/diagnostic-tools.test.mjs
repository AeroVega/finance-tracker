import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseDiagnostic,validateDiagnosticReport,explainDiagnostic} from '../scripts/explain-diagnostic.mjs';
import {generateErrorCodeDocs} from '../scripts/generate-error-code-docs.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=name=>JSON.parse(fs.readFileSync(new URL(`./fixtures/diagnostic-reports/${name}.json`,import.meta.url),'utf8'));
test('offline explanation accepts integrity, state and defect reports, plain or wrapped',()=>{
  for(const kind of ['integrity','state','defect']){
    const report=fixture(kind),json=JSON.stringify(report);
    for(const text of [json,`FT-DIAG v2 | code=${report.error.code}\n\n\`\`\`json\n${json}\n\`\`\``]){
      assert.deepEqual(parseDiagnostic(text),report);
      const explanation=explainDiagnostic(report);
      assert.match(explanation,/save-ledger/);assert.match(explanation,/Retryable: false/);assert.match(explanation,/No trusted app frame captured/);
    }
  }
});
test('explain refuses unknown nested fields, unsafe source paths and changed retry claims',()=>{
  const mutate=[
    r=>{r.extra='private';},r=>{r.build.url='https://private.invalid';},r=>{r.error.message='private';},
    r=>{r.error.chain[0].context.account='private';},r=>{r.error.chain[0].message='private';},
    r=>{r.where.url='private';},r=>{r.state.sessionId='private';},r=>{r.env.userAgent='private';},
    r=>{r.env.features={extra:true};},r=>{r.breadcrumbs[0].url='private';},
    r=>{r.error.frames=[{file:'js/../secret.mjs',line:1,col:1}];},
    r=>{r.error.frames=[{file:'js/session-coordination.mjs',line:1,col:1,fn:'private'}];},
    r=>{r.build={commit:'; echo private',source:'deployed'};},r=>{r.error.retryable=true;},
    r=>{r.state.ledger={synthetic:false,counts:'exact',activities:253};},
    r=>{r.state.ledger={synthetic:false,counts:'power-of-two-upper-bound',activities:253};}
  ];
  for(const fn of mutate){const r=fixture('integrity');fn(r);assert.throws(()=>validateDiagnosticReport(r),/Invalid or unsupported/);}
});
test('bounded parser rejects excessive arrays, bytes and malformed JSON',()=>{
  const r=fixture('integrity');r.breadcrumbs=Array(61).fill(r.breadcrumbs[0]);assert.throws(()=>parseDiagnostic(JSON.stringify(r)));
  assert.throws(()=>parseDiagnostic(' '.repeat(18001)));assert.throws(()=>parseDiagnostic('{'));
  assert.throws(()=>validateDiagnosticReport(new Proxy({}, {ownKeys(){throw new Error('private')}})),/Invalid or unsupported/);
});
test('source lookup labels exact commit versus fallback and never accepts caller paths',()=>{
  const r=fixture('integrity');r.error.frames=[{file:'js/session-coordination.mjs',line:15,col:1}];
  r.build={commit:'7aa553eeab83d898b9a6bb43dfb8a68c298ae70a',source:'deployed'};
  const exists=spawnSync('git',['cat-file','-e',r.build.commit],{cwd:root}).status===0;
  const text=explainDiagnostic(r);
  assert.match(text,exists?/— commit 7aa553e/:/working tree/);
  r.build.commit='a'.repeat(40);assert.match(explainDiagnostic(r),/not exact-build evidence/);
  r.error.frames[0].file='/tmp/private';assert.throws(()=>explainDiagnostic(r));
});
test('CLI accepts stdin without network or side effects and rejects invalid input',()=>{
  const result=spawnSync(process.execPath,['scripts/explain-diagnostic.mjs','-'],{cwd:root,input:JSON.stringify(fixture('state')),encoding:'utf8'});
  assert.equal(result.status,0);assert.match(result.stdout,/offline/);
  const bad=spawnSync(process.execPath,['scripts/explain-diagnostic.mjs','-'],{cwd:root,input:'private-canary',encoding:'utf8'});
  assert.equal(bad.status,1);assert.doesNotMatch(bad.stderr,/private-canary/);
});
test('generated compact reference is current and deterministic',()=>{
  assert.equal(fs.readFileSync(new URL('../docs/ERROR_CODES.md',import.meta.url),'utf8'),generateErrorCodeDocs());
  assert.equal(generateErrorCodeDocs(),generateErrorCodeDocs());
  assert.match(generateErrorCodeDocs(),/computed\/forwarded/);
});

test('offline validator accepts bounded MIME classes but refuses raw MIME or stage values',()=>{
  const r=fixture('integrity');
  r.error.chain[0].context={code:'hash-mismatch',reason:'metadata-changed',fields:['mimeType'],stage:'immutable-create-receipt',expectedMimeClass:'octet-stream',actualMimeClass:'json'};
  assert.doesNotThrow(()=>validateDiagnosticReport(r));
  for(const key of ['expectedMimeClass','actualMimeClass','stage']){
    const bad=structuredClone(r);bad.error.chain[0].context[key]='private-canary';
    assert.throws(()=>validateDiagnosticReport(bad),/Invalid or unsupported/);
  }
});
