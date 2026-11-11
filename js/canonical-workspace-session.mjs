import { CanonicalLedgerStore } from './canonical-ledger-storage.mjs';
import { applyFinancialEvent, registerAccount, validateLedger } from './canonical-import.mjs';
import { canonicalizeJcs } from './transaction-protocol.mjs';
import { applyPositionEvent } from './financial-position.mjs';

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
  }

  invalidate() { if (this.mode === 'saved') this.needsReopen = true; }

  ready() {
    const lifecycle = this.storage.lifecycle;
    return Boolean(this.online() && lifecycle?.state === 'ready' && lifecycle.acceptingWrites);
  }

  canEdit() {
    if (this.busy || !this.ledger || this.unverified) return false;
    if (this.mode === 'preview') return true;
    return Boolean(this.ready() && !this.needsReopen && this.store?.base && this.store.lifecycle === this.storage.lifecycle);
  }

  canSave() { return this.mode === 'saved' && this.dirty && this.canEdit(); }
  canUndo() { return this.canEdit() && this.stagedHistory.length > 0; }
  canRevertAll() { return this.canUndo(); }

  updateDirty() {
    this.dirty = Boolean(this.baselineLedger && canonicalizeJcs(this.ledger) !== canonicalizeJcs(this.baselineLedger));
  }

  async operation(callback) {
    if (this.busy) fail('operation-in-progress');
    this.busy = true;
    try { return await callback(); } finally { this.busy = false; }
  }

  async loadVerified() {
    this.invalidate();
    if (!this.ready()) fail('reconnect-required');
    const lifecycle = this.storage.lifecycle;
    const store = new CanonicalLedgerStore({ lifecycle });
    const ledger = await store.load();
    if (!ledger) fail('canonical-ledger-required');
    if (lifecycle !== this.storage.lifecycle || !this.ready()) fail('reconnect-required');
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
    if (this.mode !== 'preview' || !this.ledger || this.busy || this.unverified || this.storage.lifecycle) {
      fail('verified-preview-required');
    }
    validateLedger(this.ledger);
    if (this.ledger.syntheticOnly !== true) fail('synthetic-data-required');
    const proposal = structuredClone(this.ledger);
    return this.operation(async () => {
      let store = null, writeStarted = false, writeVerified = false;
      try {
        await this.storage.connect({ requireEmpty: true, canonicalLayout: 'partitions-v5' });
        const lifecycle = this.storage.lifecycle;
        if (!this.ready() || !lifecycle) fail('reconnect-required');
        const genesis = await lifecycle.readManifest();
        if (genesis.syntheticOnly !== true || (lifecycle.pagedCanonical
          ? genesis.revision !== '0' || genesis.pending !== null || genesis.role !== 'primary'
          : genesis.revision !== 0 || genesis.catalogFinalizationPending !== null || Object.keys(genesis.snapshot || {}).length !== 0)) {
          fail('new-empty-folder-required');
        }
        store = new CanonicalLedgerStore({ lifecycle, layout: lifecycle.pagedCanonical ? 'partitions-v5' : 'fragments-v3' });
        const existing = await store.load();
        if (existing !== null || !store.base || canonicalizeJcs(store.base) !== canonicalizeJcs(genesis)) {
          fail('new-empty-folder-required');
        }
        if (!this.ready() || lifecycle !== this.storage.lifecycle) fail('reconnect-required');
        this.store = store;
        this.needsReopen = true;
        writeStarted = true;
        await store.save(proposal);
        writeVerified = true;
        if (!this.ready() || lifecycle !== this.storage.lifecycle) fail('reconnect-required');
        const verifier = new CanonicalLedgerStore({ lifecycle });
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
        return reopened;
      } catch (error) {
        const uncertain = writeStarted && (writeVerified || !store?.base);
        this.unverified = uncertain;
        this.needsReopen = uncertain;
        if (!uncertain) this.store = null;
        throw error;
      }
    });
  }

  async save() {
    if (!this.canSave()) fail('verified-draft-required');
    return this.operation(async () => {
      // A rejected or lost commit response is uncertain until verified reopen.
      this.needsReopen = true;
      try {
        const ledger = await this.store.save(this.ledger);
        if (!this.ready() || this.store.lifecycle !== this.storage.lifecycle) fail('reconnect-required');
        this.ledger = ledger; this.dirty = false; this.unverified = false;
        this.needsReopen = false;
        this.baselineLedger = structuredClone(ledger);
        this.stagedHistory = [];
        this.savedEventCount = ledger.events.length;
        return ledger;
      } catch (error) { this.unverified = true; throw error; }
    });
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
