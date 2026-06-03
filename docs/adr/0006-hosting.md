# ADR-0006: Hosting & deployment target

- **Status:** Proposed / Deferred (owner decides at deploy time)
- **Date:** 2026-06-03
- **Relates to:** `docs/specs/target-architecture.spec.md` §12; `product-expectations.md` Part C
  (owner approves production deployment + irreversible infra).

## Context
The charter treats DevOps/deployment as **aspirational** for MVP (`product-expectations.md` Part A —
DevOps; Part C — owner approves production deployment). We need a documented target so foundations
(env-var config, `BrowserRouter` SPA rewrites, CI gates) are built compatibly, without committing the
owner to a host or incurring infra cost prematurely.

## Decision (proposed, not yet ratified)
- **Frontend SPA:** Vercel **or** Netlify — static hosting + SPA history-fallback rewrite (required by
  `BrowserRouter`, spec §10). Both give preview deploys per PR and zero-config Vite builds.
- **Backend:** **Supabase Cloud** (managed), separate projects per environment (dev/preview/prod).
- **Env:** `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` via host env vars; **no service-role key
  client-side**; `.env.local` git-ignored.
- **CI gates (block merge):** typecheck (0 errors), ESLint `--max-warnings=0`, Vitest (≥80% changed-line
  coverage), Playwright AC-### suite; migrations applied to a preview DB via Supabase CLI.
- **Monitoring (later):** Sentry + Supabase logs + uptime check — tracked, not MVP-blocking.

## Consequences
- **Positive:** Foundations built host-agnostically (env-var config, SPA rewrites) so the final host
  choice is low-cost; CI gates encode the charter's quality bar before any deploy.
- **Negative / open:** Final host, custom domain, and monitoring stack are **deferred** to the owner; this
  ADR is **Proposed** until then. Re-open and mark Accepted when the owner ratifies at deploy time.
