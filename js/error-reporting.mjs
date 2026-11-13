import {getEntry} from './error-registry.mjs';
import {safeDiagnosticErrorName, safeDiagnosticOperation} from './app-diagnostic-codes.mjs';
import {storageWriteDiagnostic} from './storage-write-diagnostic.mjs';
import {sessionClaimDiagnostic} from './session-claim-diagnostic.mjs';
import {parseStack} from './stack-frames.mjs';
import {read,integer,ACTIONS,PAGES,SURFACES,PHASES,STATES,safeWorkspace,diagnosticEnvironment} from './diagnostic-context.mjs';
import {safeRequestMetrics} from './drive-request-metrics.mjs';

const BUDGET=16384;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value,null,2)).length;
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function codeOf(value){
  const code=read(value,'code');if(getEntry(code))return code;
  // Compatibility for existing validators; only a registry literal can pass.
  const message=read(value,'name')==='TypeError'?read(value,'message'):null;
  return getEntry(message)?message:null;
}
function chainOf(error){
  const seen=new Set(),queue=[{value:error,depth:0}],chain=[];let truncated=false;
  while(queue.length && chain.length<8){
    const {value,depth}=queue.shift();
    if(value===null||value===undefined||seen.has(value))continue;
    seen.add(value);chain.push({value,depth});
    if(depth>=4){if(read(value,'cause'))truncated=true;continue;}
    const nested=[read(value,'cause')],details=read(value,'details');
    for(const key of ['failure','guardFailure','createError','readbackError','readFailure'])nested.push(read(details,key));
    const aggregate=read(value,'errors');
    try{if(Array.isArray(aggregate)){const n=Math.min(8,integer(read(aggregate,'length'),1e7)??0);for(let i=0;i<n;i++)nested.push(read(aggregate,i));if(aggregate.length>n)truncated=true;}}catch{ /* best-effort: hostile AggregateError */ }
    for(const item of nested)if(item!==undefined&&item!==null&&queue.length<24)queue.push({value:item,depth:depth+1});
  }
  return {chain,truncated:truncated||queue.length>0};
}
function typedContext(error){
  // These existing formatters construct their own fixed fields; never spread details.
  const result=storageWriteDiagnostic(error)||sessionClaimDiagnostic(error)||{};
  const context={...result};
  const operation=safeDiagnosticOperation(read(read(error,'details'),'operation'));if(operation)context.operation=operation;
  const name=read(error,'name');
  if(name==='AbortError')context.transport='aborted';
  else if(name==='TypeError'){
    const message=read(error,'message');
    const classification=message==='Load failed'?'load-failed':message==='Failed to fetch'?'failed-to-fetch':message==='Network request failed'?'network-request-failed':null;
    if(classification)context.browserMessageClass=classification;
  }
  return context;
}
function whereOf(opts,activeAction,currentPage){
  const surface=read(opts,'surface'),out={surface:SURFACES.has(surface)?surface:'unknown'};
  for(const [key,set,fallback] of [['actionId',ACTIONS,activeAction],['page',PAGES,currentPage],['phase',PHASES,null]]){const value=read(opts,key)??fallback;if(set.has(value))out[key]=value;}
  return out;
}
function buildOf(opts){
  const input=read(opts,'build')??read(globalThis,'__FT_BUILD__');
  const commit=typeof input==='string'?input:read(input,'commit');
  return typeof commit==='string'&&/^[a-f0-9]{40}$/.test(commit)?{commit,source:'deployed'}:{commit:null,source:'development'};
}
function trim(report){
  const mark=section=>{if(!report.truncated.includes(section))report.truncated.push(section);};
  while(bytes(report)>BUDGET && report.breadcrumbs.length){report.breadcrumbs.shift();mark('breadcrumbs');}
  while(bytes(report)>BUDGET && report.error.frames.length>2){report.error.frames.splice(Math.min(8,report.error.frames.length-2),1);mark('frames');}
  if(bytes(report)>BUDGET){for(const item of report.error.chain)item.context={};mark('chain.context');}
  if(bytes(report)>BUDGET){delete report.env.features;mark('env.features');}
  return report;
}
function safeEvent(input,t){
  const e=read(input,'e'),out={t,e};
  const actionId=read(input,'actionId'),code=read(input,'code'),state=read(input,'state'),page=read(input,'page'),online=read(input,'online'),event=read(input,'event'),persisted=read(input,'persisted');
  switch(e){
    case 'action.start':case 'action.ok':case 'action.fail':if(!ACTIONS.has(actionId))return null;out.actionId=actionId;if(getEntry(code))out.code=code;break;
    case 'lifecycle.state':if(!STATES.has(state))return null;out.state=state;break;
    case 'page.view':if(!PAGES.has(page))return null;out.page=page;break;
    case 'net':if(typeof online!=='boolean')return null;out.online=online;break;
    case 'vis':if(!['visible','hidden'].includes(state))return null;out.state=state;break;
    case 'page.life':if(!['pagehide','pageshow','freeze','resume'].includes(event))return null;out.event=event;if(typeof persisted==='boolean')out.persisted=persisted;break;
    case 'diag.suppressed':if(!getEntry(code))return null;out.code=code;out.count=integer(read(input,'count'),100000)??1;break;
    case 'request':{
      const ep=read(input,'ep'),m=read(input,'m'),s=read(input,'s'),ms=integer(read(input,'ms'),86400000),outcome=read(input,'outcome');
      if(!['unknown','files.get','files.list','files.create','files.update','files.delete','files.generateIds'].includes(ep)||!['get','post','patch','put','delete','head','other'].includes(m)||ms===undefined||!['ok','http-error','network-error','aborted'].includes(outcome))return null;
      if(s!==null&&(!Number.isInteger(s)||s<100||s>599))return null;
      Object.assign(out,{ep,m,s,ms,outcome});break;
    }
    default:return null;
  }
  return out;
}
/** Separate instances make clocks/history deterministic in tests; the application uses one. */
export function createReporter({now=()=>Date.now(),uptime=()=>globalThis.performance?.now()??0,random=()=>globalThis.crypto?.getRandomValues(new Uint8Array(6)),environment=()=>diagnosticEnvironment(),appBase}={}){
  const breadcrumbs=[],history=[],providers=new Map();let sequence=0,actionSequence=0,activeAction=null,currentPage=null;
  const clock=()=>{try{return Math.round(integer(Math.floor(uptime()),Number.MAX_SAFE_INTEGER)??0);}catch{return 0;}};
  const id=()=>{sequence++;try{const data=random();if(data&&read(data,'length')===6){let value='';for(let i=0;i<6;i++){const v=read(data,i);value+=Number.isInteger(v)&&v>=0&&v<=255?v.toString(36).padStart(2,'0'):'00';}return value+sequence.toString(36);}}catch{ /* best-effort: deterministic fallback */ }return 'r'+sequence.toString(36);};
  const leaveBreadcrumb=input=>{try{const event=safeEvent(input,clock());if(!event)return;if(event.e==='action.start'){activeAction=event.actionId;actionSequence++;}if(event.e==='action.ok'||event.e==='action.fail')activeAction=null;if(event.e==='page.view')currentPage=event.page;const last=breadcrumbs.at(-1);if(last&&JSON.stringify({...last,t:0})===JSON.stringify({...event,t:0}))last.t=event.t;else breadcrumbs.push(event);if(breadcrumbs.length>60)breadcrumbs.shift();}catch{ /* best-effort: observation never changes actions */ }};
  const registerContextProvider=(name,fn)=>{if(!['workspace','requests','actionRequests'].includes(name)||typeof fn!=='function')return ()=>{};providers.set(name,fn);return ()=>{if(providers.get(name)===fn)providers.delete(name);};};
  const createReport=(error,opts={})=>{
    const walked=chainOf(error),selected=walked.chain.map(({value})=>codeOf(value)).find(Boolean)||'unknown',entry=getEntry(selected)||getEntry('unknown');
    const frames=[];let foreignFrames=0,stackTruncated=false;
    for(const {value} of walked.chain){const parsed=parseStack(read(value,'stack'),{appBase});for(const frame of parsed.frames)if(frames.length<12&&!frames.some(f=>f.file===frame.file&&f.line===frame.line&&f.col===frame.col))frames.push(frame);foreignFrames+=parsed.foreignFrames;stackTruncated ||= parsed.truncated;}
    let date='1970-01-01T00:00:00.000Z';try{const n=now();if(typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=8.64e15)date=new Date(n).toISOString();}catch{ /* best-effort: clock unavailable */ }
    const state={};const lifecycle=read(opts,'state');if(STATES.has(lifecycle))state.lifecycle=lifecycle;let requests,actionRequests;
    for(const [name,fn] of providers){try{const value=fn();if(name==='workspace')Object.assign(state,safeWorkspace(value));else if(name==='actionRequests')actionRequests=safeRequestMetrics(value)||undefined;else requests=safeRequestMetrics(value)||undefined;}catch{ /* best-effort: context cannot break reports */ }}
    const writes=integer(read(opts,'verifiedDurableWrites'),100000);if(writes!==undefined)state.verifiedDurableWrites=writes;
    // The injectable environment function supplies browser-like objects, not a schema escape hatch.
    let env={};try{env=environment===defaultEnvironment?diagnosticEnvironment():sanitizeEnvironment(environment());}catch{ /* best-effort */ }
    const report={schema:'finance-tracker-diagnostic-v2',reportId:id(),generatedAt:date,uptimeMs:clock(),build:buildOf(opts),error:{code:selected,area:entry?.area||'diag',kind:entry?.kind||'defect',retryable:false,writeOutcome:entry?.writeOutcome||'unknown',chain:walked.chain.map(({value,depth})=>({depth,name:safeDiagnosticErrorName(value)||'other',code:codeOf(value),context:typedContext(value)})),frames,foreignFrames,chainTruncated:walked.truncated},where:whereOf(opts,activeAction,currentPage),state,...(requests?{requests}:{}),...(actionRequests?{actionRequests}:{}),breadcrumbs:breadcrumbs.map(x=>({...x})),env,truncated:stackTruncated?['stack-input']:[]};
    if(!report.error.chain.length)report.error.chain.push({depth:0,name:'other',code:null,context:{}});
    return freeze(trim(report));
  };
  const asDiagnostic=report=>{const entry=getEntry(report.error.code)||getEntry('unknown');const surface=report.where.surface;return freeze({id:report.reportId,code:report.error.code,kind:report.error.kind,message:entry?.messages?.[surface]||entry?.message||'The action did not complete.',userAction:entry?.userAction||'Copy diagnostics before retrying.',report:JSON.stringify(report,null,2)});};
  const createDiagnostic=(error,opts)=>asDiagnostic(createReport(error,opts));
  const reportError=(error,opts)=>{
    const diagnostic=createDiagnostic(error,opts),data=JSON.parse(diagnostic.report),top=data.error.frames[0];
    if(diagnostic.kind==='input'){leaveBreadcrumb({e:'action.fail',actionId:data.where.actionId,code:diagnostic.code});return diagnostic;}
    const key=JSON.stringify([actionSequence,diagnostic.code,top||null,data.where.surface,data.where.actionId||null]);
    const prior=history.find(item=>item.key===key&&data.uptimeMs-item.time>=0&&data.uptimeMs-item.time<=30000);
    if(prior){prior.count++;leaveBreadcrumb({e:'diag.suppressed',code:diagnostic.code,count:prior.count});return prior.handle;}
    history.push({key,time:data.uptimeMs,count:1,handle:diagnostic});if(history.length>10)history.shift();return diagnostic;
  };
  return Object.freeze({createReport,createDiagnostic,reportError,leaveBreadcrumb,registerContextProvider,getReport:reportId=>history.find(x=>x.handle.id===reportId)?.handle||null,recentReports:()=>Object.freeze(history.map(x=>x.handle)),repeatCount:reportId=>history.find(x=>x.handle.id===reportId)?.count||1});
}
function sanitizeEnvironment(value){
  const out={};const ua=read(value,'ua');if(ua){out.ua={};for(const [k,choices] of Object.entries({engine:['webkit','blink','gecko','other'],os:['ios','android','windows','macos','linux','other'],browser:['safari','chrome','firefox','other']})){const v=read(ua,k);if(choices.includes(v))out.ua[k]=v;}for(const k of ['osMajor','browserMajor']){const v=read(ua,k);if(integer(v,999)!==undefined)out.ua[k]=v;}}
  for(const [k,choices] of Object.entries({displayMode:['standalone','browser'],visibility:['visible','hidden']})){const v=read(value,k);if(choices.includes(v))out[k]=v;}
  for(const k of ['online','secureContext']){const v=read(value,k);if(typeof v==='boolean')out[k]=v;}
  const viewport=read(value,'viewport');if(viewport){out.viewport={};for(const k of ['w','h']){const v=read(viewport,k);if(integer(v,16384)!==undefined)out.viewport[k]=v;}const dpr=read(viewport,'dpr');if(typeof dpr==='number'&&Number.isFinite(dpr)&&dpr>0&&dpr<=8)out.viewport.dpr=dpr;}
  const features=read(value,'features');if(features){out.features={};for(const k of ['clipboard','subtleCrypto','streams']){const v=read(features,k);if(typeof v==='boolean')out.features[k]=v;}}
  const tz=read(value,'tzOffsetMin'),lang=read(value,'lang');if(Number.isInteger(tz)&&Math.abs(tz)<=840)out.tzOffsetMin=tz;if(typeof lang==='string'&&/^[a-z]{2,3}$/.test(lang))out.lang=lang;
  return out;
}
const defaultEnvironment=()=>diagnosticEnvironment();
const shared=createReporter({environment:defaultEnvironment});
export const {createReport,createDiagnostic,reportError,leaveBreadcrumb,registerContextProvider,getReport,recentReports,repeatCount}=shared;
