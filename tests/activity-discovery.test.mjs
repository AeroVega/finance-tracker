import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFinancialEvent, getEffectiveActivities} from '../js/canonical-import.mjs';
import {createWorkspaceView, createWorkspaceViewReader, activityTypeGroup, ACTIVITY_TYPE_GROUPS} from '../js/canonical-workspace-model.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {BUILT_IN_CATEGORIES, categoryCatalog, categoryIdFromText} from '../js/category-catalog.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';

// Invented data only. These checks cover Activity discovery: type, category and
// status filters, ordering, month sections and inline review staging.
const recipe = await createSyntheticFinancialYear();
const ledger = recipe.ledger;
const cents = value => { const [whole, fraction = ''] = value.replace('-', '').split('.'); return (value.startsWith('-') ? -1 : 1) * (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))); };
const all = options => createWorkspaceViewReader(ledger).view({limit:1000, ...options});

test('type families keep investment kinds apart from ordinary spending', () => {
  for (const kind of ['spending', 'income', 'transfer', 'refund', 'unclassified']) assert.equal(activityTypeGroup(kind), kind);
  for (const kind of ['trade', 'dividend', 'interest', 'fee', 'contribution', 'distribution', 'valuation-change']) assert.equal(activityTypeGroup(kind), 'investment');
  assert.equal(activityTypeGroup('cash-transaction'), 'other');
  assert.deepEqual(ACTIVITY_TYPE_GROUPS, ['spending', 'income', 'transfer', 'refund', 'investment', 'other', 'unclassified']);
});

test('type, category and status filters narrow rows only; the period summary is unchanged', () => {
  const base = all({}), spending = all({types:['spending']});
  assert.equal(base.filteredCount, 253);
  assert.ok(spending.rows.length > 0 && spending.rows.every(row => row.typeGroup === 'spending'));
  assert.deepEqual(spending.summary, base.summary);
  const groceries = all({types:['spending'], categories:['groceries']});
  assert.ok(groceries.rows.length > 0 && groceries.rows.every(row => row.categoryId === 'groceries'));
  const uncategorized = all({categories:['']});
  assert.ok(uncategorized.rows.length > 0 && uncategorized.rows.every(row => row.categoryId === null));
  const either = all({types:['income', 'refund']});
  assert.equal(either.filteredCount, base.facets.types.find(t => t.id === 'income').count + base.facets.types.find(t => t.id === 'refund').count);
  const review = all({reviewOnly:true, types:['unclassified']});
  assert.ok(review.rows.every(row => row.needsReview && row.activityKind === 'unclassified'));
  assert.equal(all({pendingOnly:true}).filteredCount, 0, 'the invented year has no pending activity');
});

test('facet counts follow account, period and search but not the other facets', () => {
  const view = all({types:['spending'], categories:['groceries'], reviewOnly:true});
  const base = all({});
  assert.deepEqual(view.facets, base.facets, 'a selected facet never narrows its own choices');
  assert.equal(base.facets.total, 253);
  assert.equal(base.facets.review, base.review.activityCount);
  assert.equal(base.facets.types.reduce((sum, t) => sum + t.count, 0), 253);
  assert.equal(base.facets.categories.at(-1).id, '', 'No category is listed last');
  const searched = all({query:'utility'});
  assert.equal(searched.facets.total, searched.filteredCount);
});

test('sorts are exact, stable and keep unknown amounts last', () => {
  const out = all({sort:'largest-out'}).rows, incoming = all({sort:'largest-in'}).rows;
  const outValues = out.filter(row => row.amountText?.startsWith('-')).map(row => cents(row.amountText));
  assert.deepEqual(outValues, [...outValues].sort((a, b) => a - b));
  assert.ok(out[0].amountText.startsWith('-'));
  const firstIncoming = out.findIndex(row => row.amountText && !row.amountText.startsWith('-'));
  assert.ok(out.slice(firstIncoming).every(row => !row.amountText?.startsWith('-')), 'money out ranks before money in');
  const inValues = incoming.filter(row => row.amountText && !row.amountText.startsWith('-')).map(row => cents(row.amountText));
  assert.deepEqual(inValues, [...inValues].sort((a, b) => b - a));
  const oldest = all({sort:'oldest'}).rows.map(row => row.reportingDate ?? row.effectiveDate);
  assert.deepEqual(oldest, [...oldest].sort());
  assert.deepEqual(all({sort:'oldest'}).rows.map(row => row.activityId), all({sort:'oldest'}).rows.map(row => row.activityId));
  assert.deepEqual(all({sort:'largest-out'}).groups, [], 'amount orders are not grouped by month');
});

test('unfiltered month sections equal the posted month report; filtered sections are subtotals', () => {
  const reader = createWorkspaceViewReader(ledger);
  const view = reader.view({limit:1000});
  assert.equal(view.groups.length, 12);
  assert.equal(view.groups.reduce((sum, group) => sum + group.count, 0), 253);
  for (const group of view.groups) {
    const report = reader.monthlyReport({month:group.month, currency:'USD'});
    const total = group.totals.find(item => item.currency === 'USD');
    assert.equal(total.income, report.income, `${group.month} income`);
    assert.equal(total.spending, report.spending, `${group.month} spending`);
  }
  const december = view.groups[0];
  assert.deepEqual([december.month, december.count, december.notCounted], ['2025-12', 21, 4]);
  const dining = reader.view({limit:1000, categories:['dining'], month:'2025-12'});
  const sum = dining.rows.reduce((value, row) => value - cents(row.amountText), 0);
  assert.equal(cents(dining.groups[0].totals[0].spending), sum);
  assert.equal(dining.groups[0].totals[0].income, '0');
  const flagged = reader.view({limit:1000, reviewOnly:true, month:'2025-12'});
  // Unlinked transfers are flagged but posted: they count, as neither income nor spending.
  const transfers = flagged.rows.filter(row => row.activityKind === 'transfer').length;
  assert.deepEqual(flagged.groups[0].totals, [{currency:'USD', income:'0', spending:'0', contributing:transfers}], 'flagged rows add nothing to income or spending');
  assert.equal(flagged.groups[0].notCounted, flagged.filteredCount - transfers);
});

test('a pending row is listed, counted as not counted and excluded from its section total', () => {
  const target = getEffectiveActivities(ledger).find(activity => activity.activityKind === 'spending' && activity.effectiveDate.startsWith('2025-12'));
  const pending = applyFinancialEvent(ledger, {activityId:target.activityId, type:'posting-status-correction', commandId:'invented-pending-command',
    lifecycleStatus:'pending', postedDate:null, evidence:{rationale:'Invented pending evidence'}}, {now:() => '2025-12-30T00:00:00.000Z', id:() => 'invented-pending-event'});
  const before = createWorkspaceViewReader(ledger).view({month:'2025-12', limit:1000}).groups[0];
  const view = createWorkspaceViewReader(pending).view({month:'2025-12', limit:1000});
  assert.equal(view.facets.pending, 1);
  assert.equal(view.groups[0].notCounted, before.notCounted + 1);
  assert.equal(cents(view.groups[0].totals[0].spending), cents(before.totals[0].spending) + cents(target.amountDecimal ?? (target.amountMinor / 100).toFixed(2)));
  const only = createWorkspaceViewReader(pending).view({pendingOnly:true});
  assert.deepEqual(only.rows.map(row => row.activityId), [target.activityId]);
});

test('limit shows a growing prefix and the one-shot view matches the cached reader', () => {
  const reader = createWorkspaceViewReader(ledger);
  const first = reader.view({limit:50}), more = reader.view({limit:100});
  assert.equal(first.rows.length, 50); assert.equal(first.hasMore, true);
  assert.deepEqual(more.rows.slice(0, 50), first.rows);
  assert.equal(reader.view({limit:300}).hasMore, false);
  const options = {types:['spending'], sort:'largest-out', limit:20, query:'invented'};
  assert.deepEqual(reader.view(options), createWorkspaceView(ledger, options));
  assert.equal(reader.view({pageSize:4}).rows.length, 4, 'Home paging still works');
});

test('invalid discovery options fail closed', () => {
  const reader = createWorkspaceViewReader(ledger);
  for (const options of [{types:['groceries']}, {types:'spending'}, {categories:[null]}, {sort:'amount'}, {limit:0}, {limit:1.5}, {pendingOnly:'yes'}]) {
    assert.throws(() => reader.view(options), /invalid-workspace-options/);
  }
});

test('category catalog labels, normalizes and merges used categories without duplicates', () => {
  assert.equal(new Set(BUILT_IN_CATEGORIES.map(category => category.id)).size, BUILT_IN_CATEGORIES.length);
  const catalog = categoryCatalog({events:[{categoryId:'groceries'}, {categoryId:'pet-care'}, {categoryId:''}]});
  assert.equal(catalog.label('transport'), 'Transportation');
  assert.equal(catalog.label('card-payment'), 'Card payment');
  assert.equal(catalog.label(null), 'No category');
  assert.equal(categoryIdFromText('  Pet Care & Vet '), 'pet-care-vet');
  assert.equal(categoryIdFromText('---'), '');
  const choices = catalog.choices('spending');
  assert.equal(choices.filter(choice => choice.id === 'groceries').length, 1);
  assert.ok(choices.some(choice => choice.id === 'pet-care' && !choice.builtIn));
  assert.deepEqual(choices.map(choice => choice.label), [...choices.map(choice => choice.label)].sort((a, b) => a.localeCompare(b, 'en')));
  assert.ok(catalog.choices('income').some(choice => choice.id === 'paycheck'));
});

function previewSession() {
  const session = new CanonicalWorkspaceSession({storage:{lifecycle:null}, online:() => true});
  session.preview(ledger);
  return session;
}
const byDescription = (value, description) => getEffectiveActivities(value).find(activity => activity.sourceDescription === description);

test('quick classify stages type and category as one undoable step with a category rule', () => {
  const session = previewSession();
  const fee = byDescription(session.ledger, 'INVENTED BROKERAGE FEE');
  const events = session.ledger.events.length;
  session.quickClassify({activityId:fee.activityId, activityKind:'spending', categoryId:'fees-and-interest', rationale:'Reviewed in Activity'});
  const after = getEffectiveActivities(session.ledger).find(activity => activity.activityId === fee.activityId);
  assert.equal(after.activityKind, 'spending');
  assert.equal(after.categoryId, 'fees-and-interest');
  const added = session.ledger.events.slice(events);
  assert.deepEqual(added.map(event => event.eventType), ['classification', 'category-correction']);
  assert.ok(added.every(event => event.evidence.rationale === 'Reviewed in Activity'));
  assert.deepEqual([added[1].prospectiveRule.version, added[1].prospectiveRule.requested, added[1].prospectiveRule.enabled], [2, false, false],
    'a category becomes a rule for later imports only when the owner opts in');
  assert.equal(session.dirty, true);
  session.undoLastStagedChange();
  assert.equal(session.ledger.events.length, events, 'one undo removes both events');
  assert.equal(getEffectiveActivities(session.ledger).find(a => a.activityId === fee.activityId).activityKind, fee.activityKind);
});

test('quick classify keeps an existing category on a type-only change and rejects bad input atomically', () => {
  const session = previewSession();
  const rent = byDescription(session.ledger, 'INVENTED RENT');
  session.quickClassify({activityId:rent.activityId, activityKind:'transfer', rationale:'Invented transfer check'});
  assert.equal(getEffectiveActivities(session.ledger).find(activity => activity.activityId === rent.activityId).categoryId, rent.categoryId);
  const snapshot = structuredClone(session.ledger);
  assert.throws(() => session.quickClassify({activityId:rent.activityId, activityKind:'income', categoryId:'housing', rationale:'Wrong sign'}), /classification-amount-conflict/);
  assert.deepEqual(session.ledger, snapshot, 'a rejected classification leaves no half-applied category');
  assert.throws(() => session.quickClassify({activityId:rent.activityId, activityKind:'spending', rationale:' '}), /correction-rationale-required/);
  assert.throws(() => session.quickClassify({activityId:rent.activityId, activityKind:'unclassified', rationale:'x'}), /unsupported-classification/);
  assert.throws(() => session.quickClassify({activityId:rent.activityId, activityKind:'transfer', categoryId:' ', rationale:'x'}), /category-required/);
  const unchanged = session.ledger;
  assert.equal(session.quickClassify({activityId:rent.activityId, activityKind:'transfer', rationale:'No change'}), unchanged);
});

test('opting in makes the staged category a rule for later imports; correct() defaults to no rule', () => {
  const session = previewSession();
  const fee = byDescription(session.ledger, 'INVENTED BROKERAGE FEE');
  session.quickClassify({activityId:fee.activityId, activityKind:'spending', categoryId:'fees-and-interest', rationale:'Opted in', createRule:true});
  const rule = session.ledger.events.at(-1).prospectiveRule;
  assert.deepEqual([rule.version, rule.requested, rule.enabled], [2, true, true]);
  const rent = byDescription(session.ledger, 'INVENTED RENT');
  session.correct({activityId:rent.activityId, type:'category-correction', categoryId:'housing-costs', rationale:'Invented note'});
  const declined = session.ledger.events.at(-1).prospectiveRule;
  assert.deepEqual([declined.version, declined.requested, declined.enabled], [2, false, false]);
});

test('category spending sums exactly to the month report, and a year view covers exactly its months', () => {
  const reader = createWorkspaceViewReader(ledger);
  const months = Array.from({length:12}, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
  let yearRows = 0;
  for (const month of months) {
    const report = reader.monthlyReport({month, currency:'USD'});
    const categories = reader.spendingByCategory({month, currency:'USD'});
    const total = categories.reduce((sum, item) => sum + cents(item.spending), 0);
    assert.equal(total, report.spending === null ? 0 : cents(report.spending), `${month} categories account for all spending`);
    assert.ok(categories.every(item => typeof item.categoryId === 'string' && item.count > 0));
    yearRows += reader.view({month, limit:1000}).filteredCount;
  }
  const year = reader.view({month:'2025', limit:1000});
  assert.equal(year.filteredCount, yearRows, 'no month is dropped or counted twice');
  assert.deepEqual([year.scope.start, year.scope.end], ['2025-01-01', '2025-12-31']);
  assert.equal(year.groups.length, 12, 'Activity keeps month sections inside a year');
  assert.throws(() => reader.view({month:'25'}), /invalid-workspace-month/);
});
