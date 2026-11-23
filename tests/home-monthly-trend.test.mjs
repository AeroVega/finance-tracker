import test from 'node:test';
import assert from 'node:assert/strict';
import {homeMonthlyTrend} from '../js/home-monthly-trend.mjs';

const first = {accountId:'invented-checking',displayName:'Invented checking',currency:'USD'};
const second = {accountId:'invented-savings',displayName:'Invented savings',currency:'USD'};
const view = {accounts:[first,second], months:['2025-03'], scope:{accountId:''}};
const aggregate = {kind:'aggregate'};
const row = (month, {currency = 'USD', expenseCurrency = currency, scope = aggregate, sourceId = 'invented-source', report = null} = {}) => ({
  month, source:report ? 'transactions' : 'workbook', report, record:{scope,
    summary:{incomeTotal:{amount:'100.012300',currency},expenseTotal:{amount:'0.00',currency:expenseCurrency}},
    provenance:{workbook:'Invented.xlsx',worksheet:'H',mapping:'v1',sourceId}}
});
const mustNotReadTransactions = {monthlyReport() { assert.fail('Do not use raw transactions to fill this history'); }};

test('history shows comparable workbook/reconciled monthly evidence; it never fills a gap or blends currencies', () => {
  const scope = {kind:'accounts',accountIds:[first.accountId]};
  const history = [
    row('2024-10',{scope,sourceId:'other',currency:'EUR'}),
    row('2024-12',{scope:{kind:'accounts',accountIds:[second.accountId]}}),
    row('2025-01',{scope}),
    row('2025-03',{scope,report:{income:'90000000000000001.234',spending:'-5.00',currency:'USD'}})
  ];
  const trend = homeMonthlyTrend(history,view,mustNotReadTransactions);
  assert.equal(trend.currency,'USD');
  assert.deepEqual(trend.rows.map(r => r.month),['2024-10','2024-11','2024-12','2025-01','2025-02','2025-03']);
  assert.deepEqual(trend.rows.map(r => [r.income,r.spending]), [
    [null,null],[null,null],[null,null],['100.012300','0.00'],[null,null],['90000000000000001.234','-5.00']
  ]);
  assert.equal(trend.rows[3].source,'Workbook-reported summary');
  assert.equal(trend.rows[5].source,'Reconciled transaction detail');
  assert.match(trend.context,/Invented checking/);
});

test('unrelated aggregate sources and unknown coverage cannot be combined; incompatible pairs stay unavailable', () => {
  const history = [row('2025-01',{sourceId:'other'}),row('2025-02'),row('2025-03')];
  assert.deepEqual(homeMonthlyTrend(history,view,mustNotReadTransactions).rows.slice(-3).map(r=>r.income),[null,'100.012300','100.012300']);
  const unknown = history.map(item => ({...item,record:{...item.record,scope:{kind:'unknown'}}}));
  assert.deepEqual(homeMonthlyTrend(unknown,view,mustNotReadTransactions).rows.slice(-3).map(r=>r.income),[null,null,'100.012300']);
  assert.match(homeMonthlyTrend([row('2025-03',{expenseCurrency:'EUR'})],view,mustNotReadTransactions).context,/different currencies/);
});

test('selected single-account transaction trend uses canonical availability and separates mixed currencies', () => {
  const scope = {accountId:first.accountId};
  const reader = {monthlyReport({month,currency,accountId}) {
    assert.equal(currency,'USD');
    assert.equal(accountId,first.accountId);
    return month === '2025-03' ? {income:'0',spending:'-12.34'} : {income:null,spending:null};
  }};
  const trend = homeMonthlyTrend([row('2025-03')],{...view,scope},reader);
  assert.deepEqual(trend.rows.at(-1), {month:'2025-03',source:'Known transactions · possibly incomplete',income:'0',spending:'-12.34'});
  assert.deepEqual(trend.rows.at(-2), {month:'2025-02',source:'No eligible transaction data',income:null,spending:null});
  assert.match(trend.context,/possibly|partial/);
  const mixed = {...view,accounts:[first,{...second,currency:'EUR'}]};
  assert.equal(homeMonthlyTrend([],mixed,mustNotReadTransactions).rows.length,0);
  assert.match(homeMonthlyTrend([],mixed,mustNotReadTransactions).context,/Different currencies are not combined/);
  assert.match(homeMonthlyTrend([],{...view,months:[]},mustNotReadTransactions).context,/No dated monthly evidence/);
});
