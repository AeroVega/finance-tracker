import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalMonthIndex,serializeCanonicalMonthIndex,readCanonicalMonthIndex,MONTH_INDEX_ROOT,MONTH_INDEX_PREFIX,canonicalMonthSourceHash} from '../js/canonical-month-index.mjs';
import {serializeCanonicalLedger,serializeFragmentedCanonicalLedger,validateCanonicalSnapshot,CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {createWorkspaceView,createWorkspaceViewReader} from '../js/canonical-workspace-model.mjs';
import {applyFinancialEvent,applyFinancialEvents,prepareCanonicalImport,applyReviewDecision,reverseReviewDecision,summarizeLedger} from '../js/canonical-import.mjs';
import {canonicalizeJcs,sha256Hex} from '../js/transaction-protocol.mjs';
import {validateSyntheticApplicationSnapshot} from '../js/synthetic-application-structure.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {createLargeWorkspaceFixture} from './helpers/workspace-large-fixture.mjs';
import {replayFixture,replayRow,replayInput} from './helpers/ledger-replay-fixtures.mjs';
const fixture = await createSyntheticFinancialYear();
const annual = {start:'2025-01-01',end:'2025-12-31',currency:'USD'};
function compare(ledger,scopes) {
  const index = createCanonicalMonthIndex(ledger);
  for (const scope of scopes) {
    const expected = summarizeLedger(ledger,scope);
    assert.deepEqual(index.report(scope).report,expected);
    assert.deepEqual(index.report(scope,{includeExcluded:false}).report,{...expected,excluded:[]});
  }
  return index;
}

test('monthly index equals canonical reports across account, currency, partial-boundary and empty scopes', () => {
  const scopes = [annual,{...annual,start:'2025-01-13',end:'2025-06-17'}, {...annual,accountIds:[]},
    {...annual,currency:'EUR'}, {...annual,start:'2024-01-01'}, {...annual,start:'2027-01-01',end:'2027-12-31'}];
  for (const account of fixture.ledger.accounts) for (const month of ['01','02','12']) scopes.push({start:`2025-${month}-01`,end:`2025-${month}-${month === '02' ? '28' : '31'}`,currency:'USD',accountIds:[account.accountId,account.accountId]});
  const index = compare(fixture.ledger,scopes);
  assert.equal(index.report(annual,{includeExcluded:false}).work.visitedDetails < fixture.ledger.activities.length,true);
  assert.equal(index.activities({month:'2025-02'}).every(a => (a.activityKind === 'refund' ? a.postedDate : a.effectiveDate)?.startsWith('2025-02')),true);
  const summaries = index.monthlySummaries();
  assert.ok(summaries.length >= 48);
  assert.ok(summaries.every(s => s.complete === false && s.reasons.includes('coverage-not-reconciled')));
  assert.equal(summaries.some(s => 'balance' in s || 'week' in s),false);
});

test('undated refunds, pending rows, unknown money, multi-currency and reversed review decisions preserve exact exclusions', () => {
  let {ledger,options} = replayFixture(6,[replayRow(0),replayRow(1,{amountText:'1.00'}),
    replayRow(2,{lifecycleStatus:'pending'}),replayRow(3,{lifecycleStatus:'unknown',currency:'EUR'}),
    replayRow(4,{amountText:null}),replayRow(5,{valid:false,errorCode:'bad-date',effectiveDate:null})]);
  ledger = applyFinancialEvents(ledger,[{type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',commandId:'spending'},
    {type:'classification',activityId:ledger.activities[1].activityId,activityKind:'refund',categoryId:'invented',commandId:'refund'}],options);
  ledger = prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(0)],'invented-index-overlap'),options).ledger;
  ledger = applyReviewDecision(ledger,{observationId:ledger.observations.at(-1).observationId,action:'keep-separate'},options);
  ledger = reverseReviewDecision(ledger,{reviewDecisionId:ledger.reviewDecisions.at(-1).reviewDecisionId,rationale:'Invented duplicate decision reversed'},options);
  const index = compare(ledger,[{start:'2026-01-01',end:'2026-01-31',currency:'USD'},
    {start:'2027-01-01',end:'2027-01-31',currency:'EUR'}]);
  assert.equal(index.activities({month:'2027-01'}).length,1);
});

test('cross-year refund link and correction rebuild every affected month without rewriting detail', () => {
  let {ledger,options} = replayFixture(0,[]);
  const input = replayInput(ledger.accounts[0],[replayRow(0,{effectiveDate:'2025-12-31',amountText:'-900719925474099.99'}),
    replayRow(1,{effectiveDate:'2026-01-01',postedDate:'2026-02-01',amountText:'0.01'})],'invented-cross-year');
  input.coverageByAccount[ledger.accounts[0].accountId] = {start:'2025-12-01',end:'2026-12-31',provenance:'source-confirmed'};
  ledger = prepareCanonicalImport(ledger,input,options).ledger;
  ledger = applyFinancialEvent(ledger,{type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',categoryId:'invented-original',commandId:'spend'},options);
  const old = createCanonicalMonthIndex(ledger);
  ledger = applyFinancialEvent(ledger,{type:'refund-link',activityId:ledger.activities[1].activityId,originalActivityId:ledger.activities[0].activityId,commandId:'refund-link',evidence:{reason:'Invented cross-year refund'}},options);
  ledger = applyFinancialEvent(ledger,{type:'bank-correction',activityId:ledger.activities[0].activityId,amountText:'-900719925474099.98',commandId:'correct',evidence:{reason:'Invented correction'}},options);
  const index = compare(ledger,[{start:'2025-12-01',end:'2025-12-31',currency:'USD'},
    {start:'2026-01-01',end:'2026-01-31',currency:'USD'},{start:'2026-02-01',end:'2026-02-28',currency:'USD'}]);
  assert.equal(index.report({start:'2025-12-01',end:'2025-12-31',currency:'USD'}).report.spending,'900719925474099.98');
  assert.equal(index.report({start:'2026-02-01',end:'2026-02-28',currency:'USD'}).report.spending,'-0.01');
  assert.equal(old.matches(ledger),false);
  assert.equal(ledger.activities[0].amountDecimal,'-900719925474099.99');
});

test('owned index and workspace reject source mismatch and isolate caller/result mutation', () => {
  const ledger = structuredClone(fixture.ledger), index = createCanonicalMonthIndex(ledger);
  const baseline = index.report(annual).report;
  const returned = index.monthlySummaries(); returned[0].income = '999';
  index.effectiveActivities()[0].amountMinor = 1;
  ledger.accounts[0].displayName = 'Invented changed label';
  assert.equal(index.matches(ledger),false);
  assert.deepEqual(index.report(annual).report,baseline);
  const reader = createWorkspaceViewReader(ledger,{monthlyIndex:index});
  const corrupt = structuredClone(ledger); corrupt.activities[0].accountId = 'missing';
  assert.throws(() => createWorkspaceViewReader(corrupt,{monthlyIndex:{matches:() => true,effectiveActivities:() => []}}));
  assert.equal(reader.view().accounts[0].displayName,'Invented changed label');
  for (const month of ['2025-01','2025-02','2025-01']) assert.deepEqual(reader.view({month}),createWorkspaceView(ledger,{month}));
  assert.deepEqual(reader.monthlySummaries(),createCanonicalMonthIndex(ledger).monthlySummaries());
});

function memoryLifecycle() {
  const contents = new Map(); let revision = 0, mutations = 0;
  const manifest = () => ({syntheticOnly:true,revision,snapshot:Object.fromEntries([...contents.keys()].map(path => [path,'test-hash']))});
  return {contents,get mutations() { return mutations; },manifestFileId:'invented-manifest',
    readManifest:async () => manifest(),readObject:async path => new TextEncoder().encode(contents.get(path)),
    async transact(transaction) { assert.deepEqual(transaction.expectedBase,manifest()); for (const value of transaction.objects) contents.set(value.logicalPath,value.content); revision++; mutations++; },
    replace(path,text) { contents.set(path,text); revision++; }};
}

test('saved monthly groups reopen, repair semantic corruption explicitly, and retain canonical detail', async () => {
  const lifecycle = memoryLifecycle(), store = new CanonicalLedgerStore({lifecycle});
  await store.load(); await store.save(fixture.ledger);
  assert.equal(store.monthIndexStatus,'verified');
  assert.ok(lifecycle.contents.has(MONTH_INDEX_ROOT));
  const before = lifecycle.mutations;
  await store.save(fixture.ledger); assert.equal(lifecycle.mutations,before);
  const root = JSON.parse(lifecycle.contents.get(MONTH_INDEX_ROOT)), path = root.groups[0].path;
  const group = JSON.parse(lifecycle.contents.get(path)); group.summaries[0].income = '999999.00';
  lifecycle.replace(path,canonicalizeJcs(group));
  const reopened = new CanonicalLedgerStore({lifecycle});
  assert.deepEqual(await reopened.load(),fixture.ledger);
  assert.equal(reopened.monthIndexStatus,'rebuilt-invalid');
  assert.equal(lifecycle.mutations,before);
  assert.deepEqual(reopened.monthIndex.report(annual).report,summarizeLedger(fixture.ledger,annual));
  await reopened.save(fixture.ledger);
  assert.equal(reopened.monthIndexStatus,'verified');
  assert.equal(lifecycle.mutations,before + 1);
  const bytes = Object.fromEntries([...lifecycle.contents].map(([path,text]) => [path,new TextEncoder().encode(text)]));
  assert.equal(validateSyntheticApplicationSnapshot({objects:bytes}),true);
  assert.equal(validateCanonicalSnapshot({objects:bytes}),true,'canonical source validation ignores optional derived objects');
  const oldBackupAllowlist = Object.keys(bytes).every(path => path.startsWith('synthetic/canonical-v1/') || path === 'synthetic/dashboard-transactions.json');
  assert.equal(oldBackupAllowlist,false,'old backup readers refuse unknown sidecars instead of silently dropping them');
});

test('missing, stale, wrong-version, reordered, wrong-partition and self-rehashed corrupt indexes rebuild', async () => {
  const ledger = fixture.ledger, index = createCanonicalMonthIndex(ledger), source = serializeCanonicalLedger(ledger);
  const good = await serializeCanonicalMonthIndex(index,source);
  const read = objects => readCanonicalMonthIndex({ledger,sourceObjects:source,readText:async path => objects.get(path) ?? null});
  assert.equal((await read(good)).status,'verified');
  assert.equal((await read(new Map())).status,'rebuilt-missing');
  for (const mutate of [
    root => { root.sourceSha256 = '0'.repeat(64); },root => { root.version = 999; },
    root => { root.groups.reverse(); root.groups.push(root.groups[0]); },root => { root.groups[0].path = MONTH_INDEX_PREFIX + 'groups/999999.json'; }
  ]) {
    const objects = new Map(good), root = JSON.parse(objects.get(MONTH_INDEX_ROOT)); mutate(root);
    objects.set(MONTH_INDEX_ROOT,canonicalizeJcs(root));
    assert.match((await read(objects)).status,/^rebuilt-/);
  }
  for (const extra of ['\"\\ud800\"','1e400']) {
    const objects = new Map(good);
    objects.set(MONTH_INDEX_ROOT,objects.get(MONTH_INDEX_ROOT).replace('{',`{\"extra\":${extra},`));
    assert.equal((await read(objects)).status,'rebuilt-invalid');
  }
  const forged = new Map(good), root = JSON.parse(forged.get(MONTH_INDEX_ROOT)), path = root.groups[0].path;
  const group = JSON.parse(forged.get(path)); group.summaries[0].month = '2099-01'; group.summaries[0].complete = true;
  const text = canonicalizeJcs(group); forged.set(path,text); root.groups[0].sha256 = await sha256Hex(text);
  forged.set(MONTH_INDEX_ROOT,canonicalizeJcs(root)); assert.equal((await read(forged)).status,'rebuilt-invalid');
  const changed = new Map(source); changed.set([...source.keys()][0],source.values().next().value + ' ');
  assert.notEqual(await canonicalMonthSourceHash(source),await canonicalMonthSourceHash(changed),'exact byte changes invalidate the source binding');
  await assert.rejects(readCanonicalMonthIndex({ledger,sourceObjects:source,readText:async () => { throw new TypeError('network failed'); }}),/network failed/);
});

test('records-v1 and fragmented-v3 legacy snapshots reopen without sidecars and create them only on explicit save', async () => {
  for (const serialize of [serializeCanonicalLedger,serializeFragmentedCanonicalLedger]) {
    const lifecycle = memoryLifecycle();
    for (const [path,text] of serialize(fixture.ledger)) lifecycle.contents.set(path,text);
    const store = new CanonicalLedgerStore({lifecycle});
    assert.deepEqual(await store.load(),fixture.ledger);
    assert.equal(store.monthIndexStatus,'rebuilt-missing'); assert.equal(lifecycle.mutations,0);
    await store.save(fixture.ledger); assert.equal(store.monthIndexStatus,'verified');
    assert.deepEqual(await store.load(),fixture.ledger);
  }
});

test('a dense valid month summarizes without replay or visiting activity detail after indexing', () => {
  let {ledger,options} = replayFixture(1000);
  ledger = applyFinancialEvents(ledger,ledger.activities.map((activity,i) => ({type:'classification',activityId:activity.activityId,activityKind:'spending',commandId:`invented-${i}`})),options);
  const index = createCanonicalMonthIndex(ledger);
  const result = index.report({start:'2026-01-01',end:'2026-12-31',currency:'USD'},{includeExcluded:false});
  assert.equal(result.report.spending,'12340.00');
  assert.equal(result.work.visitedDetails,0); assert.equal(result.work.visitedMonths,12);
  assert.equal(index.activities({month:'2026-02'}).length,0);
});


test('one corrected month replaces only its summary group and the source binding', async () => {
  let {ledger,options} = createLargeWorkspaceFixture({perAccount:28,corrections:0,unresolvedPerAccount:0});
  const source = serializeCanonicalLedger(ledger);
  const before = await serializeCanonicalMonthIndex(createCanonicalMonthIndex(ledger),source);
  ledger = applyFinancialEvent(ledger,{type:'bank-correction',activityId:ledger.activities[0].activityId,
    amountText:'12.00',commandId:'invented-summary-correction',evidence:{reason:'Invented corrected amount'}},options);
  const correctedSource = serializeCanonicalLedger(ledger);
  const after = await serializeCanonicalMonthIndex(createCanonicalMonthIndex(ledger),correctedSource);
  const changed = [...after].filter(([path,text]) => before.get(path) !== text).map(([path]) => path).sort();
  assert.deepEqual(changed,[MONTH_INDEX_PREFIX + 'groups/000000.json',MONTH_INDEX_ROOT]);
  for (const [path,text] of after) if (path !== MONTH_INDEX_ROOT) assert.ok(JSON.parse(text).summaries.length <= 64);
  const reopened = await readCanonicalMonthIndex({ledger,sourceObjects:correctedSource,readText:async path => before.get(path) ?? null});
  assert.equal(reopened.status,'rebuilt-stale');
  const scope = {start:'2023-01-01',end:'2023-01-31',currency:'USD',accountIds:[ledger.accounts[0].accountId]};
  assert.equal(reopened.index.report(scope).report.income,'142.00');
});
