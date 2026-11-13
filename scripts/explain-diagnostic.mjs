import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getEntry} from '../js/error-registry.mjs';
import {safeDiagnosticErrorName,safeDiagnosticOperation} from '../js/app-diagnostic-codes.mjs';
import {sessionClaimDiagnostic} from '../js/session-claim-diagnostic.mjs';
import {ACTIONS,PAGES,SURFACES,PHASES,STATES} from '../js/diagnostic-context.mjs';
import {DIAGNOSTIC_FILES} from '../js/diagnostic-files.mjs';
import {REQUEST_METRIC_FIELDS,safeRequestMetrics} from '../js/drive-request-metrics.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const invalid=()=>{throw new Error('Invalid or unsupported diagnostic report. No source commands were run.');};
const bool=v=>typeof v==='boolean';
const int=(max=Number.MAX_SAFE_INTEGER,min=0)=>v=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const choice=values=>v=>values.includes(v);
const member=set=>v=>set.has(v);
const nullable=check=>v=>v===null||check(v);
const code=v=>getEntry(v)!==null;
function shape(value, fields, required=[]) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(fields,k)))return false;
  if(required.some(k=>!Object.hasOwn(value,k)))return false;
  return Object.entries(value).every(([key,item])=>fields[key](item));
}
const list=(check,max)=>v=>Array.isArray(v)&&v.length<=max&&v.every(check);
const http=nullable(int(599,100));
const context=v=>shape(v,{
  code,check:x=>x==='unknown'||sessionClaimDiagnostic({code:'ownership-unknown',sessionCheck:x})?.check===x,
  create:x=>x==='completed'||code(x),readback:x=>x==='cancelled'||code(x),
  createHttp:http,createVisibilityHttp:http,createVisibilityChecks:nullable(int(100,1)),readbackHttp:http,
  reason:choice(['metadata-changed','content-size-mismatch','metadata-and-size-mismatch','metadata-unstable','object-missing','content-proof-unavailable','revalidation-limit']),
  fields:list(choice(['id','name','mimeType','parents','appProperties','size','version','trashed']),8),
  revalidatedObjects:int(512),revalidatedBytes:int(16*1024*1024),httpStatus:int(599,100),lastHttpStatus:int(599,100),checks:int(100,1),
  operation:x=>safeDiagnosticOperation(x)!==null,transport:choice(['aborted']),browserMessageClass:choice(['load-failed','failed-to-fetch','network-request-failed'])
});
const frame=v=>shape(v,{file:member(new Set(DIAGNOSTIC_FILES)),line:int(9999999,1),col:int(9999999,1)},['file','line','col']);
const chainLink=v=>shape(v,{depth:int(4),name:x=>x==='other'||safeDiagnosticErrorName({name:x})===x,code:nullable(code),context},['depth','name','code','context']);
const ledger=v=>{
  if(!shape(v,{synthetic:bool,accounts:int(2**30),activities:int(2**30),events:int(2**30),stagedChanges:int(2**30),counts:choice(['exact','power-of-two-upper-bound'])},['synthetic','counts']))return false;
  if(v.counts!==(v.synthetic?'exact':'power-of-two-upper-bound'))return false;
  return Object.entries(v).every(([k,n])=>['synthetic','counts'].includes(k)||v.synthetic||n===0||Number.isInteger(Math.log2(n)));
};
function breadcrumb(v){
  const base={t:int(),e:choice(['action.start','action.ok','action.fail','lifecycle.state','page.view','net','vis','page.life','diag.suppressed','request'])};
  const byKind={
    'action.start':{actionId:member(ACTIONS),code},'action.ok':{actionId:member(ACTIONS),code},'action.fail':{actionId:member(ACTIONS),code},
    'lifecycle.state':{state:member(STATES)},'page.view':{page:member(PAGES)},net:{online:bool},vis:{state:choice(['visible','hidden'])},
    'page.life':{event:choice(['pagehide','pageshow','freeze','resume']),persisted:bool},'diag.suppressed':{code,count:int(100000)},
    request:{ep:choice(['unknown','files.get','files.list','files.create','files.update','files.delete','files.generateIds']),m:choice(['get','post','patch','put','delete','head','other']),s:http,ms:int(86400000),outcome:choice(['ok','http-error','network-error','aborted'])}
  };
  if(!v||!Object.hasOwn(byKind,v.e))return false;
  const required=['t','e',...Object.keys(byKind[v.e]).filter(k=>!['code','persisted'].includes(k)||v.e==='diag.suppressed')];
  return shape(v,{...base,...byKind[v.e]},required);
}
const environment=v=>shape(v,{
  ua:x=>shape(x,{engine:choice(['webkit','blink','gecko','other']),os:choice(['ios','android','windows','macos','linux','other']),browser:choice(['safari','chrome','firefox','other']),osMajor:int(999),browserMajor:int(999)}),
  displayMode:choice(['standalone','browser']),online:bool,visibility:choice(['visible','hidden']),secureContext:bool,
  viewport:x=>shape(x,{w:int(16384),h:int(16384),dpr:n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=8}),
  features:x=>shape(x,Object.fromEntries(['clipboard','subtleCrypto','streams'].map(k=>[k,bool]))),
  tzOffsetMin:int(840,-840),lang:x=>typeof x==='string'&&/^[a-z]{2,3}$/.test(x)
});
/** Strict allowlist on every object boundary before reading source or rendering. */
export function validateDiagnosticReport(report){
  const fields={
    schema:choice(['finance-tracker-diagnostic-v2']),reportId:v=>typeof v==='string'&&/^[a-z0-9]{1,40}$/.test(v),
    generatedAt:v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v)),uptimeMs:int(),
    build:v=>shape(v,{commit:x=>x===null||typeof x==='string'&&/^[a-f0-9]{40}$/.test(x),source:choice(['deployed','development'])},['commit','source'])&&(v.commit===null)===(v.source==='development'),
    error:v=>shape(v,{code,area:choice(['drive','session','lifecycle','catalog','paged','backup','import','workspace','csv','startup','diag']),kind:choice(['input','state','integrity','defect']),retryable:bool,writeOutcome:choice(['none','unknown','verified-not-written']),chain:list(chainLink,8),frames:list(frame,12),foreignFrames:int(100000),chainTruncated:bool},['code','area','kind','retryable','writeOutcome','chain','frames','foreignFrames','chainTruncated'])&&v.chain.length>0,
    where:v=>shape(v,{surface:x=>x==='unknown'||SURFACES.has(x),page:member(PAGES),actionId:member(ACTIONS),phase:member(PHASES)},['surface']),
    state:v=>shape(v,{lifecycle:member(STATES),ownership:choice(['owner','not-owner','unknown','released']),busy:bool,dirty:bool,needsReopen:bool,verifiedDurableWrites:int(100000),profile:choice(['canonical5-physical4']),ledger}),
    requests:v=>shape(v,Object.fromEntries(REQUEST_METRIC_FIELDS.map(k=>[k,int()])),REQUEST_METRIC_FIELDS)&&safeRequestMetrics(v)!==null,
    breadcrumbs:list(breadcrumb,60),env:environment,truncated:list(choice(['stack-input','breadcrumbs','frames','chain.context','env.features']),5)
  };
  try{
    if(!shape(report,fields,Object.keys(fields).filter(k=>k!=='requests'))||Buffer.byteLength(JSON.stringify(report,null,2))>16384)invalid();
    // A pasted claim cannot turn an uncertain write into safe permission to retry.
    const entry=getEntry(report.error.code);
    if(report.error.kind!==entry.kind||report.error.area!==entry.area||report.error.retryable!==entry.retryable||report.error.writeOutcome!==entry.writeOutcome)invalid();
    return report;
  }catch{invalid();}
}
export function parseDiagnostic(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>18000)invalid();
  let body=text.trim();
  if(body.startsWith('FT-DIAG v2 |')){const newline=body.indexOf('\n');if(newline<0)invalid();body=body.slice(newline+1).trim();}
  if(body.startsWith('```json\n')&&body.endsWith('```'))body=body.slice(8,-3).trim();
  let report;try{report=JSON.parse(body);}catch{invalid();}
  return validateDiagnosticReport(report);
}
function sourceContext(frame,commit,repoRoot){
  let content,source='working tree (development build or commit unavailable; not exact-build evidence)';
  if(commit){const result=spawnSync('git',['show',`${commit}:${frame.file}`],{cwd:repoRoot,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});if(result.status===0){content=result.stdout;source=`commit ${commit}`;}}
  if(content===undefined){try{const local=path.join(repoRoot,frame.file);if(fs.lstatSync(local).isFile()&&fs.statSync(local).size<=1024*1024)content=fs.readFileSync(local,'utf8');}catch{/* Source may be unavailable; never fetch or checkout. */}}
  if(content===undefined)return `${frame.file}:${frame.line}:${frame.col} — source unavailable locally`;
  const lines=content.split('\n'),start=Math.max(0,frame.line-16),end=Math.min(lines.length,frame.line+15);
  return `${frame.file}:${frame.line}:${frame.col} — ${source}\n`+lines.slice(start,end).map((line,i)=>`${start+i+1}: ${line}`).join('\n');
}
function matchingTests(repoRoot,code){
  const found=[];let entries=[];try{entries=fs.readdirSync(path.join(repoRoot,'tests'),{withFileTypes:true});}catch{return found;}
  for(const entry of entries){if(!entry.isFile()||!entry.name.endsWith('.test.mjs'))continue;const file=path.join(repoRoot,'tests',entry.name);try{if(fs.statSync(file).size<=512000&&fs.readFileSync(file,'utf8').includes(code))found.push(`tests/${entry.name}`);}catch{/* Local lookup only. */}}
  return found.slice(0,40);
}
export function explainDiagnostic(report,{repoRoot=root}={}){
  validateDiagnosticReport(report);
  const lines=[`Diagnostic ${report.reportId}: ${report.error.code}`,`Build: ${report.build.commit||'development; exact commit unavailable'}`,`Action: ${report.where.actionId||'not captured'}; page: ${report.where.page||'not captured'}; surface: ${report.where.surface}`,'','Code meaning:'];
  const codes=[...new Set([report.error.code,...report.error.chain.map(c=>c.code).filter(Boolean)])];
  for(const code of codes){const entry=getEntry(code);lines.push(`- ${code} [${entry.area}/${entry.kind}]: ${entry.message}`,`  Next step: ${entry.userAction} Retryable: ${entry.retryable}; write outcome: ${entry.writeOutcome}.`);}
  lines.push('','Reproduction envelope (facts, not an automatic reproduction):',`State: ${JSON.stringify(report.state)}`,`Environment: ${JSON.stringify(report.env)}`);
  if(report.state.ledger?.synthetic){const large=report.state.ledger.activities>600;lines.push(`Synthetic starting point: ${large?'tests/helpers/dense-ledger-fixture.mjs':'js/synthetic-year-seeder.mjs'}; inspect generator options and match the reported shape. Counts do not recreate the original records.`);}else lines.push('No exact synthetic shape captured. Use invented records; do not request real records to reproduce.');
  if(report.requests)lines.push(`Requests: ${JSON.stringify(report.requests)}`);
  lines.push('','Breadcrumb timeline (milliseconds since page start; delta from preceding event):');
  let previous;for(const event of report.breadcrumbs){const {t,...detail}=event;lines.push(`${t} (+${previous===undefined?0:t-previous}) ${JSON.stringify(detail)}`);previous=t;}
  if(report.breadcrumbs.some(e=>e.e==='vis'&&e.state==='hidden')&&report.breadcrumbs.some(e=>e.e==='request'&&e.outcome==='network-error'))lines.push('Question: did backgrounding interrupt the request? Visibility plus a network error is a clue, not proof of Safari suspension.');
  lines.push('','Source locations:');if(!report.error.frames.length)lines.push('No trusted app frame captured.');
  for(const frame of report.error.frames)lines.push(sourceContext(frame,report.build.commit,repoRoot));
  lines.push('','Tests mentioning the top code:',...(matchingTests(repoRoot,report.error.code).length?matchingTests(repoRoot,report.error.code):['No literal match found; this is not a coverage claim.']));
  lines.push('','Questions before reproducing:','- Can the exact build and action be exercised with invented data?','- Which existing test supports the required fault injection? Inspect it before choosing a harness.');
  if(report.error.writeOutcome==='unknown')lines.push('- A write may have happened. Preserve the folder and verify its state before any retry. This explanation does not authorize recovery or change app decisions.');
  if(report.truncated.length)lines.push(`Report sections truncated: ${report.truncated.join(', ')}.`);
  return lines.join('\n')+'\n';
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const input=process.argv[2]&&process.argv[2]!=='-'?fs.readFileSync(process.argv[2],'utf8'):fs.readFileSync(0,'utf8');process.stdout.write(explainDiagnostic(parseDiagnostic(input)));}
  catch{process.stderr.write('Invalid, oversized or unsupported diagnostic report, or input unavailable. No network access is attempted.\n');process.exitCode=1;}
}
