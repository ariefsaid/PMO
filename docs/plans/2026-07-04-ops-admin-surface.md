# Implementation plan — Ops-Admin surface (GTM / MVP-viability program, item 1)

> ## PROGRESS NOTE — ops-admin-surface S6 (FE slices B+C+D) — 2026-07-05
>
> **Shipped (this round, uncommitted on `feat/ops-admin`):**
> - **S6-B (AC-ENT-003):** `useFeature()` + `<FeatureGate>` + `<FeatureRoute>` rewired to resolve
>   per-org entitlements via `useOrgFeatures()` (row overrides env default; absence = env default;
>   core keys always true, never queried). `Rail.tsx` resolves all gated items (incidents/crm/
>   procurement/timesheets/user_views) through the cached map; CRM rail items (Sales Pipeline/
>   Companies/Contacts) + deep-link `/crm` redirect-to-`/` gated. `Rail.features.test.tsx` updated
>   to mock `useOrgFeatures` (assertions intact). `features.ts` keeps the interim `FEATURES` +
>   `isFeatureEnabled` for env-only sub-flags (`agentAssistant`/`userViews`/`aiComposer`, plan M5);
>   the new entitlement type is `OrgFeatureKey`/`EntitleableKey` to avoid the `FeatureKey` collision.
> - **S6-C (AC-ENT-004):** `AdministrationFeatures.tsx` — Operator sees real `<button role="switch"
>   aria-checked>` toggles calling `repositories.orgFeature.toggle` (react-query mutation +
>   `['orgFeatures']` invalidation); org-Admin sees a read-only "Included in your plan" list with a
>   `StatusPill` (no switch controls). Core modules render locked-on, non-toggleable. `core_not_gated`
>   (P0001) → "Core modules can't be disabled" toast via `classifyMutationError` override.
> - **S6-D (AC-CRE-004 shape + AC-A11Y-001):** `AdministrationCredits.tsx` — org-pool balance via
>   `repositories.credits.getOrgBalance` (`org_credit_balance` RPC); Operator "Grant credits" →
>   `EntityFormModal` (amount numeric > 0 + note) calling `operator_grant_credits`; `amount_positive`
>   (23514) → "Grant amount must be positive" toast. org-Admin sees read-only balance. Mounted into
>   `AdminUsers.tsx` (Credits before Features, both after Usage).
> - **A11y capstone (AC-A11Y-001):** `Administration.a11y.test.tsx` renders the fully-composed
>   `/administration` (Users + Credits + Usage + Features) for Operator AND org-Admin at desktop +
>   390px; axe-core reports **zero** critical/serious violations. No axe fixes were needed (the
>   toggles are real `role="switch"` + `aria-checked` + labelled; pill is dot+label, never
>   color-only). `vitest-axe`/`jest-axe` were NOT used — the existing `axe-core` helper
>   (`src/components/__tests__/axe.ts`) is the codebase idiom; reused it.
>
> **Repo/DAL/Types additions:** `src/lib/db/orgFeatures.ts` (DAL: `listOwnOrgFeatures`/
>   `toggleOrgFeature`/`getOrgCreditBalance`/`grantOrgCredits`); `OrgFeatureRepository` +
>   `CreditsRepository` added to the repository seam (`repositories/{types,index}.ts`) — note the
>   `Repositories` key is `credits` (plural), not `credit`. `database.types.ts` got additive entries
>   for `org_features` table + `operator_toggle_feature` + `org_has_feature` RPCs (ahead of the
>   Director's next `supabase gen` regen, which will overwrite them with the mig-0068 shape).
>
> **Deviations / notes:**
> - `src/auth/useFeature.tsx` is a `.tsx` (contains JSX) — the `.ts` form the plan implied tripped
>   the oxc parser; renamed.
> - `App.tsx` `FeatureRoute feature="userViews"` → `"user_views"` (camelCase→snake_case to match
>   `EntitleableKey`).
> - Pre-existing AdminUsers tests (`disable`/`heading`/`operatorGate`) updated to wrap in a
>   `QueryClientProvider` + mock `useOrgFeatures`/`repositories` (the new sections reach react-query
>   directly, unlike the mocked `useUsage`).
> - The Operator org-switcher (S5-D) is NOT yet wired — Credits/Features read the caller's own org
>   (`currentUser.org_id`) for both Operator and org-Admin (deferred to the org-switcher slice).
>
> **Deferred / stack-bound (Director to run):** `supabase db reset && supabase test db` (pgTAP
>   0122/0123 for S6-A, already written by the other agent), `npm run verify` (full suite), and the
>   Playwright e2e (S7). NOT run this round per the gate (shared Supabase stack in concurrent use).
> Targeted vitest only: **37/37 green** across 9 files; `npm run typecheck` clean.

- **Date:** 2026-07-04
- **Issue:** PMO GTM item 1 — the Ops-Admin `/administration` surface (invite/disable, Operator mechanism, org-pool credits, usage view, `org_features` entitlements).
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec (authoritative):** `docs/specs/ops-admin-surface.spec.md` — FR-INV-*, FR-OPR-*, FR-CRE-*, FR-USE-*, FR-ENT-*, NFR-SEC/PRIV/PERF/A11Y-*, AC-INV/OPR/CRE/USE/PRIV/ENT/A11Y-* (owner scope locked 2026-07-04; **do not re-litigate the spec**).
- **ADR (this issue):** `docs/adr/0049-ops-admin-surface.md` (issued alongside this plan).
- **Reference slice (pattern to copy, do not reinvent):** `pmo-portal/pages/Companies.tsx` + `pmo-portal/src/lib/db/companies.ts` + the repository seam (`pmo-portal/src/lib/repositories/{types,index}.ts`) + the existing AdminUsers surface (`pmo-portal/pages/AdminUsers.tsx` + `pmo-portal/src/lib/db/adminUsers.ts`).
- **Edge-fn pattern (copy exactly):** `supabase/functions/agent-dispatch/index.ts` (thin Deno wrapper; pure logic importable from `pmo-portal/src/...` and vitest-tested; service-role key bearer-checked; never leaked to the client).
- **Migration high-water mark:** current top is `supabase/migrations/0057_index_gap_hardening.sql` → **this plan adds `0058`–`0066`** (9 migrations, see §3).
- **pgTAP high-water mark:** current top is `supabase/tests/0109_agent_dispatch_watermarks_denydefault.test.sql` → **this plan adds `0110`–`0121`** (12 pgTAP files, see §9).
- **Binding final gate (every slice):** `cd pmo-portal && npm run verify` (= `typecheck && lint:ci && test && build`) AND `supabase db reset && supabase test db` (from repo root) before any PR — full suite, never touched-files-only (CLAUDE.md quality gates). Slice PRs target `dev`. **Never push to `production`.**

---

## 0. Design summary (the decisions this plan implements — see ADR-0049)

1. **Operator = platform grant, not a 6th role.** `platform_operators(user_id)` table, RLS
   enabled+forced, **exactly one** policy `FOR SELECT USING (user_id = auth.uid())`, **no** write
   policy for any role (append-only-by-omission). `is_operator()` is plain `SECURITY INVOKER` — it
   works *because* that SELECT policy shows an operator their own row (without it, forced RLS hides
   all rows → always `false` → every Operator RPC dead). Operator powers are **RPC-only**, taking an
   explicit `p_org_id`.
2. **Credits = org-pool, non-destructive.** `credits.owner_id` → nullable (no backfill); new Operator
   grants write `owner_id IS NULL`; legacy non-null grants still count. Balance =
   `Σ credits.amount(org_id=X, any owner_id) − Σ agent_usage.cost(org_id=X)`.
3. **`credits` INSERT flips `auth_role()='Admin'` → `is_operator()`** (revenue-hole fix, AC-CRE-002).
   `credits` SELECT widens to own-org Admin+Exec (grants *view*). **Metering** reads the org balance
   via the **`org_credit_balance(p_org_id)` security-definer RPC** (asserts `p_org_id = auth_org_id()`)
   — so any member's deputy turn reads their own pool without `credits` SELECT. `creditRateGuard`:
   `check(userId)` → `check(orgId)`; FR-AUC-010 amended per-`owner_id` → per-`org_id` (pointer added
   to `agent-usage-credits.spec.md`).
4. **`org_features` write is Operator-only** (flips the 2026-06-15 note — ADR-0049). SELECT for **all**
   org members (entitlements are not intra-org secrets → `useFeature()` reads `org_features` directly).
   `org_has_feature()` ships as the **future server-enforcement hook only** — unused by gated-table
   RLS (UI-first bypass accepted v1) and unused by the FE. Core modules (`projects`/`dashboard`/
   `approvals`/`administration`) are never gated; disable = hide, never destroy.
5. **Privacy line (inviolable, pgTAP-proven).** No `/administration` surface reads
   `agent_events`/`agent_runs`/`agent_threads`; the usage surface sources only from `agent_usage`.
6. **Disable = two layers.** `is_active_member()` (security-definer) conjoined into **every**
   business-table policy (SELECT `USING` + write `USING`/`WITH CHECK`) **plus** session revocation
   (`auth.users.banned_until` set by `admin_set_user_status` RPC). Sole-/self-Admin guard rejects
   **regardless of caller, including an Operator**.
7. **Invite issuance here; accept flow is `auth-production-floor`.** `admin-invite-user` service-role
   edge fn issues + creates the profile + **rejects** (`401`/`403`) any non-Admin/non-Operator caller
   (binding SHALL). No email body / SMTP / link / redirect in this issue.

**TOCTOU truth (NFR-PERF-002):** the org-pool balance's advisory-preflight race window **widens**
~org-size vs the per-user window it replaces; accepted v1 (still bounded). Backlog pointer: the
"transactional / `SELECT … FOR UPDATE` preflight" hardening item.

---

## 1. Slice map (one PR to `dev` per slice; serialize flags)

| # | Slice | Touches local Supabase (`db reset`)? | ACs owned in this slice | Depends on |
|---|---|---|---|---|
| **S1** | DB foundation: `profile_status` + `is_active_member` + `platform_operators` + `is_operator` + `admin_set_user_status` RPC + seed | **YES — SERIALIZE** | AC-INV-002, AC-INV-003, AC-OPR-001, AC-OPR-002 | — |
| **S2** | Credits → org-pool: `credits`/`agent_usage`/balance migrations + RPCs + `creditRateGuard` rewire | **YES — SERIALIZE** | AC-CRE-001, AC-CRE-002, AC-CRE-003 | S1 |
| **S3** | `admin-invite-user` edge fn (issuance) + pure handler logic (vitest) | no (Deno wrapper; logic in vitest) | (no owning AC — supports AC-INV-001) | S1 |
| **S4** | AdminUsers UI: Users section — invite modal + Disable/Re-enable + `useIsOperator` + repo seam | no | AC-INV-004, AC-OPR-003 | S1, S3 |
| **S5** | Usage view: `agent_usage` columns + summary RPCs + page section + margin | **YES — SERIALIZE** | AC-USE-001, AC-USE-002, AC-PRIV-001, AC-USE-003 | S1, S2 |
| **S6** | `org_features` + `useFeature`/`<FeatureGate>` + Admin Features section + route gating + a11y capstone | **YES — SERIALIZE** | AC-ENT-001, AC-ENT-002, AC-ENT-003, AC-ENT-004, AC-A11Y-001 | S1, S4 |
| **S7** | e2e curated journeys (integration capstone) | runs against local stack (Playwright + seed) | AC-INV-001, AC-CRE-004, AC-ENT-005 | S1–S6 |

**Serialize rule (binding).** Slices **S1, S2, S5, S6** each run `supabase db reset && supabase test db`
against the **same local Docker stack** — only one may reset/test at a time. They land sequentially
(S1 → S2 → S5 → S6). S3/S4 are FE/edge-fn-only (`npm run verify`, no `db reset`) and may proceed in
parallel with each other **after** their DB dependency merges. **S7 is the capstone** — runs only after
S1–S6 are all on `dev` (it asserts the composed surface end-to-end against the seed).

---

## 2. Conventions honored (binding)

- **TDD-first.** Every behavior task writes the failing test first (pgTAP `.test.sql` / vitest `.test.tsx`), then the implementation. No prod code without a failing test.
- **AC-id tagging.** The owning test names its `AC-###` as the leading token of its title/description (`grep -r AC-XXX` finds the canonical proof at whatever layer owns it).
- **One owning layer per AC** (ADR-0010): pgTAP for RLS/tenancy/privacy authority; vitest+RTL for component/render/logic; Playwright for the 3 real cross-stack journeys.
- **No placeholders.** Exact paths, real code sketches, real RPC/fn names, exact verify commands. The one mechanical pass (§4 Task S1-B, the `is_active_member()` conjunction) is given as an enumerated table + exact template + pgTAP proof — that *is* the no-placeholder form for a genuinely mechanical migration.
- **org_id never client-sent** (ADR-0017): child rows stamp `org_id` via column default + RPC param; `WITH CHECK (org_id = auth_org_id())` is the tenancy authority; Operator RPCs take explicit `p_org_id` asserted against `organizations` existence.
- **`can()` UX-only; RLS/RPC is the authority** (ADR-0016/0019): every write gated FE-side by `can(...)` or `useIsOperator()`, enforced server-side by RLS / security-definer RPC.
- **Reversibility.** Every migration carries a manual-rollback comment block; `supabase db reset` is the canonical pre-production reverse.

---

## 3. Migration + pgTAP numbering (explicit)

**Migrations (`supabase/migrations/`, next free `0058`):**

| File | Slice | Adds |
|---|---|---|
| `0058_ops_admin_profile_status.sql` | S1 | `profile_status` enum; `profiles.status` (`default 'active'`); `is_active_member()` helper (security definer) |
| `0059_is_active_member_conjunction.sql` | S1 | conjoin `and is_active_member()` into **every** business-table policy (mechanical pass) |
| `0060_platform_operators.sql` | S1 | `platform_operators` table (RLS forced, 1 SELECT policy, 0 write policies) + `is_operator()` (security invoker) |
| `0061_admin_set_user_status.sql` | S1 | `admin_set_user_status(p_profile_id,p_status,p_org_id)` security-definer RPC + sole-/self-Admin guard + `banned_until` |
| `0062_credits_org_pool.sql` | S2 | `credits.owner_id` drop NOT NULL; `credits_insert`→`is_operator()`; `credits_select`→own-org Admin+Exec; `credits(org_id)` index |
| `0063_org_credit_balance.sql` | S2 | `org_credit_balance(p_org_id)` fn (asserts `p_org_id=auth_org_id()`) + `operator_grant_credits(p_org_id,p_amount,p_note)` RPC |
| `0064_agent_usage_usage_columns.sql` | S5 | `agent_usage.provider_cost_usd` + `action`; composite index `(org_id, created_at)` |
| `0065_usage_summary_rpcs.sql` | S5 | `operator_usage_summary` + `org_usage_summary` + `operator_list_orgs` (directory cols only) RPCs |
| `0066_org_features.sql` | S6 | `org_features` table (PK `(org_id,feature_key)`, CHECK registry, core guard) + `org_has_feature()` + `operator_toggle_feature()` + RLS |

**pgTAP (`supabase/tests/`, next free `0110`):**

| File | Slice | AC | Title token |
|---|---|---|---|
| `0110_ops_admin_disabled_reads_nothing.test.sql` | S1 | AC-INV-002 | `AC-INV-002 disabled member reads nothing` |
| `0111_ops_admin_disable_authority.test.sql` | S1 | AC-INV-003 | `AC-INV-003 disable authority is Admin-in-org or Operator` |
| `0112_ops_admin_operator_rpc_only.test.sql` | S1 | AC-OPR-001 | `AC-OPR-001 Operator powers RPC-only + append-only-by-omission` |
| `0113_ops_admin_operator_not_role.test.sql` | S1 | AC-OPR-002 | `AC-OPR-002 Operator is not a 6th role` |
| `0114_credits_org_pool_balance.test.sql` | S2 | AC-CRE-001 | `AC-CRE-001 org-pool balance is owner_id-agnostic` |
| `0115_credits_insert_operator_only.test.sql` | S2 | AC-CRE-002 | `AC-CRE-002 credits INSERT is Operator-only` |
| `0116_credits_enforced_org_pool.test.sql` | S2 | AC-CRE-003 | `AC-CRE-003 AGENT_CREDITS_ENFORCED meters the org pool` |
| `0117_usage_operator_vs_admin_scope.test.sql` | S5 | AC-USE-001 | `AC-USE-001 Operator sees all orgs; org-Admin own org` |
| `0118_usage_aggregate_columns.test.sql` | S5 | AC-USE-002 | `AC-USE-002 aggregate columns correct` |
| `0119_ops_admin_no_transcript_reads.test.sql` | S5 | AC-PRIV-001 | `AC-PRIV-001 no transcript reads` |
| `0120_org_features_rls.test.sql` | S6 | AC-ENT-001 | `AC-ENT-001 org_features RLS read all-members, write Operator-only` |
| `0121_org_features_core_never_gated.test.sql` | S6 | AC-ENT-002 | `AC-ENT-002 core set never gated` |

**Unit/RTL (`pmo-portal/`, vitest+RTL):**

| File | Slice | AC |
|---|---|---|
| `pages/__tests__/AdminUsers.disable.test.tsx` | S4 | AC-INV-004 |
| `pages/__tests__/Administration.operatorGate.test.tsx` | S4 | AC-OPR-003 |
| `pages/__tests__/Administration.usage.margin.test.tsx` | S5 | AC-USE-003 |
| `auth/__tests__/useFeature.test.tsx` + `shell/__tests__/FeatureGate.route.test.tsx` | S6 | AC-ENT-003 |
| `pages/__tests__/Administration.features.readonly.test.tsx` | S6 | AC-ENT-004 |
| `pages/__tests__/Administration.a11y.test.tsx` | S6 | AC-A11Y-001 |

**e2e (`pmo-portal/e2e/`, Playwright):**

| File | Slice | AC |
|---|---|---|
| `e2e/AC-INV-001-invite.spec.ts` | S7 | AC-INV-001 |
| `e2e/AC-CRE-004-grant.spec.ts` | S7 | AC-CRE-004 |
| `e2e/AC-ENT-005-toggle.spec.ts` | S7 | AC-ENT-005 |

---

## SLICE S1 — DB foundation (profile_status + is_active_member + platform_operators + is_operator + admin_set_user_status RPC + seed)

**Touches local stack — SERIALIZE.** ACs: AC-INV-002, AC-INV-003, AC-OPR-001, AC-OPR-002.
**Verify gate:** `supabase db reset && supabase test db` (repo root) + `cd pmo-portal && npm run verify` (no FE behavior change yet; the new `useIsOperator` hook lands in S4).

### Task S1-A — `0058_ops_admin_profile_status.sql` + `is_active_member()` helper (TDD: pgTAP 0110 first)

**Failing test first** — `supabase/tests/0110_ops_admin_disabled_reads_nothing.test.sql` (AC-INV-002):
the test fixtures an org-A admin + member M; inserts M with `status='disabled'` (as table owner);
sets role to M's JWT; asserts 0 rows from `profiles`, `projects`, `procurements`, `agent_usage`, and
(after S6) `org_features`. Pattern: copy the `set local role authenticated; set local request.jwt.claims`
shape from `supabase/tests/0109_agent_dispatch_watermarks_denydefault.test.sql`.

Skeleton (the predicate is what this test pins — write it before the migration so it fails red):
```sql
begin;
select plan(8);
-- fixtures: org A, admin A-admin, member M (disabled)
insert into organizations (id,name) values ('01100000-0000-0000-0000-000000000001','AC-INV-002 Org');
insert into auth.users (id,email) values
  ('01100000-0000-0000-0000-0000000000ad','inv002-admin@example.com'),
  ('01100000-0000-0000-0000-0000000000m0','inv002-member@example.com');
insert into profiles (id,org_id,full_name,email,role,status) values
  ('01100000-0000-0000-0000-0000000000ad','01100000-0000-0000-0000-000000000001','A Admin','inv002-admin@example.com','Admin','active'),
  ('01100000-0000-0000-0000-0000000000m0','01100000-0000-0000-0000-000000000001','M Member','inv002-member@example.com','Engineer','disabled');
-- (insert a projects + procurements + agent_usage row as table owner so "0 rows" is a real deny, not an empty table)
insert into projects (id,org_id,name,status) values ('01100000-0000-0000-0000-00000000p001','01100000-0000-0000-0000-000000000001','P','Identified');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01100000-0000-0000-0000-0000000000m0","role":"authenticated"}';

select is((select count(*)::int from profiles),    0,'AC-INV-002 disabled M reads 0 profiles');
select is((select count(*)::int from projects),    0,'AC-INV-002 disabled M reads 0 projects');
select is((select count(*)::int from procurements),0,'AC-INV-002 disabled M reads 0 procurements');
select is((select count(*)::int from agent_usage), 0,'AC-INV-002 disabled M reads 0 agent_usage');
-- (org_features assertion added in S6 — guarded by plan() count; skip here, re-assert in 0120)
reset role;
-- control: an active member DOES read their org's rows (proves the deny is status-scoped, not org-scoped)
set local role authenticated;
set local request.jwt.claims = '{"sub":"01100000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select is((select count(*)::int from projects), 1,'AC-INV-002 active admin reads 1 project (control)');
reset role;
select * from finish();
rollback;
```

**Then implement** — `supabase/migrations/0058_ops_admin_profile_status.sql`:
```sql
-- 0058 — profile_status enum + profiles.status (FR-INV-001) + is_active_member() helper (FR-INV-003).
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.is_active_member();
--   alter table public.profiles drop column if exists status;
--   drop type if exists public.profile_status;

create type public.profile_status as enum ('active','disabled');

alter table public.profiles
  add column status public.profile_status not null default 'active';

-- indexes: none needed (status is low-cardinality; the predicate is ANDed onto org-scoped indexes).

-- is_active_member(): security DEFINER (mirrors auth_org_id(), 0002_rls.sql) so it reads the raw
-- profiles row BYPASSING RLS — avoiding recursion when conjoined into profiles_select itself (0059).
-- A disabled user's JWT -> false -> every business-table policy's conjunct denies.
create or replace function public.is_active_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;
```
**Verify:** `supabase db reset && supabase test db -- 0110` → 0110 still red on the *business-table*
asserts (policies not yet conjoined — that's Task S1-B). ✓ red-as-expected for this task's full pass.

### Task S1-B — `0059_is_active_member_conjunction.sql` (mechanical pass — the conjunction)

Conjoin `and public.is_active_member()` into **every** business-table policy: each `for select`
policy's `USING`, and each `for all`/write policy's `USING` **and** `WITH CHECK`. Single-sourced
predicate; the pgTAP 0110 (read-deny) + a new write-deny assertion prove the outcome.

**Exact enumerated set** (re-derived from `grep "create policy .* for \(select\|all\|insert\|update\|delete\)" supabase/migrations/*.sql`
as of `0057` — **all 5 policy kinds**; the prior `select|all`-only derivation silently missed ~30 write
policies, which is the precise FR-INV-003 gap — C1). The implementer re-runs this grep at build time
and applies the template to **every** row it returns — if a later migration added a policy, it gets
the conjunct too. `[R]` = `as restrictive` policy (0013/0017 SoD hard-delete + 0051 self-requester +
procurement_items draft-only); the conjunct goes into a restrictive policy's `USING`/`WITH CHECK`
identically — it only narrows further (safe direction). Every row below was re-verified against the
real migrations (114 policies total; the owner-private agent_*/notifications tables' write policies
are now listed — they were the headline C1 miss):

| table | policy | kind |
|---|---|---|
| profiles | profiles_select | select |
| profiles | profiles_update_self | update |
| profiles | profiles_admin_write | all |
| companies | companies_select | select |
| companies | companies_write | all |
| companies | companies_delete_admin_only | delete [R] |
| projects | projects_select | select |
| projects | projects_write | all |
| projects | projects_delete_admin_only | delete [R] |
| project_documents | project_documents_select | select |
| project_documents | project_documents_write | all |
| project_documents | project_documents_delete_admin_only | delete [R] |
| project_milestones | project_milestones_select / _write | select / all |
| tasks | tasks_select / tasks_write | select / all |
| tasks | tasks_update_own_status | update |
| task_dependencies | task_dependencies_select / _write | select / all |
| budget_versions | budget_versions_select / _write | select / all |
| budget_line_items | budget_line_items_select / _write | select / all |
| contacts | contacts_select / contacts_write | select / all |
| contacts | contacts_delete_admin_only | delete [R] |
| crm_activities | crm_activities_select / _write | select / all |
| incident_reports | incident_reports_select | select |
| incident_reports | incident_reports_insert | insert |
| incident_reports | incident_reports_update | update |
| incident_reports | incident_reports_delete_admin_only | delete |
| payments | payments_select / payments_write | select / all |
| payment_files | payment_files_select / _write | select / all |
| timesheets | timesheets_select | select |
| timesheets | timesheets_insert | insert |
| timesheets | timesheets_update_own | update |
| timesheet_entries | timesheet_entries_select / _write | select / all |
| procurements | procurements_select | select |
| procurements | procurements_insert | insert |
| procurements | procurements_update | update |
| procurements | procurements_insert_self_requester | insert [R] |
| procurement_items | procurement_items_select, procurement_items_write, procurement_items_requester(+_mod/_del), procurement_items_draft_only(+_mod/_del) | select, all, update/delete (draft_only set is [R]) |
| procurement_quotations | procurement_quotations_select / _write | select / all |
| procurement_quotation_files | procurement_quotation_files_select / _write | select / all |
| procurement_receipts | procurement_receipts_select / _write | select / all |
| procurement_receipt_files | procurement_receipt_files_select / _write | select / all |
| procurement_invoices | procurement_invoices_select / _write | select / all |
| procurement_invoice_files | procurement_invoice_files_select / _write | select / all |
| procurement_documents | procurement_documents_select / _write | select / all |
| purchase_requests | purchase_requests_select / _write | select / all |
| purchase_request_files | purchase_request_files_select / _write | select / all |
| rfqs | rfqs_select / _write | select / all |
| rfq_files | rfq_files_select / _write | select / all |
| purchase_orders | purchase_orders_select / _write | select / all |
| purchase_order_files | purchase_order_files_select / _write | select / all |
| procurement_status_events | procurement_status_events_read | select |
| agent_usage | agent_usage_select | select |
| agent_usage | agent_usage_insert | insert |
| credits | credits_select | select |
| credits | credits_insert | insert |
| user_views | user_views_select / _insert / _update / _delete | select / insert / update / delete |
| notifications | notifications_select / _insert / _update / _delete | select / insert / update / delete |
| agent_threads | agent_threads_select / _insert / _update / _delete | select / insert / update / delete |
| agent_runs | agent_runs_select / _insert / _update / _delete | select / insert / update / delete |
| agent_events | agent_events_select / _insert / _update / _delete | select / insert / update / delete |
| agent_automations | agent_automations_select / _insert / _update / _delete | select / insert / update / delete |

> **Excluded** (intentionally — not member-business tables): `organizations.organizations_select`,
> `pipeline_stage_config`, `procurement_doc_counters` (read by RPC, not user-facing),
> `agent_dispatch_watermarks` (RLS-forced, no policy — already default-deny), `platform_operators`
> (created in 0060 with its own one policy — the conjunct would be wrong there; do **not** conjoin).

**Template** (drop + recreate, preserving the original predicate verbatim, appending the conjunct):
```sql
-- 0059 — conjoin is_active_member() into every business-table policy (FR-INV-003, AC-INV-002).
-- Mechanical pass: for each (table, policy) the implementer drops+recreates, preserving the
-- ORIGINAL predicate verbatim and appending 'and public.is_active_member()' to USING and WITH CHECK.
-- Reversibility: supabase db reset (the original policies are re-created by 0002+later on reset).

-- Example 1 — a pure SELECT policy:
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select
  using (org_id = auth_org_id() and public.is_active_member());

-- Example 2 — a `for all` write policy (USING + WITH CHECK both get the conjunct):
drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
         and public.is_active_member())
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
              and public.is_active_member());

-- Example 3 — an INSERT-only policy:
drop policy if exists agent_usage_insert on public.agent_usage;
create policy agent_usage_insert on public.agent_usage for insert
  with check (owner_id = auth.uid() and org_id = auth_org_id()
              and public.is_active_member()
              and (run_id is null or exists (select 1 from agent_runs r where r.id = agent_usage.run_id
                   and r.owner_id = auth.uid() and r.org_id = auth_org_id())));
```
The implementer applies the template to **every row of the enumerated table** (and any row the
build-time grep surfaces that this plan didn't list). **Build-time grep (run, paste output into the
migration's trailing comment as the audit trail):**
```bash
# 5-kind grep (C1 fix — the prior select|all|insert|update form omitted `for delete`).
# NOTE: grep is line-based; the restrictive hard-delete policies (companies/contacts/projects/
# project_documents/incident_reports `_delete_admin_only`) and `procurements_insert_self_requester`
# split `create policy ... for <kind>` across two lines in 0013/0017/0051, so ALSO run a multiline
# scan (`tr '\n' ' ' < f | grep -oE 'create policy ...'`) — the enumerated table above already lists
# them, so this grep is the cross-check that catches any policy added after 0057.
grep -rh "create policy .* for \(select\|all\|insert\|update\|delete\)" supabase/migrations/0*.sql | \
  sed -E 's/.*create policy ([a-z_0-9]+) on ([a-z_0-9]+) for ([a-z]+).*/\2.\1 (\3)/' | sort -u
```
**Verify:** `supabase db reset && supabase test db -- 0110` → **green** (read-deny proven). The
write-deny block in 0110 asserts, **under disabled-M's JWT**, that INSERT and UPDATE on each of
`timesheets`, `user_views`, `incident_reports`, `notifications` affect 0 rows / are rejected (C1 —
proving the `WITH CHECK` conjunct on the previously-missed write policies: `timesheets_insert`/
`_update_own`, `user_views_insert`/`_update`/`_delete`, `incident_reports_insert`/`_update`,
`notifications_insert`/`_update`/`_delete`), plus UPDATE on `profiles`/`projects` affects 0 rows (the
original write-deny). Each target row is seeded as table owner first; then the disabled-JWT
INSERT/UPDATE is asserted to yield 0 affected rows (permissive-policy denial). Raise 0110's `plan(N)`
to match the added assertions. ✓

### Task S1-C — `0060_platform_operators.sql` + `is_operator()` (TDD: pgTAP 0112 + 0113)

**Failing tests first.** `supabase/tests/0112_ops_admin_operator_rpc_only.test.sql` (AC-OPR-001):
fixtures the seeded Operator + an org-A Admin; asserts (a) a direct INSERT/UPDATE/DELETE into
`platform_operators` by **any** role (incl. the Operator) is rejected `42501` (append-only-by-omission),
(b) `is_operator()` returns true only under the Operator's JWT, (c) the Operator's own SELECT from
`platform_operators` returns exactly their row, (d) anyone else's SELECT returns 0 rows. The
`operator_grant_credits`/`operator_toggle_feature`/`operator_usage_summary` RPC re-asserts clauses are
exercised here once those RPCs exist (S2/S5/S6); for S1 this test pins the **table + helper +
append-only** invariants (the RPC-specific clauses get their own assertions in 0115/0120).

`supabase/tests/0113_ops_admin_operator_not_role.test.sql` (AC-OPR-002): asserts
`select typenum_values ... pg_enum` for `user_role` still equals exactly
`('Executive','Project Manager','Finance','Engineer','Admin')`, AND that a profile with
`role='Engineer'` who is also in `platform_operators` has `is_operator()=true` under their JWT (the
grant is on `platform_operators.user_id`, not the role).

**Then implement** — `supabase/migrations/0060_platform_operators.sql`:
```sql
-- 0060 — platform_operators (platform-level grant, NOT a 6th role) + is_operator() helper.
-- FR-OPR-001/002. RLS enabled+forced; EXACTLY ONE policy (FOR SELECT user_id = auth.uid());
-- NO write policy for any role => append-only-by-omission (FR-AUC-007 pattern).
-- Reversibility: supabase db reset. Manual: drop function is_operator(); drop table platform_operators;

create table public.platform_operators (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.profiles(id)
);
comment on table public.platform_operators is
  'Platform-level Operator grant (ADR-0049). NOT a user_role. Provisioned via seed/SQL only.';

alter table public.platform_operators enable row level security;
alter table public.platform_operators force  row level security;

-- The ONE policy: a user confirms ONLY their own membership. This is what makes is_operator()
-- return true for an Operator (their own row is visible to them) and false for everyone else.
create policy platform_operators_self_select on public.platform_operators
  for select using (user_id = auth.uid());
-- DELIBERATELY no INSERT/UPDATE/DELETE policy => default-deny writes for every ordinary role;
-- only service_role (RLS bypass) / seed SQL ever writes it (FR-OPR-001 / FR-OPR-003).

-- is_operator(): plain SECURITY INVOKER (NOT definer). It does NOT bypass RLS — it leans on the
-- SELECT policy above. Under an Operator's JWT the sub-select sees their own row -> true; under any
-- other JWT -> 0 rows -> false. Without that SELECT policy this would always be false.
create or replace function public.is_operator() returns boolean
  language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.platform_operators where user_id = auth.uid())
$$;
```
**Verify:** `supabase db reset && supabase test db -- 0112 0113` → green. ✓

### Task S1-D — `0061_admin_set_user_status.sql` (security-definer RPC + sole-/self-Admin guard + `banned_until`)

**Failing test first** — `supabase/tests/0111_ops_admin_disable_authority.test.sql` (AC-INV-003):
fixtures org A (admin A-admin) + org B (admin B-admin + member B-eng) + the Operator; asserts
- org-A Engineer → disable a B profile: RPC raises (`42501`-equivalent `exception`);
- org-A Admin → disable a B profile: raises;
- Operator → disable a B profile: succeeds (profile.status='disabled', auth.users.banned_until set);
- org-B Admin → disable a B profile: succeeds;
- **sole-Admin guard**: Operator disabling org B's only Admin raises 'lockout' regardless of caller;
- **self-disable guard**: an Admin disabling themselves raises 'lockout'.
- re-enable (`status='active'`) clears `banned_until`.

**Then implement** — `supabase/migrations/0061_admin_set_user_status.sql`:
```sql
-- 0061 — admin_set_user_status security-definer RPC (FR-INV-002/003, AC-INV-003/004).
-- Re-asserts (Admin-in-org OR Operator); caller-agnostic sole-/self-Admin lockout guard; revokes
-- the target's active session via auth.users.banned_until (security-definer reaches the auth schema
-- as the migration-owner role, like the GoTrue admin path). Also re-asserts is_active_member() at
-- entry (FR-INV-003 last clause: a disabled caller cannot invoke any Operator/Admin RPC).
-- Reversibility: supabase db reset. Manual: drop function admin_set_user_status;

create or replace function public.admin_set_user_status(
  p_profile_id uuid,
  p_status     public.profile_status,
  p_org_id     uuid
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_caller_org uuid := public.auth_org_id();
  v_caller_role user_role := public.auth_role();
  v_target_org  uuid;
  v_target_role user_role;
  v_admin_count int;
begin
  -- entry guard: a disabled caller reaches nothing (FR-INV-003).
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;

  -- resolve target (definer bypasses RLS — we read the raw row to authorize).
  select org_id, role into v_target_org, v_target_role
    from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'not_found' using errcode = '42501';
  end if;

  -- AUTHORITY: Admin-in-target-org (caller_org = p_org_id = target_org AND caller Admin) OR Operator.
  -- p_org_id is the client-supplied scope; assert it matches the target's real org so an Operator
  -- can't reach across by lying about p_org_id, and an org-Admin can't reach another org.
  if p_org_id <> v_target_org then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  if not (
    (v_caller_org = v_target_org and v_caller_role = 'Admin')
    or public.is_operator()
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- CALLER-AGNOSTIC lockout guard (FR-INV-002 / AC-INV-004): cannot disable self; cannot disable the
  -- org's sole Admin — regardless of who the caller is (incl. an Operator).
  if p_status = 'disabled' then
    if p_profile_id = auth.uid() then
      raise exception 'cannot disable yourself' using errcode = 'P0001';
    end if;
    if v_target_role = 'Admin' then
      select count(*) into v_admin_count
        from public.profiles
       where org_id = v_target_org and role = 'Admin' and status = 'active';
      if v_admin_count <= 1 then
        raise exception 'cannot disable the only Admin' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- apply the status change (definer bypasses profiles RLS).
  update public.profiles set status = p_status where id = p_profile_id;

  -- revoke / restore the active session: banned_until is a native auth.users column.
  if p_status = 'disabled' then
    update auth.users set banned_until = '2999-12-31T23:59:59+00'::timestamptz
      where id = p_profile_id;
  else
    update auth.users set banned_until = null where id = p_profile_id;
  end if;
end $$;

-- restrict execution to authenticated (the function re-asserts authority internally).
revoke all on function public.admin_set_user_status(uuid,public.profile_status,uuid) from public;
grant execute on function public.admin_set_user_status(uuid,public.profile_status,uuid) to authenticated;
```
**Verify:** `supabase db reset && supabase test db -- 0111` → green. ✓ (Add a manual local drill:
disable a seeded user, attempt sign-in → refresh fails; re-enable → succeeds. Recorded in the slice PR
description, not a CI gate.)

### Task S1-E — Seed the Operator (`supabase/seed.sql`) + provisioning runbook note

Append to the **END of `supabase/seed.sql`** (the seed runs §A…§T; this block becomes §U — the prior
"§OP mid-file after §D" idea is dropped because §OP collides visually with §O project_documents).
**FK-ordering:** `platform_operators.user_id` → `profiles(id)`; both `auth.users` (§A) and `profiles`
(§D) are seeded earlier in the file, so appending at the end (after §T) satisfies every FK — no
mid-file insertion is needed. Uses the canonical org `00000000-0000-0000-0000-000000000001`:
```sql
-- §U  platform operator (ADR-0049; FR-OPR-003). Seeded Operator = arief.said@gmail.com.
--     Mirror in docs/environments.md provisioning runbook (ADR-0047) for real projects.
--     FK note: platform_operators.user_id → profiles(id); profiles seeded in §D above, so this
--     end-of-file append is FK-safe.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000o1',
   'authenticated','authenticated','arief.said@gmail.com',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', '')
on conflict (id) do nothing;

insert into profiles (id, org_id, full_name, email, role, title) values
  ('00000000-0000-0000-0000-0000000000o1',
   '00000000-0000-0000-0000-000000000001',
   'Arief Said','arief.said@gmail.com','Admin','Platform Operator')
on conflict (id) do nothing;

insert into platform_operators (user_id, granted_by) values
  ('00000000-0000-0000-0000-0000000000o1','00000000-0000-0000-0000-0000000000o1')
on conflict (user_id) do nothing;
```
**Also** — append a "Provisioning an Operator (per client)" subsection to `docs/environments.md`
under the ADR-0047 runbook: the same three inserts against a real project's cloud DB (service-role
psql), with the real operator email + a strong password set out-of-band. (Docs-only edit — planner-
allowed.)

**Verify:** `supabase db reset` succeeds; `select is_operator()` under the o1 JWT returns true (spot-
check in a scratch psql, or fold into 0113's assertion block).

**S1 commit gate:** `cd pmo-portal && npm run verify` (unchanged FE; should be green) **and**
`supabase db reset && supabase test db` (0110–0113 green). Commit message:
`feat(ops-admin): DB foundation — profile_status, is_active_member, platform_operators, is_operator, admin_set_user_status RPC, operator seed`.

---

## SLICE S2 — Credits → org-pool (credits/agent_usage/balance migrations + RPCs + creditRateGuard rewire)

**Touches local stack — SERIALIZE (after S1).** ACs: AC-CRE-001, AC-CRE-002, AC-CRE-003.
**Verify gate:** `supabase db reset && supabase test db` + `cd pmo-portal && npm run verify` (the
`creditRateGuard` rewire is unit-tested in vitest).

> **Intra-slice atomicity (binding — I2).** Migration 0062 (Task S2-A) widens `credits_select` to
> own-org Admin+Exec only. The **current** `creditRateGuard.computeBalance`
> (`supabase/functions/_shared/creditRateGuard.ts:31-34` — verified) reads
> `.from('credits').select('amount').eq('owner_id', userId)` + `agent_usage…eq('owner_id', userId)`, so
> under 0062 an ordinary member's deputy JWT reads **0** credits → `AGENT_CREDITS_ENFORCED` would block
> every non-Admin/Exec user until Task S2-C rewires the guard to the `org_credit_balance` RPC. The
> merged-slice state is safe, **but no intermediate commit between migration 0062 and the creditRateGuard
> rewire (S2-C) may land on `dev`**; the slice verify gate runs the **composed** S2 (S2-A + S2-B + S2-C
> together), never a sub-task checkpoint after S2-A alone.

### Task S2-A — `0062_credits_org_pool.sql` (drop NOT NULL owner_id, flip INSERT→is_operator(), widen SELECT, add index) (TDD: pgTAP 0114 + 0115)

**Failing tests first.**
`supabase/tests/0114_credits_org_pool_balance.test.sql` (AC-CRE-001): fixtures org X with grants
`{1000 (owner_id IS NULL), 250 (owner_id = legacy member)}` and `agent_usage.cost {100, 50}` for two
different `owner_id`s; asserts `org_credit_balance(X)` = `1100` (both grants count regardless of
owner_id) and that querying the **old** per-owner expression over owner_id returns the org total
(not a per-user number). *(This test pins the balance fn too — write it before 0063.)*
`supabase/tests/0115_credits_insert_operator_only.test.sql` (AC-CRE-002): asserts an org-Admin JWT
`INSERT INTO credits(org_id,owner_id,amount) VALUES (X,NULL,99999)` → `42501` (revenue hole closed);
the Operator JWT's same insert → succeeds with `granted_by` stamped; org-Admin/Exec `SELECT` returns
their own-org credits rows; a plain Engineer `SELECT` returns 0 (no credits SELECT for them).

**Then implement** — `supabase/migrations/0062_credits_org_pool.sql`:
```sql
-- 0062 — credits org-pool refactor (FR-CRE-001/003, AC-CRE-002). NON-DESTRUCTIVE: no backfill.
--   owner_id -> nullable (legacy non-null grants STILL COUNT, FR-CRE-001).
--   credits_insert: auth_role()='Admin' -> is_operator() ONLY (revenue-hole fix, cited against 0047).
--   credits_select: owner_id=auth.uid() -> own-org Admin+Exec (grants VIEW only).
--   + credits(org_id) index (NFR-PERF-001; credits(owner_id) from 0047 retained for attribution).
-- Reversibility: supabase db reset. Manual reverse:
--   drop index if exists public.credits_org_idx;
--   drop policy if exists credits_insert on credits; drop policy if exists credits_select on credits;
--   alter table public.credits alter column owner_id set not null;
--   (then re-create the 0047 policies verbatim to fully restore.)

alter table public.credits alter column owner_id drop not null;

create index if not exists credits_org_idx on public.credits (org_id);

drop policy if exists credits_select on public.credits;
-- own-org read for Admin+Executive (the grants view). An Operator gets NO broadened credits SELECT —
-- cross-org grant reads go ONLY through operator_grant_credits/usage RPCs (FR-OPR-004 / FR-CRE-003).
create policy credits_select on public.credits for select
  using (org_id = auth_org_id()
         and auth_role() in ('Admin','Executive')
         and public.is_active_member());

drop policy if exists credits_insert on public.credits;
-- Operator-ONLY. The append-only-by-omission contract (no UPDATE/DELETE for anyone) is unchanged.
-- granted_by is server-stamped (default auth.uid() from 0047); org_id is the Operator-supplied p_org_id
-- (the RPC asserts it). Owner-pinning is dropped: new grants write owner_id IS NULL (FR-CRE-001).
create policy credits_insert on public.credits for insert
  with check (
    public.is_operator()
    and org_id = auth_org_id()       -- still caller-org-pinned under the Operator's own membership
    and public.is_active_member()    -- defense-in-depth with 0059's conjunct on credits_insert
  );
```
> **Note on `org_id = auth_org_id()` for the Operator INSERT:** an Operator is *also* a member of
> their home org (the seed grants them a profile in org `…0001`). New Operator grants target that org.
> When ADR-0047 multi-org lands, the grant RPC will mint/resolve the Operator's session org per
> `p_org_id`; the FE/RPC contract (`operator_grant_credits(p_org_id,…)`) already takes the explicit
> param. **AC-CRE-002's Operator-INSERT-succeeds case** is therefore exercised under the Operator's
> home-org JWT; the RPC (0063) is the cross-org path.

**Verify:** `supabase db reset && supabase test db -- 0115` → green; 0114 still red (no balance fn yet). ✓

### Task S2-B — `0063_org_credit_balance.sql` (balance fn + `operator_grant_credits` RPC) (TDD: pgTAP 0114 completes)

**Then implement** — `supabase/migrations/0063_org_credit_balance.sql`:
```sql
-- 0063 — org_credit_balance() + operator_grant_credits() (FR-CRE-002/005, FR-OPR-004, AC-CRE-001/004).
--   balance = sum(credits.amount where org_id=X regardless of owner_id) - sum(agent_usage.cost where org_id=X).
--   Security-definer so ANY member of the org can read their own pool for the RateGuard metering path
--   WITHOUT needing credits SELECT (credits SELECT is Admin+Exec only — FR-CRE-003). Asserts p_org_id =
--   auth_org_id() so a member reads only their own org; the Operator cross-org path is operator_usage_summary.
-- Reversibility: supabase db reset. Manual: drop function operator_grant_credits; drop function org_credit_balance;

create or replace function public.org_credit_balance(p_org_id uuid) returns numeric
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select sum(amount) from public.credits    where org_id = p_org_id), 0
  ) - coalesce(
    (select sum(cost)   from public.agent_usage where org_id = p_org_id), 0
  )
$$;

create or replace function public.operator_grant_credits(
  p_org_id uuid,
  p_amount numeric,
  p_note   text
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';   -- Operators cannot grant into a nonexistent org
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_positive' using errcode = '23514'; -- maps to the CHECK violation toast
  end if;
  insert into public.credits (org_id, owner_id, amount, note, granted_by)
    values (p_org_id, null, p_amount, p_note, auth.uid());
end $$;

revoke all on function public.org_credit_balance(uuid) from public;
grant execute on function public.org_credit_balance(uuid) to authenticated;
revoke all on function public.operator_grant_credits(uuid,numeric,text) from public;
grant execute on function public.operator_grant_credits(uuid,numeric,text) to authenticated;
```
**Verify:** `supabase db reset && supabase test db -- 0114` → green. ✓

### Task S2-C — `creditRateGuard` rewire: per-owner → per-org (TDD: vitest first) (AC-CRE-003)

**Failing test first** — `pmo-portal/src/lib/agent/__tests__/creditRateGuard.test.ts` (new file): the
existing test mocks `supabase.from('credits').select('amount').eq('owner_id', …)` + `agent_usage…eq
('owner_id', …)`. **Rewrite it** to assert the guard calls `.rpc('org_credit_balance', { p_org_id })`
once and returns `{ exceeded, reason }`: balance `+500` → `{ exceeded:false, reason:'out_of_credits' }`;
balance `0` → `{ exceeded:true, reason:'out_of_credits' }`; RPC error → `{ exceeded:true,
reason:'meter_error' }` (M2 — fail-closed but distinguishable). This vitest is a **mocked shape** test
for the guard's JS branch only — it is **NOT** the owner of AC-CRE-003; the owning proof is pgTAP 0116
(Task S2-D), which switches JWTs between two org-X members per the spec's `[pgTAP]` tag.

**Then implement** — edit `supabase/functions/_shared/creditRateGuard.ts`:
```ts
// BEFORE (per-owner): two raw SELECTs eq('owner_id', userId).
// AFTER (per-org, FR-CRE-002/004): one RPC call eq org_id = the caller's org.
export interface CreditRateGuardDeps {
  supabase: HandlerSupabaseLike;
}

export interface RateGuardResult {
  exceeded: boolean;
  retryAfterSeconds: number;
  /** 'out_of_credits' = balance <= 0 (the normal FR-CRE-004 path); 'meter_error' = the RPC itself
   *  failed — fail-closed (exceeded:true) BUT distinguishable, so the deputy/automation surface can
   *  show an honest "meter temporarily unavailable" message instead of a false "out of credits". */
  reason: 'out_of_credits' | 'meter_error';
}

export function createCreditRateGuard(deps: CreditRateGuardDeps): {
  check(orgId: string): Promise<RateGuardResult>;   // <-- userId -> orgId
} {
  return {
    async check(orgId: string): Promise<RateGuardResult> {
      const { data, error } = await deps.supabase
        .rpc('org_credit_balance', { p_org_id: orgId });
      // org_credit_balance asserts p_org_id = auth_org_id() server-side; the deputy caller reads
      // their OWN org pool (FR-CRE-004, ADR-0044 §6). On RPC error, fail-OPEN is WRONG for a meter —
      // fail closed (exceeded:true) BUT distinguishable: return reason:'meter_error' so the
      // deputy/automation surface can show an honest "meter temporarily unavailable" instead of a
      // false "out of credits". The normal balance<=0 path returns reason:'out_of_credits' — the
      // existing FR-CRE-004 RATE_LIMITED/out-of-credits UX is UNCHANGED; 'meter_error' is a new,
      // rarer state surfaced alongside it (M2). Call-sites branch on `reason` for the message.
      if (error || typeof data !== 'number') {
        return { exceeded: true, retryAfterSeconds: 0, reason: 'meter_error' };
      }
      return { exceeded: data <= 0, retryAfterSeconds: 0, reason: 'out_of_credits' };
    },
  };
}
```
**Then update call-sites** (verified paths — the guard is invoked in the **handlers**, not the
`index.ts` wrappers):
- `supabase/functions/agent-chat/handler.ts:982` (`deps.rateGuard.check(deps.userId)` — Gate 3,
  fresh-send) and `:1344` (`isCreditExhausted(deps)` — the decision/answer continuation gate).
- `supabase/functions/compose-view/handler.ts:175` (`rateGuard.check(userId)` — Gate 4).
- `supabase/functions/agent-dispatch/index.ts:127` (`guard.check(userId, mintedClient)`) — the inline
  guard delegates to the dispatcher's `RateGuard.check(userId, mintedClient)`
  (`supabase/functions/agent-dispatch/dispatcher.ts:229`), invoked per-fired-automation.

Change `check(userId)` → `check(orgId)` at each. **orgId source — verified, NOT JWT claims:**
- **agent-chat** resolves `orgId` from the **profiles row** (DB lookup, `handler.ts:905-915`:
  `.from('profiles').select('org_id, role').eq('id', userId).single()` → `orgId = data.org_id`; also
  carried as `deputyCtx.orgId`, `handler.ts:529`). At `:982` this `orgId` is in scope (same run path,
  post-resolution); at `:1344` `isCreditExhausted(deps)` does **not** receive orgId today — **add an
  `orgId` param** to `isCreditExhausted` (or an `orgId` field on `HandlerDeps`) and thread the
  resolved value (`HandlerDeps` currently has `userId` but no `orgId`, `handler.ts:158-167`).
- **compose-view** resolves `profileOrgId` from the **profiles row** (`handler.ts:148-158`; the file's
  header comment at `:16` states verbatim *"org_id derived from profiles under caller JWT (not JWT
  claims)"*), cross-checked against the client `req.orgId` at `:166`. At `:175` use `profileOrgId`
  (or the already-equal `req.orgId`).
- **agent-dispatch** — the fired run's org is `automation.org_id` (the **`agent_automations` row**,
  `dispatcher.ts:28` — the selection-time tenancy gate), NOT the minted owner's home-org profile and
  NOT a JWT claim. Change `guard.check(userId, mintedClient)` → `guard.check(automation.org_id,
  mintedClient)` at the dispatch call site (the `userId` arg today is the minted owner).

**Resolution task step (mandatory):** where a handler does not yet have `orgId` in scope at the guard
call, resolve it from the **profiles row under the caller JWT** (interactive paths) or the
**`agent_automations` row** (dispatch path) as specified above — never from JWT claims, never a
default. This is required for `agent-chat`'s `:1344` path (`isCreditExhausted`); the other call-sites
already have the value in scope.

**Reconcile the spec:** add a one-line pointer at the top of `docs/specs/agent-usage-credits.spec.md`
FR-AUC-010: *"Amended by ADR-0049 / ops-admin-surface: balance scope is per-org (`org_id`), not per-
owner; the per-owner wording here is the pre-org-pool baseline."* (Docs-only edit.)

### Task S2-D — pgTAP 0116 `credits_enforced_org_pool` (AC-CRE-003 — SINGLE owning test)

`supabase/tests/0116_credits_enforced_org_pool.test.sql` is the **single owning test** for AC-CRE-003
(the spec tags it `[pgTAP]`). It fixtures org X with **two members** (member A, member B — both
`status='active'`, same `org_id`) and a balance of 0 (one grant fully consumed by `agent_usage.cost`),
then **switches JWT between A and B** and asserts the **identical** exceeded result for both:
1. `set local role authenticated; set local request.jwt.claims = '{"sub":"<A>","role":"authenticated"}'`
   → `select org_credit_balance('X')` `<= 0` → guard-equivalent `exceeded = true`.
2. switch to member B's JWT (same org) → `org_credit_balance('X')` is the **same** `<= 0` value →
   `exceeded = true` (identical to A — this is the AC's *"regardless of which member fired it"*
   clause, proven by the `p_org_id = auth_org_id()` assert inside the RPC: both A and B resolve to org X).
3. an Operator `operator_grant_credits('X', 500, …)` → balance `+500` → under **both** A's and B's JWT
   `org_credit_balance('X') = 500` → `exceeded = false` (identical for both).
The guard's own JS branch (`exceeded = balance <= 0`, plus the `reason` field from M2) is exercised by
the mocked vitest in S2-C, which is a **shape** test only and is **NOT** the owner of this AC.

**Verify:** `supabase db reset && supabase test db` (0114/0115/0116 green) + `cd pmo-portal && npm run
verify` (creditRateGuard vitest green; the edge-fn call-site edits compile under the `deno-check` gate).

**S2 commit gate:** all of the above green. Commit:
`feat(credits): org-pool balance + Operator-only INSERT (revenue-hole fix) + creditRateGuard per-org`.

---

> **⚑ Cross-issue contract (from the auth-floor e2e build, 2026-07-04):** the real `admin-invite-user`
> edge fn's `auth.admin.inviteUserByEmail` call MUST pass `redirectTo: <origin>/update-password` —
> without it GoTrue resolves the invite link to the bare `site_url` and the invitee never reaches the
> set-password page (verified live; the auth-floor spec's INVITE_PENDING contract + AC-AUTHF-020
> e2e depend on it). Also stamp `user_metadata.invite_pending = true` per that spec's §1.2 contract.

## SLICE S3 — `admin-invite-user` edge fn (issuance) + pure handler logic

**No `db reset`** (Deno wrapper + vitest-tested pure logic). Depends on S1 (`is_operator()`). Supports
AC-INV-001 (the e2e in S7 owns it). Boundary: **issuance only** — no email body / SMTP / link /
redirect (that is `auth-production-floor`).

### Task S3-A — Pure handler logic in `pmo-portal/src/lib/invite/inviteHandler.ts` (TDD: vitest first)

Mirror the agent-dispatch precedent: edge fns import pure logic from `pmo-portal/src/...` and that
logic is vitest-tested with an injected `SupabaseLike` (no `@supabase/supabase-js` import in the pure
module). FR-INV-004/005.

**Failing tests first** — `pmo-portal/src/lib/invite/__tests__/inviteHandler.test.ts`:
- `authorizes org-Admin (own org)`: caller profile role Admin in org X → returns target org X, no reject.
- `authorizes Operator`: `is_operator()` true → target org = body `p_org_id` (validated to exist).
- `rejects non-Admin/non-Operator` → throws `INVITE_UNAUTHORIZED` (401/403).
- `rejects duplicate email in target org` → throws mapped to `23505`-style `DUPLICATE_EMAIL`.
- `rejects invalid role` → `INVALID_ROLE` (role not in the 5-value enum).
- `rejects Operator invite into nonexistent org` → `UNKNOWN_ORG`.
- `builds the profiles insert payload` `{org_id, role, status:'active'}` (org_id NEVER client-decided
  except for the Operator's `p_org_id`, which is server-validated to exist).

**Then implement** — `pmo-portal/src/lib/invite/inviteHandler.ts`:
```ts
// Pure, Deno+vitest-importable. No @supabase/supabase-js import.
import type { UserRole } from '@/src/lib/db/adminUsers';

export const INVITE_ROLES: UserRole[] =
  ['Engineer','Project Manager','Finance','Executive','Admin'];

export interface InviteSupabaseLike {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: { code?: string; message: string } | null }>;
  from(t: string): {
    select(c: string): { eq(c: string, v: unknown): { single(): Promise<{ data: unknown | null; error: { code?: string; message: string } | null }> } };
  };
}

export interface InviteInput { email: string; role: string; p_org_id?: string | null; }

export class InviteError extends Error {
  constructor(public code: 'INVITE_UNAUTHORIZED'|'DUPLICATE_EMAIL'|'INVALID_ROLE'|'UNKNOWN_ORG'|'BAD_EMAIL', public status: number) { super(code); }
}

/** Resolve + authorize. Returns { targetOrgId, role } on success; throws InviteError otherwise. */
export async function authorizeInvite(
  db: InviteSupabaseLike,
  callerUid: string,
  input: InviteInput,
): Promise<{ targetOrgId: string; role: UserRole }> {
  const email = (input.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new InviteError('BAD_EMAIL', 400);
  if (!INVITE_ROLES.includes(input.role as UserRole)) throw new InviteError('INVALID_ROLE', 400);

  // Operator?
  const { data: isOp } = await db.rpc<boolean>('is_operator');
  const operator = isOp === true;

  // Caller profile (RLS-scoped to caller under their JWT).
  const { data: profile, error } = await db.from('profiles')
    .select('org_id,role,email').eq('id', callerUid).single();
  const p = (profile ?? null) as { org_id: string; role: UserRole; email: string } | null;
  if (error || !p) throw new InviteError('INVITE_UNAUTHORIZED', 401);

  const adminInOrg = p.role === 'Admin';
  if (!operator && !adminInOrg) throw new InviteError('INVITE_UNAUTHORIZED', 403);

  // Target org: Operator may pick p_org_id (validated to exist); org-Admin is pinned to their own org.
  let targetOrgId: string;
  if (operator && input.p_org_id) {
    const { data: exists } = await db.rpc<boolean>('operator_org_exists', { p_org_id: input.p_org_id });
    if (!exists) throw new InviteError('UNKNOWN_ORG', 400);
    targetOrgId = input.p_org_id;
  } else {
    targetOrgId = p.org_id; // org-Admin (and Operator-not-overriding) invite into their own org
  }

  // Duplicate-in-target-org check (FR-INV-005): scoped to target org (no cross-org leak to org-Admin).
  const { data: dup } = await db.rpc<boolean>('org_has_member_email', { p_org_id: targetOrgId, p_email: email });
  if (dup) throw new InviteError('DUPLICATE_EMAIL', 409);

  return { targetOrgId, role: input.role as UserRole };
}
```
> Two tiny helper RPCs are needed (`operator_org_exists`, `org_has_member_email`) — add them to
> **migration 0061** (extend Task S1-D's file with two more `security definer` fns, both asserting
> the caller is an Operator for `operator_org_exists` and reading only the caller's org for
> `org_has_member_email` when the caller is an org-Admin; for an Operator calling
> `org_has_member_email`, assert `is_operator()`). This keeps S3 a no-new-migration slice (the RPCs
> ship in S1's migration file). **Plan correction:** move these two helper RPCs into 0061 — add a
> Task **S1-F** below.

**Task S1-F (folded into S1's migration 0061)** — add to `0061_admin_set_user_status.sql`:
```sql
-- invite-helper RPCs (FR-INV-005). operator_org_exists: Operator-only org existence probe.
create or replace function public.operator_org_exists(p_org_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_operator() and exists (select 1 from public.organizations where id = p_org_id)
$$;
-- org_has_member_email: Operator (any org) OR Admin-in-org (own org) email-membership probe.
-- Scoped to the target org: no cross-org leak to an org-Admin (FR-INV-005 conscious decision).
create or replace function public.org_has_member_email(p_org_id uuid, p_email text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
     where lower(pr.email) = lower(p_email)
       and (
         public.is_operator()
         or (pr.org_id = p_org_id and p_org_id = public.auth_org_id() and public.auth_role() = 'Admin')
       )
       -- for a non-Operator caller, RLS-equivalent scoping: only count rows in p_org_id == caller org
       and (public.is_operator() or pr.org_id = public.auth_org_id())
  )
$$;
revoke all on function public.operator_org_exists(uuid) from public;
grant execute on function public.operator_org_exists(uuid) to authenticated;
revoke all on function public.org_has_member_email(uuid,text) from public;
grant execute on function public.org_has_member_email(uuid,text) to authenticated;
```
(Update S1's verify to include these two RPCs in 0111's assertion block: an org-Admin probing an
email in their own org works; probing across orgs returns the email as "not present" — no leak.)

### Task S3-B — Deno wrapper `supabase/functions/admin-invite-user/index.ts` (thin, integration-only)

Copy the `agent-dispatch/index.ts` skeleton (bearer check + service-client construction). The wrapper:
1. Reads `Authorization: Bearer <caller JWT>`; if absent → `401`.
2. Builds `callerClient` = `createClient(URL, ANON_KEY, { global: { headers: { Authorization: bearer } } })`.
3. Reads the caller uid from the JWT (`getUser()`); if it fails → `401`.
4. Calls `authorizeInvite(callerClient-as-InviteSupabaseLike, uid, body)` (the pure logic). On
   `InviteError` → respond `{ error: code }` with `InviteError.status`.
5. Builds `serviceClient` = `createClient(URL, SERVICE_ROLE_KEY)`; calls
   `serviceClient.auth.admin.inviteUserByEmail(email)`; on success inserts the `profiles` row via
   `serviceClient.from('profiles').insert({ id: <invited user's id from the invite result or a fresh
   gen_random_uuid resolved server-side>, org_id: targetOrgId, role, status:'active', email,
   full_name: '' })`. **The service-role key is NEVER returned to the client and is NEVER exercised
   for an unauthorized caller** (the pure logic rejects before the service client is touched — FR-INV-004 SHALL).
6. Boundary: NO email body / SMTP / redirect — `inviteUserByEmail` uses Supabase's default invite
   template; the accept flow is `auth-production-floor`.
```ts
// supabase/functions/admin-invite-user/index.ts (Deno) — thin wrapper, mirrors agent-dispatch/index.ts.
import { createClient } from '@supabase/supabase-js';
import { authorizeInvite, InviteError } from '../../../pmo-portal/src/lib/invite/inviteHandler.ts';

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const svc  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearer = req.headers.get('Authorization') ?? '';
  if (!bearer.startsWith('Bearer ')) return json({ error:'UNAUTHORIZED' }, 401);
  if (!url || !anon || !svc) return json({ error:'MISCONFIGURED' }, 500);

  const callerClient = createClient(url, anon, { global: { headers: { Authorization: bearer } } });
  const { data: ud } = await callerClient.auth.getUser();
  const uid = ud?.user?.id;
  if (!uid) return json({ error:'UNAUTHORIZED' }, 401);

  let body: { email?: string; role?: string; p_org_id?: string | null };
  try { body = await req.json(); } catch { return json({ error:'BAD_BODY' }, 400); }

  let authed: { targetOrgId: string; role: string };
  try {
    authed = await authorizeInvite(callerClient as never, uid, {
      email: body.email ?? '', role: body.role ?? '', p_org_id: body.p_org_id ?? null,
    });
  } catch (e) {
    if (e instanceof InviteError) return json({ error: e.code }, e.status);
    return json({ error:'INVITE_FAILED' }, 500);
  }

  // service-role issuance — only reached for an authorized caller.
  const serviceClient = createClient(url, svc);
  const { data: invite, error } = await serviceClient.auth.admin.inviteUserByEmail(body.email!.trim());
  if (error) return json({ error:'INVITE_ISSUE_FAILED' }, 502);
  const { error: pErr } = await serviceClient.from('profiles').insert({
    id: invite!.id, org_id: authed.targetOrgId, role: authed.role, status: 'active',
    email: body.email!.trim(), full_name: '',
  });
  if (pErr) return json({ error:'PROFILE_CREATE_FAILED' }, 502);
  return json({ ok: true }, 200);
});
function json(b: unknown, s: number) { return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type':'application/json' } }); }
```
**Verify:** `cd pmo-portal && npm run verify` (inviteHandler vitest green; `deno-check` on the wrapper
green via the existing CI gate). The e2e (AC-INV-001) exercises this fn end-to-end in S7.

**S3 commit gate:** green. Commit: `feat(invite): admin-invite-user edge fn (issuance) — Admin-in-org or Operator, service-role invite + profile`.

---

## SLICE S4 — AdminUsers UI: Users section (invite modal + Disable/Re-enable + `useIsOperator` + repo seam)

**No `db reset`.** ACs: AC-INV-004 (Unit/RTL), AC-OPR-003 (Unit/RTL). Depends on S1, S3.
**DESIGN.md tokens / shared primitives used:** `EntityFormModal`, `useEntityForm`, `TextField`,
`SelectField` (role picker), `ConfirmDialog` (destructive-styled disable), `GateNotice`
(`variant="blocked"`), `classifyMutationError`, `StatusPill`, `Button`, `Icon`, `useToast`. Root font
16px → 32px controls.

### Task S4-A — Repository seam: extend `profile` + add `operator` (TDD: vitest first)

**Failing test first** — `pmo-portal/src/lib/repositories/__tests__/index.test.ts` (extend existing):
assert `repositories.profile.inviteUser(input)` calls the admin-invite-user edge fn via
`supabase.functions.invoke('admin-invite-user', …)`, and `repositories.profile.setUserStatus({id,
status, orgId})` calls `.rpc('admin_set_user_status', …)`; and `repositories.operator.isOperator()`
calls `.rpc('is_operator')` and returns the boolean.

**Then implement:**

`pmo-portal/src/lib/db/adminUsers.ts` — add (org_id never sent on setUserStatus except as the
required `p_org_id` RPC arg, which the RPC re-validates against the target's real org):
```ts
import type { profile_status } from '…generated-types'; // or a local union 'active'|'disabled'

export async function inviteUser(input: { email: string; role: UserRole; pOrgId?: string | null }): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-invite-user', {
    body: { email: input.email, role: input.role, p_org_id: input.pOrgId ?? null },
  });
  if (error) throwWrite(error as PostgrestErrorLike);
}

export async function setUserStatus(args: { id: string; status: 'active'|'disabled'; orgId: string }): Promise<void> {
  const { error } = await supabase.rpc('admin_set_user_status', {
    p_profile_id: args.id, p_status: args.status, p_org_id: args.orgId,
  });
  if (error) throwWrite(error);
}
```
`pmo-portal/src/lib/db/operators.ts` (new):
```ts
export async function isOperator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_operator');
  if (error) throw new AppError(error.message, error.code);
  return data === true;
}
```
`pmo-portal/src/lib/repositories/types.ts` — extend `ProfileRepository` with
`inviteUser(input): Promise<void>` and `setUserStatus(args): Promise<void>`; add
`OperatorRepository { isOperator(): Promise<boolean> }`; add `operator: OperatorRepository` to
`Repositories`. `pmo-portal/src/lib/repositories/index.ts` — wire the two new methods + the `operator`
repository (thin `wrap()` wrappers, mirroring the existing rows).

### Task S4-B — `useIsOperator()` + `useUserMutations` extension (TDD: vitest+RTL)

**Failing test first** — `pmo-portal/src/hooks/__tests__/useIsOperator.test.tsx`: mocks the
`is_operator` RPC true/false; asserts the hook returns the boolean and caches via react-query (key
`['operator','isOperator']`).

**Then implement** — `pmo-portal/src/auth/useIsOperator.ts` (new):
```ts
import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
/** Clarity projection ONLY (ADR-0016/0049). Every Operator power is re-asserted server-side by the RPC. */
export function useIsOperator(): boolean {
  const { data } = useQuery({ queryKey: ['operator','isOperator'], queryFn: () => repositories.operator.isOperator() });
  return data === true;
}
```
Extend `pmo-portal/src/hooks/useUsers.ts` `useUserMutations()` with `invite: useMutation(…)` and
`setStatus: useMutation(…)` mirroring the existing `updateRole`/`assignManager` shape (invalidate
`['users']` on success).

### Task S4-C — AdminUsers.tsx: wire "Add user" + Disable/Re-enable row actions (AC-INV-004, AC-OPR-003)

**Failing tests first**:
- `pmo-portal/pages/__tests__/AdminUsers.disable.test.tsx` (AC-INV-004): renders the directory as the
  sole org-Admin; the row-menu "Disable" on themselves and on the sole Admin both surface the
  classified lockout toast (RPC `P0001`) and the row stays `active`; the disable confirm dialog
  (`ConfirmDialog tone="destructive"`) appears for a non-self target and commits on confirm.
- `pmo-portal/pages/__tests__/Administration.operatorGate.test.tsx` (AC-OPR-003): renders the page for
  (a) the seeded Operator → the "Grant credits" control, the Feature toggles, and the org-switcher are
  present; (b) a plain org-Admin → those are absent (read-only variants). (The Credits/Features
  *sections* themselves land in S2-UI-after-S5/S6; this test asserts the **affordance gating** via
  `useIsOperator`, stubbing the not-yet-built sections to `null` until their slices — re-finalize the
  assertions when S5/S6 land.)

**Then implement** — edit `pmo-portal/pages/AdminUsers.tsx`:
- Remove the interim `PageHead` "Copy invite instructions" affordance + `INVITE_INSTRUCTIONS` constant
  (FR-INV-006: the invite edge fn replaces it).
- Replace the disabled "Add user" control with a real `<Button variant="primary" onClick={() =>
  setInviteOpen(true)}>` gated on `may('create','user') || isOperator` (the Operator may invite even
  if their `profiles.role` isn't 'Admin' — `useIsOperator` is the OR-clause).
- Add an `InviteFormModal` (new, `EntityFormModal` + `TextField` email + `SelectField` role) that
  calls `invite.mutateAsync({ email, role, pOrgId: isOperator ? selectedOrgId : null })`; on
  `23505`-class `DUPLICATE_EMAIL` → `classifyMutationError` → "That person is already in your
  workspace" toast; on `INVITE_UNAUTHORIZED` → "You don't have permission…" warning.
- Add row-menu items "Disable" (danger) when `u.status==='active'` and "Re-enable" when `u.status===
  'disabled'`, both gated on `canManage || isOperator`. Disable opens `ConfirmDialog tone="destructive"`;
  confirm calls `setStatus.mutateAsync({ id: u.id, status:'disabled', orgId: u.org_id })`. On RPC
  `P0001` ("lockout") → `classifyMutationError` → "You can't disable the only Admin" toast; row unchanged.
- `UserRow` type gains `status: 'active'|'disabled'`; render a `StatusPill` (neutral when active, a
  muted `warning` tint when disabled) so a disabled member is visible in the directory.

> **The Credits/Usage/Features sections** are added to the *composed* `/administration` page in later
> slices (S5, S6). To keep S4 independently green, those sections render as `null` placeholders until
> their slice — i.e. S4 ships the Users section fully and leaves `renderCreditsSection()={null}` etc.
> (literal `null`, not a fake UI) until S5/S6 swap in the real sections. AC-OPR-003's affordance-gate
> assertions are finalized when the sections exist.

**Verify:** `cd pmo-portal && npm run verify` → AC-INV-004 + AC-OPR-003 green.

**S4 commit gate:** green. Commit: `feat(admin-ui): invite (admin-invite-user) + disable/re-enable + useIsOperator affordance gating`.

---

## SLICE S5 — Usage view (`agent_usage` columns + summary RPCs + page section + margin)

**Touches local stack — SERIALIZE (after S2).** ACs: AC-USE-001, AC-USE-002, AC-PRIV-001, AC-USE-003.

### Task S5-A — `0064_agent_usage_usage_columns.sql` (TDD: pgTAP 0118 first)

**Failing test first** — `supabase/tests/0118_usage_aggregate_columns.test.sql` (AC-USE-002): fixtures
`agent_usage` rows with known `(prompt_tokens, completion_tokens, provider_cost_usd, cost, action)`;
asserts `org_usage_summary()` / `operator_usage_summary()` return run-count, Σprompt, Σcompletion,
Σprovider_cost_usd, Σcost, per `(owner_id, action, month)` exactly. (Write against the not-yet-existing
RPC so it fails red.)

**Then implement** — `supabase/migrations/0064_agent_usage_usage_columns.sql`:
```sql
-- 0064 — agent_usage gains provider_cost_usd + action (FR-USE-001). cost stays the credit charge.
-- Reversibility: supabase db reset. Manual:
--   drop index if exists public.agent_usage_org_created_idx;
--   alter table public.agent_usage drop column if exists action;
--   alter table public.agent_usage drop column if exists provider_cost_usd;

alter table public.agent_usage
  add column provider_cost_usd numeric not null default 0,
  add column action          text     not null default 'chat';

-- NFR-PERF-001: the usage RPC filters/group on (org_id, owner_id, action, date_trunc('month', created_at)).
-- The existing (owner_id, created_at) index from 0047 is RETAINED for the per-user path.
create index if not exists agent_usage_org_created_idx on public.agent_usage (org_id, created_at);

-- constrain action to the call-site kinds (FR-USE-001).
alter table public.agent_usage add constraint agent_usage_action_chk
  check (action in ('chat','compose','automation'));
```

### Task S5-B — `0065_usage_summary_rpcs.sql` (operator_usage_summary + org_usage_summary + operator_list_orgs) (TDD: pgTAP 0117 + 0119)

**Failing tests first.**
`supabase/tests/0117_usage_operator_vs_admin_scope.test.sql` (AC-USE-001): fixtures usage in orgs A+B;
asserts the Operator's `operator_usage_summary()` (no filter) returns both orgs' aggregates, and an
org-A Admin's `org_usage_summary()` returns only org A.
`supabase/tests/0119_ops_admin_no_transcript_reads.test.sql` (AC-PRIV-001 — the privacy line): asserts
(a) under an Operator JWT and an org-Admin JWT, `SELECT` from `agent_events`/`agent_runs`/
`agent_threads` yields 0 rows; (b) the `operator_usage_summary`/`org_usage_summary` dependency graph
reaches **only** `agent_usage` — proven by `pg_depend` + a `pg_proc.prosrc` text scan asserting no
`agent_events`/`agent_runs`/`agent_threads` token appears in any transitively-referenced function body,
and the only table relation reached from the RPCs is `agent_usage`.

**Then implement** — `supabase/migrations/0065_usage_summary_rpcs.sql`:
```sql
-- 0065 — usage aggregate RPCs (FR-USE-002/003/004/006, FR-OPR-004). AGGREGATES ONLY — never read
-- agent_events/agent_runs/agent_threads (NFR-PRIV-001, AC-PRIV-001). margin_usd is conditional on
-- CREDITS_PER_USD (null when unset, FR-USE-006). operator_list_orgs returns directory cols only.
-- Reversibility: supabase db reset. Manual: drop the 3 fns.

create or replace function public.org_usage_summary()
returns table (
  owner_id uuid, action text, month date,
  run_count bigint, prompt_tokens bigint, completion_tokens bigint,
  provider_cost_usd numeric, cost numeric, margin_usd numeric
)
language sql stable security definer set search_path = public as $$
  with rates as (
    select nullif(current_setting('app.credits_per_usd', true), '')::numeric as cpu
  )
  select owner_id, action, date_trunc('month', created_at)::date as month,
         count(*)::bigint,
         coalesce(sum(prompt_tokens),0)::bigint,
         coalesce(sum(completion_tokens),0)::bigint,
         coalesce(sum(provider_cost_usd),0),
         coalesce(sum(cost),0),
         case when (select cpu from rates) is null or (select cpu from rates) <= 0 then null
              else (coalesce(sum(cost),0) / (select cpu from rates)) - coalesce(sum(provider_cost_usd),0)
         end
    from public.agent_usage
   where org_id = public.auth_org_id() and public.is_active_member()
   group by owner_id, action, date_trunc('month', created_at)
   order by month desc, owner_id, action
$$;

create or replace function public.operator_usage_summary(p_org_id uuid default null)
returns table (
  org_id uuid, owner_id uuid, action text, month date,
  run_count bigint, prompt_tokens bigint, completion_tokens bigint,
  provider_cost_usd numeric, cost numeric, margin_usd numeric
)
language sql stable security definer set search_path = public as $$
  with rates as (select nullif(current_setting('app.credits_per_usd', true), '')::numeric as cpu)
  select org_id, owner_id, action, date_trunc('month', created_at)::date as month,
         count(*)::bigint, coalesce(sum(prompt_tokens),0)::bigint, coalesce(sum(completion_tokens),0)::bigint,
         coalesce(sum(provider_cost_usd),0), coalesce(sum(cost),0),
         case when (select cpu from rates) is null or (select cpu from rates) <= 0 then null
              else (coalesce(sum(cost),0) / (select cpu from rates)) - coalesce(sum(provider_cost_usd),0)
         end
    from public.agent_usage
   where public.is_operator()
     and (p_org_id is null or org_id = p_org_id)
   group by org_id, owner_id, action, date_trunc('month', created_at)
   order by month desc, org_id, owner_id, action
$$;

-- operator_list_orgs: directory columns ONLY (FR-OPR-004) — no business-data aggregates leak here.
create or replace function public.operator_list_orgs()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from public.organizations where public.is_operator() order by name
$$;

revoke all on function public.org_usage_summary() from public;
grant execute on function public.org_usage_summary() to authenticated;
revoke all on function public.operator_usage_summary(uuid) from public;
grant execute on function public.operator_usage_summary(uuid) to authenticated;
revoke all on function public.operator_list_orgs() from public;
grant execute on function public.operator_list_orgs() to authenticated;
```
> `CREDITS_PER_USD` is read via `current_setting('app.credits_per_usd', true)` (a per-session GUC the
> edge fns / a future pricing service sets; unset → `''` → `null` → margin null/hidden). The FE reads
> `margin_usd` and hides the column when every row is null (AC-USE-003).

### Task S5-C — Edge fns: populate `provider_cost_usd` + `action` (FR-USE-001)

Edit `supabase/functions/_shared/usage.ts` `UsageFields` + `recordUsage`/`insertUsageRow` to include
`provider_cost_usd` (from `ModelResponse.usage.total_cost` — already read as `cost` today; **rename
the existing `cost` semantic**: `cost` = credit charge (unchanged), `provider_cost_usd` = the same
`total_cost` value captured alongside — clarify the doc-comment that today they are equal and diverge
only when a pricing rate is introduced). Add `action: 'chat'|'compose'|'automation'` param threaded
from the two call-sites: `agent-chat` → `'chat'`; `compose-view` → `'compose'`; `agent-dispatch` fired
run → `'automation'`. Each call-site passes its `action` literal. Vitest: extend the existing
`usage.test.ts` to assert the new columns are inserted.

### Task S5-D — Repository + hook + Usage section (AC-USE-003 Unit/RTL)

**Failing test first** — `pmo-portal/pages/__tests__/Administration.usage.margin.test.tsx` (AC-USE-003):
renders the Usage section with `margin_usd` all-null → the column is absent and a "Pricing not yet
configured" note shows; with at least one non-null margin → the column renders the computed value.

**Then implement:**
- `pmo-portal/src/lib/db/usage.ts` (new) — `getOrgUsageSummary()` (`.rpc('org_usage_summary')`) and
  `getOperatorUsageSummary(orgId?)` (`.rpc('operator_usage_summary', { p_org_id: orgId ?? null })`).
- `repositories/types.ts` + `index.ts` — add `usage: UsageRepository` with those two methods.
- `pmo-portal/src/hooks/useUsage.ts` (new) — react-query; Operator path uses `getOperatorUsageSummary`
  + the org-switcher's selected org; org-Admin path uses `getOrgUsageSummary`.
- `pmo-portal/pages/AdministrationUsage.tsx` (new section component) — a `DataTable` of the summary
  rows; `<ListState variant="error">` with Retry on RPC failure; the `margin_usd` column conditionally
  rendered (AC-USE-003); sourced ONLY from the usage RPC (the privacy line, NFR-PRIV-001). Mount it in
  `AdminUsers.tsx`'s composed page (swap the S4 `null` placeholder).
- Operator org-switcher (Operator-only): a `SelectField`/`Combobox` over `operator_list_orgs()`;
  defaults to the Operator's home org; drives the Usage + Credits sections' `p_org_id`.

**Verify:** `supabase db reset && supabase test db` (0117/0118/0119 green) + `cd pmo-portal && npm run
verify` (usage vitest + AC-USE-003 green).

**S5 commit gate:** green. Commit: `feat(usage): aggregate RPCs + provider_cost_usd/action + Usage section (aggregates-only, margin conditional)`.

---

## SLICE S6 — `org_features` + `useFeature`/`<FeatureGate>` + Admin Features section + route gating + a11y capstone

**Touches local stack — SERIALIZE (after S5).** ACs: AC-ENT-001, AC-ENT-002, AC-ENT-003, AC-ENT-004,
AC-A11Y-001.

### Task S6-A — `0066_org_features.sql` (table + org_has_feature + operator_toggle_feature + RLS) (TDD: pgTAP 0120 + 0121)

**Failing tests first.**
`supabase/tests/0120_org_features_rls.test.sql` (AC-ENT-001): fixtures orgs A+B; an org-A Admin, an
org-A Engineer, and an Operator. Asserts: the Admin AND the Engineer each `SELECT` only org A (all
members read their own org — entitlements are not intra-org secrets); neither can INSERT/UPDATE/
DELETE; the Operator can write any org's row. (Confirms the flip from the 2026-06-15 admin-write note.)
`supabase/tests/0121_org_features_core_never_gated.test.sql` (AC-ENT-002): asserts
`org_has_feature(org,'projects')` returns true even with a disabling row; an INSERT of a disabling
row for a core key is rejected.

**Then implement** — `supabase/migrations/0066_org_features.sql`:
```sql
-- 0066 — org_features (FR-ENT-001..004). PK (org_id, feature_key); CHECK registry; core-never-gated
-- guard at insert. RLS: read all-org-members, write Operator-only (FLIPS the 2026-06-15 note).
-- org_has_feature() ships as the FUTURE server-enforcement hook only (unused by FE; unused by
-- gated-table RLS — UI-first bypass accepted v1, ADR-0049). operator_toggle_feature writes it.
-- Reversibility: supabase db reset. Manual: drop fns; drop table org_features.

create table public.org_features (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  primary key (org_id, feature_key),
  check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
                         'agent_assistant','user_views'))   -- gated candidates (FR-ENT-001); core set excluded
);
create index org_features_org_idx on public.org_features (org_id);

alter table public.org_features enable row level security;
alter table public.org_features force  row level security;

-- READ: every member of the org (entitlements are not intra-org secrets -> useFeature reads directly).
create policy org_features_select on public.org_features for select
  using (org_id = public.auth_org_id() and public.is_active_member());

-- WRITE: Operator-only (the flip). No UPDATE-via-Admin, no DELETE for anyone.
create policy org_features_write on public.org_features for all
  using (public.is_operator() and public.is_active_member())
  with check (public.is_operator() and public.is_active_member()
              and org_id in (select id from public.organizations));  -- Operator may target any existing org

-- org_has_feature: core keys always true; else the row's enabled (absence = included = true).
-- FUTURE server-enforcement hook ONLY (not used by FE, not yet used by gated-table RLS).
create or replace function public.org_has_feature(p_org_id uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_key in ('projects','dashboard','approvals','administration') then true
              else coalesce((select enabled from public.org_features
                              where org_id = p_org_id and feature_key = p_key), true)
         end
$$;

-- operator_toggle_feature: upsert a row; reject core keys; assert Operator.
create or replace function public.operator_toggle_feature(
  p_org_id uuid, p_key text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  if p_key in ('projects','dashboard','approvals','administration') then
    raise exception 'core_not_gatable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  insert into public.org_features (org_id, feature_key, enabled, updated_by)
    values (p_org_id, p_key, p_enabled, auth.uid())
  on conflict (org_id, feature_key) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
end $$;

revoke all on function public.org_has_feature(uuid,text) from public;
grant execute on function public.org_has_feature(uuid,text) to authenticated;
revoke all on function public.operator_toggle_feature(uuid,text,boolean) from public;
grant execute on function public.operator_toggle_feature(uuid,text,boolean) to authenticated;
```

### Task S6-B — Feature registry + `useFeature` / `<FeatureGate>` (AC-ENT-003 Unit/RTL)

**Failing tests first**:
- `pmo-portal/src/auth/__tests__/useFeature.test.tsx` + `pmo-portal/src/components/shell/__tests__/
  FeatureGate.route.test.tsx` (AC-ENT-003): an org whose `crm` feature is disabled → the CRM rail item
  is absent and a deep-link to `/crm` redirects to `/` (dashboard), not a 404; re-enable → rail + route
  reappear (disable = hide, never destroy). Core key (`projects`) always enabled regardless of rows.

**Then implement:**
- `pmo-portal/src/lib/features.ts` — replace the interim hardcoded `FEATURES` object with a registry:
  ```ts
  export const FEATURE_KEYS = ['incidents','crm','procurement','timesheets','import_export',
    'agent_assistant','user_views'] as const;
  export type FeatureKey = typeof FEATURE_KEYS[number];
  export const CORE_FEATURES = ['projects','dashboard','approvals','administration'] as const;
  export type CoreFeature = typeof CORE_FEATURES[number];
  // Env-default map (the VITE_FEATURES_* flags remain as the DEFAULT for an org with no row —
  // FR-ENT-004: absence = included; staging/demo unchanged until an Operator toggles).
  export const FEATURE_ENV_DEFAULT: Record<FeatureKey, boolean> = {
    incidents: false,
    crm: import.meta.env.VITE_FEATURES_CRM === 'true' || false,
    procurement: true, timesheets: true, import_export: true,
    agent_assistant: import.meta.env.VITE_FEATURES_AGENT_ASSISTANT === 'true' || false,
    user_views: import.meta.env.VITE_FEATURES_USERVIEWS === 'true' || false,
  };
  ```
- **`aiComposer` resolution (M5):** the interim `FEATURES.aiComposer` env flag
  (`pmo-portal/src/lib/features.ts`) is an AND-wise sub-flag of `userViews` today — consumed at
  `pmo-portal/src/components/panel/TranscriptItem.tsx:189`
  (`!isFeatureEnabled('agentAssistant') || !isFeatureEnabled('aiComposer')`) and the ViewBuilder
  "Compose view with AI" button (`AC-AS-011/012`, gated `userViews && aiComposer`). It is **NOT** an
  org entitlement, so it is **NOT** added to `FEATURE_KEYS`/`org_features`. The compose affordance
  **keeps its AND-coupling** — `useFeature('user_views') && aiComposerEnv` (the env flag is read
  directly from the env as a standalone check, NOT via `useFeature`) **until the entitlements system
  absorbs the env flags** (a future issue). This preserves the ability to disable AI compose in an
  environment whose AI function secret is absent without disabling the whole User Views module. The
  `agentAssistant` flag IS folded into `agent_assistant` (it is in `FEATURE_KEYS`); only `aiComposer`
  stays a separate env-only sub-flag.
- `pmo-portal/src/hooks/useOrgFeatures.ts` (new) — react-query; `.from('org_features').select
  ('feature_key,enabled').eq('org_id', currentOrgId)` (RLS scopes own-org; all members read). Returns
  `Record<FeatureKey, boolean>`.
- `pmo-portal/src/auth/useFeature.ts` (new):
  ```ts
  export function useFeature(key: FeatureKey | CoreFeature): boolean {
    if ((CORE_FEATURES as readonly string[]).includes(key)) return true;        // core never gated
    const rows = useOrgFeatures();
    const k = key as FeatureKey;
    return rows[k] ?? FEATURE_ENV_DEFAULT[k];   // absence = env default (included)
  }
  export const FeatureGate: React.FC<{ feature: FeatureKey|CoreFeature; children: React.ReactNode }>
    = ({ feature, children }) => useFeature(feature) ? <>{children}</> : null;
  ```
- **Rewire** `pmo-portal/src/components/FeatureRoute.tsx` and `Rail.tsx`: replace
  `isFeatureEnabled(feature)` with `useFeature(feature)`. `Rail.tsx` calls `useOrgFeatures()` once at
  the top and resolves each item via the cached map (sync after load; `Feature_ENV_DEFAULT` while
  loading). `FeatureRoute` becomes a component using `useFeature` (it already returns `element`/`<Navigate>`).
  The `incidents` / `user_views` / `agent_assistant` items keep their `feature:` field; add `crm` /
  `procurement` / `timesheets` rail items gated where applicable (today they're always-on core routes;
  per FR-ENT-001 `procurement`/`timesheets` are *gatable candidates* — gate their rail items + routes
  behind `feature:` so an Operator can hide them; `projects`/`dashboard`/`approvals`/`administration`
  stay ungated).

### Task S6-C — Admin Features section + Operator toggles (AC-ENT-004 Unit/RTL)

**Failing test first** — `pmo-portal/pages/__tests__/Administration.features.readonly.test.tsx`
(AC-ENT-004): a non-Operator org-Admin → features render as a read-only "Included in your plan" list
with no toggle controls; the Operator → real `<Switch role="switch">` toggles calling
`operator_toggle_feature`; core modules render as always-on, non-toggleable.

**Then implement** — `pmo-portal/pages/AdministrationFeatures.tsx` (new section): lists `FEATURE_KEYS`
+ the core set (rendered as locked-on); each gated feature is a `role="switch"` control
(`aria-checked`, labelled) for the Operator, read-only text + status pill for the org-Admin. On
toggle, `repositories.orgFeature.toggle({ orgId, key, enabled })` → `.rpc('operator_toggle_feature')`;
on `core_not_gatable` → "Core modules can't be disabled" toast. Mount in the composed page (swap the
S4 `null`).

Add `orgFeature: OrgFeatureRepository { listOwn(): …; toggle(args): … }` to the repository seam +
`pmo-portal/src/lib/db/orgFeatures.ts`.

### Task S6-D — A11y capstone (AC-A11Y-001 Unit/RTL) — LAST, once all sections composed

**Failing test first** — `pmo-portal/pages/__tests__/Administration.a11y.test.tsx` (AC-A11Y-001):
renders the fully-composed `/administration` (Users + Credits + Usage + Features) for an Operator and
an org-Admin at desktop and 390px; `axe-core` reports zero violations; toggles are real
`role="switch"`; disable confirm is `ConfirmDialog` with an `aria-live` toast result.

**Then implement/fix** — resolve any axe findings (labels, focus traps in the modals, color-contrast
on the disabled StatusPill). Add the Credits section (`AdministrationCredits.tsx`) in this slice too
(Operator "Grant credits" → `operator_grant_credits`; read-only balance for all via
`org_credit_balance` — S2's fn; org-Admin own-org, Operator selected org) so the composition is
complete and AC-A11Y-001 has the full surface to audit. (Credits section is small: a balance readout
+ a Grant modal `EntityFormModal` with amount `TextField` + note `TextField`; the AC-CRE-004 e2e in
S7 exercises the grant end-to-end.)

**Verify:** `supabase db reset && supabase test db` (0120/0121 green) + `cd pmo-portal && npm run
verify` (AC-ENT-003/004 + AC-A11Y-001 green).

**S6 commit gate:** green. Commit: `feat(entitlements): org_features + useFeature/FeatureGate + Features section + route gating + Credits section + a11y`.

---

## SLICE S7 — e2e curated journeys (integration capstone)

**Runs against the local stack (Playwright + seed).** ACs: AC-INV-001, AC-CRE-004, AC-ENT-005.
Depends on S1–S6 all merged to `dev`. Three curated journeys, one per cross-stack AC (ADR-0010).

### Task S7-A — `e2e/AC-INV-001-invite.spec.ts`
**Given** an org-Admin signed in on `/administration`, **when** they submit "Add user" with a fresh
email + role "Engineer", **then** `admin-invite-user` is invoked (assert via the directory showing the
new user within 2 s; assert the edge fn was called with the email by stubbing/observing the network
response), a `profiles` row exists (`status='active'`, the caller's org, role "Engineer"). **The
invite-email/accept path is asserted only as "the edge fn was called with the email"** — the accept
flow belongs to `auth-production-floor`.

### Task S7-B — `e2e/AC-CRE-004-grant.spec.ts`
**Given** the Operator on `/administration` › Credits, **when** they grant 500 credits to the org
with a note, **then** a `credits` row is created (`granted_by`=Operator, `owner_id IS NULL`), and an
org Admin subsequently sees "Balance: 500 (− usage)" read-only.

### Task S7-C — `e2e/AC-ENT-005-toggle.spec.ts`
**Given** the Operator on `/administration` › Features, **when** they disable `incidents` for the
org, **then** an org member's next shell render hides the Incidents rail item and `/incidents`
redirects to `/`; re-enabling restores it (no data loss — assert a pre-existing incident row is still
reachable after re-enable).

**Verify:** `cd pmo-portal && npx playwright test AC-INV-001 AC-CRE-004 AC-ENT-005` green (the CI
`integration` job runs these on PR→`main`; locally they run against `supabase db reset` + `npm run dev`).

**S7 commit gate:** `cd pmo-portal && npm run verify` + the 3 e2e green. Commit:
`test(e2e): ops-admin curated journeys — invite, grant, feature-toggle`.

---

## 4. AC traceability matrix (every AC placed exactly once)

| AC | Owning layer | Owning test (slice) | FR/NFR covered |
|---|---|---|---|
| **AC-INV-001** | e2e | `e2e/AC-INV-001-invite.spec.ts` (S7) | FR-INV-004/005/006 |
| **AC-INV-002** | pgTAP | `supabase/tests/0110_ops_admin_disabled_reads_nothing.test.sql` (S1) | FR-INV-001/003, NFR-SEC-003 |
| **AC-INV-003** | pgTAP | `supabase/tests/0111_ops_admin_disable_authority.test.sql` (S1) | FR-INV-002 |
| **AC-INV-004** | Unit/RTL | `pages/__tests__/AdminUsers.disable.test.tsx` (S4) | FR-INV-002 (lockout) |
| **AC-OPR-001** | pgTAP | `supabase/tests/0112_ops_admin_operator_rpc_only.test.sql` (S1) | FR-OPR-001/002/004, NFR-SEC-001 |
| **AC-OPR-002** | pgTAP | `supabase/tests/0113_ops_admin_operator_not_role.test.sql` (S1) | FR-OPR-001 (not a role) |
| **AC-OPR-003** | Unit/RTL | `pages/__tests__/Administration.operatorGate.test.tsx` (S4) | FR-OPR-005, NFR-SEC-001 |
| **AC-CRE-001** | pgTAP | `supabase/tests/0114_credits_org_pool_balance.test.sql` (S2) | FR-CRE-001/002 |
| **AC-CRE-002** | pgTAP | `supabase/tests/0115_credits_insert_operator_only.test.sql` (S2) | FR-CRE-003, NFR-SEC-002 |
| **AC-CRE-003** | pgTAP | `supabase/tests/0116_credits_enforced_org_pool.test.sql` (S2) | FR-CRE-004, NFR-PERF-002 |
| **AC-CRE-004** | e2e | `e2e/AC-CRE-004-grant.spec.ts` (S7) | FR-CRE-005 |
| **AC-USE-001** | pgTAP | `supabase/tests/0117_usage_operator_vs_admin_scope.test.sql` (S5) | FR-USE-004 |
| **AC-USE-002** | pgTAP | `supabase/tests/0118_usage_aggregate_columns.test.sql` (S5) | FR-USE-001/002 |
| **AC-PRIV-001** | pgTAP | `supabase/tests/0119_ops_admin_no_transcript_reads.test.sql` (S5) | FR-USE-003, NFR-PRIV-001 |
| **AC-USE-003** | Unit/RTL | `pages/__tests__/Administration.usage.margin.test.tsx` (S5) | FR-USE-006, NFR-PRIV-002 |
| **AC-ENT-001** | pgTAP | `supabase/tests/0120_org_features_rls.test.sql` (S6) | FR-ENT-002/003 |
| **AC-ENT-002** | pgTAP | `supabase/tests/0121_org_features_core_never_gated.test.sql` (S6) | FR-ENT-001/004/007 |
| **AC-ENT-003** | Unit/RTL | `auth/__tests__/useFeature.test.tsx` + `shell/__tests__/FeatureGate.route.test.tsx` (S6) | FR-ENT-005/006 |
| **AC-ENT-004** | Unit/RTL | `pages/__tests__/Administration.features.readonly.test.tsx` (S6) | FR-ENT-008 |
| **AC-ENT-005** | e2e | `e2e/AC-ENT-005-toggle.spec.ts` (S7) | FR-ENT-006 |
| **AC-A11Y-001** | Unit/RTL | `pages/__tests__/Administration.a11y.test.tsx` (S6) | NFR-A11Y-001 |

**Coverage check:** all 21 ACs in the spec are placed exactly once (12 pgTAP + 6 Unit/RTL + 3 e2e =
21 ✓; AC-CRE-003 is owned solely by pgTAP 0116 per its `[pgTAP]` spec tag — the `creditRateGuard`
vitest in S2-C is a non-owning mocked shape test, not counted here). Every FR-INV/OPR/CRE/USE/ENT-*
and every NFR-SEC/PRIV/PERF/A11Y-* traces to at least one AC above.

---

## 5. Open questions for the Director (plan-level only; grill decisions are locked)

1. **`admin_set_user_status` reaching `auth.users.banned_until`** — the RPC is `security definer`
   running as the migration-owner role, which can write `auth.users` (the GoTrue admin path). This is
   the cleanest, pgTAP-provable mechanism (Task S1-D). If the live Supabase auth version rejects the
   cross-schema write from a `public`-schema definer, the fallback is a tiny companion edge fn
   (`admin-revoke-session`) called by the RPC via `net.http_post` (the agent-dispatch pg_cron
   pattern) — the spec's Open Question 2 names this as a candidate. **Decision needed at S1 build
   time:** try the direct `banned_until` write first; fall back to the edge-fn call only if the
   cross-schema write is denied. Either way AC-INV-002/003 (the outcome: disabled JWT reads nothing +
   can't refresh) is proven.
2. **`credits INSERT` `org_id = auth_org_id()` for an Operator** (Task S2-A note) — under the single-
   org seed the Operator's home org IS the target org, so the policy holds. When ADR-0047 multi-org
   lands, the grant must run under a per-`p_org_id`-scoped session (the RPC already takes `p_org_id`);
   the FE/RPC contract is forward-compatible. **No action now** — flagged so S2's reviewer doesn't read
   the policy as a cross-org bug.
3. **`CREDITS_PER_USD` plumbing** (Task S5-B) — read via `current_setting('app.credits_per_usd', true)`.
   The setter is deferred (pricing is CUT); until then the GUC is unset → margin null → column hidden
   (AC-USE-003). If the team prefers an env-var edge-fn read instead of a GUC, swap the `rates` CTE —
   the FE contract (`margin_usd null ⇒ hide`) is unchanged. Cosmetic.
4. **`agent_usage.cost` vs `provider_cost_usd` today-equal** (Task S5-C) — today both derive from
   `ModelResponse.usage.total_cost`. The spec mandates they be DISTINCT columns (credit charge vs USD
   cost) so they can diverge when a pricing rate lands. Task S5-C captures both at the same choke
   point as equal values now; the divergence is a pricing-issue change, not this one. Flagged so the
   S5 reviewer doesn't "dedupe" them.

---

## 6. Self-verify (re-read against the spec's AC list)

- **Every AC placed exactly once** (§4 matrix: 21/21) ✓.
- **Slice ordering is independently verify-green + committable**: S1 (DB + seed) → S2 (credits, needs
  S1's `is_operator`/`is_active_member`) → S3 (invite edge fn, needs S1's `is_operator` + helper RPCs)
  → S4 (Users UI, needs S1 RPCs + S3 edge fn) → S5 (usage, needs S1+S2) → S6 (features + a11y capstone,
  needs S1+S4) → S7 (e2e capstone, needs all) ✓.
- **Serialize flags correct**: S1/S2/S5/S6 touch `db reset` (serialized); S3/S4 are FE/edge-fn-only;
  S7 is the integration capstone ✓.
- **Boundaries honored**: invite-ACCEPT flow NOT planned (named as `auth-production-floor` hand-off in
  FR-INV-004 / AC-INV-001); no spec re-litigation; no scope invention (CUTs — RBAC editor, Stripe,
  operator-console app, transcript reads, Entity dimension — all absent) ✓.
- **Conventions**: EARS FR/NFR IDs referenced; AC-id tagging in every owning test title; one owning
  layer per AC (ADR-0010); `can()`/`useIsOperator()` UX-only with RLS/RPC authority (ADR-0016/0019);
  repository seam extended not bypassed (ADR-0017); org_id never client-sent except the Operator
  `p_org_id` RPC arg (re-validated server-side); DESIGN.md tokens + shared primitives named for every
  UI slice ✓.
- **Migration/pgTAP numbering explicit**: 0058–0066 (9 migrations), 0110–0121 (12 pgTAP) ✓.
- **Revenue-hole fix cited against `0047`**: FR-CRE-003 / AC-CRE-002 / migration 0062 ✓.
- **`org_features` Operator-write flip recorded**: ADR-0049 + FR-ENT-003 / AC-ENT-001 ✓.
- **Privacy line pgTAP-proven**: AC-PRIV-001 (pg_depend + prosrc scan) ✓.
- **Non-destructive org-pool**: no backfill; legacy non-null `owner_id` grants count (AC-CRE-001) ✓.

PLAN-DONE
