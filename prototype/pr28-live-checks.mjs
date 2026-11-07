import { parseProviderCsv } from '../js/provider-csv.mjs';
import { createLedger, registerAccount, prepareCanonicalImport, applyReviewDecision, reverseReviewDecision, applyFinancialEvent, getEffectiveActivities, summarizeLedger } from '../js/canonical-import.mjs';
import { canonicalizeJcs } from '../js/transaction-protocol.mjs';
import { safeRequestMetrics, combineRequestMetrics } from '../js/drive-request-metrics.mjs';

// Fixed synthetic recipe. No OAuth, provider credentials, DOM, or storage engine lives here.
export const LIVE_CHECKS = Object.freeze([
  ['fresh-base', 'Fresh, empty synthetic storage'],
  ['mapping-coverage', 'Explicit account mapping and declared coverage gates'],
  ['foundation', 'Invented source evidence and identical purchase occurrences'],
  ['classification', 'Exact qualified income and spending'],
  ['category-rule', 'Category correction and prospective rule'],
  ['first-save-reopen', 'Actual canonical save and independent reopen'],
  ['repeat-import', 'Repeated import and command idempotency'],
  ['review-retry', 'Overlap, malformed evidence and unresolved retry'],
  ['review-reversal', 'Keep separate, append-only reversal and retained inactive history'],
  ['review-decisions', 'Match and reject decisions with pending exclusion'],
  ['checkpoint-save-reopen', 'Actual reviewed checkpoint save and reopen'],
  ['missing-refund-date', 'Missing posting evidence excludes refund'],
  ['discard-probe', 'Independent reopen discards only the unsaved probe'],
  ['refund-period', 'Refund posting period and unchanged original dates'],
  ['amount-correction', 'Exact correction with unchanged source amount'],
  ['future-category', 'Later import receives the prospective coffee rule'],
  ['refund-category', 'Refund follows purchase category and explicit override'],
  ['other-providers', 'Wells Fargo, SoFi and both Fidelity accounts mapped'],
  ['currency-reversal', 'Explicit missing currency, reversal and unknown lifecycle'],
  ['final-save-reopen', 'Complete graph and exact scoped totals survive save/reopen'],
  ['immutable-evidence', 'Saved immutable evidence rejects rewriting'],
  ['portable-validation', 'Live retained history exported and verified in memory'],
  ['session-revalidation', 'Existing session revalidated without OAuth'],
  ['verified-release', 'Session release verified'],
  ['reconnect-same-copy', 'Same-copy saved graph after user reconnect']
].map(([id, label]) => Object.freeze({ id, label })));
export const LIVE_IDS = Object.freeze(LIVE_CHECKS.map(check => check.id));
export const blankLive = input => Object.fromEntries(LIVE_IDS.map(id => [id, ['passed', 'failed', 'not-run'].includes(input?.[id]) ? input[id] : 'not-run']));
export function safeLiveMetrics(input) {
  try {
    return { available: input?.available === true && safeRequestMetrics(input?.total) !== null,
      total: input?.available === true ? safeRequestMetrics(input?.total) : null,
      phases: Object.fromEntries(LIVE_IDS.map(id => [id, input?.available === true ? safeRequestMetrics(input?.phases?.[id]) : null])) };
  } catch { return { available: false, total: null, phases: Object.fromEntries(LIVE_IDS.map(id => [id, null])) }; }
}
const same = (left, right) => canonicalizeJcs(left) === canonicalizeJcs(right);
const assert = condition => { if (!condition) throw new Error('live-assertion-failed'); };
const fixtureBytes = async path => {
  const response = await fetch(new URL(path, import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('fixture-unavailable');
  return new Uint8Array(await response.arrayBuffer());
};

// withWorkbench takes an exclusive lease on the one existing workbench/session.
// Tests inject the same small driver contract backed by the real catalog engine.
export function createLiveRunner({ withWorkbench, loadBytes = fixtureBytes, onUpdate = () => {}, recordedResults }) {
  let stopRequested = false;
  let running = false, results = blankLive(recordedResults), expected = null, expectedIdentity = null;
  let captures = [], phaseCaptures = {};
  const metrics = () => {
    try { return safeLiveMetrics({ available: captures.length > 0, total: combineRequestMetrics(captures.map(window => window.snapshot())),
      phases: Object.fromEntries(LIVE_IDS.map(id => [id, combineRequestMetrics((phaseCaptures[id] || []).map(window => window.snapshot()))])) }); }
    catch { return safeLiveMetrics(); }
  };
  // Neither instrumentation nor a UI observer may change a save or assertion.
  const observe = operation => { try { return operation(); } catch { /* observational only */ } };
  const publish = (current, state, metricsOnly = false) => observe(() => onUpdate({ current, state, results: blankLive(results), metrics: metrics(), metricsOnly }));
  async function execute(reconnect) {
    if (running) return false;
    if (reconnect && !expected) return false;
    running = true; stopRequested = false;
    let current = reconnect ? 'reconnect-same-copy' : 'fresh-base';
    let totalWindow, phaseWindow, unsubscribe;
    const previousCaptures = captures, previousPhases = phaseCaptures;
    const closePhase = () => { observe(() => phaseWindow?.close()); phaseWindow = null; };
    // A failed preflight does not erase a previous run's evidence.
    let started = reconnect;
    try {
      await withWorkbench(async driver => {
        const startPhase = id => {
          closePhase();
          phaseWindow = observe(() => driver.requestMetrics?.openWindow());
          if (phaseWindow) (phaseCaptures[id] ||= []).push(phaseWindow);
        };
        if (!reconnect) { captures = []; phaseCaptures = {}; }
        totalWindow = observe(() => driver.requestMetrics?.openWindow());
        if (totalWindow) captures.push(totalWindow);
        let lastUpdate = -Infinity;
        unsubscribe = observe(() => driver.requestMetrics?.subscribe(() => {
          const time = Date.now();
          if (time - lastUpdate < 250) return;
          lastUpdate = time; publish(current, 'running', true);
        }));
        startPhase(current);
        if (reconnect) {
          results[current] = 'not-run'; publish(current, 'running');
          assert(same(await driver.identity(), expectedIdentity));
          assert(same(await driver.reopen(), expected));
          closePhase(); observe(() => totalWindow?.close());
          results[current] = 'passed'; publish(current, 'complete');
          return;
        }
        publish(current, 'checking-base');
        await driver.requireFresh();
        results = blankLive(); expected = null; expectedIdentity = null; started = true;
        const step = async (id, operation) => {
          current = id;
          if (stopRequested) throw new Error('stopped');
          if (id !== 'fresh-base') startPhase(id);
          publish(id, 'running');
          await operation(); closePhase(); results[id] = 'passed'; publish(id, 'running');
        };
        await step('fresh-base', async () => { expectedIdentity = await driver.identity(); });
        let ledger = createLedger();
        const stage = next => { ledger = next; driver.stage(ledger); };
        const parse = async (path, sourceFormat = 'wells-fargo-csv-v1') => parseProviderCsv({ bytes: await loadBytes(path), sourceFormat });
        const event = command => stage(applyFinancialEvent(ledger, { commandId: crypto.randomUUID(), evidence: { reason: 'Invented automated acceptance evidence' }, ...command }));
        const effective = id => getEffectiveActivities(ledger).find(activity => activity.activityId === id);
        const total = (start = '2026-01-01', end = '2026-01-31', accountIds = [accountId]) => summarizeLedger(ledger, { start, end, currency: 'USD', accountIds });
        const input = (parsed, mappings = { default: accountId }, start = '2026-01-01', end = '2026-01-31') => ({ parsed, syntheticOnly: true, accountMappings: mappings, coverageByAccount: Object.fromEntries(Object.values(mappings).map(id => [id, { start, end, provenance: 'user-confirmed' }])) });
        const saveReopen = async () => {
          const prior = structuredClone(ledger);
          assert(same(await driver.save(ledger), prior));
          ledger = await driver.reopen(); assert(same(ledger, prior));
        };
        const refuse = operation => { let refused = false; try { operation(); } catch { refused = true; } assert(refused); };
        let foundation, accountId, marketId, coffeeId, otherCoffeeId, refundId, pendingId;
        await step('mapping-coverage', async () => {
          foundation = await parse('../fixtures/pr28/wells-fargo-foundation.csv');
          stage(registerAccount(ledger, { institutionId: 'wells-fargo', displayName: 'Invented acceptance checking', currency: 'USD', accountType: 'checking' }));
          accountId = ledger.accounts[0].accountId;
          refuse(() => prepareCanonicalImport(ledger, { ...input(foundation), accountMappings: {} }));
          refuse(() => prepareCanonicalImport(ledger, { ...input(foundation), coverageByAccount: {} }));
          refuse(() => prepareCanonicalImport(ledger, input(foundation, { default: accountId }, '2026-01-01', '2026-01-02')));
          assert(ledger.imports.length === 0);
        });
        await step('foundation', async () => {
          assert(foundation.records.length === 4 && foundation.rowsSeen === 5 && foundation.ignoredCount === 1);
          stage(prepareCanonicalImport(ledger, input(foundation)).ledger);
          assert(ledger.observations.length === 4 && ledger.activities.length === 4);
          [marketId, , coffeeId, otherCoffeeId] = ledger.activities.map(activity => activity.activityId);
          assert(coffeeId !== otherCoffeeId && ledger.activities[2].sourceDescription === ledger.activities[3].sourceDescription);
          assert(ledger.imports[0].declaredCoverage.start === '2026-01-01' && ledger.imports[0].declaredCoverage.end === '2026-01-31' && ledger.imports[0].coverageReconciled === false);
        });
        await step('classification', async () => {
          for (const activity of ledger.activities) event({ type: 'classification', activityId: activity.activityId, activityKind: activity.amountMinor < 0 ? 'spending' : 'income', categoryId: 'invented-default' });
          assert(total().spending === '110.00' && total().income === '1000.00' && total().complete === false && total().reasons.includes('coverage-not-reconciled'));
        });
        await step('category-rule', async () => {
          event({ type: 'category-correction', activityId: coffeeId, categoryId: 'invented-coffee' });
          assert(effective(coffeeId).categoryId === 'invented-coffee' && effective(otherCoffeeId).categoryId === 'invented-default' && ledger.events.length === 5 && ledger.events.at(-1).prospectiveRule);
        });
        await step('first-save-reopen', saveReopen);
        await step('repeat-import', async () => {
          const before = structuredClone(ledger);
          stage(prepareCanonicalImport(ledger, input(foundation)).ledger);
          assert(same(ledger, before));
          const prior = ledger.events[0];
          stage(applyFinancialEvent(ledger, { type: 'classification', activityId: marketId, activityKind: 'spending', categoryId: 'invented-default', commandId: prior.commandId, evidence: { reason: 'Invented automated acceptance evidence' } }));
          assert(same(ledger, before));
          assert(same(await driver.save(ledger), before));
        });
        let overlapId, rejectedId;
        await step('review-retry', async () => {
          const review = await parse('../fixtures/pr28/wells-fargo-review.csv');
          stage(prepareCanonicalImport(ledger, input(review)).ledger);
          stage(prepareCanonicalImport(ledger, input(review)).ledger);
          assert(ledger.imports.length === 2 && ledger.observations.length === 8 && ledger.activities.length === 6 && ledger.imports[1].retryAttempts.length === 1);
          overlapId = ledger.observations.find(o => o.disposition === 'review').observationId;
          rejectedId = ledger.observations.find(o => o.disposition === 'rejected' && !o.resolved).observationId;
          refundId = ledger.activities.find(a => a.sourceDescription.includes('PARTIAL REFUND')).activityId;
          pendingId = ledger.activities.find(a => a.sourceDescription.includes('PENDING')).activityId;
        });
        await step('review-reversal', async () => {
          stage(applyReviewDecision(ledger, { observationId: overlapId, action: 'keep-separate', rationale: 'Invented separate receipt probe' }));
          const decision = structuredClone(ledger.reviewDecisions.at(-1)), retained = structuredClone(ledger.activities.at(-1));
          stage(reverseReviewDecision(ledger, { reviewDecisionId: decision.reviewDecisionId, rationale: 'Invented receipt actually overlaps' }));
          assert(same(ledger.reviewDecisions[0], decision) && same(ledger.activities.at(-1), retained) && !effective(retained.activityId).active);
          assert(ledger.observations.find(o => o.observationId === overlapId).disposition === 'review');
        });
        await step('review-decisions', async () => {
          stage(applyReviewDecision(ledger, { observationId: overlapId, action: 'match', activityId: marketId, rationale: 'Same invented market receipt' }));
          stage(applyReviewDecision(ledger, { observationId: rejectedId, action: 'reject', rationale: 'Invented malformed amount retained' }));
          event({ type: 'classification', activityId: pendingId, activityKind: 'spending', categoryId: 'invented-default' });
          assert(ledger.reviewDecisions.length === 4 && ledger.events.length === 6 && total().spending === '110.00' && total().excluded.some(item => item.reason === 'pending'));
          assert(!ledger.observations.some(o => ['review', 'rejected'].includes(o.disposition) && !o.resolved));
        });
        await step('checkpoint-save-reopen', saveReopen);
        const checkpoint = structuredClone(ledger);
        await step('missing-refund-date', async () => {
          event({ type: 'refund-link', activityId: refundId, originalActivityId: marketId });
          assert(total().spending === '110.00' && total().reasons.includes('missing-refund-posted-date'));
        });
        await step('discard-probe', async () => { ledger = await driver.reopen(); assert(same(ledger, checkpoint)); });
        await step('refund-period', async () => {
          event({ type: 'refund-link', activityId: refundId, originalActivityId: marketId, confirmedPostedDate: '2026-02-02' });
          const refund = ledger.activities.find(a => a.activityId === refundId);
          assert(total().spending === '110.00' && total('2026-02-01', '2026-02-28').spending === '-40.00' && total('2026-01-01', '2026-02-28').spending === '70.00' && refund.postedDate === null && refund.effectiveDate === '2026-01-15');
        });
        await step('amount-correction', async () => {
          event({ type: 'bank-correction', activityId: marketId, amountText: '-90.00' });
          assert(total().spending === '100.00' && total('2026-01-01', '2026-02-28').spending === '60.00' && ledger.activities[0].amountMinor === -10000 && ledger.observations[0].candidate.amountMinor === -10000);
        });
        await step('future-category', async () => {
          stage(prepareCanonicalImport(ledger, input(await parse('../fixtures/pr28/wells-fargo-future-coffee.csv'))).ledger);
          const futureId = ledger.activities.at(-1).activityId;
          event({ type: 'classification', activityId: futureId, activityKind: 'spending', categoryId: null });
          assert(effective(futureId).categoryId === 'invented-coffee' && effective(otherCoffeeId).categoryId === 'invented-default' && total().spending === '106.00' && total('2026-01-01', '2026-02-28').spending === '66.00');
        });
        await step('refund-category', async () => {
          event({ type: 'category-correction', activityId: marketId, categoryId: 'invented-market-corrected' });
          assert(effective(refundId).categoryId === 'invented-market-corrected');
          event({ type: 'category-correction', activityId: refundId, categoryId: 'invented-refund-override' });
          assert(effective(refundId).categoryId === 'invented-refund-override' && effective(marketId).categoryId === 'invented-market-corrected');
        });
        const providerAccounts = [];
        await step('other-providers', async () => {
          for (const [path, format, start, end] of [
            ['../fixtures/wells-fargo.csv', 'wells-fargo-csv-v1', '2026-01-01', '2026-01-31'],
            ['../fixtures/sofi.csv', 'sofi-csv-v1', '2026-02-01', '2026-02-28'],
            ['../fixtures/fidelity.csv', 'fidelity-accounts-history-csv-v1', '2026-03-01', '2026-03-31']
          ]) {
            const parsed = await parse(path, format), mappings = {};
            for (const [index, key] of parsed.sourceAccountKeys.entries()) {
              stage(registerAccount(ledger, { institutionId: parsed.institutionId, displayName: 'Invented ' + parsed.institutionId + ' ' + (index + 1), currency: 'USD', accountType: parsed.institutionId === 'fidelity' ? (index === 0 ? 'retirement' : 'brokerage') : 'checking' }));
              mappings[key] = ledger.accounts.at(-1).accountId;
              providerAccounts.push(mappings[key]);
            }
            const before = ledger.observations.length;
            stage(prepareCanonicalImport(ledger, input(parsed, mappings, start, end)).ledger);
            assert(ledger.observations.length === before + 2);
            for (const activity of ledger.activities.filter(a => Object.values(mappings).includes(a.accountId))) event({ type: 'classification', activityId: activity.activityId, activityKind: activity.amountMinor < 0 ? 'spending' : 'income', categoryId: 'invented-provider' });
          }
          assert(ledger.accounts.length === 5 && ledger.imports.length === 7 && ledger.observations.length === 15);
          assert(total('2026-01-01', '2026-01-31', [providerAccounts[0]]).spending === '12.34' && total('2026-02-01', '2026-02-28', [providerAccounts[1]]).spending === '23.41');
        });
        await step('currency-reversal', async () => {
          const rows = ledger.observations.filter(o => o.institutionId === 'fidelity');
          assert(rows.length === 2 && rows.every(o => o.reasonCode === 'missing-currency' && o.sourceFields.Currency === '' && o.candidate.currency === null));
          const keep = observationId => stage(applyReviewDecision(ledger, { observationId, action: 'keep-separate', currency: 'USD', rationale: 'Explicit invented USD evidence' }));
          keep(rows[0].observationId);
          const retained = structuredClone(ledger.activities.at(-1));
          stage(reverseReviewDecision(ledger, { reviewDecisionId: ledger.reviewDecisions.at(-1).reviewDecisionId, rationale: 'Invented currency recheck' }));
          assert(!effective(retained.activityId).active && same(ledger.activities.at(-1), retained));
          assert(ledger.observations.find(o => o.observationId === rows[0].observationId).reasonCode === 'missing-currency');
          keep(rows[0].observationId); keep(rows[1].observationId);
          assert(ledger.observations.filter(o => o.institutionId === 'fidelity').every(o => o.sourceFields.Currency === '' && o.candidate.currency === null));
          assert(getEffectiveActivities(ledger).filter(a => a.institutionId === 'fidelity').every(a => a.lifecycleStatus === 'unknown'));
          assert(total('2026-03-01', '2026-03-31', providerAccounts.slice(2)).excluded.some(item => item.reason === 'unknown-lifecycle'));
        });
        await step('final-save-reopen', async () => {
          await saveReopen();
          assert(ledger.accounts.length === 5 && ledger.imports.length === 7 && ledger.observations.length === 15 && ledger.activities.length === 15 && ledger.events.length === 15 && ledger.reviewDecisions.length === 8);
          assert(total().spending === '106.00' && total('2026-02-01', '2026-02-28').spending === '-40.00' && total('2026-01-01', '2026-02-28').spending === '66.00' && total().complete === false);
        });
        await step('immutable-evidence', async () => {
          const bad = structuredClone(ledger); bad.accounts[0].displayName = 'Invented forbidden rewrite';
          let code = null; try { await driver.save(bad); } catch (error) { code = error.code; }
          assert(code === 'history-rewrite-refused');
          assert(same(await driver.reopen(), ledger));
        });
        await step('portable-validation', () => driver.verifyPortable());
        await step('session-revalidation', async () => { await driver.revalidate(); assert(same(await driver.reopen(), ledger)); });
        // Keep exact data and copy identity only in this module's memory, never in the report/storage.
        expected = structuredClone(ledger);
        await step('verified-release', () => driver.release());
        observe(() => totalWindow?.close());
        publish(null, 'complete');
      });
      return true;
    } catch (error) {
      // Never expose error text, IDs, provider bodies, financial data or stack traces.
      const stopped = error.message === 'stopped';
      closePhase(); observe(() => totalWindow?.close());
      if (!started) { captures = previousCaptures; phaseCaptures = previousPhases; }
      if (started && !stopped) results[current] = 'failed';
      publish(current, stopped ? 'stopped' : started ? 'failed' : 'blocked');
      return false;
    } finally { closePhase(); observe(() => totalWindow?.close()); observe(() => unsubscribe?.()); running = false; }
  }
  return Object.freeze({ getMetrics: metrics, forgetResults: () => { if (!running) { results = blankLive(); expected = null; expectedIdentity = null; captures = []; phaseCaptures = {}; } }, stop: () => { if (running) stopRequested = true; }, run: () => execute(false), verifyReconnect: () => execute(true), canVerifyReconnect: () => Boolean(expected) && !running, isRunning: () => running });
}

// Preparation uses the same import and storage APIs. It does not pause a write,
// recover, reclaim a session, or mark interruption acceptance passed.
export async function prepareInterruption(withWorkbench, loadBytes = fixtureBytes) {
  return withWorkbench(async driver => {
    await driver.requireFresh();
    const parsed = await parseProviderCsv({ bytes: await loadBytes('../fixtures/pr28/wells-fargo-foundation.csv'), sourceFormat: 'wells-fargo-csv-v1' });
    let ledger = registerAccount(createLedger(), { institutionId: 'wells-fargo', displayName: 'Invented interruption checking', currency: 'USD', accountType: 'checking' });
    const accountId = ledger.accounts[0].accountId;
    ledger = prepareCanonicalImport(ledger, { parsed, syntheticOnly: true, accountMappings: { default: accountId }, coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } } }).ledger;
    driver.stage(ledger); assert(same(await driver.save(ledger), ledger));
    assert(same(await driver.reopen(), ledger));
    ledger = applyFinancialEvent(ledger, { type: 'classification', activityId: ledger.activities[0].activityId, activityKind: 'spending', categoryId: 'invented-default', commandId: crypto.randomUUID(), evidence: { reason: 'Invented interruption classification' } });
    driver.stage(ledger);
    assert(ledger.events.length === 1);
  });
}
