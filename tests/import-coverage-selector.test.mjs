import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createImportCoverageModel,evaluateImportCoverage,isRealIsoDate,mountImportCoverageSelector} from "../components/import-coverage-selector.mjs";
import {AppError} from "../js/app-error.mjs";
import {ERRORS} from "../js/error-registry.mjs";
import {scanSource} from "../scripts/audit-error-codes.mjs";
test("real Gregorian dates and leap centuries",()=>{assert.equal(isRealIsoDate("2024-02-29"),true);assert.equal(isRealIsoDate("2000-02-29"),true);assert.equal(isRealIsoDate("1900-02-29"),false);assert.equal(isRealIsoDate("2023-02-29"),false);assert.equal(isRealIsoDate("2024-04-31"),false);assert.equal(isRealIsoDate("0000-01-01"),false);});
test("invalid and reversed declarations require review",()=>{for(const [start,end,code] of [["","2024-01-31","invalid-start-date"],["2024-02-30","2024-03-01","invalid-start-date"],["2024-01-01","2024-02-30","invalid-end-date"],["2024-02-02","2024-02-01","reversed-date-range"]])assert.ok(evaluateImportCoverage({start,end,observedDates:["2024-01-15"]}).errors.some(x=>x.code===code));});
test("inclusive boundaries are valid",()=>{const r=evaluateImportCoverage({start:"2024-01-01",end:"2024-01-31",observedDates:["2024-01-01","2024-01-31"]});assert.equal(r.valid,true);assert.deepEqual(r.outside,[]);});
test("all out-of-range dates and row references remain visible",()=>{const r=evaluateImportCoverage({start:"2024-02-01",end:"2024-02-29",observedDates:[{date:"2024-01-31",rowReference:4},{date:"2024-03-01",rowReference:8},{date:"2024-03-02",rowOrdinal:11}]});assert.equal(r.outside.length,3);assert.deepEqual(r.outside.map(x=>x.rowReference),[4,8,11]);});
test("no usable dates and malformed observed dates require review",()=>{for(const observedDates of [[],["bad"]])assert.equal(evaluateImportCoverage({start:"2024-01-01",end:"2024-01-31",observedDates}).valid,false);});
test("metadata suggestions are editable and never pre-confirmed",()=>{const m=createImportCoverageModel({observedDates:["2024-01-01"],sourceCoverage:{start:"2024-01-01",end:"2024-01-31"}});assert.equal(m.getState().confirmed,null);assert.equal(m.getState().start,"2024-01-01");const result=m.confirm();assert.equal(result.status,"confirmed");assert.equal(result.coverage.provenance.coverageSource,"source-metadata");});
test("prior confirmed end suggests the following start only",()=>{const m=createImportCoverageModel({observedDates:["2024-02-01"],priorConfirmedCoverageEnd:"2024-01-31"});assert.equal(m.getState().start,"2024-02-01");assert.equal(m.getState().end,"");assert.equal(m.confirm().status,"review-required");});
test("observed min/max never become declared defaults",()=>{const m=createImportCoverageModel({observedDates:["2024-01-02","2024-01-28"]});assert.equal(m.getState().start,"");assert.equal(m.getState().end,"");});
test("explicit confirmation returns provenance",()=>{const m=createImportCoverageModel({observedDates:["2024-01-01"],contextKey:"fake-file"});m.setDates({start:"2024-01-01",end:"2024-01-31"});const r=m.confirm();assert.equal(r.status,"confirmed");assert.equal(r.coverage.provenance.kind,"user-confirmed");assert.equal(r.coverage.provenance.coverageSource,"user-declaration");assert.equal(r.coverage.provenance.contextKey,"fake-file");assert.deepEqual(r.observedDateRange,{start:"2024-01-01",end:"2024-01-01"});});
test("edits invalidate confirmation and cannot hide discrepancies",()=>{const m=createImportCoverageModel({observedDates:["2024-01-01"]});m.setDates({start:"2024-01-01",end:"2024-01-31"});assert.equal(m.confirm().status,"confirmed");m.setDates({end:"2023-12-31"});assert.equal(m.getState().confirmed,null);assert.equal(m.confirm().status,"review-required");});
test("context replacement clears old confirmation and reapplies suggestions",()=>{const m=createImportCoverageModel({observedDates:["2024-01-01"]});m.setDates({start:"2024-01-01",end:"2024-01-31"});m.confirm();m.updateContext({observedDates:["2024-02-01"],sourceCoverage:{start:"2024-02-01",end:"2024-02-29"}});assert.equal(m.getState().confirmed,null);assert.equal(m.getState().start,"2024-02-01");});
test("cancel accepts nothing; reset clears confirmation",()=>{const m=createImportCoverageModel({observedDates:["2024-01-01"],sourceCoverage:{start:"2024-01-01",end:"2024-01-31"}});m.confirm();assert.deepEqual(m.cancel(),{status:"cancelled",accepted:false});assert.equal(m.getState().confirmed,null);m.setDates({start:"2023-12-01"});m.reset();assert.equal(m.getState().start,"2024-01-01");assert.equal(m.getState().confirmed,null);});
test("destroy is idempotent and clears access to state",()=>{const m=createImportCoverageModel({observedDates:["2024-01-01"]});m.destroy();m.destroy();assert.throws(()=>m.getState(),/coverage-model-destroyed/);});
test("caller inputs are not mutated",()=>{const observedDates=[{date:"2024-01-01",rowReference:3}],sourceCoverage={start:"2024-01-01",end:"2024-01-31"};const before=structuredClone({observedDates,sourceCoverage});const m=createImportCoverageModel({observedDates,sourceCoverage});m.setDates({start:"2024-01-01",end:"2024-01-31"});m.confirm();m.updateContext({observedDates:["2024-02-01"]});assert.deepEqual({observedDates,sourceCoverage},before);});

test("caller mutation after mount cannot rewrite the captured file context",()=>{const observedDates=["2024-01-01"],sourceCoverage={start:"2024-01-01",end:"2024-01-31"};const m=createImportCoverageModel({observedDates,sourceCoverage});observedDates[0]="2024-03-01";sourceCoverage.start="2024-03-01";assert.equal(m.getState().observed[0].date,"2024-01-01");assert.equal(m.getState().start,"2024-01-01");});

test("cancelled selection cannot be confirmed again until reset or context replacement",()=>{const m=createImportCoverageModel({observedDates:["2024-01-01"],sourceCoverage:{start:"2024-01-01",end:"2024-01-31"}});assert.equal(m.cancel().accepted,false);assert.equal(m.confirm().status,"cancelled");m.reset();assert.equal(m.confirm().status,"confirmed");});

class TestContainer {
  constructor(){this.listeners=new Map();this.innerHTML="";this.focused=null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  contains(){return true;}
  querySelector(){return {focus:()=>{this.focused=true;}};}
  replaceChildren(){this.innerHTML="";}
  dispatch(type,event){for(const fn of this.listeners.get(type)||[])fn(event);}
}
test("mounting renders labeled independent calendars and disposal detaches all listeners",async()=>{const {mountImportCoverageSelector}=await import("../components/import-coverage-selector.mjs");const a=new TestContainer(),b=new TestContainer();const one=mountImportCoverageSelector({container:a,observedDates:["2024-02-01"],sourceCoverage:{start:"2024-02-01",end:"2024-02-29"}});const two=mountImportCoverageSelector({container:b,observedDates:["2024-03-01"]});assert.equal([...a.listeners.values()].reduce((n,s)=>n+s.size,0),3);assert.match(a.innerHTML,/Start date \(inclusive\)/);assert.match(a.innerHTML,/End date \(inclusive\)/);assert.match(a.innerHTML,/start date calendar/);assert.match(a.innerHTML,/end date calendar/);one.destroy();one.destroy();assert.equal([...a.listeners.values()].reduce((n,s)=>n+s.size,0),0);assert.equal(a.innerHTML,"");assert.equal([...b.listeners.values()].reduce((n,s)=>n+s.size,0),3);two.destroy();assert.equal([...b.listeners.values()].reduce((n,s)=>n+s.size,0),0);});
test("calendar keyboard navigation moves focus and keeps calendar controls accessible",async()=>{const {mountImportCoverageSelector}=await import("../components/import-coverage-selector.mjs");const c=new TestContainer();const instance=mountImportCoverageSelector({container:c,observedDates:["2024-02-01"],sourceCoverage:{start:"2024-02-01",end:"2024-02-29"}});let prevented=false;const target={dataset:{date:"2024-02-01",for:"start"},closest(){return this;}};c.dispatch("keydown",{target,key:"ArrowRight",preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(c.focused,true);assert.match(c.innerHTML,/data-date='2024-02-02' data-for='start'/);assert.match(c.innerHTML,/aria-label='Previous start month'/);instance.destroy();});

test("narrow layout and touch target rules are present",()=>{const css=readFileSync(new URL("../components/import-coverage-selector.css",import.meta.url),"utf8");assert.match(css,/min-height:44px/);assert.match(css,/@media\(max-width:620px\)/);assert.match(css,/grid-template-columns:1fr/);});

test("editing metadata suggestions records a user declaration",()=>{const m=createImportCoverageModel({observedDates:["2024-01-01"],sourceCoverage:{start:"2024-01-01",end:"2024-01-31"}});m.setDates({end:"2024-01-30"});assert.equal(m.confirm().coverage.provenance.coverageSource,"user-declaration");});


function clickButton(container,dataset) {
  const button={dataset,closest(){return this;}};
  container.dispatch("click",{target:button});
}
function calendarSection(html,which) {
  const marker="<section class='ics-calendar' aria-label='"+which+" date calendar'>";
  const start=html.indexOf(marker);
  assert.notEqual(start,-1,"missing "+which+" calendar");
  const contentStart=start+marker.length,end=html.indexOf("</section>",contentStart);
  assert.notEqual(end,-1,"unterminated "+which+" calendar");
  return html.slice(contentStart,end);
}
test("rendered reset restores both independently navigated calendar views",()=>{
  const container=new TestContainer();
  const selector=mountImportCoverageSelector({container,observedDates:["2024-02-01"],sourceCoverage:{start:"2024-02-01",end:"2024-02-29"}});
  clickButton(container,{month:"start",step:"1"});
  clickButton(container,{month:"end",step:"-1"});
  assert.match(calendarSection(container.innerHTML,"start"),/March 2024/);
  assert.match(calendarSection(container.innerHTML,"end"),/January 2024/);
  clickButton(container,{action:"reset"});
  assert.match(calendarSection(container.innerHTML,"start"),/February 2024/);
  assert.match(calendarSection(container.innerHTML,"end"),/February 2024/);
  assert.match(calendarSection(container.innerHTML,"start"),/data-date='2024-02-01'/);
  assert.match(calendarSection(container.innerHTML,"end"),/data-date='2024-02-29'/);
  clickButton(container,{month:"start",step:"1"});
  clickButton(container,{month:"end",step:"-1"});
  selector.reset();
  assert.match(calendarSection(container.innerHTML,"start"),/February 2024/);
  assert.match(calendarSection(container.innerHTML,"end"),/February 2024/);
  selector.destroy();
});
test("mounted selector notifies caller when confirmation is invalidated by edit, reset, or context replacement",()=>{
  const container=new TestContainer(),events=[];
  let accepted=null;
  const selector=mountImportCoverageSelector({
    container,observedDates:["2024-01-01"],sourceCoverage:{start:"2024-01-01",end:"2024-01-31"},
    onConfirm:result=>{accepted=result;},
    onInvalidate:event=>{events.push(event);accepted=null;}
  });
  clickButton(container,{action:"confirm"});
  assert.equal(accepted.status,"confirmed");
  container.dispatch("change",{target:{dataset:{field:"end"},value:"2024-01-30"}});
  assert.equal(accepted,null);
  assert.equal(events.at(-1).reason,"date-edit");
  assert.equal(events.at(-1).previous.status,"confirmed");
  assert.equal(events.at(-1).previous.coverage.end,"2024-01-31");
  clickButton(container,{action:"confirm"});
  assert.equal(accepted.status,"confirmed");
  clickButton(container,{action:"reset"});
  assert.equal(accepted,null);
  assert.equal(events.at(-1).reason,"reset");
  clickButton(container,{action:"confirm"});
  assert.equal(accepted.status,"confirmed");
  selector.updateContext({observedDates:["2024-02-01"],sourceCoverage:{start:"2024-02-01",end:"2024-02-29"},contextKey:"new-synthetic-file"});
  assert.equal(accepted,null);
  assert.equal(events.at(-1).reason,"context-replaced");
  assert.equal(events.length,3);
  selector.destroy();
});
test("component validation and lifecycle errors use registered AppError codes",()=>{
  assert.throws(()=>evaluateImportCoverage({observedDates:null}),error=>error instanceof AppError&&error.code==="invalid-options");
  const model=createImportCoverageModel({observedDates:["2024-01-01"]});
  model.destroy();
  assert.throws(()=>model.getState(),error=>error instanceof AppError&&error.code==="unknown");
  assert.throws(()=>mountImportCoverageSelector({container:null}),error=>error instanceof AppError&&error.code==="invalid-options");
});

test("component fail sites are registered and follow the repository diagnostic scanner",()=>{const source=readFileSync(new URL("../components/import-coverage-selector.mjs",import.meta.url),"utf8");const {sites,dynamic}=scanSource(source,"components/import-coverage-selector.mjs");assert.deepEqual(dynamic,[]);assert.ok(sites.length>=4);for(const site of sites)assert.ok(Object.hasOwn(ERRORS,site.code),site.code);assert.doesNotMatch(source,/throw\s+(?:new\s+)?(?:Error|TypeError)/);});
