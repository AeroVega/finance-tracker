# PR #26 — Category Correction Rule Decision

**Status:** Owner-approved product behavior  
**Decision date:** 2026-11-05  
**Scope:** Record the narrow categorization behavior agreed during the PR #26 discussion. This is a decision record, not an implementation specification for the broader category system.

## Decision

When the user manually corrects a transaction's category, the correction must **automatically become a reusable deterministic categorization rule by default**.

The correction has two effects:

1. The currently corrected transaction reflects the category selected by the user.
2. The application creates or updates a rule so that future transactions matching the rule are categorized consistently.

The application must not require a separate confirmation or promotion step before learning the rule. This is the default behavior, not an optional prompt.

## Intended behavior and constraints

- Categorization is based on explicit, deterministic rules, not AI or probabilistic category prediction.
- The rule is derived from the user's explicit correction; the application should not infer a broader merchant or transaction pattern than the correction supports.
- Repeated matching transactions should receive consistent results from the applicable rule.
- Rules must remain inspectable and maintainable rather than becoming hidden learned behavior.
- The correction and resulting rule must respect the existing canonical-ledger requirements for auditable corrections and preservation of historical meaning. This decision does not authorize erasing or silently rewriting audit history.
- The detailed matching keys, rule representation, conflict resolution, precedence, editing interface, and rule lifecycle are engineering design matters unless they require a new user-visible product decision.

## Explicitly out of scope for PR #26

- AI-powered or confidence-scored category suggestions.
- Heuristic prediction of a category when no applicable rule exists.
- Designing the full category taxonomy, hierarchy, groups, labels, or category-management experience.
- Reopening the established category identity and historical-classification semantics.

Those broader category-system questions are parked for the PR #27 product-design discussion. Do not expand PR #26 into that discussion or implement the broader category-management system as part of this decision.

## Relationship to later work

PR #26 records the owner's narrow decision: **a manual category correction automatically creates or updates a reusable deterministic rule**.

PR #27 will address the broader category-management model and related product questions. The actual tracker implementation belongs in the engineering work planned for PR #28, guided by the settled decisions and existing canonical-ledger contracts.
