# ADR-0007: Tailwind CSS entry at package root (`pmo-portal/index.css`) until the `src/` migration

- **Status:** Accepted
- **Date:** 2026-06-03
- **Relates to:** ADR-0004 (Tailwind via Vite); `docs/specs/target-architecture.spec.md` §3.1, §10, §13
  (Phase 0 vs Phase 1); Issue #1 plan `docs/plans/2026-06-03-build-foundation.md`.

## Context
ADR-0004 adopts `@tailwindcss/vite` with a real CSS entry and illustratively names it `src/index.css`,
because the §3.1 target tree introduces a `src/` root. Issue #1 (Phase 0: de-cruft + foundation) is
**behavior-preserving** and explicitly excludes the `src/` layout migration — the app entry is still
`pmo-portal/index.tsx` at the package root. Placing the CSS at `src/index.css` now would either require a
premature `src/` move or create a lone `src/` file detached from the rest of the tree.

## Decision
Create the Tailwind entry at **`pmo-portal/index.css`** (package root, beside `index.tsx`) and import it
from `index.tsx`. The §3.1 target (`src/index.css`) is honored later, in the Phase-1 `src/` migration
issue, when `index.tsx → src/main.tsx` and the rest of the tree move together.

## Consequences
- **Positive:** Keeps Issue #1 minimal and behavior-preserving; no orphan `src/` directory; the
  CSS-pipeline swap (ADR-0004) ships independently of the structural migration.
- **Negative:** A one-line relocation (`index.css` → `src/index.css`) plus its import path is deferred to
  the Phase-1 migration issue. Trivial and tracked.
- **Note:** The `@theme` token block and `darkMode: 'class'` behavior are identical regardless of file
  location, so this decision has no effect on output CSS or visual result.
