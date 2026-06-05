# PMO Portal — backlog & decisions (as of 2026-06-04)

Status snapshot after the autonomous build run. 9 issues shipped & merged to `main` (PRs #1–#9).
This file is the durable record of what's next; it is NOT loaded as session context (kept out of CLAUDE.md).

## Shipped (merged to main)
1. **#1** De-cruft + build foundation — removed AI Studio artifacts, real Tailwind-via-Vite, fixed a conditional-hooks crash, repo green, CI lint gate.
2. **#2** Supabase backend foundation — 16-table schema, 11 enums, `org_id` seam on every table, RLS + `auth_org_id()`/`auth_role()`, generic seed, pgTAP suite. (Security audit caught + fixed 2 HIGH + 2 MEDIUM tenancy holes.)
3. **#3** Auth — real Supabase Auth (password + magic link), session/role context, `RequireAuth`, BrowserRouter, Admin-only client-side impersonation (ADR-0008), credentialed dev seed.
4. **#4** Data-access layer + Projects list on real data (TanStack Query, `src/lib/db/*` template).
5. **#5** Procurement list on real data (seed enriched to 5 procurements).
6. **#6** Timesheets on real data (fixed hard-coded `CURRENT_USER_ID=1` + a timezone bug).
7. **#7** Executive Dashboard on real data via `get_executive_dashboard()` security-invoker RPC; removed the last mock bridge.
8. **#8** Performance — code-split bundle 1,041 KB → 211 KB entry + lazy routes/vendor chunks.
9. **#9** Security — `force row level security` on all 16 tables.

**State:** all 5 MVP module pages (Auth, Projects, Procurement, Timesheets, Dashboard) run on real Supabase data with RLS-enforced tenancy. typecheck/lint/unit(77)/build green; 22 e2e specs + 28 pgTAP tests pass against the local stack. Tenancy seam verified non-bypassable (cross-org reads/writes blocked).

## THE WALL — ✅ RESOLVED (2026-06-04) → see `docs/decisions.md`
All the write-wave business decisions are now locked in **`docs/decisions.md`**: OD-PROC (procure-to-pay
+ ERP audit + flat auth matrix), OD-TS (line-manager whole-timesheet approval), OD-BUDGET (Active-version
authority + committed-spend derivation + 7 fixed categories), OD-MARGIN (dual-lens weighted margin),
OD-SP-1/2/3 (pipeline membership, win-probabilities, dual win-rate + time filter + customer-contract-PO
decision date). Deferred-but-seamed: fine-grained role config, proposed-vs-final value variance, admin
config engine (OD-PROC-6). The wall is down — the write wave is unblocked.

## Build wave (post-decisions) — status
**Build order (dependency-driven):** Budget-versioning module → Procurement lifecycle → Sales-pipeline +
Dashboard-margin re-formula. (Margin needs Active-version budget; on-hand spend needs committed
procurement; pipeline/dashboard consume both.)
1. **Budget-versioning module** — ✅ BUILT on `feat/budget-versioning` (7 commits, `604ddc6..adeb1bd`).
   Spec `docs/specs/budget-versioning.spec.md` (signed off), plan `docs/plans/2026-06-04-budget-versioning.md`,
   ADR-0011 (security-definer mutation RPCs). 151 unit / 56 pgTAP / 1 e2e (AC-732) green; typecheck/lint/build
   clean. Reviews: spec-reviewer ✅ ship; code-quality fix-then-ship (Important coverage gaps fixed →
   100% on `budgets.ts`/`useBudget.ts`); security-auditor found + (re-verified) FIXED **HIGH-BV-1**
   (cross-tenant budget hijack via unguarded `budget_versions.project_id`) + LOW-BV-1 (trigger search_path).
   **Pending: owner approval to push + open PR.** PR #12 (old SalesPipeline) was closed — superseded.

## Non-blocked backlog (can proceed without owner; recommended order)
1. **ProcurementDetails read swap** — drill-down (procurement + items + quotations + documents) to real data. Moderate (4 child tables). Mirror of the list template.
2. **ProjectDetails decomposition + read swap** — split the 1,390-line god-file (baseline F-5) into per-tab components, then wire budgets/tasks/documents tabs to real data. Large; do decomposition first as its own issue.
3. **SalesPipeline + Dashboard-margin (rebuild)** — OD-SP-1/2/3 + OD-MARGIN now locked. PR #12 was **CLOSED** (superseded: old mislabeled margin, no win-prob config table, no `decided_at`/customer-PO anchor, no dual win-rate/time-filter). Rebuild fresh on the budget + procurement foundations: pipeline weighted value + projected margin, on-hand actual weighted margin, dual (count+value) win-rate with a time-frame filter, `pipeline_stage_config` lookup table (seeded defaults), `projects.customer_contract_ref`/`contract_date`/`decided_at` fields. (Old branch `feat/sales-pipeline` left on origin as reference.)
4. **CI e2e wiring** — run Playwright + Supabase in GitHub Actions (currently e2e runs locally only; CI runs typecheck/lint/unit/build). Flip CI lint already done.
5. **pgTAP in CI** — run `supabase test db` in CI. (Now load-bearing per ADR-0010: the integration band owns RLS/tenancy ACs — pgTAP must be a CI gate, not local-only. E2e suite shrank 22→7 files, so CI e2e wall-clock drops; wire e2e+pgTAP together.)
6. **Shared `<ListState>` component** — extract loading/empty/error markup duplicated across list pages; memoize list filters consistently (Procurement/Timesheets noted).
7. **Design system** — build `DESIGN.md` (design.md format) via gstack `/design-consultation`; adopt Storybook for the shared component library. (Owner-adjacent — design taste.)

## Tracked follow-ups / debt (from PR reviews)
- **Storage:** `supabase/config.toml` has `[storage]` + `[edge_runtime]` disabled (sandbox health-check issue). MUST re-enable for the documents feature; `procurement_quotations.file_url` / `procurement_documents.link` / `project_documents.file_path` have no bucket yet. Buckets must be private + RLS/`org_id`-pathed.
- **Auth prod cutover:** enable email confirmations (`enable_signup=false` + real SMTP); set `site_url`/redirect allowlist to HTTPS prod origin only; replace dev seed password `Passw0rd!dev`; `auto_expose_new_tables=false` before cloud deploy.
- **Per-role sub-dashboards** (Engineer/PM/Finance views in ExecutiveDashboard) still show some hard-coded figures (OD-D3) — swap to real data in their own issues.
- **Hosting** (ADR-0006 deferred) — pick Vercel/Netlify/Cloudflare + Supabase cloud project; production deploy needs owner approval (irreversible).
- **JWT role claim:** `auth_role()` reads `profiles.role` (authoritative); re-introducing the `app_metadata.role` JWT fast-path requires GoTrue signing + an audited sync trigger.
- **Budget module (from build-wave #1 reviews):** (a) `createBudgetVersion` computes `max(version)+1` client-side (TOCTOU race under concurrent "+New version"); move to a `create_budget_version` security-definer RPC like clone/activate. (b) Extract a shared `<LineItemTable readOnly>` in `ProjectBudget.tsx` (editor + read-only tables duplicate markup). (c) The project header **Budget MetricCard in `ProjectDetails.tsx` still reads the stale `projects.budget` header** — it becomes correct when the Projects/Dashboard margin re-formula issue derives budget from the Active version. Neither blocks the budget module.

## Run locally
- One-time: `claude plugin install superpowers@claude-plugins-official --scope project` (plugin); `scripts/vendor-skills.sh` (vendored skills); `cd pmo-portal && npm install`; `npx playwright install chromium`.
- Backend: `supabase start && supabase db reset` (seeds generic professional-services data + credentialed users; password `Passw0rd!dev`). Put the printed URL/anon key in `pmo-portal/.env.local`.
- App: `cd pmo-portal && npm run dev`. Gates: `npm run typecheck` · `npm run lint:ci` · `npm test` · `npm run build` · `npx playwright test` (stack up) · `supabase test db` (pgTAP).
