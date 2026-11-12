import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {getEffectiveActivities,summarizeLedger} from '../js/canonical-import.mjs';
import {createWorkspaceView,getWorkspaceActivity} from '../js/canonical-workspace-model.mjs';
import {createCanonicalMonthIndex} from '../js/canonical-month-index.mjs';
import {setupHttpCanonicalWorkbench} from './helpers/pr28-http-workbench.mjs';

// Real application lifecycle, GoogleDriveTransactionAdapter and physical root
// engine against invented HTTP. No live service, token or financial records.
test('workspace posting correction commits and independently reopens through synthetic HTTP v5 history', async () => {
  const recipe=await createSyntheticFinancialYear();
  const h=await setupHttpCanonicalWorkbench();
  try {
    const initialStore=new CanonicalLedgerStore({lifecycle:h.lifecycle});
    assert.equal(await initialStore.load(),null);
    await initialStore.save(recipe.ledger);
    const session=new CanonicalWorkspaceSession({storage:{lifecycle:h.lifecycle}});
    await session.loadVerified();
    const activity=getEffectiveActivities(session.ledger).find(a=>a.sourceDescription==='INVENTED BROKERAGE FEE');
    const original=structuredClone(session.ledger);
    session.correct({activityId:activity.activityId,type:'classification',activityKind:'spending',rationale:'Invented fee classification'});
    session.correct({activityId:activity.activityId,type:'category-correction',categoryId:'invented-fees',rationale:'Invented fee category'});
    session.correct({activityId:activity.activityId,type:'posting-status-correction',lifecycleStatus:'posted',
      postedDate:'2025-01-26',rationale:'Invented statement confirms posting'});
    const proposed=structuredClone(session.ledger);
    assert.equal(getWorkspaceActivity(proposed,activity.activityId).activity.needsReview,false);
    assert.equal(createWorkspaceView(proposed).review.activityCount,47);
    h.http.phase='save-posting-correction';await session.save();
    assert.ok(h.http.summary('save-posting-correction').mutations>0);
    assert.equal(session.dirty,false);assert.equal(session.unverified,false);
    assert.equal(session.store.base.revision,'2');
    assert.deepEqual(session.ledger,proposed);
    await session.reopen();assert.deepEqual(session.ledger,proposed);
    // Discard warm historical byte evidence before a separate store reopens.
    h.lifecycle.engine.invalidateHistory();
    const reopened=await new CanonicalLedgerStore({lifecycle:h.lifecycle}).load();
    assert.deepEqual(reopened,proposed);
    assert.deepEqual(reopened.activities,original.activities);
    assert.deepEqual(reopened.observations,original.observations);
    assert.deepEqual(reopened.events.slice(0,original.events.length),original.events);
    assert.equal(reopened.activities.find(a=>a.activityId===activity.activityId).lifecycleStatus,'unknown');
    assert.equal(getEffectiveActivities(reopened).find(a=>a.activityId===activity.activityId).lifecycleStatus,'posted');
    const january={start:'2025-01-01',end:'2025-01-31',currency:'USD'};
    assert.equal(summarizeLedger(reopened,january).spending,'2473.25');
    assert.deepEqual(createCanonicalMonthIndex(reopened).report(january).report,summarizeLedger(reopened,january));
    assert.equal(getWorkspaceActivity(reopened,activity.activityId).activity.needsReview,false);
    await h.driver.verifyPortable(); // Independent archive verifier checks retained pre/post-correction history.
  } finally { await h.lifecycle.release(); }
});
