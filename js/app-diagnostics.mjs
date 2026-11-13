// Compatibility surface: all report construction lives behind one privacy boundary.
import {createDiagnostic,reportError,getReport,recentReports,repeatCount,leaveBreadcrumb} from './error-reporting.mjs';
import {safeSourceFile} from './stack-frames.mjs';
export {createDiagnostic};
export function diagnosticMessage(error){const d=createDiagnostic(error);return `${d.message} Error code: ${d.code}.`;}
const panels=new WeakMap();
export function clearDiagnostic(target){const p=target&&panels.get(target);if(p){p.generation++;p.root.hidden=true;p.root.remove();panels.delete(target);}}
export function showDiagnostic(error,opts={}){
  const {surface='developer-tool',target,document:doc=globalThis.document,navigator:nav=globalThis.navigator,reportId}=opts;
  const diagnostic=getReport(reportId)||reportError(error,{...opts,surface});
  const message=`${diagnostic.message} Error code: ${diagnostic.code}.`;
  if(!target||!doc)return message;
  const existing=panels.get(target);
  if(existing?.id===diagnostic.id){existing.count.textContent=repeatCount(diagnostic.id)>1?`Repeated ${repeatCount(diagnostic.id)} times.`:'';return message;}
  clearDiagnostic(target);
  if(diagnostic.kind==='input')return message;
  const make=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
  const root=make('section');root.className='app-diagnostics';root.setAttribute('aria-label','Safe error diagnostics');
  const urgent=diagnostic.kind==='integrity'||diagnostic.kind==='defect';
  root.setAttribute('role',urgent?'alert':'status');
  if(diagnostic.kind==='defect')root.append(make('h3','This looks like a bug in the app.'));
  root.append(make('p',diagnostic.userAction));
  const details=make('details');details.open=urgent;
  details.append(make('summary','Technical details'));
  const description=make('p','Safe codes, source locations and bounded activity context only. Nothing is sent or saved automatically.');
  const label=make('label','Selectable diagnostics'),report=make('textarea');report.readOnly=true;report.rows=9;report.value=diagnostic.report;report.setAttribute('aria-label','Selectable diagnostics');
  label.append(report);
  const copy=make('button','Copy diagnostics');copy.type='button';copy.className='diagnostic-copy';
  const select=make('button','Select diagnostics');select.type='button';
  const status=make('p');status.setAttribute('role','status');const count=make('p');
  const panel={root,generation:0,id:diagnostic.id,count};panels.set(target,panel);
  const selectReport=()=>{report.focus();report.select();report.setSelectionRange?.(0,report.value.length);};
  select.addEventListener('click',()=>{selectReport();status.textContent='Diagnostics selected. Use your device Copy command.';});
  copy.addEventListener('click',async()=>{
    const generation=panel.generation;copy.disabled=true;
    try{if(!nav?.clipboard?.writeText)throw new Error('clipboard-unavailable');await nav.clipboard.writeText(diagnostic.report);if(generation===panel.generation)status.textContent='Diagnostics copied.';}
    catch{if(generation===panel.generation){selectReport();status.textContent='Automatic copy is unavailable. Diagnostics are selected; use your device Copy command.';}}
    finally{if(generation===panel.generation)copy.disabled=false;}
  });
  details.append(description,label,copy,select);
  root.append(details,count,status);
  if(target.insertAdjacentElement)target.insertAdjacentElement('afterend',root);else doc.body.append(root);
  return message;
}
const installed=new WeakSet();
export function installUnexpectedDiagnostics({window:win=globalThis.window,document:doc=globalThis.document}={}){
  if(!win?.addEventListener||!doc||installed.has(win))return;installed.add(win);let target;
  const display=error=>{if(!doc.body)return;if(!target){target=doc.createElement('p');doc.body.append(target);}target.textContent=showDiagnostic(error,{surface:'developer-tool',target,document:doc});};
  win.addEventListener('error',event=>{
    // Ignore only conclusively foreign resource failures/opaque cross-origin noise.
    let filename,raw,message;try{filename=event?.filename;raw=event?.error;message=event?.message;}catch{ /* best-effort: malformed event */ }
    if(!raw && typeof filename==='string' && filename && !safeSourceFile(filename)){leaveBreadcrumb({e:'diag.suppressed',code:'unexpected-error',count:1});return;}
    if(!raw && message==='Script error.'){leaveBreadcrumb({e:'diag.suppressed',code:'unexpected-error',count:1});return;}
    display(raw||{code:'unexpected-error'});
  });
  win.addEventListener('unhandledrejection',event=>{let reason;try{reason=event.reason;}catch{ /* best-effort */ }display(reason??{code:'unexpected-error'});});
  for(const type of ['online','offline'])win.addEventListener(type,()=>leaveBreadcrumb({e:'net',online:type==='online'}));
  for(const type of ['pagehide','pageshow','freeze','resume'])win.addEventListener(type,event=>leaveBreadcrumb({e:'page.life',event:type,persisted:event?.persisted===true}));
  doc.addEventListener?.('visibilitychange',()=>leaveBreadcrumb({e:'vis',state:doc.visibilityState}));
  const queued=win.__FT_BOOT_DIAGNOSTICS__;
  if(Array.isArray(queued)){if(queued.length)doc.getElementById?.('boot-diagnostic-fallback')?.remove?.();for(const _ of queued.slice(0,10))display({code:'module-load-failed'});queued.length=0;}
}
installUnexpectedDiagnostics();
