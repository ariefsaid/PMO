# ADR-0006: Hosting & deployment target

- **Status:** **ACCEPTED** (ratified + deployed 2026-06-11)
- **Date:** 2026-06-03 · **Ratified:** 2026-06-11
- **Relates to:** `docs/specs/target-architecture.spec.md` §12; `product-expectations.md` Part C
  (owner approves production deployment + irreversible infra). Operational detail: **`docs/environments.md`**.

## Ratified decision (2026-06-11) — what shipped
- **Frontend = Cloudflare Pages** (owner chose CF over Vercel/Netlify). Project `pmo`, live at
  `https://pmo-bfb.pages.dev`. Root dir `pmo-portal`, build `npm run build`, output `dist`, Node 22
  (`.node-version`), SPA history-fallback via `pmo-portal/public/_redirects`. **Production branch = `production`**;
  `main` + PRs = preview deploys; release by merging `main → production`.
- **Backend = Supabase Cloud**, ONE project (`prwccpsiumjzvnwjlkwq`) = **prod**; **local Docker = dev + test**.
  (Separate per-env cloud projects deferred until a real, data-bearing prod is needed — the current cloud is a
  demo/staging-grade prod with admin-only data.)
- **Secrets via 1Password (service account)**: the cloud DB URL is fetched at runtime by `op-get.sh` (vault `AS`),
  NEVER committed; the **anon key is public-safe** and lives in CF Pages env vars. No service-role key client-side.
  Connection string is the **Direct/Session-pooler URI (port 5432)**, never the transaction pooler (6543).
- **CI gates unchanged** (typecheck/lint/Vitest/pgTAP/Playwright; integration job PR-only); supabase CLI pinned 2.105.0.
- **Demo/observability:** `VITE_APP_ENV` env badge; `VITE_DEMO_MODE` login-credential panel (demo builds only).
  Monitoring (Sentry/uptime) still deferred.

## Context
The charter treats DevOps/deployment as **aspirational** for MVP (`product-expectations.md` Part A —
DevOps; Part C — owner approves production deployment). We need a documented target so foundations
(env-var config, `BrowserRouter` SPA rewrites, CI gates) are built compatibly, without committing the
owner to a host or incurring infra cost prematurely.

## Original proposal (2026-06-03 — superseded by the Ratified decision above; CF chosen over Vercel/Netlify, op for secrets)
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
- **Resolved 2026-06-11 (now ACCEPTED — see the Ratified decision above):** host = Cloudflare Pages,
  backend = one Supabase Cloud project, secrets via 1Password. **Still open:** custom domain + monitoring
  (Sentry/uptime) deferred; a *separate* per-env Supabase project only if/when a real data-bearing prod is
  needed (today's cloud is a demo/staging-grade prod with admin-only data).
