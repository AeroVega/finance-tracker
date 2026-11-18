import { applyFinancialEvent, registerAccount, validateLedger, getEffectiveActivities, summarizeLedgerPeriods } from './canonical-import.mjs';
import { canonicalizeJcs } from './transaction-protocol.mjs';
import { applyPositionEvent, buildFinancialPosition } from './financial-position.mjs';

import {encodeFullSnapshotBackup,decodeFullSnapshotBackup} from './full-snapshot-backup.mjs';

const same=(a,b)=>canonicalizeJcs(a)===canonicalizeJcs(b);
const reportContents=ledger=>({activities:getEffectiveActivities(ledger),periods:summarizeLedgerPeriods(ledger,[...new Set(ledger.accounts.map(a=>a.currency))].sort().map(currency=>({start:'0100-01-01',end:'9999-12-31',currency}))),position:buildFinancialPosition(ledger,{asOf:'9999-12-31'})});
const fail = code => { throw Object.assign(new Error(code), { code }); };

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
  }

  invalidate() { if (this.mode === 'saved') this.needsReopen = true; }

  ready() {
    const lifecycle = this.storage.lifecycle;
    return Boolean(this.online() && lifecycle?.state === 'ready' && lifecycle.acceptingWrites);
  }

  canEdit() {
    if (this.busy || !this.ledger || this.unverified || this.recoveryOutcome==='not-saved') return false;
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
      this.invalidate();
      this.store = null;
      await this.storage.connect({ requireExisting: true });
      return this.loadVerified();
    });
  }

  async reopen() { return this.operation(() => this.loadVerified()); }

  preview(ledger) {
    if (this.busy || this.storage.lifecycle) fail('release-before-preview');
    validateLedger(ledger);
    if (ledger.syntheticOnly !== true) fail('synthetic-data-required');
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

  stageCheckpoint() {
    this.stagedHistory.push({ accounts: this.ledger.accounts.length, events: this.ledger.events.length,
      positionEvents: Object.hasOwn(this.ledger, 'positionEvents') ? this.ledger.positionEvents.length : null });
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
    const next = structuredClone(this.ledger);
    next.accounts = next.accounts.slice(0, previous.accounts);
    next.events = next.events.slice(0, previous.events);
    if (previous.positionEvents === null) delete next.positionEvents;
    else next.positionEvents = next.positionEvents.slice(0, previous.positionEvents);
    validateLedger(next);
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
    validateLedger(this.ledger);
    if (this.ledger.syntheticOnly !== true) fail('synthetic-data-required');
    const proposal = structuredClone(this.ledger);
    return this.operation(async () => {
      let store = null, writeStarted = false, writeVerified = false;
      try {
        await this.storage.connect({ requireEmpty: true, canonicalLayout: 'full-snapshot-v1' });
        const lifecycle = this.storage.lifecycle;
        if (!this.ready() || !lifecycle) fail('reconnect-required');
        const genesis = await lifecycle.readManifest();
        if (!lifecycle.fullSnapshot || genesis.syntheticOnly !== true ||
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
      this.pendingSave={proposal:structuredClone(this.ledger),base:structuredClone(this.baselineLedger),lifecycle:this.storage.lifecycle,priorSequence:this.storage.lifecycle.engine.saveAttempt?.sequence,folderId:this.storage.lifecycle.folderId};
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
      const evidence=lifecycle.engine.saveAttempt;
      if(!evidence||evidence.sequence===attempt.priorSequence)fail('verified-base-required');
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
    } catch {this.recoveryOutcome='unverifiable';}
    return {outcome:this.recoveryOutcome};
  }
  async resolveUncertainSave(){return this.operation(async()=>{
    const lifecycle=this.storage.lifecycle;
    if(((this.pendingSave&&lifecycle===this.pendingSave.lifecycle)||(this.restoreExpected&&lifecycle?.folderId===this.restoreFolderId))&&this.online()){
      try{lifecycle.transactionAdapter.assertMutationsSettled();await this.storage.refreshRecoveryAuthorization?.();if(lifecycle!==this.storage.lifecycle)fail('reconnect-required');if(!lifecycle.coordinator.canWrite)await lifecycle.coordinator.resume();}
      catch{this.unverified=true;this.needsReopen=true;this.recoveryOutcome='unverifiable';return {outcome:'unverifiable'};}
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
      const raw=await encodeFullSnapshotBackup(saved,{password});
      lifecycle.engine.assertVerifiedBaseline(store.base);
      if(!this.ready()||lifecycle!==this.storage.lifecycle)fail('reconnect-required');
      return raw;
    });
  }
  async importBackup(raw,{password}={}){
    if(this.busy||this.storage.lifecycle)fail('release-before-preview');
    return this.operation(async()=>{
      const ledger=await decodeFullSnapshotBackup(raw,{password});
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
      this.store = null;
      this.storage.accessToken = ''; this.storage.tokenExpiresAt = 0;
      return result;
    });
  }
}
