# Modern Stack Exploration

An isolated UI sandbox on `feature/modern-stack-exploration`, created from `main`.

## Open the prototype

Open `index.html` in a modern browser, or use the GitHub Pages branch-deployment workflow only when intentionally ready to make this public. This page is not linked from the main application.

## Prototype choices

- Tailwind CSS v4 official Play CDN: `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4`.
- Utility-first styling in HTML; no separate application stylesheet and no local compilation pipeline.
- Vanilla JavaScript in `js/modern-dashboard.js`, organized as small IIFE modules (`SampleData`, `Format`, `ActivityList`, `DashboardControls`, `App`).
- Obsidian palette, restrained neon-cyan/violet accents, thin luminous borders, and responsive dashboard layout.
- All balances, charts, and activity are invented visual fixtures. No real financial data, credentials, integrations, or persistence are present.

## Important limitation

Tailwind's official Play CDN is a development/prototyping tool, not a recommended production delivery method. It compiles styles in the browser and has runtime/performance trade-offs. This branch intentionally tests the no-build experience; it does not establish the production styling strategy.

## Scope boundary

This directory is self-contained. It does not replace or modify the current application entry point, existing CSS, application JavaScript, data pipeline, storage code, service worker, workflows, or GitHub Pages configuration.
