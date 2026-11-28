import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLedger} from '../js/canonical-import.mjs';
import {assertCanonicalLedgerTransition} from '../js/canonical-history.mjs';
import {categoryCatalog} from '../js/category-catalog.mjs';
import {applyCategoryEvents} from '../js/category-records.mjs';
import {applyPlanningEvent} from '../js/planning.mjs';
import {budgetTargetsFor} from '../js/planning-contract.mjs';
import {createWorkspaceViewReader, getWorkspaceActivity} from '../js/canonical-workspace-model.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';

const recipe = await createSyntheticFinancialYear();
let n = 0;
const options = {now:'2026-11-20T12:00:00.000Z', idFactory:() => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`};
const apply = (ledger, ...commands) => applyCategoryEvents(ledger, commands.map((command, i) => ({commandId:`category-${++n}-${i}`, ...command})), options);
const code = expected => error => error.code === expected;
const define = (label, extra = {}) => ({type:'define', label, direction:'spending', ...extra});

test('a new category gets a fresh ID, keeps its exact label and is an append-only record', () => {
  const ledger = apply(recipe.ledger, define('  Kids  &  School '));
  assert.equal(validateLedger(ledger), true);
  assertCanonicalLedgerTransition(recipe.ledger, ledger);
  const [record] = ledger.categoryEvents;
  assert.deepEqual({categoryId:record.categoryId, label:record.label, parentId:record.parentId, deleted:record.deleted},
    {categoryId:'kids-school', label:'Kids & School', parentId:null, deleted:false});
  assert.equal(categoryCatalog(ledger).label('kids-school'), 'Kids & School');
  // A record cannot be rewritten in a later ledger.
  const rewritten = structuredClone(ledger); rewritten.categoryEvents[0].label = 'Other name';
  assert.throws(() => assertCanonicalLedgerTransition(ledger, rewritten), code('history-rewrite-refused'));
});

test('categories nest one level, within one direction, with unique names among siblings', () => {
  let ledger = apply(recipe.ledger, define('Food'));
  ledger = apply(ledger, {type:'define', categoryId:'groceries', label:'Groceries', parentId:'food'});
  const catalog = categoryCatalog(ledger);
  assert.equal(catalog.path('groceries'), 'Food › Groceries');
  assert.equal(catalog.reported('groceries'), 'food');
  assert.deepEqual(catalog.childrenOf('food').map(item => item.id), ['groceries']);
  const order = catalog.choices('spending').map(item => item.id);
  assert.equal(order.indexOf('groceries'), order.indexOf('food') + 1);
  // No third level, no parent across directions, no duplicate sibling names.
  assert.throws(() => apply(ledger, define('Produce', {parentId:'groceries'})), code('invalid-category-parent'));
  assert.throws(() => apply(ledger, {type:'define', label:'Bonus', direction:'income', parentId:'food'}), code('invalid-category-parent'));
  assert.throws(() => apply(ledger, define('dining')), code('duplicate-category-name'));
  assert.equal(apply(ledger, define('Dining', {parentId:'food'})).categoryEvents.at(-1).categoryId, 'dining-2');
  // A parent cannot become a subcategory while it has subcategories.
  assert.throws(() => apply(ledger, {type:'define', categoryId:'food', label:'Food', parentId:'household'}), code('category-has-subcategories'));
});

test('a deleted category retires its ID: the name can return, the ID cannot', () => {
  let ledger = apply(recipe.ledger, {type:'delete', categoryId:'dining'});
  const catalog = categoryCatalog(ledger);
  assert.equal(catalog.retired('dining'), true);
  assert.equal(catalog.get('dining'), null);
  assert.equal(catalog.label('dining'), 'Dining');
  assert.equal(catalog.reported('dining'), null);
  ledger = apply(ledger, define('Dining'));
  assert.equal(ledger.categoryEvents.at(-1).categoryId, 'dining-2');
  assert.throws(() => apply(ledger, {type:'define', categoryId:'dining', label:'Dining'}), code('unknown-category'));
  const forged = structuredClone(ledger);
  forged.categoryEvents.push({...forged.categoryEvents[0], eventId:'00000000-0000-4000-9000-999999999999', commandId:'forged', deleted:false});
  assert.throws(() => validateLedger(forged), code('retired-category'));
  // A parent with subcategories is not deleted.
  const parent = apply(apply(recipe.ledger, define('Food')), {type:'define', categoryId:'groceries', label:'Groceries', parentId:'food'});
  assert.throws(() => apply(parent, {type:'delete', categoryId:'food'}), code('category-has-subcategories'));
});

test('implied categories keep their IDs and land on the list that uses them', () => {
  const catalog = categoryCatalog(recipe.ledger);
  assert.equal(catalog.get('salary').direction, 'income');
  assert.equal(catalog.get('groceries').direction, 'spending');
  assert.equal(catalog.get('salary').builtIn, false);
  assert.ok(catalog.choices('income').some(item => item.id === 'paycheck'));
});

test('a deleted category sends its transactions to Needs review and out of category totals', () => {
  const before = createWorkspaceViewReader(recipe.ledger);
  const dining = before.view({}).rows.find(row => row.categoryId === 'dining');
  const month = dining.reportingDate.slice(0, 7);
  const spentBefore = before.spendingByCategory({month, currency:'USD'});
  const ledger = apply(recipe.ledger, {type:'delete', categoryId:'dining'});
  const reader = createWorkspaceViewReader(ledger);
  const row = reader.view({reviewOnly:true}).rows.find(item => item.activityId === dining.activityId);
  assert.equal(row.categoryId, null);
  assert.deepEqual(row.reviewReasons, ['deleted-category']);
  assert.deepEqual(getWorkspaceActivity(ledger, dining.activityId).activity.reviewReasons, ['deleted-category']);
  const spent = reader.spendingByCategory({month, currency:'USD'});
  assert.equal(spent.some(item => item.categoryId === 'dining'), false);
  const total = items => items.reduce((sum, item) => sum + Number(item.spending), 0);
  assert.equal(total(spent).toFixed(2), total(spentBefore).toFixed(2));
});

test('a subcategory counts toward its parent, and filtering on the parent includes it', () => {
  let ledger = apply(recipe.ledger, define('Food'));
  ledger = apply(ledger, {type:'define', categoryId:'groceries', label:'Groceries', parentId:'food'}, {type:'define', categoryId:'dining', label:'Dining', parentId:'food'});
  const reader = createWorkspaceViewReader(ledger);
  const rows = reader.view({categories:['food'], limit:500}).rows;
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => ['groceries', 'dining'].includes(row.categoryId)));
  const month = rows[0].reportingDate.slice(0, 7);
  const spent = reader.spendingByCategory({month, currency:'USD'});
  assert.ok(spent.some(item => item.categoryId === 'food'));
  assert.equal(spent.some(item => ['groceries', 'dining'].includes(item.categoryId)), false);
});

function previewSession(ledger = recipe.ledger) {
  const session = new CanonicalWorkspaceSession({storage:{lifecycle:null}, online:() => true});
  session.preview(ledger);
  return session;
}

test('deleting a category ends its budget from this month and is one undoable step', () => {
  const budgeted = applyPlanningEvent(recipe.ledger, {type:'budget-target', commandId:'dining-budget', categoryId:'dining', currency:'USD', effectiveMonth:'2026-11', amountText:'150'}, options);
  const session = previewSession(budgeted);
  session.manageCategories({type:'delete', categoryId:'dining'}, '2026-12');
  assert.equal(categoryCatalog(session.ledger).retired('dining'), true);
  assert.equal(budgetTargetsFor(session.ledger, '2026-11')[0].amountText, '150.00');
  assert.deepEqual(budgetTargetsFor(session.ledger, '2026-12'), []);
  session.undoLastStagedChange();
  assert.deepEqual(session.ledger, budgeted);
});

test('a category created while reviewing is staged with the decision as one step', () => {
  const session = previewSession();
  const row = createWorkspaceViewReader(recipe.ledger).view({limit:500}).rows.find(item => item.activityKind === 'spending' && item.categoryId === 'household');
  session.quickClassify({activityId:row.activityId, activityKind:'spending', rationale:'Invented review.', newCategory:{label:'Pets', direction:'spending', parentId:'household'}});
  assert.equal(session.ledger.categoryEvents.at(-1).categoryId, 'pets');
  const reread = createWorkspaceViewReader(session.ledger).view({limit:500}).rows.find(item => item.activityId === row.activityId);
  assert.equal(reread.categoryId, 'pets');
  assert.equal(reread.reportedCategoryId, 'household');
  session.undoLastStagedChange();
  assert.deepEqual(session.ledger, recipe.ledger);
});

test('an import proposal cannot change category records', () => {
  const session = previewSession();
  const proposal = apply(recipe.ledger, define('Pets'));
  assert.throws(() => session.stageCanonicalImport(proposal), code('invalid-parsed-import'));
});

async function savedSession() {
  const {webcrypto} = await import('node:crypto');
  const {FullSnapshotApplication} = await import('../js/full-snapshot-application.mjs');
  const {HttpFullSnapshotDrive} = await import('./helpers/http-full-snapshot-drive.mjs');
  const http = new HttpFullSnapshotDrive();
  const lifecycle = new FullSnapshotApplication({folderId:http.folderId, accessToken:() => 'invented-test-token', fetchImpl:http.fetch, cryptoImpl:webcrypto,
    lifecycleTarget:null, isOnline:() => true, setIntervalImpl:() => 1, clearIntervalImpl:() => {}, visibilityDelayMs:0});
  await lifecycle.start({initialize:true});
  const store = lifecycle.createLedgerStore(); await store.load(); await store.save(recipe.ledger);
  const storage = {lifecycle:null, accessToken:'invented-token',
    async connect() { this.lifecycle = lifecycle; },
    createLedgerStore() { return this.lifecycle.createLedgerStore(); },
    async release() { const result = await this.lifecycle.release(); this.lifecycle = null; return result; }};
  return new CanonicalWorkspaceSession({storage, online:() => true});
}

test('category records save, reopen and restore from an encrypted backup exactly', async () => {
  const session = await savedSession(); await session.open();
  session.manageCategories([define('Food'), {type:'delete', categoryId:'travel'}], '2026-11');
  const proposed = structuredClone(session.ledger);
  await session.save(); await session.reopen();
  assert.deepEqual(session.ledger, proposed);
  assert.equal(categoryCatalog(session.ledger).retired('travel'), true);
  const {webcrypto} = await import('node:crypto');
  const {encodeFullSnapshotBackup, decodeFullSnapshotBackup} = await import('../js/full-snapshot-backup.mjs');
  const bytes = await encodeFullSnapshotBackup(proposed, {cryptoImpl:webcrypto, password:'invented password 1234'});
  assert.deepEqual(await decodeFullSnapshotBackup(bytes, {cryptoImpl:webcrypto, password:'invented password 1234'}), proposed);
});

test('category record IDs are reserved across the ledger', () => {
  const ledger = apply(recipe.ledger, define('Food'));
  const forged = structuredClone(ledger); forged.categoryEvents[0].eventId = ledger.events[0].eventId;
  assert.throws(() => validateLedger(forged), code('invalid-category-event'));
  const reused = structuredClone(ledger); reused.categoryEvents[0].commandId = ledger.events[0].commandId;
  assert.throws(() => validateLedger(reused), code('invalid-category-event'));
});
