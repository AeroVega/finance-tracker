import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostic, diagnosticMessage, showDiagnostic, clearDiagnostic} from '../js/app-diagnostics.mjs';

const secret = 'private-token-account-transaction-https://private.invalid';
test('reports construct only bounded allowlisted fields, never echo input strings', () => {
  for (const error of [new Error(secret), {code:secret}, {code:'write-unresolved', details:{createFailed:false, readbackError:{code:secret,message:secret}}}, {code:'ownership-unknown',sessionCheck:secret}, {code:'google-libraries-unavailable',components:[secret]}, {code:'google-config-http',status:secret}]) {
    const result=createDiagnostic(error,{surface:secret,build:secret});
    assert.doesNotMatch(JSON.stringify(result), /private-/);
    assert.equal(JSON.parse(result.report).where.surface,'unknown');
    assert.ok(new TextEncoder().encode(result.report).length<=16384);
  }
  assert.equal(createDiagnostic({code:'constructor'}).code,'unknown');
  assert.equal(createDiagnostic({code:'__proto__'}).code,'unknown');
});
test('hostile accessors and serialized objects do not bypass the allowlist', () => {
  const error=new Proxy({}, {get(){throw new Error(secret);}});
  assert.equal(createDiagnostic(error).code,'unknown');
  assert.equal(createDiagnostic({code:{toString(){throw Error(secret);}}}).code,'unknown');
  assert.equal(createDiagnostic(new TypeError('invalid-amount')).code,'invalid-amount');
});
test('existing storage diagnostics retain fixed check details, no unsafe detail',()=>{
  const result=createDiagnostic({code:'ownership-unknown',sessionCheck:'closing-version-changed',sessionId:secret},{surface:'workspace',build:'a'.repeat(40)});
  const report=JSON.parse(result.report);assert.equal(report.schema,'finance-tracker-diagnostic-v2');assert.equal(report.error.code,'ownership-unknown');assert.equal(report.where.surface,'workspace');assert.equal(report.build.commit,'a'.repeat(40));assert.equal(report.error.chain[0].context.check,'closing-version-changed');
  assert.match(diagnosticMessage({code:'write-unresolved'}), /Do not upload again, reconnect, recover or delete/);
});
function dom() {
 const all=[];
 const make=tag=>{const events={};const n={tag,children:[],style:{},append(...v){this.children.push(...v)},setAttribute(){},addEventListener(k,f){events[k]=f},click(){return events.click()},focus(){this.focused=true},select(){this.selected=true},remove(){this.removed=true}};all.push(n);return n};
 const body=make('body'),target=make('p');
 return {all,target,document:{body,createElement:make,getElementById(){return {textContent:'a'.repeat(40)}}}};
}
test('clipboard denial and absence provide explicit selectable fallback without network',async()=>{
 for(const navigator of [{}, {clipboard:{writeText:async()=>{throw Error(secret)}}}]){
  const d=dom();showDiagnostic({code:'ownership-unknown'},{...d,navigator,surface:'workspace'});
  const copy=d.all.find(n=>n.textContent==='Copy diagnostics'),report=d.all.find(n=>n.tag==='textarea');
  assert.equal(report.readOnly,true);await copy.click();assert.equal(report.selected,true);assert.equal(report.focused,true);
  assert.ok(d.all.some(n=>/device Copy command/.test(n.textContent||'')));assert.equal(copy.disabled,false);
 }
});
test('copy succeeds, manual selection works, and replaced reports cannot steal focus on late failure',async()=>{
 const d=dom(),copied=[];
 showDiagnostic({code:'offline'},{...d,navigator:{clipboard:{writeText:async text=>copied.push(text)}}});
 await d.all.find(n=>n.textContent==='Copy diagnostics').click();assert.equal(JSON.parse(copied[0]).error.code,'offline');
 d.all.find(n=>n.textContent==='Select diagnostics').click();assert.equal(d.all.find(n=>n.tag==='textarea').selected,true);
 let reject;showDiagnostic({code:'write-unresolved'},{...d,navigator:{clipboard:{writeText:()=>new Promise((_,r)=>{reject=r})}}});
 const copy=d.all.filter(n=>n.textContent==='Copy diagnostics').at(-1), report=d.all.filter(n=>n.tag==='textarea').at(-1);
 const pending=copy.click();clearDiagnostic(d.target);reject(Error(secret));await pending;assert.equal(report.focused,undefined);
});

test('dashboard status boundary removes raw messages and arbitrary codes',async()=>{
 const {DashboardSyntheticStorage}=await import('../js/dashboard-synthetic-storage.mjs');
 const statuses=[];const storage=new DashboardSyntheticStorage({onStatus:s=>statuses.push(s)});
 storage.publish('error',secret,'error',{code:secret});
 assert.doesNotMatch(JSON.stringify(statuses),/private-/);assert.equal(statuses[0].code,'unknown');
});

test('unexpected runtime handlers are installed once and never serialize event data',async()=>{
 const {installUnexpectedDiagnostics}=await import('../js/app-diagnostics.mjs');const d=dom(),events={};
 const window={addEventListener(name,handler){assert.equal(events[name],undefined);events[name]=handler}};
 installUnexpectedDiagnostics({...d,window});installUnexpectedDiagnostics({...d,window});
 events.error({message:secret,filename:secret,error:new Error(secret)});
 events.unhandledrejection({reason:{code:secret}});
 const reports=d.all.filter(n=>n.tag==='textarea');assert.ok(reports.length>=1);
 assert.equal(JSON.parse(reports.at(-1).value).error.kind,'defect');assert.doesNotMatch(JSON.stringify(d.all),/private-/);
});

test('workspace recovery directions never point to copy-guide-only controls',()=>{
 for(const surface of ['workspace','import','synthetic-year','local-preview','developer-tool']){
  for(const code of ['recovery-required','stale-session']){
   const {message}=createDiagnostic({code},{surface});
   assert.doesNotMatch(message,/PR28|Confirm stopped sessions below/);
   assert.match(message,/recover/);
  }
 }
 assert.match(createDiagnostic({code:'stale-session'},{surface:'copy-guide'}).message,/Confirm stopped sessions below/);
});

// Owner chose Copy/Select only; even a supported OS share API stays unused.
test('diagnostics exposes Copy and Select only, never an OS share action',async()=>{
 const d=dom();let shares=0,copies=0;
 showDiagnostic({code:'ownership-unknown'},{...d,navigator:{share:async()=>{shares++},clipboard:{writeText:async()=>{copies++}}}});
 assert.deepEqual(d.all.filter(n=>n.tag==='button').map(n=>n.textContent),['Copy diagnostics','Select diagnostics']);
 await d.all.find(n=>n.textContent==='Copy diagnostics').click();
 assert.equal(copies,1);assert.equal(shares,0);
});
