import {canonicalizeJcs} from './transaction-protocol.mjs';
import {partitionDigest} from './canonical-partitions.mjs';

export const LEGACY_PAGED_CANONICAL_LAYOUT = 'partitions-v4';
export const LEGACY_PAGED_CANONICAL_VERIFIER = 'canonical-partitions-v4';
export const PAGED_CANONICAL_LAYOUT = 'partitions-v5';
export const PAGED_CANONICAL_VERIFIER = 'canonical-partitions-v5';
const profiles = Object.freeze([4,5].map(version => Object.freeze({version,layout:'partitions-v'+version,
  verifier:'canonical-partitions-v'+version,archiveProfile:'canonical'+version+'-physical4',migrationOperation:'migrate-legacy-v'+version})));
export function canonicalProfileForVerifier(verifier) {
  const profile = profiles.find(item => item.verifier === verifier);
  if (!profile) throw Object.assign(new Error('Unsupported canonical verifier.'),{code:'unsupported-canonical-profile'});
  return profile;
}
export function canonicalProfileForLayout(layout) {
  const profile = profiles.find(item => item.layout === layout);
  if (!profile) throw Object.assign(new Error('Unsupported canonical layout.'),{code:'unsupported-canonical-profile'});
  return profile;
}
export const EMPTY_CANONICAL_ROOT = Object.freeze({format:'finance-tracker-empty-canonical-root',version:1,syntheticOnly:true});
export const EMPTY_CANONICAL_BYTES = new TextEncoder().encode(canonicalizeJcs(EMPTY_CANONICAL_ROOT));
export const emptyCanonicalRootHash = () => partitionDigest(EMPTY_CANONICAL_BYTES);
export function isEmptyCanonicalRoot(value) { return canonicalizeJcs(value) === canonicalizeJcs(EMPTY_CANONICAL_ROOT); }
