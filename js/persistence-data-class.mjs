// Header discrimination only. Recognizing the production class is NOT
// activation, authorization, or proof of data provenance. Whether a build may
// construct a production session is a release decision; see release-profile.mjs.
export const HISTORICAL_LEDGER_VERSION = 2;

const contracts = new Map([
  ['ledger', ['finance-tracker-canonical-ledger', [1, HISTORICAL_LEDGER_VERSION], 3]],
  ['manifest', ['finance-tracker-full-snapshot-manifest', [1], 2]],
  ['backup', ['finance-tracker-full-snapshot-backup', [1], 2]]
]);

export function persistenceDataClass(kind, value) {
  const contract = contracts.get(kind);
  if (!contract || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const [format, syntheticVersions, productionVersion] = contract;
  if (!Object.hasOwn(value, 'format') || value.format !== format || !Object.hasOwn(value, 'version')) return null;
  if (syntheticVersions.includes(value.version) &&
      !('dataClass' in value) && Object.hasOwn(value, 'syntheticOnly') && value.syntheticOnly === true) return 'synthetic';
  if (value.version === productionVersion &&
      !('syntheticOnly' in value) && Object.hasOwn(value, 'dataClass') && value.dataClass === 'production') return 'production';
  return null;
}
