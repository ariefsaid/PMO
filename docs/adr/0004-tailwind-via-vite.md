# ADR-0004: Tailwind via the Vite plugin (remove CDN Tailwind + importmap)

- **Status:** Accepted
- **Date:** 2026-06-03
- **Relates to:** `docs/specs/target-architecture.spec.md` §10; baseline `F-12`, `NFR-012`.

## Context
The prototype loads Tailwind from `cdn.tailwindcss.com` via a `<script>` with inline config, carries a
dead `aistudiocdn` import-map, and references a non-existent `/index.css` (`baseline.spec.md F-12`,
`NFR-012`). CDN Tailwind is unviable for production: it violates strict CSP, adds a render-blocking
network dependency, breaks offline, and ships the full engine instead of purged CSS.

## Decision
Adopt **`@tailwindcss/vite`** (Tailwind v4 Vite plugin). `src/index.css` becomes the real Tailwind entry
(`@import "tailwindcss";`) plus the design tokens. **Remove** the CDN `<script>`, the `aistudiocdn`
import-map, and the dead `/index.css` reference from `index.html`. Port the existing **primary color
palette** from the prototype's inline CDN config into the token layer (preserve current look).

## Consequences
- **Positive:** Real purged CSS emitted at build (small, cacheable); CSP-safe; works offline; no
  render-blocking CDN; config lives in source under version control. Removes dead importmap/`index.css`
  cruft.
- **Negative:** Build now owns CSS generation (already the case via Vite); a one-time port of the inline
  palette into the token file. Tailwind v4 syntax differs slightly from v3 (`@import` vs directives) —
  documented in the migration phase.
