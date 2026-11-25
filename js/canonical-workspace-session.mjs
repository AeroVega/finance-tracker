import { fail as appFail } from './app-error.mjs';
import { getEntry } from './error-registry.mjs';
import { HISTORICAL_COLLECTIONS, prepareHistoricalReconciliation, prepareHistoricalSummaries } from './historical-monthly-summary.mjs';
import { applyFinancialEvent, applyFinancialEvents, applyReviewDecision, reverseReviewDecision, registerAccount, validateLedgerOfClass, ledgerDataClass, getEffectiveActivities, summarizeLedgerPeriods } from './canonical-import.mjs';
import { persistenceDataClass } from './persistence-data-class.mjs';
import { canonicalizeJcs } from './transaction-protocol.mjs';
import { applyPositionEvent, buildFinancialPosition } from './financial-position.mjs';

import { FULL_SNAPSHOT_LIMITS } from './full-snapshot-storage.mjs';
import { utf8ByteLength } from './utf8-length.mjs';
import {encodeFullSnapshotBackup,decodeFullSnapshotBackup} from './full-snapshot-backup.mjs';

const same=(a,b)=>canonicalizeJcs(a)===canonicalizeJcs(b);
const reportContents=ledger=>({activities:getEffectiveActivities(ledger),periods:summarizeLedgerPeriods(ledger,[...new Set(ledger.accounts.map(a=>a.currency))].sort().map(currency=>({start:'0100-01-01',end:'9999-12-31',currency}))),position:buildFinancialPosition(ledger,{asOf:'9999-12-31'})});
const fail = code => { throw Object.assign(new Error(code), { code }); };

const changedOnly = (before, after, allowed) => {
  const left = { ...before }, right = { ...after };
  for (const key of allowed) { delete left[key]; delete right[key]; }
  return same(left, right);
};
function validImportRetry(before, after) {
  if (before.status !== 'needs-review' || !Array.isArray(before.retryAttempts) ||
    !Array.isArray(after.retryAttempts) || after.retryAttempts.length !== before.retryAttempts.length + 1 ||
    !before.retryAttempts.every((attempt, index) => same(attempt, after.retryAttempts[index])) ||
    !changedOnly(before, after, ['status', 'errorCode', 'counts', 'latestActivityDate', 'retryAttempts'])) return false;
  const attempt = after.retryAttempts.at(-1);
  return attempt.priorStatus === before.status && same(attempt.priorCounts, before.counts) &&
    attempt.status === after.status && same(attempt.counts, after.counts);
}
function validObservationRetry(before, after) {
  if (before.resolved || !['review', 'rejected'].includes(before.disposition) ||
    after.resolved !== false || !changedOnly(before, after, ['disposition', 'activityId', 'reasonCode'])) return false;
  return true;
}

/** A local draft is never storage authority. Every durable change uses the
 * existing verified store and lifecycle; failed operations retain the draft. */
export class CanonicalWorkspaceSession {
  constructor({ storage, online = () => globalThis.navigator?.onLine !== false }) {
    this.storage = storage;
    this.online = online;
    this.ledger = null;
    this.store = null;
    this.mode = 'empty';
    this.dirty = false;
    this.unverified = false;
    this.needsReopen = false;
    this.busy = false;
    this.savedEventCount = 0;
    this.baselineLedger = null;
    this.stagedHistory = [];
    this.backupPreview=false;this.backupSource=null;this.restoreExpected=null;this.restoreFolderId=null;this.pendingSave=null;this.recoveryOutcome=null;
    this.designationFailed=false;this.recoveryCause=null;
  }

  invalidate() { if (this.mode === 'saved') this.needsReopen = true; }

  // One class per session, fixed by the storage bridge before connection.
  get dataClass() { return this.storage.dataClass ?? 'synthetic'; }
  #validate(ledger) {
    if (ledgerDataClass(ledger) !== this.dataClass) appFail('data-class-mismatch');
    return validateLedgerOfClass(ledger, this.dataClass);
  }
  // Designation only narrows later Opens and never admits anything. A failed
  // write must not mark the verified copy unverified, but it is not hidden:
  // the previous designation still applies until it is recorded.
  #designateVerifiedFolder() {
    this.designationFailed = false;
    try { this.storage.commitFolderDesignation?.(); } catch { this.designationFailed = true; }
  }

  ready() {
    const lifecycle = this.storage.lifecycle;
    return Boolean(this.online() && lifecycle?.state === 'ready' && lifecycle.acceptingWrites);
  }

  canEdit() {
    if (this.busy || !this.ledger || this.unverified || this.recoveryOutcome==='not-saved') return false;
    // A draft of another class is never editable in this session.
    if (persistenceDataClass('ledger', this.ledger) !== this.dataClass) return false;
    if (this.mode === 'preview') return true;
    return Boolean(this.ready() && !this.needsReopen && this.store?.base && this.store.lifecycle === this.storage.lifecycle);
  }

  canSave() { return this.mode === 'saved' && this.dirty && this.canEdit(); }
  canUndo() { return this.canEdit() && this.stagedHistory.length > 0; }
  canRevertAll() { return this.canUndo(); }

  updateDirty() {
    this.dirty = !same(this.ledger,this.baselineLedger);
  }

  async operation(callback) {
    if (this.busy) fail('operation-in-progress');
    this.busy = true;
    try { return await callback(); } finally { this.busy = false; }
  }

  #assertNoUnknownPublication(){const attempt=this.pendingSave,evidence=attempt?.lifecycle.engine.saveAttempt;if(evidence?.sequence!==attempt?.priorSequence&&evidence?.authorityDispatched)fail('recovery-required');}

  async loadVerified() {
    this.#assertNoUnknownPublication();
    // An ordinary reopen must not waive the stronger restore acceptance gate.
    if(this.restoreExpected&&this.restoreFolderId)return this.#verifyRestoredCopy();
    this.invalidate();
    if (!this.ready()) fail('reconnect-required');
    const lifecycle = this.storage.lifecycle;
    const store = this.storage.createLedgerStore();
    const ledger = await store.load();
    if (!ledger) fail('canonical-ledger-required');
    if (lifecycle !== this.storage.lifecycle || !this.ready()) fail('reconnect-required');
    this.pendingSave=null;this.recoveryOutcome=null;this.backupPreview=false;this.backupSource=null;this.restoreExpected=null;this.restoreFolderId=null;
    this.store = store;
    this.ledger = ledger;
    this.mode = 'saved';
    this.needsReopen = false;
    this.dirty = false;
    this.unverified = false;
    this.baselineLedger = structuredClone(ledger);
    this.stagedHistory = [];
    this.savedEventCount = ledger.events.length;
    return ledger;
  }

  async open() {
    if(this.restoreExpected&&this.restoreFolderId)fail('recovery-required');
    this.#assertNoUnknownPublication();
    return this.operation(async () => {
      // Folder admission is transactional: cancellation keeps this draft and
      // its original verified base usable when storage did not change.
      await this.storage.connect({ requireExisting: true });
      this.invalidate();
      this.store = null;
      return this.loadVerified();
    });
  }

  async reopen() { return this.operation(() => this.loadVerified()); }

  preview(ledger) {
    if (this.busy || this.storage.lifecycle) fail('release-before-preview');
    this.#validate(ledger);
    this.pendingSave=null;this.recoveryOutcome=null;this.backupPreview=false;this.backupSource=null;this.restoreExpected=null;this.restoreFolderId=null;
    this.ledger = structuredClone(ledger);
    this.mode = 'preview'; this.store = null; this.dirty = false;
    this.unverified = false; this.needsReopen = false;
    this.baselineLedger = structuredClone(this.ledger);
    this.stagedHistory = [];
    this.savedEventCount = ledger.events.length;
  }

  correct({ activityId, type, activityKind, categoryId, amountText, lifecycleStatus, postedDate, rationale }) {
    if (!this.canEdit()) fail('reopen-before-editing');
    if (typeof rationale !== 'string' || !rationale.trim()) fail('correction-rationale-required');
    if (!['classification', 'category-correction', 'bank-correction', 'posting-status-correction'].includes(type)) fail('unsupported-workspace-correction');
    const command = { activityId, type, commandId: crypto.randomUUID(), evidence: { rationale: rationale.trim() } };
    if (type === 'classification') command.activityKind = activityKind;
    if (type === 'category-correction') command.categoryId = typeof categoryId === 'string' ? categoryId.trim() : categoryId;
    if (type === 'bank-correction') command.amountText = typeof amountText === 'string' ? amountText.trim() : amountText;
    if (type === 'posting-status-correction') { command.lifecycleStatus = lifecycleStatus; command.postedDate = postedDate; }
    const next = applyFinancialEvent(this.ledger, command);
    this.stageCheckpoint();
    this.ledger = next;
    this.updateDirty();
    return this.ledger;
  }

  /** Inline review: one staged step that sets the type and, when it changes,
   * the category. Both commands apply atomically, so a rejected category never
   * leaves a half-applied classification. The category uses the ordinary
   * category correction, which keeps the prospective rule behavior. */
  quickClassify({ activityId, activityKind, categoryId = null, rationale }) {
    if (!this.canEdit()) fail('reopen-before-editing');
    if (typeof rationale !== 'string' || !rationale.trim()) fail('correction-rationale-required');
    if (!['income', 'spending', 'transfer', 'refund'].includes(activityKind)) fail('unsupported-classification');
    if (categoryId !== null && (typeof categoryId !== 'string' || !categoryId.trim())) fail('category-required');
    const current = getEffectiveActivities(this.ledger).find(activity => activity.activityId === activityId && activity.active);
    if (!current) fail('unknown-activity');
    const evidence = { rationale: rationale.trim() };
    const commands = [];
    // A classification event records its own category; carry the current one so
    // a type change alone never clears an existing category.
    if (current.activityKind !== activityKind) commands.push({ activityId, type: 'classification', activityKind, categoryId: current.categoryId ?? null, commandId: crypto.randomUUID(), evidence });
    if (categoryId !== null && categoryId.trim() !== current.categoryId) {
      commands.push({ activityId, type: 'category-correction', categoryId: categoryId.trim(), commandId: crypto.randomUUID(), evidence: { ...evidence } });
    }
    if (!commands.length) return this.ledger;
    const next = applyFinancialEvents(this.ledger, commands);
    this.stageCheckpoint();
    this.ledger = next;
    this.updateDirty();
    return this.ledger;
  }

  linkTransfer({ outgoingActivityId, counterpartyActivityId, rationale }) {
    if (!this.canEdit()) fail('reopen-before-editing');
    if (typeof rationale !== 'string' || !rationale.trim()) fail('transfer-link-rationale-required');
    const next = applyFinancialEvent(this.ledger, {
      activityId: outgoingActivityId,
      type: 'transfer-link',
      counterpartyActivityId,
      commandId: crypto.randomUUID(),
      evidence: { rationale: rationale.trim() }
    });
    this.stageCheckpoint();
    this.ledger = next;
    this.updateDirty();
    return this.ledger;
  }

  reviewSource({ observationId, action, activityId = null, rationale, currency = null }) {
    if (!this.canEdit()) fail('reopen-before-editing');
    if (typeof rationale !== 'string' || !rationale.trim()) fail('correction-rationale-required');
    const next = applyReviewDecision(this.ledger, { observationId, action, activityId, rationale: rationale.trim(), currency });
    this.stageCheckpoint();
    this.ledger = next;
    this.updateDirty();
    return next;
  }

  reverseSourceReview({ reviewDecisionId, rationale }) {
    if (!this.canEdit()) fail('reopen-before-editing');
    if (typeof rationale !== 'string' || !rationale.trim()) fail('correction-rationale-required');
    const next = reverseReviewDecision(this.ledger, { reviewDecisionId, rationale: rationale.trim() });
    this.stageCheckpoint();
    this.ledger = next;
    this.updateDirty();
    return next;
  }

  stageCheckpoint() {
    // Keep a complete immutable checkpoint. Import preparation can append to
    // collections other than accounts/events, so length-only undo would leave
    // orphaned observations, import runs or activities behind.
    this.stagedHistory.push(structuredClone(this.ledger));
  }

  stageCanonicalImport(proposal) {
    if (!this.canEdit()) fail('reopen-before-editing');
    this.#validate(proposal);
    const current = this.ledger;
    if (proposal.ledgerId !== current.ledgerId || proposal.createdAt !== current.createdAt ||
      persistenceDataClass('ledger', proposal) !== persistenceDataClass('ledger', current) ||
      proposal.version !== current.version || !same(proposal.accounts, current.accounts) ||
      Object.keys(HISTORICAL_COLLECTIONS).some(key => !same(proposal[key] ?? null, current[key] ?? null)) ||
      !same(proposal.positionEvents ?? [], current.positionEvents ?? [])) fail('invalid-parsed-import');
    for (const key of ['activities', 'events']) {
      const before = current[key], after = proposal[key];
      if (!Array.isArray(after) || after.length < before.length ||
        !before.every((record, index) => same(record, after[index]))) fail('invalid-parsed-import');
    }
    if (!same(proposal.reviewDecisions, current.reviewDecisions) ||
      !Array.isArray(proposal.imports) || proposal.imports.length < current.imports.length ||
      !Array.isArray(proposal.observations) || proposal.observations.length < current.observations.length) fail('invalid-parsed-import');
    const retryRunIds = new Set();
    for (let index = 0; index < current.imports.length; index++) {
      const before = current.imports[index], after = proposal.imports[index];
      if (before.importRunId !== after.importRunId) fail('invalid-parsed-import');
      if (!same(before, after)) {
        if (!validImportRetry(before, after)) fail('invalid-parsed-import');
        retryRunIds.add(before.importRunId);
      }
    }
    const changedObservationIds = new Set();
    for (let index = 0; index < current.observations.length; index++) {
      const before = current.observations[index], after = proposal.observations[index];
      if (before.observationId !== after.observationId) fail('invalid-parsed-import');
      if (!same(before, after)) {
        if (!retryRunIds.has(before.importRunId) || !validObservationRetry(before, after)) fail('invalid-parsed-import');
        changedObservationIds.add(before.observationId);
      }
    }
    for (const observation of proposal.observations.slice(current.observations.length)) {
      changedObservationIds.add(observation.observationId);
    }
    for (const activity of proposal.activities.slice(current.activities.length)) {
      if (!proposal.observations.some(observation => observation.activityId === activity.activityId &&
        changedObservationIds.has(observation.observationId))) fail('invalid-parsed-import');
    }
    for (const event of proposal.events.slice(current.events.length)) {
      if (!changedObservationIds.has(event.sourceObservationId)) fail('invalid-parsed-import');
    }
    const addedRuns = proposal.imports.length - current.imports.length;
    if (addedRuns < 1 && retryRunIds.size < 1) fail('invalid-parsed-import');
    this.stageCheckpoint();
    this.ledger = structuredClone(proposal);
    this.updateDirty();
    return this.ledger;
  }

  stageHistoricalSummaries({input, decisions, expectedLedger}) {
    this.#assertHistoricalReviewCurrent(expectedLedger);
    const next = prepareHistoricalSummaries(expectedLedger, {input, decisions});
    return this.#applyHistoryStage(next);
  }

  async stageHistoricalReconciliation({month, reason, evidence, expectedLedger, signal}) {
    if (signal?.aborted) appFail('stale-historical-summary-review');
    this.#assertHistoricalReviewCurrent(expectedLedger);
    const lifecycle = this.storage.lifecycle, store = this.store;
    const next = await prepareHistoricalReconciliation(expectedLedger, {month, reason, evidence});
    this.#assertHistoricalReviewCurrent(expectedLedger);
    if (signal?.aborted || lifecycle !== this.storage.lifecycle || store !== this.store) appFail('stale-historical-summary-review');
    return this.#applyHistoryStage(next);
  }

  #assertHistoricalReviewCurrent(expectedLedger) {
    // Workbook-history import is a separate, synthetic-only workstream.
    if (this.dataClass !== 'synthetic') appFail('data-class-mismatch');
    if (!this.canEdit()) appFail('reopen-before-editing');
    if (this.ledger !== expectedLedger) appFail('stale-historical-summary-review');
  }

  #applyHistoryStage(next) {
    if (next === this.ledger) return next;
    this.#validate(next);
    this.stageCheckpoint();
    this.ledger = next;
    this.updateDirty();
    return next;
  }

  addAccount({ institutionId, accountType, displayName, currency }) {
    if (!this.canEdit()) fail('reopen-before-editing');
    const next = registerAccount(this.ledger, { institutionId, accountType, displayName, currency });
    this.stageCheckpoint();
    this.ledger = next;
    this.updateDirty();
    return this.ledger;
  }

  recordPosition(command) {
    if (!this.canEdit()) fail('reopen-before-editing');
    const next = applyPositionEvent(this.ledger, { ...command, commandId: crypto.randomUUID() });
    this.stageCheckpoint();
    this.ledger = next;
    this.updateDirty();
    return this.ledger;
  }

  undoLastStagedChange() {
    if (!this.canEdit()) fail('reopen-before-editing');
    if (!this.stagedHistory.length) fail('no-staged-changes');
    const previous = this.stagedHistory.at(-1);
    const next = structuredClone(previous);
    this.#validate(next);
    this.stagedHistory.pop();
    this.ledger = next;
    this.updateDirty();
    return this.ledger;
  }

  revertAllStagedChanges() {
    if (!this.canEdit()) fail('reopen-before-editing');
    if (!this.stagedHistory.length || !this.baselineLedger) fail('no-staged-changes');
    this.ledger = structuredClone(this.baselineLedger);
    this.stagedHistory = [];
    this.dirty = false;
    return this.ledger;
  }

  async savePreviewToNewCopy() {
    if(this.backupPreview&&!this.restoreExpected)fail('verified-backup-required');
    if (this.mode !== 'preview' || !this.ledger || this.busy || this.unverified || this.storage.lifecycle) {
      fail('verified-preview-required');
    }
    // Reject a cross-class or oversized ledger before connecting, which may
    // initialize the destination.
    this.#validate(this.ledger);
    if (utf8ByteLength(canonicalizeJcs(this.ledger)) > FULL_SNAPSHOT_LIMITS.snapshotBytes) appFail('byte-limit');
    const proposal = structuredClone(this.ledger);
    return this.operation(async () => {
      let store = null, writeStarted = false, writeVerified = false;
      try {
        await this.storage.connect({ requireEmpty: true, canonicalLayout: 'full-snapshot-v1' });
        const lifecycle = this.storage.lifecycle;
        if (!this.ready() || !lifecycle) fail('reconnect-required');
        const genesis = await lifecycle.readManifest();
        if (!lifecycle.fullSnapshot || persistenceDataClass('manifest', genesis) !== this.dataClass ||
          genesis.revision !== '0' || genesis.pending !== null) {
          fail('new-empty-folder-required');
        }
        store = this.storage.createLedgerStore();
        const existing = await store.load();
        if (existing !== null || !store.base || canonicalizeJcs(store.base) !== canonicalizeJcs(genesis)) {
          fail('new-empty-folder-required');
        }
        if (!this.ready() || lifecycle !== this.storage.lifecycle) fail('reconnect-required');
        this.store = store;
        this.needsReopen = true;
        writeStarted = true;
        if(this.restoreExpected)this.restoreFolderId=lifecycle.folderId;
        this.pendingSave={proposal:structuredClone(proposal),base:null,lifecycle,priorSequence:lifecycle.engine.saveAttempt?.sequence,folderId:lifecycle.folderId};
        this.recoveryOutcome=null;
        await store.save(proposal);
        writeVerified = true;
        if (!this.ready() || lifecycle !== this.storage.lifecycle) fail('reconnect-required');
        const verifier = this.storage.createLedgerStore();
        const reopened = await verifier.load();
        if (!reopened || canonicalizeJcs(reopened) !== canonicalizeJcs(proposal)) fail('seed-readback-mismatch');
        this.store = verifier;
        this.ledger = reopened;
        this.mode = 'saved';
        this.dirty = false;
        this.unverified = false;
        this.needsReopen = false;
        this.baselineLedger = structuredClone(reopened);
        this.stagedHistory = [];
        this.savedEventCount = reopened.events.length;
        this.pendingSave=null;this.recoveryOutcome=null;
        if(this.restoreExpected)return this.#verifyRestoredCopy();
        this.#designateVerifiedFolder();
        return reopened;
      } catch (error) {
        const uncertain = writeStarted && (writeVerified || !store?.base);
        this.unverified = uncertain;
        this.needsReopen = uncertain;
        if (!uncertain) this.store = null;
        if(uncertain&&this.pendingSave){const result=await this.#resolveAttempt();if(result.outcome==='saved')return this.restoreExpected?this.#verifyRestoredCopy():this.ledger;}
        throw error;
      }
    });
  }

  async save() {
    if (!this.canSave()) fail('verified-draft-required');
    return this.operation(async () => {
      // A rejected or lost commit response is uncertain until verified reopen.
      this.needsReopen = true;
      this.pendingSave={proposal:structuredClone(this.ledger),base:structuredClone(this.baselineLedger),baseManifest:structuredClone(this.store?.base??null),lifecycle:this.storage.lifecycle,priorSequence:this.storage.lifecycle.engine.saveAttempt?.sequence,folderId:this.storage.lifecycle.folderId};
      this.recoveryOutcome=null;
      try {
        const ledger = await this.store.save(this.ledger);
        if (!this.ready() || this.store.lifecycle !== this.storage.lifecycle) fail('reconnect-required');
        this.ledger = ledger; this.dirty = false; this.unverified = false;
        this.needsReopen = false;
        this.baselineLedger = structuredClone(ledger);
        this.stagedHistory = [];
        this.savedEventCount = ledger.events.length;
        this.pendingSave=null;this.recoveryOutcome=null;
        if(this.restoreExpected)return this.#verifyRestoredCopy();
        return ledger;
      } catch (error) { this.unverified = true;const result=await this.#resolveAttempt();if(result.outcome==='saved')return this.restoreExpected?this.#verifyRestoredCopy():this.ledger;throw error; }
    });
  }


  // Invoked only inside the serialized workspace operation. A completed fetch
  // is not proof that an unknown remote authority write cannot arrive later.
  async #resolveAttempt() {
    const attempt=this.pendingSave,lifecycle=attempt?.lifecycle;
    this.recoveryOutcome='checking';this.unverified=true;this.needsReopen=true;
    try {
      if(!attempt||!this.online()||lifecycle!==this.storage.lifecycle||lifecycle.folderId!==attempt.folderId||!lifecycle.coordinator?.canWrite)fail('reconnect-required');
      lifecycle.transactionAdapter.assertMutationsSettled();
      // The engine records a new attempt before its first write. No new record
      // means this save stopped before any write (for example, revoked access
      // refused its first read); compare Drive with the draft's verified base.
      const recorded=lifecycle.engine.saveAttempt,started=Boolean(recorded)&&recorded.sequence!==attempt.priorSequence;
      if(!started&&!attempt.baseManifest)fail('verified-base-required');
      const evidence=started?recorded:{base:attempt.baseManifest,candidate:null,authorityDispatched:false};
      await lifecycle.recover();
      if(!this.ready())fail('reconnect-required');
      const store=this.storage.createLedgerStore(),saved=await store.load({cold:true});
      if(lifecycle!==this.storage.lifecycle||!this.ready()||this.pendingSave!==attempt)fail('reconnect-required');
      lifecycle.transactionAdapter.assertMutationsSettled();
      if(evidence.candidate&&same(store.base,evidence.candidate)&&same(saved,attempt.proposal)){
        this.store=store;this.ledger=saved;this.mode='saved';this.baselineLedger=structuredClone(saved);this.dirty=false;this.unverified=false;this.needsReopen=false;this.stagedHistory=[];this.savedEventCount=saved.events.length;this.pendingSave=null;this.recoveryOutcome='saved';
      }else if(same(store.base,evidence.base)&&same(saved,attempt.base)){
        if(evidence.authorityDispatched){this.recoveryOutcome='unverifiable';}
        else {this.store=store;this.mode='saved';this.baselineLedger=structuredClone(saved);this.dirty=true;this.unverified=false;this.needsReopen=false;this.recoveryOutcome='not-saved';}
      }else {this.recoveryOutcome='different';}
    } catch(error) {this.#noteRecoveryCause(error);this.recoveryOutcome='unverifiable';}
    return {outcome:this.recoveryOutcome};
  }
  // Keep the reason an explicit recheck could not verify, as a registered
  // report-safe code only, so the user and diagnostics can see why.
  #noteRecoveryCause(error){const code=error?.code;this.recoveryCause=typeof code==='string'&&getEntry(code)?code:'unexpected-error';}
  async resolveUncertainSave(){return this.operation(async()=>{
    const lifecycle=this.storage.lifecycle;this.recoveryCause=null;
    if(((this.pendingSave&&lifecycle===this.pendingSave.lifecycle)||(this.restoreExpected&&lifecycle?.folderId===this.restoreFolderId))&&this.online()){
      try{lifecycle.transactionAdapter.assertMutationsSettled();await this.storage.refreshRecoveryAuthorization?.();if(lifecycle!==this.storage.lifecycle)fail('reconnect-required');
        if(!lifecycle.coordinator.canWrite){
          try{await lifecycle.coordinator.resume();}
          catch(error){
            // Only this page's own expired marker reports stale-session; a
            // live or different session reports ownership-lost and stays
            // blocked. Reclaim exactly as Open does after heartbeat expiry;
            // the draft is not published and retry still needs confirmation.
            if(error?.code!=='stale-session'||typeof this.storage.reclaimOwnStaleSession!=='function')throw error;
            await this.storage.reclaimOwnStaleSession(lifecycle);
            if(lifecycle!==this.storage.lifecycle||!lifecycle.coordinator.canWrite)fail('reconnect-required');
          }
        }}
      catch(error){this.#noteRecoveryCause(error);this.unverified=true;this.needsReopen=true;this.recoveryOutcome='unverifiable';return {outcome:'unverifiable'};}
    }
    if(this.restoreExpected&&!this.pendingSave){await this.#verifyRestoredCopy();this.recoveryOutcome='saved';return {outcome:'saved'};}const result=await this.#resolveAttempt();if(result.outcome==='saved'&&this.restoreExpected)await this.#verifyRestoredCopy();return result;});}
  async retryUncertainSave({confirm=false}={}){
    if(confirm!==true||this.recoveryOutcome!=='not-saved'||!this.pendingSave||this.busy)fail('verified-retry-required');
    // Reverify immediately before explicit retry. No UI observation is a lease.
    const result=await this.resolveUncertainSave();
    if(result.outcome!=='not-saved')fail('verified-retry-required');
    this.recoveryOutcome=null;
    const ledger=await this.save();this.recoveryOutcome='saved';return ledger;
  }
  async exportBackup({password,excludeStaged=false}={}){
    if(this.mode!=='saved'||!this.ready()||this.unverified||this.needsReopen||this.pendingSave)fail('invalid-backup-source');
    if(this.dirty&&!excludeStaged)fail('backup-staged-changes');
    return this.operation(async()=>{
      const lifecycle=this.storage.lifecycle,store=this.storage.createLedgerStore(),saved=await store.load({cold:true});
      if(!saved||!this.ready()||lifecycle!==this.storage.lifecycle||!same(saved,this.baselineLedger))fail('source-changed');
      const raw=await encodeFullSnapshotBackup(saved,{password,dataClass:this.dataClass});
      lifecycle.engine.assertVerifiedBaseline(store.base);
      if(!this.ready()||lifecycle!==this.storage.lifecycle)fail('reconnect-required');
      return raw;
    });
  }
  async importBackup(raw,{password}={}){
    if(this.busy||this.storage.lifecycle)fail('release-before-preview');
    return this.operation(async()=>{
      // The archive class must match this session before any preview changes.
      const ledger=await decodeFullSnapshotBackup(raw,{password,dataClass:this.dataClass});
      if(this.storage.lifecycle)fail('release-before-preview');
      // Validation completes before replacing any in-memory preview.
      this.ledger=structuredClone(ledger);this.baselineLedger=structuredClone(ledger);this.mode='preview';this.store=null;this.dirty=false;this.unverified=false;this.needsReopen=false;this.stagedHistory=[];this.savedEventCount=ledger.events.length;
      this.pendingSave=null;this.recoveryOutcome=null;this.restoreExpected=null;this.restoreFolderId=null;this.backupPreview=true;this.backupSource=structuredClone(ledger);
      return this.ledger;
    });
  }
  async #verifyRestoredCopy(){
    const expected=this.restoreExpected;
    if(!expected||this.storage.lifecycle?.folderId!==this.restoreFolderId)fail('verified-backup-required');
    this.unverified=true;this.needsReopen=true;
    try{
      await this.storage.reopenIndependent();
      const lifecycle=this.storage.lifecycle,store=this.storage.createLedgerStore(),actual=await store.load();
      if(!this.ready()||lifecycle!==this.storage.lifecycle||!same(actual,expected)||!same(reportContents(actual),reportContents(expected)))fail('restore-verification-mismatch');
      this.store=store;this.ledger=actual;this.baselineLedger=structuredClone(actual);this.mode='saved';this.dirty=false;this.unverified=false;this.needsReopen=false;this.backupPreview=false;this.backupSource=null;this.restoreExpected=null;this.restoreFolderId=null;this.pendingSave=null;this.savedEventCount=actual.events.length;this.stagedHistory=[];
      this.#designateVerifiedFolder();
      return actual;
    }catch(error){this.unverified=true;this.needsReopen=true;this.recoveryOutcome='unverifiable';throw error;}
  }
  async restoreBackupToNewCopy(){
    if(!this.backupPreview||!this.backupSource||!same(this.ledger,this.backupSource)||this.storage.lifecycle||this.busy)fail('verified-backup-required');
    this.restoreExpected=structuredClone(this.backupSource);
    return this.savePreviewToNewCopy();
  }

  async recover({ stale = false } = {}) {
    return this.operation(async () => {
      this.invalidate();
      if (stale) await this.storage.recoverStaleSession();
      else {
        if (this.storage.lifecycle?.state !== 'recovery-required') fail('recovery-not-required');
        await this.storage.lifecycle.recover();
      }
      // Recovery never silently discards an unsaved proposal or retries it.
      this.needsReopen = true;
    });
  }

  async release() {
    if(this.restoreExpected&&this.restoreFolderId)fail('recovery-required');
    this.#assertNoUnknownPublication();
    return this.operation(async () => {
      this.invalidate();
      const result = await this.storage.release();
      if (result?.released !== true || this.storage.lifecycle) fail('release-unconfirmed');
      this.store = null; this.ledger = null; this.baselineLedger = null;
      this.stagedHistory = []; this.savedEventCount = 0;
      this.pendingSave = null; this.recoveryOutcome = null;
      this.backupSource = null; this.backupPreview = false;
      this.restoreExpected = null; this.restoreFolderId = null;
      this.mode = 'empty'; this.dirty = false; this.unverified = false; this.needsReopen = false;
      this.storage.accessToken = ''; this.storage.tokenExpiresAt = 0;
      return result;
    });
  }
}
