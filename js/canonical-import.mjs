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
  const validMoney = value => {
    if(!value || Object.keys(value).some(k=>!['amountMinor','amountDecimal','currency'].includes(k)) || !/^[A-Z]{3}$/.test(value.currency) || (value.amountMinor===null)===(value.amountDecimal===null) || exactSignedDecimal(value)===null) fail('invalid-event-money');
    parseMoney(exactSignedDecimal(value),value.currency);
  };
  const commands=new Set();
  for (const e of ledger.events) {
    findActivity(e.activityId);
    if (typeof e.commandId !== 'string' || !e.commandId || commands.has(e.commandId)) fail('invalid-event-command');
    commands.add(e.commandId);
    if (!Number.isFinite(Date.parse(e.recordedAt)) || e.appendOnly!==true) fail('invalid-event-metadata');
    const a=effective({...ledger,events:ledger.events.slice(0,ledger.events.indexOf(e))},findActivity(e.activityId));
    if(e.eventType==='bank-correction') {
      validMoney(e.priorValues); validMoney(e.proposedValues);
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
    } else fail('unsupported-persisted-event');
  }
  const refundTotals=new Map(), refundActivities=new Set();
  for(const event of ledger.events.filter(e=>e.eventType==='refund-link')) {
    const refund=effective(ledger,findActivity(event.activityId));
    const target=effective(ledger,findActivity(event.originalActivityId));
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
  // Storage records must be JSON, not Date/BigInt/undefined or non-finite values.
  const inspect = value => { if (value===undefined || typeof value==='bigint' || typeof value==='function' || typeof value==='symbol' || (typeof value==='number'&&!Number.isFinite(value))) fail('non-json-ledger'); if(value && typeof value==='object') { if(!Array.isArray(value) && Object.getPrototypeOf(value)!==Object.prototype) fail('non-json-ledger'); Object.values(value).forEach(inspect); } };
  inspect(ledger);
  return true;
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
function refreshRun(ledger, run) {
  const observationById=new Map();
  for(const observation of ledger.observations) {
    // Keep find's first-match behavior until the mutated ledger's final ID check.
    if(!observationById.has(observation.observationId)) observationById.set(observation.observationId,observation);
  }
  const observations=run.observationIds.map(value=>observationById.get(value));
  const counts=zeroCounts(); counts.rowsSeen=run.rowsSeen; counts.rowsRecognized=observations.length;
  for(const o of observations) counts[o.disposition]++;
  run.counts=counts;
  run.status=observations.some(o=>(o.disposition==='review'||o.disposition==='rejected')&&!o.resolved) ? 'needs-review':'processed';
  run.errorCode=run.status==='needs-review'?'unresolved-observations':null;
  run.latestActivityDate=activeActivities(ledger).filter(a=>a.accountId===run.accountId).map(a=>effective(ledger,a).effectiveDate).sort().at(-1)??null;
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
      const unresolved=prior.observationIds.map(value=>next.observations.find(o=>o.observationId===value)).filter(o=>!o.resolved&&['review','rejected'].includes(o.disposition));
      const retryRows=unresolved.map(o=>canonicalRow(records.find(r=>r.rowOrdinal===o.rowOrdinal)??fail('retry-row-missing'),account));
      if(retryRows.some((candidate,i)=>canonicalizeJcs(candidate)!==canonicalizeJcs(unresolved[i].candidate))) fail('retry-normalization-changed');
      const retry=reconcileImport({institutionId:account.institutionId,accountId:account.accountId,sourceFormat:parsed.sourceFormat,fileFingerprint:parsed.fileFingerprint,rows:retryRows,...reconciliationEvidence(next),idFactory:()=>id(options)});
      const time=stamp(options),priorStatus=prior.status,priorCounts=clone(prior.counts);
      for(const a of retry.activities) next.activities.push({...a,createdAt:time,updatedAt:time});
      retry.observations.forEach((result,i)=>Object.assign(unresolved[i],result));
      for(const e of retry.events) {
        const observation=unresolved.find(o=>o.rowOrdinal===e.observationRowOrdinal),commandId=`import:${observation.observationId}:${e.eventType}`;
        if(!next.events.some(event=>event.commandId===commandId)) next.events.push({...e,eventId:id(options),commandId,sourceObservationId:observation.observationId,recordedAt:time});
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
    for(const event of result.events) {
      const observation=observations.find(o=>o.rowOrdinal===event.observationRowOrdinal);
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
  const active=activeActivities(ledger);
  return {existingActivities:active.map(activity=>effective(ledger,activity)),existingObservations:ledger.observations,existingCompositeEvidence:retainedCompositeEvidence(ledger,active)};
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
  const key=categoryRuleKey(activity), enabled=Boolean(key.normalizedDescription.trim());
  // The immutable account, currency and source fields keep unrelated activities
  // outside this rule forever. Retain only earlier exact-key peers, including
  // inactive history, so later imports can inherit without recategorizing peers.
  // Version 1 also accepts the older full-ledger inventories without rewriting them.
  const existingActivityIds=enabled
    ? ledger.activities.filter(prior=>categoryRuleMatches(key,prior)).map(prior=>prior.activityId)
    : [activity.activityId];
  return {version:1,enabled,key,existingActivityIds};
}

function effective(ledger, activity, visited = new Set()) {
  if(visited.has(activity.activityId)) fail('cyclic-refund-link');
  const ancestry=new Set(visited);ancestry.add(activity.activityId);
  const result=clone(activity);
  for(const e of ledger.events) {
    // The recorded membership boundary makes rules prospective without relying on
    // clocks or mutable array ordering. Existing peers keep their historical category.
    if(e.eventType==='category-correction' && e.prospectiveRule?.enabled && categoryRuleMatches(e.prospectiveRule.key,activity) && !e.prospectiveRule.existingActivityIds.includes(activity.activityId)) result.categoryId=e.categoryId;
    if(e.activityId!==activity.activityId) continue;
    if(e.eventType==='bank-correction') Object.assign(result,e.proposedValues);
    if(e.eventType==='category-correction') result.categoryId=e.categoryId;
    if(e.eventType==='classification') { result.activityKind=e.activityKind; if(e.categoryId!==null) result.categoryId=e.categoryId; }
    if(e.eventType==='refund-link') {
      result.activityKind='refund';result.originalActivityId=e.originalActivityId;
      result.categoryId=effective(ledger,activityFor(ledger,e.originalActivityId),ancestry).categoryId;
      if(e.confirmedPostedDate) result.postedDate=e.confirmedPostedDate;
    }
    if(e.eventType==='lifecycle-transition') { result.lifecycleStatus=e.to; result.effectiveDate=e.effectiveDate; result.postedDate=e.postedDate; result.settlementDate=e.settlementDate; }
  }
  return result;
}
export function getEffectiveActivities(ledger) {
  validateLedger(ledger);
  const activeIds=activeActivityIds(ledger);
  return ledger.activities.map(activity=>({...effective(ledger,activity),active:activeIds.has(activity.activityId)}));
}

// Exact decimal arithmetic throughout; BigInts never enter persisted records.
function decimal(value) { const m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(value??''); if(!m) fail('invalid-exact-amount'); return {n:BigInt((m[1]||'')+m[2]+(m[3]||'')),s:(m[3]||'').length}; }
function add(a,b) { const x=decimal(a),y=decimal(b),s=Math.max(x.s,y.s); return format(x.n*10n**BigInt(s-x.s)+y.n*10n**BigInt(s-y.s),s); }
function format(n,s) { const sign=n<0n?'-':''; const digits=(n<0n?-n:n).toString().padStart(s+1,'0'); return sign+(s?digits.slice(0,-s)+'.'+digits.slice(-s):digits); }
const negate = value => { const d=decimal(value);return format(-d.n,d.s); };
const compare = (a,b) => {const d=decimal(add(a,negate(b)));return d.n<0n?-1:d.n>0n?1:0;};

export function applyFinancialEvent(ledger, command, options={}) {
  validateLedger(ledger);
  const {type,activityId,commandId}=command;
  if(typeof commandId!=='string'||!commandId) fail('event-command-id-required');
  const signature=canonicalizeJcs(command);
  const prior=ledger.events.find(e=>e.commandId===commandId);
  if(prior) {if(prior.commandSignature!==signature) fail('event-command-conflict');return clone(ledger);}
  const next=clone(ledger), original=activityFor(next,activityId), a=effective(next,original);
  if(!activeActivities(next).some(active=>active.activityId===activityId)) fail('inactive-financial-target');
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
    const target=effective(next,activityFor(next,command.originalActivityId));
    if(target.currency!==a.currency || target.activityKind!=='spending' || compare(exactSignedDecimal(a),'0')<=0 || compare(exactSignedDecimal(target),'0')>=0 || a.originalActivityId) fail('invalid-refund-link');
    let refunded=exactSignedDecimal(a);
    for(const priorEvent of next.events.filter(e=>e.eventType==='refund-link'&&e.originalActivityId===target.activityId)) refunded=add(refunded,exactSignedDecimal(effective(next,activityFor(next,priorEvent.activityId))));
    if(compare(refunded,negate(exactSignedDecimal(target)))>0) fail('refund-exceeds-original');
    event.originalActivityId=target.activityId;
    event.confirmedPostedDate=command.confirmedPostedDate??null;
    if(event.confirmedPostedDate!==null && (!isCalendarDate(event.confirmedPostedDate)||(a.postedDate!==null&&a.postedDate!==event.confirmedPostedDate))) fail('invalid-refund-posted-date');
  } else fail('unsupported-financial-event');
  next.events.push(event); validateLedger(next);return next;
}

export function summarizeLedger(ledger,{start,end,currency,accountIds=ledger.accounts.map(a=>a.accountId)}) {
  validateLedger(ledger);
  if(!isCalendarDate(start)||!isCalendarDate(end)||start>end||!/^[A-Z]{3}$/.test(currency)) fail('invalid-report-scope');
  accountIds.forEach(value=>accountFor(ledger,value));
  const reasons=new Set(['coverage-not-reconciled']);
  let income='0',spending='0',cash='0'; const excluded=[];
  for(const accountId of accountIds) if(!ledger.imports.some(r=>r.accountId===accountId&&r.declaredCoverage.start<=start&&r.declaredCoverage.end>=end)) reasons.add('missing-declared-coverage');
  for(const o of ledger.observations.filter(o=>accountIds.includes(o.accountId)&&!o.resolved&&['review','rejected'].includes(o.disposition))) {
    if(!isCalendarDate(o.candidate.effectiveDate)||(o.candidate.effectiveDate>=start&&o.candidate.effectiveDate<=end)) reasons.add('unresolved-observations');
  }
  for(const original of activeActivities(ledger).filter(a=>accountIds.includes(a.accountId))) {
    const a=effective(ledger,original), date=a.activityKind==='refund'?a.postedDate:a.effectiveDate;
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
    if(['checking','savings'].includes(accountFor(ledger,a.accountId).accountType)&&a.activityKind!=='transfer') cash=add(cash,value);
  }
  return {start,end,currency,income,spending,cash,complete:false,reasons:[...reasons],excluded};
}
