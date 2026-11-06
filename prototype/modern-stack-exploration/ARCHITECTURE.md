# Architecture Direction: Modern UI Exploration

**Status:** Exploration guidance; not yet an approved production architecture  
**Scope:** This prototype branch only  
**Production application:** Unchanged

## Purpose

This document records the technical direction discussed while evaluating the obsidian UI prototype. The goal is to use current, maintainable web-development practices without adopting framework or build complexity before it solves a real problem.

The familiar HTML, CSS, and JavaScript platform remains a modern foundation. The important choices are how the application is structured, tested, styled, and built for production.

## Agreed direction

### 1. Keep the prototype isolated

- Keep all exploration work under `prototype/modern-stack-exploration/` on `feature/modern-stack-exploration`.
- Do not connect this prototype to production data, credentials, storage, service workers, application entry points, or deployment configuration.
- Do not treat this branch as a production rewrite or merge it automatically. Review its value and scope before deciding whether to open a PR.

### 2. Use native JavaScript modules and reusable UI components

For a future application implementation, prefer browser-native ES modules (`import`/`export`) and small components with clear responsibilities.

A component should generally:
- receive the data and configuration it needs explicitly;
- create or update a focused piece of interface;
- keep its own presentation and relevant interaction behavior together;
- avoid owning financial business rules, persistence, or institution access.

Pages compose components into complete views. Shared components should be introduced when they provide genuine reuse or a clear boundary—not simply to make every HTML element its own abstraction.

The current prototype uses IIFE-based module-like namespaces in one JavaScript file. That is adequate for a self-contained visual experiment, but it is not the intended long-term module structure.

### 3. Establish a CSS design system around the obsidian direction

Retain the prototype's visual direction as the starting point:
- deep neutral/obsidian surfaces;
- restrained cyan and violet accents;
- subtle luminous borders and shadows;
- consistent spacing, typography, radii, and interaction states;
- responsive layouts that work well on phone and tablet.

Centralize recurring visual values as design tokens (for example, CSS custom properties and/or the Tailwind theme), rather than allowing each component to invent its own colors and spacing.

Tailwind CSS remains a candidate for authoring styles, but the official Play CDN is for experimentation, not production delivery. A production implementation should generate its CSS ahead of time and ship the resulting static stylesheet. The exact build mechanism can be selected when the application is ready to adopt one.

### 4. Keep financial domain logic independent of the interface

Maintain clear boundaries between:

- **Presentation:** pages, navigation, forms, tables, charts, and reusable UI components.
- **Application/domain logic:** ledger behavior, transaction identity and matching, reconciliation, classification, account rules, and financial calculations.
- **Infrastructure:** CSV parsing and import orchestration, file persistence, Google Drive communication, and any authorized institution integrations.

The interface may request and display results, but it should not implement authoritative financial rules. Domain logic should be testable without rendering a page or connecting to Google Drive. Infrastructure should translate external data into well-defined inputs and outputs for the application.

This separation is especially important for correctness, auditability, and safe handling of imported financial records.

### 5. Add production tooling when it earns its keep

Do not add a build pipeline solely for this visual experiment. When the prototype is being considered for integration into the real application, evaluate a lightweight build tool such as Vite for local development, module handling, CSS compilation, and production optimization.

Keep the output compatible with static hosting on GitHub Pages. A build tool does not imply a server, paid hosting, or a recurring service. Preserve the project's $0 recurring operating-cost constraint.

### 6. Revisit TypeScript before the domain grows substantially

TypeScript is worth evaluating before the financial domain becomes large. Its type system could help make distinctions explicit—for example, between monetary minor units, formatted currency strings, source dates, posted dates, account identifiers, and import outcomes.

This is a revisit point, not a commitment to migrate immediately. First establish clear module boundaries and data contracts; then assess whether TypeScript's additional tooling and maintenance cost are justified. Avoid a late, rushed conversion after many modules depend on loosely defined JavaScript data shapes.

## Deliberate non-goals for this branch

- No React, Vue, Svelte, or other UI framework decision.
- No immediate TypeScript migration.
- No production build pipeline or production CSS bundle.
- No real financial data, imports, account connections, or persistence.
- No changes to the existing production application or its deployment.

## Decision principle

Prefer the simplest architecture that preserves clear boundaries, testability, and a credible path to growth. Adopt additional tooling when it addresses a demonstrated need—not merely because it is fashionable or available.
