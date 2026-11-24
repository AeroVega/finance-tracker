// Header discrimination only. A recognized future class is NOT a supported
// format, activation, authorization, or proof of data provenance.
export const HISTORICAL_LEDGER_VERSION = 2;

const contracts = new Map([
  ['ledger', ['finance-tracker-canonical-ledger', [1, HISTORICAL_LEDGER_VERSION], 3]],
  ['manifest', ['finance-tracker-full-snapshot-manifest', [1], 2]],
  ['backup', ['finance-tracker-full-snapshot-backup', [1], 2]]
]);

export function persistenceDataClass(kind, value) {
  const contract = contracts.get(kind);
  if (!contract || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const [format, legacyVersions, reservedVersion] = contract;
  if (!Object.hasOwn(value, 'format') || value.format !== format || !Object.hasOwn(value, 'version')) return null;
  if (legacyVersions.includes(value.version) &&
      !('dataClass' in value) && Object.hasOwn(value, 'syntheticOnly') && value.syntheticOnly === true) return 'synthetic';
  if (value.version === reservedVersion &&
      !('syntheticOnly' in value) && Object.hasOwn(value, 'dataClass') && value.dataClass === 'production') return 'reserved-production';
  return null;
}
