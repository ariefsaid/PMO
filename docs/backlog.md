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
Operating cadence: **mode A + Director-merge** (owner AFK) — autonomous spec→build→review→PR→merge;
owner gates = prod deploy + genuinely-new decisions only.
1. **Budget-versioning** — ✅ **MERGED (PR #13, `a17a2e9`).** ADR-0011 (security-definer mutation RPCs).
   151 unit / 56 pgTAP / 1 e2e. Security found+fixed+re-verified HIGH-BV-1 (cross-tenant budget hijack) + LOW-BV-1.
2. **Procurement lifecycle** — ✅ **MERGED (PR #14, `eb91b5e`).** ADR-0012 (`transition_procurement` security-definer
   RPC: map + role×transition matrix + SoD + ref-number minter; `procurement_receipts`/`procurement_invoices`).
   213 unit / 93 pgTAP / 1 e2e (AC-816 full Draft→Paid). Security found+fixed+re-verified HIGH-1 (minter callable
   cross-org → revoked internal-only). (PR #12 old SalesPipeline closed — superseded.)
3. **Timesheet submit/approve** — ✅ **MERGED (PR #15, `f12c934`).** `transition_timesheet` RPC (ADR-0012 pattern),
   `manager_id` + RLS read-widening, line-manager approval + Admin/Exec fallback, SoD (no self-approve incl Admin).
   232 unit / 113 pgTAP / 1 e2e (AC-911). Security found+fixed+re-verified HIGH-TS-1 (null-manager SQL 3-valued
   fall-through → any member could approve), MED-TS-2 (direct-UPDATE RPC bypass), LOW-TS-3 (self-writable manager_id).
4. **Projects: status-transitions + revenue fields** — ✅ **MERGED (PR #16, `3d899ce`).** `transition_project` RPC
   (win-capture requires customer-contract-PO+date, stamps `decided_at`), `pipeline_stage_config` (seeded win-probs),
   revenue columns. 247 unit / 140 pgTAP / 1 e2e (AC-1011). Security: no HIGH; MED-PR-1 (direct-UPDATE bypass of
   the RPC) fixed via revoke-then-regrant (status/decided_at/customer cols are RPC-definer-only).
5. **Sales-pipeline + Dashboard margin re-formula** — ✅ **MERGED (PR #17, `23f3b6d`).** ADR-0014. Replaced the
   mislabeled `avg_gross_margin` with the OD-MARGIN dual-lens model: 3 security-invoker read RPCs
   (`get_executive_dashboard` re-formula + `get_win_rate(from,to)` + `get_sales_pipeline`); Exec Dashboard dual-lens
   tiles + win-rate widget (count/value toggle + period selector); SalesPipeline rebuilt on real data. 261 unit /
   172 pgTAP / 1 e2e (AC-1117). pgTAP asserts the worked-example **oracle** exactly (on-hand margin 0.949375,
   pipeline weighted 800k, projected 0.200, win-rate 2/3 + 0.9249). Security: **no HIGH/Med** (all invoker, cross-tenant
   verified with live org-B fixture, anon revoked). FIRST issue with zero HIGH — no definer-bypass surface.

## ✅ WRITE-CAPABLE MVP COMPLETE (2026-06-04)
All 5 write-wave issues merged (PRs #13–#17), `main` @ `23f3b6d`. The portal now does real procure-to-pay,
budget versioning, timesheet submit/approve, project win/loss with revenue capture, and a dual-lens
margin/win-rate/pipeline dashboard — all RLS-tenant-safe, every business rule traced to `docs/decisions.md`.
Cumulative on main: ~261 unit · 172 pgTAP (44 files) · curated e2e journeys · typecheck/lint/build green.
Each issue ran the full SDD→TDD→BDD loop; the security gate caught + fixed a real HIGH on 3 of 4 definer-RPC
issues (all missed by unit+pgTAP+spec-review). **Next: production hardening (see follow-ups, esp. the
procurements_update transition-RPC bypass) → hosting/deploy (owner-gated, ADR-0006) → admin config engine (B2B).**

<details><summary>(superseded) original #5 design notes</summary>

   Spec `docs/specs/sales-pipeline-dashboard.spec.md` + plan `docs/plans/2026-06-04-sales-pipeline-dashboard.md`.
   Built as 5a (margin/win-rate RPC + dashboard) then A3 (`get_sales_pipeline`) + 5b (screen) — collapsed into one PR.
   Replaces the mislabeled `avg_gross_margin` with
   OD-MARGIN dual-lens; consumes budget (`get_project_budget`) + committed procurement spend + `pipeline_stage_config`
   + `decided_at`. **Worked-example KPI oracle** is in the spec (on-hand margin 94.9%, pipeline weighted value 800k,
   win-rate count 2/3 + value 92.5%) — pgTAP asserts those exact numbers. Seed task SPD-S1 reduces P002/P010 budgets
   so pipeline projected margin is non-trivial (0.200). **Checkpointed for a fresh-context session** (capstone too
   large to build well on this session's remaining budget). Resume: execute the plan from Phase 0.
</details>

## Non-blocked backlog (can proceed without owner; recommended order)
> Reconciled 2026-06-04 after the write wave. ✅ = shipped during #1–#5; the rest are genuinely open.
1. ✅ **ProcurementDetails read swap** — DONE in issue #2 (rewritten on real data + lifecycle actions).
2. ✅ **SalesPipeline + Dashboard-margin** — DONE in issue #5 (PR #17). (Old `feat/sales-pipeline` branch may still linger on origin — safe to delete.)
3. ✅ **pgTAP + e2e in CI** — DONE (PR #19, `18cfca5`). Added a parallel `integration` job (`supabase start` → `db reset` → `supabase test db` 45 files/180 tests → Playwright e2e); verified green on the real GitHub runner. ALSO fixed a latent failure it surfaced: the fast `verify` job had been **silently red** on missing `VITE_SUPABASE_URL` (CI has no `.env.local`) — made the unit suite hermetic via dummy Supabase env in `vite.config.ts` `test.env`. CI is now a trustworthy merge gate. **Going forward: watch the actual CI run on PRs, don't merge on local-green alone.**
4. **ProjectDetails decomposition + read swap** — `pages/ProjectDetails.tsx` is still the ~1,388-line mockData prototype (imports `projects/users/companies/procurements/timesheets/tasks/projectDocuments` from `data/mockData`). Split into per-tab components, then wire budgets/tasks/documents tabs to real data (budget tab already mounts the real `<ProjectBudget>`). Large; decomposition first.
5. **Per-role sub-dashboards on real data (OD-D3)** — `EngineerDashboard`/`PMDashboard`/`FinanceDashboard` in `ExecutiveDashboard.tsx` still read `data/mockData` (the only other mockData survivor). Wire to real per-role queries.
6. **Shared `<ListState>` component** — extract loading/empty/error markup duplicated across list pages; memoize list filters consistently.
7. **Design system** — build `DESIGN.md` (design.md format) via gstack `/design-consultation`; adopt Storybook for the shared component library. (Owner-adjacent — design taste.)

## Tracked follow-ups / debt (from PR reviews)
- **Storage:** `supabase/config.toml` has `[storage]` + `[edge_runtime]` disabled (sandbox health-check issue). MUST re-enable for the documents feature; `procurement_quotations.file_url` / `procurement_documents.link` / `project_documents.file_path` have no bucket yet. Buckets must be private + RLS/`org_id`-pathed.
- **Auth prod cutover:** enable email confirmations (`enable_signup=false` + real SMTP); set `site_url`/redirect allowlist to HTTPS prod origin only; replace dev seed password `Passw0rd!dev`; `auto_expose_new_tables=false` before cloud deploy.
- **Per-role sub-dashboards** (Engineer/PM/Finance views in ExecutiveDashboard) still show some hard-coded figures (OD-D3) — swap to real data in their own issues.
- **Hosting** (ADR-0006 deferred) — pick Vercel/Netlify/Cloudflare + Supabase cloud project; production deploy needs owner approval (irreversible).
- **JWT role claim:** `auth_role()` reads `profiles.role` (authoritative); re-introducing the `app_metadata.role` JWT fast-path requires GoTrue signing + an audited sync trigger.
- **Budget module (from build-wave #1 reviews):** (a) `createBudgetVersion` computes `max(version)+1` client-side (TOCTOU race under concurrent "+New version"); move to a `create_budget_version` security-definer RPC like clone/activate. (b) Extract a shared `<LineItemTable readOnly>` in `ProjectBudget.tsx` (editor + read-only tables duplicate markup). (c) The project header **Budget MetricCard in `ProjectDetails.tsx` still reads the stale `projects.budget` header** — it becomes correct when the Projects/Dashboard margin re-formula issue derives budget from the Active version. Neither blocks the budget module.
- **Procurement module (from build-wave #2 reviews):** (a) **transition-map drift guard** — `transition_procurement`'s legal-map + role matrix (SQL) and `procurementLifecycle.ts` `LEGAL_TRANSITIONS`/`allowedActions` (TS) are hand-maintained duplicates (SQL authoritative, TS cosmetic); add a sync test (or shared JSON fixture) before the matrix grows. (b) Extract a shared `formatDate` helper (dates formatted inline; `formatCurrency` already shared). Neither blocks.
- **Dashboard module (from build-wave #5 reviews):** (a) the on-hand + pipeline **status-set literals are duplicated across all 3 RPCs** in `0009_dashboard_margin.sql` (4+ occurrences) — extract a shared SQL helper (`on_hand_statuses()`/`pipeline_statuses()` or a `status_membership` table) before the taxonomy changes. (b) `SalesPipeline.tsx` re-filters projects O(5×N) per render — `useMemo` a single group-by-status. (Win-rate cache-key staleness was already fixed in the build.) Neither blocks.
- ✅ **SECURITY — transition-RPC direct-UPDATE bypass (MEDIUM, systemic): FULLY CLOSED across all 4 state machines.**
  Coarse `*_write` RLS let a 4-role insider directly `UPDATE` status-machine columns, bypassing the security-definer
  transition RPC (legal-map + SoD + capture/stamp). Fixed: timesheets (MED-TS-2, WITH CHECK status pin), projects
  (MED-PR-1, revoke-then-regrant), and **procurements** (PR #18, `2bd40c0`, migration `0010` — revoke-then-regrant
  locking `status`/`pr_number`/`po_number`/`approved_by_id`/notes + child doc-number cols to the definer RPCs; pgTAP `0045`).
- **Win-rate date filter (issue #5, OWNER-FLAG-1):** MVP ships period presets (All-time/YTD/Last quarter/Trailing
  12mo); the RPC takes arbitrary `p_from`/`p_to` so a custom date-range picker is a UI-only later add. Confirm at #5 sign-off if a custom picker is wanted in MVP.

## Run locally
- One-time: `claude plugin install superpowers@claude-plugins-official --scope project` (plugin); `scripts/vendor-skills.sh` (vendored skills); `cd pmo-portal && npm install`; `npx playwright install chromium`.
- Backend: `supabase start && supabase db reset` (seeds generic professional-services data + credentialed users; password `Passw0rd!dev`). Put the printed URL/anon key in `pmo-portal/.env.local`.
- App: `cd pmo-portal && npm run dev`. Gates: `npm run typecheck` · `npm run lint:ci` · `npm test` · `npm run build` · `npx playwright test` (stack up) · `supabase test db` (pgTAP).
