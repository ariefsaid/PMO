# Equipment usage and allocation - implementation plan (#1519)

Spec: [`docs/specs/equipment-usage.spec.md`](../specs/equipment-usage.spec.md) (**owner-signed 2026-11-01**).
Route item T8 of [`2026-10-30-epc-odoo-build-route.md`](2026-10-30-epc-odoo-build-route.md); owner rulings in #1498.
Extends, never forks: cost attribution (#1271, [`cost-attribution.spec.md`](../specs/cost-attribution.spec.md), migration
`0376_cost_attribution.sql`) and the timesheet approval pattern (`transition_timesheet`, 0180). Ownership: ADR-0094 (the ERP
owns the asset register and the ledger; PMO owns project usage). Role contract: `.claude/agents/eng-planner.md`.

**Owner rulings (binding).** Per **OD-GRILL-20261101** (`docs/decisions.md:3615-3616`: "equipment usage #1519 (OQ-1..9
defaults)") the owner accepted **every** §10 recommended default. This plan treats each one as a ruling, not an open question:

| OQ | Ruling (the spec's recommended default) | Where it is built |
|---|---|---|
| OQ-1 | **No ERP posting.** Read-side management costing only, as #1271. §7's posting contract is not built. | S4.8 proves no ERP write (AC-EQU-016) |
| OQ-2 | Allocation basis = **a driver among logged measures (units, fuel litres, trips)**, plus fixed percentages through the existing cost attribution rule. Nothing else. | S2 (`driver` check), S3 engine |
| OQ-3 | A hire-rate charge **counts in `actuals_to_date`**, in a category the org maps for equipment, **and** is shown as a separate internal-charge field. | S4 (`equipment_charge_to_date`, `equipment_charge_total`) |
| OQ-4 | Allocation period = **calendar month**. | S2/S3 (`date_trunc('month', …)`) |
| OQ-5 | **Any Engineer-or-above logs for any asset** on projects they are a member of; no per-asset operators. | S1 (`save_equipment_usage`); see PQ-1 |
| OQ-6 | Standby is a recorded kind, **charged only when a standby rate exists**; under `actual_cost` standby counts toward the driver only when the setting ticks **count standby (default off)**. | S2 (`count_standby`), S3 driver |
| OQ-7 | Same-day total over 24 h **warns, does not block**; only per-row limits block. | S1 (`over_24h` in the save result) |
| OQ-8 | Approval **per entry, with bulk approve for one asset-week**; no daily sheet. | S1 (`approve_equipment_usage_week`) |
| OQ-9 | **Thin hand-made asset reference now**; adopted to the mirror when #1511/#899 ship (match by code, never auto-merge, Admin confirms). | S1 (`equipment_assets`, `external_*` columns reserved) |

**Gate: money path.** S2, S3 and S4 change what reaches project actuals (`project_mapped_actuals`, `get_project_finances`,
both dashboards, the cost-attribution engine). S1 is the SoD tier (approver ≠ author). Executor: **Director-dispatched Orca
workers, one fresh worker per slice, each slice its own branch and PR** (CLAUDE.md money tier, `docs/orca-dispatch.md`).
**S1, S2, S3 and S4 each ship alone** (never batched with another slice). Read
[`docs/money-path-primer.md`](../money-path-primer.md) before S2-S4: buckets 1 (duplicate money: here, a ledger line counted
twice), 3 (SoD), 4 (tenancy) and 5 (wrong number on screen) all apply; the outbox buckets do not (OQ-1: nothing is posted).

Everything cited below was read on `origin/dev` at `6440a961` (re-verified at `b52aa48a` in review). Migration head on that
commit is `0426_imprest_approval_route.sql`. A path marked **(new)** does not exist yet.

**Migration numbers (Lane B range 0447–0449; 0440–0446 belong to sibling slices):** S1 = **0447**, S2 = **0448**,
S3 = **0449**. S4 needs a **fourth** number, `<S4-NNNN>`, which the coordinator assigns above 0449 (Lane B has only three).
If no fourth number is granted, S4's SQL is appended to 0449 and S3+S4 ship as one money PR (S3's and S4's gates both run).
Never take a number outside the assigned range; on a collision use `scripts/renumber-migration.sh <old> <new>`.

**Rebuilt bodies come from the latest migration at build time, not from the line numbers cited here.** S3/S4 re-create
`cost_attribution_allocations`, `cost_attribution_assert_no_conflict`, `project_mapped_actuals`, `project_mapped_actuals_all`,
`get_project_finances` and `api_client_request_guard`. Sibling lanes (0440–0446) may redefine any of them first. Before
writing each body, find its newest definition and copy THAT; the rollback restores the body the slice replaced:
`grep -liE "function +(public\.)?<name> *\(" supabase/migrations/*.sql | sort | tail -1` (case-insensitive: 0410 writes
`CREATE OR REPLACE FUNCTION`). If it is newer than the file cited below, re-read it and carry its changes.

---

## What ships today (grounded; the base every slice builds on)

- **No equipment schema exists.** Scope searched: `supabase/migrations/*.sql`, `pmo-portal/src`, `pmo-portal/pages`,
  `pmo-portal/App.tsx` for `equipment`, `erp_asset`, `fixed_asset`. The only hits are the `budget_category` enum value
  `'Equipment'` (`supabase/migrations/0001_init_schema.sql:20`) and budget-category UI/tests. No asset mirror exists either
  (#1511/#899 unbuilt), so FR-EQU-021 has nothing to read yet; OQ-9's thin reference is the only source.
- **The cost attribution engine** is one SQL function, `cost_attribution_allocations(p_org_id, p_draft, p_exclude_rule_key,
  p_project_id)` (`0376_cost_attribution.sql:216-282`): one winner per untagged, uncancelled ledger line, highest
  `specificity` first, then `rule_key` (`:256-267`); per-line cent split with the last target taking the remainder
  (`:270-279`). Specificity = `10 × (cost centre? + party?) + (account ? 2 : 1)` (`:171`). Ties are refused at save by
  `cost_attribution_assert_no_conflict` (`:176-214`). Its four callers pass it positionally:
  `cost_attribution_project_actuals` (`:294-308`), `preview_cost_attribution` (`:315-339`, which isolates the draft by
  `where a.rule_id is null`, `:336`), `cost_attribution_org_actuals` (`:516-529`) and `budget_attributed_year_sums`
  (`0403_budget_first_spending_year.sql:3-14`). Nothing outside those reads `gl_id`/`rule_id` except the 0376 pgTAP file
  (`supabase/tests/cost_attribution.test.sql:110-115`).
- **Versioning precedent:** `cost_attribution_write` (`0376:341-388`): org advisory lock, `expected_version` → `40001`,
  identical content → no new version, `is_current` flip, `log_audit` with before/after. In #1271 only the current version
  applies; FR-EQU-045 needs older versions to keep applying to their dates, so equipment settings add a window column
  (D3 below).
- **Project actuals:** `project_mapped_actuals(p_project_id, p_fiscal_year)` (`0376:459-511`, invoker) returns eight columns;
  `actuals_to_date` = tagged + attributed. `project_mapped_actuals_all` (`0376:536-593`) is the dashboards' one-pass read,
  consumed as `select * … materialized` (`0396_project_commitment_position.sql:108,294`). `get_project_finances` latest body is
  `0410_billing_kinds.sql:283-636`; it reads `select * from public.project_mapped_actuals(p_project_id,null)` (`:338-339`) and
  builds `actuals` at `:614-630` (`tagged_total`, `attributed_total`, per-category `tagged_amount`/`attributed_amount`).
- **SoD transition precedent:** `transition_timesheet` (`0180_rpc_active_member_gate.sql:780-…`): `assert_is_active_member`,
  row `for update`, org re-assertion, a JSON transition map, **SoD before authority** ("Do not reorder").
- **Helpers reused:** `stamp_org_id()` (`0074_org_id_stamp_trigger.sql:73-84`), `assert_is_active_member()`
  (`0180:160-168`), `role_rank` (`0178_sod_class_completeness.sql:638-654`), `log_audit(action, org, actor, entity, detail)`
  (`0076_audit_events.sql:80-90`, no client grant), org-local "today" as
  `(now() at time zone coalesce(o.default_timezone,'UTC'))::date` (`0247_expense_claims.sql:724`).
- **API-client guard:** latest `api_client_request_guard` is `0397_budget_import_protocol.sql:86-228`; the #1271 tiers are
  `cost_attribution_write_rpcs` / `cost_attribution_read_rpcs` (`:119-120`, branches from `:174`).
- **No project membership table.** Scope searched: `supabase/migrations/*.sql` for `project_members`, `project_team`,
  `is_project_member`; projects are readable by every active org member (`projects_select`, cited at
  `0249_comments.sql:36`). The only per-project person is `projects.project_manager_id` (`0001_init_schema.sql:76`).
- **FE precedent:** repository seam `src/lib/repositories/imprest.ts`, DAL `src/lib/db/imprest.ts` (bounded lists,
  `LIST_LIMIT + 1` sentinel), hooks `src/hooks/useImprest.ts` (org id in every key), policy `src/auth/policy.ts`
  (`COST_ATTRIBUTION_WRITE` at `:174-175`, `costAttribution` at `:675`, `can()` at `:720-725`), rail item
  `src/components/shell/Rail.tsx:72`, routes `App.tsx:217-218`, i18n `NAMESPACES` `src/lib/i18n/index.ts:15`.
- **CLI precedent:** `scripts/lib/pmo-attribution.mjs` (tiers `:9-10`, error map), wired in `scripts/pmo.mjs:112,917`, tested
  by `scripts/pmo-attribution.test.mjs` with `node:test` against a fake PostgREST; CI runs every `scripts/*.test.mjs`
  (`.github/workflows/ci.yml:214-218`).

## Plan questions (new; each has the default this plan takes and names the slice it changes)

None blocks dispatch. Each default is enforcement or reading of a signed requirement, not a new requirement.

| # | Question | Default taken | Slice |
|---|---|---|---|
| PQ-1 | OQ-5 says "projects they are a member of", but no project membership exists (see above). | A project in the caller's org is the member scope (every active member already reads every org project). A per-project membership gate is a follow-up with the operator-assignment follow-up. | S1 |
| PQ-2 | `project_mapped_actuals(p_fiscal_year)` filters by the ledger's `fiscal_year`; a hire-rate charge has no ledger line. | A charge's `fiscal_year` is the calendar year of its work-date month (`to_char(month,'YYYY')`). An org whose ERP fiscal year is not the calendar year sees charges in the calendar year; revisit with the fiscal-calendar work. | S2 |
| PQ-3 | Which category does a hire-rate charge count in (OQ-3: "a category the org maps for equipment")? | The setting carries `charge_category` (default `Equipment`). Saving a `hire_rate` setting is refused (`P0002`) unless that category has at least one row in `budget_category_account_map` for the org, so a charge never lands in an unmapped category and `mapped` keeps its 0376 meaning. | S2 |
| PQ-4 | How does an older version keep applying to its own dates (FR-EQU-045) when #1271 applies only the current version? | Each version row has `applies_to date`. Saving a version effective from F clamps every earlier version of the same setting to `applies_to = greatest(effective_from, F) - 1` (a version that starts on/after F is voided). The effective window is `[effective_from, least(effective_to, applies_to)]`. | S2 |
| PQ-5 | An `actual_cost` version change mid-month splits that month's pool between two versions. | Each version's pool for the month is shared by **that month's whole** approved driver totals, using that version's driver. Both rows show their version in the drill-down. | S3 |
| PQ-6 | Rounding grain for `actual_cost` (NFR-EQU-002 "once per project per period"); the category map is per account. | Rounded once per (version, month, account, fiscal year, party type) → project, last project (by `project_id` order) takes the remainder; each pool sums exactly to its lines (FR-EQU-041). | S3 |
| PQ-7 | Bulk approve of an asset-week when some entries are the approver's own or on projects they cannot approve. | Approve every Submitted entry the caller may approve; skip the rest; return `{approved, skipped_own, skipped_not_permitted}`. Each approval runs the single-entry checks. | S1 |
| PQ-8 | Entries "through RPCs or column-pinned own-row policies" (FR-EQU-063). | RPC only (`save_equipment_usage`), because the future-date cut uses the org timezone and the save returns the over-24 h warning. No client INSERT/UPDATE grant on entries. | S1 |
| PQ-9 | Illegal transitions: the timesheet RPC uses `P0001`, the spec says errors reuse #1271's codes. | `22023` for an illegal transition or a non-editable state (in the spec's list). | S1 |
| PQ-10 | Should hire-rate charges feed `first_budget_spending_year` (`0403`)? | No: that function reads the ledger (`budget_attributed_year_sums`). Charges reach budget-vs-actual through `project_mapped_actuals.source_sum`. Follow-up if a charge-only year must open the projection. | S4 |
| PQ-11 | `list_equipment_allocations(p_asset_id, p_from, p_to)` cannot feed the project panel (per asset, not per project). | Add an optional trailing `p_project_id uuid default null`; at least one of asset/project is required. | S2 |
| PQ-12 | OQ-7's day total for `days` entries. | Day total in hours = Σ(hours) + 24 × Σ(days); warn when > 24. | S1 |

## Spec deltas found while planning (none changes a requirement; listed so reviewers see them)

1. `equipment_costing_settings` gains `count_standby boolean` (OQ-6), `charge_category budget_category` (OQ-3/PQ-3),
   `applies_to date` (PQ-4) and `specificity int` (copied from #1271) beyond spec §5.
2. `equipment_usage_entries` gains `decision_notes text` (reject reason) and a table CHECK `approver_id <> author_id`
   (defence in depth for FR-EQU-011; the RPC remains the authority).
3. The single engine stays one function: S3 renames the body to `cost_attribution_engine(...)` (a superset of columns, incl.
   the FR-EQU-044 drill-down fields) and keeps `cost_attribution_allocations` as a thin wrapper with the 0376 columns, so
   no caller changes and no second engine exists (spec §5 "Do not create a second allocation engine").
4. Symmetric tie refusal: S3 extends `cost_attribution_assert_no_conflict` so a #1271 rule that **ties** a current equipment
   `actual_cost` setting is refused too (FR-EQU-034 states only the equipment-side refusal). See spec note 4.

## Architecture

### Design decisions

- **D1 Usage is PMO-owned and approved before it counts (ADR-0094, FR-EQU-012).** Entries move only through
  security-definer RPCs; only `Approved`, non-archived rows feed any figure. An approved row is immutable; correction =
  Admin reopen (Approved → Draft, audited) then edit and re-approve.
- **D2 SoD is two separations.** (a) approver ≠ author, checked **before** authority in the transition (timesheet order,
  `0180:829-835`); (b) money setting (rates, driver, match) is Admin/Finance only, usage approval is PM/Exec/Finance/Admin:
  a PM approves hours but never sets what an hour is worth (spec §6). Finance and Admin hold both rights by design; (a)
  still forbids them approving their own usage.
- **D3 Settings are versioned and windowed.** Version mechanics copy #1271 (`setting_key`, `version`, `is_current`,
  `expected_version` → `40001`, identical save → no version, audited before/after). PQ-4's `applies_to` makes old versions
  keep applying to their dates; `equipment_settings_effective(org, draft)` is the one place that computes windows and
  overlays a draft (used by preview, charges and the engine alike, so preview = save by construction, FR-EQU-070).
- **D4 `actual_cost` is a rule source inside the #1271 engine, not a second engine.** Equipment versions join the engine's
  `rules` set with their specificity; the existing `distinct on (l.id) … order by specificity desc, rule_key` picks one
  winner per line across both sources (no double count, FR-EQU-034/FR-CAT-031). Lines an equipment version wins are pooled
  per month and split by approved driver share; a pool with zero driver total is returned as `unallocated`, never dropped
  (FR-EQU-042). Attributed cost reaches `attributed_to_date` through the existing category map with zero caller changes.
- **D5 `hire_rate` is a management charge, outside the ledger (FR-EQU-051).** Computed from approved entries × the
  version current on each work date, rounded once per (version, project, month). It never enters
  `cost_attribution_allocations`, so `tagged + attributed ≤ ledger` (AC-EQU-010) stays true; it is added to
  `actuals_to_date` per OQ-3 and always reported separately as `equipment_charge_to_date`.
- **D6 Byte-identical when unused (AC-EQU-011).** Every new term is `coalesce(…, 0)`/absent-row-safe, and the pgTAP proof
  compares against a verbatim `pg_temp` copy of the 0376 body (S4.2), not against itself.
- **D7 No ERP write (OQ-1, FR-EQU-052).** No outbox row, no mirror or snapshot write, no edge function, no adapter command.
- **D8 FE follows ADR-0016/0017.** Pages → hooks → `repositories.equipment` → DAL `src/lib/db/equipment.ts` → RPC/RLS.
  `can()` is UX only; no `org_id` from the client; money is shown with the shared exact-money formatters.

### Data flow

```
log (any member) ─► save_equipment_usage ─► equipment_usage_entries (Draft)
submit (author) / approve|reject (PM own project · Exec · Finance · Admin, ≠ author) ─► transition_equipment_usage
                                                     │ Approved only
               ┌─────────────────────────────────────┴───────────────────────────────┐
  basis none: usage totals only           hire_rate: equipment_hire_charges        actual_cost: cost_attribution_engine
  (list_equipment_usage_totals)           (units × rate per version window)        (ledger winner → monthly pool → driver share)
                                                     │                                            │
                       project_mapped_actuals.equipment_charge_to_date      attributed_to_date (existing #1271 path)
                                                     └──────────── actuals_to_date ───────────────┘
                                   get_project_finances · project_mapped_actuals_all → both dashboards
```

### Slice map

| Slice | Migration | Tasks | Blocked by | Worker tier (cheapest that does it well) | Ships |
|---|---|---|---|---|---|
| **S1 Assets, usage entries, approval** | `0447_equipment_usage.sql` | S1.1-S1.9 | none | Terra or Sol (SoD) | **alone** |
| **S2 Costing settings, hire charges, reads** | `0448_equipment_costing.sql` | S2.1-S2.10 | S1 | **Sol** (money) | **alone** |
| **S3 `actual_cost` in the attribution engine** | `0449_equipment_actual_cost.sql` | S3.1-S3.7 | S2 | **Sol** (money) | **alone** |
| **S4 Project actuals, finances, API tiers** | `<S4-NNNN>_equipment_project_actuals.sql` (4th number; else appended to 0449) | S4.1-S4.9 | S3 | **Sol** (money) | **alone** (or with S3) |
| **S5 Data layer** (DAL, repo, hooks, policy) | none | S5.1-S5.6 | S2 (S4 for the finances fields) | Luna | batchable |
| **S6 Screens, panel, e2e** | none | S6.1-S6.9 | S5, S4 | Flash or Luna (UI lane) | batchable |
| **S7 CLI** | none | S7.1-S7.4 | S4 | Luna | batchable |

Order: S1 → S2 → S3 → S4, then S5 → S6 and S7 in parallel. Branches `feat/equipment-s<n>` off `origin/dev`, own worktree,
`.env.local` copied in; workers push the branch, the Director opens PRs. A slice may stack on the previous slice's branch
before it merges; a money slice still merges as its own PR.

Size: the whole feature is roughly five to six builder-days, so it is split. Each slice is about one builder-day and
ships on its own: S1 is usable data with no costing (dark until S6); S2 adds hire-rate charges visible in
`list_equipment_allocations` only; S3 makes `actual_cost` reach `attributed_to_date` (the issue's acceptance); S4 puts
the hire charge into project actuals and opens the API tiers; S5–S7 are FE/CLI and change no money.

## Conventions every task follows

- **pgTAP** files `supabase/tests/equipment_<topic>.test.sql` (new), self-contained (`begin; … select * from finish(); rollback;`),
  starting from Fixture F1 below. **AC tag** = leading token of the pgTAP description / `it(...)` / `test(...)` title.
- **DB commands under the lock, reset and test in ONE hold:**
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<files>'` (run from repo root).
- **Every migration slice's gate (S1-S4)**, all green before push:
  1. `scripts/check-migration-collisions.sh && scripts/check-migration-collisions.sh --self-test`
  2. `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<this slice's files> supabase/tests/cost_attribution.test.sql supabase/tests/0178_anon_executable_definers.test.sql'`
     (`cost_attribution.test.sql` from S3 on is the regression proof that #1271 is unchanged.)
  3. `node scripts/check-isolation-denominator.mjs && node scripts/check-isolation-denominator.mjs --self-test` after adding every
     new table to the `tables` list and **every new SECURITY DEFINER function that is not a trigger** (the guard's
     `DEFINERS_SQL` lists all of them, granted or not; a missing one is UNLISTED, an invoker one listed is STALE) to the
     function list of `scripts/isolation-probe-denominator.json`, as its `regprocedure` text (`int` is written `integer`).
     Internal helpers stay plain (invoker) functions, revoked from clients and called only from definers, so they stay off
     the list (the 0376 `cost_attribution_normalize` pattern). The exact strings per slice are in each slice's gate task.
  4. 0178 retained-RPC set (`supabase/tests/0178_anon_executable_definers.test.sql`): add each new client-callable writer
     to `client_callable_rpc_names` and an `⚑ AMENDED BY <number> (#1519)` header note (format `:105-107`); **re-derive the
     count by hand from the VALUES list after rebase** (the assertions on `b52aa48a` read **104**, last noted by 0410; a sibling
     slice merging first raises it). S1 adds 4 (`save_equipment_usage`, `transition_equipment_usage`,
     `approve_equipment_usage_week`, `archive_equipment_usage`) → 108 on 104; S2 adds 2 (`save_equipment_costing`,
     `end_equipment_costing`) → 110. Reads and previews must be `stable` and contain no `insert into`/`update <name>`/
     `delete from` text, so the sweep (`:322-334`) does not see them as writers; they are not retained (0376 precedent).
  5. From `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, touched vitest files, `npx eslint --max-warnings=0 <touched>`.
- **Types after a migration:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`.
- **Grants:** every function ends with `revoke all … from public, anon, authenticated;`; client RPCs then
  `grant execute … to authenticated;`; definers `alter function … owner to postgres;` (0376 `:445-455` pattern). Each
  migration ends with a self-assertion `do $$ … $$` that raises if any new internal helper is executable by `authenticated`
  or any new function by `anon` or `public`. Every new table gets `grant all … to service_role` (0137 precedent).
- **No side-mirror table** (0136 / ADR-0059 inventory): OQ-1 posts nothing, so no ERP-side state exists. A later posting
  slice adds its own side table and inventory entry.
- **SoD comparisons are null-safe** (`is not distinct from`, the 0180 HIGH-TS-1 lesson), even where a value cannot be null today.
- **Rollback files** `supabase/migrations/rollback/<NNNN>_<slug>_down.sql`, reverse dependency order; the migration header
  repeats the reverse. S3's and S4's down files restore the 0376 / 0410 / 0397 bodies verbatim.
- **Public repo:** fixtures use the synthetic UUID prefix `15190000-…` and `@example.com` emails; no tenant data.
- **Commits:** conventional, no attribution trailers; before every push
  `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must not match; never `--no-verify`.

## Fixture F1 (copied verbatim into every equipment pgTAP file; extend, never fork)

```sql
begin;
create extension if not exists pgtap;
select plan(0); -- replace 0 with the real count

insert into organizations (id, name, default_currency, default_timezone) values
  ('15190000-0000-0000-0000-00000000000a', 'EQU Org',   'IDR', 'Asia/Jakarta'),
  ('15190000-0000-0000-0000-00000000000b', 'EQU Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15190000-0000-0000-0000-0000000000a1', 'equ-admin@example.com'),
  ('15190000-0000-0000-0000-0000000000a2', 'equ-fin@example.com'),
  ('15190000-0000-0000-0000-0000000000a3', 'equ-pm1@example.com'),   -- manages P1 and P3
  ('15190000-0000-0000-0000-0000000000a4', 'equ-pm2@example.com'),   -- manages P2
  ('15190000-0000-0000-0000-0000000000a5', 'equ-exec@example.com'),
  ('15190000-0000-0000-0000-0000000000a6', 'equ-eng1@example.com'),
  ('15190000-0000-0000-0000-0000000000a7', 'equ-eng2@example.com'),
  ('15190000-0000-0000-0000-0000000000b1', 'equ-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000a1', '15190000-0000-0000-0000-00000000000a', 'EQU Admin', 'equ-admin@example.com', 'Admin', 'active'),
  ('15190000-0000-0000-0000-0000000000a2', '15190000-0000-0000-0000-00000000000a', 'EQU Fin',   'equ-fin@example.com',   'Finance', 'active'),
  ('15190000-0000-0000-0000-0000000000a3', '15190000-0000-0000-0000-00000000000a', 'EQU PM1',   'equ-pm1@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a4', '15190000-0000-0000-0000-00000000000a', 'EQU PM2',   'equ-pm2@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a5', '15190000-0000-0000-0000-00000000000a', 'EQU Exec',  'equ-exec@example.com',  'Executive', 'active'),
  ('15190000-0000-0000-0000-0000000000a6', '15190000-0000-0000-0000-00000000000a', 'EQU Eng1',  'equ-eng1@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000a7', '15190000-0000-0000-0000-00000000000a', 'EQU Eng2',  'equ-eng2@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000b1', '15190000-0000-0000-0000-00000000000b', 'EQU XOrg',  'equ-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15190000-0000-0000-0000-0000000000c1', '15190000-0000-0000-0000-00000000000a', 'EQU P1', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000c2', '15190000-0000-0000-0000-00000000000a', 'EQU P2', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a4'),
  ('15190000-0000-0000-0000-0000000000c3', '15190000-0000-0000-0000-00000000000a', 'EQU P3', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000cb', '15190000-0000-0000-0000-00000000000b', 'EQU PX', 'Ongoing Project', null);
-- A1 loader (hours), A2 truck (days), A3/A4 hire-rate machines (hours), A9 foreign (ids are hex: d1..d4, d9)
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('15190000-0000-0000-0000-0000000000d1', '15190000-0000-0000-0000-00000000000a', 'LDR-1', 'Loader 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d2', '15190000-0000-0000-0000-00000000000a', 'TRK-1', 'Truck 1',  'days'),
  ('15190000-0000-0000-0000-0000000000d3', '15190000-0000-0000-0000-00000000000a', 'GEN-1', 'Generator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d4', '15190000-0000-0000-0000-00000000000a', 'EXC-1', 'Excavator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d9', '15190000-0000-0000-0000-00000000000b', 'LDR-X', 'Foreign loader', 'hours');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- approved usage straight into the table (superuser; allocation tests only — S1 tests drive the RPCs)
create or replace function pg_temp.usage(p_asset text, p_project text, p_date date, p_qty numeric, p_unit text,
                                         p_kind text default 'work', p_status text default 'Approved',
                                         p_fuel numeric default null, p_trips int default null) returns void language sql as $$
  insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, fuel_litres, trips,
                                       status, author_id, approver_id, approved_at)
  values ('15190000-0000-0000-0000-00000000000a', p_asset::uuid, p_project::uuid, p_date, p_qty, p_unit, p_kind, p_fuel, p_trips,
          p_status, '15190000-0000-0000-0000-0000000000a6',
          case when p_status in ('Approved','Rejected') then '15190000-0000-0000-0000-0000000000a3'::uuid end,
          case when p_status = 'Approved' then now() end);
$$;
```

Ledger Fixture F2 (S3+ files append it as superuser; the chart is a group `Plant - EQ` holding `Depreciation - EQ` and
`Fuel - EQ`, plus `Repairs - EQ`; `Equipment` maps both plant accounts):

```sql
insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, parent_account, is_group, account_currency, lft, rgt, refresh_id) values
  ('15190000-0000-0000-0000-00000000000a','EQ','Plant - EQ','Plant','Expense','Profit and Loss',null,true,'IDR',1,6,'15190000-0000-0000-0000-0000000000f0'),
  ('15190000-0000-0000-0000-00000000000a','EQ','Depreciation - EQ','Depreciation','Expense','Profit and Loss','Plant - EQ',false,'IDR',2,3,'15190000-0000-0000-0000-0000000000f0'),
  ('15190000-0000-0000-0000-00000000000a','EQ','Fuel - EQ','Fuel','Expense','Profit and Loss','Plant - EQ',false,'IDR',4,5,'15190000-0000-0000-0000-0000000000f0'),
  ('15190000-0000-0000-0000-00000000000a','EQ','Repairs - EQ','Repairs','Expense','Profit and Loss',null,false,'IDR',7,8,'15190000-0000-0000-0000-0000000000f0');
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('15190000-0000-0000-0000-00000000000a','Equipment','Depreciation - EQ',true),
  ('15190000-0000-0000-0000-00000000000a','Equipment','Fuel - EQ',false);
insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified) values
  -- G1: Loader-1 September depreciation, 800.00 (AC-EQU-001)
  ('15190000-0000-0000-0000-0000000001a1','15190000-0000-0000-0000-00000000000a','EQ-GL-1','EQ','Depreciation - EQ','Loader-1 - EQ','2026',null,null,null,'2026-09-30',800,0,false,'1'),
  -- G2: Loader-1 July depreciation with no July usage (AC-EQU-005)
  ('15190000-0000-0000-0000-0000000001a2','15190000-0000-0000-0000-00000000000a','EQ-GL-2','EQ','Depreciation - EQ','Loader-1 - EQ','2026',null,null,null,'2026-07-31',500,0,false,'1'),
  -- G3: tagged to the ERP project of P1: never pooled
  ('15190000-0000-0000-0000-0000000001a3','15190000-0000-0000-0000-00000000000a','EQ-GL-3','EQ','Depreciation - EQ','Loader-1 - EQ','2026','PRJ-P1',null,null,'2026-09-30',300,0,false,'1'),
  -- G4: cancelled: never pooled
  ('15190000-0000-0000-0000-0000000001a4','15190000-0000-0000-0000-00000000000a','EQ-GL-4','EQ','Depreciation - EQ','Loader-1 - EQ','2026',null,null,null,'2026-09-15',9999,0,true,'1'),
  -- G5: Truck-1 August fuel, 100.00 split three ways (AC-EQU-004)
  ('15190000-0000-0000-0000-0000000001a5','15190000-0000-0000-0000-00000000000a','EQ-GL-5','EQ','Fuel - EQ','Truck-1 - EQ','2026',null,null,null,'2026-08-20',100,0,false,'1'),
  -- G6: office depreciation (no asset cost centre): a #1271 rule may take it (AC-EQU-009)
  ('15190000-0000-0000-0000-0000000001a6','15190000-0000-0000-0000-00000000000a','EQ-GL-6','EQ','Depreciation - EQ','Office - EQ','2026',null,null,null,'2026-09-30',200,0,false,'1');
insert into erp_actuals_snapshot (org_id, project_id, cost_center, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('15190000-0000-0000-0000-00000000000a','15190000-0000-0000-0000-0000000000c1','Loader-1 - EQ','Depreciation - EQ','2026',300,0,300,'15190000-0000-0000-0000-0000000000e1');
```

All dates are before the planning date (2026-11-01), so the S1 future-date refusal never trips on a fixture.

---

## S1 - Assets, usage entries, approval (`0447_equipment_usage.sql`) — SoD tier, ships alone

Covers AC-EQU-007 and the entry half of AC-EQU-012; FR-EQU-001..004, 010..013, 020, 022, 060..064. Header:

```sql
-- 0447_equipment_usage.sql — #1519 S1: thin equipment asset reference, usage entries, the draft → submitted →
-- approved|rejected transition with approver ≠ author, bulk asset-week approve, archive. Spec:
-- docs/specs/equipment-usage.spec.md (signed 2026-11-01; OQ-1..9 defaults are rulings, OD-GRILL-20261101).
-- Plan: docs/plans/2026-11-01-equipment-usage.md S1. Proven by supabase/tests/equipment_usage.test.sql and
-- supabase/tests/equipment_rls.test.sql. Nothing here writes to the ERP.
-- ── REVERSE (also supabase/migrations/rollback/0447_equipment_usage_down.sql) ──────────────────────────
--   drop function if exists public.archive_equipment_usage(uuid);
--   drop function if exists public.approve_equipment_usage_week(uuid, date);
--   drop function if exists public.transition_equipment_usage(uuid, text, text);
--   drop function if exists public.save_equipment_usage(jsonb);
--   drop function if exists public.equipment_usage_transition_core(uuid, text, text);
--   drop function if exists public.equipment_can_approve(uuid, public.user_role, uuid, uuid);
--   drop function if exists public.equipment_entry_locked_unit(uuid, uuid, date);
--   drop function if exists public.equipment_org_today(uuid);
--   drop table if exists public.equipment_usage_entries;   -- drops its triggers
--   drop function if exists public.audit_equipment_usage_delete();
--   drop table if exists public.equipment_assets;
```

### S1.1 Failing test: the transition, SoD and audit (AC-EQU-007)

Create `supabase/tests/equipment_usage.test.sql` (new) = F1, then:

```sql
create temp table _e (k text primary key, v uuid) on commit drop;
grant all on _e to authenticated;
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Eng1 logs on P1
insert into _e select 'e1', (save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-10","quantity":6,"unit":"hours"}'::jsonb)->>'id')::uuid;
select is((select status from equipment_usage_entries where id = (select v from _e where k='e1')), 'Draft', 'AC-EQU-007 a new entry is Draft');
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Submitted') $$, 'AC-EQU-007 the author submits');
select throws_like($$ select transition_equipment_usage((select v from _e where k='e1'), 'Approved') $$,
  '%separation of duties%', 'AC-EQU-007 the author cannot approve their own entry');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a4');   -- PM2 does not manage P1
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Approved') $$,
  '42501', null, 'AC-EQU-007 a PM of another project cannot approve');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a7');   -- Engineer
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Approved') $$,
  '42501', null, 'AC-EQU-007 an Engineer cannot approve');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1 manages P1
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Approved') $$,
  'AC-EQU-007 the project''s PM approves');
select is((select approver_id from equipment_usage_entries where id = (select v from _e where k='e1')),
  '15190000-0000-0000-0000-0000000000a3'::uuid, 'AC-EQU-007 the approver is stamped');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');
select throws_ok($$ select save_equipment_usage(jsonb_build_object('id',(select v from _e where k='e1'),
  'asset_id','15190000-0000-0000-0000-0000000000d1','project_id','15190000-0000-0000-0000-0000000000c1',
  'work_date','2026-09-10','quantity',7,'unit','hours')) $$, '22023', null, 'AC-EQU-007 an approved entry is immutable');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Draft') $$,
  '42501', null, 'AC-EQU-007 only an Admin reopens an approved entry');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Draft', 'wrong project') $$,
  'AC-EQU-007 an Admin (not the author) reopens');
select is((select count(*)::int from audit_events where entity_id = (select v from _e where k='e1')
            and action like 'equipment_usage.%'), 4, 'AC-EQU-007 create, submit, approve and reopen each wrote an audit row');
select ok((select detail ? 'from' and detail ? 'to' from audit_events where entity_id = (select v from _e where k='e1')
            and action = 'equipment_usage.approved'), 'AC-EQU-007 the audit row carries before/after status');
```

Plus the FR-EQU-002/003/004/OQ-7/OQ-8 rows in the same file (titles prefixed `AC-EQU-007` because they are the entry contract):
negative quantity, 25 h, 1.5 days, a future work date (`(now() at time zone 'Asia/Jakarta')::date + 1`), a foreign project
(`…cb`) and a foreign asset (`…d9`) are refused (`22023`, `22023`, `22023`, `22023`, `P0002`, `P0002`); a second entry on the same
(asset, project, date, kind) is `23505`; the same asset on P2 the same day for 20 h returns `over_24h = true` and is saved;
no rate or setting is needed to save (FR-EQU-004); bulk approve as PM1 of an asset-week holding one PM1-authored entry, one
Eng1 entry on P1 and one Eng1 entry on P2 returns `{"approved":1,"skipped_own":1,"skipped_not_permitted":1}`.

Run: `scripts/with-db-lock.sh supabase test db supabase/tests/equipment_usage.test.sql` → fails (no tables).

### S1.2 Tables, indexes, org stamp

```sql
create table public.equipment_assets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  code          text not null check (char_length(btrim(code)) between 1 and 40),
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  default_unit  text not null default 'hours' check (default_unit in ('hours','days')),
  external_tier text,          -- OQ-9: reserved for the #1511/#899 mirror adoption; no client write grant
  external_ref  text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz,
  constraint equipment_assets_external_pair check ((external_tier is null) = (external_ref is null))
);
create unique index equipment_assets_code_live on public.equipment_assets (org_id, lower(btrim(code))) where archived_at is null;
create unique index equipment_assets_external on public.equipment_assets (org_id, external_tier, external_ref) where external_ref is not null;
create trigger equipment_assets_stamp_org_id before insert on public.equipment_assets for each row execute function public.stamp_org_id();

create table public.equipment_usage_entries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,  -- stated by the RPC, no default
  asset_id       uuid not null references public.equipment_assets(id) on delete restrict,
  project_id     uuid not null references public.projects(id) on delete restrict,
  work_date      date not null,
  quantity       numeric(6,2) not null,
  unit           text not null check (unit in ('hours','days')),
  kind           text not null default 'work' check (kind in ('work','standby')),
  fuel_litres    numeric(10,2),
  trips          int,
  note           text check (note is null or char_length(note) <= 500),
  status         text not null default 'Draft' check (status in ('Draft','Submitted','Approved','Rejected')),
  author_id      uuid not null references public.profiles(id),
  approver_id    uuid references public.profiles(id),
  approved_at    timestamptz,
  decision_notes text check (decision_notes is null or char_length(decision_notes) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,
  constraint equipment_usage_quantity_range check (quantity >= 0 and ((unit = 'hours' and quantity <= 24) or (unit = 'days' and quantity <= 1))),
  constraint equipment_usage_fuel_range check (fuel_litres is null or (fuel_litres >= 0 and fuel_litres < 'Infinity'::numeric)),
  constraint equipment_usage_trips_range check (trips is null or trips >= 0),
  constraint equipment_usage_sod check (approver_id is null or approver_id <> author_id),
  constraint equipment_usage_approved_stamped check ((status = 'Approved') = (approved_at is not null))
);
create unique index equipment_usage_one_per_day on public.equipment_usage_entries (org_id, asset_id, project_id, work_date, kind) where archived_at is null;
-- NFR-EQU-003: the allocation and totals reads scan by (org, asset, date) on approved rows.
create index equipment_usage_asset_date on public.equipment_usage_entries (org_id, asset_id, work_date, status);
create index equipment_usage_project_date on public.equipment_usage_entries (org_id, project_id, work_date) where status = 'Approved' and archived_at is null;
create index equipment_usage_author on public.equipment_usage_entries (author_id);
```

### S1.3 RLS and grants (FR-EQU-062/063/064)

```sql
alter table public.equipment_assets enable row level security;  alter table public.equipment_assets force row level security;
alter table public.equipment_usage_entries enable row level security;  alter table public.equipment_usage_entries force row level security;

-- every active member reads the asset reference (the usage grid needs the picker)
create policy equipment_assets_select on public.equipment_assets for select
  using (org_id = public.auth_org_id() and public.is_active_member());
-- FR-EQU-022: Admin or PM keeps the thin reference by hand
create policy equipment_assets_insert on public.equipment_assets for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Project Manager'));
create policy equipment_assets_update on public.equipment_assets for update
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Project Manager'))
  with check (org_id = public.auth_org_id());
create policy equipment_assets_delete on public.equipment_assets for delete
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin');
revoke all on public.equipment_assets from public, anon, authenticated;
grant select, delete on public.equipment_assets to authenticated;
grant insert (code, name, default_unit) on public.equipment_assets to authenticated;
grant update (code, name, default_unit, archived_at) on public.equipment_assets to authenticated;

-- entries: own rows, or the usage audience; Engineers never see another's entry (FR-EQU-062)
create policy equipment_usage_entries_select on public.equipment_usage_entries for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and (author_id = auth.uid() or public.auth_role() in ('Admin','Finance','Executive','Project Manager')));
create policy equipment_usage_entries_delete on public.equipment_usage_entries for delete
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin');
revoke all on public.equipment_usage_entries from public, anon, authenticated;
grant select, delete on public.equipment_usage_entries to authenticated;   -- no INSERT/UPDATE: RPCs only (PQ-8)
grant all on public.equipment_assets, public.equipment_usage_entries to service_role;

create function public.audit_equipment_usage_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('equipment_usage.delete', old.org_id, auth.uid(), old.id, jsonb_build_object('before', to_jsonb(old)));
  return old;
end $$;
revoke all on function public.audit_equipment_usage_delete() from public, anon, authenticated;
create trigger equipment_usage_entries_audit_delete after delete on public.equipment_usage_entries
  for each row execute function public.audit_equipment_usage_delete();
```

### S1.4 Internal helpers

```sql
-- Internal helpers are plain (invoker) functions: called only from the definers below, which run as owner, so they
-- need no definer bit and stay off the isolation denominator (0376 cost_attribution_normalize pattern).
create function public.equipment_org_today(p_org uuid) returns date
  language sql stable set search_path = public, pg_temp as $$
  select (now() at time zone coalesce(o.default_timezone, 'UTC'))::date from public.organizations o where o.id = p_org
$$;  -- NFR-EQU-004, same cut as 0247:724

-- S1 stub: no costing settings exist yet. S2 replaces the body (same signature) with the unit a covering
-- hire_rate / actual_cost-units setting fixes (FR-EQU-032).
create function public.equipment_entry_locked_unit(p_org uuid, p_asset uuid, p_date date) returns text
  language sql stable set search_path = public, pg_temp as $$ select null::text $$;

-- FR-EQU-061: PM for projects they manage, Executive, Finance, Admin. Author exclusion is checked by the caller FIRST.
create function public.equipment_can_approve(p_uid uuid, p_role public.user_role, p_org uuid, p_project uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select coalesce(p_role in ('Admin','Executive','Finance')
                  or (p_role = 'Project Manager' and exists (
                        select 1 from public.projects p where p.id = p_project and p.org_id = p_org and p.project_manager_id = p_uid)),
                  false)
$$;
revoke all on function public.equipment_org_today(uuid) from public, anon, authenticated;
revoke all on function public.equipment_entry_locked_unit(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.equipment_can_approve(uuid, public.user_role, uuid, uuid) from public, anon, authenticated;
```

### S1.5 `save_equipment_usage(p_entry jsonb) returns jsonb`

```sql
create function public.save_equipment_usage(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_id uuid; v_asset uuid; v_project uuid; v_date date; v_qty numeric; v_fuel numeric; v_trips int;
  v_unit text; v_kind text; v_note text; v_cur public.equipment_usage_entries; v_after public.equipment_usage_entries;
  v_locked text; v_day numeric;
begin
  perform public.assert_is_active_member();
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'entry must be a JSON object' using errcode = '22023';
  end if;
  begin
    v_id := nullif(p_entry->>'id','')::uuid;            v_asset := (p_entry->>'asset_id')::uuid;
    v_project := (p_entry->>'project_id')::uuid;        v_date := (p_entry->>'work_date')::date;
    v_qty := (p_entry->>'quantity')::numeric;           v_fuel := nullif(p_entry->>'fuel_litres','')::numeric;
    v_trips := nullif(p_entry->>'trips','')::int;
  exception when others then
    raise exception 'asset_id, project_id, work_date, quantity, fuel_litres or trips is malformed' using errcode = '22023';
  end;
  v_unit := p_entry->>'unit'; v_kind := coalesce(nullif(p_entry->>'kind',''), 'work');
  v_note := nullif(btrim(coalesce(p_entry->>'note','')), '');
  if v_unit is null or v_unit not in ('hours','days') then raise exception 'unit must be hours or days' using errcode = '22023'; end if;
  if v_kind not in ('work','standby') then raise exception 'kind must be work or standby' using errcode = '22023'; end if;
  if v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty < 0 or round(v_qty, 2) <> v_qty then
    raise exception 'quantity must be zero or more, with at most 2 decimals' using errcode = '22023';
  end if;
  if (v_unit = 'hours' and v_qty > 24) or (v_unit = 'days' and v_qty > 1) then
    raise exception 'one entry holds at most 24 hours or 1 day' using errcode = '22023';
  end if;
  if v_fuel is not null and (v_fuel::text in ('NaN','Infinity','-Infinity') or v_fuel < 0 or round(v_fuel, 2) <> v_fuel) then
    raise exception 'fuel litres must be zero or more' using errcode = '22023';
  end if;
  if v_trips is not null and v_trips < 0 then raise exception 'trips must be zero or more' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'the note is at most 500 characters' using errcode = '22023'; end if;
  if v_date is null or v_date > public.equipment_org_today(v_org) then
    raise exception 'the work date is in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;
  if not exists (select 1 from public.equipment_assets a where a.id = v_asset and a.org_id = v_org and a.archived_at is null) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  v_locked := public.equipment_entry_locked_unit(v_org, v_asset, v_date);
  if v_locked is not null and v_locked <> v_unit then
    raise exception 'this asset is costed per % on that date; log it in %', v_locked, v_locked using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind,
                                                fuel_litres, trips, note, status, author_id)
    values (v_org, v_asset, v_project, v_date, v_qty, v_unit, v_kind, v_fuel, v_trips, v_note, 'Draft', v_uid)
    returning * into v_after;                                   -- 23505 from equipment_usage_one_per_day
    perform public.log_audit('equipment_usage.create', v_org, v_uid, v_after.id, jsonb_build_object('to', 'Draft', 'after', to_jsonb(v_after)));
  else
    select * into v_cur from public.equipment_usage_entries e where e.id = v_id for update;
    if not found or v_cur.org_id is distinct from v_org then raise exception 'entry not found' using errcode = 'P0002'; end if;
    if v_cur.author_id is distinct from v_uid then raise exception 'only the author edits an entry' using errcode = '42501'; end if;  -- null-safe
    if v_cur.status not in ('Draft','Rejected') or v_cur.archived_at is not null then
      raise exception 'only a draft or rejected entry can be edited' using errcode = '22023';
    end if;
    update public.equipment_usage_entries set asset_id = v_asset, project_id = v_project, work_date = v_date, quantity = v_qty,
           unit = v_unit, kind = v_kind, fuel_litres = v_fuel, trips = v_trips, note = v_note, updated_at = now()
     where id = v_id returning * into v_after;
    perform public.log_audit('equipment_usage.update', v_org, v_uid, v_id, jsonb_build_object('before', to_jsonb(v_cur), 'after', to_jsonb(v_after)));
  end if;
  -- OQ-7 / PQ-12: warn, never block, when the asset's day exceeds 24 h across projects
  select coalesce(sum(case when e.unit = 'hours' then e.quantity else e.quantity * 24 end), 0) into v_day
    from public.equipment_usage_entries e
   where e.org_id = v_org and e.asset_id = v_asset and e.work_date = v_date and e.archived_at is null and e.status <> 'Rejected';
  return jsonb_build_object('id', v_after.id, 'status', v_after.status, 'day_total_hours', v_day, 'over_24h', v_day > 24);
end $$;
```

### S1.6 Transition core, single and bulk RPCs, archive

```sql
create function public.equipment_usage_transition_core(p_id uuid, p_to text, p_notes text) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role(); v_e public.equipment_usage_entries;
  v_legal jsonb := jsonb_build_object('Draft', jsonb_build_array('Submitted'), 'Submitted', jsonb_build_array('Approved','Rejected'),
                                      'Rejected', jsonb_build_array('Draft'), 'Approved', jsonb_build_array('Draft'));
  v_action text;
begin
  select * into v_e from public.equipment_usage_entries e where e.id = p_id for update;
  if not found then raise exception 'entry not found' using errcode = 'P0002'; end if;
  -- SECURITY: definer bypasses RLS; this org re-assertion MUST stay.
  if v_e.org_id is distinct from public.auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_e.archived_at is not null then raise exception 'an archived entry cannot move' using errcode = '22023'; end if;
  if p_to is null or not coalesce((v_legal -> v_e.status) ? p_to, false) then
    raise exception 'illegal transition % -> %', v_e.status, p_to using errcode = '22023';
  end if;
  if p_to = 'Submitted' or (v_e.status = 'Rejected' and p_to = 'Draft') then
    if v_uid is distinct from v_e.author_id then raise exception 'not authorized' using errcode = '42501'; end if;
    v_action := case when p_to = 'Submitted' then 'submitted' else 'redraft' end;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS (FR-EQU-011, the 0180 transition_timesheet order). Do not reorder.
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot decide own equipment usage' using errcode = '42501'; end if;
    if not public.equipment_can_approve(v_uid, v_role, v_e.org_id, v_e.project_id) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    v_action := lower(p_to);
  else  -- Approved -> Draft: Admin reopen (FR-EQU-012), never by the author
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot reopen own equipment usage' using errcode = '42501'; end if;
    if v_role is distinct from 'Admin' then raise exception 'only an Admin reopens approved usage' using errcode = '42501'; end if;
    v_action := 'reopen';
  end if;
  update public.equipment_usage_entries
     set status = p_to,
         approver_id = case when p_to in ('Approved','Rejected') then v_uid when p_to = 'Draft' then null else approver_id end,
         approved_at = case when p_to = 'Approved' then now() else null end,
         decision_notes = case when p_to in ('Approved','Rejected') or v_action = 'reopen' then nullif(btrim(coalesce(p_notes,'')), '')
                               else decision_notes end,
         updated_at = now()
   where id = p_id;
  perform public.log_audit('equipment_usage.' || v_action, v_e.org_id, v_uid, p_id,
    jsonb_build_object('from', v_e.status, 'to', p_to, 'notes', p_notes));
  return p_to;
end $$;
revoke all on function public.equipment_usage_transition_core(uuid, text, text) from public, anon, authenticated;

create function public.transition_equipment_usage(p_id uuid, p_to text, p_notes text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  return public.equipment_usage_transition_core(p_id, p_to, p_notes);
end $$;

-- OQ-8 / PQ-7: approve one asset-week; each approval runs the single-entry checks.
create function public.approve_equipment_usage_week(p_asset_id uuid, p_week_start date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role(); v_e record;
        v_ok int := 0; v_own int := 0; v_denied int := 0;
begin
  perform public.assert_is_active_member();
  if p_week_start is null then raise exception 'week_start is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.equipment_assets a where a.id = p_asset_id and a.org_id = public.auth_org_id()) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  for v_e in select e.id, e.author_id, e.project_id from public.equipment_usage_entries e
              where e.org_id = public.auth_org_id() and e.asset_id = p_asset_id and e.status = 'Submitted' and e.archived_at is null
                and e.work_date between p_week_start and p_week_start + 6
              order by e.work_date, e.id for update loop
    if v_e.author_id is not distinct from v_uid then v_own := v_own + 1;
    elsif not public.equipment_can_approve(v_uid, v_role, public.auth_org_id(), v_e.project_id) then v_denied := v_denied + 1;
    else perform public.equipment_usage_transition_core(v_e.id, 'Approved', null); v_ok := v_ok + 1;
    end if;
  end loop;
  return jsonb_build_object('approved', v_ok, 'skipped_own', v_own, 'skipped_not_permitted', v_denied);
end $$;

-- FR-EQU-064: soft archive. Author while Draft/Rejected; Admin while not Approved (reopen first).
create function public.archive_equipment_usage(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e public.equipment_usage_entries;
begin
  perform public.assert_is_active_member();
  select * into v_e from public.equipment_usage_entries e where e.id = p_id for update;
  if not found or v_e.org_id is distinct from public.auth_org_id() then raise exception 'entry not found' using errcode = 'P0002'; end if;
  if v_e.status = 'Approved' then raise exception 'reopen approved usage before archiving it' using errcode = '22023'; end if;
  if not (v_e.author_id is not distinct from auth.uid() and v_e.status in ('Draft','Rejected')) and public.auth_role() is distinct from 'Admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.equipment_usage_entries set archived_at = now(), updated_at = now() where id = p_id and archived_at is null;
  perform public.log_audit('equipment_usage.archive', v_e.org_id, auth.uid(), p_id, jsonb_build_object('status', v_e.status));
end $$;

alter function public.save_equipment_usage(jsonb) owner to postgres;
alter function public.transition_equipment_usage(uuid, text, text) owner to postgres;
alter function public.approve_equipment_usage_week(uuid, date) owner to postgres;
alter function public.archive_equipment_usage(uuid) owner to postgres;
revoke all on function public.save_equipment_usage(jsonb), public.transition_equipment_usage(uuid, text, text),
  public.approve_equipment_usage_week(uuid, date), public.archive_equipment_usage(uuid) from public, anon, authenticated;
grant execute on function public.save_equipment_usage(jsonb), public.transition_equipment_usage(uuid, text, text),
  public.approve_equipment_usage_week(uuid, date), public.archive_equipment_usage(uuid) to authenticated;
```

Run S1.1's file → green. **Mutation checks** (each must turn rows red, then revert): move the SoD `if` below the authority
check and make `equipment_can_approve` return `true` (the author-approve row); delete the org re-assertion in the core (S1.7's
cross-org row); drop `equipment_usage_sod` and the SoD `if` together (the CHECK row in S1.7).

### S1.7 Failing test then pass: RLS and direct-write denial (AC-EQU-012, entry half)

Create `supabase/tests/equipment_rls.test.sql` (new) = F1 + two entries inserted with `pg_temp.usage` (one Eng1 on P1, one
Eng2 on P2), then as `authenticated`:

```sql
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from equipment_usage_entries), 1, 'AC-EQU-012 an Engineer reads only their own entries');
select throws_ok($$ insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, status, author_id)
  values ('15190000-0000-0000-0000-00000000000a','15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c1',
          '2026-09-01', 1, 'hours', 'Approved', '15190000-0000-0000-0000-0000000000a6') $$, '42501', null,
  'AC-EQU-012 no direct INSERT on entries');
select throws_ok($$ update equipment_usage_entries set status = 'Approved' $$, '42501', null, 'AC-EQU-012 no direct UPDATE of status');
select throws_ok($$ insert into equipment_assets (code, name) values ('ENG-1','x') $$, '42501', null,
  'AC-EQU-012 an Engineer cannot create an asset reference');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from equipment_usage_entries), 2, 'AC-EQU-012 a PM reads the org''s usage');
select lives_ok($$ insert into equipment_assets (code, name, default_unit) values ('PMA-1','PM asset','days') $$,
  'AC-EQU-012 a PM creates a thin asset reference (FR-EQU-022)');
select is((select org_id from equipment_assets where code = 'PMA-1'), '15190000-0000-0000-0000-00000000000a'::uuid,
  'AC-EQU-012 org_id is stamped, never sent');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from equipment_usage_entries), 0, 'AC-EQU-012 another org reads no entry');
select is((select count(*)::int from equipment_assets where org_id = '15190000-0000-0000-0000-00000000000a'), 0,
  'AC-EQU-012 another org reads no asset');
select throws_ok($$ select transition_equipment_usage((select v from _e where k = 'p1'), 'Approved') $$,
  '42501', null, 'AC-EQU-012 another org cannot move an entry (the definer re-asserts the org)');
select throws_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d9","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-01","quantity":1,"unit":"hours"}') $$,
  'P0002', null, 'AC-EQU-012 a foreign project cannot be targeted');
```

`_e` (as in S1.1) holds the id of the Eng1 entry on P1 under key `p1`, captured as superuser before `set local role`. Also: as Eng1, `delete from equipment_usage_entries` deletes 0 rows; as Admin it deletes 1 and writes an
`equipment_usage.delete` audit row; superuser `update … set approver_id = author_id` raises `23514`.

Archive rows (FR-EQU-064, titles `AC-EQU-012 …`): Eng1 saves a Draft through `save_equipment_usage` and
`archive_equipment_usage` lives, the row keeps existing with `archived_at` set and an `equipment_usage.archive` audit row;
Eng2 archiving Eng1's Draft → `42501`; archiving the Approved `p1` entry, even as Admin → `22023` ("reopen approved usage
before archiving it"); a new entry on the archived row's (asset, project, date, kind) saves (the partial unique index frees it).

### S1.8 Self-assertion block, rollback file, denominators

Append the `do $$` ACL assertion (internals `equipment_org_today`, `equipment_entry_locked_unit`, `equipment_can_approve`,
`equipment_usage_transition_core` not executable by `authenticated`, and none of them `prosecdef`; nothing new executable by
`anon` or `public`). Write `supabase/migrations/rollback/0447_equipment_usage_down.sql` = the header's REVERSE list. Add both
tables to `scripts/isolation-probe-denominator.json` (`{"table":"equipment_assets","has_org":true,"pk":"id","columns":"*","b_read":"own-org-only","by_id":"applicable"}`
and the same for `equipment_usage_entries`) and exactly these four definers to its function list:
`"approve_equipment_usage_week(uuid,date)"`, `"archive_equipment_usage(uuid)"`, `"save_equipment_usage(jsonb)"`,
`"transition_equipment_usage(uuid,text,text)"` (the trigger function `audit_equipment_usage_delete` is excluded by the
guard); amend 0178 (+4).

### S1.9 Gate

Run the migration-slice gate (Conventions) with files `equipment_usage.test.sql equipment_rls.test.sql`; regenerate types.

---

## S2 - Costing settings, hire-rate charges, reads (`0448_equipment_costing.sql`) — money, ships alone

Covers AC-EQU-002, 003, 008, 015, the settings half of AC-EQU-012, and the hire-rate half of AC-EQU-006.
Header REVERSE list (in order): drop `list_equipment_usage_totals(uuid,uuid,date,date)`,
`list_equipment_allocations(uuid,date,date,uuid)`, `preview_equipment_costing(jsonb)`, `list_equipment_costing(boolean)`,
`end_equipment_costing(uuid,date,int)`, `save_equipment_costing(jsonb)`, `equipment_costing_write(jsonb,text,boolean)`,
`equipment_hire_charges(uuid,jsonb,uuid)`, `equipment_usage_by_project(uuid)`, `equipment_settings_effective(uuid,jsonb)`,
`equipment_costing_assert_no_conflict(uuid,jsonb)`, `cost_attribution_matches_overlap(uuid,text,text,text,text,text,text,text,text,text,text)`,
`equipment_costing_normalize(uuid,jsonb,boolean)`, `equipment_costing_content(uuid)`, table `equipment_costing_settings`;
then restore S1's stub body of `equipment_entry_locked_unit`.

### S2.1 Failing test: hire rate, standby, versions (AC-EQU-003, AC-EQU-008)

Create `supabase/tests/equipment_costing.test.sql` (new) = F1 + `insert into budget_category_account_map (org_id, category,
erp_account, is_push_target) values ('15190000-0000-0000-0000-00000000000a','Equipment','Depreciation - EQ',true);` then:

```sql
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4','15190000-0000-0000-0000-0000000000c1','2026-10-05',10,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4','15190000-0000-0000-0000-0000000000c1','2026-10-05',4,'hours','standby');
create temp table _s (k text primary key, v jsonb) on commit drop;  grant all on _s to authenticated;
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');   -- Finance
insert into _s select 'exc', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"hire_rate",
  "work_rate":50,"standby_rate":20,"rate_unit":"hours","effective_from":"2026-01-01"}');
select is((select amount from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-10-01','2026-10-31')
            where project_id = '15190000-0000-0000-0000-0000000000c1'), 580.00::numeric,
  'AC-EQU-003 10 h work × 50 + 4 h standby × 20 = 580.00');
select is((select row(work_units, standby_units, work_rate, standby_rate, entry_count)::text
             from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-10-01','2026-10-31')),
  '(10.00,4.00,50.00,20.00,2)', 'AC-EQU-003 the drill-down exposes units, rates and entry count (FR-EQU-044)');

-- AC-EQU-008: v1 50/h from 2026-01-01, v2 60/h from 2026-07-01 on GEN-1; March and August usage
select pg_temp.usage('15190000-0000-0000-0000-0000000000d3','15190000-0000-0000-0000-0000000000c1','2026-03-10',10,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d3','15190000-0000-0000-0000-0000000000c1','2026-08-10',10,'hours');
insert into _s select 'gen', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d3","basis":"hire_rate",
  "work_rate":50,"rate_unit":"hours","effective_from":"2026-01-01"}');
select lives_ok($$ select save_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _s where k='gen'),
  'expected_version',1,'asset_id','15190000-0000-0000-0000-0000000000d3','basis','hire_rate','work_rate',60,'rate_unit','hours',
  'effective_from','2026-07-01')) $$, 'AC-EQU-008 v2 from mid-year is saved');
select is(array(select month::text || '=' || amount::text || '@v' || version from list_equipment_allocations(
  '15190000-0000-0000-0000-0000000000d3','2026-01-01','2026-12-31') order by month),
  array['2026-03-01=500.00@v1','2026-08-01=600.00@v2'], 'AC-EQU-008 periods before the change keep v1, after use v2');
select throws_ok($$ select save_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _s where k='gen'),
  'expected_version',1,'asset_id','15190000-0000-0000-0000-0000000000d3','basis','hire_rate','work_rate',70,'rate_unit','hours',
  'effective_from','2026-09-01')) $$, '40001', null, 'AC-EQU-008 a stale expected_version is refused');
select is((select count(*)::int from audit_events where action like 'equipment_costing.%'), 3,
  'AC-EQU-008 each saved version wrote an audit row with before/after');
```

Same file, more rows: AC-EQU-002, owning title `AC-EQU-002 basis none shows usage per project and no amount` (basis `none` on TRK-1 with approved usage on P1 and P2: `list_equipment_allocations` returns
two `status = 'usage_only'` rows with `amount is null`, `list_equipment_usage_totals` shows both projects' units, and
`preview_equipment_costing` of a `none` draft returns zero rows); AC-EQU-015, owning title `AC-EQU-015 a units setting after a day entry in the window is refused (mixed units)` (LDR-1 has a
`days` entry on 2026-09-15; saving a `hire_rate` with `rate_unit = 'hours'` from 2026-09-01 → `throws_like '%mixed units%'`;
saving the same setting from 2026-10-01 lives; then, as Eng1, `save_equipment_usage` of a `days` row on 2026-10-15 →
`throws_like '%costed per hours%'`. **Match the message, not only `22023`:** a future-dated row is also `22023`, so a
code-only assertion could pass for the wrong reason. All dates stay before the planning date; never use "today" or later);
an `actual_cost` `units` setting from 2026-09-16 is refused the same way because its driver shares the whole month
(PQ-5): the check starts at the first day of the `effective_from` month;
AC-EQU-006 (hire-rate half: a Submitted and a Rejected EXC-1 row added in October leave the 580.00 unchanged).
Mutation check: in `equipment_hire_charges` drop `e.status = 'Approved'` → the AC-EQU-006 row goes red.

Run: `scripts/with-db-lock.sh supabase test db supabase/tests/equipment_costing.test.sql` → fails.

### S2.2 Table

```sql
create table public.equipment_costing_settings (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  asset_id            uuid not null references public.equipment_assets(id) on delete restrict,
  setting_key         uuid not null,
  version             int not null check (version >= 1),
  is_current          boolean not null default true,
  basis               text not null check (basis in ('none','hire_rate','actual_cost')),
  work_rate           numeric(14,2) check (work_rate is null or (work_rate >= 0 and work_rate < 'Infinity'::numeric)),
  standby_rate        numeric(14,2) check (standby_rate is null or (standby_rate >= 0 and standby_rate < 'Infinity'::numeric)),
  rate_unit           text check (rate_unit is null or rate_unit in ('hours','days')),
  driver              text check (driver is null or driver in ('units','fuel','trips')),
  count_standby       boolean not null default false,                         -- OQ-6
  charge_category     public.budget_category,                                 -- OQ-3 / PQ-3 (hire_rate only)
  match_account       text, match_account_group text, match_cost_center text, match_party_type text, match_party text,
  specificity         int not null default 0,
  effective_from      date not null,
  effective_to        date,
  applies_to          date,                                                    -- PQ-4, written only by the writer
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  unique (org_id, setting_key, version),
  constraint equipment_costing_window check (effective_to is null or effective_to >= effective_from - 1),
  constraint equipment_costing_shape check (
    (basis = 'none' and work_rate is null and standby_rate is null and driver is null and match_account is null and match_account_group is null)
    or (basis = 'hire_rate' and work_rate is not null and rate_unit is not null and charge_category is not null and driver is null
        and match_account is null and match_account_group is null)
    or (basis = 'actual_cost' and driver is not null and work_rate is null and standby_rate is null
        and (match_account is null) <> (match_account_group is null) and (driver <> 'units' or rate_unit is not null)))
);
create unique index equipment_costing_one_current on public.equipment_costing_settings (org_id, setting_key) where is_current;
create index equipment_costing_asset on public.equipment_costing_settings (org_id, asset_id);
alter table public.equipment_costing_settings enable row level security;
alter table public.equipment_costing_settings force row level security;
create policy equipment_costing_settings_select on public.equipment_costing_settings for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and public.auth_role() in ('Admin','Finance','Executive','Project Manager'));
revoke all on public.equipment_costing_settings from public, anon, authenticated;
grant select on public.equipment_costing_settings to authenticated;
grant all on public.equipment_costing_settings to service_role;
```

### S2.3 Normalise, content, overlap predicate, conflict check

`equipment_costing_normalize(p_org uuid, p_setting jsonb, p_check_accounts boolean) returns jsonb` (stable, internal). It
parses `setting_key`, `asset_id`, `effective_from`, `effective_to` in one `begin … exception` block (→ `22023`), then:
asset in org and not archived (`P0002`); `basis` in the three values (`22023`); per basis the field rules of the CHECK above
with messages ("a hire rate needs a work rate and a unit", "actual cost needs a driver", "name exactly one of account or
account_group"); rates `≥ 0`, two decimals; for `hire_rate`, `charge_category` defaults to `'Equipment'` and must have a row
in `budget_category_account_map` for the org (`P0002` "map an account to the % category first", PQ-3); for `actual_cost`,
when `p_check_accounts`, the account/group existence checks **copied from 0376 `:126-139`** (same `P0002` messages);
`specificity = 10 * ((cc is not null)::int + (party is not null)::int) + case when account is not null then 2 else 1 end`
for `actual_cost`, `0` otherwise (0376 `:171`). Returns the normalised object (keys as the table columns plus `setting_key`).

`equipment_costing_content(p_id uuid) returns jsonb` = the row's content keys (everything but ids, version, stamps,
`applies_to`, `is_current`), so an identical save is detected exactly as 0376 `:367-370`.

The overlap predicate is extracted (verbatim logic of 0376 `:191-205`) so S3 can reuse it for the #1271 side:

```sql
create function public.cost_attribution_matches_overlap(p_org uuid,
    a_account text, a_group text, a_cc text, a_ptype text, a_party text,
    b_account text, b_group text, b_cc text, b_ptype text, b_party text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select (a_cc is null or b_cc is null or a_cc = b_cc)
     and (a_party is null or b_party is null
          or (a_party = b_party and (a_ptype is null or b_ptype is null or a_ptype = b_ptype)))
     and ((a_account is not null and a_account = b_account)
          or (a_group is not null and b_group is not null
              and (a_group = b_group
                   or exists (select 1 from public.erp_account_mirror g1 join public.erp_account_mirror g2
                                on g2.org_id = g1.org_id and g2.company = g1.company
                              where g1.org_id = p_org and g1.erp_name = a_group and g1.is_group
                                and g2.erp_name = b_group and g2.is_group
                                and ((g1.lft <= g2.lft and g2.rgt <= g1.rgt) or (g2.lft <= g1.lft and g1.rgt <= g2.rgt)))))
          -- an account under a group overlaps that group (0376 compares like with like; equipment mixes them)
          or (a_account is not null and b_group is not null and exists (
                select 1 from public.erp_account_mirror g join public.erp_account_mirror x
                  on x.org_id = g.org_id and x.company = g.company and x.lft > g.lft and x.rgt < g.rgt
                 where g.org_id = p_org and g.erp_name = b_group and g.is_group and x.erp_name = a_account))
          or (b_account is not null and a_group is not null and exists (
                select 1 from public.erp_account_mirror g join public.erp_account_mirror x
                  on x.org_id = g.org_id and x.company = g.company and x.lft > g.lft and x.rgt < g.rgt
                 where g.org_id = p_org and g.erp_name = a_group and g.is_group and x.erp_name = b_account)))
$$;
```

`equipment_costing_assert_no_conflict(p_org uuid, p_norm jsonb) returns void` raises `23505` when, over an overlapping window
(window overlap exactly as 0376 `:188-190`). **The equipment side is every effective version, not only the current one:** read
`equipment_settings_effective(p_org, p_norm)` (the draft overlaid, so the saved key's own older windows are clamped exactly as
the save will clamp them), because older versions keep applying to their dates (PQ-4) and a tie with one is as real as a tie
with the current version:
(a) an effective version of another `setting_key` on the **same asset** whose window overlaps, any basis (FR-EQU-034, second clause);
(b) for `actual_cost`: a current #1271 rule with `specificity >= p_norm.specificity` and
`cost_attribution_matches_overlap(…)` (FR-EQU-034, first clause; message names the rule);
(c) for `actual_cost`: an effective `actual_cost` version of **another asset** with equal specificity and an overlapping match
(a tie the engine could only break by key; message names the other asset's code). It also raises `22023` "mixed units" when
`rate_unit` is set (hire_rate, or actual_cost with `driver = 'units'`) and a non-archived, non-rejected entry for the asset
has another unit, dated from the window start (for `actual_cost`, from `date_trunc('month', effective_from)`, because PQ-5
shares a version's pool over the whole month's usage) to the window end (FR-EQU-032, AC-EQU-015).

### S2.4 Effective windows and approved usage (internal, the single source for every reader)

```sql
create function public.equipment_settings_effective(p_org_id uuid, p_draft jsonb default null)
returns table(id uuid, setting_key uuid, version int, asset_id uuid, basis text, work_rate numeric, standby_rate numeric,
              rate_unit text, driver text, count_standby boolean, charge_category public.budget_category,
              match_account text, match_account_group text, match_cost_center text, match_party_type text, match_party text,
              specificity int, window_from date, window_to date)
language sql stable set search_path = public, pg_temp as $$
  with d as (
    select coalesce(nullif(p_draft->>'setting_key','')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as setting_key,
           (p_draft->>'effective_from')::date as effective_from
     where p_draft is not null
  ), v as (
    select s.id, s.setting_key, s.version, s.asset_id, s.basis, s.work_rate, s.standby_rate, s.rate_unit, s.driver,
           s.count_standby, s.charge_category, s.match_account, s.match_account_group, s.match_cost_center,
           s.match_party_type, s.match_party, s.specificity, s.effective_from as window_from,
           least(coalesce(s.effective_to, 'infinity'::date), coalesce(s.applies_to, 'infinity'::date),
                 coalesce((select greatest(s.effective_from, d.effective_from) - 1 from d where d.setting_key = s.setting_key),
                          'infinity'::date)) as window_to
      from public.equipment_costing_settings s where s.org_id = p_org_id
    union all
    select null::uuid, d.setting_key, coalesce(nullif(p_draft->>'expected_version','')::int, 0) + 1, (p_draft->>'asset_id')::uuid,
           p_draft->>'basis', (p_draft->>'work_rate')::numeric, (p_draft->>'standby_rate')::numeric, p_draft->>'rate_unit',
           p_draft->>'driver', coalesce((p_draft->>'count_standby')::boolean, false), (p_draft->>'charge_category')::public.budget_category,
           p_draft->>'account', p_draft->>'account_group', p_draft->>'cost_center', p_draft->>'party_type', p_draft->>'party',
           (p_draft->>'specificity')::int, d.effective_from, coalesce((p_draft->>'effective_to')::date, 'infinity'::date)
      from d
  )
  select * from v where v.window_to >= v.window_from
$$;

create function public.equipment_usage_by_project(p_org_id uuid)
returns table(asset_id uuid, project_id uuid, month date, kind text, unit text, quantity numeric, fuel_litres numeric,
              trips numeric, entry_count int, as_of timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select e.asset_id, e.project_id, date_trunc('month', e.work_date)::date, e.kind, e.unit, sum(e.quantity),
         sum(coalesce(e.fuel_litres, 0)), sum(coalesce(e.trips, 0))::numeric, count(*)::int, max(e.approved_at)
    from public.equipment_usage_entries e
   where e.org_id = p_org_id and e.status = 'Approved' and e.archived_at is null      -- FR-EQU-012: approved only
   group by 1, 2, 3, 4, 5
$$;
```

`p_draft` is always a normalised object (from `equipment_costing_normalize`), never raw client JSON.

### S2.5 Hire-rate charges (FR-EQU-040, OQ-6, D5)

```sql
create function public.equipment_hire_charges(p_org_id uuid, p_draft jsonb default null, p_project_id uuid default null)
returns table(setting_id uuid, setting_key uuid, version int, asset_id uuid, project_id uuid, month date,
              category public.budget_category, fiscal_year text, work_units numeric, standby_units numeric,
              work_rate numeric, standby_rate numeric, amount numeric, entry_count int, as_of timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select v.id, v.setting_key, v.version, v.asset_id, e.project_id, date_trunc('month', e.work_date)::date, v.charge_category,
         to_char(e.work_date, 'YYYY'),                                                              -- PQ-2
         coalesce(sum(e.quantity) filter (where e.kind = 'work'), 0),
         coalesce(sum(e.quantity) filter (where e.kind = 'standby'), 0),
         v.work_rate, v.standby_rate,
         round(coalesce(sum(e.quantity) filter (where e.kind = 'work'), 0) * v.work_rate
             + coalesce(sum(e.quantity) filter (where e.kind = 'standby'), 0) * coalesce(v.standby_rate, 0), 2),  -- once per row
         count(*)::int, max(e.approved_at)
    from public.equipment_settings_effective(p_org_id, p_draft) v
    join public.equipment_usage_entries e
      on e.org_id = p_org_id and e.asset_id = v.asset_id and e.status = 'Approved' and e.archived_at is null
     and e.work_date between v.window_from and v.window_to
   where v.basis = 'hire_rate' and (p_project_id is null or e.project_id = p_project_id)
   group by v.id, v.setting_key, v.version, v.asset_id, e.project_id, date_trunc('month', e.work_date), v.charge_category,
            to_char(e.work_date, 'YYYY'), v.work_rate, v.standby_rate
$$;
```

Every version (and the draft, `setting_id is null`) is in scope; a preview filters `setting_id is null`.

### S2.6 Writer and the three client RPCs

`equipment_costing_write(p_setting jsonb, p_action text, p_check_accounts boolean) returns jsonb` mirrors
`cost_attribution_write` (0376 `:341-388`) line for line with these differences: lock key `'equipment_costing:' || org`;
normalise with `equipment_costing_normalize`; after the conflict check and before inserting the new version:

```sql
  -- PQ-4: earlier versions keep applying only up to the day before the new version starts.
  update public.equipment_costing_settings s
     set applies_to = greatest(s.effective_from, (v_norm->>'effective_from')::date) - 1,
         is_current = case when s.id = v_cur.id then false else s.is_current end
   where s.org_id = v_org and s.setting_key = v_key
     and least(coalesce(s.effective_to, 'infinity'::date), coalesce(s.applies_to, 'infinity'::date)) >= (v_norm->>'effective_from')::date;
  update public.equipment_costing_settings set is_current = false where id = v_cur.id;  -- also when its window ends earlier
```

and audit action `equipment_costing.create|update|end` with `{setting_key, version, before, after}`.

```sql
create function public.save_equipment_costing(p_setting jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then          -- FR-EQU-033
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public.equipment_costing_write(p_setting, case when nullif(p_setting->>'setting_key','') is null then 'create' else 'update' end, true);
end $$;
-- end_equipment_costing(p_setting_key uuid, p_effective_to date, p_expected_version int): 0376 :402-420 with
--   equipment_costing_content / equipment_costing_write; accounts not re-checked.
-- list_equipment_costing(p_include_history boolean default false): STABLE SECURITY DEFINER (not invoker as 0376 :422:
--   it reads window_to from equipment_settings_effective, an internal helper with no client EXECUTE, so an invoker body
--   would fail with 42501 for every caller). Body: assert_is_active_member(); 0376 :422-443 role gate
--   (Admin/Finance/Executive/PM → else 42501); `where s.org_id = public.auth_org_id()` (the definer bypasses RLS, so the org
--   filter MUST stay); returns the row columns + asset code/name + window_to.
```

`preview_equipment_costing(p_setting jsonb) returns table(project_id uuid, month date, category public.budget_category,
basis text, amount numeric, driver_total numeric, entry_count int)`: Admin/Finance only; normalise; refuse a `setting_key`
that is not current (`P0002`); run the conflict check; return the draft's rows (`setting_id is null`) from
`equipment_hire_charges(v_org, v_norm, null)` for `hire_rate`, nothing for `none`; S3 adds `actual_cost`.

### S2.7 Reads: allocations and usage totals (FR-EQU-043/044, FR-EQU-062, PQ-11)

```sql
create function public.list_equipment_allocations(p_asset_id uuid, p_from date, p_to date, p_project_id uuid default null)
returns table(asset_id uuid, asset_code text, project_id uuid, project_name text, month date, basis text, setting_key uuid,
              version int, status text, reason text, driver text, work_units numeric, standby_units numeric,
              work_rate numeric, standby_rate numeric, pool numeric, driver_value numeric, driver_total numeric,
              share numeric, amount numeric, category public.budget_category, line_count int, entry_count int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if not public.is_active_member() or coalesce(public.auth_role()::text, '') not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (p_asset_id is null and p_project_id is null) or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'name an asset or a project and a range of at most two years' using errcode = '22023';
  end if;
  return query
    -- hire_rate charges
    select c.asset_id, a.code, c.project_id, p.name, c.month, 'hire_rate'::text, c.setting_key, c.version, 'allocated'::text,
           null::text, 'units'::text, c.work_units, c.standby_units, c.work_rate, c.standby_rate, null::numeric, null::numeric,
           null::numeric, null::numeric, c.amount, c.category, 0, c.entry_count
      from public.equipment_hire_charges(v_org, null, p_project_id) c
      join public.equipment_assets a on a.id = c.asset_id join public.projects p on p.id = c.project_id
     where (p_asset_id is null or c.asset_id = p_asset_id) and c.month between date_trunc('month', p_from)::date and p_to
    union all
    -- basis none / no setting: usage totals, no amount (FR-EQU-043)
    select u.asset_id, a.code, u.project_id, p.name, u.month, coalesce(v.basis, 'none'), v.setting_key, v.version, 'usage_only',
           null, null, sum(u.quantity) filter (where u.kind = 'work'), sum(u.quantity) filter (where u.kind = 'standby'),
           null, null, null, null, null, null, null::numeric, null, 0, sum(u.entry_count)::int
      from public.equipment_usage_by_project(v_org) u
      join public.equipment_assets a on a.id = u.asset_id join public.projects p on p.id = u.project_id
      left join lateral (select x.basis, x.setting_key, x.version from public.equipment_settings_effective(v_org, null) x
                          where x.asset_id = u.asset_id and x.window_from <= (u.month + interval '1 month' - interval '1 day')::date
                            and x.window_to >= u.month order by x.window_from desc limit 1) v on true
     where (p_asset_id is null or u.asset_id = p_asset_id) and (p_project_id is null or u.project_id = p_project_id)
       and u.month between date_trunc('month', p_from)::date and p_to and coalesce(v.basis, 'none') = 'none'
     group by u.asset_id, a.code, u.project_id, p.name, u.month, v.basis, v.setting_key, v.version
     order by 5, 4, 2;
end $$;
```

`list_equipment_usage_totals(p_project_id uuid default null, p_asset_id uuid default null, p_from date default null, p_to date
default null)`: definer; **any active member** (Engineers read totals, FR-EQU-062); same range and one-of rules; returns
`(asset_id, asset_code, asset_name, project_id, project_name, month, unit, work_units, standby_units, fuel_litres, trips,
entry_count, submitted_count)` from approved entries, plus `submitted_count` from Submitted rows so the panel can say what is
waiting. **No amount column** (an Engineer must never read an amount). Both reads aggregate in SQL, so a month × asset ×
project result stays far below the PostgREST 1000-row cap for any two-year range under NFR-EQU-003's sizes (200 assets);
the DAL still applies the `LIMIT + 1` sentinel (bucket 5).

### S2.8 Replace the unit lock (FR-EQU-032)

```sql
create or replace function public.equipment_entry_locked_unit(p_org uuid, p_asset uuid, p_date date) returns text
  language sql stable set search_path = public, pg_temp as $$
  select v.rate_unit from public.equipment_settings_effective(p_org, null) v
   where v.asset_id = p_asset
     and p_date between case when v.basis = 'actual_cost' then date_trunc('month', v.window_from)::date else v.window_from end
                    and v.window_to                       -- actual_cost: the whole first month feeds the driver (PQ-5)
     and (v.basis = 'hire_rate' or (v.basis = 'actual_cost' and v.driver = 'units'))
   order by v.window_from desc limit 1
$$;
```

### S2.9 Failing test then pass: settings audience (AC-EQU-012, settings half)

Append to `supabase/tests/equipment_rls.test.sql`: PM1 `save_equipment_costing(...)` → `42501` ("PM approves hours but cannot
change what an hour is worth"); Executive → `42501`; Engineer `list_equipment_allocations` → `42501`, but
`list_equipment_usage_totals` lives and has no amount column (`select count(*) from information_schema.routines …` is not
needed: assert `has_column`-style via `pg_get_function_result('list_equipment_usage_totals(uuid,uuid,date,date)'::regprocedure)
not like '%amount%'`); Engineer `list_equipment_costing()` → `42501`; Finance and Admin save; direct `insert into equipment_costing_settings` as Admin → `42501`; another
org's `list_equipment_costing()` returns 0 rows; saving a setting for the foreign asset `…d9` → `P0002`.

### S2.10 Gate

Self-assertion block, rollback file, denominator: the `equipment_costing_settings` table and exactly these six definers:
`"end_equipment_costing(uuid,date,integer)"`, `"list_equipment_allocations(uuid,date,date,uuid)"`, `"list_equipment_costing(boolean)"`,
`"list_equipment_usage_totals(uuid,uuid,date,date)"`, `"preview_equipment_costing(jsonb)"`, `"save_equipment_costing(jsonb)"`
(the internals `equipment_costing_write`, `equipment_costing_normalize`, `equipment_costing_content`,
`equipment_costing_assert_no_conflict`, `cost_attribution_matches_overlap`, `equipment_settings_effective`,
`equipment_usage_by_project`, `equipment_hire_charges` are invoker, revoked from `public, anon, authenticated`, and asserted so
in the `do $$` block); 0178 (+2); types; the migration-slice gate with `equipment_usage.test.sql equipment_rls.test.sql equipment_costing.test.sql`.

---

## S3 - `actual_cost` inside the attribution engine (`0449_equipment_actual_cost.sql`) — money, ships alone

Covers AC-EQU-001, 004, 005, 006 (owning row), 009, 014. Header REVERSE, in this order: drop
`cost_attribution_allocations(uuid,jsonb,uuid,uuid,jsonb)` **first** (while it exists, a re-created 4-argument overload makes
every 3- and 4-argument call ambiguous), drop `cost_attribution_engine(uuid,jsonb,uuid,uuid,jsonb)`, re-create
`cost_attribution_allocations(uuid, jsonb, uuid, uuid)` and `cost_attribution_assert_no_conflict(uuid, jsonb)` **verbatim from the
bodies this slice replaced** (0376 `:216-282` / `:176-214` unless a sibling redefined them first) with their 0376 `revoke`
lines, then restore S2's `preview_equipment_costing` and `list_equipment_allocations` bodies. The rollback file carries those
bodies in full.

### S3.1 Failing test: the issue acceptance and the pool rules

Create `supabase/tests/equipment_actual_cost.test.sql` (new) = F1 + F2, then:

```sql
-- LDR-1 September: P1 6 h and P2 2 h approved; P3 5 h Draft and 3 h Rejected (AC-EQU-006)
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c1','2026-09-10',6,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c2','2026-09-11',2,'hours');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c3','2026-09-12',5,'hours','work','Draft');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c3','2026-09-13',3,'hours','work','Rejected');
-- TRK-1 August: one day on each of P1, P2, P3 (AC-EQU-004)
select pg_temp.usage('15190000-0000-0000-0000-0000000000d2','15190000-0000-0000-0000-0000000000c1','2026-08-03',1,'days');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d2','15190000-0000-0000-0000-0000000000c2','2026-08-04',1,'days');
select pg_temp.usage('15190000-0000-0000-0000-0000000000d2','15190000-0000-0000-0000-0000000000c3','2026-08-05',1,'days');
create temp table _pv as select * from (values (null::uuid, null::date, null::numeric)) t(project_id, month, amount) where false;
grant all on _pv to authenticated;
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
-- AC-EQU-014: preview first
insert into _pv select project_id, month, amount from preview_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d1",
  "basis":"actual_cost","driver":"units","rate_unit":"hours","account_group":"Plant - EQ","cost_center":"Loader-1 - EQ",
  "effective_from":"2026-01-01"}') where project_id is not null;   -- the July unallocated row (project null) is compared below
select lives_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d1","basis":"actual_cost",
  "driver":"units","rate_unit":"hours","account_group":"Plant - EQ","cost_center":"Loader-1 - EQ","effective_from":"2026-01-01"}') $$,
  'AC-EQU-001 an actual-cost setting with no rate is saved');
select is(array(select project_id::text || '=' || amount::text from list_equipment_allocations(
    '15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30') where status = 'allocated' order by project_id),
  array['15190000-0000-0000-0000-0000000000c1=600.00','15190000-0000-0000-0000-0000000000c2=200.00'],
  'AC-EQU-001 an 800.00 pool on 6 h / 2 h allocates 600.00 and 200.00 with no rate');
select is((select row(pool, driver, driver_value, driver_total, version, entry_count, line_count)::text
             from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')
            where project_id = '15190000-0000-0000-0000-0000000000c1'), '(800.00,units,6.00,8.00,1,1,1)',
  'AC-EQU-001 the drill-down shows pool, driver, shares, version and counts (FR-EQU-044)');
select is((select sum(amount) from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')
            where project_id = '15190000-0000-0000-0000-0000000000c3'), null::numeric,
  'AC-EQU-006 draft and rejected usage never count');
select set_eq($$ select project_id, month, amount from _pv $$,
  $$ select project_id, month, sum(amount) from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-01-01','2026-12-31')
       where status = 'allocated' group by 1, 2 $$, 'AC-EQU-014 preview rows equal the saved allocations per project per month');
-- (the preview's unallocated July row is asserted by its own AC-EQU-005 row below, from the saved setting)
select is((select row(status, pool, reason)::text from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-07-01','2026-07-31')),
  '(unallocated,500.00,no_approved_usage)', 'AC-EQU-005 a pool with zero approved driver allocates nothing and shows as unallocated');
select lives_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d2","basis":"actual_cost",
  "driver":"units","rate_unit":"days","account":"Fuel - EQ","cost_center":"Truck-1 - EQ","effective_from":"2026-01-01"}') $$,
  'AC-EQU-004 TRK-1 actual-cost setting');
select is(array(select amount::text from list_equipment_allocations('15190000-0000-0000-0000-0000000000d2','2026-08-01','2026-08-31')
                 where status = 'allocated' order by project_id),
  array['33.33','33.33','33.34'], 'AC-EQU-004 a 1/3 split rounds to the cent, the last project takes the remainder');
select is((select sum(amount) from list_equipment_allocations('15190000-0000-0000-0000-0000000000d2','2026-08-01','2026-08-31')
            where status = 'allocated'), 100.00::numeric, 'AC-EQU-004 allocations sum exactly to the pool');
```

Then AC-EQU-009 rows (owning title `AC-EQU-009 a ledger line goes to one winner only`): as Finance save a #1271 rule `{"name":"Depreciation to P3","account":"Depreciation - EQ",
"effective_from":"2026-01-01","targets":[{"project_id":"…c3","percent":100}]}` (specificity 2 < the LDR-1 setting's 11): assert
G1 is placed **once**: as superuser, `select source, project_id from cost_attribution_engine(org, null, null, null, null) where
status = 'allocated' and account = 'Depreciation - EQ' and posting_date between '2026-09-01' and '2026-09-30'` equals exactly
`{(equipment, P1), (equipment, P2), (rule, P3)}` (the two equipment shares of G1 and the rule share of G6; the wrapper has
no `source` column, so read the engine), and `cost_attribution_allocations` holds no G1 row under P3; `sum(amount)` over everything equals the matched untagged ledger lines (G1 + G2-pool excluded
because unallocated + G5 + G6 = 800 + 100 + 200); saving an equipment setting on EXC-1 with `account = 'Depreciation - EQ'`, no
cost centre (specificity 2, equal to the rule) → `23505`; saving a #1271 rule `account_group = 'Plant - EQ'`,
`cost_center = 'Loader-1 - EQ'` (specificity 11, tie with the LDR-1 setting) → `23505` (spec delta 4).
Mutation checks: flip `specificity desc` to `asc` in the engine's `winners` (AC-EQU-009 rows go red); drop
`where coalesce(driver_total, 0) = 0` from the unallocated arm (AC-EQU-005 red); remove the `is_last` remainder (AC-EQU-004 red).

Run: `scripts/with-db-lock.sh supabase test db supabase/tests/equipment_actual_cost.test.sql` → fails.

### S3.2 The engine

`cost_attribution_engine` is the 0376 `cost_attribution_allocations` body **verbatim**, every new line marked `-- 0449`:

```sql
create function public.cost_attribution_engine(p_org_id uuid, p_draft jsonb default null, p_exclude_rule_key uuid default null,
                                               p_project_id uuid default null, p_equipment_draft jsonb default null)
returns table(source text, gl_id uuid, rule_id uuid, rule_key uuid, version int, asset_id uuid, project_id uuid, account text,
              fiscal_year text, posting_date date, party_type text, amount numeric, as_of timestamptz, pool numeric,
              driver text, driver_value numeric, driver_total numeric, line_count int, entry_count int, status text)
language sql stable set search_path = public, pg_temp as $$
  with draft as (                                          -- 0376 verbatim
    select coalesce((p_draft->>'rule_key')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as rule_key
    where p_draft is not null
  ), eq_versions as (                                                                                 -- 0449
    select v.* from public.equipment_settings_effective(p_org_id, p_equipment_draft) v where v.basis = 'actual_cost'  -- 0449
  ), rules as (
    select r.id, r.rule_key, r.specificity, r.match_account, r.match_account_group, r.match_cost_center,
           r.match_party_type, r.match_party, r.effective_from, r.effective_to, 'rule'::text as source          -- 0449 source
      from public.cost_attribution_rules r
     where r.org_id = p_org_id and r.is_current
       and r.rule_key is distinct from p_exclude_rule_key
       and not exists (select 1 from draft d where d.rule_key = r.rule_key)
    union all
    select null::uuid, d.rule_key, (p_draft->>'specificity')::int, p_draft->>'account', p_draft->>'account_group',
           p_draft->>'cost_center', p_draft->>'party_type', p_draft->>'party',
           (p_draft->>'effective_from')::date, (p_draft->>'effective_to')::date, 'rule'                         -- 0449 source
      from draft d
    union all                                                                                         -- 0449
    select v.id, v.setting_key, v.specificity, v.match_account, v.match_account_group, v.match_cost_center, -- 0449
           v.match_party_type, v.match_party, v.window_from, nullif(v.window_to, 'infinity'::date), 'equipment' -- 0449
      from eq_versions v                                                                              -- 0449
  ), targets as (                                          -- 0376 verbatim
    select r.rule_key, t.position::int as position, t.project_id, t.percent
      from rules r join public.cost_attribution_rule_targets t on t.rule_id = r.id
    union all
    select d.rule_key, (e.ord - 1)::int, (e.v->>'project_id')::uuid, (e.v->>'percent')::numeric
      from draft d cross join lateral jsonb_array_elements(p_draft->'targets') with ordinality e(v, ord)
  ), project_rules as (
    select distinct t.rule_key from targets t where p_project_id is null or t.project_id = p_project_id
    union                                                                                             -- 0449
    select v.setting_key from eq_versions v                                                           -- 0449
     where p_project_id is null or exists (select 1 from public.equipment_usage_entries e             -- 0449
             where e.org_id = p_org_id and e.asset_id = v.asset_id and e.project_id = p_project_id   -- 0449
               and e.status = 'Approved' and e.archived_at is null)                                   -- 0449
  ), rule_accounts as (                                    -- 0376 verbatim (r.* now carries source)
    select r.*, r.match_account as acct from rules r where r.match_account is not null
    union all
    select r.*, a.erp_name
      from rules r
      join public.erp_account_mirror g on g.org_id = p_org_id and g.erp_name = r.match_account_group and g.is_group
      join public.erp_account_mirror a on a.org_id = p_org_id and a.company = g.company
                                       and a.lft > g.lft and a.rgt < g.rgt and not a.is_group
     where r.match_account_group is not null
  ), scan_accounts as (
    select distinct ra.acct from rule_accounts ra join project_rules pr on pr.rule_key = ra.rule_key
  ), winners as (                                          -- 0376 verbatim + ra.source
    select distinct on (l.id) l.id as gl_id, ra.id as rule_id, ra.rule_key, ra.source, l.account, l.fiscal_year, l.posting_date,
           l.party_type, l.debit - l.credit as net, l.as_of
      from scan_accounts sa
      join public.erp_gl_entry_mirror l
        on l.org_id = p_org_id and l.account = sa.acct
       and coalesce(l.project, '') = '' and not l.is_cancelled
      join rule_accounts ra
        on ra.acct = l.account
       and l.posting_date >= ra.effective_from
       and (ra.effective_to is null or l.posting_date <= ra.effective_to)
       and (ra.match_cost_center is null or l.cost_center = ra.match_cost_center)
       and (ra.match_party is null or (l.party = ra.match_party
            and (ra.match_party_type is null or l.party_type = ra.match_party_type)))
     order by l.id, ra.specificity desc, ra.rule_key
  ), shares as (                                           -- 0376 verbatim + source filter
    select w.*, t.project_id, t.position, round(w.net * t.percent / 100, 2) as share,
           row_number() over (partition by w.gl_id order by t.position desc) = 1 as is_last
      from winners w join targets t on t.rule_key = w.rule_key
     where w.source = 'rule' and w.rule_key in (select pr.rule_key from project_rules pr)                -- 0449 source
  ), placed as (                                           -- 0376 verbatim
    select s.gl_id, s.rule_id, s.rule_key, s.project_id, s.account, s.fiscal_year, s.posting_date, s.party_type,
           case when s.is_last then s.net - (sum(s.share) over (partition by s.gl_id) - s.share) else s.share end as amount,
           s.as_of
      from shares s
  ), eq_pools as (                                                                                    -- 0449 FR-EQU-041/042
    select w.rule_id, w.rule_key, date_trunc('month', w.posting_date)::date as month, w.account, w.fiscal_year, w.party_type,
           sum(w.net) as pool, count(*)::int as line_count, max(w.as_of) as as_of
      from winners w where w.source = 'equipment'
     group by 1, 2, 3, 4, 5, 6
  ), eq_usage as (                                                                                    -- 0449 OQ-2, OQ-6
    select v.setting_key, v.id as version_id, u.month, u.project_id,
           sum(case v.driver when 'units' then u.quantity when 'fuel' then u.fuel_litres else u.trips end) as driver_value,
           sum(u.entry_count)::int as entry_count
      from eq_versions v join public.equipment_usage_by_project(p_org_id) u on u.asset_id = v.asset_id
     where u.kind = 'work' or v.count_standby
     group by 1, 2, 3, 4
  ), eq_split as (                                                                                    -- 0449
    select p.*, v.version, v.asset_id, v.driver, x.project_id, x.driver_value, x.entry_count,
           sum(x.driver_value) over (partition by p.rule_key, p.rule_id, p.month, p.account, p.fiscal_year, p.party_type) as driver_total
      from eq_pools p
      join eq_versions v on v.setting_key = p.rule_key and v.id is not distinct from p.rule_id
      left join eq_usage x on x.setting_key = p.rule_key and x.version_id is not distinct from p.rule_id
                          and x.month = p.month and x.driver_value > 0
  ), eq_shares as (                                                                                   -- 0449 PQ-6
    select s.*, round(s.pool * s.driver_value / s.driver_total, 2) as share,
           row_number() over (partition by s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type
                              order by s.project_id desc) = 1 as is_last
      from eq_split s where s.driver_total > 0
  ), eq_placed as (                                                                                   -- 0449 FR-CAT-022
    select s.*, case when s.is_last
                     then s.pool - (sum(s.share) over (partition by s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type) - s.share)
                     else s.share end as amount
      from eq_shares s
  )
  select 'rule'::text, p.gl_id, p.rule_id, p.rule_key, null::int, null::uuid, p.project_id, p.account, p.fiscal_year,
         p.posting_date, p.party_type, p.amount, p.as_of, null::numeric, null::text, null::numeric, null::numeric, 1,
         null::int, 'allocated'::text
    from placed p where p_project_id is null or p.project_id = p_project_id
  union all                                                                                           -- 0449
  select 'equipment', null, e.rule_id, e.rule_key, e.version, e.asset_id, e.project_id, e.account, e.fiscal_year, e.month,
         e.party_type, e.amount, e.as_of, e.pool, e.driver, e.driver_value, e.driver_total, e.line_count, e.entry_count, 'allocated'
    from eq_placed e where p_project_id is null or e.project_id = p_project_id
  union all                                                                                           -- 0449 never dropped
  select distinct on (s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type)
         'equipment', null, s.rule_id, s.rule_key, s.version, s.asset_id, null::uuid, s.account, s.fiscal_year, s.month,
         s.party_type, s.pool, s.as_of, s.pool, s.driver, null::numeric, 0::numeric, s.line_count, 0, 'unallocated'
    from eq_split s where coalesce(s.driver_total, 0) = 0 and p_project_id is null
$$;
revoke all on function public.cost_attribution_engine(uuid, jsonb, uuid, uuid, jsonb) from public, anon, authenticated;
```

The `unallocated` arm's `amount` carries the pool so `list_equipment_allocations` can show it, but `cost_attribution_allocations`
filters `status = 'allocated'`, so unallocated pools reach **no** project figure and no line is counted twice.

### S3.3 The wrapper (callers unchanged)

```sql
drop function public.cost_attribution_allocations(uuid, jsonb, uuid, uuid);
create function public.cost_attribution_allocations(p_org_id uuid, p_draft jsonb default null, p_exclude_rule_key uuid default null,
                                                    p_project_id uuid default null, p_equipment_draft jsonb default null)
returns table(gl_id uuid, rule_id uuid, rule_key uuid, project_id uuid, account text, fiscal_year text,
              posting_date date, party_type text, amount numeric, as_of timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select e.gl_id, e.rule_id, e.rule_key, e.project_id, e.account, e.fiscal_year, e.posting_date, e.party_type, e.amount, e.as_of
    from public.cost_attribution_engine(p_org_id, p_draft, p_exclude_rule_key, p_project_id, p_equipment_draft) e
   where e.status = 'allocated'
$$;
revoke all on function public.cost_attribution_allocations(uuid, jsonb, uuid, uuid, jsonb) from public, anon, authenticated;
```

The four callers (0376 `:301`, `:333`, `:523`; 0403 `:7`) pass three or four positional arguments and resolve to the new
signature by its trailing default; SQL-language bodies are resolved at call time, so none is re-created. `preview_cost_attribution`
still isolates its draft by `rule_id is null` (`0376:336`): equipment rows carry their version id, and no equipment draft is
passed there. Run `supabase/tests/cost_attribution.test.sql` unchanged: all 97 rows stay green (the regression proof).

### S3.4 Symmetric tie refusal (spec delta 4)

Re-create `cost_attribution_assert_no_conflict` = 0376 `:176-214` verbatim, then before the final `raise`, a second lookup
(marked `-- 0449`): the first `actual_cost` version from `equipment_settings_effective(p_org_id, null)` (every effective
version, not only the current one: older versions keep applying to their dates) whose window overlaps, whose `specificity`
equals `(p_norm->>'specificity')::int`, and for which `cost_attribution_matches_overlap(p_org_id, p_norm->>'account',
p_norm->>'account_group', p_norm->>'cost_center', p_norm->>'party_type', p_norm->>'party', v.match_account, …)` holds; raise
`23505` "conflicts with the equipment costing of asset %: same specificity, overlapping dates and matches".

### S3.5 Previews and reads gain `actual_cost`

`preview_equipment_costing`: for `basis = 'actual_cost'` return
`select project_id, posting_date, m.category, 'actual_cost', sum(amount), max(driver_total), sum(entry_count)::int from
cost_attribution_engine(v_org, null, null, null, v_norm) e left join budget_category_account_map m on m.org_id = v_org and
m.erp_account = e.account where e.source = 'equipment' and e.rule_id is null group by …`, **plus** the draft's unallocated rows
(`project_id null`, `amount` = pool) so the preview warns before saving.

**Employee-party narrowing (both reads, parity).** A pool's grain includes `party_type`, and an `actual_cost` match can reach
payroll lines (an operator's pay on the asset's cost centre). Both `preview_equipment_costing` and the new
`list_equipment_allocations` arm carry the condition every #1271 read carries (0376 `:300`, 0403 `:11`):
`and (e.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))`.
Today every caller of these two reads already ranks at or above Project Manager, so the condition removes nothing; it keeps
the rule in step if a lower role ever joins the audience. No extra test row (it cannot go red with today's roles).

`list_equipment_allocations` gains a third arm from
`cost_attribution_engine(v_org, null, null, p_project_id, null)` where `source = 'equipment'`, mapping `status`,
`reason = case when status = 'unallocated' then 'no_approved_usage' end`, `share = amount / pool` for allocated rows (exposed
to 6 decimals), and `category` via the account map; the `usage_only` arm's basis filter becomes `basis = 'none'` only.

### S3.6 Performance check (NFR-EQU-003)

Add `supabase/tests/equipment_actual_cost_perf.test.sql` (new): F1 + F2, then as superuser generate 50,000 untagged ledger lines
over 12 months across 200 asset cost centres and 200 assets with one `actual_cost` setting each and 20 approved entries per
asset-month (`generate_series`), then `select ok((select extract(epoch from (clock_timestamp() - t0)) from (select
clock_timestamp() t0, (select count(*) from list_equipment_allocations(null, '2026-09-01', '2026-09-30',
'15190000-0000-0000-0000-0000000000c1'))) x) < 2, 'NFR-EQU-003 one project-month allocation read is under 2 s')`. If it fails,
the fix is an index, not a cache: add `(org_id, asset_id, work_date) where status = 'Approved' and archived_at is null` and
push `p_asset` into `equipment_usage_by_project`; never precompute stored allocations (read-side only).

### S3.7 Gate

Self-assertion block, rollback file with the restored 0376 bodies, denominator (no new client RPC), the migration-slice gate with
`equipment_costing.test.sql equipment_actual_cost.test.sql equipment_actual_cost_perf.test.sql cost_attribution.test.sql bfy_attribution_known.test.sql bfy_attribution_partial.test.sql`
(the last two exercise `budget_attributed_year_sums` through the wrapper).

**As built (S3, migration `0471_equipment_actual_cost.sql`; the coordinator allocated 0471 in place of 0449).** Deviations from
the text above, each kept to the spec's behaviour:
- The engine's `winners` is the 0376 join split on the cost centre (`candidates` = an equi-join on `(account, cost_center)` plus
  a wildcard-cost-centre half) over a once-read, materialized `ledger`, and `eq_usage`/`eq_all` are materialized. Nested as in
  the 0376 text, 200 settings on one account made the read 3 s (NFR-EQU-003); as built it is about 0.6 s. Winner order, ties
  and results are unchanged (`cost_attribution.test.sql` runs unchanged, green).
- `eq_usage` never adds hours to days (`u.unit = v.rate_unit` for the `units` driver): FR-EQU-032 refuses the mix, this holds
  if one slipped in.
- The `usage_only` arm of `list_equipment_allocations` already excludes `actual_cost` (S2 wrote `none` or a unit-mismatched
  `hire_rate`), so S3 leaves it unchanged. An unallocated pool's `amount` is null in the list (the pool is in `pool`).
- Carry-forward from S1 (decided here): an Admin could hard-delete an Approved entry while archive refuses it. A
  `before delete` guard (`equipment_usage_guard_delete`, definer trigger, no client grant) now refuses to delete an Approved,
  non-archived entry whose work date lies inside an effective `hire_rate` or `actual_cost` version (actual_cost: its whole
  months, PQ-5); the Admin path is reopen, then archive or delete. Drafts, archived rows and usage on assets with no costing
  stay deletable, and an org cascade stands the guard down.
- Tests: `equipment_actual_cost.test.sql` (31 rows incl. an actual_cost v1/v2 split, the delete guard and a cross-org ledger
  line) and `equipment_actual_cost_perf.test.sql` (3 rows). No new client RPC, table or mirror: the 0178 count, the isolation
  denominator and the 0136/0137 inventories are unchanged.

---

## S4 - Project actuals, finances, API tiers (`<S4-NNNN>_equipment_project_actuals.sql`) — money, ships alone

Covers AC-EQU-010, 011, 013, 016. Header REVERSE: restore `project_mapped_actuals` and `project_mapped_actuals_all` (drop then
create, the old 8 / 9 columns), `get_project_finances` and `api_client_request_guard`, each verbatim from the body this slice
replaced (0376 `:458-511` / `:536-593`, 0410 `:283-636`, 0397 `:86-228` unless a sibling redefined it first); drop `equipment_charge_org_actuals(text)`,
`equipment_charge_project_actuals(uuid,text)`.

### S4.1 Failing test: attributed path and the separate charge (AC-EQU-010)

Create `supabase/tests/equipment_project_actuals.test.sql` (new) = F1 + F2 + the LDR-1 September usage of S3.1 + the EXC-1
hire-rate usage of S2.1; as Finance save the LDR-1 `actual_cost` setting and the EXC-1 `hire_rate` setting (50/20, Equipment);
then as PM1:

```sql
create or replace function pg_temp.col(p_project text, p_col text) returns numeric language plpgsql as $$
declare v numeric; begin
  execute format('select %I from public.project_mapped_actuals(%L::uuid, null) where category = ''Equipment''', p_col, p_project) into v;
  return v; end $$;
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','attributed_to_date'), 600.00::numeric,
  'AC-EQU-010 the actual-cost share reaches attributed_to_date in the mapped category');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','tagged_to_date'), 300.00::numeric,
  'AC-EQU-010 tagged_to_date is unchanged (the ERP-tagged line)');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','equipment_charge_to_date'), 580.00::numeric,
  'AC-EQU-010 the hire-rate charge is reported in its own field (FR-EQU-051)');
select is(pg_temp.col('15190000-0000-0000-0000-0000000000c1','actuals_to_date'), 1480.00::numeric,
  'AC-EQU-010 OQ-3: actuals_to_date = tagged + attributed + internal charge');
select is((select (get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals'->>'equipment_charge_total')::numeric),
  580.00::numeric, 'AC-EQU-010 project finances state the internal charge separately');
select ok((select coalesce(sum(tagged_to_date), 0) + coalesce(sum(attributed_to_date), 0) from project_mapped_actuals_all(null)
            where category = 'Equipment')
          <= (select sum(debit - credit) from erp_gl_entry_mirror where org_id = '15190000-0000-0000-0000-00000000000a' and not is_cancelled
                and account in ('Depreciation - EQ','Fuel - EQ')),
  'AC-EQU-010 org-wide tagged + attributed never exceeds the ledger (the charge is outside both)');
```

Run → fails (no `equipment_charge_to_date` column).

### S4.2 Failing test: byte-identical without settings (AC-EQU-011)

In the same file, **before** any setting is saved (move the saves after this block): define `pg_temp.pma_0376(p_project uuid,
p_fy text)` as the 0376 `:459-509` body verbatim (its `select … from unnest(…)` with the 8 columns) and assert, for each of P1,
P2, P3, `null` and `'2026'`:

```sql
select set_eq(
  $$ select category, mapped, has_rows, actuals_to_date, actuals_as_of, source_sum, tagged_to_date, attributed_to_date
       from public.project_mapped_actuals('15190000-0000-0000-0000-0000000000c1', null) $$,
  $$ select * from pg_temp.pma_0376('15190000-0000-0000-0000-0000000000c1', null) $$,
  'AC-EQU-011 with usage logged but no equipment setting, project_mapped_actuals is identical to 0376');
select is((select count(*)::int from public.project_mapped_actuals('15190000-0000-0000-0000-0000000000c1', null)
            where equipment_charge_to_date is distinct from 0 and equipment_charge_to_date is not null), 0,
  'AC-EQU-011 the new column is 0 (or null where actuals are unknown) with no settings');
select is((get_project_finances('15190000-0000-0000-0000-0000000000c1')->'actuals') - 'equipment_charge_total'
            - 'categories', pg_temp.finances_0410_actuals('15190000-0000-0000-0000-0000000000c1') - 'categories',
  'AC-EQU-011 get_project_finances actuals keys are unchanged (the new key is additive)');
select set_eq($$ select project_id, category, actuals_to_date, tagged_to_date, attributed_to_date from project_mapped_actuals_all(null) $$,
  $$ select p.id, x.category, x.actuals_to_date, x.tagged_to_date, x.attributed_to_date from projects p
       cross join lateral pg_temp.pma_0376(p.id, null) x $$,
  'AC-EQU-011 the dashboards'' one-pass read is identical to 0376');
select is(get_executive_dashboard()::jsonb, (select v from _dash where k = 'exec'),
  'AC-EQU-011 the executive dashboard is byte-identical');
select is(get_pm_dashboard_projects()::jsonb, (select v from _dash where k = 'pm'),
  'AC-EQU-011 the PM dashboard is byte-identical');
```

`_dash` is captured in the same transaction **before the migration's functions are exercised with any equipment row**: the file
inserts the usage rows only after capturing `get_executive_dashboard()` / `get_pm_dashboard_projects()`, so the comparison is
"no usage" vs "usage with no setting". `pg_temp.finances_0410_actuals(p)` rebuilds the `actuals` object from `pg_temp.pma_0376`
exactly as 0410 `:614-630` does (the 0410 expressions copied verbatim).

File order, top to bottom: F1 + F2 → one extra snapshot row on P2 (`Fuel - EQ`, `net` null, same `snapshot_id`; the
null-`source_sum` case) → capture `_dash` (as Executive, then as PM1) → insert the usage rows → this AC-EQU-011 block →
the costing saves → the S4.1 AC-EQU-010 block → S4.7 → S4.8. Mutation check: change the charge term's
`coalesce(…, 0)` to `coalesce(…, 0.01)` → the AC-EQU-011 rows go red; rewrite `source_sum` as the coalesced sum → the P2
null-net row goes red.

### S4.3 Charge helpers (definer; amounts audience only, FR-EQU-062)

`project_mapped_actuals` is granted to every active member (invoker over `erp_actuals_snapshot`, readable by all members).
A hire charge is a rate × units figure the spec keeps from Engineers ("no amounts"), so the charge helpers return rows only
for Admin, Finance, Executive and Project Manager; for an Engineer they return nothing and the charge term is absent (their
`equipment_charge_to_date` is 0 and their `actuals_to_date` excludes it). Every amounts reader (get_project_finances, both
dashboards, the project panel) is already that audience, so no screen changes.

```sql
create function public.equipment_charge_project_actuals(p_project_id uuid, p_fiscal_year text default null)
returns table(category public.budget_category, n bigint, amount numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.category, count(*), sum(c.amount), max(c.as_of)
    from public.equipment_hire_charges(public.auth_org_id(), null, p_project_id) c
   where public.is_active_member()
     and coalesce(public.auth_role()::text in ('Admin','Finance','Executive','Project Manager'), false)  -- FR-EQU-062
     and (p_fiscal_year is null or c.fiscal_year = p_fiscal_year)
     and exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id())
   group by c.category
$$;
-- equipment_charge_org_actuals(p_fiscal_year text default null): the same (incl. the role condition) grouped additionally
--   by project_id, no project filter.
alter function public.equipment_charge_project_actuals(uuid, text) owner to postgres;
revoke all on function public.equipment_charge_project_actuals(uuid, text) from public, anon, authenticated;
grant execute on function public.equipment_charge_project_actuals(uuid, text) to authenticated;
```

### S4.4 `project_mapped_actuals` and `project_mapped_actuals_all`

`drop function public.project_mapped_actuals(uuid, text);` then re-create = 0376 `:459-509` verbatim with a ninth column
`equipment_charge_to_date numeric` **appended last** (existing eight unchanged in name and order, so `select *` consumers at
0410 `:339` and 0396 `:108,294` keep working) and these marked changes:

```sql
  ), charged as (                                                                   -- <S4-NNNN> OQ-3 / FR-EQU-051
    select x.* from public.equipment_charge_project_actuals(p_project_id, p_fiscal_year) x
    where exists (select 1 from public.projects p where p.id = p_project_id)
  ), reading_as_of as (
    select greatest((select max(as_of) from reading), (select max(as_of) from attributed),
                    (select max(as_of) from charged)) as v                           -- <S4-NNNN>
  )
  select c.category, mc.category is not null, coalesce(a.n,0) + coalesce(t.n,0) + coalesce(q.n,0) > 0,     -- <S4-NNNN> q
    case when mc.category is null or (select v from reading_as_of) is null then null
         when coalesce(a.n,0) + coalesce(t.n,0) + coalesce(q.n,0) = 0 then 0::numeric                       -- <S4-NNNN> q
         when (a.n > 0 and a.amount is null) or (t.n > 0 and t.amount is null) then null
         else coalesce(a.amount,0) + coalesce(t.amount,0) + coalesce(q.amount,0) end,                       -- <S4-NNNN> q
    (select v from reading_as_of),
    case when coalesce(a.n,0) + coalesce(t.n,0) = 0                                 -- <S4-NNNN> budget-vs-actual
         then case when q.n > 0 then q.amount end                                    -- <S4-NNNN> charge-only (null when none)
         else (case when a.n > 0 and t.n > 0 then a.source_sum + t.source_sum      -- 0376 verbatim
                    when a.n > 0 then a.source_sum
                    when t.n > 0 then t.source_sum end)
              + coalesce(case when q.n > 0 then q.amount end, 0) end,               -- <S4-NNNN>
    … tagged_to_date and attributed_to_date expressions verbatim …,
    case when mc.category is null or (select v from reading_as_of) is null then null
         when q.n > 0 then q.amount else 0::numeric end                                                    -- <S4-NNNN> equipment_charge_to_date
  from unnest(enum_range(null::public.budget_category)) c(category)
  left join mapped_categories mc on mc.category = c.category
  left join actuals a on a.category = c.category
  left join attributed t on t.category = c.category
  left join charged q on q.category = c.category                                   -- <S4-NNNN>
```

Byte-identity: with no charge row `q.n` is null, so every expression reduces to its 0376 form. **`source_sum` keeps the 0376
case verbatim** inside the new outer branch. Do not rewrite it as `coalesce(…,0) + coalesce(…,0)`: when a category's
`source_sum` is null (rows exist but every net is null), 0376 returns null and a coalesced form returns 0, so an org with no
equipment settings would change. S4.2 carries a null-net snapshot row to prove it. `project_mapped_actuals_all` gets the same changes over
`equipment_charge_org_actuals` (materialised CTE, joined on `project_id` and `category`).

### S4.5 `get_project_finances`

`create or replace` = 0410 `:283-636` verbatim plus, inside `'actuals', jsonb_build_object(` after `'attributed_total'` (`:624-626`):

```sql
      -- <S4-NNNN> (#1519, FR-EQU-051): the hire-rate internal charge inside `total`, stated on its own.
      'equipment_charge_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and equipment_charge_to_date is null) > 0 then null
                          else sum(equipment_charge_to_date) filter(where mapped) end::text from gl),
```

and `'equipment_charge_amount',equipment_charge_to_date::text` appended to each `categories[]` object (`:627-630`).

### S4.6 API-client tiers (AC-EQU-013)

`create or replace function public.api_client_request_guard()` = 0397 `:86-228` verbatim plus three arrays and three branches
marked `-- <S4-NNNN>`, placed after the cost-attribution branches (`:174-…`), same shape:

```sql
  -- EQUIPMENT TIER (`pmo equipment`, #1519): costing preview/save/end/list for active Admin/Finance; allocations for the
  -- project-actuals audience; usage totals for any active member. Same role sets as the RPCs' own checks.  -- <S4-NNNN>
  equipment_write_rpcs constant text[] := array['preview_equipment_costing', 'save_equipment_costing', 'end_equipment_costing'];  -- <S4-NNNN>
  equipment_read_rpcs constant text[] := array['list_equipment_costing', 'list_equipment_allocations'];  -- <S4-NNNN>
  equipment_usage_rpcs constant text[] := array['list_equipment_usage_totals'];  -- <S4-NNNN>
…
    if method = 'POST' and target = any (equipment_write_rpcs) then  -- <S4-NNNN>
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then return; end if;  -- <S4-NNNN>
    end if;  -- <S4-NNNN>
    if method = 'POST' and target = any (equipment_read_rpcs) then  -- <S4-NNNN>
      if coalesce(public.auth_role()::text in ('Admin', 'Finance', 'Executive', 'Project Manager') and public.is_active_member(), false) then return; end if;  -- <S4-NNNN>
    end if;  -- <S4-NNNN>
    if method = 'POST' and target = any (equipment_usage_rpcs) then  -- <S4-NNNN>
      if coalesce(public.is_active_member(), false) then return; end if;  -- <S4-NNNN>
    end if;  -- <S4-NNNN>
```

Failing test first: `supabase/tests/equipment_api_client.test.sql` (new) = F1, copying the request-setting helper of
`cost_attribution.test.sql:333-347` (claims with `client_id`, `request.method = 'POST'`, `request.path = '/rpc/<name>'`):
`AC-EQU-013 a Finance API client may save`, `… an Admin API client may preview`, `… a Finance API client may list allocations`,
`… an Engineer API client may not save` (`42501`), `… an Engineer API client may not preview` (`42501`),
`… an Engineer API client may list usage totals`.

### S4.7 Same-org visibility of the new columns

Append to `equipment_project_actuals.test.sql` (titles `AC-EQU-012 …`): as Engineer Eng1, `project_mapped_actuals(P1)` has
`equipment_charge_to_date = 0` in `Equipment` and `equipment_charge_project_actuals(P1)` returns 0 rows (FR-EQU-062: no amounts),
while the PM sees 580.00; as the other-org Admin, `project_mapped_actuals(P1)` is all-zero/null rows and
`equipment_charge_project_actuals(P1)` returns 0 rows. Mutation check: delete the role condition → the Engineer row goes red.

### S4.8 No ERP write (AC-EQU-016)

Append to `equipment_project_actuals.test.sql` (superuser captures, then RPCs as Finance/PM/Eng, then superuser compares):

```sql
insert into _c values ('gl', (select count(*) from erp_gl_entry_mirror)), ('snap', (select count(*) from erp_actuals_snapshot)),
  ('outbox', (select count(*) from external_command_outbox)),
  ('gl_sum', (select coalesce(sum(debit - credit), 0) from erp_gl_entry_mirror)),
  ('snap_sum', (select coalesce(sum(net), 0) from erp_actuals_snapshot));
-- … save / preview / end costing, transition and bulk-approve usage, read every allocation and actuals RPC …
select is((select count(*) from erp_gl_entry_mirror)::numeric, (select v from _c where k = 'gl'),
  'AC-EQU-016 no ledger mirror row is written');
select is((select count(*) from erp_actuals_snapshot)::numeric, (select v from _c where k = 'snap'),
  'AC-EQU-016 no actuals snapshot row is written');
select is((select count(*) from external_command_outbox)::numeric, (select v from _c where k = 'outbox'),
  'AC-EQU-016 no ERP command is enqueued (OQ-1: nothing is posted)');
select is((select coalesce(sum(debit - credit), 0) from erp_gl_entry_mirror), (select v from _c where k = 'gl_sum'),
  'AC-EQU-016 the mirrored ledger total is unchanged');
```

### S4.9 Gate

Self-assertion block, rollback file (full restored bodies), denominator: exactly `"equipment_charge_org_actuals(text)"` and
`"equipment_charge_project_actuals(uuid,text)"`, types, then the gate with
`equipment_project_actuals.test.sql equipment_api_client.test.sql equipment_actual_cost.test.sql cost_attribution.test.sql`
and every existing pgTAP file that reads `get_project_finances` or the dashboards (find them with
`grep -l "get_project_finances\|get_executive_dashboard\|get_pm_dashboard_projects\|project_mapped_actuals" supabase/tests/*.sql`
and run that list in the same lock hold). Add `equipment_charge_to_date`/`equipment_charge_total` to
`pmo-portal/src/lib/projectFinances.ts` types in S5, not here.

---

## S5 - Data layer (no migration) — batchable

Covers the FE half of AC-EQU-017 (the page tests in S6 own it). Each task: failing vitest first, then code.

### S5.1 DAL `pmo-portal/src/lib/db/equipment.ts` (new)

Shape and rules as `src/lib/db/imprest.ts` (`LIST_LIMIT = 200`, `Bounded<T>`, `fail()`), never sends `org_id`, status or stamps:

```ts
export type EquipmentAssetRow = Tables<'equipment_assets'>;
export type EquipmentUsageRow = Tables<'equipment_usage_entries'>;
export type EquipmentCostingRow = Database['public']['Functions']['list_equipment_costing']['Returns'][number];
export type EquipmentAllocationRow = Database['public']['Functions']['list_equipment_allocations']['Returns'][number];
export type EquipmentUsageTotalRow = Database['public']['Functions']['list_equipment_usage_totals']['Returns'][number];
export type UsageStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected';
export interface UsageInput { id?: string; asset_id: string; project_id: string; work_date: string; quantity: number;
  unit: 'hours' | 'days'; kind: 'work' | 'standby'; fuel_litres?: number | null; trips?: number | null; note?: string | null }
export interface UsageSaveResult { id: string; status: UsageStatus; day_total_hours: number; over_24h: boolean }
export interface CostingDraft { setting_key?: string | null; expected_version?: number | null; asset_id: string;
  basis: 'none' | 'hire_rate' | 'actual_cost'; work_rate?: number | null; standby_rate?: number | null;
  rate_unit?: 'hours' | 'days' | null; driver?: 'units' | 'fuel' | 'trips' | null; count_standby?: boolean;
  charge_category?: string | null; account?: string; account_group?: string; cost_center?: string | null;
  party_type?: string | null; party?: string | null; effective_from: string; effective_to?: string | null }

export async function listAssets(): Promise<Bounded<EquipmentAssetRow>>            // .from('equipment_assets').is('archived_at', null).order('code').limit(LIST_LIMIT + 1)
export async function createAsset(input: { code: string; name: string; default_unit: 'hours' | 'days' }): Promise<EquipmentAssetRow>
export async function updateAsset(id: string, patch: Partial<Pick<EquipmentAssetRow, 'code' | 'name' | 'default_unit' | 'archived_at'>>): Promise<void>  // assertWriteLanded
export async function listUsage(range: { from: string; to: string; assetId?: string; projectId?: string; status?: UsageStatus }): Promise<Bounded<EquipmentUsageRow>>
export async function saveUsage(input: UsageInput): Promise<UsageSaveResult>         // rpc('save_equipment_usage', { p_entry: input })
export async function transitionUsage(id: string, to: UsageStatus, notes?: string): Promise<void>
export async function approveWeek(assetId: string, weekStart: string): Promise<{ approved: number; skipped_own: number; skipped_not_permitted: number }>
export async function archiveUsage(id: string): Promise<void>
export async function listUsageTotals(q: { projectId?: string; assetId?: string; from: string; to: string }): Promise<Bounded<EquipmentUsageTotalRow>>
export async function listCosting(includeHistory?: boolean): Promise<EquipmentCostingRow[]>
export async function saveCosting(draft: CostingDraft): Promise<{ setting_key: string; version: number; changed: boolean }>
export async function endCosting(settingKey: string, effectiveTo: string, expectedVersion: number): Promise<void>
export async function previewCosting(draft: CostingDraft): Promise<Array<{ project_id: string | null; month: string; category: string | null; basis: string; amount: number | null; driver_total: number | null; entry_count: number }>>
export async function listAllocations(q: { assetId?: string; projectId?: string; from: string; to: string }): Promise<Bounded<EquipmentAllocationRow>>
```

Test `pmo-portal/src/lib/db/equipment.test.ts` (new), mocking `@/src/lib/supabase/client` as `imprest.test.ts` does:
`saveUsage sends no org_id, status or author`, `listUsage marks truncated at LIST_LIMIT + 1`, `a 23505 keeps its code`,
`listAllocations passes p_project_id only when given`, `previewCosting sends the draft unchanged (the DB normalises)`.
Verify: `cd pmo-portal && npx vitest run src/lib/db/equipment.test.ts`.

### S5.2 Contract + repository

`pmo-portal/src/lib/repositories/contracts/equipment.ts` (new) declares `EquipmentRepository` with one method per DAL function;
`pmo-portal/src/lib/repositories/equipment.ts` (new) = `wrap(() => dal.x(...))` for each (the `imprest.ts` shape);
register `equipment: equipmentRepository` in `src/lib/repositories/index.ts` (beside `imprest`, `:59`, `:107`). Test: extend
`src/lib/repositories/index.test.ts` with `it('exposes the equipment repository', …)`.

### S5.3 Hooks `pmo-portal/src/hooks/useEquipment.ts` (new)

`EQUIPMENT_QUERY_ROOTS = ['equipment-assets','equipment-usage','equipment-usage-totals','equipment-costing','equipment-allocations']`;
every key `[root, orgId, …args]`; `useEquipmentAssets`, `useEquipmentUsage(range)`, `useEquipmentUsageTotals(q)`,
`useEquipmentCosting(includeHistory)`, `useEquipmentAllocations(q)`; mutations `useSaveUsage`, `useTransitionUsage`,
`useApproveWeek`, `useArchiveUsage`, `useSaveCosting`, `useEndCosting`, `usePreviewCosting` (mutation, no cache), each
invalidating every root **and** `['project-finances']` (the literal first key segment of `useProjectFinances`,
`src/hooks/useProjectFinances.ts:11`; it exports no root constant, so invalidate by that prefix). Test `src/hooks/useEquipment.test.tsx` (new): keys carry the org
id; `useTransitionUsage` invalidates usage, totals, allocations and project finances.

### S5.4 Policy (UX only; mirrors the RPC gates)

In `pmo-portal/src/auth/policy.ts` add entities `'equipmentAsset' | 'equipmentUsage' | 'equipmentCosting'` and:

```ts
/** #1519: who may approve equipment usage — mirrors equipment_can_approve (PM only on projects they manage). */
const EQUIPMENT_APPROVE: Role[] = ['Admin', 'Executive', 'Finance', 'Project Manager'];
/** #1519: who may set what an hour is worth — mirrors save/end/preview_equipment_costing (Admin, Finance). */
const EQUIPMENT_COSTING_WRITE: Role[] = ['Admin', 'Finance'];
…
  // #1519: UX ONLY — transition_equipment_usage / save_equipment_costing are the authority (ADR-0016).
  equipmentAsset: { view: allow(ALL), create: allow(['Admin', 'Project Manager']), edit: allow(['Admin', 'Project Manager']), delete: allow(ADMIN) },
  equipmentUsage: {
    create: allow(ALL),
    transition: (role, ctx) => has(EQUIPMENT_APPROVE, role) && ctx.record?.author_id !== ctx.currentUserId
      && (role !== 'Project Manager' || ctx.record?.project_manager_id === ctx.currentUserId),
    view: allow(EQUIPMENT_APPROVE),        // amounts and others' entries
  },
  equipmentCosting: { manage: allow(EQUIPMENT_COSTING_WRITE), view: allow(EQUIPMENT_APPROVE) },
```

(add `project_manager_id?: string | null` to `PolicyContext.record`). Test in `src/auth/policy.test.ts`:
`equipmentUsage.transition is false for the author even as Admin`, `… false for a PM on a project they do not manage`,
`equipmentCosting.manage is false for PM and Executive`.

### S5.5 Finance types

`pmo-portal/src/lib/projectFinances.ts` `actuals`: add `equipment_charge_total?: ExactMoney | null;` and per category
`equipment_charge_amount?: ExactMoney | null;` (optional: absent on a payload from before S4). Test: extend
`src/lib/projectFinances.test.ts` with `it('reads equipment_charge_total when present and tolerates its absence', …)`.

### S5.6 Gate

`npm run check:guards && npm run typecheck`, the five touched test files, `npx eslint --max-warnings=0 <touched>`.

---

## S6 - Screens, project panel, e2e (no migration) — batchable, UI lane

Owns AC-EQU-017 and AC-EQU-019. Strictly `DESIGN.md` tokens; shared primitives (`EntityFormModal`, `useEntityForm`,
`TextField`, `SelectField`, `Combobox`, `FormGrid`, `FieldError`, `ConfirmDialog`, `classifyMutationError`). i18n namespace
`equipment` (add to `NAMESPACES`, `src/lib/i18n/index.ts:15`; files `public/locales/en/equipment.json` and
`public/locales/id/equipment.json`, both complete, NFR-EQU-005); numbers via the shared formatters (`formatExactMoney`).

### S6.1 Failing test: the usage grid (AC-EQU-017)

`pmo-portal/pages/equipment/EquipmentUsage.test.tsx` (new), mocking `@/src/hooks/useEquipment`, rendering inside
`ImpersonationProvider` + `MemoryRouter` (the `pages/MasterData.a11y.test.tsx:1-26` pattern):

- `AC-EQU-017 a user logs 6 h on a project for an asset and day, submits, and the row shows Submitted` (types into the labelled
  cell input "Loader 1 · EQU P1 · Thu 10 Sep, hours", presses Enter, clicks "Submit week"; asserts `saveUsage` then
  `transitionUsage(id, 'Submitted')` were called and the row's status text reads "Submitted", not colour only).
- `AC-EQU-017 an approver approves the asset-week and the totals and project panel queries refresh` (as PM; clicks "Approve
  week"; asserts `approveWeek('…d1', '2026-09-07')` and the toast "1 approved · 1 skipped (your own)").
- `AC-EQU-017 the author sees no Approve on their own entry` and `… a 26 h day shows the over-24 h warning but saves`.
- `AC-EQU-017 the grid is keyboard operable` (`userEvent.tab()` reaches every cell input in row order; arrow keys are not
  required; every input has an accessible name).
- `AC-EQU-017 the usage page has no axe violations` (`expect((await axe(container)).violations).toEqual([])`).
Verify: `cd pmo-portal && npx vitest run pages/equipment/EquipmentUsage.test.tsx` → fails.

### S6.2 `pages/equipment/EquipmentUsage.tsx` (new)

Week picker (Monday start), asset filter (`Combobox`), a table: rows = (asset, project) pairs with entries this week plus an
"Add row" (asset + project `Combobox`, kind toggle), columns = 7 days, each cell a labelled numeric `TextField` (unit from the
asset's `default_unit`); optional fuel/trips in a row-expand. Saves on blur/Enter through `useSaveUsage`; shows the OQ-7 warning
inline with an icon and text. Footer: "Submit week" (own Draft rows), and for `can('transition','equipmentUsage', …)` an
"Approvals" tab listing Submitted rows with per-entry Approve/Reject (`ConfirmDialog` with a reason for Reject) and "Approve
week" (`useApproveWeek`). Errors through `classifyMutationError` + `useRuleErrorCopy`-style mapping for `22023`/`23505`/`42501`.

### S6.3 Asset detail: costing setting and allocation table (FR-EQU-071)

`pages/equipment/EquipmentAssetDetail.tsx` (new) at `/equipment/assets/:assetId`: header (code, name, unit, external ref
badge when set); "Costing" card (current setting, history toggle via `useEquipmentCosting(true)`); "Change costing" opens
`pages/equipment/EquipmentCostingForm.tsx` (new, `EntityFormModal`): basis radio (None / Hire rate / Actual cost by usage),
the fields per basis, `effective_from`, "Preview" (`usePreviewCosting`) rendering per-project-per-month rows and any
**unallocated** rows with the reason before Save; only rendered for `can('manage','equipmentCosting')`. "Allocations" table
from `useEquipmentAllocations({ assetId, from, to })`: month, project, basis, amount, and an expandable drill-down row with
units/rates or pool/driver/share/version/entry count (FR-EQU-044), `status = 'unallocated'` rows labelled
"Unallocated: no approved usage this month", `usage_only` rows "Usage recorded; no costing set" with no amount.
Test `pages/equipment/EquipmentAssetDetail.test.tsx` (new): `the drill-down shows pool, driver, share and version for an
actual-cost row` (AC-EQU-001's FE reference), `an unallocated pool is shown with its reason`, `a PM sees no Change costing`,
`preview rows render before save`.

### S6.4 Asset list

`pages/equipment/EquipmentAssets.tsx` (new) at `/equipment/assets`: list from `useEquipmentAssets`, "New asset" (Admin/PM,
`EntityFormModal` with code, name, default unit), archive (`ConfirmDialog`), Admin delete (23503 → "in use"). Test
`pages/equipment/EquipmentAssets.test.tsx` (new): `an Engineer sees the list but no New asset`, `a code clash shows the 23505 copy`.

### S6.5 Project Finances panel

`pages/project-detail/ProjectEquipmentPanel.tsx` (new), rendered inside `ProjectFinancesSection.tsx` after the spending block
(near the split at `:85-88`): usage per asset this year from `useEquipmentUsageTotals({ projectId })` (every role), and, for
`can('view','equipmentUsage')`, allocated amounts per asset from `useEquipmentAllocations({ projectId })` with the basis label
and, when `equipment_charge_total` is non-zero, the line "Includes {{amount}} internal equipment charges (hire rates), not
ledger cost" (FR-EQU-051 label). Test `pages/project-detail/ProjectEquipmentPanel.test.tsx` (new): `an Engineer sees hours but
no amounts`, `a PM sees both projects' allocated amounts per asset`, `the internal-charge line appears only when the charge is non-zero`.

### S6.6 Routes, rail, breadcrumbs

`App.tsx` routes (beside `:217-218`): `/equipment` (→ `EquipmentUsagePage`), `/equipment/assets`, `/equipment/assets/:assetId`
(`React.lazy` imports like `:109-116`). `src/components/shell/Rail.tsx` item after Timesheets (`:69`):
`{ to: '/equipment', text: 'Equipment', icon: 'clock', group: 'Delivery', roles: [all five roles] }` and its label in the
`t('equipment:nav.equipment', 'Equipment')` map (`:228` pattern); `routeMatch.ts` crumbs. Tests: extend
`App.routes.test.tsx` (`/equipment/assets/:assetId resolves`) and `src/components/shell/__tests__/routeMatch.test.ts`.

### S6.7 i18n catalogue test

`pmo-portal/src/lib/i18n/equipmentCatalogue.test.ts` (new), as `imprestCatalogue.test.ts`: every key used under `equipment:` in
`pages/equipment/**` and `ProjectEquipmentPanel.tsx` exists in both `en` and `id`.

### S6.8 Failing test then pass: the curated journey (AC-EQU-019)

`pmo-portal/e2e/AC-EQU-019-equipment-allocation-journey.spec.ts` (new). Line 1:
`// @e2e-isolation: self-isolated — creates its own uniquely-named projects, asset, ledger account, account-map row, ledger line, usage and costing setting each run and deletes them afterwards; reads the seed org and its seeded users only.`
Setup through the service-role client (helpers `requireServiceRoleKey` / `signIn` from `e2e/helpers`, as
`AC-IMP-090-site-imprest-journey.spec.ts:13-29`): two projects `E2E-EQU-<run> A/B` managed by the seeded PM, an asset
`E2E-EQU-<run>`, an account `E2E-EQU-<run> Depreciation` in `erp_account_mirror` mapped to `Equipment` in
`budget_category_account_map`, and one untagged ledger line of 800.00 last month on cost centre `E2E-EQU-<run> CC`.

```ts
test('AC-EQU-019 log on two projects, approve, set actual-cost basis, see both allocated amounts on the project Finances panel', async ({ page }) => {
  await signIn(page, ENGINEER);                       // the seeded Engineer logs
  await page.goto('/equipment');
  // log 6 h on project A and 2 h on project B for the asset, last month, then submit
  …
  await page.getByRole('button', { name: 'Submit week' }).click();
  await signIn(page, PM);                             // the seeded PM manages both projects
  await page.goto('/equipment');
  await page.getByRole('tab', { name: 'Approvals' }).click();
  await page.getByRole('button', { name: 'Approve week' }).click();
  await signIn(page, FINANCE);
  await page.goto(`/equipment/assets/${assetId}`);
  await page.getByRole('button', { name: 'Change costing' }).click();
  // Actual cost by usage · driver hours · account + cost centre · from the first of last month · Save
  …
  await page.goto(`/projects/${projectA}?tab=finances`);
  await expect(page.getByTestId('project-equipment-panel').getByText(/600\.00|600/)).toBeVisible();
  await page.goto(`/projects/${projectB}?tab=finances`);
  await expect(page.getByTestId('project-equipment-panel').getByText(/200\.00|200/)).toBeVisible();
});
```

The goal oracle is "both allocated amounts are on each project's Finances panel" — never weakened to "a panel exists". Teardown
deletes, in order: setting rows, entries, asset, ledger line, map row, account row, projects (service role). Run:
`scripts/e2e-local.sh AC-EQU-019`. Then `scripts/ux-proof.sh /equipment /equipment/assets /equipment/assets/<id> /projects/<id>`
on the touched routes (UI-lane gate).

### S6.9 Gate

`npm run check:guards`, `npm run typecheck`, every S6 test file, `npx eslint --max-warnings=0 <touched>`, `scripts/e2e-local.sh AC-EQU-019`,
`scripts/ux-proof.sh` clean; Director rendered review per the UI lane.

---

## S7 - CLI (no migration) — batchable

Owns AC-EQU-018. `scripts/lib/pmo-equipment.mjs` (new) mirrors `scripts/lib/pmo-attribution.mjs`:

```js
/** The API-client guard tiers (migration <S4-NNNN> S4) — keep in step with equipment_*_rpcs. */
export const EQUIPMENT_WRITE_RPCS = Object.freeze(['preview_equipment_costing', 'save_equipment_costing', 'end_equipment_costing']);
export const EQUIPMENT_READ_RPCS = Object.freeze(['list_equipment_costing', 'list_equipment_allocations']);
export const EQUIPMENT_USAGE_RPCS = Object.freeze(['list_equipment_usage_totals']);
export function readSettings(doc) { /* one object or array, ≤ 50, shape only (AttributionFileError pattern) */ }
export function validateUsageList({ project, asset, from, to }) { /* one of project/asset uuid; YYYY-MM-DD; ≤ 2 years */ }
export async function previewSettings(ctx, settings) { /* rpc preview_equipment_costing per setting */ }
export async function setSettings(ctx, settings, { dryRun }) { /* dryRun → preview only, saves nothing */ }
export function formatAllocations(rows) { /* month · project · basis · amount (or "usage only" / "unallocated: …") */ }
export function explainError(e) { /* 42501 / 22023 / P0002 / 23505 / 40001 messages, as pmo-attribution MESSAGES */ }
```

Wire `case 'equipment':` in `scripts/pmo.mjs` (`:917` pattern), add `'equipment'` to `COMMANDS` (`:112`) and the usage lines:
`pmo equipment usage list (--project <id> | --asset <id>) --from <date> --to <date> [--json]`,
`pmo equipment costing preview <file|-> [--json]`, `pmo equipment costing set <file|-> [--dry-run]`,
`pmo equipment costing list [--history]`.

### S7.1 Failing test

`scripts/pmo-equipment.test.mjs` (new), the fake-PostgREST harness of `scripts/pmo-attribution.test.mjs:30-45`:
`AC-EQU-018 usage list posts list_equipment_usage_totals with the project and range`,
`AC-EQU-018 costing preview prints one line per project and month and flags unallocated pools`,
`AC-EQU-018 costing set --dry-run calls preview and never save`, `AC-EQU-018 costing set saves each setting in order and stops at
the first refusal with the database reason`, `AC-EQU-018 costing list --history passes p_include_history`,
`AC-EQU-018 the tiers match the guard arrays` (asserts the three exported arrays equal the literal arrays in the S4 migration,
read with a regex from the one migration that declares `equipment_write_rpcs`, found by content, not by file name, so it
still works if S4 is appended to 0449), `AC-EQU-018 a 42501 explains who may manage costing`.
Mutation check: make `setSettings` ignore `dryRun` → the dry-run test goes red.
Run: `node --test scripts/pmo-equipment.test.mjs` → fails.

### S7.2 Implement `scripts/lib/pmo-equipment.mjs` and the `pmo.mjs` wiring; S7.3 run the test green and
`node --test scripts/pmo.test.mjs scripts/pmo-attribution.test.mjs` (no regression in the shared CLI); S7.4 `npx eslint --max-warnings=0 scripts/lib/pmo-equipment.mjs scripts/pmo-equipment.test.mjs scripts/pmo.mjs` (from `pmo-portal/`, as the repo lints scripts).

---

## Traceability (each AC has exactly one owning test)

| AC | Owning layer | Owning file | Owning test (title leading token) | Slice | Also referenced (non-owning) |
|---|---|---|---|---|---|
| AC-EQU-001 | pgTAP | `supabase/tests/equipment_actual_cost.test.sql` | `AC-EQU-001 an 800.00 pool on 6 h / 2 h allocates 600.00 and 200.00 with no rate` | S3 | Vitest `pages/equipment/EquipmentAssetDetail.test.tsx` (drill-down render) |
| AC-EQU-002 | pgTAP | `supabase/tests/equipment_costing.test.sql` | `AC-EQU-002 basis none shows usage per project and no amount` | S2 | |
| AC-EQU-003 | pgTAP | `supabase/tests/equipment_costing.test.sql` | `AC-EQU-003 10 h work × 50 + 4 h standby × 20 = 580.00` | S2 | |
| AC-EQU-004 | pgTAP | `supabase/tests/equipment_actual_cost.test.sql` | `AC-EQU-004 a 1/3 split rounds to the cent, the last project takes the remainder` | S3 | |
| AC-EQU-005 | pgTAP | `supabase/tests/equipment_actual_cost.test.sql` | `AC-EQU-005 a pool with zero approved driver allocates nothing and shows as unallocated` | S3 | |
| AC-EQU-006 | pgTAP | `supabase/tests/equipment_actual_cost.test.sql` | `AC-EQU-006 draft and rejected usage never count` | S3 | hire-rate half in `equipment_costing.test.sql` |
| AC-EQU-007 | pgTAP | `supabase/tests/equipment_usage.test.sql` | `AC-EQU-007 the author cannot approve their own entry` | S1 | |
| AC-EQU-008 | pgTAP | `supabase/tests/equipment_costing.test.sql` | `AC-EQU-008 periods before the change keep v1, after use v2` | S2 | |
| AC-EQU-009 | pgTAP | `supabase/tests/equipment_actual_cost.test.sql` | `AC-EQU-009 a ledger line goes to one winner only` | S3 | |
| AC-EQU-010 | pgTAP | `supabase/tests/equipment_project_actuals.test.sql` | `AC-EQU-010 the actual-cost share reaches attributed_to_date in the mapped category` | S4 | |
| AC-EQU-011 | pgTAP | `supabase/tests/equipment_project_actuals.test.sql` | `AC-EQU-011 with usage logged but no equipment setting, project_mapped_actuals is identical to 0376` | S4 | |
| AC-EQU-012 | pgTAP | `supabase/tests/equipment_rls.test.sql` | `AC-EQU-012 an Engineer reads only their own entries` | S1 (+S2, S4 rows) | Vitest `src/auth/policy.test.ts` (UX mirror) |
| AC-EQU-013 | pgTAP | `supabase/tests/equipment_api_client.test.sql` | `AC-EQU-013 an Engineer API client may not save` | S4 | |
| AC-EQU-014 | pgTAP | `supabase/tests/equipment_actual_cost.test.sql` | `AC-EQU-014 preview rows equal the saved allocations per project per month` | S3 | |
| AC-EQU-015 | pgTAP | `supabase/tests/equipment_costing.test.sql` | `AC-EQU-015 a units setting after a day entry in the window is refused (mixed units)` | S2 | |
| AC-EQU-016 | pgTAP | `supabase/tests/equipment_project_actuals.test.sql` | `AC-EQU-016 no ERP command is enqueued (OQ-1: nothing is posted)` | S4 | |
| AC-EQU-017 | Vitest/RTL + axe | `pmo-portal/pages/equipment/EquipmentUsage.test.tsx` | `AC-EQU-017 a user logs 6 h on a project for an asset and day, submits, and the row shows Submitted` | S6 | |
| AC-EQU-018 | node:test (CLI) | `scripts/pmo-equipment.test.mjs` | `AC-EQU-018 costing set --dry-run calls preview and never save` | S7 | |
| AC-EQU-019 | Playwright (one) | `pmo-portal/e2e/AC-EQU-019-equipment-allocation-journey.spec.ts` | `AC-EQU-019 log on two projects, approve, set actual-cost basis, see both allocated amounts on the project Finances panel` | S6 | |

Each owning file carries every other row of its AC under the same leading token, so `grep -r AC-EQU-0NN` finds the canonical
proof and its siblings. Requirements without their own AC are proven inside an owning file: FR-EQU-002/003/004 and OQ-7/8 in
`equipment_usage.test.sql` (AC-EQU-007 rows); FR-EQU-034 second clause and FR-EQU-033 in `equipment_rls.test.sql`/`equipment_costing.test.sql`;
FR-EQU-045 in AC-EQU-008; FR-EQU-064 in `equipment_rls.test.sql`; NFR-EQU-003 in `equipment_actual_cost_perf.test.sql`;
NFR-EQU-005 in `equipmentCatalogue.test.ts`; NFR-EQU-006 in the AC-EQU-017 axe row.

## Risks (spec §9) and where each is closed

1. **Double count** — one winner per line across both sources (S3.2 `distinct on (l.id)`), unallocated pools filtered out of
   `cost_attribution_allocations` (S3.3), the hire charge kept out of tagged/attributed (D5); AC-EQU-009/010 prove it.
2. **Silent drop** — the engine's `unallocated` arm (S3.2); AC-EQU-005; the preview shows it before save (S3.5).
3. **Wrong number on screen** — drill-down reads the same engine rows that feed actuals; every list aggregates in SQL and the
   DAL keeps the `LIMIT + 1` sentinel; the panel's figures are asserted by the e2e goal oracle (AC-EQU-019).
4. **Self-approval / rate-approval collusion** — SoD-first transition + table CHECK (S1); costing writes Admin/Finance only (S2);
   AC-EQU-007/012.
5. **Restatement** — approved usage immutable (S1.5); versions windowed forward (PQ-4); AC-EQU-008.

## Spec notes for the coordinator

The spec is not edited. These are defects or gaps found while planning; none blocks the build (each has a default above).

1. **AC-EQU-016 owner "pgTAP + deno".** Nothing in this feature touches an edge function (OQ-1: nothing is posted), and
   `scripts/check-edge-fn-test-binding.mjs` requires a deno test to import a shipped handler, so a deno test would have nothing
   honest to bind to. The plan owns AC-EQU-016 in pgTAP (mirror, snapshot and outbox unchanged). Suggest amending the owner
   column to "pgTAP".
2. **AC-EQU-018 owner "Vitest (CLI)".** The CLI's tests are `node:test` files under `scripts/` (`scripts/pmo-attribution.test.mjs`,
   run by CI at `.github/workflows/ci.yml:214-218`), not Vitest. Suggest "node:test (CLI)".
3. **AC-EQU-011 "byte-identical".** Read, as #1271 did (`cost-attribution.spec.md` §3.4), as "every existing field identical;
   new fields additive": `project_mapped_actuals` gains a ninth column and `get_project_finances` a new key, which a literal
   byte comparison of the whole payload would fail. The proof compares existing fields against a verbatim copy of the 0376/0410
   expressions, and the two dashboards' whole JSON (which gain no field).
4. **FR-EQU-034 is one-sided.** It refuses an equipment setting that ties or loses to a cost attribution rule, but says nothing
   about a later #1271 rule that ties an equipment setting. The plan also refuses that tie (spec delta 4), which changes #1271's
   save behaviour for orgs with equipment settings. A later #1271 rule that is **more** specific than an equipment setting is
   allowed and silently takes those lines (one winner, no double count), so that equipment pool shrinks; the drill-down shows the
   new line count. Confirm both are intended.
5. **OQ-5 "projects they are a member of"** has no data behind it: PMO has no project membership (scope searched in
   "What ships today"). PQ-1 takes "any project in the caller's org".
6. **Data-model fields beyond §5:** `count_standby` (OQ-6), `charge_category` (OQ-3), `applies_to` (FR-EQU-045), `specificity`,
   `decision_notes`. §5 says "names final at plan time", so these are additions, not conflicts.
7. **Fiscal year of a hire-rate charge** is unspecified (PQ-2); the actuals reads filter by ERP fiscal year.
8. **Error codes:** §5 lists `42501, 22023, P0002, 23505, 40001`; the timesheet pattern the spec cites uses `P0001` for an
   illegal transition. The plan uses `22023` (PQ-9).
9. **FR-EQU-071 RPC list** names `list_equipment_allocations(p_asset_id, p_from, p_to)` only per asset; the project Finances panel
   needs it per project, so the plan adds an optional `p_project_id` (PQ-11).
10. **FR-EQU-021 (read from an ERP asset mirror)** cannot be built yet: no asset mirror exists (#1511/#899). The columns are
    reserved (S1.2); the adoption rule of OQ-9 belongs to those issues.

## Review fixes (2026-11-01, spec + security lens)

Every item below is already applied in the sections above; this list is the audit trail.

1. **Migration numbers** set to Lane B's range: S1 0447, S2 0448, S3 0449. S4 needs a fourth number (`<S4-NNNN>`), or
   is appended to 0449 and ships with S3.
2. **Fixture ids**: the foreign asset id ended in `dx`, which is not hex and fails the `uuid` cast; now `d9`.
3. **Isolation denominator** lists every non-trigger SECURITY DEFINER function, not only client RPCs. S1's two definer
   helpers are now plain functions; each slice's gate names the exact `regprocedure` strings.
4. **`list_equipment_costing`** was an invoker calling a helper with no client EXECUTE, so every call would fail; now a
   stable definer with its role gate and org filter.
5. **AC-EQU-014 test** captured the preview's unallocated row (project null) and compared it with allocated rows only, so
   it could never pass; the capture now takes project rows only.
6. **`source_sum` rewrite** returned 0 where 0376 returns null (rows with null nets), breaking AC-EQU-011 for orgs with
   no settings; the 0376 case is kept verbatim and a null-net row proves it.
7. **Hire charges and Engineers** (FR-EQU-062 "no amounts"): the charge helpers now return rows only to Admin, Finance,
   Executive and PM; S4.7 asserted the opposite and is corrected.
8. **Mixed units across a month edge**: PQ-5 shares a version's pool over the whole month, so the mixed-unit refusal and
   the entry unit lock start at the first of the `effective_from` month for `actual_cost`.
9. **AC-EQU-015 test** could pass for the wrong reason (a future-dated row is also `22023`); it now uses past dates and
   matches the message.
10. **Conflict checks** compared only current equipment settings, but older versions keep applying to their dates; all
    three checks and the #1271-side check now read every effective version.
11. **0178 count** base is 104 on dev, not 103 (S1 → 108, S2 → 110; re-derive after rebase).
12. **Rebuilt bodies** come from the newest migration at build time (sibling lanes may redefine them); rollbacks restore
    the body actually replaced. S3's rollback drops the 5-argument wrapper before re-creating the 4-argument one.
13. **AC-EQU-009 test** read a `source` column the wrapper does not have; it now reads the engine.
14. **Archive (FR-EQU-064)** had no test rows; added to S1.7.
15. **Null-safe SoD comparisons** (`is not distinct from`) in the transition, bulk approve and archive.
16. **Employee-party condition** added to the two equipment ledger reads for parity with every #1271 read.
17. **Small path fixes**: `useProjectFinances` exports no root constant; the CLI tier test finds the guard migration by
    content; S4.2 states its file order; service-role grants and "no side-mirror table" are stated.
