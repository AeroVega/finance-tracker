import {canonicalizeJcs} from './transaction-protocol.mjs';
import {partitionDigest} from './canonical-partitions.mjs';

export const PAGED_CANONICAL_LAYOUT = 'partitions-v4';
export const PAGED_CANONICAL_VERIFIER = 'canonical-partitions-v4';
export const EMPTY_CANONICAL_ROOT = Object.freeze({format:'finance-tracker-empty-canonical-root',version:1,syntheticOnly:true});
export const EMPTY_CANONICAL_BYTES = new TextEncoder().encode(canonicalizeJcs(EMPTY_CANONICAL_ROOT));
export const emptyCanonicalRootHash = () => partitionDigest(EMPTY_CANONICAL_BYTES);
export function isEmptyCanonicalRoot(value) { return canonicalizeJcs(value) === canonicalizeJcs(EMPTY_CANONICAL_ROOT); }
