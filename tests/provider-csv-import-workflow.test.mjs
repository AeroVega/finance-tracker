import test from 'node:test';
import assert from 'node:assert/strict';
import {mountProviderImportWorkflow} from '../js/provider-csv-import-workflow.mjs';
import {evaluateImportCoverage, createImportCoverageModel} from '../components/import-coverage-selector.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';

// Real importer and selector with a minimal DOM event seam. This validates
// rendered content and lifecycle, not browser layout or native date widgets.
function setup(initial) {
  const doc={createElement:tag=>new Element(tag)};
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.ownerDocument=doc;this.events={};this.value='';this.checked=false;this.disabled=false;this.innerHTML='';this.dataset={};}
    setAttribute(k,v){this[k]=k==='disabled'?true:v;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;this.innerHTML='';}
    removeChild(child){this.children=this.children.filter(x=>x!==child);}
    contains(){return true;}
    querySelector(){return {focus(){}};}
    addEventListener(t,f){(this.events[t]??=[]).push(f);}
    removeEventListener(t,f){this.events[t]=(this.events[t]??[]).filter(x=>x!==f);}
    async emit(t,e={}){for(const f of this.events[t]??[])await f(e);}
  }
  const root=new Element('div');let ledger=initial,staged=null;
  const api=mountProviderImportWorkflow({root,getLedger:()=>ledger,stageImport:proposal=>{staged=proposal;ledger=proposal;}});
  const all=()=>{const list=[];function walk(n){list.push(n);n.children.forEach(walk);}walk(root);return list;};
  const one=predicate=>all().find(predicate);
  const file=one(n=>n.type==='file');
  return {root,api,all,one,file,setLedger:value=>{ledger=value;},staged:()=>staged,
    async load(csv){file.files=[{arrayBuffer:async()=>new TextEncoder().encode(csv).buffer}];await file.emit('change');},
    async map(accountId){const select=one(n=>n.tag==='select');select.value=accountId;await select.emit('change');},
    async coverage(start='2026-01-01',end='2026-01-31'){
      const container=one(n=>n.className==='provider-import-coverage');
      for(const [field,value] of [['start',start],['end',end]])await container.emit('change',{target:{dataset:{field},value}});
      await container.emit('click',{target:{dataset:{action:'confirm'},closest(){return this;}}});return container;
    },
    stage:()=>one(n=>n.textContent==='Stage import for review'),
    status:()=>one(n=>n.className==='status-message').textContent
  };
}
const header='DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS\n';
const valid=header+'01/15/2026,INVENTED WORKFLOW,7.50,,Posted\n';
const recipe=await createSyntheticFinancialYear();

test('real two-calendar selector stages provenance, then clearing after release removes transient data',async()=>{
  const h=setup(recipe.ledger);await h.load(valid);await h.map(recipe.accounts.checking);
  const calendar=await h.coverage();assert.match(calendar.innerHTML,/start date calendar/);assert.match(calendar.innerHTML,/end date calendar/);
  assert.equal(h.stage().disabled,false);await h.stage().emit('click');assert.ok(h.staged());
  const coverage=h.staged().imports.at(-1).declaredCoverage;
  assert.equal(coverage.provenance,'user-confirmed');assert.equal(coverage.confirmationEvidence.confirmationMethod,'explicit-component-confirmation');
  assert.equal(coverage.confirmationEvidence.reviewedEmptyExport,false);
  h.setLedger(null);h.api.refresh();assert.equal(h.all().filter(n=>n.tag==='select').length,0);assert.equal(calendar.innerHTML,'');assert.equal(h.stage().disabled,true);assert.equal(h.file.value,'');
});
test('header-only export needs explicit empty confirmation and fresh coverage confirmation',async()=>{
  const h=setup(recipe.ledger);await h.load(header);await h.map(recipe.accounts.checking);await h.coverage();assert.equal(h.stage().disabled,true);
  const empty=h.one(n=>n.type==='checkbox');empty.checked=true;await empty.emit('change');await h.coverage();assert.equal(h.stage().disabled,false);
  await h.stage().emit('click');assert.equal(h.staged().imports.at(-1).counts.rowsRecognized,0);assert.equal(h.staged().imports.at(-1).declaredCoverage.confirmationEvidence.reviewedEmptyExport,true);
});
test('nonempty files with unusable dates cannot masquerade as confirmed empty exports',async()=>{
  const h=setup(recipe.ledger);await h.load(header+'invalid,INVENTED,3.00,,Posted\n');await h.map(recipe.accounts.checking);const c=await h.coverage();
  assert.match(c.innerHTML,/No usable transaction dates/);assert.equal(h.stage().disabled,true);await h.stage().emit('click');assert.equal(h.staged(),null);
});
test('malformed rows with usable outlying dates remain visible and block coverage confirmation',async()=>{
  const h=setup(recipe.ledger);await h.load(valid+'03/02/2026,INVENTED BAD AMOUNT,bad,,Posted\n');await h.map(recipe.accounts.checking);const c=await h.coverage();
  assert.match(c.innerHTML,/2026-03-02 \(row 3\)/);assert.equal(h.stage().disabled,true);
});
test('changing date or account invalidates accepted coverage before staging',async()=>{
  const h=setup(recipe.ledger);await h.load(valid);await h.map(recipe.accounts.checking);let c=await h.coverage();assert.equal(h.stage().disabled,false);
  await c.emit('change',{target:{dataset:{field:'end'},value:'2026-01-30'}});assert.equal(h.stage().disabled,true);
  await h.coverage();await h.map(recipe.accounts.checking);assert.equal(h.stage().disabled,true);
});
test('late failure from replaced file cannot invalidate the current file',async()=>{
  const h=setup(recipe.ledger);let reject;
  h.file.files=[{arrayBuffer:()=>new Promise((_,no)=>{reject=no;})}];const old=h.file.emit('change');
  await h.load(valid);await h.map(recipe.accounts.checking);await h.coverage();assert.equal(h.stage().disabled,false);
  reject(new Error('synthetic old read failure'));await old;assert.equal(h.stage().disabled,false);assert.doesNotMatch(h.status(),/not accepted/);
});
test('destroy prevents asynchronous file completion from reviving disposed content',async()=>{
  const h=setup(recipe.ledger);let resolve;
  h.file.files=[{arrayBuffer:()=>new Promise(yes=>{resolve=yes;})}];const old=h.file.emit('change');h.api.destroy();
  resolve(new TextEncoder().encode(valid).buffer);await old;assert.equal(h.root.children.length,0);assert.equal(h.staged(),null);
});

test('reviewed empty extension never suppresses invalid observed dates or invents an observed range',()=>{
  assert.equal(evaluateImportCoverage({start:'2026-01-01',end:'2026-01-31',observedDates:['bad'],reviewedEmptyExport:true}).valid,false);
  const model=createImportCoverageModel({observedDates:[],reviewedEmptyExport:true});
  model.setDates({start:'2026-01-01',end:'2026-01-31'});
  const result=model.confirm();assert.equal(result.status,'confirmed');assert.deepEqual(result.observedDateRange,{start:null,end:null});
  model.updateContext({observedDates:['bad'],reviewedEmptyExport:true});model.setDates({start:'2026-01-01',end:'2026-01-31'});assert.equal(model.confirm().status,'review-required');
});

test('SoFi and multi-account Fidelity use explicit account-scoped coverage and immutable source keys',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {registerAccount}=await import('../js/canonical-import.mjs');
  const sofi=setup(recipe.ledger);await sofi.load(await readFile(new URL('../fixtures/sofi.csv',import.meta.url),'utf8'));
  await sofi.map(recipe.accounts.savings);await sofi.coverage('2026-02-01','2026-02-28');assert.equal(sofi.stage().disabled,false);
  await sofi.stage().emit('click');assert.equal(sofi.staged().imports.at(-1).accountId,recipe.accounts.savings);
  const ledger=registerAccount(recipe.ledger,{institutionId:'fidelity',accountType:'retirement',currency:'USD',displayName:'Invented second investment'});
  const fidelity=setup(ledger);await fidelity.load((await readFile(new URL('../fixtures/fidelity.csv',import.meta.url),'utf8')).replaceAll('000000000','INVENTED-SENSITIVE-A').replaceAll('000000001','INVENTED-SENSITIVE-B'));
  const selects=fidelity.all().filter(n=>n.tag==='select');assert.equal(selects.length,2);
  const containers=fidelity.all().filter(n=>n.className==='provider-import-coverage');
  for(let i=0;i<2;i++){
    selects[i].value=[recipe.accounts.investment,ledger.accounts.at(-1).accountId][i];await selects[i].emit('change');
    for(const [field,value] of [['start','2026-03-01'],['end','2026-03-31']])await containers[i].emit('change',{target:{dataset:{field},value}});
    await containers[i].emit('click',{target:{dataset:{action:'confirm'},closest(){return this;}}});
  }
  assert.equal(fidelity.stage().disabled,false);await fidelity.stage().emit('click');
  assert.equal(fidelity.staged().imports.length,ledger.imports.length+2);
  assert.equal(JSON.stringify(fidelity.staged()).includes('INVENTED-SENSITIVE-A'),false);
  assert.equal(JSON.stringify(fidelity.staged()).includes('INVENTED-SENSITIVE-B'),false);
});

test('mounted import proposal survives explicit verified save and independent reopen with confirmation evidence',async()=>{
  const {webcrypto}=await import('node:crypto');
  const {FullSnapshotApplication}=await import('../js/full-snapshot-application.mjs');
  const {HttpFullSnapshotDrive}=await import('./helpers/http-full-snapshot-drive.mjs');
  const {CanonicalWorkspaceSession}=await import('../js/canonical-workspace-session.mjs');
  const http=new HttpFullSnapshotDrive();
  const make=()=>new FullSnapshotApplication({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto,lifecycleTarget:null,isOnline:()=>true,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},visibilityDelayMs:0});
  const storage={lifecycle:make(),createLedgerStore(){return this.lifecycle.createLedgerStore();}};
  await storage.lifecycle.start({initialize:true});const store=storage.createLedgerStore();await store.load();await store.save(recipe.ledger);
  const session=new CanonicalWorkspaceSession({storage,online:()=>true});await session.loadVerified();
  const h=setup(session.ledger), before=structuredClone(await store.load());
  await h.load(valid);await h.map(recipe.accounts.checking);await h.coverage();await h.stage().emit('click');
  session.stageCanonicalImport(h.staged());assert.deepEqual(await store.load(),before);
  const expected=structuredClone(session.ledger);await session.save();await storage.lifecycle.release();
  storage.lifecycle=make();await storage.lifecycle.start();const reopened=new CanonicalWorkspaceSession({storage,online:()=>true});await reopened.loadVerified();
  assert.deepEqual(reopened.ledger,expected);assert.equal(reopened.ledger.imports.at(-1).declaredCoverage.confirmationEvidence.kind,'user-confirmed');
  await storage.lifecycle.release();
});
