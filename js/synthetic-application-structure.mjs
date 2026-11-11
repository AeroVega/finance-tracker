import {isMonthIndexPath} from './canonical-month-index.mjs';
import { isSyntheticDashboardSnapshot } from "./dashboard-synthetic-storage.mjs";
import { CANONICAL_PREFIX, validateCanonicalSnapshot } from "./canonical-ledger-storage.mjs";

// The PR25 and PR28 workbenches may share a dedicated synthetic copy. Backup
// validates every retained snapshot against both known application payloads.
export function validateSyntheticApplicationSnapshot({ objects }) {
  if (!objects || typeof objects !== "object" || Array.isArray(objects)) return false;
  for (const [path, bytes] of Object.entries(objects)) {
    if (path.startsWith(CANONICAL_PREFIX)) continue;
    // These optional summaries are disposable derived state. Preserve their
    // exact bytes in backup, but rebuild malformed/stale values on canonical
    // reopen. They can never substitute for canonical financial evidence.
    if (isMonthIndexPath(path)) continue;
    if (path !== "synthetic/dashboard-transactions.json") return false;
    try {
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!isSyntheticDashboardSnapshot(value)) return false;
    } catch { return false; }
  }
  return validateCanonicalSnapshot({ objects });
}
