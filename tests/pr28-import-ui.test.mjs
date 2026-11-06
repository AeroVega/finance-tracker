import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseProviderCsv } from '../js/provider-csv.mjs';
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent, applyReviewDecision, reverseReviewDecision, getEffectiveActivities, summarizeLedger } from '../js/canonical-import.mjs';
const script = await readFile(new URL('../prototype/pr28-import.mjs',import.meta.url),'utf8');
const html = await readFile(new URL('../prototype/pr28-import.html',import.meta.url),'utf8');

test('workbench confines CSV selection to fixed bundled invented sources',async()=>{
  assert.doesNotMatch(html,/type=["']file["']/);
  assert.doesNotMatch(script,/innerHTML|insertAdjacentHTML|console\.|saveSyntheticSnapshot/);
  const paths = [...script.matchAll(/'\.\.\/(fixtures\/[^']+\.csv)'/g)].map(match=>match[1]);
  assert.equal(paths.length,5);
  for(const path of paths) assert.ok((await readFile(new URL('../'+path,import.meta.url))).length);
  assert.match(script,/new CanonicalLedgerStore/); assert.match(script,/await store\.save\(ledger\)/);
});

test('coverage controls provide independent month navigation and explicit confirmation',()=>{
  assert.match(script,/let month = new Date/);
  assert.match(script,/calendar\(calendars,'Declared start'/);
  assert.match(script,/calendar\(calendars,'Declared end'/);
  assert.match(script,/previous month/); assert.match(script,/next month/);
  assert.match(script,/!form\.confirm\.checked/);
  assert.match(script,/provenance:'user-confirmed'/);
  assert.match(script,/if \(busy\) return/);
});

test('workbench fixture maps into the canonical API and preserves qualified exact totals',async()=>{
  const parsed = await parseProviderCsv({bytes:await readFile(new URL('../fixtures/wells-fargo.csv',import.meta.url)),sourceFormat:'wells-fargo-csv-v1'});
  let ledger = registerAccount(createLedger(),{institutionId:parsed.institutionId,name:'Invented UI test',currency:'USD',accountType:'checking'});
  const accountId=ledger.accounts[0].accountId;
  ledger=prepareCanonicalImport(ledger,{parsed,accountMappings:{default:accountId},coverageByAccount:{[accountId]:{start:'2026-01-01',end:'2026-01-31',provenance:'user-confirmed'}},syntheticOnly:true}).ledger;
  ledger=applyFinancialEvent(ledger,{type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',commandId:crypto.randomUUID(),evidence:{reason:'Invented test classification'}});
  const result=summarizeLedger(ledger,{start:'2026-01-01',end:'2026-01-31',currency:'USD',accountIds:[accountId]});
  assert.equal(result.spending,'12.34'); assert.equal(result.complete,false); assert.ok(result.reasons.length);
  assert.equal(ledger.observations.length,2);
});

test('paired calendars retain 44px day targets in a labelled local scroll region',async()=>{
  const css=await readFile(new URL('../prototype/pr28-import.css',import.meta.url),'utf8');
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(320px,1fr\)\)/);
  assert.match(css,/grid-template-columns:repeat\(7,minmax\(44px,1fr\)\)/);
  assert.match(css,/max-width:100%;overflow-x:auto/);
  assert.match(css,/label input\[type="checkbox"\].*width:24px/);
  assert.match(script,/calendars\.tabIndex = 0/);
  assert.match(script,/calendars\.setAttribute\('aria-label'/);
  assert.match(script,/Scroll sideways to see both calendars/);
});

test('validation failures use safe codes and save/reopen report record counts',()=>{
  for(const code of ['account-mapping-required','coverage-dates-required','coverage-order-invalid','coverage-confirmation-required','account-name-required','evidence-required','review-rationale-required','match-target-required']) {
    assert.ok(script.includes("inputError('"+code+"')"),code);
  }
  assert.doesNotMatch(script,/throw new Error\(/);
  assert.match(script,/saved and verified\. ' \+ recordCounts\(\)/);
  assert.match(script,/reopened and verified\. ' \+ recordCounts\(\)/);
  assert.match(script,/source observations/);
});

test('workbench exposes explicit currency, append-only reversal, and effective categories',()=>{
  assert.match(script,/account\.displayName/);
  assert.match(script,/New account ISO currency, explicitly confirmed by you/);
  assert.match(script,/currency:form\.currency\.value\.trim\(\)\.toUpperCase\(\)/);
  assert.match(script,/review\.reasonCode==='missing-currency'/);
  assert.match(script,/Explicit currency for this source row/);
  assert.match(script,/reverseReviewDecision\(ledger,/);
  assert.match(script,/Return to review/);
  assert.match(script,/getEffectiveActivities\(ledger\)/);
  assert.match(script,/prospective category rules/);
});

test('Fidelity workbench path preserves missing currency and supports recorded review reversal',async()=>{
  const parsed=await parseProviderCsv({bytes:await readFile(new URL('../fixtures/fidelity.csv',import.meta.url)),sourceFormat:'fidelity-accounts-history-csv-v1'});
  let ledger=createLedger();const accountMappings={},coverageByAccount={};
  for (const key of parsed.sourceAccountKeys) {
    ledger=registerAccount(ledger,{institutionId:'fidelity',displayName:'Invented '+key,currency:'USD',accountType:'retirement'});
    const id=ledger.accounts.at(-1).accountId;accountMappings[key]=id;coverageByAccount[id]={start:'2026-03-01',end:'2026-03-31',provenance:'user-confirmed'};
  }
  ledger=prepareCanonicalImport(ledger,{parsed,accountMappings,coverageByAccount,syntheticOnly:true}).ledger;
  const row=ledger.observations.find(item=>item.reasonCode==='missing-currency');assert.ok(row);
  ledger=applyReviewDecision(ledger,{observationId:row.observationId,action:'keep-separate',currency:'USD',rationale:'Explicit currency confirmed for this invented fixture'});
  assert.equal(ledger.observations.find(item=>item.observationId===row.observationId).sourceFields.Currency,'');
  assert.equal(getEffectiveActivities(ledger)[0].lifecycleStatus,'unknown');
  ledger=reverseReviewDecision(ledger,{reviewDecisionId:ledger.reviewDecisions.at(-1).reviewDecisionId,rationale:'Recheck invented evidence'});
  assert.equal(ledger.reviewDecisions.at(-1).action,'reverse');
  assert.equal(ledger.observations.find(item=>item.observationId===row.observationId).disposition,'review');
});

test('refund posting date is explicit and inactive retained history is not an action target',()=>{
  assert.match(html,/id="refund-posting-fields" hidden/);
  assert.match(html,/Confirmed refund posting date, optional/);
  assert.match(html,/source activity date is not evidence of the posting date/);
  assert.match(script,/if \(\$\('refund-posted-date'\)\.value\) event\.confirmedPostedDate=/);
  assert.match(script,/refund-posting-fields'\)\.hidden=\$\('event-type'\)\.value!=='refund-link'/);
  assert.equal((script.match(/getEffectiveActivities\(ledger\)\.filter\(activity=>activity\.active\)/g)||[]).length,2);
  assert.match(script,/activity\.active \? 'Active' : 'Inactive retained history'/);
});

test('source previews invalidate on selection, failure, and stale asynchronous completion',()=>{
  assert.match(script,/\$\('fixture'\)\.addEventListener\('change',clearPreview\)/);
  assert.match(script,/action\('parse', async \(\) => \{\s*clearPreview\(\);/);
  assert.match(script,/parsed = null; parsedFixture = null; mappingForms = \[\]/);
  assert.match(script,/generation !== previewGeneration \|\| fixtureKey !== \$\('fixture'\)\.value/);
  assert.match(script,/if \(!parsed \|\| parsedFixture !== \$\('fixture'\)\.value\) inputError\('preview-required'\)/);
  const clearBody=script.slice(script.indexOf('function clearPreview()'),script.indexOf('function renderMappings()'));
  assert.doesNotMatch(clearBody,/ledger\s*=|dirty\s*=/);
});
