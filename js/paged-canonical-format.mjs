import {canonicalizeJcs} from './transaction-protocol.mjs';
import {partitionDigest} from './canonical-partitions.mjs';

export const PAGED_CANONICAL_LAYOUT = 'partitions-v5';
export const PAGED_CANONICAL_VERIFIER = 'canonical-partitions-v5';
const profile = Object.freeze({version:5,layout:PAGED_CANONICAL_LAYOUT,
  verifier:PAGED_CANONICAL_VERIFIER,archiveProfile:'canonical5-physical4'});
export function canonicalProfileForVerifier(verifier) {
  if (profile.verifier !== verifier) throw Object.assign(new Error('Unsupported canonical verifier.'),{code:'unsupported-canonical-profile'});
  return profile;
}
export const EMPTY_CANONICAL_ROOT = Object.freeze({format:'finance-tracker-empty-canonical-root',version:1,syntheticOnly:true});
export const EMPTY_CANONICAL_BYTES = new TextEncoder().encode(canonicalizeJcs(EMPTY_CANONICAL_ROOT));
export const emptyCanonicalRootHash = () => partitionDigest(EMPTY_CANONICAL_BYTES);
export function isEmptyCanonicalRoot(value) { return canonicalizeJcs(value) === canonicalizeJcs(EMPTY_CANONICAL_ROOT); }
