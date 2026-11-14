import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFinancialEvent, applyFinancialEvents, validateLedger, getEffectiveActivities, summarizeLedger,
  prepareCanonicalImport, applyReviewDecision, createLedgerSessionOwner} from '../js/canonical-import.mjs';
import {createWorkspaceView, getWorkspaceActivity} from '../js/canonical-workspace-model.mjs';
import {createCanonicalMonthIndex} from '../js/canonical-month-index.mjs';
import {replayFixture, replayInput, replayRow} from './helpers/ledger-replay-fixtures.mjs';

const fixture = (extra = {}) => replayFixture(1, [replayRow(0, {lifecycleStatus:'unknown', ...extra})]);
const posting = (activityId, extra = {}) => ({type:'posting-status-correction', activityId,
  commandId:'invented-confirm-posting', lifecycleStatus:'posted', postedDate:'2026-01-16',
  evidence:{rationale:'Invented statement confirms posting'}, ...extra});
const report = ledger => summarizeLedger(ledger, {start:'2026-01-01',end:'2026-01-31',currency:'USD'});
const classify = (ledger, options, extra = {}) => applyFinancialEvent(ledger, {
  type:'classification', activityId:ledger.activities[0].activityId, commandId:'invented-classify',
  activityKind:'spending', categoryId:'invented-fees', ...extra}, options);

test('explicit posting confirmation preserves source and clears only the posting review reason', () => {
  const {ledger, options} = fixture(); const activityId = ledger.activities[0].activityId;
  const confirmed = applyFinancialEvent(ledger, posting(activityId), options);
  assert.deepEqual(confirmed.activities, ledger.activities);
  assert.deepEqual(confirmed.observations, ledger.observations);
  assert.deepEqual(confirmed.imports, ledger.imports);
  assert.equal(ledger.events.length, 0);
  assert.equal(confirmed.events.length, 1);
  assert.deepEqual(confirmed.events[0].priorValues, {lifecycleStatus:'unknown',postedDate:null});
  assert.deepEqual(confirmed.events[0].proposedValues, {lifecycleStatus:'posted',postedDate:'2026-01-16'});
  assert.equal(confirmed.events[0].evidence.rationale, 'Invented statement confirms posting');
  const activity = getEffectiveActivities(confirmed)[0];
  assert.equal(activity.lifecycleStatus, 'posted'); assert.equal(activity.postedDate, '2026-01-16');
  assert.equal(activity.effectiveDate, '2026-01-15'); assert.equal(activity.settlementDate, null);
  assert.deepEqual(getWorkspaceActivity(confirmed, activityId).activity.reviewReasons, ['unclassified-activity']);
  const classified = classify(confirmed, options);
  assert.equal(createWorkspaceView(classified, {reviewOnly:true}).filteredCount, 0);
  assert.equal(report(classified).spending, '12.34');
  assert.equal(report(classified).complete, false, 'Posting does not assert reconciled coverage');
  assert.equal(validateLedger(JSON.parse(JSON.stringify(classified))), true);
});

for (const [name, values] of [
  ['missing date',{postedDate:undefined}], ['null posted date',{postedDate:null}],
  ['impossible date',{postedDate:'2026-02-29'}], ['localized date',{postedDate:'01/16/2026'}],
  ['unsupported status',{lifecycleStatus:'reversed'}], ['pending date',{lifecycleStatus:'pending'}],
  ['unknown date',{lifecycleStatus:'unknown'}], ['missing evidence',{evidence:null}],
  ['blank rationale',{evidence:{rationale:' \n '}}], ['non-string rationale',{evidence:{rationale:7}}],
]) test(`invalid posting correction rejects ${name} without mutation`, () => {
  const {ledger, options} = fixture(), before = structuredClone(ledger);
  const command = posting(ledger.activities[0].activityId, values);
  if (command.postedDate === undefined) delete command.postedDate;
  assert.throws(() => applyFinancialEvent(ledger, command, options), /invalid-posting-status-correction/);
  assert.deepEqual(ledger, before);
});

test('repeated corrections preserve each prior state and exact command retries are idempotent', () => {
  let {ledger, options} = fixture(); const activityId = ledger.activities[0].activityId;
  const command = posting(activityId);
  ledger = applyFinancialEvent(ledger, command, options);
  const confirmed = structuredClone(ledger);
  assert.deepEqual(applyFinancialEvent(ledger, command, options), confirmed);
  assert.throws(() => applyFinancialEvent(ledger, {...command, postedDate:'2026-01-17'}, options), /event-command-conflict/);
  assert.throws(() => applyFinancialEvent(ledger, {...command, commandId:'invented-noop'}, options), /posting-status-unchanged/);
  ledger = classify(ledger, options);
  for (const [i, lifecycleStatus] of ['pending', 'unknown', 'posted'].entries()) {
    const prior = getEffectiveActivities(ledger)[0];
    ledger = applyFinancialEvent(ledger, posting(activityId, {commandId:`invented-status-${i}`, lifecycleStatus,
      postedDate:lifecycleStatus === 'posted' ? '2026-02-02' : null}), options);
    assert.deepEqual(ledger.events.at(-1).priorValues, {lifecycleStatus:prior.lifecycleStatus, postedDate:prior.postedDate});
    assert.equal(report(ledger).spending, lifecycleStatus === 'posted' ? '12.34' : '0');
    assert.equal(getWorkspaceActivity(ledger,activityId).activity.needsReview, lifecycleStatus === 'unknown');
  }
  const february = summarizeLedger(ledger,{start:'2026-02-01',end:'2026-02-28',currency:'USD'});
  assert.equal(february.spending,'0', 'Ordinary activity retains its original effective month');
  assert.deepEqual(ledger.events[0], confirmed.events[0]);
});

for (const [name, change, message] of [
  ['prior status',event => {event.priorValues.lifecycleStatus='pending';}, /posting-status-history-mismatch/],
  ['prior date',event => {event.priorValues.postedDate='2026-01-01';}, /posting-status-history-mismatch/],
  ['extra prior field',event => {event.priorValues.amountMinor=0;}, /invalid-posting-status-correction/],
  ['extra proposed field',event => {event.proposedValues.effectiveDate='2026-02-01';}, /invalid-posting-status-correction/],
  ['invalid proposed date',event => {event.proposedValues.postedDate=null;}, /invalid-posting-status-correction/],
  ['missing evidence',event => {delete event.evidence;}, /invalid-posting-status-correction/],
  ['blank evidence',event => {event.evidence.rationale='';}, /invalid-posting-status-correction/],
  ['no-op',event => {event.proposedValues=structuredClone(event.priorValues);}, /posting-status-unchanged/],
]) test(`persisted posting event rejects ${name}`, () => {
  const {ledger,options} = fixture();
  const next = applyFinancialEvent(ledger,posting(ledger.activities[0].activityId),options);
  change(next.events.at(-1));
  assert.throws(() => validateLedger(next),message);
});

test('posting history cannot be reordered even when the final values agree', () => {
  let {ledger,options}=fixture();const activityId=ledger.activities[0].activityId;
  ledger=applyFinancialEvents(ledger,[posting(activityId),posting(activityId,{commandId:'invented-unconfirm',lifecycleStatus:'unknown',postedDate:null}),
    posting(activityId,{commandId:'invented-reconfirm'})],options);
  [ledger.events[0],ledger.events[1]]=[ledger.events[1],ledger.events[0]];
  assert.throws(()=>validateLedger(ledger),/posting-status-history-mismatch/);
});

test('refund posting corrections update the selected month and rebuilt monthly summaries', () => {
  let {ledger,options}=fixture({amountText:'2.00'});const activityId=ledger.activities[0].activityId;
  ledger=classify(ledger,options,{activityKind:'refund',categoryId:'invented-refund'});
  ledger=applyFinancialEvent(ledger,posting(activityId,{postedDate:'2026-02-02'}),options);
  const january={start:'2026-01-01',end:'2026-01-31',currency:'USD'};
  const february={start:'2026-02-01',end:'2026-02-28',currency:'USD'};
  const old=createCanonicalMonthIndex(ledger);
  assert.equal(summarizeLedger(ledger,january).spending,'0');
  assert.equal(summarizeLedger(ledger,february).spending,'-2.00');
  ledger=applyFinancialEvent(ledger,posting(activityId,{commandId:'invented-change-posting-date',postedDate:'2026-01-31'}),options);
  const index=createCanonicalMonthIndex(ledger);
  assert.equal(index.report(january).report.spending,'-2.00');assert.equal(index.report(february).report.spending,'0');
  assert.equal(old.report(february).report.spending,'-2.00');
  assert.deepEqual(index.report(january).report,summarizeLedger(ledger,january));
  ledger=applyFinancialEvent(ledger,posting(activityId,{commandId:'invented-refund-unknown',lifecycleStatus:'unknown',postedDate:null}),options);
  assert.equal(getEffectiveActivities(ledger)[0].postedDate,null);
  assert.equal(createCanonicalMonthIndex(ledger).report(january).report.spending,'0');
});

test('same-file and overlapping raw unknown evidence cannot undo a manual posted confirmation', () => {
  let {ledger,options}=fixture({sourceRecordId:'invented-stable-id'});const original=structuredClone(ledger);
  const activityId=ledger.activities[0].activityId;
  ledger=applyFinancialEvent(ledger,posting(activityId),options);
  for (const fingerprint of ['invented-replay','invented-overlap']) {
    ledger=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(0,{sourceRecordId:'invented-stable-id',lifecycleStatus:'unknown'})],fingerprint),options).ledger;
    assert.equal(getEffectiveActivities(ledger)[0].lifecycleStatus,'posted');
    assert.equal(getEffectiveActivities(ledger)[0].postedDate,'2026-01-16');
    assert.equal(ledger.activities.length,1);assert.equal(ledger.events.length,1);
  }
  assert.deepEqual(ledger.activities,original.activities);
  assert.deepEqual(ledger.observations[0],original.observations[0]);
});

test('conflicting posted source after manual pending requires review and matching identity preserves manual state', () => {
  let {ledger,options}=fixture({sourceRecordId:'invented-stable-id'});const activityId=ledger.activities[0].activityId;
  ledger=applyFinancialEvent(ledger,posting(activityId,{lifecycleStatus:'pending',postedDate:null}),options);
  ledger=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(0,{sourceRecordId:'invented-stable-id',postedDate:'2026-01-16'})],'invented-posted-overlap'),options).ledger;
  const observation=ledger.observations.at(-1);
  assert.equal(observation.disposition,'review');
  assert.equal(observation.reasonCode,'user-confirmed-posting-conflict');
  assert.equal(getEffectiveActivities(ledger)[0].lifecycleStatus,'pending');
  ledger=applyReviewDecision(ledger,{observationId:observation.observationId,action:'match',activityId,rationale:'Invented identity confirmation only'},options);
  assert.equal(getEffectiveActivities(ledger)[0].lifecycleStatus,'pending');
  assert.equal(ledger.events.length,1);
  ledger=applyFinancialEvent(ledger,posting(activityId,{commandId:'invented-user-accepts-posted'}),options);
  assert.equal(getEffectiveActivities(ledger)[0].lifecycleStatus,'posted');
});

test('source-backed transition still works before manual corrections and its evidence stays immutable', () => {
  let {ledger,options}=fixture({sourceRecordId:'invented-stable-id',lifecycleStatus:'pending'});const activityId=ledger.activities[0].activityId;
  ledger=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(0,{sourceRecordId:'invented-stable-id',effectiveDate:'2026-01-17',postedDate:'2026-01-17',settlementDate:'2026-01-18'})],'invented-posted'),options).ledger;
  const before=structuredClone(ledger);
  assert.equal(before.events[0].eventType,'lifecycle-transition');
  ledger=applyFinancialEvent(ledger,posting(activityId,{postedDate:'2026-01-19'}),options);
  const effective=getEffectiveActivities(ledger)[0];
  assert.equal(effective.effectiveDate,'2026-01-17');assert.equal(effective.settlementDate,'2026-01-18');
  assert.equal(effective.postedDate,'2026-01-19');
  assert.deepEqual(ledger.events[0],before.events[0]);assert.deepEqual(ledger.observations,before.observations);
  ledger=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(0,{sourceRecordId:'invented-stable-id',effectiveDate:'2026-01-17',postedDate:'2026-01-17',settlementDate:'2026-01-18'})],'invented-old-date'),options).ledger;
  assert.equal(ledger.observations.at(-1).reasonCode,'source-id-date-conflict');
  assert.equal(getEffectiveActivities(ledger)[0].postedDate,'2026-01-19');
});

test('optimized command session matches pure replay and rolls back an invalid posting batch', () => {
  const {ledger}=fixture(),activityId=ledger.activities[0].activityId;
  const owner=createLedgerSessionOwner(),session=owner.open(JSON.stringify(ledger),'invented-posting-storage');
  const entry=(command,n)=>({command,eventId:`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`,recordedAt:'2026-11-11T00:00:00.000Z'});
  const first=entry(posting(activityId),1);
  session.applyBatchJson(JSON.stringify([first]),0);
  const pure=applyFinancialEvent(ledger,first.command,{idFactory:()=>first.eventId,now:first.recordedAt});
  assert.deepEqual(session.snapshot(),pure);
  assert.deepEqual(session.effectiveActivities(),getEffectiveActivities(pure));
  const before=session.exportJson();
  const valid=entry(posting(activityId,{commandId:'invented-temporary-pending',lifecycleStatus:'pending',postedDate:null}),2);
  const invalid=entry(posting(activityId,{commandId:'invented-invalid-date',postedDate:'2026-02-30'}),3);
  assert.throws(()=>session.applyBatchJson(JSON.stringify([valid,invalid]),1),/invalid-posting-status-correction/);
  assert.equal(session.exportJson(),before);assert.equal(session.revision(),1);
});

for (const status of ['pending','unknown']) test(`contradictory source after manual ${status} stays separate from identity review`, () => {
  let {ledger,options}=fixture({sourceRecordId:'invented-stable-id',lifecycleStatus:'posted',postedDate:'2026-01-16'});
  const activityId=ledger.activities[0].activityId;
  ledger=applyFinancialEvent(ledger,posting(activityId,{lifecycleStatus:status,postedDate:null}),options);
  const source=replayRow(0,{sourceRecordId:'invented-stable-id',lifecycleStatus:'posted',postedDate:'2026-01-16'});
  const same=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[source]),options);
  assert.equal(same.summary.noOp,1);assert.deepEqual(same.ledger,ledger);
  ledger=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[source],'invented-conflicting-copy'),options).ledger;
  assert.equal(ledger.observations.at(-1).reasonCode,'user-confirmed-posting-conflict');
  ledger=applyReviewDecision(ledger,{observationId:ledger.observations.at(-1).observationId,action:'match',activityId},options);
  assert.equal(getEffectiveActivities(ledger)[0].lifecycleStatus,status);
  assert.equal(getEffectiveActivities(ledger)[0].postedDate,null);
  assert.equal(ledger.events.length,1);
});

test('agreeing posted source matches manual confirmation without duplicating history', () => {
  let {ledger,options}=fixture({sourceRecordId:'invented-stable-id'});const activityId=ledger.activities[0].activityId;
  ledger=applyFinancialEvent(ledger,posting(activityId),options);
  ledger=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(0,{sourceRecordId:'invented-stable-id',postedDate:'2026-01-16'})],'invented-agreeing-source'),options).ledger;
  assert.equal(ledger.observations.at(-1).disposition,'matched');
  assert.equal(ledger.events.length,1);assert.equal(getEffectiveActivities(ledger)[0].postedDate,'2026-01-16');
});
