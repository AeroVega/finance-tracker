import {isMonthIndexPath} from './canonical-month-index.mjs';
import { CanonicalLedgerStore, CANONICAL_PREFIX } from './canonical-ledger-storage.mjs';
import { canonicalizeJcs } from './transaction-protocol.mjs';
import { createSyntheticFinancialYear } from './synthetic-financial-year.mjs';

const equal = (a, b) => canonicalizeJcs(a) === canonicalizeJcs(b);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const identity = (lifecycle, manifest) => ({ folderId: lifecycle.folderId, databaseId: manifest.databaseId, copyId: manifest.copyId });
const pristine = manifest => manifest.syntheticOnly === true && manifest.role === 'primary' &&
  manifest.revision === 0 && manifest.catalogFinalizationPending === null && Object.keys(manifest.snapshot || {}).length === 0;

/** The permission to create survives a recoverable failure only in this tab.
 * Nothing is saved in browser storage. After reload, existing copies can only
 * be verified; a failed/empty copy requires a new empty destination.
 */
export class SyntheticYearSeeder {
  constructor({ createRecipe = createSyntheticFinancialYear, onProgress = () => {}, layout = "fragments-v3" } = {}) {
    if (layout !== "fragments-v3") fail("unsupported-canonical-layout");
    this.layout = layout;
    this.createRecipe = createRecipe;
    this.onProgress = onProgress;
    this.recipe = null;
    this.freshIdentity = null;
    this.busy = false;
  }

  async preview() {
    if (!this.recipe) this.recipe = Promise.resolve().then(() => this.createRecipe());
    try { return await this.recipe; }
    catch (error) { this.recipe = null; throw error; }
  }

  // Call only after connect({ requireEmpty: true }) succeeds. Reopening an
  // existing empty ledger must never grant this permission.
  async admitFreshConnection(lifecycle) {
    this.freshIdentity = null;
    const manifest = await lifecycle.readManifest();
    if (!pristine(manifest)) fail('fresh-genesis-required');
    this.freshIdentity = identity(lifecycle, manifest);
  }

  async verifyOrSeed(lifecycle) {
    if (this.busy) fail('operation-in-progress');
    if (!lifecycle || lifecycle.state !== 'ready' || !lifecycle.acceptingWrites) fail('reconnect-required');
    this.busy = true;
    try {
      this.onProgress('preparing');
      const recipe = await this.preview();
      this.onProgress('checking');
      const store = new CanonicalLedgerStore({ lifecycle, layout: this.layout });
      const saved = await store.load();
      if (Object.keys(store.base.snapshot || {}).some(path => !path.startsWith(CANONICAL_PREFIX) && !isMonthIndexPath(path))) fail('unrecognized-seed-copy');
      if (saved) {
        if (!equal(saved, recipe.ledger)) fail('unrecognized-seed-copy');
        this.onProgress('verified');
        return { ...recipe, alreadySaved: true, storageLayout: store.layout };
      }
      if (!this.freshIdentity || !equal(identity(lifecycle, store.base), this.freshIdentity) || !pristine(store.base)) {
        fail('new-empty-folder-required');
      }
      this.onProgress('saving');
      await store.save(recipe.ledger);
      this.onProgress('reopening');
      // A new store independently verifies the committed graph, not a cache.
      const reopened = await new CanonicalLedgerStore({ lifecycle }).load();
      if (!equal(reopened, recipe.ledger)) fail('seed-readback-mismatch');
      this.onProgress('verified');
      return { ...recipe, alreadySaved: false, storageLayout: store.layout };
    } finally { this.busy = false; }
  }
}
