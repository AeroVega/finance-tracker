# Product

<!-- impeccable:product-schema 1 -->

This is the short product record that design tooling loads before UI work. It points to the authorities instead of repeating them. [Product definition](PRODUCT_DEFINITION.md) owns scope and financial meaning, [current state](CURRENT_STATE.md) owns status and permissions, and [Design](DESIGN.md) owns the visual system. If this page disagrees with them, they win; correct this page.

## Platform

web

A static HTML, CSS and JavaScript app on GitHub Pages, with no framework or build step. iPhone and iPad Safari are the primary devices, including standalone Home Screen launch. Source: [AGENTS.md](../AGENTS.md#github-pages-and-mobile).

## Users

One owner, who is also the only user. They manage their own household finances: they import bank and brokerage CSV exports, review what the import could not settle, and check in weekly to see money in and out and what needs a decision. Source: [product definition](PRODUCT_DEFINITION.md) and [Design § Direction](DESIGN.md#direction).

## Product Purpose

A private personal finance tracker. It keeps one authoritative ledger of accounts and activity from file imports, with provenance, and shows income, spending, transfers, investments and net worth honestly. Success means the owner can trust the numbers: no silent duplicates, no fabricated history, and missing data never shown as zero. Source: [product definition](PRODUCT_DEFINITION.md).

## Positioning

Trust over automation. Categorization is deterministic and inspectable, and AI is never the default. Imports are files the owner provides, with no stored bank passwords or scraping. Recurring cost is $0. Data lives in the owner's own storage, never on a vendor server. Source: [AGENTS.md](../AGENTS.md#architecture-guardrails).

## Constraints

- Financial meaning is fixed by [Product definition § 4.4](PRODUCT_DEFINITION.md#44-financial-activity-and-reporting-semantics). Transfers are neither income nor spending. Pending activity is shown but left out of finalized totals. Refunds count in the month they post.
- Every staged change is append-only and auditable. Nothing saves until the owner chooses Save.
- The repository is public. Fixtures, screenshots and examples use invented data only.

## Voice

Plain, exact and honest. Qualifiers say what a number does and does not include. Labels name the action. Source: [Design § Direction](DESIGN.md#direction).
