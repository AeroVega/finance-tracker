import {createCanonicalMonthIndex,isCanonicalMonthIndexFor} from './canonical-month-index.mjs';
import {getEffectiveActivities, summarizeLedgerPeriods} from './canonical-import.mjs';
import {exactSignedDecimal, isCalendarDate} from './import-reconciliation.mjs';
import {buildFinancialPosition, buildAccountMonthCoverage} from './financial-position.mjs';

const knownKinds = new Set(['income', 'spending', 'transfer', 'refund']);
const fail = message => { throw new TypeError(message); };
const reportingDate = activity => activity.activityKind === 'refund' ? activity.postedDate : activity.effectiveDate;
const pendingSource = observation => !observation.resolved && ['review', 'rejected'].includes(observation.disposition);
const newest = values => values.filter(Boolean).sort().at(-1) ?? null;

function monthBounds(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !isCalendarDate(`${month}-01`)) fail('invalid-workspace-month');
  const [year, number] = month.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return {start:`${month}-01`, end:`${month}-${[31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][number - 1]}`};
}

function addMonths(months, start, end) {
  let [year, month] = start.slice(0, 7).split('-').map(Number);
  const last = end.slice(0, 7);
  while (true) {
    const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    if (value > last) break;
    months.add(value);
    if (++month === 13) { month = 1; year++; }
  }
}

function excludedReviewReasons(reports) {
  const reasons = new Map();
  for (const report of reports) for (const item of report.excluded) {
    if (['pending', 'different-currency'].includes(item.reason)) continue;
    if (!reasons.has(item.activityId)) reasons.set(item.activityId, new Set());
    reasons.get(item.activityId).add(item.reason);
  }
  return reasons;
}

function reviewReasonsFor(activity, exclusions) {
  const reasons = new Set();
  if (!knownKinds.has(activity.activityKind)) reasons.add('unclassified-activity');
  if (!['posted', 'pending'].includes(activity.lifecycleStatus)) reasons.add('unknown-lifecycle');
  if (activity.activityKind === 'refund' && activity.postedDate === null) reasons.add('missing-refund-posted-date');
  for (const reason of exclusions.get(activity.activityId) ?? []) reasons.add(reason);
  return [...reasons];
}

function rowFor(activity, accounts, observations, events, exclusions) {
  const reviewReasons = reviewReasonsFor(activity, exclusions);
  const {sourceFields, ...effective} = activity;
  return {...effective, accountName:accounts.get(activity.accountId).displayName,
    amountText:exactSignedDecimal(activity),
    reportingDate:reportingDate(activity), needsReview:reviewReasons.length > 0, reviewReasons,
    observationCount:observations.get(activity.activityId) ?? 0, eventCount:events.get(activity.activityId) ?? 0};
}

function countBy(records, key) {
  const counts = new Map();
  for (const record of records) counts.set(record[key], (counts.get(record[key]) ?? 0) + 1);
  return counts;
}

/** Calculate only when the validated snapshot or financial scope changes. */
function buildWorkspaceScope(ledger, effective, {accountId, month}, index = null, prepared = null) {
  const accountsById = new Map(ledger.accounts.map(account => [account.accountId, account]));
  if (accountId && !accountsById.has(accountId)) fail('unknown-account');
  const accountIds = accountId ? [accountId] : ledger.accounts.map(account => account.accountId);
  const selected = new Set(accountIds);
  const scopedActivities = prepared ? [] : effective.filter(activity => activity.active && selected.has(activity.accountId));
  const selectedImports = prepared?.selectedImports ?? ledger.imports.filter(run => selected.has(run.accountId));
  const selectedSources = prepared?.selectedSources ?? ledger.observations.filter(observation => selected.has(observation.accountId) && pendingSource(observation));
  const dates = prepared?.dates ?? scopedActivities.flatMap(activity => [activity.effectiveDate, reportingDate(activity)]).filter(isCalendarDate);
  if (!prepared) { dates.push(...selectedImports.flatMap(run => [run.declaredCoverage.start, run.declaredCoverage.end])); dates.sort(); }
  const {start, end} = month ? monthBounds(month) : {start:dates[0] ?? null, end:dates.at(-1) ?? null};
  const inPeriod = date => !month || !isCalendarDate(date) || (date >= start && date <= end);
  const months = prepared?.months ?? new Set();
  if (!prepared) {
    for (const event of ledger.positionEvents || []) {
      if (!selected.has(event.accountId)) continue;
      if (event.effectiveDate) months.add(event.effectiveDate.slice(0, 7));
      if (event.month) months.add(event.month);
    }
    for (const run of selectedImports) addMonths(months, run.declaredCoverage.start, run.declaredCoverage.end);
    for (const activity of scopedActivities) {
      const date = reportingDate(activity);
      if (date) months.add(date.slice(0, 7));
    }
  }
  const currencies = prepared?.currencies ?? [...new Set([
    ...ledger.accounts.filter(account => selected.has(account.accountId)).map(account => account.currency),
    ...scopedActivities.map(activity => activity.currency).filter(currency => /^[A-Z]{3}$/.test(currency)),
  ])].sort();
  const scopes = start && end ? currencies.map(currency => ({start, end, currency, accountIds})) : [];
  const indexedReports = index ? scopes.map(scope => index.report(scope)) : null;
  const summary = indexedReports ? indexedReports.map(result => result.report) : summarizeLedgerPeriods(ledger,scopes);
  const exclusions = excludedReviewReasons(summary);
  const observationCounts = prepared?.observationCounts ?? countBy(ledger.observations, 'activityId');
  const eventCounts = prepared?.eventCounts ?? countBy(ledger.events, 'activityId');
  const scopedRows = (index ? index.activities({accountIds,month}) : scopedActivities.filter(activity => inPeriod(reportingDate(activity))))
    .map(activity => rowFor(activity, accountsById, observationCounts, eventCounts, exclusions));
  scopedRows.sort((a, b) => (b.reportingDate ?? b.effectiveDate).localeCompare(a.reportingDate ?? a.effectiveDate) ||
    a.activityId.localeCompare(b.activityId));
  const summaryAvailability = indexedReports ? Object.fromEntries(indexedReports.map(result => [result.report.currency,result.availability])) : Object.fromEntries(summary.map(report => {
    const excluded = new Set(report.excluded.map(value => value.activityId));
    const eligible = scopedActivities.filter(activity => {
      const date = reportingDate(activity);
      return date !== null && date >= start && date <= end && activity.lifecycleStatus === 'posted' &&
        activity.currency === report.currency && !excluded.has(activity.activityId);
    });
    const available = eligible.length > 0;
    return [report.currency, {available, eligibleActivityCount:eligible.length, incomeAvailable:available,
      spendingAvailable:available, cashAvailable:eligible.some(activity => ['checking', 'savings'].includes(accountsById.get(activity.accountId).accountType))}];
  }));
  const imports = selectedImports.filter(run => !month || (run.declaredCoverage.start <= end && run.declaredCoverage.end >= start))
    .map(run => ({importRunId:run.importRunId, accountId:run.accountId, accountName:accountsById.get(run.accountId).displayName,
      status:run.status, declaredCoverage:run.declaredCoverage, observedStart:run.observedStart, observedEnd:run.observedEnd,
      latestActivityDate:run.latestActivityDate, completedAt:run.completedAt, counts:run.counts,
      coverageReconciled:run.coverageReconciled, sourceFileRetentionStatus:run.sourceFileRetentionStatus}));
  const sourceReviews = selectedSources.filter(observation => inPeriod(observation.candidate.effectiveDate)).map(observation => ({
    observationId:observation.observationId, importRunId:observation.importRunId, accountId:observation.accountId,
    accountName:accountsById.get(observation.accountId).displayName, rowOrdinal:observation.rowOrdinal,
    sourceDescription:observation.candidate.sourceDescription ?? '', effectiveDate:observation.candidate.effectiveDate ?? null,
    amountMinor:observation.candidate.amountMinor, amountDecimal:observation.candidate.amountDecimal,
    currency:observation.candidate.currency, disposition:observation.disposition, reasonCode:observation.reasonCode,
  }));
  const qualifications = [
    'Known income and spending are partial totals, not a claim of complete history.',
    'Transfers and card payments do not count as income or spending. Unsupported investment activity stays excluded.',
    'The cash subtotal excludes transfers and card activity. It is not an account balance or total bank movement.',
    'Dated balances and qualified net worth appear separately below. Investment performance is unavailable.',
    'Search and review filters change displayed rows only. Account and month selections change the totals.',
    'Refunds belong to their posted month. Refunds without a posting date remain visible and excluded from totals.',
    'Declared coverage alone is not reconciliation evidence. This workspace does not upload or maintain original source files; row evidence is preserved.',
  ];
  if (!summary.length) qualifications.unshift('No dated coverage is available, so financial totals are unavailable.');
  return {accounts:ledger.accounts, months:[...months].sort().reverse(),
    rows:scopedRows, totalCount:scopedRows.length,
    summary, summaryAvailability, scope:{accountId, month, start, end, accountIds},
    coverage:{imports, importCount:imports.length, needsReviewImportCount:imports.filter(run => run.status === 'needs-review').length,
      latestImportAt:newest(selectedImports.flatMap(run => [run.completedAt, ...run.retryAttempts.map(attempt => attempt.completedAt)])),
      latestActivityDate:prepared?.latestActivityDate ?? newest(scopedActivities.map(activity => activity.effectiveDate)),
      coverageReconciled:imports.length > 0 && imports.every(run => run.coverageReconciled === true),
      sourceFilesRetained:imports.length > 0 && imports.every(run => run.sourceFileRetentionStatus === 'retained')},
    review:{activityCount:scopedRows.filter(row => row.needsReview).length, sourceCount:sourceReviews.length,
      unknownClassificationCount:scopedRows.filter(row => row.reviewReasons.includes('unclassified-activity')).length,
      unknownLifecycleCount:scopedRows.filter(row => row.reviewReasons.includes('unknown-lifecycle')).length},
    sourceReviews, qualifications};
}

function workspaceOptions({accountId = '', month = '', query = '', reviewOnly = false, page = 0, pageSize = 25} = {}) {
  if (typeof accountId !== 'string' || typeof query !== 'string' || typeof reviewOnly !== 'boolean' ||
      !Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) fail('invalid-workspace-options');
  if (month !== '') monthBounds(month);
  return {accountId, month, query, reviewOnly, page, pageSize};
}

const searchableText = row => [row.sourceDescription, row.normalizedDescription, row.accountName, row.categoryId,
  row.activityKind, row.lifecycleStatus, row.sourceAction, row.securitySymbol, row.currency,
  row.effectiveDate, row.postedDate].filter(value => typeof value === 'string').join(' ').toLowerCase();

/** A reader owns a defensive snapshot, never a cache over a caller's mutable graph.
 * Create a new reader after open, correction, save or verified reopen. Its private,
 * single-view cache is bounded: changing account/month replaces the prior view.
 * Account metadata and month buckets belong to this snapshot and are reused.
 * Search/review/pagination reuse reports but cannot change their financial scope.
 * Every result is detached so UI mutation cannot poison subsequent reads.
 */
export function createWorkspaceViewReader(ledger, {monthlyIndex = null} = {}) {
  const snapshot = structuredClone(ledger);
  const index = isCanonicalMonthIndexFor(monthlyIndex,snapshot) ? monthlyIndex : createCanonicalMonthIndex(snapshot);
  const preparedScopes = new Map();
  const observationCounts = countBy(snapshot.observations,'activityId'), eventCounts = countBy(snapshot.events,'activityId');
  const prepareScope = accountId => {
    if (preparedScopes.has(accountId)) return preparedScopes.get(accountId);
    const selected = value => !accountId || value.accountId === accountId;
    const scopedActivities = index.activities({accountIds:accountId ? [accountId] : snapshot.accounts.map(a => a.accountId)});
    const selectedImports = snapshot.imports.filter(selected), selectedSources = snapshot.observations.filter(o => selected(o) && pendingSource(o));
    const dates = scopedActivities.flatMap(a => [a.effectiveDate,reportingDate(a)]).filter(isCalendarDate);
    dates.push(...selectedImports.flatMap(r => [r.declaredCoverage.start,r.declaredCoverage.end])); dates.sort();
    const months = new Set();
    for (const event of snapshot.positionEvents || []) if (selected(event)) {
      if (event.effectiveDate) months.add(event.effectiveDate.slice(0,7));
      if (event.month) months.add(event.month);
    }
    for (const run of selectedImports) addMonths(months,run.declaredCoverage.start,run.declaredCoverage.end);
    for (const activity of scopedActivities) if (reportingDate(activity)) months.add(reportingDate(activity).slice(0,7));
    const currencies = [...new Set([...snapshot.accounts.filter(selected).map(a => a.currency),
      ...scopedActivities.map(a => a.currency).filter(c => /^[A-Z]{3}$/.test(c))])].sort();
    const prepared = {selectedImports,selectedSources,dates,months,currencies,observationCounts,eventCounts,
      latestActivityDate:newest(scopedActivities.map(a => a.effectiveDate))};
    preparedScopes.set(accountId,prepared);
    return prepared;
  };
  let cached = null;
  let searchTexts = null;
  let positionCache = null;
  let coverageCache = null;
  const accountScope = accountId => {
    if (typeof accountId !== 'string') fail('invalid-workspace-options');
    if (accountId && !snapshot.accounts.some(account => account.accountId === accountId)) fail('unknown-account');
    return accountId ? [accountId] : undefined;
  };
  return Object.freeze({view(options) {
    const selection = workspaceOptions(options);
    const {accountId, month, query, reviewOnly, pageSize} = selection;
    if (!cached || cached.scope.accountId !== accountId || cached.scope.month !== month) {
      cached = buildWorkspaceScope(snapshot, null, {accountId, month}, index, prepareScope(accountId));
      searchTexts = cached.rows.map(searchableText);
    }
    return selectWorkspaceRows(cached, searchTexts, selection);
  }, monthlySummaries() { return index.monthlySummaries(); }, position({asOf, accountId = ''} = {}) {
    const accountIds = accountScope(accountId);
    if (!isCalendarDate(asOf)) fail('invalid-position-as-of');
    if (!positionCache || positionCache.asOf !== asOf || positionCache.accountId !== accountId) {
      positionCache = {asOf, accountId, report:buildFinancialPosition(snapshot, {asOf, accountIds})};
    }
    return structuredClone(positionCache.report);
  }, coverage({month, accountId = ''} = {}) {
    const accountIds = accountScope(accountId);
    monthBounds(month);
    if (!coverageCache || coverageCache.month !== month || coverageCache.accountId !== accountId) {
      coverageCache = {month, accountId, report:buildAccountMonthCoverage(snapshot, {month, accountIds})};
    }
    return structuredClone(coverageCache.report);
  }});
}

function selectWorkspaceRows(scope, searchTexts, {query, reviewOnly, page:requestedPage, pageSize}) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = scope.rows.filter((row, i) => (!reviewOnly || row.needsReview) && terms.every(term => searchTexts[i].includes(term)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, pages - 1);
  return structuredClone({...scope, rows:filtered.slice(page * pageSize, (page + 1) * pageSize),
    filteredCount:filtered.length, page, pages, pageSize});
}

/** Safe one-shot read for callers that do not retain a snapshot reader. */
export function createWorkspaceView(ledger, options) {
  const effective = getEffectiveActivities(ledger);
  const selection = workspaceOptions(options);
  const scope = buildWorkspaceScope(ledger, effective, selection);
  return selectWorkspaceRows(scope, scope.rows.map(searchableText), selection);
}

/** Fetch provenance only when an activity detail is opened. */
export function getWorkspaceActivity(ledger, activityId) {
  const effective = getEffectiveActivities(ledger);
  const activity = effective.find(value => value.activityId === activityId);
  if (!activity) fail('unknown-activity');
  const account = ledger.accounts.find(value => value.accountId === activity.accountId);
  const date = reportingDate(activity) ?? activity.effectiveDate;
  const reports = summarizeLedgerPeriods(ledger, [{start:date, end:date, currency:activity.currency ?? account.currency, accountIds:[activity.accountId]}]);
  const reviewReasons = reviewReasonsFor(activity, excludedReviewReasons(reports));
  // A reversed decision can detach its observation from an inactive activity.
  // Its evidence and reversal still belong in that activity's audit detail.
  const observationIds = new Set(ledger.reviewDecisions.filter(value => value.activityId === activityId).map(value => value.observationId));
  const observations = ledger.observations.filter(value => value.activityId === activityId || observationIds.has(value.observationId));
  observations.forEach(value => observationIds.add(value.observationId));
  const importIds = new Set(observations.map(value => value.importRunId));
  return structuredClone({activity:{...activity, accountName:account.displayName, reportingDate:reportingDate(activity), amountText:exactSignedDecimal(activity),
    needsReview:reviewReasons.length > 0, reviewReasons},
    originalActivity:ledger.activities.find(value => value.activityId === activityId), account, observations,
    events:ledger.events.filter(value => value.activityId === activityId),
    reviewDecisions:ledger.reviewDecisions.filter(value => value.activityId === activityId || observationIds.has(value.observationId)),
    imports:ledger.imports.filter(value => importIds.has(value.importRunId))});
}
