# PMO Portal — backlog & decisions (living doc; last updated 2026-06-09)

Status snapshot after the autonomous build run. 9 issues shipped & merged to `main` (PRs #1–#9).
This file is the durable record of what's next; it is NOT loaded as session context (kept out of CLAUDE.md).

## ▶ UX-NATURALNESS PROGRAM (interaction-design / IA / RBAC-gating — 2026-06-08/09)
Triggered by the owner: the prior audits checked *correctness* (tokens/RBAC/a11y), none checked *naturalness* (does the flow match human/convention expectations?). Two new **standing review lenses** were added to `docs/design-workflow.md` §2.3 (the 3-lens battery) + §3a (e2e encodes the natural journey, not the app's current shape): **IxD/task-flow** (Nielsen + cognitive-load + persona, via `impeccable critique`) and **IA/structure-navigation** (one-canonical-view-per-entity; Nielsen #4). Audits live in `review/*.md` (**`review/` is gitignored — local working scratch**; the durable backlog is HERE).

- **✅ Wave 1 — MERGED (`main`@688d125, PR #36).** Model B canonical project/opportunity lifecycle (**ADR-0020**: one `projects` record, one `/projects/:id` stage-adaptive lens, `/sales/:id` redirects, Projects/Pipeline disjoint partitions, lost-in-pipeline) + app-wide **write policy** (OD-UX-1: routine=single-click+toast, confirm only consequential/destructive — supersedes "confirm every write") + **timesheet Save+Submit** co-located (the owner's flagged flow) + **honest exec dashboard** (no contradictory margin, Board-pack disabled-coming-soon, Reports demoted) + **procurement state legibility**. FE-only, state machine untouched. 1329 unit · 332 pgTAP · 47 e2e. 3-lens rendered re-review + fixes. Deferred taste nits: Mark-as-Paid solid-green (vs One-Blue), 1440px stepper-node clip.
- **▶ Wave 2 — IN FLIGHT (branch `feat/ux-naturalness-wave2`).** RBAC view-gating + IxD naturalness. Plan `docs/plans/2026-06-09-ux-naturalness-wave2.md`; decisions **OD-W2-1..5** (decisions.md). **Part A (RBAC view-gating)** building: PipelineLens permission gate (the Wave-1-surfaced A7 risk — RLS-safe, FE-only), ApprovalsQueue `isApprover=true` hard-code fix, Engineer own-scoped procurement (OD-W2-1), Finance timesheet FE-gate, Documents author-check, shared access-denied/⌘K guard. Then **Part B (IxD)**: My-Tasks IC landing, +New-opportunity CTA, Finance approval queue, role-shaped nav, hover-only verbs surfaced, honest-disabled no-ops (OD-W2-5: /reports stub, remove bell, demote Sales Export), nav F4–F8. **Engineer-approval = FE-OFF for now** (OD-W2-2; `transition_timesheet` RPC unchanged — manager_id-authority dormant/reversible; configurable roles deferred to a future **admin settings / RBAC config engine**, the OD-PROC-6 bridge). Then security pass + 3-lens re-review + owner sign-off + PR.

### OUTSTANDING UX backlog (from `review/OUTSTANDING.md` triage — ~36 items; the durable copy)
After Wave 2, the remaining themes in priority order:
1. **Finance-timesheet SERVER write-hole** (`AC-W2-RBAC-011-RLS`) — RLS lets Finance persist an own-Draft timesheet entry; Wave-2 Part A gates the FE, the real fix is a server tightening (pgTAP, security-auditor). **Security follow-up.**
2. **Lifecycle rework dead-ends** — Rejected→Draft/Closed legal server-side but no UI (timesheets, documents); hidden Admin break-glass moves.
3. **Workflow dead-ends / silent failures** — 5-min stale FK pickers (mutations don't invalidate `fk-options`), silent numeric coercion to `0` (project value/line-items/quotes), optimistic delete with no rollback, dropped budget error codes, `path="*"`→dashboard.
4. **IxD Wave 3** — ~19 minors (hover-only 28px row actions, PM-dashboard missing loading/error state, off-palette cyan KPI tone, em-dash placeholders, incident date/type defaults, etc.).
5. **Mobile responsiveness** — UNANIMOUS across all 5 visual-journey audits, untouched by Wave 1: every data table clips at 375px, shell chrome truncates, ⌘K button ~2px. A dedicated responsive pass.
6. **Accessibility + design-system compliance** — outstanding WCAG items + token/contrast drift.
7. **Admin settings / RBAC config engine** (OD-PROC-6 bridge) — owner wants configurable roles + access (re-enables Engineer-approval etc.). Bigger feature.

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
issues (all missed by unit+pgTAP+spec-review). Production hardening since: **CI now gates pgTAP+e2e** (PR #19,
also fixed a silently-red verify job) and the **procurements_update SoD bypass is closed** (PR #18) — the
transition-RPC-bypass class is now shut on all 4 state machines. `main` @ `e95cf50`, PRs #13–#19 merged.

## ✅ UI POLISH round — COMPLETE (merged PR #29, `main`@8199782, 2026-06-07)
Post-IA-3 AI-slop cleanup + 4 owner directives. Audit `docs/reviews/2026-06-07-ui-slop-audit.md`; plans `docs/plans/2026-06-07-{ui-cleanup,shell-nav,confirm-mutations,thin-pages,budget-dropdown}.md`. Built sequentially on `feat/ui-polish` (49 commits), multi-lens reviewed, fixed, merged.
- **4 directives shipped:** (1) **removed the tabbed workspace** (nav = rail + breadcrumb + ⌘K; deleted provider/strip/store/grid-row); (2) **⌘K searches records** (open a project/PR/opportunity by name/code across the 3 cached lists, not just modules); (3) **budget-version dropdown restored** (one version at a time via labelled `<select>`); (4) **confirm-before-every-DB-write** (`ConfirmDialog` primitive on every mutation site; forward=popover, destructive=scrim modal; toast-on-resolve).
- **Transition-bug fix** (owner "clicked but status didn't change"): `error.code` preserved through `procurementLifecycle.ts`+`useProcurementDetail.ts`, classified `P0001`=illegal-stage / `42501`=not-permitted-SoD into clear toasts; Mark-as-Paid no longer offered to the request's approver (SoD-b). RPCs/migrations UNCHANGED. **OPEN owner decision (flagged):** the deeper root cause is impersonation-vs-real-JWT — client-only `effectiveRole` never re-issues the JWT, so the RPC authorizes against the real role. Symptoms fixed; architecture left for owner.
- **AI-slop cleanup:** de-rainbow charts, token-palette dots, differentiated pills, no-emoji placeholders, em-dash→concrete copy, mobile ≥44px touch targets, `DataTable role=row` a11y fix, ⌘K ranking de-duplicated, inverted OpportunityDetail action hierarchy.
- **BDD authoring rule made binding** (owner directive): tests model the user's journey to the goal + assert that goal; the app conforms to the test, never the reverse; on failure fix the app (or, for a deliberate UX change, update journey STEPS while keeping the goal-oracle). Documented in `CLAUDE.md` · `product-expectations.md` · `director-playbook.md` · `design-workflow.md` · `.claude/agents/qa-acceptance.md`.
- **Bundled pre-existing fix:** 3 sales-pipeline pgTAP oracles (0035/0036/0044) were red on `main` since PR #27 added P011 (950k Tender) without syncing the worked-example — recomputed to the true 3-deal pipeline (weighted 1,275,000; total 2,950,000; projected ≈0.1356; Tender count 2) + synced the spec. **Process note: CI's `integration` job is NOT a required check** (red pgTAP didn't block merges) — make it required so `main` can't drift red.
- **Verified green:** 733 unit · 180 pgTAP · 21 e2e · typecheck/lint/build · **CI green on the runner** (verify + integration). Open-Questions across the 5 plans resolved with recommended defaults (flagged in the PR).
- Follow-up chip: **bump GitHub Actions off deprecated Node 20** (checkout/setup-node/supabase-cli) before ~2026-06-16.

## ✅ APP-WIDE FE-CRUD + RBAC PROGRAM — COMPLETE (2026-06-08, `main`@ba04298; PRs #32/#34/#35)
The app went from view+lifecycle-only to **full create/edit/delete for every entity, RBAC-gated + RLS-enforced**, across a 3-layer (FE / repository-API / Supabase) seam. Plan `docs/plans/2026-06-07-crud-rbac-program.md`; design `docs/design/{crud-components,rbac-visibility}.md` + `docs/design-mockups/crud-*.html` (owner taste-gated).
- **Phase 0 (mockups):** design-architect→ui-implementer→design-reviewer loop; per-role HTML mockups + the role×affordance visibility map; owner-approved.
- **Phase 1 foundation (PR #32):** ADR-0016 `can()`/`usePermission`/`<CanWrite>` on the **real JWT role** + impersonation banner; ADR-0017 repository/API seam + shared `AppError`; ADR-0018 soft-archive (`archived_at`); form primitives (`EntityFormModal`/`useEntityForm`/`TextField`/`SelectField`/`Combobox`). **Also fixed app-wide: the 28px→32px control-scale bug** (`index.css` root font) + the **timesheet date-drift** (relative-week seed + clock-pinned tests).
- **Phase 2 slices:** **Companies (PR #34)** = proving slice (caught the scale/date-drift/delete-gating bugs before they ×7'd). Then **Projects, Procurement, Tasks, Incidents, Documents, Admin-Users (PR #35)** built in **parallel worktrees**, integrated, 5-lens reviewed (2 rendered design + security + spec + quality), fixed.
- **Server-enforced SoD/RPCs (migrations 0013–0017):** company delete=Admin; `set_project_contract_value` (PM pre-win, Exec/Finance on won, sole writer); procurement select-quote RPC + `procurement_items` org_id-inherit trigger + Draft RLS; task engineer-own-status RLS (column-pinned); document-status RPC (approver≠author); incident delete=Admin + reporter stamping. RLS is the authority; `can()` is UX-only; no client sends `org_id`.
- **Verified:** **1258 unit · 332 pgTAP (59 files) · 39 e2e**; CI green (verify+integration). `/work-orders` route removed (owner decision).
- **DEFERRED (recorded):** Admin **user disable/Status + invite-create** (needs a profiles status column + server-side auth-admin); **assigned-projects** picker filter (needs an assignment model); document **file upload** (Supabase Storage still disabled — metadata CRUD only); minor responsive/taste nits (mobile KPI peek, role-pill distinctness) as fast-follow.

## ▶ NEXT FEATURE WAVE — owner-set priority (updated 2026-06-08)
Companies + Tasks + Documents + Administration are now DONE via the CRUD program; Work Orders route removed. Genuinely remaining:
1. ✅ **Timesheet entry + edit — DONE (merged PR #31, `main`@b9ee6c4).** Engineers add a project row, type per-day hours, edit a row note, delete (confirm), and Save on the editable weekly grid (Draft-only; lazy Draft creation; save-diff insert/update/delete-zeroed; 0–24 validation; live totals; read-only once Submitted). Spec `docs/specs/timesheet-entry.spec.md`, plan `docs/plans/2026-06-07-timesheet-entry.md`, **ADR-0015** (migration `0011`: unique `(timesheet_id,project_id,entry_date)` cell key + WITH CHECK hardened to own+Draft **and** parent-project org). **Security audit caught + fixed a real cross-org integrity hole** (an own-draft entry could reference another org's project_id) before merge → pgTAP `0049`. 789 unit · 190 pgTAP · e2e `AC-TSE-021` · CI green. Multi-lens reviewed + a rendered re-check (AA contrast 6.48:1, mobile delete reachable, header/grid totals consistent). _Noted post-MVP follow-ups:_ restrict picker to **assigned** projects (needs an assignment model); bind `entry.org_id`/`entry_date` to the parent timesheet (defense-in-depth); picker uses `useProjects()`+client filter (acceptable).
2. **▶ Project-level timesheet view — NEXT** (was deferred) — cross-user, project-scoped timesheet read on the project-detail Timesheets tab (PM/Exec see all members on their project). Needs a project-scoped RLS read + a visibility/auth **decision (owner-level — flagged)**. Build next.
3. ✅ **Companies / Tasks / Documents / Administration** — DONE via the CRUD program (above).
4. **Reports** module — still a placeholder; needs owner definition (read-only dashboards/exports over existing data).
> CRUD-program fast-follows (recorded above): Admin user disable/invite, assigned-projects picker, document file-upload (re-enable Storage), minor responsive/taste nits. Work Orders route removed (owner decision).

## ✅ UI REALIGNMENT PROGRAM — COMPLETE (2026-06-07, `main`@25d6963)
The whole app was re-skinned to the owner-approved **RIS IA-3 identity** (`DESIGN.md` reverse-engineered from
`RIS-portal-2/docs/design-mockups/*.html`; mockups in `docs/design-mockups/proposal-*.html`; master plan +
per-surface plans in `docs/plans/2026-06-06-ui-*.md`). Shell = 224px grouped rail + context bar + ⌘K palette +
tabbed workspace + index→full-page-detail w/ view toggles; light-only; RIS tokens verbatim. Ran via
design-architect→ui-implementer→design-reviewer (every surface got a **rendered visual + contrast/AA review**).
Shipped PRs:
- **#20** procurement `profiles` ambiguous-embed fix (PGRST201 — list was broken for all roles).
- **#21 Foundation** (token pipeline, shell, ~20 primitives). **#22 Sales Pipeline** (kanban/table + opportunity detail).
- **#23 Procurement** (table/board + PR lifecycle detail). **#24 Projects + ProjectDetails decomposition**
  (the ~1250-line god-component dismantled into `pages/project-detail/`). **#25 Dashboard + per-role** (status-chart
  fix). **#26 Timesheets/Approvals** (grid/queue). **#27 cleanup** (e2e isolation + placeholder removal).
- Two app-wide primitive bugs the **visual gate caught** (unit tests passed while broken): Tailwind-v4 `<alpha-value>`
  dead-color-pipeline + invisible outline-`Button` border. (Both banked to memory.)

### Deferred (placeholders REMOVED; features tracked; await owner scope decision)
- Pipeline RPC-widen (contract-ref/decision-date/PM on cards + PM filter) — low value (empty for in-pipeline deals).
- **Project-level timesheets view** — needs a cross-user, project-scoped RLS read + a visibility/auth decision (owner-level).
- 3 dashboard data-slices — committed-spend-by-category donut, per-PM approvals count, engineer-tasks.
- The prototype modules below (Tasks/Documents/Work-Orders/Reports/Companies/Administration).

### Open follow-ups / debt
- ✅ **Auth/LoginPage reskin DONE** — `b4741d9` on `feat/ui-polish` (reskinned to the RIS/IA-3 identity; ships with the polish PR). _(was: off-token, pending.)_
- **e2e test-hardening**: full *local* suite has seed-coupling (AC-1011/AC-816/AC-911 share seeded entities → fail in
  some local full-suite orderings; **CI passes**). Harden by giving each mutation spec a dedicated seed row (pattern:
  AC-SP now uses P011). Not urgent.
- **hosting/deploy** (owner-gated, ADR-0006); **deferred prototype modules** scope decision (below).

## (SUPERSEDED) Deferred prototype modules — now mostly built by the CRUD program (2026-06-08)
This section is HISTORICAL. The owner scope decision was made and most of these shipped in the CRUD program
(PRs #32/#34/#35 — see "✅ APP-WIDE FE-CRUD + RBAC PROGRAM" above). Current status:
- ✅ **Tasks** (+ `task_dependencies`) — DONE (project-detail Tasks tab CRUD + engineer-own-status RLS).
- ✅ **Incident/risk register** (`incident_reports`) — DONE (`/incidents` file/investigate/close).
- ✅ **Document control** (`project_documents`) — **metadata CRUD DONE** (status SoD); **file upload still deferred** (Supabase Storage disabled — re-enable first).
- ✅ **Companies** — DONE (management screen, full CRUD).
- ✅ **Administration** — Admin Users screen DONE (edit role/manager); **user disable + invite-create deferred** (needs a profiles status column + server-side auth-admin); the OD-PROC-6 admin config engine / B2B bridge remains future.
- ❌ **Work Orders** — route REMOVED (owner decision; never modeled).
- **Reports** — still a placeholder; the one module genuinely needing owner definition (read-only dashboards/exports).

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
7. **UI/UX design workflow** — ✅ harness BUILT (agents + `docs/design-workflow.md` + vendored skills); ▶ NOT yet run — see "RESUME HERE" above (reverse-engineer `DESIGN.md` via `design-architect`, owner sign-off, then run UI issues through the design cycle). `DESIGN.md` is reverse-engineered from the existing app (identity-preserved), NOT greenfield `/design-consultation`. Storybook adopted when the shared component library is extracted.

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
