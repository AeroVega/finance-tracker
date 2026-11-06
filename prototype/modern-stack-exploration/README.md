# Modern Stack Exploration

An isolated UI sandbox on `feature/modern-stack-exploration`, created from `main`.

## Open the prototype

Open `index.html` in a modern browser, or use the GitHub Pages branch-deployment workflow only when intentionally ready to make this public. This page is not linked from the main application.

## Prototype choices

- Tailwind CSS v4 official Play CDN: `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4`.
- Utility-first styling in HTML; no separate application stylesheet and no local compilation pipeline.
- Vanilla JavaScript in `js/modern-dashboard.js`, organized as small IIFE module-like namespaces (`SampleData`, `Format`, `ActivityList`, `DashboardControls`, `App`).
- Obsidian palette, restrained neon-cyan/violet accents, thin luminous borders, and responsive dashboard layout.
- All balances, charts, and activity are invented visual fixtures. No real financial data, credentials, integrations, or persistence are present.

## Architecture direction

The agreed exploration direction is documented in [ARCHITECTURE.md](./ARCHITECTURE.md). In brief: keep this prototype isolated; use native JavaScript ES modules and reusable components for a future application; establish shared obsidian design tokens; keep financial domain logic independent from presentation and infrastructure; select production build tooling when integration is being considered; and revisit TypeScript before the domain grows substantially.

These are architectural guidelines for evaluation, not a decision to rewrite or merge the production application.

## Important styling limitation

Tailwind's official Play CDN is a development/prototyping tool, not a recommended production delivery method. It compiles styles in the browser and has runtime/performance trade-offs. This branch intentionally tests the no-build experience; it does not establish the production styling strategy. A production implementation should generate CSS ahead of time and ship the resulting static stylesheet.

## Scope boundary

This directory is self-contained. It does not replace or modify the current application entry point, existing CSS, application JavaScript, data pipeline, storage code, service worker, workflows, or GitHub Pages configuration.
