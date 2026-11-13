import test from 'node:test';
import assert from 'node:assert/strict';
import {createReporter} from '../js/error-reporting.mjs';
import {parseStack,safeSourceFile} from '../js/stack-frames.mjs';
import {safeWorkspace} from '../js/diagnostic-context.mjs';
const secret='PRIVATE-CANARY-https://x.invalid/acct/4417';
const options={now:()=>1000,uptime:()=>200,random:()=>new Uint8Array([1,2,3,4,5,6]),environment:()=>({}),appBase:'https://app.test/repo/'};
const reporter=()=>createReporter(options);

test('Safari and V8 source locations require trusted origin and known public file; no function names',()=>{
  const stack=`Error: ${secret}\nClass.save@https://app.test/repo/js/canonical-workspace.mjs:12:34\n@https://app.test/repo/js/session-coordination.mjs:5:6\n[native code]\n    at async Class.save (https://app.test/repo/js/canonical-workspace.mjs:24:8)\n    at https://app.test/repo/js/canonical-workspace.mjs:25:9\nforeign@https://evil.test/repo/js/canonical-workspace.mjs:4:5\nsecret@https://app.test/repo/js/../js/canonical-workspace.mjs:4:5\nsecret@https://app.test/repo/js/not-shipped.mjs:4:5\nsecret@https://app.test/repo/js/canonical-workspace.mjs?token=secret:4:5`;
  const parsed=parseStack(stack,options);assert.equal(parsed.frames.length,4);assert.equal(parsed.foreignFrames,4);
  assert.deepEqual(parsed.frames[0],{file:'js/canonical-workspace.mjs',line:12,col:34});
  assert.doesNotMatch(JSON.stringify(parsed),/PRIVATE|secret|https|Class/);
  for(const url of ['https://evil.test/repo/js/canonical-workspace.mjs','https://app.test/repo/js/%2e%2e/js/canonical-workspace.mjs','file:///tmp/js/canonical-workspace.mjs','C:\\work\\js\\canonical-workspace.mjs'])assert.equal(safeSourceFile(url,options),null);
});
test('huge, missing, hostile and eval stacks have bounded work/output',()=>{
  for(const input of [null,undefined,{},Symbol(),new Proxy({}, {get(){throw Error(secret)}})])assert.deepEqual(parseStack(input),{frames:[],foreignFrames:0,truncated:false});
  const value=parseStack(('x@https://app.test/repo/js/canonical-workspace.mjs:1:1\n').repeat(50000),options);assert.equal(value.frames.length,12);assert.equal(value.truncated,true);
  assert.equal(parseStack('    at eval (eval at foo (https://app.test/repo/js/canonical-workspace.mjs:1:1), <anonymous>:1:1)',options).frames.length,0);
});
test('hostile throwable and context inputs never escape or coerce to text',()=>{
  const r=reporter(),hostile=new Proxy({}, {get(){throw Error(secret)},ownKeys(){throw Error(secret)}});
  const errors=[null,undefined,1,Symbol(secret),secret,hostile,Object.freeze(new Error(secret)),{code:secret,message:secret,toJSON(){throw Error(secret)}},{code:'ownership-unknown',sessionCheck:secret,details:{operation:secret}}];
  for(const error of errors){const report=r.createReport(error,hostile);assert.doesNotMatch(JSON.stringify(report),/PRIVATE|x.invalid/);assert.ok(new TextEncoder().encode(JSON.stringify(report,null,2)).length<=16384);}
});
test('changing getters cannot bypass fixed typed fields',()=>{
  let n=0;assert.deepEqual(safeWorkspace({get dirty(){return ++n===1?true:secret}}),{dirty:true});
  n=0;const r=createReporter({...options,environment:()=>({get online(){return ++n===1?true:secret}})});assert.equal(r.createReport(null).env.online,true);
  n=0;const report=reporter().createReport(null,{get actionId(){return ++n===1?'save-ledger':secret}});assert.equal(report.where.actionId,'save-ledger');assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);
});
test('cause chains preserve codes/types/checks while bounded and cycle safe',()=>{
  const native=new TypeError('Load failed');const error=Object.assign(new Error(secret,{cause:native}),{code:'ownership-unknown',sessionCheck:'closing-version-changed'});native.cause=error;
  const report=reporter().createReport(error,{surface:'workspace'});assert.equal(report.error.chain.length,2);assert.equal(report.error.chain[0].context.check,'closing-version-changed');assert.equal(report.error.chain[1].context.browserMessageClass,'load-failed');assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);
  const aggregate=new AggregateError(Array.from({length:10000},()=>new Error(secret)));const data=reporter().createReport(aggregate);assert.ok(data.error.chain.length<=8);assert.equal(data.error.chainTruncated,true);
});
test('report identity/clock can be deterministic; build identity does not need DOM',()=>{
  const a=reporter().createReport({code:'base-conflict'},{build:'a'.repeat(40)}),b=reporter().createReport({code:'base-conflict'},{build:'a'.repeat(40)});
  assert.deepEqual(a,b);assert.equal(a.build.commit,'a'.repeat(40));assert.equal(a.generatedAt,'1970-01-01T00:00:01.000Z');
  const previous=globalThis.__FT_BUILD__;try{globalThis.__FT_BUILD__={commit:'b'.repeat(40),source:'deployed'};assert.equal(reporter().createReport(null).build.commit,'b'.repeat(40));}finally{globalThis.__FT_BUILD__=previous;}
});
test('workspace counts exact only for explicitly synthetic ledgers; providers cannot add fields',()=>{
  for(const syntheticOnly of [true,false,undefined]){
    const r=reporter();r.registerContextProvider('workspace',()=>({dirty:true,token:secret,ledger:{syntheticOnly,activities:513,accounts:3,events:1001,stagedChanges:2,amount:secret}}));
    const result=r.createReport(null);assert.equal(result.state.ledger.activities,syntheticOnly===true?513:1024);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|token|amount/);
  }
  const r=reporter();r.registerContextProvider(secret,()=>{throw Error('must not run')});r.registerContextProvider('workspace',()=>{throw Error(secret)});assert.deepEqual(r.createReport(null).state,{});
});
test('breadcrumbs bounded/coalesced, enums only, current action clears at completion',()=>{
  let time=0;const r=createReporter({...options,uptime:()=>++time});
  for(let i=0;i<100;i++)r.leaveBreadcrumb({e:'request',ep:'files.get',m:'get',s:200,ms:i,outcome:'ok',url:secret});
  r.leaveBreadcrumb({e:secret});r.leaveBreadcrumb({e:'action.start',actionId:secret});
  r.leaveBreadcrumb({e:'action.start',actionId:'save-ledger'});assert.equal(r.createReport(null).where.actionId,'save-ledger');
  r.leaveBreadcrumb({e:'action.ok',actionId:'save-ledger'});const report=r.createReport(null);assert.equal(report.where.actionId,undefined);assert.equal(report.breadcrumbs.length,60);assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);
  const c=reporter();c.leaveBreadcrumb({e:'net',online:true});c.leaveBreadcrumb({e:'net',online:true});assert.equal(c.createReport(null).breadcrumbs.length,1);
});
test('history bounded and identical reports deduped without changing error or storage',()=>{
  let time=0;const r=createReporter({...options,uptime:()=>time});const err=Object.freeze(Object.assign(new Error(secret),{code:'base-conflict'}));
  const a=r.reportError(err),b=r.reportError(err);assert.equal(a.id,b.id);assert.equal(r.repeatCount(a.id),2);assert.equal(r.recentReports().length,1);
  for(let i=0;i<15;i++){time+=31000;r.reportError(err);}assert.equal(r.recentReports().length,10);assert.equal(r.getReport(a.id),null);
});
test('full report obeys UTF-8 byte budget and never logs',()=>{
  const r=reporter();for(let i=0;i<60;i++)r.leaveBreadcrumb({e:'request',ep:'files.generateIds',m:'post',s:599,ms:86400000-i,outcome:'http-error'});
  const causes=[];for(let i=0;i<8;i++)causes.push(Object.assign(new Error(secret),{code:'verification-metadata-changed',details:{fields:['id','name','mimeType','parents','appProperties','size','version','trashed'],reason:'metadata-changed'},stack:Array.from({length:12},(_,j)=>`x@https://app.test/repo/js/canonical-workspace.mjs:${j+1}:1`).join('\n')}));
  const originals={};try{for(const key of ['log','warn','error','info','debug']){originals[key]=console[key];console[key]=()=>{throw Error('no logging allowed')}}const report=r.createReport(new AggregateError(causes),{build:'c'.repeat(40)});const output=JSON.stringify(report,null,2);assert.ok(new TextEncoder().encode(output).length<=16384);assert.equal(report.error.chain[0].name,'AggregateError');assert.equal(report.build.commit,'c'.repeat(40));assert.doesNotMatch(output,/PRIVATE/);}finally{Object.assign(console,originals);}
});

test('breadcrumb fields are read once so changing getters cannot inject private values',()=>{
  for(const [event,key,allowed] of [
    ['page.view','page','storage'],['net','online',true],
    ['page.life','event','pagehide'],['page.life','persisted',true]
  ]){
    const r=reporter();let reads=0;
    const input={e:event,...(event==='page.life'?{event:'pagehide',persisted:false}:{})};
    Object.defineProperty(input,key,{get(){return ++reads===1?allowed:secret}});
    r.leaveBreadcrumb(input);
    const report=r.createReport(null);
    assert.equal(reads,1);assert.equal(report.breadcrumbs[0][key],allowed);
    assert.doesNotMatch(JSON.stringify(report),/PRIVATE-CANARY/);
  }
});
test('storage context arrays cannot override slicing/filtering to smuggle fields',()=>{
  const fields=['name',secret,'version'];
  fields.slice=()=>({filter:()=>[secret]});
  fields.filter=()=>[secret];
  fields[Symbol.iterator]=function*(){yield secret;};
  const report=reporter().createReport({code:'verification-metadata-changed',details:{fields}});
  assert.deepEqual(report.error.chain[0].context.fields,['name','version']);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE-CANARY/);
  let reads=0;
  const hostile=new Proxy(new Array(1000000),{get(target,key){if(key==='length')return target.length;if(/^[0-9]+$/.test(String(key))){reads++;return key==='0'?'name':secret;}throw Error(secret)}});
  const limited=reporter().createReport({code:'verification-metadata-changed',details:{fields:hostile}});
  assert.ok(reads<=32);assert.doesNotMatch(JSON.stringify(limited),/PRIVATE-CANARY/);
});
test('V8 header is not interpreted as a Safari frame even when message contains a valid app URL',()=>{
  const stack=`TypeError: private@https://app.test/repo/js/session-coordination.mjs:1:2\n    at save (https://app.test/repo/js/canonical-workspace.mjs:4:5)`;
  assert.deepEqual(parseStack(stack,options).frames,[{file:'js/canonical-workspace.mjs',line:4,col:5}]);
  // Real Safari traces may start immediately with a function frame.
  assert.deepEqual(parseStack('save@https://app.test/repo/js/canonical-workspace.mjs:4:5',options).frames,[{file:'js/canonical-workspace.mjs',line:4,col:5}]);
});
test('status-bus lifecycle context survives before workspace provider registration',()=>{
  const report=reporter().createReport({code:'ownership-unknown'},{surface:'workspace',state:'ownership-unknown'});
  assert.equal(report.state.lifecycle,'ownership-unknown');
  assert.deepEqual(reporter().createReport(null,{state:secret}).state,{});
});

test('a new user action gets fresh failure facts rather than an earlier duplicate report',()=>{
 const r=reporter();r.leaveBreadcrumb({e:'action.start',actionId:'save-ledger'});const a=r.reportError({code:'ownership-unknown'});
 assert.equal(r.reportError({code:'ownership-unknown'}).id,a.id);
 r.leaveBreadcrumb({e:'action.fail',actionId:'save-ledger'});r.leaveBreadcrumb({e:'action.start',actionId:'save-ledger'});
 const b=r.reportError({code:'ownership-unknown',sessionCheck:'coordinator-read-failed'});assert.notEqual(a.id,b.id);
 assert.equal(JSON.parse(b.report).error.chain[0].context.check,'coordinator-read-failed');
});

test('routine input validation does not fill or evict recent problem history',()=>{
 const r=reporter();const serious=r.reportError({code:'write-unresolved'});
 for(let i=0;i<100;i++)r.reportError({code:'category-required'},{actionId:'stage-correction'});
 assert.equal(r.recentReports().length,1);assert.equal(r.getReport(serious.id).id,serious.id);
});

test('current-action request window is separate from lifetime and still allowlisted',async()=>{
 const {createDriveRequestMetrics}=await import('../js/drive-request-metrics.mjs');
 const {validateDiagnosticReport}=await import('../scripts/explain-diagnostic.mjs');
 let t=0;const metrics=createDriveRequestMetrics({now:()=>t});
 const fetch=metrics.wrapFetch(async()=>{t+=10;return {status:200}});
 await fetch();t=200;const window=metrics.openWindow();await fetch();
 const r=reporter();r.registerContextProvider('requests',()=>metrics.snapshot());
 r.registerContextProvider('actionRequests',()=>({...window.snapshot(),token:secret}));
 for(let i=0;i<61;i++)r.leaveBreadcrumb({e:'request',ep:'files.get',m:'get',s:200,ms:i,outcome:'ok'});
 const report=r.createReport({code:'write-unresolved'});
 assert.equal(report.requests.requests,2);assert.equal(report.requests.elapsedMs,210);
 assert.equal(report.actionRequests.requests,1);assert.equal(report.actionRequests.elapsedMs,10);
 assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);validateDiagnosticReport(report);
 r.registerContextProvider('actionRequests',()=>null);assert.equal(r.createReport(null).actionRequests,undefined);
});
