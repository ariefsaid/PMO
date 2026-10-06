# Product-expectations audit: caching and backend (2026-10-06)

**Question (owner):** does the app need caching, or other backend work? Audited against
`docs/product-expectations.md`.

## Verdict

- **No server-side cache is needed.** No materialized view, Redis, cache table or edge-function HTTP caching
  solves a problem a user has today. The dashboard and projection RPCs are index-backed and fast.
- **The real cost is the browser over-fetching.** Every cold page load fetches 8 full, unpaged lists just to
  label the breadcrumb. Detail pages load whole org-wide lists and then filter them in the browser. No list
  screen pages through its data.
- **The only cheap caching win is static assets.** Cloudflare serves the hashed JS/CSS with
  `max-age=0, must-revalidate`, so every visit revalidates about 14 files. Marking them immutable is a
  one-file change.
- **The scale ceiling sits in the database.** The RLS helper functions are called once per row instead of once
  per query. That costs about 20 µs per row, roughly 80× the hoisted form. Users won't notice at first-client
  scale. Fix it before any table reaches about 10k rows per org.
- **Ops gaps that matter before client #1:** nobody has run a restore drill, uptime monitoring isn't
  confirmed, and some edge-function outbound calls have no timeout.

## Method and scope

- **Main checkout read on `dev` (2026-10-06).** Tests, e2e and DB reset were not run.
- **Local database, read-only.** Plans came from `EXPLAIN` as the `authenticated` role with seed claims. Per-row
  costs were timed by evaluating the policy helpers inside a 100k-row `generate_series`, with and without the
  `(select …)` hoist.
- **Bundle sizes** come from one `npm run build`. Production cache headers were read with `curl -I`.
- **Seed data is tiny** (the largest table has 117 rows), so all growth figures below are projections from the
  measured per-row costs.
- **Not covered:** this pass does not re-audit security posture, loading/empty/error states or a11y depth. Each
  issue's 3-reviewer battery and the Discover pass own those. They are marked UNVERIFIED below, not MET.

## Expectations table

Line numbers refer to `docs/product-expectations.md`.

| # | Expectation (quote, line) | Status | Evidence |
|---|---|---|---|
| E1 | "caching strategy" (L41) | PARTIAL | **Client cache: decided and built.** ADR-0005 sets it; `pmo-portal/src/lib/queryClient.ts:4-8` uses staleTime 30s, gcTime 5m, no refetch on focus, and org settings use `Infinity`. **No server or HTTP strategy is written down.** **Static assets are not cached:** `pmo-portal/public/_headers:3-5` sets only frame headers, and production returns `cache-control: public, max-age=0, must-revalidate` on `/assets/*.js`. |
| E2 | "minimal … for 1 client, but scalable to … millions" (L43-44) | PARTIAL | **The tenancy seam and hot-path indexes are in place** (E10, E12). **Two patterns cap scale:** full-list loads (E5) and per-row RLS helper calls (E13). |
| E3 | "Identify: performance bottlenecks … unnecessary rendering … memory leaks" (L57-58) | PARTIAL | **Memory leaks: none found.** Every `setInterval`/listener is cleaned up (`NotificationBell.tsx:121-123`, `useAssistantPanel.ts:744-747`). **Bottlenecks:** see E5–E7 and E13. |
| E4 | Performance "aspirationally" (L54-55): a budget or measurement | UNMET | No `web-vitals`, Lighthouse, size-limit or `chunkSizeWarningLimit` in `pmo-portal/src`, `vite.config.ts`, `package.json`, `.github` or `scripts`. **First load preloads ~515 KB gzip across 14 files** (measured from `dist/index.html`). |
| E5 | "no N+1" / bounded reads (L99, L102) | PARTIAL | **The app shell loads 8 full lists plus saved views** to resolve breadcrumb names (`pmo-portal/App.tsx:228-252`). **Pagination helpers exist but no screen uses them.** `src/lib/pagination.ts:35` defines them, and no hook or page passes `pageSize`. **Project detail loads every project and every org-wide procurement**, then filters (`pages/project-detail/ProjectDetail.tsx:69,88-91`, `OverviewTab.tsx:230-232`, `ProcurementTab.tsx:46,55`). **Procurement detail runs one file query per quote or ledger row** (`VendorQuotesTab.tsx:382`, `LedgerFileCell.tsx:151`). **The notification inbox has no row limit** (`src/lib/db/notifications.ts:28-36`), while the 60s badge poll is a head-count (fine). |
| E6 | "expensive operations" (L58): over-fetch | PARTIAL | **`select('*')` on list reads:** `companies.ts:60`, `contacts.ts:45`, `incidents.ts:53`, `notifications.ts:32`. **`*` embeds on projects, procurements and tasks lists**; procurement detail embeds `*` from 10+ child tables (`procurementLifecycle.ts:164-189`). **Revenue-by-project totals every invoice in the browser** (`revenue.ts:284-298`). |
| E7 | "faster rendering" (L56): code splitting | PARTIAL | **Every route is `React.lazy`** (`App.tsx:68-95`), and exceljs (256 KB gz) loads on demand. **The boot preload still includes the recharts chunk (~103 KB gz)**, because a shared chunk imports from it, plus react-markdown through the always-mounted assistant panel. The main entry is 525 KB raw / 149 KB gz. |
| E8 | Frontend "loading states · empty states · edge cases · responsive · accessibility" (L65-66) | UNVERIFIED (out of scope) | The per-issue Discover pass and unit state tests own this. Not re-audited here. |
| E9 | Security "vulnerabilities · auth flaws · API weaknesses" (L79-80) | UNVERIFIED (out of scope) | Owned by `security-auditor` on every PR and by the post-deploy grant probes. |
| E10 | "RLS enabled on every business table" (L99, L154) | MET | Zero `public` tables without `relrowsecurity` at local head. Guarded by `supabase/tests/0001_rls_enabled.test.sql:17-34` and `0005_force_rls.test.sql`. Caveat: partitioned tables (`relkind='p'`) are not in the sweep. |
| E11 | Migration "reversible" (L99, L154) | PARTIAL | **9 down files for 232 migrations** (`supabase/migrations/rollback/`; down files became the norm from 0222). 28 migrations carry a reversal header comment. |
| E12 | "org_id tenancy seam present" + "indexes for hot paths" (L99) | MET (hot paths) / PARTIAL (FKs) | **Hot paths are indexed.** Policies filter on `org_id = auth_org_id()`, which plans as an index condition (EXPLAIN on `projects`: `Index Cond: (org_id = auth_org_id())`). Composite indexes cover projects (org,status / org,contract_value), procurements (org,status / project), timesheets (org,status,week), notifications (owner,created_at desc), audit (org,created_at desc). **61 FK columns have no leading-column index**, mostly `org_id` / `uploaded_by_id` on child tables. Those matter only when the parent is deleted, which is rare and soft-archive-first. **Duplicate indexes:** `agent_events (run_id,seq)` ×2 and `timesheets (user_id,week_start_date)` ×2. |
| E13 | RLS predicate cost (L102: "performance — DB query-plans") | PARTIAL | **The helpers are `STABLE SECURITY DEFINER`** (`auth_org_id` 72 tables, `is_active_member` 70, `auth_role` 47, `org_feature_enabled` 20). **They are called bare, so the planner evaluates them per row** (`Filter: is_active_member()`). **Measured per row:** `is_active_member()` 12.7 µs, org + member 19.8 µs, `org_feature_enabled` 25 µs. The hoisted `(select is_active_member())` costs 0.16 µs. **Only 15 policies use the hoisted form.** Permissive `ALL` write policies are OR'd into SELECT, which can double the per-row work. |
| E14 | "monitoring/logging" (L84) | PARTIAL | **Errors are reported.** Front end: PostHog exceptions (`src/lib/analytics/client.ts:317-324`, `ErrorBoundary.tsx:41`). Edge functions: `serveWithErrorReporting` sends to console, PostHog and `error_events`, and Telegram drains `error_events`. **`health` checks nothing:** no DB or downstream (`supabase/functions/health/index.ts:16-30`). **Uptime monitors exist only as an unticked checklist** in `docs/environments.md`. |
| E15 | "improve reliability · reduce downtime risks" (L84) | PARTIAL | **ERPNext and LLM calls are well behaved:** ERPNext has 120s aborts and idempotent-only retries (`adapterSeam/erpnext/client.ts:99,247,271`); the LLM call has 30s aborts with backoff (`_shared/openRouterModelClient.ts:13-20`). **No timeout on:** the shared ClickUp client (`adapterSeam/clickup/client.ts:66-72`), Graph token/proxy calls, Telegram, the heartbeat, and the `external-lists`/`external-link`/`external-connect` ClickUp walks. **pg_cron → pg_net ticks set no timeout.** No frontend rollback procedure is documented. |
| E16 | Data backup / restore | PARTIAL | **Policy:** daily managed backups, 7-day retention, no point-in-time recovery (ADR-0047 L34). **Runbook exists** (`docs/runbooks/restore-drill.md`), but its results table is empty and no drill is recorded. |
| E17 | "CI/CD pipeline" (L86, L105) | MET | `.github/workflows/ci.yml`: `verify` (typecheck, lint, unit + changed-lines coverage, build, Deno checks), `pgtap`, and `integration` for PRs to `main`. Production promote is manual by design. |
| E18 | Coverage ≥80% on changed code (L111) | MET | `scripts/changed-lines-coverage.mjs --min 80` in ci.yml:139-151. Edge functions are outside the coverage include list. |
| E19 | Typecheck / ESLint `--max-warnings=0` (L114-115) | MET | ci.yml:134,136. `pmo-portal/package.json:12`. |
| E20 | Layer-1 gates: a11y, visual regression (L101) | PARTIAL | **axe runs in vitest and in 3 e2e specs**, not app-wide. **The "visual" gate is assertion-based:** no `toHaveScreenshot` in `pmo-portal/e2e`. |
| E21 | "Storybook … introduced in Phase 3" (L151-152) | UNMET | No `.storybook` directory or Storybook dependency. |
| E22 | "Docker/Kubernetes setup · production deployment checklist" (L85-86) | PARTIAL (aspirational) | Managed Supabase + Cloudflare Pages, so no container is needed. Deploy steps live in sections of `docs/environments.md`, not in a single checklist. |

## Recommended improvements (ranked)

| # | Problem in user terms | Evidence | Size | Priority |
|---|---|---|---|---|
| R1 | Every visit and reload re-asks the CDN about ~14 unchanged JS/CSS files. On a slow office or mobile link that adds round-trips before the app paints. | E1: production `max-age=0` on hashed assets. | **S**: add `/assets/*  Cache-Control: public, max-age=31536000, immutable` to `public/_headers`, extend `test/securityHeaders.test.ts`, keep `index.html` revalidating. | **Now** |
| R2 | Opening a deep link (from a notification, Telegram or a bookmark) fires ~9 full-table queries before the page settles, just to name the breadcrumb. This cost grows with every project, company and contact. | E5: `App.tsx:228-252`. | **S–M**: resolve the crumb from the detail query's own record (or a single-row by-id read). Read cached lists only when present, never trigger them. | **Now** |
| R3 | A project page downloads the whole org's project and procurement lists. A procurement page fires one query per quote and per ledger row for files it already has. | E5. | **S** each: query by `project_id`, and reuse the files embedded in the detail query. | **Now** (cheap); required before scale |
| R4 | A hung ClickUp or Graph call stalls a sweep or a connect dialog until the platform wall-clock kills it. The org's sync watermarks don't advance, and the user sees a spinner with no error. | E15. | **S**: wrap `clickUpRequest` and the bare `fetch` calls with the existing `_shared/fetchWithDeadline.ts`. | **Now** |
| R5 | Nobody has proven the database can be restored, and nothing pages anyone if the app is down. | E14, E16. | **S** (owner-held): run the restore drill once; switch on the uptime monitor already listed in `docs/environments.md`; optionally make `health` do a cheap DB read. | **Before client #1** |
| R6 | Every list and RPC gets slower linearly with table size, because each row re-runs 2–4 membership lookups: ~0.2 s of DB CPU per 10k rows scanned, ~2 s per 100k. At first-client scale (hundreds of projects, low thousands of procurements) that is 10–60 ms and invisible. | E13 (measured). | **M**: one mechanical migration rewriting policies to `(select auth_org_id())` / `(select is_active_member())` / `(select auth_role())`, and splitting `ALL` write policies into INSERT/UPDATE/DELETE so they stop OR-ing into SELECT. pgTAP RLS suites prove behaviour is unchanged. | **Before scale.** Trigger: any table >10k rows per org, or API p95 >300 ms. |
| R7 | List screens (procurement, timesheets/approvals, sales invoices, notifications inbox) download and sort every row in the browser. Payload and render time grow without bound. | E5, E6. | **M–L**: adopt the existing `pagination.ts` helpers per screen; move filter and sort server-side; replace `select('*')` with column lists on list reads. Start with the notification inbox, which is append-only and grows forever. | **Before scale.** Trigger: any list >2k rows or >1 MB payload. |
| R8 | First load ships charting and markdown code that a user who never opens a chart or the assistant still downloads (~515 KB gz total preload). | E4, E7. | **M**: lazy-load the assistant transcript renderer; stop the shared chunk from pulling in recharts; add a bundle-size budget in CI so it can't regress. | **Later** |
| R9 | Rolling back a bad migration means hand-writing SQL under pressure. | E11. | **Process**: keep requiring a down file per migration (already the norm since 0222). Don't backfill old ones. | **Later** |
| R10 | Index hygiene. | E12. | **S**: drop the 2 duplicate indexes. Index the FK `org_id` columns only if org deletion ever becomes a real operation. | **Later** |

## Not needed yet (and what would change that)

- **Materialized views or a cache table for dashboards.** `get_executive_dashboard` and `get_budget_projection`
  are `STABLE` invoker SQL with index-backed correlated sums (38 ms and 10 ms on seed). *Trigger:* dashboard
  p95 >500 ms after R6, or ERP-sourced figures that are expensive to recompute.
- **Redis or any external cache.** No read pattern is shared across users in a way that would amortise it.
  *Trigger:* thousands of concurrent users on the same org-wide aggregates.
- **HTTP caching on edge functions.** They are POST, auth-scoped or per-user. Caching would risk cross-user
  bleed for no gain.
- **Raising React Query `staleTime` globally or adding realtime.** The 30s default with mutation invalidation
  fits a tens-of-users org. *Trigger:* users report stale approvals or counts.
- **List virtualization.** It's unnecessary once R7 pages lists. Revisit only for a deliberately long
  on-screen table.
- **Read replicas or connection pooling changes.** No load signal.
- **Retention for `audit_events` and `notifications`.** Both are indexed on (owner/org, created_at desc). Paging
  (R7) makes their growth harmless. `error_events` already purges at 90 days. *Trigger:* storage cost, or a
  data-retention policy from a client.
- **Locking the ClickUp webhook-worker claim with `SKIP LOCKED`.** It is a select-then-update claim, so two
  overlapping ticks could pick the same row. That only matters if a tick runs longer than 1 minute and the apply
  is not idempotent. *Trigger:* duplicate-apply evidence in `error_events`, or webhook volume high enough for
  ticks to overlap.
- **Memoising the per-row vault read in the webhook worker.** That's 25 reads per tick at most. *Trigger:*
  sustained high webhook volume.
