import {PagedCanonicalLedgerStore} from './canonical-paged-storage.mjs';
import {PAGED_CANONICAL_LAYOUT} from './paged-canonical-format.mjs';
export {CANONICAL_COLLECTIONS} from './canonical-history.mjs';

/** Application storage has one canonical representation. Reject unsupported
 * requests before touching storage rather than silently selecting a writer. */
export class CanonicalLedgerStore extends PagedCanonicalLedgerStore {
  constructor({lifecycle, cryptoImpl = globalThis.crypto, layout = PAGED_CANONICAL_LAYOUT}) {
    if (layout !== PAGED_CANONICAL_LAYOUT || !lifecycle?.pagedCanonical) {
      throw Object.assign(new Error('Only canonical v5 storage is supported. Select a new empty synthetic folder.'),
        {code: 'unsupported-canonical-layout'});
    }
    super({lifecycle, cryptoImpl});
  }
}
