# PR #26 — Financial Account Persistence Decision

**Status:** Owner-approved product behavior  
**Decision date:** 2026-11-05  
**Scope:** Record the requirement that recognized financial accounts persist independently of whether new institution imports continue.

## Decision

Financial accounts established in Finance Tracker are persistent entities. Once an account has been created or recognized and associated with the user's financial history, it must remain in the database even when the user stops importing data from that institution or account.

The absence of a new CSV import is not evidence that an account has been closed, deleted, or ceased to exist. The application must not automatically remove an account, erase its identity, or discard its historical association merely because imports stop.

## Intended behavior

- Preserve the account's identity and historical relationship to its transactions, balances, holdings, and other applicable records.
- Continue to make the account and its historical information available in the application when no recent import exists.
- Distinguish an account with stale or missing recent data from an account that is explicitly closed or otherwise inactive.
- Any future account closure, archival, deletion, or status-management behavior must be explicit and must preserve required historical integrity; it must not be inferred solely from import inactivity.

## Scope boundaries

This decision does not define the complete account model, account matching rules across imports, account status taxonomy, closure workflow, manual account creation experience, or detailed account-management interface. Those remain design/engineering questions and should be raised when the account model is discussed in the appropriate workstream.

This decision does not authorize deleting or rewriting canonical financial history, and it does not change the existing database identity, storage, retention, or production-readiness contracts.

## Relationship to later work

PR #26 records the owner's product requirement: **financial accounts persist even when the user stops importing from them**. The implementation must honor this invariant when the account model and account-management experience are designed and built.
