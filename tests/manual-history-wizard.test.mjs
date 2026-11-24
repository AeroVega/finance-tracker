import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLedger, validateLedger} from '../js/canonical-import.mjs';
import {prepareHistoricalSummaries} from '../js/historical-monthly-summary.mjs';
import {decodeDraft, encodeDraft, DRAFT_MAX_BYTES} from '../tools/manual-history/draft.mjs';
import {buildManualHistory, estimateClosingNetWorth} from '../tools/manual-history/model.mjs';

const june = () => ({
  month:'2023-06', workbook:'Invented training source', worksheet:'Invented monthly review',
  currency:'USD', completeIncome:true, completeExpenses:true, income:[{label:'Income',amount:'4000'}],
  expenses:Object.entries({Rent:'1150.00',Food:'250.32',Transportation:'350.63',Health:'18.68',
    Entertainment:'40.66',Subscriptions:'34.99',Gifts:'75.00',Taxes:'2.89'}).map(([label,amount])=>({label,amount})),
  netWorth:''
});
const build = (months, end='2023-06') => buildManualHistory({start:'2023-01',end,sourceId:'invented-workbook-history',months});

test('invented June categories sum exactly without fabricating net worth', () => {
  const result = build([june()]);
  const [row] = result.input.records;
  assert.equal(result.input.version,2);
  assert.equal(row.summary.incomeTotal.amount,'4000.00');
  assert.equal(row.summary.expenseTotal.amount,'1923.17');
  assert.equal(Object.hasOwn(row.summary,'netWorthSnapshot'),false);
  assert.equal(row.provenance.mapping,'manual-monthly-entry-v1');
  assert.equal(row.provenance.sourceId,'invented-workbook-history');
  assert.equal(Object.hasOwn(row.provenance,'cell'),false);
  assert.equal(result.preview.rows[0].eligible,true);
  assert.equal(result.preview.findings.some(item=>item.code==='missing-summary-value'),false);
});

test('provided invented snapshot passes actual app preview and uncovered months stay visible', () => {
  const result = build([{...june(),month:'2023-01',netWorth:'5000'}],'2023-07');
  assert.equal(result.preview.rows[0].eligible,true);
  const ledger = prepareHistoricalSummaries(createLedger(), {
    input: JSON.parse(JSON.stringify(result.input)),
    decisions:[{recordIndex:0,action:'accept',reason:'Checked the invented complete month'}],
  });
  validateLedger(ledger);
  assert.equal(ledger.historicalSummaryBatches[0].version,2);
  assert.equal(ledger.historicalSummaryBatches[0].entries[0].record.summary.expenseTotal.amount,'1923.17');
  assert.ok(result.preview.findings.some(item=>item.code==='missing-month-summary'&&item.month==='2023-07'));
});

test('blank, explicit zero and rejected duplicates do not mutate the input', () => {
  const row = {...june(),month:'2023-01',income:[],expenses:[],zeroExpenses:true,netWorth:'-0.01'};
  const before = structuredClone(row);
  const [summary] = build([row]).input.records.map(x=>x.summary);
  assert.equal(Object.hasOwn(summary,'incomeTotal'),false);
  assert.equal(summary.expenseTotal.amount,'0.00');
  assert.equal(summary.netWorthSnapshot.amount,'-0.01');
  assert.deepEqual(row,before);
  for(const rows of [[june(),june()],[{...june(),completeExpenses:false}],[{...june(),income:[{label:'Pay',amount:'0.10'},{label:' pay ',amount:'0.20'}]}],
    [{...june(),income:[{label:'Pay',amount:''}]}],[{...june(),income:[{label:'Pay',amount:'0.001'}]}]])
    assert.throws(()=>build(rows),{code:'invalid-historical-summary-input'});
});

test('local-only UI starts inert and disallows form submission and network connections', async () => {
  const html = await readFile(new URL('../tools/manual-history/index.html',import.meta.url),'utf8');
  const module = await readFile(new URL('../tools/manual-history/wizard.mjs',import.meta.url),'utf8');
  assert.equal((html.match(/<fieldset disabled>/g)??[]).length,3);
  assert.match(html,/connect-src 'none'; form-action 'none'/);
  assert.match(module,/location\.protocol === 'http:' && \['localhost','127\.0\.0\.1'\]\.includes\(location\.hostname\)/);
});

test('observed January anchor gives exact later estimates until the first gap or missing total', () => {
  const data = [ {...june(),month:'2023-01',netWorth:'5000'}, {...june(),month:'2023-02'}, {...june(),month:'2023-04'} ];
  const {input} = build(data);
  const {records} = input;
  assert.deepEqual([...estimateClosingNetWorth(records)], [['2023-02',{currency:'USD',amount:'7076.83'}]]);
  assert.equal(records[1].summary.netWorthSnapshot,undefined);
  assert.equal(records[1].summary.netWorthEstimate,undefined);
  assert.equal(estimateClosingNetWorth(build([{...data[0]}, {...data[1], income:[]}]).input.records).size,0);
  assert.equal(estimateClosingNetWorth(build([{...data[0]}, {...data[1],currency:'EUR'}]).input.records).size,0);
  assert.throws(()=>build([{...june(),netWorth:'5000'}]),{code:'invalid-historical-summary-input'});
});

test('private draft round-trips staged months and metadata separately from tracker import', () => {
  const month = {...june(),zeroIncome:false,zeroExpenses:false};
  const draft = {end:'2023-06',sourceId:'invented-workbook-history',months:[month]};
  assert.deepEqual(decodeDraft(encodeDraft(draft)),draft);
  const tracker = build([month]).input;
  assert.throws(()=>decodeDraft(JSON.stringify(tracker)),{code:'invalid-historical-summary-input'});
  for (const invalid of [
    {...draft,months:[month,month]},
    {...draft,months:[{...month,expenses:[{label:'Rent',amount:'1'},{label:'RENT',amount:'2'}]}]},
    {...draft,months:[{...month,zeroIncome:'false'}]},
    {...draft,months:[{...month,extra:'unexpected'}]},
    {...draft,months:[{...month,expenses:[{label:12,amount:'1'}]}]},
  ]) assert.throws(()=>encodeDraft(invalid),{code:'invalid-historical-summary-input'});
  for (const malformed of ['{', '{}', ' '.repeat(DRAFT_MAX_BYTES + 1)])
    assert.throws(()=>decodeDraft(malformed),{code:'invalid-historical-summary-input'});
});
