# PR28: canonical import foundation

**Status: implemented for synthetic review; live acceptance remains outstanding.** The owner approved this five-part scope on November 6, 2026. PR26 supplies product decisions for this and subsequent work. PR20–25 supply the existing persistence, recovery, session, backup, and portability machinery.

## Included implementation

1. **Read the three documented CSV formats.** Parse Wells Fargo, SoFi, and Fidelity source shapes strictly; explicitly map accounts; preserve source fields, descriptions, original row positions, exact amounts, currencies, and distinct dates. Report malformed rows and distinguish a valid empty export from an unsupported file. The fixtures are invented and establish tested behavior, not provider-wide format guarantees.
2. **Keep identities and coverage trustworthy.** Allocate durable UUID identities. Fingerprint the original file bytes independently of its name. Store confirmed declared coverage separately from observed dates, import time, and completeness assessment. Require resolution of usable dates outside the declared period.
3. **Reconcile and review conservatively.** Prevent repeat imports and repeated event application while preserving genuinely separate transactions. Unique composite similarity is insufficient evidence for automatic identity matching. Preserve rejected and ambiguous observations and scoped, auditable review decisions, with safe append-only reversal when no later dependent work prevents it. Reevaluate unresolved imports without duplicating accepted effects.
4. **Preserve correction history and refund links.** Apply explicit classifications, category corrections, bank corrections, and evidence-backed refund links as events. Category corrections also create inspectable exact-match rules for future activity while leaving already-imported peers unchanged. Preserve original source facts. Calculate exact known subtotals with exclusions and qualifications; declared coverage alone never establishes a complete financial total.
5. **Connect import, review, save, and reopen.** A minimal invented-data workbench stages the changes locally and saves canonical records through the existing application lifecycle and catalog engine. Read-back and reopen verify the same records and financial meaning. Canonical records are individually partitioned so unchanged records reuse existing objects. Existing backup and restore mechanisms validate these records through a shared application validator, including copies with retained dashboard and canonical history.

## Acceptance criteria

- The three adapters preserve quoted/multiline descriptions, optional blanks, exact decimal text, account distinctions, source ordinals, and Fidelity header/footer boundaries. Unknown nonblank rows remain explicit failures or review evidence.
- Declared periods, observed dates, import times, and verification state remain distinct, including empty files and coverage gaps.
- Reimporting identical bytes in the same account/format context does not repeat financial effects. A renamed file is still identical. A needs-review attempt can be reevaluated without duplicating its accepted occurrences.
- Two legitimate identical-looking rows remain separate or explicitly reviewed, including two incoming rows against one prior candidate.
- Review decisions, evidence, corrections, links, and import counts survive save and reopen. Original observations are not rewritten to conceal corrections.
- Posted/pending transitions remain auditable. Explicit corrections affect the original effective period; linked partial refunds reduce spending in their posting period. Uncertain activity is qualified rather than guessed.
- Reports use exact arithmetic, preserve currency boundaries, and label known subtotals. Missing information never becomes zero or an unlabeled complete total.
- Interruption at every durable boundary exercised by the canonical payload restores either the full committed result or the unchanged prior state. Retrying after verified recovery does not repeat effects.
- Existing portable export/restore preserves canonical identity, record order, event history, and logical financial results while assigning new physical copy locators.
- The full Node regression suite and module syntax checks pass. Browser/device and live synthetic Drive acceptance are recorded separately from automated results.

## Safety and review gates

The workbench accepts only bundled invented fixtures and a dedicated synthetic folder. Production data remains disabled under the PR27 gate. The accepted single-active-device model, offline-write prohibition, $0 recurring-cost constraint, privacy rules, and separate 540-day original-source policy remain in force. Original-file retention is reported honestly and is not inferred from a successful canonical commit.

Implementation, automated verification, live acceptance, and owner approval are distinct states. PR28 stays draft until its final evidence and remaining limitations have been reviewed. No merge, deployment, or production activation is authorized by these implementation changes.
