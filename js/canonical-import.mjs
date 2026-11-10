import { canonicalizeJcs } from './transaction-protocol.mjs';
import { parseMoney, reconcileImport, isCalendarDate, exactSignedDecimal, sameComposite } from './import-reconciliation.mjs';

const collections = { accounts:'accountId', imports:'importRunId', observations:'observationId', activities:'activityId', events:'eventId', reviewDecisions:'reviewDecisionId' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = value => structuredClone(value);
const fail = message => { throw new TypeError(message); };
const stamp = options => { const value = typeof options.now === 'function' ? options.now() : options.now ?? new Date().toISOString(); if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('invalid-clock'); return value; };
const id = options => { const value = (options.idFactory ?? (() => globalThis.crypto.randomUUID()))(); if (!uuid.test(value)) fail('uuid-v4-required'); return value; };
const accountFor = (ledger, accountId) => ledger.accounts.find(a => a.accountId === accountId) ?? fail('unknown-account');
const activityFor = (ledger, activityId) => ledger.activities.find(a => a.activityId === activityId) ?? fail('unknown-activity');
const zeroCounts = () => ({ rowsSeen:0, rowsRecognized:0, created:0, matched:0, review:0, rejected:0, ignored:0 });

export function createLedger(options = {}) {
  return { format:'finance-tracker-canonical-ledger', version:1, syntheticOnly:true, ledgerId:id(options), createdAt:stamp(options), accounts:[], imports:[], observations:[], activities:[], events:[], reviewDecisions:[] };
}

export function validateLedger(ledger) {
  validateAndProject(ledger);
  return true;
}

function validateAndProject(ledger) {
  if (!ledger || ledger.format !== 'finance-tracker-canonical-ledger' || ledger.version !== 1 || ledger.syntheticOnly !== true || !uuid.test(ledger.ledgerId) || !Number.isFinite(Date.parse(ledger.createdAt))) fail('invalid-canonical-ledger');
  const ids = new Set([ledger.ledgerId]);
  // These indexes belong to this validation only. Every record and reference is
  // still checked below, in the same order, before the ledger can be used.
  const byId = {accounts:new Map(),imports:new Map(),observations:new Map(),activities:new Map()};
  for (const [collection,key] of Object.entries(collections)) {
    if (!Array.isArray(ledger[collection])) fail('invalid-ledger-collection');
    for (const record of ledger[collection]) {
      if (!record || !uuid.test(record[key]) || ids.has(record[key])) fail('invalid-or-duplicate-record-id');
      ids.add(record[key]);
      byId[collection]?.set(record[key],record);
    }
  }
  const findAccount = accountId => byId.accounts.get(accountId) ?? fail('unknown-account');
  const findActivity = activityId => byId.activities.get(activityId) ?? fail('unknown-activity');
  const importObservationIds = new Map();
  for (const a of ledger.accounts) if (!['wells-fargo','sofi','fidelity'].includes(a.institutionId) || !/^[A-Z]{3}$/.test(a.currency) || typeof a.displayName !== 'string' || !a.displayName.trim() || !['checking','savings','credit-card','brokerage','retirement','other'].includes(a.accountType)) fail('invalid-account');
  for (const a of ledger.activities) {
    const account = findAccount(a.accountId);
    if (account.institutionId !== a.institutionId || !isCalendarDate(a.effectiveDate) || typeof a.sourceDescription !== 'string' || !['pending','posted','unknown','reversed','corrected'].includes(a.lifecycleStatus)) fail('invalid-activity');
    if (!['unclassified','cash-transaction','trade','dividend','interest','fee','contribution','distribution','transfer','valuation-change','other','income','spending','refund'].includes(a.activityKind)) fail('invalid-activity-kind');
    if (a.postedDate !== null && !isCalendarDate(a.postedDate)) fail('invalid-posted-date');
    if (a.settlementDate !== null && !isCalendarDate(a.settlementDate)) fail('invalid-settlement-date');
    const monetary = a.amountMinor !== null || a.amountDecimal !== null;
    if (monetary && (!/^[A-Z]{3}$/.test(a.currency) || exactSignedDecimal(a) === null || (a.amountMinor !== null && a.amountDecimal !== null))) fail('invalid-activity-money');
    if(monetary) parseMoney(exactSignedDecimal(a),a.currency);
  }
  for (const run of ledger.imports) {
    const account = findAccount(run.accountId);
    if (run.institutionId!==account.institutionId || !['processed','needs-review'].includes(run.status) || typeof run.fileFingerprint !== 'string' || !run.fileFingerprint || !run.declaredCoverage || !isCalendarDate(run.declaredCoverage.start) || !isCalendarDate(run.declaredCoverage.end) || run.declaredCoverage.start > run.declaredCoverage.end || !['user-confirmed','source-confirmed'].includes(run.declaredCoverage.provenance)) fail('invalid-import');
    if(!Array.isArray(run.retryAttempts) || run.retryAttempts.some(attempt=>!uuid.test(attempt.attemptId)||!Number.isFinite(Date.parse(attempt.startedAt))||!Number.isFinite(Date.parse(attempt.completedAt))||!['processed','needs-review'].includes(attempt.priorStatus)||!['processed','needs-review'].includes(attempt.status)||!attempt.priorCounts||!attempt.counts)) fail('invalid-retry-audit');
    for(const attempt of run.retryAttempts) {if(ids.has(attempt.attemptId)) fail('duplicate-attempt-id');ids.add(attempt.attemptId);}
    if(run.sourceFileRetentionStatus!=='not-retained'||run.privateSourceFileRef!==null||run.sourceFileRetainedAt!==null||run.sourceFileRetentionExpiresAt!==null||run.sourceFileDeletedAt!==null||run.coverageReconciled!==false) fail('unsupported-synthetic-retention-or-completeness');
    const c=run.counts;
    if (!c || Object.keys(zeroCounts()).some(k=>!Number.isSafeInteger(c[k]) || c[k]<0) || c.created+c.matched+c.review+c.rejected+c.ignored!==c.rowsRecognized) fail('invalid-import-counts');
    const observationIds=Array.isArray(run.observationIds)?new Set(run.observationIds):null;
    if (!observationIds || observationIds.size!==run.observationIds.length || run.observationIds.some(value=>!byId.observations.has(value))) fail('invalid-import-observations');
    importObservationIds.set(run.importRunId,observationIds);
    const sourceObservations=run.observationIds.map(value=>byId.observations.get(value));
    const actual=zeroCounts(); actual.rowsRecognized=sourceObservations.length;
    sourceObservations.forEach(o=>{actual[o.disposition]++;});
    if(['rowsRecognized','created','matched','review','rejected','ignored'].some(k=>actual[k]!==c[k])) fail('import-counts-mismatch');
    const expectedStatus=sourceObservations.some(o=>!o.resolved&&['review','rejected'].includes(o.disposition))?'needs-review':'processed';
    if(expectedStatus!==run.status) fail('import-status-mismatch');
  }
  const latestDecisionByObservation=new Map();
  for(const decision of ledger.reviewDecisions) latestDecisionByObservation.set(decision.observationId,decision);
  for (const o of ledger.observations) {
    const account=findAccount(o.accountId), sourceRun=byId.imports.get(o.importRunId);
    if (!sourceRun || sourceRun.accountId!==o.accountId || !importObservationIds.get(o.importRunId).has(o.observationId) || !['created','matched','review','rejected','ignored'].includes(o.disposition) || !o.sourceFields || !o.candidate || !Number.isSafeInteger(o.rowOrdinal) || o.rowOrdinal<1 || typeof o.resolved!=='boolean') fail('invalid-observation');
    if(isCalendarDate(o.candidate.effectiveDate)&&(o.candidate.effectiveDate<sourceRun.declaredCoverage.start||o.candidate.effectiveDate>sourceRun.declaredCoverage.end)) fail('observation-outside-declared-coverage');
    if(canonicalizeJcs(o.sourceFields)!==canonicalizeJcs(o.candidate.sourceFields)) fail('observation-evidence-mismatch');
    if(o.candidate.valid!==false && o.candidate.amountText!==null && o.candidate.amountText!==undefined) {
      const expected=parseMoney(o.candidate.amountText,o.candidate.currency);
      if(expected.amountMinor!==o.candidate.amountMinor||expected.amountDecimal!==o.candidate.amountDecimal) fail('candidate-money-mismatch');
    }
    if(o.resolved) {
      const decision=latestDecisionByObservation.get(o.observationId);
      const dispositions={'keep-separate':'created',match:'matched',reject:'rejected'};
      if(!decision||dispositions[decision.action]!==o.disposition||decision.activityId!==o.activityId) fail('observation-resolution-without-decision');
    }
    if(o.candidate.accountId!==o.accountId||o.candidate.institutionId!==account.institutionId||(['created','matched'].includes(o.disposition)&&o.activityId===null)||(['review','rejected'].includes(o.disposition)&&o.activityId!==null)) fail('invalid-observation-state');
    if (o.activityId !== null && findActivity(o.activityId).accountId !== o.accountId) fail('observation-account-conflict');
  }
  const replay=createActivityReplay(ledger.activities);
  const activeIds=activeActivityIds(ledger);
  const commands=new Map();
  for (const e of ledger.events) {
    findActivity(e.activityId);
    if (typeof e.commandId !== 'string' || !e.commandId || commands.has(e.commandId)) fail('invalid-event-command');
    commands.set(e.commandId,e);
    if (!Number.isFinite(Date.parse(e.recordedAt)) || e.appendOnly!==true) fail('invalid-event-metadata');
    const a=replay.get(e.activityId);
    validateHistoryEvent(e,a,byId,replay,activeIds);
    replay.append(e);
  }
  validateTransferLinks(ledger.activities,replay,activeIds);
  const refundTotals=new Map(), refundActivities=new Set();
  for(const event of ledger.events.filter(e=>e.eventType==='refund-link')) {
    const refund=replay.get(event.activityId);
    const target=replay.get(event.originalActivityId);
    const amount=exactSignedDecimal(refund), originalAmount=exactSignedDecimal(target);
    if(refundActivities.has(refund.activityId)||refund.activityKind!=='refund'||target.activityKind!=='spending'||amount===null||originalAmount===null||compare(amount,'0')<=0||compare(originalAmount,'0')>=0) fail('invalid-effective-refund');
    refundActivities.add(refund.activityId);
    const total=add(refundTotals.get(target.activityId)??'0',amount);
    if(compare(total,negate(originalAmount))>0) fail('refund-exceeds-original');
    refundTotals.set(target.activityId,total);
  }
  const priorDecisions=new Map();
  for (const d of ledger.reviewDecisions) {
    const o=byId.observations.get(d.observationId);
    if(!o || !['keep-separate','match','reject','reverse'].includes(d.action) || d.reviewer!=='user' || !Number.isFinite(Date.parse(d.createdAt))) fail('invalid-review-decision');
    if(d.activityId!==null && findActivity(d.activityId).accountId!==o.accountId) fail('invalid-review-target');
    if(d.action==='reverse') {
      const prior=priorDecisions.get(d.supersedesDecisionId);
      if(!prior || prior.observationId!==d.observationId || prior.action==='reverse') fail('invalid-review-reversal');
    }
    priorDecisions.set(d.reviewDecisionId,d);
  }
  inspectJson(ledger);
  return {replay,ids,commands,byId};
}

function validEventMoney(value) {
  if(!value || Object.keys(value).some(k=>!['amountMinor','amountDecimal','currency'].includes(k)) || !/^[A-Z]{3}$/.test(value.currency) || (value.amountMinor===null)===(value.amountDecimal===null) || exactSignedDecimal(value)===null) fail('invalid-event-money');
  parseMoney(exactSignedDecimal(value),value.currency);
}
function validateHistoryEvent(e,a,byId,replay=null,activeIds=null) {
  const findActivity=activityId=>byId.activities.get(activityId)??fail('unknown-activity');
  if(e.eventType==='bank-correction') {
    validEventMoney(e.priorValues); validEventMoney(e.proposedValues);
    if(e.priorValues.amountMinor!==a.amountMinor||e.priorValues.amountDecimal!==a.amountDecimal) fail('correction-history-mismatch');
    if(e.proposedValues.currency!==a.currency || e.priorValues.currency!==a.currency || !e.evidence) fail('invalid-bank-correction');
  } else if(e.eventType==='category-correction') {
    if(typeof e.categoryId!=='string'||!e.categoryId||e.priorCategoryId!==a.categoryId) fail('invalid-category-correction');
    const rule=e.prospectiveRule;
    if(!rule || rule.version!==1 || rule.enabled!==Boolean(categoryRuleKey(a).normalizedDescription.trim()) || canonicalizeJcs(rule.key)!==canonicalizeJcs(categoryRuleKey(a)) || !Array.isArray(rule.existingActivityIds) || new Set(rule.existingActivityIds).size!==rule.existingActivityIds.length || !rule.existingActivityIds.includes(a.activityId) || rule.existingActivityIds.some(value=>!byId.activities.has(value))) fail('invalid-prospective-category-rule');
  } else if(e.eventType==='classification') {
    if(e.priorActivityKind!==a.activityKind||e.priorCategoryId!==a.categoryId) fail('classification-history-mismatch');
    if(!['income','spending','transfer','refund','unclassified'].includes(e.activityKind) || (e.categoryId!==null&&typeof e.categoryId!=='string')) fail('invalid-classification');
  } else if(e.eventType==='refund-link') {
    const target=findActivity(e.originalActivityId);
    if(target.currency!==a.currency || a.activityId===target.activityId || !e.evidence) fail('invalid-refund-link');
    if(e.confirmedPostedDate!==null && e.confirmedPostedDate!==undefined && (!isCalendarDate(e.confirmedPostedDate)||(a.postedDate!==null&&a.postedDate!==e.confirmedPostedDate))) fail('invalid-refund-posted-date');
  } else if(e.eventType==='lifecycle-transition') {
    if(a.lifecycleStatus!=='pending'||e.from!=='pending'||e.to!=='posted'||!isCalendarDate(e.effectiveDate)||(e.postedDate!==null&&!isCalendarDate(e.postedDate))||(e.settlementDate!==null&&!isCalendarDate(e.settlementDate))||byId.observations.get(e.sourceObservationId)?.activityId!==e.activityId) fail('invalid-lifecycle-event');
  } else if(e.eventType==='transfer-link') {
    const other=findActivity(e.counterpartyActivityId);
    const counterpart=replay?.get(e.counterpartyActivityId);
    const amount=exactSignedDecimal(a), otherAmount=counterpart&&exactSignedDecimal(counterpart);
    if(!replay||!counterpart||!e.evidence||typeof e.evidence.rationale!=='string'||!e.evidence.rationale.trim()||
      e.transferGroupId!==e.eventId||!uuid.test(e.transferGroupId)||
      (activeIds&&(!activeIds.has(a.activityId)||!activeIds.has(other.activityId)))||
      a.activityKind!=='transfer'||counterpart.activityKind!=='transfer'||
      a.accountId===other.accountId||a.currency!==counterpart.currency||
      amount===null||otherAmount===null||compare(amount,'0')>=0||compare(otherAmount,'0')<=0||
      compare(negate(amount),otherAmount)!==0||
      a.transferGroupId||counterpart.transferGroupId) fail('invalid-transfer-link');
  } else fail('unsupported-persisted-event');
}
// Storage records must be JSON, not Date/BigInt/undefined or non-finite values.
function validateTransferLinks(activities,replay,activeIds) {
  const groups=new Map();
  for(const original of activities) {
    const activity=replay.get(original.activityId);
    if(!activity.transferGroupId) continue;
    const other=replay.get(activity.transferCounterpartyActivityId);
    const amount=exactSignedDecimal(activity),otherAmount=other&&exactSignedDecimal(other);
    if(!other||!activeIds.has(activity.activityId)||!activeIds.has(other.activityId)||
      other.transferGroupId!==activity.transferGroupId||
      other.transferCounterpartyActivityId!==activity.activityId||
      activity.accountId===other.accountId||activity.currency!==other.currency||
      activity.activityKind!=='transfer'||other.activityKind!=='transfer'||
      amount===null||otherAmount===null||
      (activity.transferRole==='outgoing'&&(compare(amount,'0')>=0||compare(otherAmount,'0')<=0))||
      (activity.transferRole==='incoming'&&(compare(amount,'0')<=0||compare(otherAmount,'0')>=0))||
      !['outgoing','incoming'].includes(activity.transferRole)||
      compare(negate(amount),otherAmount)!==0) fail('invalid-transfer-link');
    if(!groups.has(activity.transferGroupId)) groups.set(activity.transferGroupId,new Set());
    groups.get(activity.transferGroupId).add(activity.activityId);
  }
  for(const members of groups.values()) if(members.size!==2) fail('invalid-transfer-link');
}

function inspectJson(value) {
  if(value===undefined || typeof value==='bigint' || typeof value==='function' || typeof value==='symbol' || (typeof value==='number'&&!Number.isFinite(value))) fail('non-json-ledger');
  if(value && typeof value==='object') {
    if(!Array.isArray(value) && Object.getPrototypeOf(value)!==Object.prototype) fail('non-json-ledger');
    Object.values(value).forEach(inspectJson);
  }
}

export function registerAccount(ledger, account, options = {}) {
  validateLedger(ledger);
  const next=clone(ledger), accountId=account.accountId ?? id(options);
  if(next.accounts.some(a=>a.accountId===accountId)) fail('account-already-exists');
  next.accounts.push({accountId,institutionId:account.institutionId,displayName:account.displayName ?? account.name,currency:account.currency,accountType:account.accountType ?? 'other',createdAt:stamp(options),archivedAt:null});
  validateLedger(next); return next;
}

function canonicalRow(record, account) {
  const candidate={...clone(record),accountId:account.accountId,institutionId:account.institutionId,postedDate:record.postedDate ?? null,settlementDate:record.settlementDate ?? null,sourceRecordId:record.sourceRecordId ?? null,sourceAction:record.sourceAction ?? null,normalizedDescription:record.normalizedDescription ?? null,lifecycleStatus:record.lifecycleStatus ?? 'unknown',activityKind:'unclassified',categoryId:null,amountMinor:null,amountDecimal:null,currency:record.currency ?? (account.institutionId==='fidelity'?null:account.currency),transferGroupId:null};
  try { if(record.amountText!==null && record.amountText!==undefined) { if(!candidate.currency) fail('missing-currency'); Object.assign(candidate,parseMoney(record.amountText,candidate.currency)); } }
  catch { if(candidate.valid!==false) candidate.errorCode=candidate.currency===null?'missing-currency':'invalid-money'; candidate.valid=false; }
  return candidate;
}
// Operation-local indexes preserve Array.find's first match before final validation.
function firstBy(records, key) {
  const index=new Map();
  for(const record of records) if(!index.has(record[key])) index.set(record[key],record);
  return index;
}
function refreshRun(ledger, run) {
  const observationById=firstBy(ledger.observations,'observationId');
  const observations=run.observationIds.map(value=>observationById.get(value));
  const counts=zeroCounts(); counts.rowsSeen=run.rowsSeen; counts.rowsRecognized=observations.length;
  for(const o of observations) counts[o.disposition]++;
  run.counts=counts;
  run.status=observations.some(o=>(o.disposition==='review'||o.disposition==='rejected')&&!o.resolved) ? 'needs-review':'processed';
  run.errorCode=run.status==='needs-review'?'unresolved-observations':null;
  const replay=projectActivities(ledger);
  let latest=null;
  for(const activity of activeActivities(ledger)) {
    if(activity.accountId!==run.accountId) continue;
    const date=replay.get(activity.activityId).effectiveDate;
    if(latest===null || date>latest) latest=date;
  }
  run.latestActivityDate=latest;
}

export function prepareCanonicalImport(ledger, {parsed,accountMappings,coverageByAccount,syntheticOnly}, options = {}) {
  validateLedger(ledger);
  if(syntheticOnly!==true) fail('synthetic-only-required');
  if(!parsed || !Array.isArray(parsed.records) || !Array.isArray(parsed.sourceAccountKeys) || typeof parsed.fileFingerprint!=='string' || !parsed.fileFingerprint) fail('invalid-parsed-import');
  const next=clone(ledger), runIds=[], summary={...zeroCounts(),noOp:0};
  const keys=[...new Set([...parsed.sourceAccountKeys,...parsed.records.map(r=>r.sourceAccountKey),...(parsed.records.length===0?Object.keys(accountMappings??{}):[])])];
  if(!keys.length) fail('explicit-account-mapping-required');
  const mapped=new Set();
  for(const key of keys) {
    const account=accountFor(next,accountMappings?.[key]);
    if(account.institutionId!==parsed.institutionId || mapped.has(account.accountId)) fail('account-mapping-conflict');
    mapped.add(account.accountId);
    const coverage=coverageByAccount?.[account.accountId];
    if(!coverage || !['user-confirmed','source-confirmed'].includes(coverage.provenance) || !isCalendarDate(coverage.start) || !isCalendarDate(coverage.end) || coverage.start>coverage.end) fail('confirmed-coverage-required');
    const records=parsed.records.filter(r=>r.sourceAccountKey===key);
    if(records.some(r=>isCalendarDate(r.effectiveDate) && (r.effectiveDate<coverage.start||r.effectiveDate>coverage.end))) fail('activity-outside-declared-coverage');
    const prior=next.imports.find(r=>r.accountId===account.accountId && r.sourceFormat===parsed.sourceFormat && r.fileFingerprint===parsed.fileFingerprint);
    if(prior?.status==='processed') { runIds.push(prior.importRunId); summary.noOp++; continue; }
    if(prior) {
      // Resume unresolved occurrences, preserving the identity and effects of accepted rows.
      const observationById=firstBy(next.observations,'observationId');
      const recordByOrdinal=firstBy(records,'rowOrdinal');
      const unresolved=prior.observationIds.map(value=>observationById.get(value)).filter(o=>!o.resolved&&['review','rejected'].includes(o.disposition));
      const retryRows=unresolved.map(o=>canonicalRow(recordByOrdinal.get(o.rowOrdinal)??fail('retry-row-missing'),account));
      if(retryRows.some((candidate,i)=>canonicalizeJcs(candidate)!==canonicalizeJcs(unresolved[i].candidate))) fail('retry-normalization-changed');
      const retry=reconcileImport({institutionId:account.institutionId,accountId:account.accountId,sourceFormat:parsed.sourceFormat,fileFingerprint:parsed.fileFingerprint,rows:retryRows,...reconciliationEvidence(next),idFactory:()=>id(options)});
      const time=stamp(options),priorStatus=prior.status,priorCounts=clone(prior.counts);
      for(const a of retry.activities) next.activities.push({...a,createdAt:time,updatedAt:time});
      retry.observations.forEach((result,i)=>Object.assign(unresolved[i],result));
      const unresolvedByOrdinal=firstBy(unresolved,'rowOrdinal');
      const commandIds=new Set(next.events.map(event=>event.commandId));
      for(const e of retry.events) {
        const observation=unresolvedByOrdinal.get(e.observationRowOrdinal),commandId=`import:${observation.observationId}:${e.eventType}`;
        if(!commandIds.has(commandId)) {
          next.events.push({...e,eventId:id(options),commandId,sourceObservationId:observation.observationId,recordedAt:time});
          commandIds.add(commandId);
        }
      }
      refreshRun(next,prior);prior.retryAttempts.push({attemptId:id(options),startedAt:time,completedAt:time,priorStatus,priorCounts,status:prior.status,counts:clone(prior.counts)});runIds.push(prior.importRunId);
      for(const k of Object.keys(zeroCounts())) summary[k]+=prior.counts[k];
      continue;
    }
    const runId=id(options), time=stamp(options), rows=records.map(r=>canonicalRow(r,account));
    if(new Set(rows.map(r=>r.rowOrdinal)).size!==rows.length) fail('duplicate-row-ordinal');
    const result=reconcileImport({institutionId:account.institutionId,accountId:account.accountId,sourceFormat:parsed.sourceFormat,fileFingerprint:parsed.fileFingerprint,rows,...reconciliationEvidence(next),idFactory:()=>id(options)});
    for(const activity of result.activities) next.activities.push({...activity,createdAt:time,updatedAt:time});
    const observations=result.observations.map((o,i)=>({...o,observationId:id(options),importRunId:runId,observedAt:time,physicalLine:records[i].physicalLine ?? null,candidate:rows[i],resolved:false}));
    next.observations.push(...observations);
    const observationByOrdinal=firstBy(observations,'rowOrdinal');
    for(const event of result.events) {
      const observation=observationByOrdinal.get(event.observationRowOrdinal);
      next.events.push({...event,eventId:id(options),commandId:`import:${observation.observationId}:${event.eventType}`,sourceObservationId:observation.observationId,recordedAt:time});
    }
    const dates=rows.map(r=>r.effectiveDate).filter(isCalendarDate).sort();
    const run={importRunId:runId,institutionId:account.institutionId,accountId:account.accountId,sourceFormat:parsed.sourceFormat,fileFingerprint:parsed.fileFingerprint,startedAt:time,completedAt:time,status:result.status,rowsSeen:records.length,sourceRowsSeen:parsed.rowsSeen ?? records.length,sourceIgnoredCount:parsed.ignoredCount ?? 0,declaredCoverage:clone(coverage),observedStart:dates[0]??null,observedEnd:dates.at(-1)??null,coverageReconciled:false,observationIds:observations.map(o=>o.observationId),counts:result.counts,sourceFileRetentionStatus:'not-retained',privateSourceFileRef:null,sourceFileRetainedAt:null,sourceFileRetentionExpiresAt:null,sourceFileDeletedAt:null,latestActivityDate:null,errorCode:null,retryOfImportRunId:null,resultDigest:null,retryAttempts:[]};
    next.imports.push(run); refreshRun(next,run); runIds.push(runId);
    for(const k of Object.keys(zeroCounts())) summary[k]+=run.counts[k];
  }
  validateLedger(next); return {ledger:next,runIds,summary};
}

export function applyReviewDecision(ledger, {observationId,action,activityId=null,rationale=null,currency=null}, options={}) {
  validateLedger(ledger);
  const next=clone(ledger), o=next.observations.find(o=>o.observationId===observationId);
  if(!o || !['keep-separate','match','reject'].includes(action)) fail('invalid-review');
  if(!['review','rejected'].includes(o.disposition) || o.resolved) fail('observation-already-resolved');
  const priorDisposition=o.disposition, time=stamp(options);
  if(action==='keep-separate') {
    const accepted=clone(o.candidate);
    if(currency!==null) {
      if(!['missing-currency','review-decision-reversed'].includes(o.reasonCode)||accepted.errorCode!=='missing-currency'||!rationale||!/^[A-Z]{3}$/.test(currency)) fail('explicit-currency-resolution-required');
      Object.assign(accepted,parseMoney(accepted.amountText,currency),{valid:true,errorCode:null});
    }
    if(accepted.valid===false || !isCalendarDate(accepted.effectiveDate)) fail('invalid-row-cannot-be-accepted');
    activityId=id(options); next.activities.push({...accepted,activityId,processingStatus:'processed',createdAt:time,updatedAt:time}); o.disposition='created';
  } else if(action==='match') {
    const original=activityFor(next,activityId),a=effective(next,original);
    if(!activeActivities(next).some(active=>active.activityId===activityId)) fail('inactive-match-target');
    if(o.candidate.valid===false || !isCalendarDate(o.candidate.effectiveDate)) fail('invalid-row-cannot-be-accepted');
    if(a.accountId!==o.accountId || a.currency!==o.candidate.currency || exactSignedDecimal(a)===null || exactSignedDecimal(o.candidate)===null) fail('conflicting-match-requires-correction');
    const amountConflict=compare(exactSignedDecimal(a),exactSignedDecimal(o.candidate))!==0;
    const historicalMatch=amountConflict && retainedCompositeEvidence(next,[original]).some(evidence=>sameComposite(evidence,o.candidate));
    if(amountConflict && !historicalMatch) fail('conflicting-match-requires-correction');
    o.disposition='matched';
    // Explicitly linking old evidence must not undo a correction or infer a
    // lifecycle transition from a row that conflicts with the current amount.
    if(!historicalMatch&&a.lifecycleStatus==='pending'&&o.candidate.lifecycleStatus==='posted') {
      next.events.push({eventId:id(options),commandId:`review:${o.observationId}:lifecycle-transition`,eventType:'lifecycle-transition',activityId,sourceObservationId:o.observationId,recordedAt:time,from:'pending',to:'posted',effectiveDate:o.candidate.effectiveDate,postedDate:o.candidate.postedDate,settlementDate:o.candidate.settlementDate,appendOnly:true});
    }
  } else { o.disposition='rejected'; activityId=null; }
  o.activityId=activityId; o.resolved=true;
  next.reviewDecisions.push({reviewDecisionId:id(options),observationId,activityId,action,priorDisposition,rationale,currency,existingEventIds:next.events.map(e=>e.eventId),reviewer:'user',createdAt:time});
  for(const run of next.imports.filter(r=>r.observationIds.includes(observationId))) refreshRun(next,run);
  validateLedger(next); return next;
}

function activeActivityIds(ledger) {
  const ids=new Set();
  for(const observation of ledger.observations) {
    if(observation.activityId!==null && ['created','matched'].includes(observation.disposition)) ids.add(observation.activityId);
  }
  return ids;
}

function activeActivities(ledger) {
  const ids=activeActivityIds(ledger);
  return ledger.activities.filter(activity=>ids.has(activity.activityId));
}

function reconciliationEvidence(ledger) {
  const active=activeActivities(ledger),replay=projectActivities(ledger);
  return {existingActivities:active.map(activity=>replay.get(activity.activityId)),existingObservations:ledger.observations,existingCompositeEvidence:retainedCompositeEvidence(ledger,active)};
}

function retainedCompositeEvidence(ledger,active) {
  const history=new Map(active.map(activity=>[activity.activityId,{...activity}]));
  const existingCompositeEvidence=[...active];
  // Keep actual historical states, not every combination of old amounts and
  // dates. These records can open review only; identity and lifecycle matching
  // still use the current effective activities below.
  for(const event of ledger.events) {
    const prior=history.get(event.activityId);
    if(!prior) continue;
    let current;
    if(event.eventType==='bank-correction') current={...prior,...event.proposedValues};
    else if(event.eventType==='lifecycle-transition') current={...prior,lifecycleStatus:event.to,effectiveDate:event.effectiveDate,postedDate:event.postedDate,settlementDate:event.settlementDate};
    else continue;
    history.set(event.activityId,current);
    existingCompositeEvidence.push(current);
  }
  for(const observation of ledger.observations) {
    if(history.has(observation.activityId) && ['created','matched'].includes(observation.disposition) && observation.candidate.valid!==false) {
      existingCompositeEvidence.push({...observation.candidate,activityId:observation.activityId});
    }
  }
  return existingCompositeEvidence;
}

export function reverseReviewDecision(ledger,{reviewDecisionId,rationale=null},options={}) {
  validateLedger(ledger);
  const next=clone(ledger), decision=next.reviewDecisions.find(d=>d.reviewDecisionId===reviewDecisionId);
  if(!decision || decision.action==='reverse') fail('invalid-review-reversal');
  const observation=next.observations.find(o=>o.observationId===decision.observationId);
  if(next.reviewDecisions.filter(d=>d.observationId===decision.observationId).at(-1)!==decision) fail('review-reversal-dependency');
  if(next.events.some(e=>e.commandId===`review:${observation.observationId}:lifecycle-transition`)) fail('review-reversal-dependency');
  if(decision.activityId && next.events.some(e=>(e.activityId===decision.activityId||e.originalActivityId===decision.activityId)&&!decision.existingEventIds.includes(e.eventId))) fail('review-reversal-dependency');
  if(decision.action==='keep-separate' && next.observations.some(o=>o.observationId!==observation.observationId&&o.activityId===decision.activityId)) fail('review-reversal-dependency');
  const priorDisposition=observation.disposition;
  observation.activityId=null;observation.disposition='review';observation.reasonCode=decision.currency!==null&&observation.candidate.errorCode==='missing-currency'?'missing-currency':'review-decision-reversed';observation.resolved=false;
  next.reviewDecisions.push({reviewDecisionId:id(options),observationId:observation.observationId,activityId:null,action:'reverse',supersedesDecisionId:reviewDecisionId,priorDisposition,rationale,currency:null,existingEventIds:next.events.map(e=>e.eventId),reviewer:'user',createdAt:stamp(options)});
  for(const run of next.imports.filter(r=>r.observationIds.includes(observation.observationId))) refreshRun(next,run);
  validateLedger(next);return next;
}

function categoryRuleKey(activity) {
  return {accountId:activity.accountId,institutionId:activity.institutionId,currency:activity.currency,normalizedDescription:activity.normalizedDescription ?? activity.sourceDescription,sourceAction:activity.sourceAction};
}

function categoryRuleMatches(key, activity) {
  // Adapters use string/null fields, but older accepted JSON can include a
  // structured sourceAction. Keep its former JCS equality without serializing
  // the ordinary primitive fields on every activity/event comparison.
  const same=(left,right)=>left===right || (left!==null && right!==null &&
    typeof left==='object' && typeof right==='object' && canonicalizeJcs(left)===canonicalizeJcs(right));
  return key.accountId===activity.accountId && key.institutionId===activity.institutionId &&
    same(key.currency,activity.currency) && same(key.normalizedDescription,activity.normalizedDescription ?? activity.sourceDescription) &&
    same(key.sourceAction,activity.sourceAction);
}

function prospectiveCategoryRule(ledger, activity) {
  const key=clone(categoryRuleKey(activity)), enabled=Boolean(key.normalizedDescription.trim());
  // The immutable account, currency and source fields keep unrelated activities
  // outside this rule forever. Retain only earlier exact-key peers, including
  // inactive history, so later imports can inherit without recategorizing peers.
  // Version 1 also accepts the older full-ledger inventories without rewriting them.
  const existingActivityIds=enabled
    ? ledger.activities.filter(prior=>categoryRuleMatches(key,prior)).map(prior=>prior.activityId)
    : [activity.activityId];
  return {version:1,enabled,key,existingActivityIds};
}

// State is local to one operation and is never stored on the ledger. A refund
// category is a reference until a later explicit/rule category overrides it.
// This preserves the original replay's late-bound purchase category semantics.
function createActivityReplay(activities) {
  const states=new Map(activities.map(activity=>[activity.activityId,{
    value:{...activity},categoryTarget:null,dependencies:new Set(),dependents:new Set(),checked:true,
  }]));
  let byRuleKey=null;
  const stateFor=activityId=>states.get(activityId)??fail('unknown-activity');
  const keyFor=key=>JSON.stringify(['accountId','institutionId','currency','normalizedDescription','sourceAction'].map(field=>key[field]).map(value=>value===undefined?'undefined':canonicalizeJcs(value)));
  const matchingStates=key=>{
    if(!byRuleKey) {
      byRuleKey=new Map();
      for(const activity of activities) {
        const key=keyFor(categoryRuleKey(activity));
        if(!byRuleKey.has(key)) byRuleKey.set(key,[]);
        byRuleKey.get(key).push(stateFor(activity.activityId));
      }
    }
    return byRuleKey.get(keyFor(key))??[];
  };
  const checkDependencies=(state,visiting=new Set())=>{
    if(visiting.has(state)) fail('cyclic-refund-link');
    if(state.checked) return;
    visiting.add(state);
    for(const targetId of state.dependencies) checkDependencies(stateFor(targetId),visiting);
    visiting.delete(state);state.checked=true;
  };
  const invalidateDependencies=state=>{
    const pending=[state],seen=new Set();
    while(pending.length) {
      const current=pending.pop();
      if(seen.has(current)) continue;
      seen.add(current);current.checked=false;
      for(const dependentId of current.dependents) pending.push(stateFor(dependentId));
    }
  };
  const categoryFor=state=>{
    while(state.categoryTarget!==null) state=stateFor(state.categoryTarget);
    return state.value.categoryId;
  };
  const category=(state,value)=>{state.value.categoryId=value;state.categoryTarget=null;};
  return {
    get(activityId) {
      const state=stateFor(activityId);checkDependencies(state);
      const result=state.categoryTarget===null?{...state.value}:{...state.value,categoryId:categoryFor(state)};
      // Legacy base records can contain structured categories. The former replay
      // cloned them, so an event's strict prior-value check must never gain
      // equality merely because caller-owned objects share the same reference.
      if(result.categoryId!==null && typeof result.categoryId==='object') result.categoryId=clone(result.categoryId);
      return result;
    },
    append(event) {
      const state=stateFor(event.activityId),result=state.value;
      if(event.eventType==='category-correction' && event.prospectiveRule?.enabled) {
        const excluded=new Set(event.prospectiveRule.existingActivityIds);
        for(const peer of matchingStates(event.prospectiveRule.key)) {
          if(!excluded.has(peer.value.activityId)) category(peer,event.categoryId);
        }
      }
      if(event.eventType==='bank-correction') Object.assign(result,event.proposedValues);
      if(event.eventType==='category-correction') category(state,event.categoryId);
      if(event.eventType==='classification') {
        result.activityKind=event.activityKind;
        if(event.categoryId!==null) category(state,event.categoryId);
      }
      if(event.eventType==='refund-link') {
        const target=stateFor(event.originalActivityId);
        result.activityKind='refund';result.originalActivityId=event.originalActivityId;
        state.categoryTarget=event.originalActivityId;
        // Retain every link for cycle checks, even if a later category overrides
        // it. The prior replay traversed those links before applying overrides.
        state.dependencies.add(event.originalActivityId);target.dependents.add(event.activityId);
        invalidateDependencies(state);
        if(event.confirmedPostedDate) result.postedDate=event.confirmedPostedDate;
      }
      if(event.eventType==='lifecycle-transition') {
        result.lifecycleStatus=event.to;result.effectiveDate=event.effectiveDate;
        result.postedDate=event.postedDate;result.settlementDate=event.settlementDate;
      }
      if(event.eventType==='transfer-link') {
        const other=stateFor(event.counterpartyActivityId);
        result.transferGroupId=event.transferGroupId;
        result.transferCounterpartyActivityId=other.value.activityId;
        result.transferRole='outgoing';
        other.value.transferGroupId=event.transferGroupId;
        other.value.transferCounterpartyActivityId=result.activityId;
        other.value.transferRole='incoming';
      }
    },
  };
}
function projectActivities(ledger) {
  const replay=createActivityReplay(ledger.activities);
  for(const event of ledger.events) replay.append(event);
  return replay;
}
function effective(ledger,activity) {
  return clone(projectActivities(ledger).get(activity.activityId));
}
export function getEffectiveActivities(ledger) {
  const {replay}=validateAndProject(ledger),activeIds=activeActivityIds(ledger);
  return ledger.activities.map(activity=>({...clone(replay.get(activity.activityId)),active:activeIds.has(activity.activityId)}));
}

// Exact decimal arithmetic throughout; BigInts never enter persisted records.
function decimal(value) { const m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(value??''); if(!m) fail('invalid-exact-amount'); return {n:BigInt((m[1]||'')+m[2]+(m[3]||'')),s:(m[3]||'').length}; }
function add(a,b) { const x=decimal(a),y=decimal(b),s=Math.max(x.s,y.s); return format(x.n*10n**BigInt(s-x.s)+y.n*10n**BigInt(s-y.s),s); }
function format(n,s) { const sign=n<0n?'-':''; const digits=(n<0n?-n:n).toString().padStart(s+1,'0'); return sign+(s?digits.slice(0,-s)+'.'+digits.slice(-s):digits); }
const negate = value => { const d=decimal(value);return format(-d.n,d.s); };
const compare = (a,b) => {const d=decimal(add(a,negate(b)));return d.n<0n?-1:d.n>0n?1:0;};

export function applyFinancialEvent(ledger, command, options={}) {
  return applyFinancialEvents(ledger,[command],options);
}

// An explicit command list is one immutable proposal, not a persistence commit.
// Preserve the same order, IDs, prior values and intermediate financial checks
// as separate commands, but validate and clone the unchanged graph only once.
export function applyFinancialEvents(ledger, commands, options={}) {
  const context=validateAndProject(ledger);
  if(!Array.isArray(commands)) fail('invalid-financial-commands');
  const next=clone(ledger);
  context.activeIds=activeActivityIds(ledger);
  context.refunds=createRefundChecks(ledger,context.replay);
  for(const command of commands) {
    const event=buildFinancialEvent(next,command,options,context);
    if(!event) continue;
    if(context.ids.has(event.eventId)) fail('invalid-or-duplicate-record-id');
    context.ids.add(event.eventId);
    validateHistoryEvent(event,context.replay.get(event.activityId),context.byId,context.replay,context.activeIds);
    next.events.push(event);context.commands.set(event.commandId,event);
    context.replay.append(event);
    context.refunds.check(event);
    inspectJson(event);
  }
  validateLedger(next);
  return next;
}

function createRefundChecks(ledger,replay) {
  const byRefund=new Map(),byTarget=new Map();
  const groupFor=targetId=>{
    if(!byTarget.has(targetId))byTarget.set(targetId,{total:'0'});
    return byTarget.get(targetId);
  };
  const remember=event=>{
    const amount=exactSignedDecimal(replay.get(event.activityId)),group=groupFor(event.originalActivityId);
    byRefund.set(event.activityId,{targetId:event.originalActivityId,amount});
    group.total=add(group.total,amount);
  };
  for(const event of ledger.events)if(event.eventType==='refund-link')remember(event);
  return {
    totalFor:targetId=>byTarget.get(targetId)?.total??'0',
    check(event) {
      if(!['classification','bank-correction','refund-link'].includes(event.eventType))return;
      if(event.eventType==='refund-link')remember(event);
      const refund=byRefund.get(event.activityId),targets=new Set();
      if(refund) {
        const activity=replay.get(event.activityId),amount=exactSignedDecimal(activity);
        if(activity.activityKind!=='refund'||amount===null||compare(amount,'0')<=0)fail('invalid-effective-refund');
        const group=groupFor(refund.targetId);
        group.total=add(group.total,add(amount,negate(refund.amount)));refund.amount=amount;
        targets.add(refund.targetId);
      }
      if(byTarget.has(event.activityId))targets.add(event.activityId);
      for(const targetId of targets) {
        const target=replay.get(targetId),amount=exactSignedDecimal(target);
        if(target.activityKind!=='spending'||amount===null||compare(amount,'0')>=0)fail('invalid-effective-refund');
        if(compare(groupFor(targetId).total,negate(amount))>0)fail('refund-exceeds-original');
      }
    },
  };
}

function buildFinancialEvent(next,command,options,{replay,commands,activeIds,refunds}) {
  const {type,activityId,commandId}=command;
  if(typeof commandId!=='string'||!commandId) fail('event-command-id-required');
  const signature=canonicalizeJcs(command);
  const prior=commands.get(commandId);
  if(prior) {if(prior.commandSignature!==signature) fail('event-command-conflict');return null;}
  const a=replay.get(activityId);
  if(!activeIds.has(activityId)) fail('inactive-financial-target');
  const event={eventId:id(options),commandId,commandSignature:signature,eventType:type,activityId,recordedAt:stamp(options),evidence:clone(command.evidence??null),appendOnly:true};
  if(type==='category-correction') {if(typeof command.categoryId!=='string'||!command.categoryId) fail('category-required');event.categoryId=command.categoryId;event.priorCategoryId=a.categoryId;event.prospectiveRule=prospectiveCategoryRule(next,a);}
  else if(type==='bank-correction') {if(!command.evidence) fail('correction-evidence-required');event.priorValues={amountMinor:a.amountMinor,amountDecimal:a.amountDecimal,currency:a.currency};event.proposedValues=parseMoney(command.amountText,a.currency);}
  else if(type==='classification') {
    if(!['income','spending','transfer','refund','unclassified'].includes(command.activityKind)) fail('unsupported-classification');
    const value=exactSignedDecimal(a);
    if(value===null || (command.activityKind==='income'&&compare(value,'0')<0) || (command.activityKind==='spending'&&compare(value,'0')>0) || (command.activityKind==='refund'&&compare(value,'0')<=0)) fail('classification-amount-conflict');
    event.activityKind=command.activityKind;event.categoryId=command.categoryId??null;event.priorActivityKind=a.activityKind;event.priorCategoryId=a.categoryId;
  } else if(type==='refund-link') {
    if(!command.evidence || activityId===command.originalActivityId) fail('refund-evidence-required');
    const target=replay.get(command.originalActivityId);
    if(target.currency!==a.currency || target.activityKind!=='spending' || compare(exactSignedDecimal(a),'0')<=0 || compare(exactSignedDecimal(target),'0')>=0 || a.originalActivityId) fail('invalid-refund-link');
    const refunded=add(exactSignedDecimal(a),refunds.totalFor(target.activityId));
    if(compare(refunded,negate(exactSignedDecimal(target)))>0) fail('refund-exceeds-original');
    event.originalActivityId=target.activityId;
    event.confirmedPostedDate=command.confirmedPostedDate??null;
    if(event.confirmedPostedDate!==null && (!isCalendarDate(event.confirmedPostedDate)||(a.postedDate!==null&&a.postedDate!==event.confirmedPostedDate))) fail('invalid-refund-posted-date');
  } else if(type==='transfer-link') {
    const other=replay.get(command.counterpartyActivityId);
    if(!command.evidence||typeof command.evidence.rationale!=='string'||!command.evidence.rationale.trim()||
      !activeIds.has(command.counterpartyActivityId)||a.activityKind!=='transfer'||other.activityKind!=='transfer'||
      a.accountId===other.accountId||a.currency!==other.currency||
      exactSignedDecimal(a)===null||exactSignedDecimal(other)===null||
      compare(exactSignedDecimal(a),'0')>=0||compare(exactSignedDecimal(other),'0')<=0||
      compare(negate(exactSignedDecimal(a)),exactSignedDecimal(other))!==0||
      a.transferGroupId||other.transferGroupId) fail('invalid-transfer-link');
    event.counterpartyActivityId=other.activityId;
    event.transferGroupId=event.eventId;
  } else fail('unsupported-financial-event');
  return event;
}

export function summarizeLedger(ledger,{start,end,currency,accountIds=ledger.accounts.map(a=>a.accountId)}) {
  return summarizePeriod(createReportContext(ledger),{start,end,currency,accountIds});
}

// One explicit read operation: validation, replay and indexes are discarded after
// the requested reports. Nothing is cached on the ledger or between calls.
export function summarizeLedgerPeriods(ledger,scopes) {
  const context=createReportContext(ledger);
  if(!Array.isArray(scopes)) fail('invalid-report-scopes');
  return scopes.map(scope=>summarizePeriod(context,scope));
}

function createReportContext(ledger) {
  const {replay,byId}=validateAndProject(ledger);
  return {ledger,replay,accounts:byId.accounts,
    active:activeActivities(ledger),
    unresolved:ledger.observations.filter(o=>!o.resolved&&['review','rejected'].includes(o.disposition))};
}

function summarizePeriod({ledger,replay,accounts,active,unresolved},{start,end,currency,accountIds=ledger.accounts.map(a=>a.accountId)}) {
  if(!isCalendarDate(start)||!isCalendarDate(end)||start>end||!/^[A-Z]{3}$/.test(currency)) fail('invalid-report-scope');
  accountIds.forEach(value=>{if(!accounts.has(value))fail('unknown-account');});
  // Preserve the legacy forEach/includes failure behavior for malformed scopes.
  const selected=Array.isArray(accountIds)?new Set(accountIds):{has:value=>accountIds.includes(value)};
  const reasons=new Set(['coverage-not-reconciled']);
  let income='0',spending='0',cash='0'; const excluded=[];
  for(const accountId of accountIds) if(!ledger.imports.some(r=>r.accountId===accountId&&r.declaredCoverage.start<=start&&r.declaredCoverage.end>=end)) reasons.add('missing-declared-coverage');
  for(const o of (Array.isArray(accountIds)?unresolved.filter(o=>selected.has(o.accountId)):
    ledger.observations.filter(o=>accountIds.includes(o.accountId)&&!o.resolved&&['review','rejected'].includes(o.disposition)))) {
    if(!isCalendarDate(o.candidate.effectiveDate)||(o.candidate.effectiveDate>=start&&o.candidate.effectiveDate<=end)) reasons.add('unresolved-observations');
  }
  for(const original of active.filter(a=>selected.has(a.accountId))) {
    const a=replay.get(original.activityId), date=a.activityKind==='refund'?a.postedDate:a.effectiveDate;
    // A source activity date is not proof of a refund's posting period.
    // Its unknown posting date can affect any requested period for this account.
    if(a.activityKind==='refund'&&a.lifecycleStatus==='posted'&&a.postedDate===null) {
      reasons.add('missing-refund-posted-date');
      excluded.push({activityId:a.activityId,reason:'missing-refund-posted-date'});
      continue;
    }
    if(date<start||date>end) continue;
    const omit=reason=>{reasons.add(reason);excluded.push({activityId:a.activityId,reason});};
    if(a.lifecycleStatus==='pending') {excluded.push({activityId:a.activityId,reason:'pending'});continue;}
    if(a.lifecycleStatus!=='posted') {omit('unknown-lifecycle');continue;}
    if(a.currency!==currency) {omit('different-currency');continue;}
    const value=exactSignedDecimal(a);
    if(value===null) {omit('unknown-amount');continue;}
    if(!['income','spending','transfer','refund'].includes(a.activityKind)) {omit('unclassified-activity');continue;}
    if((a.activityKind==='spending'&&compare(value,'0')>0)||(a.activityKind==='income'&&compare(value,'0')<0)||(a.activityKind==='refund'&&compare(value,'0')<=0)) {omit('classification-amount-conflict');continue;}
    if(a.activityKind==='refund'&&!a.originalActivityId&&!a.categoryId) {omit('unmatched-refund');continue;}
    if(a.activityKind==='income') income=add(income,value);
    if(a.activityKind==='spending'||a.activityKind==='refund') spending=add(spending,negate(value));
    // Only checking/savings cash movement; cards are liabilities, not cash accounts.
    if(['checking','savings'].includes(accounts.get(a.accountId).accountType)&&a.activityKind!=='transfer') cash=add(cash,value);
  }
  return {start,end,currency,income,spending,cash,complete:false,reasons:[...reasons],excluded};
}

// One owner per application ledger. This is an in-memory optimization, not a
// storage lock: callers MUST invalidate before import/review/reload/save and
// reopen only from a fully validated result with the current storage binding.
// JSON-only inputs prevent caller getters, callbacks and reentrant mutation.
export function createLedgerSessionOwner() {
  let current=null,generation=0;
  const invalidate=()=>{current?.close();current=null;};
  return Object.freeze({
    invalidate,
    open(json,storageBinding) {
      invalidate();
      if(typeof json!=='string'||typeof storageBinding!=='string'||!storageBinding) fail('session-json-and-storage-binding-required');
      if(generation===Number.MAX_SAFE_INTEGER) fail('session-generation-exhausted');
      const openedGeneration=++generation;
      let ledger=freezeSessionValue(JSON.parse(json)),context,closed=false,busy=false,revision=0;
      const rebuild=()=>{
        const rebuilt=validateAndProject(ledger);
        rebuilt.activeIds=activeActivityIds(ledger);
        rebuilt.refunds=createRefundChecks(ledger,rebuilt.replay);
        context=rebuilt;
      };
      rebuild();
      const close=()=>{closed=true;ledger=null;context=null;};
      const guard=()=>{
        if(closed||current!==session||generation!==openedGeneration) fail('ledger-session-closed');
        if(busy) fail('ledger-session-busy');
      };
      const session=Object.freeze({
        close,
        revision() {guard();return revision;},
        binding() {guard();return Object.freeze({generation:openedGeneration,storageBinding,revision});},
        // Collections and every nested record are frozen, including events.
        // No replay/index Map or mutable projection crosses this boundary.
        snapshot() {guard();return ledger;},
        validatedSnapshot() {guard();validateLedger(ledger);return ledger;},
        exportJson() {guard();validateLedger(ledger);return JSON.stringify(ledger);},
        effectiveActivity(activityId) {
          guard();if(typeof activityId!=='string') fail('session-activity-id-required');
          return {...clone(context.replay.get(activityId)),active:context.activeIds.has(activityId)};
        },
        effectiveActivities() {
          guard();return ledger.activities.map(a=>({...clone(context.replay.get(a.activityId)),active:context.activeIds.has(a.activityId)}));
        },
        summarizePeriodsJson(scopesJson) {
          guard();if(typeof scopesJson!=='string') fail('session-json-required');
          const scopes=JSON.parse(scopesJson);
          if(!Array.isArray(scopes)) fail('invalid-report-scopes');
          const reportContext={ledger,replay:context.replay,accounts:context.byId.accounts,
            active:ledger.activities.filter(a=>context.activeIds.has(a.activityId)),
            unresolved:ledger.observations.filter(o=>!o.resolved&&['review','rejected'].includes(o.disposition))};
          return scopes.map(scope=>summarizePeriod(reportContext,scope));
        },
        applyBatchJson(batchJson,expectedRevision) {
          guard();
          if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==revision) fail('stale-ledger-session-revision');
          if(typeof batchJson!=='string') fail('session-json-required');
          const batch=JSON.parse(batchJson);
          if(!Array.isArray(batch)) fail('invalid-financial-commands');
          busy=true;
          try {
            // Only the private replay/check indexes mutate during preparation.
            // The published immutable ledger is the rollback source throughout.
            const events=[];
            for(const entry of batch) {
              if(!entry||typeof entry.eventId!=='string'||typeof entry.recordedAt!=='string') fail('session-primitive-event-metadata-required');
              const event=buildFinancialEvent(ledger,entry.command,{idFactory:()=>entry.eventId,now:entry.recordedAt},context);
              if(!event) continue;
              if(context.ids.has(event.eventId)) fail('invalid-or-duplicate-record-id');
              context.ids.add(event.eventId);
              validateHistoryEvent(event,context.replay.get(event.activityId),context.byId);
              context.commands.set(event.commandId,event);
              context.replay.append(event);
              context.refunds.check(event);
              // Preserve the pure API's error order: replay/refunds before JSON.
              inspectJson(event);
              events.push(freezeSessionValue(event));
            }
            if(events.length) {
              if(revision===Number.MAX_SAFE_INTEGER) fail('session-revision-exhausted');
              const next=Object.freeze({...ledger,events:Object.freeze([...ledger.events,...events])});
              ledger=next;revision++;
            }
            return revision;
          } catch(error) {
            try {rebuild();} catch {
              // Never continue with partly mutated replay or refund indexes.
              // Keep the original command error, but make every later use fail.
              close();
            }
            throw error;
          } finally {busy=false;}
        },
      });
      current=session;
      return session;
    },
  });
}

function freezeSessionValue(value) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSessionValue);
    Object.freeze(value);
  }
  return value;
}
