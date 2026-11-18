import {fail} from "../js/app-error.mjs";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isRealIsoDate(value) {
  if (typeof value !== "string") return false;
  const m = ISO.exec(value); if (!m) return false;
  const y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]);
  if (y<1 || mo<1 || mo>12) return false;
  const leap=y%4===0 && (y%100!==0 || y%400===0);
  return d>=1 && d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1];
}
function utcDate(year, month, day) { const date = new Date(0); date.setUTCHours(0,0,0,0); date.setUTCFullYear(year,month,day); return date; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[character])); }
function shiftDate(value, days) {
  if (!isRealIsoDate(value)) return null;
  const p=value.split("-").map(Number), d=utcDate(p[0],p[1]-1,p[2]+days);
  if (d.getUTCFullYear()>9999) return null;
  return [d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()].map((v,i)=>String(v).padStart(i?2:4,"0")).join("-");
}
function observed(input) {
  if (!Array.isArray(input)) fail("invalid-options");
  const usable=[], unusable=[];
  input.forEach((item,index)=>{
    const date=typeof item==="string"?item:item?.date;
    const rowReference=item&&typeof item==="object"?(item.rowReference??item.rowOrdinal??item.row??null):null;
    if (isRealIsoDate(date)) usable.push({date,rowReference});
    else unusable.push({index,rowReference});
  });
  return {usable,unusable};
}
function suggestions(context) {
  const source=context.sourceCoverage||{};
  const sourceStart=isRealIsoDate(source.start)?source.start:null;
  const sourceEnd=isRealIsoDate(source.end)?source.end:null;
  const prior=isRealIsoDate(context.priorConfirmedCoverageEnd)?context.priorConfirmedCoverageEnd:null;
  return {
    start:sourceStart||(prior?shiftDate(prior,1):null), end:sourceEnd,
    startSource:sourceStart?"source-metadata":(prior?"day-after-prior-confirmed-end":null),
    endSource:sourceEnd?"source-metadata":null
  };
}
export function evaluateImportCoverage({start,end,observedDates=[]}={}) {
  const dates=observed(observedDates), errors=[];
  if(!isRealIsoDate(start)) errors.push({reason:"invalid-start-date"});
  if(!isRealIsoDate(end)) errors.push({reason:"invalid-end-date"});
  if(isRealIsoDate(start)&&isRealIsoDate(end)&&start>end) errors.push({reason:"reversed-date-range"});
  if(!dates.usable.length) errors.push({reason:"no-usable-transaction-dates"});
  if(dates.unusable.length) errors.push({reason:"unusable-observed-dates"});
  const outside=isRealIsoDate(start)&&isRealIsoDate(end)&&start<=end
    ?dates.usable.filter(x=>x.date<start||x.date>end):[];
  return {valid:!errors.length&&!outside.length,errors,outside,unusableObserved:dates.unusable,
    usableObservedCount:dates.usable.length,observedDates:dates.usable.map(x=>x.date)};
}
export function createImportCoverageModel(initial={}) {
  let context={...initial,observedDates:structuredClone(initial.observedDates||[]),sourceCoverage:initial.sourceCoverage?structuredClone(initial.sourceCoverage):null}, dates=observed(context.observedDates), hint=suggestions(context);
  let start=hint.start||"",end=hint.end||"",confirmed=null,cancelled=false,destroyed=false;
  const active=()=>{if(destroyed) fail("unknown");};
  const invalidate=()=>{confirmed=null;};
  const state=()=>{
    const validation=evaluateImportCoverage({start,end,observedDates:context.observedDates||[]});
    return {start,end,suggestions:{...hint},confirmed:confirmed?structuredClone(confirmed):null,cancelled,
      validation,observed:dates.usable.map(x=>({...x})),unusableObserved:dates.unusable.map(x=>({...x}))};
  };
  return {
    getState(){active();return state();},
    setDates(next={}){active();if(Object.hasOwn(next,"start"))start=next.start;if(Object.hasOwn(next,"end"))end=next.end;invalidate();return state();},
    updateContext(next={}){active();cancelled=false;context={...next,observedDates:structuredClone(next.observedDates||[]),sourceCoverage:next.sourceCoverage?structuredClone(next.sourceCoverage):null};dates=observed(context.observedDates);hint=suggestions(context);start=hint.start||"";end=hint.end||"";invalidate();return state();},
    confirm(){active();if(cancelled)return {status:"cancelled",accepted:false};const validation=evaluateImportCoverage({start,end,observedDates:context.observedDates||[]});
      if(!validation.valid)return {status:"review-required",validation};
      const sorted=[...validation.observedDates].sort();
      confirmed={status:"confirmed",coverage:{start,end,provenance:{kind:"user-confirmed",coverageSource:(isRealIsoDate(context.sourceCoverage?.start)&&isRealIsoDate(context.sourceCoverage?.end)&&start===context.sourceCoverage.start&&end===context.sourceCoverage.end)?"source-metadata":"user-declaration",
        confirmationMethod:"explicit-component-confirmation",sourceMetadata:context.sourceCoverage?structuredClone(context.sourceCoverage):null,
        priorConfirmedCoverageEnd:isRealIsoDate(context.priorConfirmedCoverageEnd)?context.priorConfirmedCoverageEnd:null,
        contextKey:context.contextKey??null}},
        observedDateRange:{start:sorted[0]??null,end:sorted[sorted.length-1]??null}};
      return structuredClone(confirmed);},
    cancel(){active();confirmed=null;cancelled=true;return {status:"cancelled",accepted:false};},
    reset(){active();start=hint.start||"";end=hint.end||"";cancelled=false;invalidate();return state();},
    destroy(){if(destroyed)return;confirmed=null;context={};dates={usable:[],unusable:[]};hint={start:null,end:null};start="";end="";cancelled=false;destroyed=true;}
  };
}
function monthTitle(y,m){return new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric",timeZone:"UTC"}).format(utcDate(y,m,1));}
function calendar(which,value,view) {
  const first=utcDate(view.year,view.month,1), offset=(first.getUTCDay()+6)%7;
  const count=utcDate(view.year,view.month+1,0).getUTCDate(), cells=[];
  for(let i=0;i<offset;i++)cells.push("<span class='ics-day empty' aria-hidden='true'></span>");
  for(let day=1;day<=count;day++){
    const date=[view.year,view.month+1,day].map((v,i)=>String(v).padStart(i?2:4,"0")).join("-");
    const selected=date===value, label=new Intl.DateTimeFormat(undefined,{dateStyle:"full",timeZone:"UTC"}).format(utcDate(view.year,view.month,day));
    cells.push("<button type='button' class='ics-day"+(selected?" selected":"")+"' data-date='"+date+"' data-for='"+which+"' aria-pressed='"+selected+"' aria-label='"+label+"'>"+day+"</button>");
  }
  return "<section class='ics-calendar' aria-label='"+which+" date calendar'><header><button type='button' data-month='"+which+"' data-step='-1' aria-label='Previous "+which+" month'>‹</button><h3>"+monthTitle(view.year,view.month)+"</h3><button type='button' data-month='"+which+"' data-step='1' aria-label='Next "+which+" month'>›</button></header><div class='ics-weekdays' aria-hidden='true'><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class='ics-grid'>"+cells.join("")+"</div></section>";
}
export function mountImportCoverageSelector({container,observedDates=[],sourceCoverage=null,priorConfirmedCoverageEnd=null,contextKey=null,onConfirm=()=>{},onCancel=()=>{},onInvalidate=()=>{}}={}) {
  if(!container||typeof container.addEventListener!=="function")fail("invalid-options");
  const model=createImportCoverageModel({observedDates,sourceCoverage,priorConfirmedCoverageEnd,contextKey});
  const now=new Date(), monthFor=value=>isRealIsoDate(value)?{year:+value.slice(0,4),month:+value.slice(5,7)-1}:{year:now.getFullYear(),month:now.getMonth()};
  const initial=model.getState(),views={start:monthFor(initial.start),end:monthFor(initial.end)};let disposed=false;
  const notifyInvalidation=(reason,previous)=>{if(previous)onInvalidate({status:"invalidated",reason,previous});};
  const resetSelection=focus=>{const previous=model.getState().confirmed;model.reset();const s=model.getState();views.start=monthFor(s.start);views.end=monthFor(s.end);notifyInvalidation("reset",previous);render(focus);};
  const render=focus=>{
    if(disposed)return;const s=model.getState(),v=s.validation;
    const messages=v.errors.map(x=>({ "invalid-start-date":"Enter a real calendar start date.","invalid-end-date":"Enter a real calendar end date.","reversed-date-range":"Start must be on or before end.","no-usable-transaction-dates":"No usable transaction dates were supplied; review is required.","unusable-observed-dates":"Some supplied transaction dates are unusable; review is required."}[x.reason]));
    const outside=v.outside.map(x=>"<li>"+x.date+(x.rowReference===null?"":" (row "+escapeHtml(x.rowReference)+")")+"</li>").join("");
    const hints=[s.suggestions.start?"Suggested start: "+s.suggestions.start+" ("+s.suggestions.startSource+")":"",s.suggestions.end?"Suggested end: "+s.suggestions.end+" ("+s.suggestions.endSource+")":""].filter(Boolean).join(" · ");
    container.innerHTML="<div class='ics'><header><h2>Declare import coverage</h2><p>Choose the inclusive dates this file is intended to cover. Suggestions are not confirmation.</p></header><p class='ics-hints' aria-live='polite'>"+(hints||"No suggestions available.")+"</p><div class='ics-fields'><label>Start date (inclusive)<input type='date' data-field='start' value='"+s.start+"'></label><label>End date (inclusive)<input type='date' data-field='end' value='"+s.end+"'></label></div><div class='ics-calendars'>"+calendar("start",s.start,views.start)+calendar("end",s.end,views.end)+"</div><section class='ics-review' aria-live='polite'><h3>Coverage review</h3><p>"+v.usableObservedCount+" usable transaction date(s) observed. Observed dates do not prove completeness.</p>"+(messages.length?"<ul class='ics-errors'>"+messages.map(x=>"<li>"+x+"</li>").join("")+"</ul>":"")+(outside?"<p>Out-of-range transaction dates; rows are retained for review:</p><ul>"+outside+"</ul>":"")+(v.unusableObserved.length?"<p>"+v.unusableObserved.length+" unusable date value(s) require review.</p>":"")+(s.confirmed?"<p role='status'>Coverage explicitly confirmed.</p>":"")+"</section><footer><button type='button' data-action='reset'>Reset suggestions</button><button type='button' data-action='cancel'>Cancel</button><button type='button' data-action='confirm' "+(v.valid&&!s.cancelled?"":"disabled")+">Confirm coverage</button></footer></div>";
    if(focus)container.querySelector(focus)?.focus();
  };
  const click=e=>{
    const b=e.target.closest("button");if(!b||!container.contains(b))return;
    if(b.dataset.month){const v=views[b.dataset.month],d=utcDate(v.year,v.month+Number(b.dataset.step),1);v.year=d.getUTCFullYear();v.month=d.getUTCMonth();render('[data-month="'+b.dataset.month+'"][data-step="'+b.dataset.step+'"]');}
    else if(b.dataset.date){const k=b.dataset.for,previous=model.getState().confirmed;model.setDates({[k]:b.dataset.date});views[k]=monthFor(b.dataset.date);notifyInvalidation("date-edit",previous);render('[data-field="'+k+'"]');}
    else if(b.dataset.action==="reset"){resetSelection('[data-action=reset]');}
    else if(b.dataset.action==="cancel"){const previous=model.getState().confirmed,r=model.cancel();notifyInvalidation("cancelled",previous);onCancel(r);render('[data-action=cancel]');}
    else if(b.dataset.action==="confirm"){const r=model.confirm();if(r.status==="confirmed")onConfirm(r);render('[data-action=confirm]');}
  };
  const change=e=>{const k=e.target.dataset?.field;if(k==="start"||k==="end"){const previous=model.getState().confirmed;model.setDates({[k]:e.target.value});if(isRealIsoDate(e.target.value))views[k]=monthFor(e.target.value);notifyInvalidation("date-edit",previous);render('[data-field="'+k+'"]');}};
  const keydown=e=>{
    const b=e.target.closest?.(".ics-day[data-date]");if(!b||!container.contains(b))return;
    const weekday=(new Date(b.dataset.date+"T00:00:00Z").getUTCDay()+6)%7;
    const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday};
    if(Object.hasOwn(moves,e.key)){e.preventDefault();const d=shiftDate(b.dataset.date,moves[e.key]),k=b.dataset.for;views[k]=monthFor(d);render('[data-date="'+d+'"][data-for="'+k+'"]');}
    else if(e.key==="PageUp"||e.key==="PageDown"){e.preventDefault();const k=b.dataset.for,v=views[k],d=utcDate(v.year,v.month+(e.key==="PageUp"?-1:1),1);views[k]={year:d.getUTCFullYear(),month:d.getUTCMonth()};render('[data-for="'+k+'"][data-date^="'+String(d.getUTCFullYear()).padStart(4,"0")+'-'+String(d.getUTCMonth()+1).padStart(2,"0")+'"]');}
  };
  container.addEventListener("click",click);container.addEventListener("change",change);container.addEventListener("keydown",keydown);render();
  return {getState:()=>model.getState(),updateContext(next){if(disposed)fail("unknown");const previous=model.getState().confirmed;model.updateContext(next);const s=model.getState();views.start=monthFor(s.start);views.end=monthFor(s.end);notifyInvalidation("context-replaced",previous);render();},reset(){if(!disposed)resetSelection();},destroy(){if(disposed)return;const previous=model.getState().confirmed;container.removeEventListener("click",click);container.removeEventListener("change",change);container.removeEventListener("keydown",keydown);container.replaceChildren();model.destroy();disposed=true;notifyInvalidation("destroyed",previous);}};
}
