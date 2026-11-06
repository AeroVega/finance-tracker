import { parseProviderCsv } from '../js/provider-csv.mjs';
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent, applyReviewDecision, getEffectiveActivities, summarizeLedger } from '../js/canonical-import.mjs';
import { AUTOMATED_IDS } from './pr28-testing-plan.mjs';

// Calls the real application functions with bundled invented bytes only.
// No Drive, OAuth, persistence, DOM or live-session checks run here.
export async function runFixtureChecks(loadBytes = async path => {
  const response = await fetch(new URL(path, import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('fixture-unavailable');
  return new Uint8Array(await response.arrayBuffer());
}) {
  const results = Object.fromEntries(AUTOMATED_IDS.map(id => [id, 'not-run']));
  let current = AUTOMATED_IDS[0];
  const check = (id, condition) => { current = id; if (!condition) throw new Error('fixture-check-failed'); results[id] = 'passed'; };
  const parse = async (path, sourceFormat = 'wells-fargo-csv-v1') => parseProviderCsv({ bytes: await loadBytes(path), sourceFormat });
  try {
    const foundation = await parse('../fixtures/pr28/wells-fargo-foundation.csv');
    check('fixture-foundation', foundation.records.length === 4 && foundation.rowsSeen === 5 && foundation.ignoredCount === 1);
    current = 'canonical-foundation';
    let ledger = registerAccount(createLedger(), { institutionId: 'wells-fargo', displayName: 'Invented checking', currency: 'USD', accountType: 'checking' });
    const accountId = ledger.accounts[0].accountId;
    const input = parsed => ({ parsed, syntheticOnly: true, accountMappings: { default: accountId }, coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } } });
    ledger = prepareCanonicalImport(ledger, input(foundation)).ledger;
    check('canonical-foundation', ledger.observations.length === 4 && ledger.activities.length === 4);
    const event = command => { ledger = applyFinancialEvent(ledger, { commandId: crypto.randomUUID(), evidence: { reason: 'Invented acceptance evidence' }, ...command }); };
    const total = (start = '2026-01-01', end = '2026-01-31') => summarizeLedger(ledger, { start, end, currency: 'USD' });
    current = 'classifications';
    for (const activity of ledger.activities) event({ type: 'classification', activityId: activity.activityId, activityKind: activity.amountMinor < 0 ? 'spending' : 'income', categoryId: 'invented-default' });
    check('classifications', total().spending === '110.00' && total().income === '1000.00' && total().complete === false && total().reasons.includes('coverage-not-reconciled'));
    current = 'category-rule';
    event({ type: 'category-correction', activityId: ledger.activities[2].activityId, categoryId: 'invented-coffee' });
    check('category-rule', getEffectiveActivities(ledger)[2].categoryId === 'invented-coffee' && getEffectiveActivities(ledger)[3].categoryId === 'invented-default' && ledger.events.length === 5);
    current = 'repeat-import';
    const repeatBefore = JSON.stringify(ledger);
    ledger = prepareCanonicalImport(ledger, input(foundation)).ledger;
    check('repeat-import', JSON.stringify(ledger) === repeatBefore);
    current = 'review-import';
    const review = await parse('../fixtures/pr28/wells-fargo-review.csv');
    ledger = prepareCanonicalImport(ledger, input(review)).ledger;
    check('review-import', ledger.imports.length === 2 && ledger.observations.length === 8 && ledger.activities.length === 6);
    current = 'review-retry';
    ledger = prepareCanonicalImport(ledger, input(review)).ledger;
    check('review-retry', ledger.imports.length === 2 && ledger.activities.length === 6 && ledger.imports[1].retryAttempts.length === 1);
    current = 'review-decisions';
    ledger = applyReviewDecision(ledger, { observationId: ledger.observations.find(o => o.disposition === 'review').observationId, action: 'match', activityId: ledger.activities[0].activityId, rationale: 'Same invented market receipt' });
    ledger = applyReviewDecision(ledger, { observationId: ledger.observations.find(o => o.disposition === 'rejected' && !o.resolved).observationId, action: 'reject', rationale: 'Invented malformed amount' });
    const pendingId = ledger.activities.find(a => a.sourceDescription.includes('PENDING')).activityId;
    const refundId = ledger.activities.find(a => a.sourceDescription.includes('PARTIAL REFUND')).activityId;
    const marketId = ledger.activities[0].activityId;
    event({ type: 'classification', activityId: pendingId, activityKind: 'spending', categoryId: 'invented-default' });
    check('review-decisions', ledger.reviewDecisions.length === 2 && ledger.events.length === 6 && total().spending === '110.00' && total().excluded.some(item => item.reason === 'pending'));
    current = 'missing-refund-date';
    const savedCheckpoint = structuredClone(ledger);
    event({ type: 'refund-link', activityId: refundId, originalActivityId: marketId });
    check('missing-refund-date', total().spending === '110.00' && total().reasons.includes('missing-refund-posted-date'));
    // This is an in-memory checkpoint, not evidence of a live verified reopen.
    ledger = savedCheckpoint;
    current = 'refund-period';
    event({ type: 'refund-link', activityId: refundId, originalActivityId: marketId, confirmedPostedDate: '2026-02-02' });
    check('refund-period', total().spending === '110.00' && total('2026-02-01', '2026-02-28').spending === '-40.00' && total('2026-01-01', '2026-02-28').spending === '70.00' && ledger.activities.find(a => a.activityId === refundId).postedDate === null);
    current = 'amount-correction';
    event({ type: 'bank-correction', activityId: marketId, amountText: '-90.00' });
    check('amount-correction', total().spending === '100.00' && total('2026-01-01', '2026-02-28').spending === '60.00' && ledger.activities[0].amountMinor === -10000);
    current = 'future-category';
    const future = await parse('../fixtures/pr28/wells-fargo-future-coffee.csv');
    ledger = prepareCanonicalImport(ledger, input(future)).ledger;
    const futureId = ledger.activities.at(-1).activityId;
    event({ type: 'classification', activityId: futureId, activityKind: 'spending', categoryId: null });
    check('future-category', ledger.imports.length === 3 && ledger.observations.length === 9 && ledger.activities.length === 7 && ledger.events.length === 9 && ledger.reviewDecisions.length === 2 && getEffectiveActivities(ledger).at(-1).categoryId === 'invented-coffee' && getEffectiveActivities(ledger)[3].categoryId === 'invented-default' && total().spending === '106.00' && total('2026-01-01', '2026-02-28').spending === '66.00' && total().complete === false);
    current = 'provider-shapes';
    const wells = await parse('../fixtures/wells-fargo.csv');
    const sofi = await parse('../fixtures/sofi.csv', 'sofi-csv-v1');
    const fidelity = await parse('../fixtures/fidelity.csv', 'fidelity-accounts-history-csv-v1');
    check('provider-shapes', wells.records.length === 2 && sofi.records.length === 2 && fidelity.records.length === 2 && fidelity.sourceAccountKeys.length === 2 && fidelity.rowsSeen === 7 && fidelity.ignoredCount === 5);
  } catch {
    // Never include error bodies, parsed records or IDs in the safe report.
    results[current] = 'failed';
  }
  return results;
}
