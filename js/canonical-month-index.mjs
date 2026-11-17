import {getEffectiveActivities, reportActivityContribution} from './canonical-import.mjs';
import {isCalendarDate} from './import-reconciliation.mjs';
import {addExact, monthBounds} from './financial-position-contract.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';

const ownedIndexes = new WeakSet();
export const isCanonicalMonthIndexFor = (index,ledger) => ownedIndexes.has(index) && index.matches(ledger);
const fail = message => { throw new TypeError(message); };
const reportDate = a => a.activityKind === 'refund' ? a.postedDate : a.effectiveDate;
const zero = () => ({income:'0',spending:'0',cash:'0',eligibleActivityCount:0,cashActivityCount:0});
function sum(target, values) {
  for (const key of ['income','spending','cash']) target[key] = addExact(target[key], values[key]);
  target.eligibleActivityCount += values.eligibleActivityCount;
  target.cashActivityCount += values.cashActivityCount;
}
function addMonthRange(account, start, end) {
  let [year, month] = start.slice(0,7).split('-').map(Number);
  const last = end.slice(0,7);
  while (true) {
    const value = `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}`;
    if (value > last) break;
    bucketFor(account, value);
    if (++month === 13) { month = 1; year++; }
  }
}
function bucketFor(account, month) {
  if (!account.buckets.has(month)) account.buckets.set(month, {month, entries:[], common:[], currencies:new Map()});
  return account.buckets.get(month);
}
function currencyFor(bucket, currency) {
  if (!bucket.currencies.has(currency)) bucket.currencies.set(currency, {...zero(), entries:[], excluded:[]});
  return bucket.currencies.get(currency);
}
function exclude(entry, currency) {
  const reason = entry.undatedRefund ? 'missing-refund-posted-date'
    : ['pending','unknown-lifecycle'].includes(entry.contribution.reason) ? entry.contribution.reason
    : entry.activity.currency !== currency ? 'different-currency' : entry.contribution.reason;
  return reason ? {ordinal:entry.ordinal,activityId:entry.activity.activityId,reason} : null;
}

/** Owns one validated defensive snapshot. Indexes are derived, never balance or
 * reconciliation evidence. Replacing the source requires constructing a new index.
 * Full-month queries add cached exact totals. Partial boundary months use detail.
 */
export function createCanonicalMonthIndex(ledger) {
  const snapshot = structuredClone(ledger);
  const effective = getEffectiveActivities(snapshot);
  const accounts = new Map(snapshot.accounts.map(account => [account.accountId,
    {account,buckets:new Map(),imports:[],unresolved:[],all:[]}]));
  for (const run of snapshot.imports) {
    const account = accounts.get(run.accountId);
    account.imports.push(run);
    addMonthRange(account,run.declaredCoverage.start,run.declaredCoverage.end);
  }
  for (const observation of snapshot.observations) {
    if (!observation.resolved && ['review','rejected'].includes(observation.disposition)) accounts.get(observation.accountId).unresolved.push(observation);
  }
  for (const [ordinal, activity] of effective.entries()) {
    if (!activity.active) continue;
    const account = accounts.get(activity.accountId), date = reportDate(activity);
    const entry = {ordinal,activity,undatedRefund:activity.activityKind === 'refund' && activity.lifecycleStatus === 'posted' && activity.postedDate === null,
      contribution:reportActivityContribution(activity,account.account,activity.currency)};
    const bucket = bucketFor(account,isCalendarDate(date) ? date.slice(0,7) : '');
    bucket.entries.push(entry); account.all.push(entry);
    if (entry.undatedRefund || ['pending','unknown-lifecycle'].includes(entry.contribution.reason)) bucket.common.push(entry);
    else {
      const currency = currencyFor(bucket,activity.currency);
      currency.entries.push(entry);
      if (entry.contribution.reason) currency.excluded.push(entry);
      else sum(currency,{...entry.contribution,eligibleActivityCount:1,
        cashActivityCount:['checking','savings'].includes(account.account.accountType) ? 1 : 0});
    }
  }
  const firstExclusions = new WeakMap();
  for (const account of accounts.values()) for (const bucket of account.buckets.values()) {
    for (const entries of [bucket.common,...[...bucket.currencies.values()].map(value => value.excluded)]) {
      const first = new Map();
      for (const entry of entries) {
        const reason = entry.undatedRefund ? 'missing-refund-posted-date' : entry.contribution.reason;
        if (reason !== 'pending' && !first.has(reason)) first.set(reason,entry);
      }
      firstExclusions.set(entries,[...first.values()]);
    }
  }
  const selectedAccounts = accountIds => {
    if (!Array.isArray(accountIds) || accountIds.some(id => !accounts.has(id))) fail('unknown-account');
    return [...new Set(accountIds)].map(id => accounts.get(id));
  };
  const allAccountIds = [...accounts.keys()];
  function report({start,end,currency,accountIds = allAccountIds}, {includeExcluded = true} = {}) {
    if (!isCalendarDate(start) || !isCalendarDate(end) || start > end || !/^[A-Z]{3}$/.test(currency)) fail('invalid-report-scope');
    const selected = selectedAccounts(accountIds), totals = zero(), exclusions = [], firstReasons = new Map();
    const reasons = new Set(['coverage-not-reconciled']);
    if (selected.some(a => !a.imports.some(r => r.declaredCoverage.start <= start && r.declaredCoverage.end >= end))) reasons.add('missing-declared-coverage');
    if (selected.some(a => a.unresolved.some(o => !isCalendarDate(o.candidate.effectiveDate) || (o.candidate.effectiveDate >= start && o.candidate.effectiveDate <= end)))) reasons.add('unresolved-observations');
    let visitedMonths = 0, visitedDetails = 0;
    const remember = value => {
      if (!value) return;
      if (includeExcluded) exclusions.push(value);
      if (value.reason !== 'pending' && (!firstReasons.has(value.reason) || value.ordinal < firstReasons.get(value.reason))) firstReasons.set(value.reason,value.ordinal);
    };
    const consumeEntries = (entries, differentCurrency = false) => {
      const selected = includeExcluded ? entries : differentCurrency ? entries.slice(0,1) : firstExclusions.get(entries);
      for (const entry of selected) { visitedDetails++; remember(exclude(entry,currency)); }
    };
    for (const account of selected) for (const [month,bucket] of account.buckets) {
      if (month && (month < start.slice(0,7) || month > end.slice(0,7))) continue;
      visitedMonths++;
      const bounds = month ? monthBounds(month) : null;
      if (bounds && (start > bounds.start || end < bounds.end)) {
        for (const entry of bucket.entries) {
          const date = reportDate(entry.activity);
          if (date < start || date > end) continue;
          visitedDetails++;
          const omitted = exclude(entry,currency);
          if (omitted) remember(omitted);
          else sum(totals,{...entry.contribution,eligibleActivityCount:1,
            cashActivityCount:['checking','savings'].includes(account.account.accountType) ? 1 : 0});
        }
        continue;
      }
      const own = bucket.currencies.get(currency);
      if (own) sum(totals,own);
      consumeEntries(bucket.common);
      for (const [other, values] of bucket.currencies) consumeEntries(other === currency ? values.excluded : values.entries,other !== currency);
    }
    for (const [reason] of [...firstReasons].sort((a,b) => a[1] - b[1])) reasons.add(reason);
    exclusions.sort((a,b) => a.ordinal - b.ordinal);
    const result = {start,end,currency,income:totals.income,spending:totals.spending,cash:totals.cash,
      complete:false,reasons:[...reasons],excluded:exclusions.map(({ordinal,...item}) => item)};
    return {report:result,availability:{available:totals.eligibleActivityCount > 0,eligibleActivityCount:totals.eligibleActivityCount,
      incomeAvailable:totals.eligibleActivityCount > 0,spendingAvailable:totals.eligibleActivityCount > 0,cashAvailable:totals.cashActivityCount > 0},
      work:{visitedMonths,visitedDetails}};
  }
  let summaries = null;
  const monthlySummaries = () => {
    if (!summaries) {
      summaries = [];
      for (const [accountId,account] of accounts) for (const [month,bucket] of [...account.buckets].sort(([a],[b]) => a.localeCompare(b))) {
        if (!month) continue;
        const currencies = [...new Set([account.account.currency,...bucket.currencies.keys()])].filter(value => /^[A-Z]{3}$/.test(value)).sort();
        for (const currency of currencies) {
          const {start,end} = monthBounds(month);
          const result = report({start,end,currency,accountIds:[accountId]},{includeExcluded:false});
          const {excluded,...summary} = result.report;
          summaries.push({accountId,month,...summary,availability:result.availability});
        }
      }
    }
    return structuredClone(summaries);
  };
  const index = Object.freeze({
    matches(source) { return canonicalizeJcs(source) === canonicalizeJcs(snapshot); },
    effectiveActivities() { return structuredClone(effective); },
    activities({accountIds = allAccountIds, month = ''} = {}) {
      if (month) monthBounds(month);
      const entries = selectedAccounts(accountIds).flatMap(account => month
        ? [...(account.buckets.get(month)?.entries || []),...(account.buckets.get('')?.entries || [])] : account.all);
      return structuredClone(entries.map(entry => entry.activity));
    },
    report, monthlySummaries
  });
  ownedIndexes.add(index);
  return index;
}
