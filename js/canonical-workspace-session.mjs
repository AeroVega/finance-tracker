import { CanonicalLedgerStore } from './canonical-ledger-storage.mjs';
import { applyFinancialEvent, validateLedger } from './canonical-import.mjs';

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
    this.unverified = false; this.needsReopen = false; this.savedEventCount = ledger.events.length;
  }

  correct({ activityId, type, activityKind, categoryId, amountText, rationale }) {
    if (!this.canEdit()) fail('reopen-before-editing');
    if (typeof rationale !== 'string' || !rationale.trim()) fail('correction-rationale-required');
    if (!['classification', 'category-correction', 'bank-correction'].includes(type)) fail('unsupported-workspace-correction');
    const command = { activityId, type, commandId: crypto.randomUUID(), evidence: { rationale: rationale.trim() } };
    if (type === 'classification') command.activityKind = activityKind;
    if (type === 'category-correction') command.categoryId = typeof categoryId === 'string' ? categoryId.trim() : categoryId;
    if (type === 'bank-correction') command.amountText = typeof amountText === 'string' ? amountText.trim() : amountText;
    this.ledger = applyFinancialEvent(this.ledger, command);
    this.dirty = true;
    return this.ledger;
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
        this.needsReopen = false; this.savedEventCount = ledger.events.length;
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
