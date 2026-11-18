import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {parseRecognizedProviderCsv} from '../js/provider-csv.mjs';
import {prepareCanonicalImport,getEffectiveActivities,applyReviewDecision,reverseReviewDecision} from '../js/canonical-import.mjs';
import {createWorkspacePages} from '../js/workspace-pages.mjs';
import {createWorkspaceViewReader,getWorkspaceActivity} from '../js/canonical-workspace-model.mjs';
import {createSyntheticFinancialPosition} from '../js/synthetic-financial-position.mjs';
import {exactSignedDecimal,isCalendarDate} from '../js/import-reconciliation.mjs';
import {pageController} from './helpers/page-controller.mjs';

async function harness(count=12, transform=ledger=>ledger) {
  const recipe=await createSyntheticFinancialYear();
  const csv='DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS\n'+Array.from({length:count},(_,i)=>`2026-01-05,INVENTED REVIEW ${i},not-money,,Posted`).join('\n');
  const {parsed}=await parseRecognizedProviderCsv({bytes:new TextEncoder().encode(csv)});
  const prepared=prepareCanonicalImport(recipe.ledger,{parsed,syntheticOnly:true,accountMappings:{default:recipe.accounts.checking},coverageByAccount:{[recipe.accounts.checking]:{start:'2026-01-01',end:'2026-01-31',provenance:'user-confirmed'}}}).ledger;
  const ledger=transform(prepared);
  const http=new HttpFullSnapshotDrive();
  const lifecycle=new FullSnapshotApplication({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto,lifecycleTarget:null,isOnline:()=>true,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},visibilityDelayMs:0});
  await lifecycle.start({initialize:true});const store=lifecycle.createLedgerStore();await store.load();await store.save(ledger);
  let session,storage;
  class Storage {
    constructor(){storage=this;this.lifecycle=null;}
    async prepare(){}
    async connect(){this.lifecycle=lifecycle;}
    createLedgerStore(){return this.lifecycle.createLedgerStore();}
    async release(){await lifecycle.release();this.lifecycle=null;return {released:true};}
  }
  class Session extends CanonicalWorkspaceSession {constructor(options){super({...options,online:()=>true});session=this;}}
  const page=await pageController('canonical-workspace',{DashboardSyntheticStorage:Storage,CanonicalWorkspaceSession:Session,createWorkspacePages,createWorkspaceViewReader,getWorkspaceActivity,getEffectiveActivities,exactSignedDecimal,isCalendarDate,createSyntheticFinancialPosition,createSyntheticFinancialYear},{htmlPath:'index.html',scriptPath:'js/canonical-workspace.mjs'});
  await page.click('open-ledger');
  return {...page,session,storage,lifecycle,http,ledger};
}
const all=node=>[node,...node.children.flatMap(all)];
const text=node=>all(node).map(n=>n.textContent).join(' ');
const button=(root,label)=>all(root).find(n=>n.tagName==='BUTTON'&&n.textContent===label);
const sourceCards=h=>h.get('review-queue').children.filter(n=>n.dataset.observationId);

test('normal workspace source review reaches rows beyond first page and stages rejection/reversal without writes until save',async()=>{
  const h=await harness();
  assert.match(text(h.get('review-queue')),/12 unresolved/);
  assert.equal(sourceCards(h).length,10);
  await button(h.get('review-queue'),'Next source page').click();
  assert.equal(sourceCards(h).length,2);
  const card=sourceCards(h)[0], id=card.dataset.observationId;
  assert.equal(button(card,'Keep as a separate activity').disabled,true);
  assert.equal(button(card,'Match selected activity').disabled,true);
  const rationale=all(card).find(n=>n.tagName==='TEXTAREA');
  rationale.value='Invented malformed source, explicitly excluded';await rationale.emit('input');
  const before=structuredClone(await h.lifecycle.createLedgerStore().load());
  await button(card,'Reject source row').click();
  assert.equal(h.session.ledger.observations.find(o=>o.observationId===id).resolved,true);
  assert.equal(h.session.dirty,true);
  assert.deepEqual(await h.lifecycle.createLedgerStore().load(),before);
  const resolved=sourceCards(h).find(n=>n.dataset.observationId===id);
  const reason=all(resolved).find(n=>n.tagName==='TEXTAREA');reason.value='Invented reversal';await reason.emit('input');
  await button(resolved,'Reverse source decision').click();
  assert.equal(h.session.ledger.observations.find(o=>o.observationId===id).resolved,false);
  h.session.undoLastStagedChange();
  assert.equal(h.session.ledger.observations.find(o=>o.observationId===id).resolved,true);
  const accepted=structuredClone(h.session.ledger);
  await h.click('save-ledger');await h.click('reopen-ledger');
  assert.deepEqual(h.session.ledger,accepted);
  await h.click('release-ledger');
  assert.equal(h.get('review-queue').children.length,0);
});

test('source review session preserves draft on rejected acceptance, missing rationale and lost ownership',async()=>{
  const h=await harness(1), observation=h.session.ledger.observations.at(-1);
  const before=structuredClone(h.session.ledger);
  assert.throws(()=>h.session.reviewSource({observationId:observation.observationId,action:'keep-separate',rationale:'Invented'}),{code:'invalid-row-cannot-be-accepted'});
  assert.throws(()=>h.session.reviewSource({observationId:observation.observationId,action:'reject',rationale:''}),{code:'correction-rationale-required'});
  assert.deepEqual(h.session.ledger,before);
  h.session.invalidate();
  assert.throws(()=>h.session.reviewSource({observationId:observation.observationId,action:'reject',rationale:'Invented'}),{code:'reopen-before-editing'});
  assert.deepEqual(h.session.ledger,before);
});

test('source decisions keep and match ambiguous rows without overwriting an earlier staged import',async()=>{
  const {replayFixture,replayInput,replayRow}=await import('./helpers/ledger-replay-fixtures.mjs');
  const {ledger,options}=replayFixture();
  const session=new CanonicalWorkspaceSession({storage:{lifecycle:null},online:()=>true});
  session.preview(ledger);
  const proposal=prepareCanonicalImport(session.ledger,replayInput(ledger.accounts[0],[replayRow(),replayRow(1,{sourceDescription:'INVENTED SHOP 0',normalizedDescription:'invented shop 0',sourceFields:{Description:'INVENTED SHOP 0',Amount:'-12.34'}})],'invented-overlap'),options).ledger;
  session.stageCanonicalImport(proposal);
  const staged=structuredClone(session.ledger), reviews=staged.observations.filter(o=>o.disposition==='review');
  assert.equal(reviews.length,2);
  session.reviewSource({observationId:reviews[0].observationId,action:'keep-separate',rationale:'Confirmed distinct invented purchase'});
  const kept=structuredClone(session.ledger);
  session.reviewSource({observationId:reviews[1].observationId,action:'match',activityId:ledger.activities[0].activityId,rationale:'Confirmed same invented purchase'});
  assert.equal(session.ledger.activities.length,ledger.activities.length+1);
  assert.equal(session.ledger.imports.at(-1).status,'processed');
  session.undoLastStagedChange();assert.deepEqual(session.ledger,kept);
  session.undoLastStagedChange();assert.deepEqual(session.ledger,staged);
  session.undoLastStagedChange();assert.deepEqual(session.ledger,ledger);
});


test('source match options omit inactive retained history while keeping active targets available', async()=>{
  const {replayFixture,replayInput,replayRow}=await import('./helpers/ledger-replay-fixtures.mjs');
  const {ledger,options}=replayFixture();
  let next=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(),replayRow(1,{sourceDescription:'INVENTED SHOP 0',normalizedDescription:'invented shop 0',sourceFields:{Description:'INVENTED SHOP 0',Amount:'-12.34'}})],'invented-inactive-option'),options).ledger;
  const observation=next.observations.find(o=>o.disposition==='review');
  next=applyReviewDecision(next,{observationId:observation.observationId,action:'keep-separate',rationale:'Invented separate purchase'},options);
  const inactiveId=next.activities.at(-1).activityId;
  next=reverseReviewDecision(next,{reviewDecisionId:next.reviewDecisions.at(-1).reviewDecisionId,rationale:'Invented reversal'},options);
  const activeId=ledger.activities[0].activityId;
  assert.equal(getEffectiveActivities(next).find(a=>a.activityId===inactiveId).active,false);
  const h=await harness(1,()=>next);
  const targets=all(sourceCards(h)[0]).find(n=>n.tagName==='SELECT');
  assert.ok(targets.children.some(option=>option.value===activeId));
  assert.equal(targets.children.some(option=>option.value===inactiveId),false);
});
