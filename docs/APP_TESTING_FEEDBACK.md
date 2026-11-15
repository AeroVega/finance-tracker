# Application testing feedback — historical record

This page preserves the original owner feedback and the v3-era reproduction/measurement context. Its format labels and implementation-state statements are historical and must not be used as current instructions.

## Current behavior

- Posting-status correction is part of the canonical workspace workflow. The authoritative event and editor behavior is [POSTING_STATUS_CORRECTIONS.md](POSTING_STATUS_CORRECTIONS.md).
- Save-request optimization and its measured limits are recorded in [ACTIVE_SAVE_REQUESTS.md](ACTIVE_SAVE_REQUESTS.md). Historical request counts are measurements of their named revisions, not current live Google timing guarantees.
- The application writes canonical v5. It does not offer a v3 or v4 new-copy path. Compatibility, refusal, provenance, and recovery rules live in [PARTITIONED_CANONICAL_STORAGE.md](PARTITIONED_CANONICAL_STORAGE.md).
- Current implementation, verification, and remaining owner acceptance are summarized in [CURRENT_STATE.md](CURRENT_STATE.md). The detailed dated evidence remains in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Preserved interpretation

The original feedback identified two user-facing problems: repeated edits could make saves feel slow, and posting-status warnings needed an auditable correction path. The application work addressed those problems through the real workspace rather than leaving them as isolated storage experiments.

The historical synthetic HTTP measurements demonstrated request amplification and improvement under controlled latency. They did not establish the cause of the owner's original multi-minute observation or guarantee a particular live Drive save time. Full history and integrity checks remain deliberate safety costs.

Use this record for rationale only. Do not revive obsolete v3/v4 labels, old seeder instructions, old test counts, or the original PR deployment state as current facts.
