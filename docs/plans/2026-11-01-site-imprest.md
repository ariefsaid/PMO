# Site imprest plan and replenishment - implementation plan (#1515)

Spec: [`docs/specs/site-imprest.spec.md`](../specs/site-imprest.spec.md) (**Signed** by the owner 2026-11-01; OQ-IMP-2
changed, consequence DD-IMP-7). Route item T4 of [`2026-10-30-epc-odoo-build-route.md`](2026-10-30-epc-odoo-build-route.md);
map #1481. Extends [`expense-claims.spec.md`](../specs/expense-claims.spec.md) (#775). Blocks #1509 (Odoo side of §9).
Ownership: ADR-0094 (accepted 2026-10-31). Role contract: `.claude/agents/eng-planner.md`.
Gate: **money path** (cash out of a float, custodian SoD, replenishment SoD). Executor: Director-dispatched Orca workers,
**one worker per slice, each slice its own branch**; the money/SoD slices (S1, S2, S3, S6) ship **alone**, never batched
(CLAUDE.md money tier, `docs/orca-dispatch.md`). Read [`docs/money-path-primer.md`](../money-path-primer.md) before S2 and S6.
Everything cited was checked against `origin/dev` at `3e1813899` (migration head `0421_odoo_master_records.sql`;
`0416`-`0418` stay reserved for stock S4-S6; no remote branch holds `0422`+; the 0178 retained-RPC count is **94**).
A path marked **(new)** does not exist yet.

## Open questions (each has the default this plan takes; each names the one slice that changes)

The spec's OQ-IMP-1..8 are owner-signed. These are **new**, found while planning. None blocks dispatch.

| # | Question | Default taken | Slice |
|---|---|---|---|
| PQ-1 | A float record whose route names **only** the custodian as eligible approver (a project whose one named approver is its PM custodian). DD-IMP-7.1 refuses the custodian. | The existing Admin break-glass decides it (audited `break_glass = true`, as `transition_expense_claim` already does). No new escalation path. | S2 |
| PQ-2 | May a float's amount be **lowered**? Lowering below the cash already funded means handing cash back, which is "closing a float", out of scope. | A proposed amount below `Σ Paid fundings` is refused (P0001 "lowering a float below the cash already funded is a wind-down, not in scope"). Lowering an unfunded or partly funded float to no less than its funded total is allowed. | S1 |
| PQ-3 | Where does the org's **procurement limit** live? | A new one-row-per-org table `org_imprest_settings`, written only by the Admin-only RPC `set_imprest_procurement_limit(p_amount)`. A change applies to the next submission and is audited. Not a column on `organizations` (its client update grant is wide). | S1 |
| PQ-4 | An **Engineer** files a float claim (FR-IMP-020/072) but sees no float (AC-IMP-061). How does the form list floats? | A narrow definer read `imprest_float_choices(p_project, p_category)`: float id, custodian name, and the current month's remaining for the category, for any active member of the org. The float tables stay hidden. | S3 |
| PQ-5 | The exception route when **no senior set is configured**: `spend_approval_route` falls to `flat` (DD-APR-4), but spec FR-IMP-002/024 say "Admin when none is configured". | A helper `imprest_senior_route(org, requester)` returns `org` (eligible senior approvers) or `admin` (nobody eligible, configured or not). It never returns `flat`: an exception must go to someone more senior than any project approver (DD-IMP-4). Float-amount changes use the same helper. | S1 |
| PQ-6 | `replenishment_in_flight` (FR-IMP-060): Requested only, or Requested and Approved? | **Requested + Approved** (both still to be paid). | S3 |
| PQ-7 | A float claim settling an advance on **another** float or on no float breaks DD-IMP-2 (the advance's outstanding falls on float X while the receipt waits on Y). | Refused: a claim and the advance it settles must name the same float or both none (23514). Enforcement of DD-IMP-2, not a new requirement. | S2 |
| PQ-8 | Who cancels a replenishment? FR-IMP-051 allows Cancelled but names no actor. | The requester while Requested; Finance or Admin while Requested or Approved. | S2 |
| PQ-9 | Spec ACs say category "Fuel"; `budget_category` has no such value. | Tests use `Vehicle` (0366) where the spec says Fuel. | S2, S3 |
| PQ-10 | Who is notified "ready to pay" for a float record? Today every Finance member is (0247 §10). | For a float record, **only the custodian** (they alone can pay, DD-IMP-7). An item that does not fit at submission also notifies the senior set (FR-IMP-064). | S3 |

## Spec deltas found while planning (none changes a requirement)

1. **`expense_claims.imprest_month date`** is a fourth new column (spec §6 lists three). It freezes OQ-IMP-8's month at
   submission and backs NFR-IMP-006's `(imprest_float_id, month)` index. Written only by the transition.
2. **`imprest_replenishments` is created in S1** (schema only) so PQ-2's funded-total check exists from the first slice; its
   RPCs arrive in S2.
3. **FR-IMP-054 binds only `funding`.** Paying a `replenishment` moves receipts into cash and cannot change the sum; paying
   a funding adds its amount. The check runs at pay time for both kinds and is a no-op for `replenishment`.
4. **AC-IMP-084's owning file is `pages/ExpenseClaimNew.test.tsx`** (the form lives in `ExpenseClaimNew.tsx`, not
   `ExpenseClaims.tsx`).
5. **The float lock is an advisory lock** `imprest-float:<uuid>` taken through `imprest_lock_float(p_float)`. Global
   order, never inverted: claim/plan row `FOR UPDATE` -> `spend-line:<project>:<category>` (a plan approval takes one per
   line, in category order) -> `imprest-float:<float>` -> (replenishment request only) the selected Paid claim rows. No
   path takes the float lock and then a spend-line lock.
6. **Plan lines are client-written under RLS** (the expense-line pattern, 0247 §4): the author inserts, edits and deletes
   lines while the plan is Draft or Rejected; status, number, total and stamps move only through RPCs.
7. **ERP posting of the four float variants stays in `expense_posting_erp_mirror`** (0270); only the source/target cash
   account changes. The new `replenishment` posting gets its own side mirror `imprest_posting_erp_mirror` (S6), because
   its subject is not a claim.
8. **AC-IMP-050's 800,000 replenishment cannot exist on AC-IMP-031's setup** (only 500,000 of receipts wait there); S3.1
   asserts the same property with 500,000.

## Architecture

### Design decisions

- **D1 The float is a sub-ledger of expenses, derived not stored (DD-IMP-1/2).** No balance column. `cash_book`,
  `advances_out`, `receipts_waiting`, `funded`, `drawn` and `remaining` are `stable` SQL functions over
  `expense_claims`, `expense_advance_returns` and `imprest_replenishments`. The identity
  `cash_book + advances_out + receipts_waiting = funded` holds by construction and AC-IMP-044 asserts it.
- **D2 One authority per transition.** `transition_expense_claim` is re-created once (S2) with every float rule inside it,
  marked `-- 0423` line by line (0247's reversible-edit convention). Plans, float changes and replenishments each get one
  definer transition RPC. No second payment table.
- **D3 Custodian pays, and only from their own float (DD-IMP-7).** For a record with `imprest_float_id`, the
  `Finance or Admin` pay check is replaced by `v_uid = float.custodian_id and imprest_custodian_eligible(...)`. The
  custodian is refused as approver of a float record and as claimant on their own float. Records without a float run
  0247's text unchanged.
- **D4 Eligibility is one function, re-checked at every act.** `imprest_custodian_eligible(org, project, profile)`: active
  member of the org, approval rank, and (`Finance` role or `projects.project_manager_id = profile`). Establishment, pay,
  return, replenishment/funding request, count and the ERP posting gate all call it; fail closed (`coalesce(..., false)`).
- **D5 Routing is called, never copied (ADR-0075 §3).** In-plan float records use `spend_approval_route` exactly as today.
  Exceptions and float-amount changes use `imprest_senior_route` (PQ-5), which reads the same `spend_approvers` rows.
- **D6 Posting is side-mirror, tier-neutral above the adapter (DD-IMP-6, AC-ECA-043).** SQL decides *whether* to enqueue
  with `org_employs_imprest_postings(org)` (any activated tier owning `expenses`). The ERPNext sweep pass drives it
  (`supabase/functions/erpnext-sweep/**` is tier-owned); #1509 adds the Odoo pass. The canonical command is
  `imprest.transfer`, registered in `connect/workflows.ts` and proven by one shared contract suite.
- **D7 FE follows ADR-0016/0017.** Pages -> hooks -> `repositories.imprest` -> DAL `src/lib/db/imprest.ts` -> RPC/RLS. `can()`
  and `availableImprestActions` are UX only; no `org_id` from the client; money in integer cents.

### Slice map

| Slice | Migration | Tasks | Blocked by | Worker tier (cheapest-first) | Ships |
|---|---|---|---|---|---|
| **S1 Floats, changes, plans** | `0422_imprest_floats_plans.sql` | S1.1-S1.12 | none | Terra or Sol (SoD) | alone |
| **S2 Charging, paying, replenishment** | `0423_imprest_cash.sql` | S2.1-S2.12 | S1 | **Sol** (money path) | alone |
| **S3 Position, counts, choices, notify** | `0424_imprest_position.sql` | S3.1-S3.7 | S2 | Terra | alone |
| **S4 Data layer** (DAL, repo, hooks, rules, policy) | none | S4.1-S4.7 | S3 | Luna | batchable |
| **S5 Screens, form, approvals, e2e** | none | S5.1-S5.8 | S4 | Flash or Luna (UI lane) | batchable |
| **S6 ERP posting** (cash account, intents, ERPNext driver, contract suite) | `0425_imprest_postings.sql` | S6.1-S6.10 | S3 (S5 for the pending badge) | **Sol** (money path) | alone |

Order: S1 -> S2 -> S3 -> (S4 -> S5) and S6 in parallel after S3. Each slice branch is `feat/imprest-s<n>` off
`origin/dev`, own worktree, `.env.local` copied in; workers push the branch only, the Director opens PRs (owner rule
2026-10-30). Slices may stack on the previous slice's branch before its PR merges; money slices still ship as their own PR.

## Conventions every task follows

- **Test files.** pgTAP in `supabase/tests/imprest_<topic>.test.sql`, self-contained: `begin; create extension if not
  exists pgtap; select plan(N);` ... `select * from finish(); rollback;`. Vitest next to the source. Playwright in
  `pmo-portal/e2e/AC-IMP-090-site-imprest-journey.spec.ts` with `// @e2e-isolation:` on line 1
  (`docs/e2e-parallel-conventions.md`).
- **AC tag** is the leading token of the pgTAP description / `it(...)` / `test(...)` title.
- **DB commands under the lock, reset and test in one hold:**
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<file>.test.sql'`.
- **Every migration slice's gate (S1, S2, S3, S6)**, in this order, all green before push:
  1. `scripts/check-migration-collisions.sh && scripts/check-migration-collisions.sh --self-test`
  2. `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<this slice's files> supabase/tests/0178_anon_executable_definers.test.sql'`
  3. `node scripts/check-isolation-denominator.mjs && node scripts/check-isolation-denominator.mjs --self-test`
     (needs the reset local DB; add every new table, definer and RPC to `scripts/isolation-probe-denominator.json`)
  4. the 0178 retained-RPC count: re-derive by hand from the VALUES list after any rebase (94 on `3e1813899`; S1 makes it
     99, S2 101, S3 102, S6 102) and update both hard-coded counts and the header note.
  5. from `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, the touched vitest files, `npx eslint --max-warnings=0 <touched>`.
- **Types after a migration:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`.
- **Hosted-grants lesson (0185/0210).** Every function ends with `revoke all ... from public, anon;` and internals also
  `from authenticated`; client RPCs then `grant execute ... to authenticated`. Every migration ends with a closing
  self-assertion block (0270 §6 style) that raises if the ACL shape is wrong.
- **Rollback files:** `supabase/migrations/rollback/<n>_<slug>_down.sql`, reverse dependency order (precedent
  `0421_odoo_master_records_down.sql`). The migration header also carries the reverse (NFR-IMP-002).
- **Public repo:** no tenant data in seeds or docs; fixtures use synthetic UUID prefix `1515....`, emails `@example.com`.
- **Commits:** conventional, no attribution trailers. Before every push:
  `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must NOT match. Never `--no-verify`.

## Shared pgTAP prelude (Fixture F1, copied verbatim into every imprest pgTAP file; extend, never fork)

```sql
begin;
create extension if not exists pgtap;
select plan(0); -- replace 0 with the real count

insert into organizations (id, name, default_currency, default_timezone) values
  ('15150000-0000-0000-0000-00000000000a', 'IMP Org',       'IDR', 'Asia/Jakarta'),
  ('15150000-0000-0000-0000-00000000000b', 'IMP Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15150000-0000-0000-0000-0000000000a1', 'imp-admin@example.com'),
  ('15150000-0000-0000-0000-0000000000a2', 'imp-fin1@example.com'),   -- Finance, custodian of float F (project P1)
  ('15150000-0000-0000-0000-0000000000a3', 'imp-fin2@example.com'),   -- Finance, not a custodian
  ('15150000-0000-0000-0000-0000000000a4', 'imp-pm1@example.com'),    -- PM, manages P1
  ('15150000-0000-0000-0000-0000000000a5', 'imp-pm2@example.com'),    -- PM, manages P2; custodian of float G
  ('15150000-0000-0000-0000-0000000000a6', 'imp-eng1@example.com'),   -- Engineer, claimant
  ('15150000-0000-0000-0000-0000000000a7', 'imp-exec@example.com'),   -- Executive, senior approver
  ('15150000-0000-0000-0000-0000000000b1', 'imp-xorg@example.com');   -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15150000-0000-0000-0000-0000000000a1', '15150000-0000-0000-0000-00000000000a', 'IMP Admin', 'imp-admin@example.com', 'Admin', 'active'),
  ('15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-00000000000a', 'IMP Fin1',  'imp-fin1@example.com',  'Finance', 'active'),
  ('15150000-0000-0000-0000-0000000000a3', '15150000-0000-0000-0000-00000000000a', 'IMP Fin2',  'imp-fin2@example.com',  'Finance', 'active'),
  ('15150000-0000-0000-0000-0000000000a4', '15150000-0000-0000-0000-00000000000a', 'IMP PM1',   'imp-pm1@example.com',   'Project Manager', 'active'),
  ('15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-00000000000a', 'IMP PM2',   'imp-pm2@example.com',   'Project Manager', 'active'),
  ('15150000-0000-0000-0000-0000000000a6', '15150000-0000-0000-0000-00000000000a', 'IMP Eng1',  'imp-eng1@example.com',  'Engineer', 'active'),
  ('15150000-0000-0000-0000-0000000000a7', '15150000-0000-0000-0000-00000000000a', 'IMP Exec',  'imp-exec@example.com',  'Executive', 'active'),
  ('15150000-0000-0000-0000-0000000000b1', '15150000-0000-0000-0000-00000000000b', 'IMP XOrg',  'imp-xorg@example.com',  'Admin', 'active');
-- P1 managed by PM1 (float F), P2 managed by PM2 (float G), P3 managed by PM1 (no float; establishment tests)
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-00000000000a', 'IMP Site One',   'Ongoing Project', '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-0000000000c2', '15150000-0000-0000-0000-00000000000a', 'IMP Site Two',   'Ongoing Project', '15150000-0000-0000-0000-0000000000a5'),
  ('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-00000000000a', 'IMP Site Three', 'Ongoing Project', '15150000-0000-0000-0000-0000000000a4');
-- senior approver set: the Executive only (PQ-5 route 'org')
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15150000-0000-0000-0000-00000000000a', null, '15150000-0000-0000-0000-0000000000a7');
insert into org_imprest_settings (org_id, procurement_limit, updated_by) values
  ('15150000-0000-0000-0000-00000000000a', 2000000, '15150000-0000-0000-0000-0000000000a1');
-- Float F: P1, custodian Fin1, 10,000,000. Float G: P2, custodian PM2 (the project's own PM), 5,000,000.
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1',
   '15150000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '15150000-0000-0000-0000-0000000000a1'),
  ('15150000-0000-0000-0000-0000000000d2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c2',
   '15150000-0000-0000-0000-0000000000a5', 5000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');

-- helper: act as a member (jwt claims are transaction-local)
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
```

Ids: projects `…c1`/`…c2`/`…c3`, floats F = `…d1`, G = `…d2`. F1 inserts as the superuser **before**
`set local role authenticated`; tests then call `select pg_temp.act_as('<uuid>');` before each RPC. The `projects` column
list is the one `supabase/tests/expense_claims_routing.test.sql` uses on `origin/dev`, plus `project_manager_id`. No
project has an active budget in F1, so `spend_approval_route` classifies `no_active_budget` and routes to the senior set
(the Executive) unless a test adds a budget.

A funded fixture (F2, used from S2 on) appends, as superuser:

```sql
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('15150000-0000-0000-0000-0000000000e1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'funding', 'REP-2611010001', 'Paid', 10000000, '15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date),
  ('15150000-0000-0000-0000-0000000000e2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   'funding', 'REP-2611010002', 'Paid', 5000000, '15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);
```

---

## S1 - Floats, float changes, plans (`0422_imprest_floats_plans.sql`)

Covers AC-IMP-001, 002, 010-014, and the S1 halves of AC-IMP-060 / 061. File header (copy verbatim, then the sections below
in order):

```sql
-- 0422_imprest_floats_plans.sql — #1515 site imprest S1: org procurement limit, floats, float-amount changes, monthly
-- plans. Spec: docs/specs/site-imprest.spec.md (signed 2026-11-01) · Plan: docs/plans/2026-11-01-site-imprest.md S1.
-- Proven by supabase/tests/imprest_floats.test.sql, imprest_plans.test.sql, imprest_rls.test.sql, imprest_acl.test.sql
-- and the 0178 allow-list.
-- ── REVERSE (manual, in this order; also supabase/migrations/rollback/0422_imprest_floats_plans_down.sql) ──────────
--   drop function if exists public.transition_imprest_plan(uuid, text, text);
--   drop function if exists public.decide_imprest_float_change(uuid, boolean, text);
--   drop function if exists public.propose_imprest_float_amount(uuid, numeric);
--   drop function if exists public.establish_imprest_float(uuid, uuid, numeric);
--   drop function if exists public.set_imprest_procurement_limit(numeric);
--   drop table if exists public.imprest_plan_lines;      -- drops its trigger
--   drop table if exists public.imprest_plans;
--   drop table if exists public.imprest_replenishments;
--   drop table if exists public.imprest_float_changes;
--   drop table if exists public.imprest_floats;
--   drop table if exists public.org_imprest_settings;
--   drop function if exists public.sync_imprest_plan_total();
--   drop function if exists public.assert_imprest_plan_line_editable();
--   drop function if exists public.stamp_imprest_plan_org();
--   drop function if exists public.imprest_funded(uuid);
--   drop function if exists public.imprest_lock_float(uuid);
--   drop function if exists public.imprest_senior_route(uuid, uuid);
--   drop function if exists public.imprest_custodian_eligible(uuid, uuid, uuid);
--   (procurement_doc_counters rows with prefix IMP/REP are harmless; leave them.)
```

### S1.1 Failing test: establishment and custodian eligibility (AC-IMP-001)

Create `supabase/tests/imprest_floats.test.sql` (new) = F1, then (establishment uses project P3, which has no float):

```sql
delete from org_imprest_settings where org_id = '15150000-0000-0000-0000-00000000000a';  -- still superuser
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_like($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a3', 10000000) $$,
  '%procurement limit%', 'AC-IMP-001 no procurement limit: establishing a float is refused naming the limit');
select lives_ok($$ select set_imprest_procurement_limit(2000000) $$, 'AC-IMP-001 an Admin sets the procurement limit');
select isnt((select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a3', 10000000)), null,
  'AC-IMP-001 a Finance custodian: the float is established');
select is((select org_id from imprest_floats where project_id = '15150000-0000-0000-0000-0000000000c3'
             and custodian_id = '15150000-0000-0000-0000-0000000000a3'),
  '15150000-0000-0000-0000-00000000000a'::uuid, 'AC-IMP-001 org_id is stamped from the caller');
select is((select float_amount from imprest_floats where project_id = '15150000-0000-0000-0000-0000000000c3'
             and custodian_id = '15150000-0000-0000-0000-0000000000a3'), 0::numeric,
  'AC-IMP-001 the amount is 0 until its first change is approved (FR-IMP-002)');
select isnt((select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a4', 5000000)), null,
  'AC-IMP-001 OQ-IMP-2: the project''s own PM may be the custodian');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a5', 5000000) $$,
  '23514', null, 'AC-IMP-001 OQ-IMP-2: a PM who does not manage the project cannot be its custodian');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a6', 5000000) $$,
  '23514', null, 'AC-IMP-001 an Engineer cannot be a custodian');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a2', 5000000) $$,
  '42501', null, 'AC-IMP-001 only Admin or Finance establishes a float');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select throws_ok($$ select set_imprest_procurement_limit(1) $$, '42501', null, 'AC-IMP-001 only an Admin sets the limit');
```

Run:
`scripts/with-db-lock.sh supabase test db supabase/tests/imprest_floats.test.sql` -> fails (functions missing).

### S1.2 Helpers: eligibility, senior route, float lock, funded total

```sql
-- §1 helpers. DEFINER for eligibility: it must see the custodian's profile and the project whatever the caller sees.
create or replace function public.imprest_custodian_eligible(p_org uuid, p_project uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select pf.org_id = p_org
       and public.is_active_member(p_profile)
       and public.holds_spend_approval_authority(pf.role)
       and (pf.role = 'Finance'
            or exists (select 1 from public.projects p
                        where p.id = p_project and p.org_id = p_org and p.project_manager_id = p_profile))
      from public.profiles pf where pf.id = p_profile), false)
$$;
comment on function public.imprest_custodian_eligible(uuid, uuid, uuid) is
  '#1515 OQ-IMP-2 / DD-IMP-7.5 — a custodian is an active approval-rank member who holds Finance or manages the project. '
  'Re-checked at every custodian act; NULL-safe and fail-closed.';
revoke all on function public.imprest_custodian_eligible(uuid, uuid, uuid) from public, anon, authenticated;

-- PQ-5: the senior set, never `flat`. Reads spend_approvers exactly as 0247 §8 step 3 does.
create or replace function public.imprest_senior_route(p_org uuid, p_requester uuid)
returns table (route text, approver_ids uuid[]) language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester and pf.status = 'active' and pf.org_id = p_org
               and public.holds_spend_approval_authority(pf.role)), '{}') as ids
      from public.spend_approvers sa join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org and sa.project_id is null)
  select case when cardinality(s.ids) > 0 then 'org' else 'admin' end, s.ids from s
$$;
revoke all on function public.imprest_senior_route(uuid, uuid) from public, anon, authenticated;

create or replace function public.imprest_lock_float(p_float uuid) returns void
  language sql volatile set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(hashtextextended('imprest-float:' || p_float::text, 0))
$$;
revoke all on function public.imprest_lock_float(uuid) from public, anon, authenticated;
```

`imprest_funded` is defined in S1.4 after the replenishment table.

### S1.3 Settings table and the limit RPC

```sql
-- §2 the org procurement limit (OQ-IMP-3, PQ-3).
create table public.org_imprest_settings (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  procurement_limit numeric(14,2) not null,
  updated_by        uuid not null references public.profiles(id),
  updated_at        timestamptz not null default now(),
  constraint org_imprest_settings_limit_range check (procurement_limit > 0 and procurement_limit < 'Infinity'::numeric)
);
alter table public.org_imprest_settings enable row level security;
alter table public.org_imprest_settings force  row level security;
create policy org_imprest_settings_select on public.org_imprest_settings for select
  using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.org_imprest_settings from public, anon, authenticated;
grant select on public.org_imprest_settings to authenticated;

create or replace function public.set_imprest_procurement_limit(p_amount numeric) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_old numeric;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin sets the procurement limit' using errcode = '42501';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'the procurement limit must be greater than zero' using errcode = 'P0001';
  end if;
  select procurement_limit into v_old from public.org_imprest_settings where org_id = v_org;
  insert into public.org_imprest_settings (org_id, procurement_limit, updated_by) values (v_org, round(p_amount, 2), v_uid)
  on conflict (org_id) do update set procurement_limit = excluded.procurement_limit, updated_by = excluded.updated_by,
                                     updated_at = now();
  perform public.log_audit('imprest_settings.procurement_limit', v_org, v_uid, v_org,
    jsonb_build_object('from', v_old, 'to', round(p_amount, 2)));
end; $$;
revoke all on function public.set_imprest_procurement_limit(numeric) from public, anon;
grant execute on function public.set_imprest_procurement_limit(numeric) to authenticated;
```

### S1.4 Floats, changes, replenishments (schema), funded total

```sql
-- §3 tables. org_id has NO default (every writer states it: the 0074/0213 seed-default class).
create table public.imprest_floats (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id),
  project_id           uuid not null references public.projects(id),
  custodian_id         uuid not null references public.profiles(id),
  float_amount         numeric(14,2) not null default 0,
  currency             text not null,
  erp_cash_account_ref text,
  created_by           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),
  archived_at          timestamptz,
  constraint imprest_floats_amount_range check (float_amount >= 0 and float_amount < 'Infinity'::numeric),
  constraint imprest_floats_currency_iso4217 check (currency ~ '^[A-Z]{3}$' and currency <> 'XXX'),
  constraint imprest_floats_cash_account_present check (erp_cash_account_ref is null or btrim(erp_cash_account_ref) <> '')
);
create unique index imprest_floats_one_live on public.imprest_floats (org_id, project_id, custodian_id) where archived_at is null;
create index imprest_floats_project_idx on public.imprest_floats (project_id);
create index imprest_floats_custodian_idx on public.imprest_floats (custodian_id);

create table public.imprest_float_changes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  float_id        uuid not null references public.imprest_floats(id),
  proposed_amount numeric(14,2) not null,
  status          text not null default 'Proposed',
  proposed_by     uuid not null references public.profiles(id),
  proposed_at     timestamptz not null default now(),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  notes           text,
  constraint imprest_float_changes_amount_range check (proposed_amount > 0 and proposed_amount < 'Infinity'::numeric),
  constraint imprest_float_changes_status check (status in ('Proposed','Approved','Rejected'))
);
create unique index imprest_float_changes_one_open on public.imprest_float_changes (float_id) where status = 'Proposed';

create table public.imprest_replenishments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  float_id          uuid not null references public.imprest_floats(id),
  kind              text not null,
  number            text not null,
  status            text not null default 'Requested',
  amount            numeric(14,2) not null,
  requested_by      uuid not null references public.profiles(id),
  requested_at      timestamptz not null default now(),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  paid_by           uuid references public.profiles(id),
  paid_at           timestamptz,
  paid_on           date,
  payment_reference text,
  decided_notes     text,
  cancelled_at      timestamptz,
  constraint imprest_replenishments_kind   check (kind in ('replenishment','funding')),
  constraint imprest_replenishments_status check (status in ('Requested','Approved','Paid','Rejected','Cancelled')),
  constraint imprest_replenishments_amount_range check (amount > 0 and amount < 'Infinity'::numeric),
  constraint imprest_replenishments_number_unique unique (org_id, number)
);
create index imprest_replenishments_float_idx on public.imprest_replenishments (float_id, status);

-- Σ Paid fundings: the cash head office has put into the float (DD-IMP-2's right-hand side).
create or replace function public.imprest_funded(p_float uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(sum(r.amount), 0) from public.imprest_replenishments r
   where r.float_id = p_float and r.kind = 'funding' and r.status = 'Paid'
$$;
revoke all on function public.imprest_funded(uuid) from public, anon;
grant execute on function public.imprest_funded(uuid) to authenticated;
```

### S1.5 RLS on the three tables

```sql
-- §4 RLS. Visibility = approval rank (spec §5 Visibility; every custodian holds it). No client writes: RPCs only.
alter table public.imprest_floats         enable row level security;
alter table public.imprest_floats         force  row level security;
alter table public.imprest_float_changes  enable row level security;
alter table public.imprest_float_changes  force  row level security;
alter table public.imprest_replenishments enable row level security;
alter table public.imprest_replenishments force  row level security;
create policy imprest_floats_select on public.imprest_floats for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and public.holds_spend_approval_authority(public.auth_role()));
create policy imprest_float_changes_select on public.imprest_float_changes for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_floats f where f.id = imprest_float_changes.float_id));
create policy imprest_replenishments_select on public.imprest_replenishments for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_floats f where f.id = imprest_replenishments.float_id));
revoke all on public.imprest_floats, public.imprest_float_changes, public.imprest_replenishments from public, anon, authenticated;
grant select on public.imprest_floats, public.imprest_float_changes, public.imprest_replenishments to authenticated;
```

### S1.6 `establish_imprest_float`, `propose_imprest_float_amount`, `decide_imprest_float_change`

```sql
-- §5 float RPCs (FR-IMP-001/002/003, OQ-IMP-7, PQ-2).
create or replace function public.establish_imprest_float(p_project uuid, p_custodian uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_float uuid; v_cur text;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then
    raise exception 'only an Admin or Finance member establishes a site float' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_imprest_settings s where s.org_id = v_org) then
    raise exception 'set the org''s procurement limit before establishing a site float' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not public.imprest_custodian_eligible(v_org, p_project, p_custodian) then
    raise exception 'a custodian must be an active Finance member or the manager of this project' using errcode = '23514';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a float amount must be greater than zero' using errcode = 'P0001';
  end if;
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  insert into public.imprest_floats (org_id, project_id, custodian_id, currency, created_by)
  values (v_org, p_project, p_custodian, v_cur, v_uid) returning id into v_float;
  insert into public.imprest_float_changes (org_id, float_id, proposed_amount, proposed_by)
  values (v_org, v_float, round(p_amount, 2), v_uid);
  perform public.log_audit('imprest_float.established', v_org, v_uid, v_float,
    jsonb_build_object('project_id', p_project, 'custodian_id', p_custodian, 'proposed_amount', round(p_amount, 2)));
  return v_float;
end; $$;
revoke all on function public.establish_imprest_float(uuid, uuid, numeric) from public, anon;
grant execute on function public.establish_imprest_float(uuid, uuid, numeric) to authenticated;

create or replace function public.propose_imprest_float_amount(p_float uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_id uuid;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then
    raise exception 'only an Admin or Finance member proposes a float amount' using errcode = '42501';
  end if;
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  perform public.imprest_lock_float(p_float);
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a float amount must be greater than zero' using errcode = 'P0001';
  end if;
  if round(p_amount, 2) < public.imprest_funded(p_float) then
    raise exception 'lowering a float below the cash already funded is a wind-down, not in scope' using errcode = 'P0001';
  end if;
  insert into public.imprest_float_changes (org_id, float_id, proposed_amount, proposed_by)
  values (v_f.org_id, p_float, round(p_amount, 2), v_uid) returning id into v_id;
  perform public.log_audit('imprest_float_change.proposed', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'from', v_f.float_amount, 'to', round(p_amount, 2)));
  return v_id;
end; $$;
revoke all on function public.propose_imprest_float_amount(uuid, numeric) from public, anon;
grant execute on function public.propose_imprest_float_amount(uuid, numeric) to authenticated;

create or replace function public.decide_imprest_float_change(p_change uuid, p_approve boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.imprest_float_changes%rowtype; v_uid uuid := auth.uid(); v_admin boolean := public.auth_role() = 'Admin';
        v_route record;
begin
  perform public.assert_is_active_member();
  select * into v_c from public.imprest_float_changes where id = p_change for update;
  if not found or v_c.org_id is distinct from public.auth_org_id() then
    raise exception 'float change not found' using errcode = 'P0002';
  end if;
  perform public.imprest_lock_float(v_c.float_id);
  if v_c.status <> 'Proposed' then
    raise exception 'this float change is already %', lower(v_c.status) using errcode = 'P0001';
  end if;
  if v_uid = v_c.proposed_by then
    raise exception 'separation of duties: the proposer cannot decide their own float amount' using errcode = '42501';
  end if;
  select * into v_route from public.imprest_senior_route(v_c.org_id, v_c.proposed_by);
  if not v_admin and not coalesce(v_uid = any (v_route.approver_ids), false) then
    raise exception 'approval routing: a float amount needs the senior approver set%',
      case when v_route.route = 'admin' then ' (none eligible: an Admin)' else '' end using errcode = '42501';
  end if;
  if p_approve and v_c.proposed_amount < public.imprest_funded(v_c.float_id) then
    raise exception 'lowering a float below the cash already funded is a wind-down, not in scope' using errcode = 'P0001';
  end if;
  update public.imprest_float_changes
     set status = case when p_approve then 'Approved' else 'Rejected' end, decided_by = v_uid, decided_at = now(),
         notes = nullif(btrim(p_notes), '')
   where id = p_change;
  if p_approve then
    update public.imprest_floats set float_amount = v_c.proposed_amount where id = v_c.float_id;
  end if;
  perform public.log_audit('imprest_float_change.decided', v_c.org_id, v_uid, p_change,
    jsonb_build_object('float_id', v_c.float_id, 'approved', p_approve, 'amount', v_c.proposed_amount,
                       'route', v_route.route,
                       'break_glass', v_admin and not coalesce(v_uid = any (v_route.approver_ids), false)));
end; $$;
revoke all on function public.decide_imprest_float_change(uuid, boolean, text) from public, anon;
grant execute on function public.decide_imprest_float_change(uuid, boolean, text) to authenticated;
```

### S1.7 Failing test then green: float-amount SoD (AC-IMP-002)

Append to `imprest_floats.test.sql`:

```sql
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');  -- Admin establishes; its change row is proposed by Admin
select establish_imprest_float('15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-0000000000a3', 10000000);
select throws_like($$ select decide_imprest_float_change(
    (select c.id from imprest_float_changes c join imprest_floats f on f.id = c.float_id
      where f.project_id = '15150000-0000-0000-0000-0000000000c1' and f.custodian_id = '15150000-0000-0000-0000-0000000000a3'
        and c.status = 'Proposed'), true) $$,
  '%separation of duties%', 'AC-IMP-002 the proposer cannot approve their own float amount');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');  -- a PM is not in the senior set
select throws_ok($$ select decide_imprest_float_change(
    (select c.id from imprest_float_changes c join imprest_floats f on f.id = c.float_id
      where f.project_id = '15150000-0000-0000-0000-0000000000c1' and f.custodian_id = '15150000-0000-0000-0000-0000000000a3'
        and c.status = 'Proposed'), true) $$,
  '42501', null, 'AC-IMP-002 a non-senior approver cannot decide a float amount');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');  -- the Executive is the senior set
select lives_ok($$ select decide_imprest_float_change(
    (select c.id from imprest_float_changes c join imprest_floats f on f.id = c.float_id
      where f.project_id = '15150000-0000-0000-0000-0000000000c1' and f.custodian_id = '15150000-0000-0000-0000-0000000000a3'
        and c.status = 'Proposed'), true) $$,
  'AC-IMP-002 a different senior approver approves');
select is((select float_amount from imprest_floats where project_id = '15150000-0000-0000-0000-0000000000c1'
             and custodian_id = '15150000-0000-0000-0000-0000000000a3'), 10000000::numeric, 'AC-IMP-002 the float amount is set only by the approved change');
```

**Mutation check:** comment out the `v_uid = v_c.proposed_by` refusal -> the first assertion must go red. Restore.

### S1.8 Plans and plan lines (tables, total trigger, RLS)

```sql
-- §6 monthly plans (FR-IMP-010..016). Lines are client-written by the author while Draft/Rejected (0247 §4 pattern).
create table public.imprest_plans (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  float_id        uuid not null references public.imprest_floats(id),
  month           date not null,
  number          text,
  status          text not null default 'Draft',
  total           numeric(14,2) not null default 0,
  author_id       uuid not null references public.profiles(id) default auth.uid(),
  submitted_at    timestamptz,
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  decision_notes  text,
  is_late         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint imprest_plans_month_first check (month = date_trunc('month', month)::date),
  constraint imprest_plans_status check (status in ('Draft','Submitted','Approved','Rejected','Cancelled')),
  constraint imprest_plans_total_range check (total >= 0 and total < 'Infinity'::numeric),
  constraint imprest_plans_number_unique unique (org_id, number)
);
create unique index imprest_plans_one_live on public.imprest_plans (float_id, month) where status in ('Submitted','Approved');
create index imprest_plans_float_month_idx on public.imprest_plans (float_id, month);

create table public.imprest_plan_lines (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  plan_id         uuid not null references public.imprest_plans(id) on delete cascade,
  budget_category public.budget_category not null,
  planned_amount  numeric(14,2) not null,
  constraint imprest_plan_lines_amount_range check (planned_amount > 0 and planned_amount < 'Infinity'::numeric),
  constraint imprest_plan_lines_one_per_category unique (plan_id, budget_category)
);

-- org_id: a plan inherits its float's; a line inherits its plan's (the 0028 idiom; runs as writer, so an invisible
-- parent leaves NULL and the NOT NULL + RLS WITH CHECK refuse it).
create or replace function public.stamp_imprest_plan_org() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'imprest_plans' then
    select f.org_id into new.org_id from public.imprest_floats f where f.id = new.float_id;
  else
    select p.org_id into new.org_id from public.imprest_plans p where p.id = new.plan_id;
  end if;
  return new;
end; $$;
revoke all on function public.stamp_imprest_plan_org() from public, anon, authenticated;
create trigger imprest_plans_stamp_org before insert on public.imprest_plans
  for each row execute function public.stamp_imprest_plan_org();
create trigger imprest_plan_lines_stamp_org before insert on public.imprest_plan_lines
  for each row execute function public.stamp_imprest_plan_org();

-- The plan total is Σ lines, server-maintained (FR-IMP-010, FR-EXP-004 pattern). DEFINER: clients hold no update grant
-- on total.
create or replace function public.sync_imprest_plan_total() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  update public.imprest_plans p
     set total = coalesce((select sum(l.planned_amount) from public.imprest_plan_lines l where l.plan_id = v_plan), 0)
   where p.id = v_plan;
  return null;
end; $$;
revoke all on function public.sync_imprest_plan_total() from public, anon, authenticated;
create trigger imprest_plan_lines_sync_total after insert or update or delete on public.imprest_plan_lines
  for each row execute function public.sync_imprest_plan_total();

alter table public.imprest_plans      enable row level security;
alter table public.imprest_plans      force  row level security;
alter table public.imprest_plan_lines enable row level security;
alter table public.imprest_plan_lines force  row level security;
create policy imprest_plans_select on public.imprest_plans for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_floats f where f.id = imprest_plans.float_id));
create policy imprest_plans_insert on public.imprest_plans for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and author_id = auth.uid()
              and status = 'Draft' and public.holds_spend_approval_authority(public.auth_role())
              and exists (select 1 from public.imprest_floats f where f.id = imprest_plans.float_id
                            and f.org_id = public.auth_org_id() and f.archived_at is null));
create policy imprest_plan_lines_select on public.imprest_plan_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_plans p where p.id = imprest_plan_lines.plan_id));
-- The write policy admits the author whatever the status, so a frozen plan's line edit reaches the trigger below and
-- fails loudly with 42501 (AC-IMP-011) instead of silently matching no row.
create policy imprest_plan_lines_write on public.imprest_plan_lines for all
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_plans p where p.id = imprest_plan_lines.plan_id and p.author_id = auth.uid()))
  with check (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_plans p where p.id = imprest_plan_lines.plan_id and p.author_id = auth.uid()));
create or replace function public.assert_imprest_plan_line_editable() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
declare v_status text;
begin
  if public.actor_bypasses_rls() then
    return coalesce(new, old);
  end if;
  select p.status into v_status from public.imprest_plans p where p.id = coalesce(new.plan_id, old.plan_id) for update;
  if v_status is distinct from 'Draft' and v_status is distinct from 'Rejected' then
    raise exception 'this plan is % and its lines can no longer be changed (FR-IMP-012)', coalesce(v_status, 'missing')
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end; $$;
revoke all on function public.assert_imprest_plan_line_editable() from public, anon, authenticated;
create trigger imprest_plan_lines_assert_editable before insert or update or delete on public.imprest_plan_lines
  for each row execute function public.assert_imprest_plan_line_editable();
revoke all on public.imprest_plans, public.imprest_plan_lines from public, anon, authenticated;
grant select on public.imprest_plans to authenticated;
grant insert (id, float_id, month) on public.imprest_plans to authenticated;
grant select, delete on public.imprest_plan_lines to authenticated;
grant insert (id, plan_id, budget_category, planned_amount) on public.imprest_plan_lines to authenticated;
grant update (budget_category, planned_amount) on public.imprest_plan_lines to authenticated;
```

### S1.9 `transition_imprest_plan`

```sql
-- §7 the plan state machine (FR-IMP-012..015). Draft→Submitted|Cancelled; Submitted→Approved|Rejected|Cancelled;
-- Rejected→Draft|Cancelled. Approved and Cancelled are terminal.
create or replace function public.transition_imprest_plan(p_id uuid, p_to text, p_notes text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p      public.imprest_plans%rowtype;
  v_f      public.imprest_floats%rowtype;
  v_uid    uuid := auth.uid();
  v_admin  boolean := public.auth_role() = 'Admin';
  v_tz     text;
  v_today  date;
  v_lines  int;
  v_l      record;
  v_route  record;
  v_routes jsonb := '[]'::jsonb;
  v_glass  boolean := false;
  v_legal  jsonb := jsonb_build_object(
    'Draft', jsonb_build_array('Submitted','Cancelled'), 'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Rejected', jsonb_build_array('Draft','Cancelled'), 'Approved', jsonb_build_array(), 'Cancelled', jsonb_build_array());
begin
  perform public.assert_is_active_member();
  select * into v_p from public.imprest_plans where id = p_id for update;
  if not found or v_p.org_id is distinct from public.auth_org_id() then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if not (v_legal -> v_p.status) ? p_to then
    raise exception 'illegal transition % -> %', v_p.status, p_to using errcode = 'P0001';
  end if;
  select * into v_f from public.imprest_floats where id = v_p.float_id;
  -- Lock order (plan delta 5): every spend-line lock BEFORE the float lock, never after — transition_expense_claim
  -- takes spend-line then float, so the reverse here could deadlock. Category order keeps plan approvals consistent.
  if p_to in ('Approved','Rejected') then
    perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_f.project_id::text || ':' || l.budget_category::text, 0))
       from public.imprest_plan_lines l where l.plan_id = p_id order by l.budget_category;
  end if;
  perform public.imprest_lock_float(v_p.float_id);
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = v_p.org_id), 'UTC');
  v_today := (now() at time zone v_tz)::date;

  if p_to in ('Approved','Rejected') then
    if v_uid = v_p.author_id then
      raise exception 'separation of duties: the author cannot decide their own plan' using errcode = '42501';
    end if;
    if v_uid = v_f.custodian_id then
      raise exception 'separation of duties: a custodian cannot decide a plan for their own float' using errcode = '42501';
    end if;
  end if;

  if p_to = 'Submitted' then
    if v_uid is distinct from v_p.author_id then
      raise exception 'only the author can submit this plan' using errcode = '42501';
    end if;
    select count(*) into v_lines from public.imprest_plan_lines where plan_id = p_id;
    if v_lines = 0 then
      raise exception 'a plan needs at least one line before it can be submitted' using errcode = 'P0001';
    end if;
    if v_p.total > v_f.float_amount then
      raise exception 'the plan total % is above the float amount %', v_p.total, v_f.float_amount using errcode = 'P0001';
    end if;
    if exists (select 1 from public.imprest_plans o where o.float_id = v_p.float_id and o.month = v_p.month
                 and o.id <> p_id and o.status in ('Submitted','Approved')) then
      raise exception 'this float already has a plan for that month' using errcode = 'P0001';
    end if;
  elsif p_to = 'Draft' then
    if v_uid is distinct from v_p.author_id then
      raise exception 'only the author can reopen this plan' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not (v_uid = v_p.author_id or v_admin or public.auth_role() = 'Finance') then
      raise exception 'not authorized to cancel this plan' using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    if p_to = 'Approved' and (v_p.month + interval '1 month')::date <= v_today then
      raise exception 'the plan''s month has ended; it can no longer be approved' using errcode = 'P0001';
    end if;
    if p_to = 'Approved' and v_p.total > v_f.float_amount then
      raise exception 'the plan total % is above the float amount %', v_p.total, v_f.float_amount using errcode = 'P0001';
    end if;
    for v_l in select l.budget_category, l.planned_amount from public.imprest_plan_lines l where l.plan_id = p_id
               order by l.budget_category loop
      select * into v_route from public.spend_approval_route(v_p.org_id, v_f.project_id, v_l.budget_category,
        v_l.planned_amount, v_f.currency, v_p.author_id, v_uid, v_p.submitted_at);
      if coalesce(v_route.route, 'senior') = 'flat' then
        if not (v_admin or public.holds_spend_approval_authority(public.auth_role())) then
          raise exception 'not authorized to decide this plan' using errcode = '42501';
        end if;
      elsif not coalesce(v_uid = any (v_route.approver_ids), false) then
        if not v_admin then
          raise exception 'approval routing: the % line needs %', v_l.budget_category,
            case v_route.route when 'admin' then 'an Admin' else 'a named approver' end using errcode = '42501';
        end if;
        v_glass := true;
      end if;
      v_routes := v_routes || jsonb_build_object('budget_category', v_l.budget_category::text, 'amount', v_l.planned_amount,
                                                 'route', v_route.route, 'reason', v_route.reason);
    end loop;
    perform public.log_audit('imprest_plan.approval_route', v_p.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to, 'lines', v_routes, 'break_glass', v_glass,
                         'late', p_to = 'Approved' and v_p.month <= v_today));
  end if;

  update public.imprest_plans set
    status         = p_to,
    number         = case when p_to = 'Submitted' then coalesce(number, public.next_procurement_doc_number(org_id, 'IMP')) else number end,
    submitted_at   = case when p_to = 'Submitted' then now() else submitted_at end,
    approved_by    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by end,
    approved_at    = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    decision_notes = case when p_to in ('Approved','Rejected') then nullif(btrim(p_notes), '') else decision_notes end,
    is_late        = case when p_to = 'Approved' then v_p.month <= v_today else is_late end
  where id = p_id;
  perform public.log_audit('imprest_plan.transition', v_p.org_id, v_uid, p_id,
    jsonb_build_object('from', v_p.status, 'to', p_to, 'notes', p_notes));
end; $$;
revoke all on function public.transition_imprest_plan(uuid, text, text) from public, anon;
grant execute on function public.transition_imprest_plan(uuid, text, text) to authenticated;
```

⚑ `late` is true when the month has **begun** (`month <= today`): a plan for the current month approved on the 1st is
late, matching FR-IMP-015 ("a month already begun ... audited as late"). A plan for next month is not late.

### S1.10 Plan tests (AC-IMP-010..014)

Create `supabase/tests/imprest_plans.test.sql` (new) = F1 + the funded fixture F2, then:

```sql
-- plans authored by PM1 on float F (custodian Fin1), next month (never late, never ended)
insert into imprest_plans (id, org_id, float_id, month, author_id) values
  ('15150000-0000-0000-0000-000000000101', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '1 month')::date, '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-000000000102', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '1 month')::date, '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-000000000103', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '1 month')::date, '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-000000000104', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date, '15150000-0000-0000-0000-0000000000a4');
insert into imprest_plan_lines (plan_id, budget_category, planned_amount) values
  ('15150000-0000-0000-0000-000000000101', 'Vehicle', 6000000), ('15150000-0000-0000-0000-000000000101', 'Materials', 5000000),
  ('15150000-0000-0000-0000-000000000103', 'Vehicle', 1000000),
  ('15150000-0000-0000-0000-000000000104', 'Vehicle', 3000000);
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Submitted') $$,
  '%above the float amount%', 'AC-IMP-010 a plan total above the float is refused at submit');
update imprest_plan_lines set planned_amount = 3000000
 where plan_id = '15150000-0000-0000-0000-000000000101' and budget_category = 'Materials';
select is((select total from imprest_plans where id = '15150000-0000-0000-0000-000000000101'), 9000000::numeric,
  'AC-IMP-010 the total is server-maintained from the lines');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Submitted') $$,
  'AC-IMP-010 a plan within the float submits');
select is((select count(*)::int from imprest_plan_lines where plan_id = '15150000-0000-0000-0000-000000000101'
             and budget_category = 'Vehicle'), 1, 'AC-IMP-011 (setup) the line exists');
select throws_ok($$ update imprest_plan_lines set planned_amount = 1 where plan_id = '15150000-0000-0000-0000-000000000101' $$,
  '42501', null, 'AC-IMP-011 the author cannot change lines once the plan is submitted');
insert into imprest_plan_lines (plan_id, budget_category, planned_amount)
  values ('15150000-0000-0000-0000-000000000102', 'Vehicle', 100);
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000102', 'Submitted') $$,
  '%already has a plan for that month%', 'AC-IMP-011 a second plan for the same float and month is refused at submit');
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Approved') $$,
  '%author cannot decide%', 'AC-IMP-012 the author cannot approve their own plan');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Approved') $$,
  '%custodian cannot decide%', 'AC-IMP-012 the custodian cannot approve a plan for their own float');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2: not the routed approver (route org = the Executive)
select throws_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Approved') $$,
  '42501', null, 'AC-IMP-012 an approver the route excludes is refused');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Approved') $$,
  'AC-IMP-012 the routed approver approves');
select ok(exists (select 1 from audit_events where entity_id = '15150000-0000-0000-0000-000000000101'
                    and action = 'imprest_plan.approval_route'), 'AC-IMP-012 an imprest_plan.approval_route audit row exists');
-- AC-IMP-013 month ended / current month late (plan 103 is last month; plan 104 is this month on float G)
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select transition_imprest_plan('15150000-0000-0000-0000-000000000103', 'Submitted');
select transition_imprest_plan('15150000-0000-0000-0000-000000000104', 'Submitted');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000103', 'Approved') $$,
  '%month has ended%', 'AC-IMP-013 a plan whose month has ended cannot be approved');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000104', 'Approved') $$,
  'AC-IMP-013 a plan for the current month is approved');
select ok((select is_late from imprest_plans where id = '15150000-0000-0000-0000-000000000104'),
  'AC-IMP-013 the current-month approval is audited late');
select ok(not (select is_late from imprest_plans where id = '15150000-0000-0000-0000-000000000101'),
  'AC-IMP-013 a next-month approval is not late');
```

AC-IMP-014 (approving a plan adds nothing to the line used amount): give **P2** an active budget with a `Vehicle` line of
50,000,000 (insert `budget_versions` + `budget_line_items` as superuser before `set local role`, column lists as in
`supabase/tests/expense_claims_routing.test.sql`). Plan 104 (float G, P2, Vehicle 3,000,000) then routes `flat`
(within budget, no project approvers) and the Executive still approves it above. After that approval:

```sql
select is((select line_used from spend_approval_route('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c2',
             'Vehicle', 1, 'IDR', '15150000-0000-0000-0000-0000000000a6', null, null)), 0::numeric,
  'AC-IMP-014 an approved plan adds nothing to the budget line used amount');
```

The "claim approval raises used" half is already AC-EXP-031 (owned by `expense_claims_routing.test.sql`); S2.12 adds the
float-claim variant to `imprest_routing.test.sql`.

Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/imprest_floats.test.sql supabase/tests/imprest_plans.test.sql'`.

**Mutation checks:** remove the author refusal -> AC-IMP-012 first assertion red; remove the custodian refusal -> second red.

### S1.11 RLS and ACL tests (S1 half of AC-IMP-060 / 061), 0178 allow-list, denominator

Create `supabase/tests/imprest_rls.test.sql` (new) = F1 + F2 + one Draft plan by PM1 on F, then:

```sql
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from imprest_floats), 0, 'AC-IMP-061 an Engineer sees no float');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from imprest_floats), 2, 'AC-IMP-061 a Project Manager sees the org''s floats');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from imprest_floats), 0, 'AC-IMP-061 another org sees none');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into imprest_floats (org_id, project_id, custodian_id, currency, created_by)
  values ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-0000000000a2', 'IDR',
          '15150000-0000-0000-0000-0000000000a1') $$, '42501', null, 'AC-IMP-061 no client inserts a float');
select throws_ok($$ update imprest_floats set float_amount = 1 $$, '42501', null, 'AC-IMP-061 no client writes a float amount');
select throws_ok($$ insert into imprest_plans (float_id, month, org_id) values
  ('15150000-0000-0000-0000-0000000000d1', date_trunc('month', now())::date, '15150000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'AC-IMP-061 a client cannot write org_id on a plan');
select throws_ok($$ update imprest_plans set status = 'Approved' $$, '42501', null, 'AC-IMP-061 no client writes plan status');
select throws_ok($$ insert into imprest_replenishments (org_id, float_id, kind, number, amount, requested_by)
  values ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1', 'funding', 'X', 1,
          '15150000-0000-0000-0000-0000000000a1') $$, '42501', null, 'AC-IMP-061 no client inserts a replenishment');
```

Create `supabase/tests/imprest_acl.test.sql` (new), no fixture needed:

```sql
begin; create extension if not exists pgtap; select plan(10);
select ok(not has_function_privilege('anon', p, 'EXECUTE'), 'AC-IMP-060 anon cannot execute ' || p)
  from unnest(array['public.set_imprest_procurement_limit(numeric)', 'public.establish_imprest_float(uuid, uuid, numeric)',
                    'public.propose_imprest_float_amount(uuid, numeric)', 'public.decide_imprest_float_change(uuid, boolean, text)',
                    'public.transition_imprest_plan(uuid, text, text)']) p;
select ok(has_function_privilege('authenticated', p, 'EXECUTE'), 'AC-IMP-060 authenticated may execute ' || p)
  from unnest(array['public.set_imprest_procurement_limit(numeric)', 'public.establish_imprest_float(uuid, uuid, numeric)',
                    'public.propose_imprest_float_amount(uuid, numeric)', 'public.decide_imprest_float_change(uuid, boolean, text)',
                    'public.transition_imprest_plan(uuid, text, text)']) p;
select * from finish(); rollback;
```

S2, S3 and S6 append their functions to both arrays and bump `plan(N)`; the internals (`imprest_custodian_eligible`,
`imprest_senior_route`, `imprest_lock_float`) get a third block asserting **neither** role may execute them.

`supabase/tests/0178_anon_executable_definers.test.sql`: add to `client_callable_rpc_names` (sorted):
`('decide_imprest_float_change'), ('establish_imprest_float'), ('propose_imprest_float_amount'),
('set_imprest_procurement_limit'), ('transition_imprest_plan')`; header note
`-- ⚑ AMENDED BY 0422 (#1515): five imprest writers join the retained set (+5, count 99). Each re-asserts org, active
membership and role (or the plan author / route) in its body; proven by imprest_floats/imprest_plans pgTAP.`; both counts
`94 -> 99`.

`scripts/isolation-probe-denominator.json`: add tables `org_imprest_settings` (pk `org_id`), `imprest_floats`,
`imprest_float_changes`, `imprest_replenishments`, `imprest_plans`, `imprest_plan_lines` (each
`"has_org":true,"columns":"*","b_read":"own-org-only","by_id":"applicable"`, pk `id` unless stated); the eight new
definer signatures under `definer_functions`; the five RPCs under `rpcs` as `"class":"write"`,
`"expect_denial":[{"http":403,"sqlstate":"42501"}]`, `source` = `supabase/migrations/0422_imprest_floats_plans.sql:<line>`.
Run `node scripts/check-isolation-denominator.mjs` and fix until clean; then `--self-test`.

### S1.12 Closing self-assertion, rollback file, types, gate

Append to `0422` (0270 §6 style):

```sql
do $$
declare v text;
begin
  foreach v in array array['public.set_imprest_procurement_limit(numeric)', 'public.establish_imprest_float(uuid, uuid, numeric)',
    'public.propose_imprest_float_amount(uuid, numeric)', 'public.decide_imprest_float_change(uuid, boolean, text)',
    'public.transition_imprest_plan(uuid, text, text)'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or not has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '0422: % ACL is not the intended shape', v;
    end if;
  end loop;
  foreach v in array array['public.imprest_custodian_eligible(uuid, uuid, uuid)', 'public.imprest_senior_route(uuid, uuid)',
    'public.imprest_lock_float(uuid)', 'public.sync_imprest_plan_total()', 'public.stamp_imprest_plan_org()',
    'public.assert_imprest_plan_line_editable()'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '0422: internal % is client-executable', v;
    end if;
  end loop;
  foreach v in array array['public.org_imprest_settings', 'public.imprest_floats', 'public.imprest_float_changes',
    'public.imprest_replenishments'] loop
    if has_table_privilege('anon', v, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('authenticated', v, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception '0422: % ACL is not the intended shape', v;
    end if;
  end loop;
end $$;
```

Write `supabase/migrations/rollback/0422_imprest_floats_plans_down.sql` = the header's reverse list, uncommented. Regenerate types. Run the slice gate (Conventions). Commit
`feat(imprest): floats, float-amount approval and monthly plans (#1515 S1)`.

---
## S2 - Charging, paying, replenishment (`0423_imprest_cash.sql`)

Covers AC-IMP-003, 020-026, 030-034, 040-046. **Money path: read `docs/money-path-primer.md` buckets 1, 3, 4 first.**
Header:

```sql
-- 0423_imprest_cash.sql — #1515 site imprest S2: float records on expense claims, the float-aware
-- transition_expense_claim (custodian pays from their own float, DD-IMP-7), advance returns into a float, the
-- derived cash book, replenishment and funding. Spec §5-§7 · Plan S2. Depends on 0247, 0270, 0422.
-- Proven by imprest_routing, imprest_line_lock, imprest_cash, imprest_replenishment pgTAP and the 0178 allow-list.
-- ⚑ transition_expense_claim below is 0247 §7 VERBATIM plus the lines marked `-- 0423`. record_expense_advance_return
--   is 0270 §1 VERBATIM plus the lines marked `-- 0423`. Reverse = re-create each from this text minus the marked lines.
-- ── REVERSE (manual, in this order; also rollback/0423_imprest_cash_down.sql) ───────────────────────────────────────
--   re-create public.record_expense_advance_return from 0270 §1 (this file's text minus `-- 0423` lines)
--   re-create public.transition_expense_claim from 0247 §7 (this file's text minus `-- 0423` lines)
--   drop function if exists public.transition_imprest_replenishment(uuid, text, text, text);
--   drop function if exists public.request_imprest_replenishment(uuid, text);
--   drop function if exists public.imprest_remaining(uuid, date, public.budget_category);
--   drop function if exists public.imprest_drawn(uuid, date, public.budget_category);
--   drop function if exists public.imprest_receipts_waiting(uuid);
--   drop function if exists public.imprest_advances_out(uuid);
--   drop function if exists public.imprest_cash_book(uuid);
--   drop trigger if exists expense_claims_zz_zcheck_float on public.expense_claims;
--   drop function if exists public.check_expense_claim_float();
--   alter table public.expense_claims drop column if exists is_plan_exception, drop column if exists imprest_replenishment_id,
--     drop column if exists imprest_month, drop column if exists imprest_float_id;
```

### S2.1 Failing tests: charging rules (AC-IMP-020, 021)

Create `supabase/tests/imprest_routing.test.sql` (new) = F1 + F2, plus as superuser:

```sql
-- Draft float records by Eng1 (claimant). Lines and a receipt are added per case.
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status) values
  ('15150000-0000-0000-0000-000000000201', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Fuel over the limit', 0, 'Draft'),
  ('15150000-0000-0000-0000-000000000202', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Fuel no receipt', 0, 'Draft'),
  ('15150000-0000-0000-0000-000000000203', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Fuel off float', 0, 'Draft');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('15150000-0000-0000-0000-000000000201', current_date, 'Local transport', 'Diesel', 2500000),
  ('15150000-0000-0000-0000-000000000202', current_date, 'Local transport', 'Diesel', 100000),
  ('15150000-0000-0000-0000-000000000203', current_date, 'Local transport', 'Diesel', 2500000);
insert into expense_claim_files (claim_id, org_id, file_path) values
  ('15150000-0000-0000-0000-000000000201', '15150000-0000-0000-0000-00000000000a',
   '15150000-0000-0000-0000-00000000000a/15150000-0000-0000-0000-000000000201/15150000-0000-0000-0000-000000000901/r.pdf');
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select throws_ok($$ update expense_claims set imprest_float_id = '15150000-0000-0000-0000-0000000000d2'
                    where id = '15150000-0000-0000-0000-000000000201' $$,
  '23514', null, 'AC-IMP-020 a float on another project is refused');
select throws_ok($$ update expense_claims set budget_category = null, imprest_float_id = '15150000-0000-0000-0000-0000000000d1'
                    where id = '15150000-0000-0000-0000-000000000202' $$,
  '23514', null, 'AC-IMP-020 a float claim without a budget category is refused');
update expense_claims set imprest_float_id = '15150000-0000-0000-0000-0000000000d1'
 where id in ('15150000-0000-0000-0000-000000000201', '15150000-0000-0000-0000-000000000202');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000201', 'Submitted') $$,
  '%procurement%', 'AC-IMP-021 a float claim above the procurement limit is refused naming procurement');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000203', 'Submitted') $$,
  'AC-IMP-021 the same amount with no float submits as today');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000202', 'Submitted') $$,
  '%receipt%', 'AC-IMP-021 a float claim with no receipt is refused');
```

**Mutation check:** delete the limit `raise` in S2.4 -> the third assertion goes red.

### S2.2 Columns and the float cross-check trigger

```sql
-- §1 float records on expense_claims (spec §6 + plan delta 1). All four frozen after submission by 0247 §2.
alter table public.expense_claims
  add column imprest_float_id         uuid references public.imprest_floats(id),
  add column imprest_month            date,
  add column imprest_replenishment_id uuid references public.imprest_replenishments(id),
  add column is_plan_exception        boolean not null default false,
  add constraint expense_claims_imprest_month_first check (imprest_month is null or imprest_month = date_trunc('month', imprest_month)::date),
  add constraint expense_claims_replenishment_on_float check (imprest_replenishment_id is null or imprest_float_id is not null);
create index expense_claims_imprest_month_idx on public.expense_claims (imprest_float_id, imprest_month, budget_category)
  where imprest_float_id is not null;
create index expense_claims_imprest_rep_idx on public.expense_claims (imprest_replenishment_id)
  where imprest_replenishment_id is not null;
grant insert (imprest_float_id) on public.expense_claims to authenticated;
grant update (imprest_float_id) on public.expense_claims to authenticated;
comment on column public.expense_claims.imprest_float_id is
  '#1515 — the site float this record is paid from (DD-IMP-1). Only the float''s custodian pays it (DD-IMP-7).';

-- FR-IMP-020/028, PQ-7. DEFINER: a claimant (Engineer) cannot read imprest_floats. Name sorts after
-- expense_claims_zz_zcheck_advance_link (0247 §2: BEFORE triggers fire in name order; both need org stamped).
create or replace function public.check_expense_claim_float() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_adv_float uuid;
begin
  if new.advance_id is not null then
    select a.imprest_float_id into v_adv_float from public.expense_claims a where a.id = new.advance_id;
    if v_adv_float is distinct from new.imprest_float_id then
      raise exception 'a claim and the advance it settles must be charged to the same site float (or both to none)'
        using errcode = '23514';
    end if;
  end if;
  if new.imprest_float_id is null then
    return new;
  end if;
  select * into v_f from public.imprest_floats where id = new.imprest_float_id;
  if not found or v_f.org_id is distinct from new.org_id or v_f.archived_at is not null then
    raise exception 'site float not found' using errcode = '23514';
  end if;
  if new.project_id is distinct from v_f.project_id then
    raise exception 'a record charged to a site float must be on that float''s project' using errcode = '23514';
  end if;
  if new.budget_category is null then
    raise exception 'a record charged to a site float needs a budget category' using errcode = '23514';
  end if;
  if new.claimant_id = v_f.custodian_id then
    raise exception 'separation of duties: a custodian cannot charge their own advance or claim to their own float'
      using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.check_expense_claim_float() from public, anon, authenticated;
create trigger expense_claims_zz_zcheck_float
  before insert or update of imprest_float_id, project_id, budget_category, advance_id on public.expense_claims
  for each row execute function public.check_expense_claim_float();
```

### S2.3 Derived figures (DD-IMP-2, FR-IMP-022/023)

```sql
-- §2 the float's figures, derived never stored (D1). SECURITY INVOKER: under the position RPC they see what the caller
-- sees (approval rank sees every claim); under the definers below they see everything.
create or replace function public.imprest_cash_book(p_float uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((select sum(r.amount) from public.imprest_replenishments r
                    where r.float_id = p_float and r.status = 'Paid'), 0)
       - coalesce((select sum(case c.kind when 'advance' then c.amount else c.amount - c.advance_applied end)
                     from public.expense_claims c where c.imprest_float_id = p_float and c.status = 'Paid'), 0)
       + coalesce((select sum(x.amount) from public.expense_advance_returns x
                     join public.expense_claims a on a.id = x.advance_id where a.imprest_float_id = p_float), 0)
$$;
create or replace function public.imprest_advances_out(p_float uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(sum(public.expense_advance_outstanding(a.id)), 0) from public.expense_claims a
   where a.imprest_float_id = p_float and a.kind = 'advance' and a.status = 'Paid'
$$;
create or replace function public.imprest_receipts_waiting(p_float uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(sum(c.amount), 0) from public.expense_claims c
   where c.imprest_float_id = p_float and c.kind = 'claim' and c.status = 'Paid'
     and not exists (select 1 from public.imprest_replenishments r where r.id = c.imprest_replenishment_id and r.status = 'Paid')
$$;
-- FR-IMP-022: approved/paid claims at full amount + approved/paid advances at outstanding; settling moves the applied
-- part from the advance to the claim, so nothing counts twice.
create or replace function public.imprest_drawn(p_float uuid, p_month date, p_category public.budget_category)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(sum(case c.kind when 'claim' then c.amount else public.expense_advance_outstanding(c.id) end), 0)
    from public.expense_claims c
   where c.imprest_float_id = p_float and c.imprest_month = p_month and c.budget_category = p_category
     and c.status in ('Approved','Paid')
$$;
-- FR-IMP-023: 0 with no approved plan or no line; never negative.
create or replace function public.imprest_remaining(p_float uuid, p_month date, p_category public.budget_category)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select greatest(coalesce((select l.planned_amount from public.imprest_plans p
                              join public.imprest_plan_lines l on l.plan_id = p.id
                             where p.float_id = p_float and p.month = p_month and p.status = 'Approved'
                               and l.budget_category = p_category), 0)
                  - public.imprest_drawn(p_float, p_month, p_category), 0)
$$;
revoke all on function public.imprest_cash_book(uuid), public.imprest_advances_out(uuid), public.imprest_receipts_waiting(uuid),
  public.imprest_drawn(uuid, date, public.budget_category), public.imprest_remaining(uuid, date, public.budget_category)
  from public, anon;
grant execute on function public.imprest_cash_book(uuid), public.imprest_advances_out(uuid), public.imprest_receipts_waiting(uuid),
  public.imprest_drawn(uuid, date, public.budget_category), public.imprest_remaining(uuid, date, public.budget_category)
  to authenticated;
```

### S2.4 `transition_expense_claim`, float-aware (FR-IMP-021/024/026, DD-IMP-3/5/7)

Re-create with this exact text (0247 §7 plus `-- 0423` lines; unmarked lines are byte-identical to 0247 except the
`declare` additions, which are marked):

```sql
create or replace function public.transition_expense_claim(
  p_id                uuid,
  p_to                public.expense_claim_status,
  p_notes             text default null,
  p_payment_reference text default null
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_row      public.expense_claims%rowtype;
  v_uid      uuid      := auth.uid();
  v_role     user_role := auth_role();
  v_is_admin boolean;
  v_route    record;
  v_lines    int;
  v_adv      public.expense_claims%rowtype;
  v_applied  numeric   := 0;
  v_today    date;
  v_float    public.imprest_floats%rowtype;                                               -- 0423
  v_limit    numeric;                                                                      -- 0423
  v_tz       text;                                                                         -- 0423
  v_remain   numeric;                                                                      -- 0423
  v_exc      boolean   := false;                                                           -- 0423
  v_plan_by  uuid;                                                                         -- 0423
  v_out      numeric;                                                                      -- 0423
  v_legal    jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted','Cancelled'),
    'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',  jsonb_build_array('Paid','Cancelled'),
    'Rejected',  jsonb_build_array('Draft'),
    'Paid',      jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense claim not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (v_legal -> v_row.status::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_row.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;
  if v_row.imprest_float_id is not null then                                               -- 0423
    select * into v_float from public.imprest_floats where id = v_row.imprest_float_id;    -- 0423
    v_tz := coalesce((select o.default_timezone from public.organizations o                -- 0423
                       where o.id = v_row.org_id), 'UTC');                                 -- 0423
  end if;                                                                                  -- 0423

  -- SoD (DD-EXP-3), for every actor including an Admin (the OD-PROC-8 shape).
  if v_row.status = 'Submitted' and p_to in ('Approved','Rejected') and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot approve or reject their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot pay their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.approved_by_id then
    raise exception 'separation of duties: the approver cannot also pay this expense claim' using errcode = '42501';
  end if;
  -- 0423 DD-IMP-7.1: only the custodian pays a float record, so the custodian never decides one.
  if v_row.imprest_float_id is not null and v_row.status = 'Submitted'                      -- 0423
     and p_to in ('Approved','Rejected') and v_uid = v_float.custodian_id then               -- 0423
    raise exception 'separation of duties: the float''s custodian pays this record and cannot also decide it'  -- 0423
      using errcode = '42501';                                                               -- 0423
  end if;                                                                                  -- 0423

  if p_to = 'Submitted' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can submit this expense claim' using errcode = '42501';
    end if;
    if v_row.kind = 'claim' then
      select count(*) into v_lines from public.expense_claim_lines l where l.claim_id = p_id;
      if v_lines = 0 then
        raise exception 'an expense claim needs at least one line before it can be submitted' using errcode = 'P0001';
      end if;
    end if;
    if not (v_row.amount > 0) then
      raise exception 'the amount must be greater than zero before submitting' using errcode = 'P0001';
    end if;
    if v_row.imprest_float_id is not null then                                             -- 0423
      select s.procurement_limit into v_limit from public.org_imprest_settings s           -- 0423
       where s.org_id = v_row.org_id;                                                      -- 0423
      if v_limit is null or v_row.amount > v_limit then                                    -- 0423 DD-IMP-5, fail closed
        raise exception 'this is above the procurement limit of % for site cash: raise it as a procurement request instead',  -- 0423
          coalesce(v_limit::text, '(unset)') using errcode = 'P0001';                      -- 0423
      end if;                                                                              -- 0423
      if v_row.kind = 'claim' and not exists (select 1 from public.expense_claim_files f   -- 0423 OQ-IMP-4
                    where f.claim_id = p_id and f.archived_at is null) then                -- 0423
        raise exception 'a claim paid from site cash needs at least one receipt attached' using errcode = 'P0001';  -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
  elsif v_row.status = 'Rejected' and p_to = 'Draft' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can send a rejected expense claim back to Draft' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not ((v_row.status in ('Draft','Submitted') and v_uid = v_row.claimant_id) or v_is_admin or v_role = 'Finance') then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- #803 routing, called — never copied (ADR-0075 §3). Same lock key as transition_procurement (0243 §7) so a
    -- claim and a purchase request on one line serialize (FR-EXP-022). Classification runs AFTER the lock is held.
    if v_row.project_id is not null and v_row.budget_category is not null then
      perform pg_advisory_xact_lock(
        hashtextextended('spend-line:' || v_row.project_id::text || ':' || v_row.budget_category::text, 0));
    end if;
    select * into v_route
      from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category, v_row.amount,
                                       v_row.currency, v_row.claimant_id, v_uid, v_row.submitted_at);
    -- 0423 FR-IMP-024: under the float lock (after the line lock, plan delta 5), an item that does not fit the month's
    -- remaining is an exception routed to the senior set only; the plan's own approver is excluded.
    if v_row.imprest_float_id is not null then                                             -- 0423
      perform public.imprest_lock_float(v_row.imprest_float_id);                           -- 0423
      v_remain := public.imprest_remaining(v_row.imprest_float_id, v_row.imprest_month,    -- 0423
                                           v_row.budget_category);                         -- 0423
      v_exc := v_row.amount > v_remain;                                                    -- 0423
      if v_exc then                                                                        -- 0423
        select p.approved_by into v_plan_by from public.imprest_plans p                    -- 0423
         where p.float_id = v_row.imprest_float_id and p.month = v_row.imprest_month       -- 0423
           and p.status = 'Approved';                                                      -- 0423
        if v_uid = v_plan_by then                                                          -- 0423
          raise exception 'separation of duties: the approver of this month''s plan cannot decide an out-of-plan item'  -- 0423
            using errcode = '42501';                                                       -- 0423
        end if;                                                                            -- 0423
        select r.route, r.approver_ids, v_route.reason, v_route.line_budget, v_route.line_used  -- 0423
          into v_route                                                                     -- 0423
          from public.imprest_senior_route(v_row.org_id, v_row.claimant_id) r;             -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
    -- coalesce: a NULL route must refuse, never pass (DD-APR-5).
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason
          using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown')
        using errcode = '42501';
    end if;
    -- The flat floor still applies to everyone but an Admin (named approvers hold this rank by construction).
    if not v_is_admin and not public.holds_spend_approval_authority(v_role) then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    perform public.log_audit('expense_claim.approval_route', v_row.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_row.amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_row.budget_category::text,
        'plan_exception', v_exc,                                                           -- 0423
        'plan_shortfall', case when v_exc then v_row.amount - v_remain end,                -- 0423
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  elsif p_to = 'Paid' then
    if v_row.imprest_float_id is null                                                      -- 0423 off-float: FR-EXP-024 unchanged
       and not (v_is_admin or v_role = 'Finance') then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    -- 0423 DD-IMP-7: a float record is paid by its custodian alone, still eligible, whatever their role.
    if v_row.imprest_float_id is not null and (v_uid is distinct from v_float.custodian_id   -- 0423
       or not public.imprest_custodian_eligible(v_row.org_id, v_float.project_id, v_uid)) then  -- 0423
      raise exception 'only this site float''s custodian pays a record charged to it' using errcode = '42501';  -- 0423
    end if;                                                                                -- 0423
    v_today := (now() at time zone coalesce(
                 (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date;
    if v_row.advance_id is not null then
      -- Lock order is always claim → advance; record_expense_advance_return locks only the advance.
      select * into v_adv from public.expense_claims where id = v_row.advance_id for update;
      if v_adv.status is distinct from 'Paid' or v_adv.claimant_id is distinct from v_row.claimant_id then
        raise exception 'the linked advance is not a paid advance of this claimant' using errcode = 'P0001';
      end if;
      v_applied := least(v_row.amount, greatest(public.expense_advance_outstanding(v_row.advance_id), 0));
    end if;
    if v_row.imprest_float_id is not null then                                             -- 0423 DD-IMP-3
      perform public.imprest_lock_float(v_row.imprest_float_id);                           -- 0423 (claim → advance → float)
      v_out := case v_row.kind when 'advance' then v_row.amount else v_row.amount - v_applied end;  -- 0423
      if public.imprest_cash_book(v_row.imprest_float_id) - v_out < 0 then                 -- 0423
        raise exception 'paying % would overdraw the site float (cash on hand %): request a replenishment first',  -- 0423
          v_out, public.imprest_cash_book(v_row.imprest_float_id) using errcode = 'P0001'; -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
  end if;

  update public.expense_claims set
    status            = p_to,
    claim_number      = case when p_to = 'Submitted'
                             then coalesce(claim_number, public.next_procurement_doc_number(org_id,
                                    case kind when 'advance' then 'ADV' else 'EXP' end))
                             else claim_number end,
    submitted_at      = case when p_to = 'Submitted' then now() else submitted_at end,
    imprest_month     = case when p_to = 'Submitted' and imprest_float_id is not null         -- 0423 OQ-IMP-8
                             then date_trunc('month', now() at time zone v_tz)::date          -- 0423
                             when p_to = 'Draft' then null else imprest_month end,            -- 0423
    is_plan_exception = case when p_to = 'Approved' then v_exc                                -- 0423
                             when p_to = 'Draft' then false else is_plan_exception end,       -- 0423
    approved_by_id    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by_id end,
    approved_at       = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    approval_notes    = case when p_to = 'Approved' then p_notes else approval_notes end,
    rejection_notes   = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    paid_by_id        = case when p_to = 'Paid' then v_uid else paid_by_id end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then v_today else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    advance_applied   = case when p_to = 'Paid' then v_applied else advance_applied end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;

  perform public.log_audit('expense_claim.transition', v_row.org_id, v_uid, p_id,
    jsonb_build_object('from', v_row.status::text, 'to', p_to::text, 'notes', p_notes, 'advance_applied', v_applied));
end; $$;
revoke all on function public.transition_expense_claim(uuid, public.expense_claim_status, text, text) from public, anon;
grant execute on function public.transition_expense_claim(uuid, public.expense_claim_status, text, text) to authenticated;
```

⚑ Three things a reviewer must check here, each tied to a primer bucket:
- **Duplicate money (1):** the overdraw check reads `imprest_cash_book` **after** `imprest_lock_float`, and every other
  writer of the float's cash (return, replenishment pay) takes the same lock, so two payments cannot both pass on the
  same cash.
- **SoD (3):** the custodian refusal sits **outside** any Admin skip, next to the DD-EXP-3 checks.
- **Fail closed (invariants):** an unset limit refuses (`v_limit is null`), a NULL route refuses, a lost eligibility
  refuses.
- The re-created function must keep `expense_claims_line_lock`, `expense_claims_transition` and
  `expense_claims_routing` pgTAP green unchanged: run them in the gate.

### S2.5 `record_expense_advance_return` (FR-IMP-027)

Re-create from 0270 §1 with these marked changes only (the rest verbatim):

```sql
-- in declare:
  v_float public.imprest_floats%rowtype;                                                   -- 0423
-- replace the role check
--   if v_role is distinct from 'Finance' and v_role is distinct from 'Admin' then ... end if;
-- with:
  if v_row.imprest_float_id is not null then                                               -- 0423
    select * into v_float from public.imprest_floats where id = v_row.imprest_float_id;    -- 0423
    perform public.imprest_lock_float(v_row.imprest_float_id);                             -- 0423 (advance → float)
  end if;                                                                                  -- 0423
  if v_role is distinct from 'Finance' and v_role is distinct from 'Admin'
     and not (v_row.imprest_float_id is not null and v_uid = v_float.custodian_id          -- 0423 FR-IMP-027
              and public.imprest_custodian_eligible(v_row.org_id, v_float.project_id, v_uid)) then  -- 0423
    raise exception 'only Finance, an Admin or the float''s custodian records an advance return' using errcode = '42501';  -- 0423 (text widened)
  end if;
```

The claimant refusal stays above it, unchanged. `0270_expense_advance_returns.test.sql` asserts the old message text
`only Finance or an Admin records an advance return`; grep it first: if a test matches that text, keep the **old message
for the off-float branch** by splitting the raise (off-float -> old text; float -> new text) rather than editing the test.

### S2.6 Routing tests (AC-IMP-022..025) and the line lock (AC-IMP-026)

Append to `imprest_routing.test.sql`. Fixture additions, as superuser before `set local role` (`M` below is
`date_trunc('month', now() at time zone 'Asia/Jakarta')::date`, the current org-timezone month):

1. A second senior approver: user/profile `…a8` (`imp-exec2@example.com`, Executive) and `spend_approvers (org, null, …a8)`.
2. P1 gets an active budget (`Vehicle` 100,000,000; `budget_versions` + `budget_line_items`, column lists as in
   `expense_claims_routing.test.sql`) and a project approver row `spend_approvers (org, P1, PM1)`, so in-plan float
   items on P1 route `project` = PM1.
3. Plan `…150` on float F for month `M`, status `Approved`, `approved_by` = the Executive `…a7`, one line `Vehicle`
   3,000,000.
4. Advance `…204` on F: Eng1, 1,000,000, `Vehicle`, `imprest_month` M, status `Paid`, approved by PM1, paid by Fin1.
5. Claim `…205` on F: Eng1, `Vehicle`, `imprest_month` M, `advance_id` `…204`: insert as `Draft`, add one line of
   1,500,000, then `update ... set status = 'Approved', approved_by_id = PM1, claim_number = 'EXP-2611010205'`.
6. Claims `…211` (400,000) and `…212` (700,000) on F, and `…213` (300,000) on float G: each inserted `Draft` with one
   line and one receipt row, then updated to `Submitted` with `submitted_at = now()`, `imprest_month = M`, a claim number.

```sql
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is(imprest_drawn('15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 'Vehicle'),
  2500000::numeric, 'AC-IMP-022 drawn = approved claim 1,500,000 + advance outstanding 1,000,000');
select is(imprest_remaining('15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 'Vehicle'),
  500000::numeric, 'AC-IMP-023 remaining = planned − drawn');
reset role;  -- settle the advance in full (the transition path itself is AC-IMP-031's)
update expense_claims set status = 'Paid', advance_applied = 1000000, paid_by_id = '15150000-0000-0000-0000-0000000000a2',
       paid_at = now(), paid_on = current_date where id = '15150000-0000-0000-0000-000000000205';
update imprest_plan_lines set planned_amount = 2000000 where plan_id = '15150000-0000-0000-0000-000000000150'; -- remaining back to 500,000
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is(imprest_drawn('15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 'Vehicle'),
  1500000::numeric, 'AC-IMP-022 once the claim settles the advance in full, drawn is 1,500,000: nothing counts twice');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000211', 'Approved') $$,
  'AC-IMP-023 an in-plan 400,000 claim is approved by the routed project approver');
select ok(not (select is_plan_exception from expense_claims where id = '15150000-0000-0000-0000-000000000211'),
  'AC-IMP-023 an in-plan item is not an exception');
select is((select line_used from spend_approval_route('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1',
             'Vehicle', 1, 'IDR', '15150000-0000-0000-0000-0000000000a6', null, null)), 1900000::numeric,
  'AC-IMP-014 float claims count in the line used amount once approved (1,500,000 + 400,000); the plan does not');
reset role;
update imprest_plan_lines set planned_amount = 2400000 where plan_id = '15150000-0000-0000-0000-000000000150'; -- remaining 500,000 again
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000212', 'Approved') $$,
  '42501', null, 'AC-IMP-023 an out-of-plan 700,000 claim cannot be approved by the project approver');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000212', 'Approved') $$,
  '%approver of this month''s plan%', 'AC-IMP-024 the approver of the month''s plan cannot approve an exception');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a8');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000212', 'Approved') $$,
  'AC-IMP-023 a senior approver who did not approve the plan approves the exception');
select ok((select is_plan_exception from expense_claims where id = '15150000-0000-0000-0000-000000000212'),
  'AC-IMP-023 the item is stamped as a plan exception');
select is((select (detail->>'plan_shortfall')::numeric from audit_events
            where entity_id = '15150000-0000-0000-0000-000000000212' and action = 'expense_claim.approval_route'
              and (detail->>'plan_exception')::boolean), 200000::numeric,
  'AC-IMP-023 the audit row carries plan_exception = true and the shortfall 200,000');
reset role;
delete from spend_approvers where org_id = '15150000-0000-0000-0000-00000000000a' and project_id is null;  -- no senior set
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000213', 'Approved') $$,
  'AC-IMP-024 with no senior set, an Admin who did not approve the plan approves the exception');
select ok((select is_plan_exception from expense_claims where id = '15150000-0000-0000-0000-000000000213'),
  'AC-IMP-025 a float record in a month with no approved plan is an exception (remaining 0)');
```

`…213` is on float G (custodian PM2), so the Admin is not refused by DD-IMP-7.1; G has no plan for M, so
`v_plan_by` is null and nobody is excluded as plan approver.

**Mutation checks:** change `v_exc := v_row.amount > v_remain` to `false` -> AC-IMP-023's refusal goes red; drop the
plan-approver refusal -> AC-IMP-024 goes red.

Create `supabase/tests/imprest_line_lock.test.sql` (new): copy `expense_claims_line_lock.test.sql`'s dblink idiom
verbatim, with F1 + one Submitted float claim on F, P1/`Vehicle`, approver PM1 routed `project`; the second session
holds `hashtextextended('spend-line:15150000-0000-0000-0000-0000000000c1:Vehicle', 0)`; under `lock_timeout = '200ms'`
the approval throws `55P03` (`AC-IMP-026 an exception approval waits for the spend-line lock`); after
`dblink_exec('...','commit')` the approval `lives_ok` (`AC-IMP-026 once released, it succeeds`). `plan(3)`.

### S2.7 Cash tests (AC-IMP-030..034)

Create `supabase/tests/imprest_cash.test.sql` (new) = F1 + F2 + the S2.6 project-approver fixture, plus as superuser
Approved float records (approved by PM1 unless stated; each with `imprest_month` this month, `budget_category 'Vehicle'`):

| id | kind | float | claimant | amount | note |
|---|---|---|---|---|---|
| `…301` | advance | F | Eng1 | 1,000,000 | AC-IMP-030 |
| `…302` | advance | F | Eng1 | 800,000 | AC-IMP-030 |
| `…303` | claim | F | Eng1 | 500,000 | AC-IMP-032 |
| `…304` | advance | G | Eng1 | 600,000 | AC-IMP-033 (custodian PM2) |
| `…305` | claim | none | Eng1 | 100,000 | AC-IMP-034 off-float |

and, to set float F's `cash_book` to 800,000 before AC-IMP-030, a Paid float advance `…300` of 9,200,000 by Eng1 on F.

```sql
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');  -- Fin1 = F's custodian
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d1'), 800000::numeric, 'AC-IMP-030 (setup) cash on hand is 800,000');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000301', 'Paid') $$,
  '%overdraw%', 'AC-IMP-030 paying 1,000,000 from 800,000 is refused');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000302', 'Paid') $$,
  'AC-IMP-030 paying 800,000 succeeds');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d1'), 0::numeric, 'AC-IMP-030 cash on hand is 0, never negative');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2, not the custodian
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000303', 'Paid') $$,
  '42501', null, 'AC-IMP-032 a Finance user who is not the custodian cannot pay a float record');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000303', 'Paid') $$,
  '42501', null, 'AC-IMP-032 nor can an Admin who is not the custodian');
```

AC-IMP-032's custodian-approve half needs a Submitted float claim `…306` (claimant Eng1, float F):

```sql
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000306', 'Approved') $$,
  '%custodian pays this record%', 'AC-IMP-032 the custodian cannot approve a record charged to their float');
```

AC-IMP-031 (identity arithmetic) uses float G (custodian PM2, funded 5,000,000): Paid advance `…310` 1,000,000; a return
of 300,000 recorded through `record_expense_advance_return` by PM2; a Paid claim `…311` of 500,000 that settled 200,000
of `…310` (superuser insert with `advance_applied` 200,000):

```sql
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2 = G's custodian
select lives_ok($$ select record_expense_advance_return('15150000-0000-0000-0000-000000000310', 300000, 'cash back') $$,
  'AC-IMP-033 the PM custodian records a return on a float advance');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d2'), (5000000 - 1000000 + 300000 - 300000)::numeric,
  'AC-IMP-031 cash_book = funding − advance + return − the claim''s cash part');
select is(imprest_advances_out('15150000-0000-0000-0000-0000000000d2'), 500000::numeric, 'AC-IMP-031 advances out = 500,000');
select is(imprest_receipts_waiting('15150000-0000-0000-0000-0000000000d2'), 500000::numeric, 'AC-IMP-031 receipts waiting = 500,000');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d2') + imprest_advances_out('15150000-0000-0000-0000-0000000000d2')
          + imprest_receipts_waiting('15150000-0000-0000-0000-0000000000d2'), imprest_funded('15150000-0000-0000-0000-0000000000d2'),
  'AC-IMP-031 DD-IMP-2 identity holds');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000304', 'Paid') $$,
  'AC-IMP-033 the PM custodian pays an advance from their own float');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d2'), (4000000 - 600000)::numeric,
  'AC-IMP-033 cash_book falls by the advance');
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000303', 'Paid') $$,
  '42501', null, 'AC-IMP-033 the PM custodian cannot pay a record on another float');
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000305', 'Paid') $$,
  '42501', null, 'AC-IMP-034 FR-EXP-024 unchanged off-float: a PM cannot pay a record with no float');
select throws_ok($$ insert into expense_claims (kind, title, project_id, budget_category, imprest_float_id)
  values ('advance', 'own float', '15150000-0000-0000-0000-0000000000c2', 'Vehicle', '15150000-0000-0000-0000-0000000000d2') $$,
  '23514', null, 'AC-IMP-034 a custodian cannot charge their own record to their own float');
reset role;
update projects set project_manager_id = '15150000-0000-0000-0000-0000000000a4' where id = '15150000-0000-0000-0000-0000000000c2';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2 no longer manages P2
select throws_ok($$ select record_expense_advance_return('15150000-0000-0000-0000-000000000310', 1, null) $$,
  '42501', null, 'AC-IMP-033 a custodian who stopped managing the project cannot record a return');
```

(The replenishment-request half of the AC-IMP-033 reassignment case is in S2.9.) The `insert` above sets no amount: an
advance's amount defaults to 0, which the origination guard accepts; the float trigger refuses first.

**Mutation checks (record each in the PR body):** (a) replace the custodian pay predicate with `false` -> AC-IMP-033 pay
goes red; replace it with `true` -> AC-IMP-032 goes red. (b) Change `- v_out < 0` to `- v_out < -1000000` -> AC-IMP-030
goes red. (c) Drop the custodian decide refusal -> AC-IMP-032's approve assertion goes red.

### S2.8 Replenishment and funding RPCs (FR-IMP-004, 050-054)

```sql
-- §5 replenishment and funding. The client sends the float (and the kind) only, never an amount or claims (FR-IMP-050).
create or replace function public.request_imprest_replenishment(p_float uuid, p_kind text default 'replenishment')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_id uuid; v_amount numeric; v_gap numeric;
begin
  perform public.assert_is_active_member();
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  if v_uid is distinct from v_f.custodian_id or not public.imprest_custodian_eligible(v_f.org_id, v_f.project_id, v_uid) then
    raise exception 'only this site float''s custodian requests its cash' using errcode = '42501';
  end if;
  if p_kind not in ('replenishment','funding') then
    raise exception 'unknown request kind %', p_kind using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(p_float);
  if p_kind = 'funding' then
    if exists (select 1 from public.imprest_replenishments r where r.float_id = p_float and r.kind = 'funding'
                 and r.status in ('Requested','Approved')) then
      raise exception 'a funding request for this float is already open' using errcode = 'P0001';
    end if;
    v_gap := v_f.float_amount - (public.imprest_cash_book(p_float) + public.imprest_advances_out(p_float)
                                 + public.imprest_receipts_waiting(p_float));
    if not (v_gap > 0) then
      raise exception 'this float is fully funded' using errcode = 'P0001';
    end if;
    v_amount := v_gap;
  else
    select coalesce(sum(c.amount), 0) into v_amount from public.expense_claims c
     where c.imprest_float_id = p_float and c.kind = 'claim' and c.status = 'Paid' and c.imprest_replenishment_id is null;
    if not (v_amount > 0) then
      raise exception 'there are no settled receipts waiting to be replenished' using errcode = 'P0001';
    end if;
  end if;
  insert into public.imprest_replenishments (org_id, float_id, kind, number, amount, requested_by)
  values (v_f.org_id, p_float, p_kind, public.next_procurement_doc_number(v_f.org_id, 'REP'), v_amount, v_uid)
  returning id into v_id;
  if p_kind = 'replenishment' then
    update public.expense_claims set imprest_replenishment_id = v_id
     where imprest_float_id = p_float and kind = 'claim' and status = 'Paid' and imprest_replenishment_id is null;
  end if;
  perform public.log_audit('imprest_replenishment.requested', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'kind', p_kind, 'amount', v_amount));
  return v_id;
end; $$;
revoke all on function public.request_imprest_replenishment(uuid, text) from public, anon;
grant execute on function public.request_imprest_replenishment(uuid, text) to authenticated;

create or replace function public.transition_imprest_replenishment(p_id uuid, p_to text, p_notes text default null,
                                                                   p_payment_reference text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_r   public.imprest_replenishments%rowtype;
  v_f   public.imprest_floats%rowtype;
  v_uid uuid := auth.uid();
  v_fin boolean := public.auth_role() in ('Finance','Admin');
  v_tz  text;
  v_legal jsonb := jsonb_build_object('Requested', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved', jsonb_build_array('Paid','Cancelled'), 'Paid', jsonb_build_array(), 'Rejected', jsonb_build_array(),
    'Cancelled', jsonb_build_array());
begin
  perform public.assert_is_active_member();
  select * into v_r from public.imprest_replenishments where id = p_id for update;
  if not found or v_r.org_id is distinct from public.auth_org_id() then
    raise exception 'replenishment not found' using errcode = 'P0002';
  end if;
  if not (v_legal -> v_r.status) ? p_to then
    raise exception 'illegal transition % -> %', v_r.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;
  select * into v_f from public.imprest_floats where id = v_r.float_id;
  perform public.imprest_lock_float(v_r.float_id);
  -- SoD (FR-IMP-052/053), for every caller including an Admin: site finance never tops up its own float.
  if p_to in ('Approved','Rejected','Paid') and (v_uid = v_f.custodian_id or v_uid = v_r.requested_by) then
    raise exception 'separation of duties: the custodian or requester cannot % this request', lower(p_to) using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_r.approved_by then
    raise exception 'separation of duties: the approver cannot also pay this request' using errcode = '42501';
  end if;
  if p_to in ('Approved','Rejected','Paid') and not v_fin then
    raise exception 'only Finance or an Admin decides or pays a replenishment' using errcode = '42501';
  end if;
  if p_to = 'Cancelled' and not (v_fin or (v_r.status = 'Requested' and v_uid = v_r.requested_by)) then
    raise exception 'not authorized to cancel this request' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_r.kind = 'funding'                                                -- FR-IMP-054 (plan delta 3)
     and public.imprest_cash_book(v_r.float_id) + public.imprest_advances_out(v_r.float_id)
         + public.imprest_receipts_waiting(v_r.float_id) + v_r.amount > v_f.float_amount then
    raise exception 'paying this funding would take the float above its fixed amount' using errcode = 'P0001';
  end if;
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = v_r.org_id), 'UTC');
  update public.imprest_replenishments set
    status            = p_to,
    approved_by       = case when p_to = 'Approved' then v_uid else approved_by end,
    approved_at       = case when p_to = 'Approved' then now() else approved_at end,
    decided_notes     = case when p_to in ('Approved','Rejected') then nullif(btrim(p_notes), '') else decided_notes end,
    paid_by           = case when p_to = 'Paid' then v_uid else paid_by end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then (now() at time zone v_tz)::date else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;
  if p_to in ('Rejected','Cancelled') then                                                 -- FR-IMP-051: release
    update public.expense_claims set imprest_replenishment_id = null where imprest_replenishment_id = p_id;
  end if;
  perform public.log_audit('imprest_replenishment.transition', v_r.org_id, v_uid, p_id,
    jsonb_build_object('from', v_r.status, 'to', p_to, 'kind', v_r.kind, 'amount', v_r.amount, 'notes', p_notes));
end; $$;
revoke all on function public.transition_imprest_replenishment(uuid, text, text, text) from public, anon;
grant execute on function public.transition_imprest_replenishment(uuid, text, text, text) to authenticated;
```

⚑ The claims update in `request_imprest_replenishment` runs as the definer owner, so `assert_expense_claim_update`'s
`actor_bypasses_rls()` exemption admits it on Paid rows (0247 §2). `imprest_replenishment_id` has no client grant.

### S2.9 Replenishment tests (AC-IMP-003, 040-043, 045, 046, and AC-IMP-033's request half)

Create `supabase/tests/imprest_replenishment.test.sql` (new) = F1 + F2 + the S2.7 approver fixture, plus as superuser
three Paid float claims on F by Eng1 (`…401` 400,000, `…402` 250,000, `…403` 150,000; each `advance_applied` 0,
`paid_by_id` Fin1) and one Approved float claim `…404` (unpaid), and a third float H (`…d3`, P3, custodian Fin2,
`float_amount` 10,000,000, **no** funding):

```sql
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2 = H's custodian
select is((select float_amount - (imprest_cash_book(id) + imprest_advances_out(id) + imprest_receipts_waiting(id))
             from imprest_floats where id = '15150000-0000-0000-0000-0000000000d3'), 10000000::numeric,
  'AC-IMP-003 an unfunded float''s gap is its amount');
select is((select amount from imprest_replenishments where id = request_imprest_replenishment('15150000-0000-0000-0000-0000000000d3', 'funding')),
  10000000::numeric, 'AC-IMP-003 the funding amount is the gap, set by the server');
select throws_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d3', 'funding') $$,
  'P0001', null, 'AC-IMP-003 a second open funding is refused');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');  -- Fin1 = F's custodian
select is((select amount from imprest_replenishments where id = request_imprest_replenishment('15150000-0000-0000-0000-0000000000d1')),
  800000::numeric, 'AC-IMP-040 the replenishment amount is the sum of the Paid claims');
select is((select count(*)::int from expense_claims where imprest_replenishment_id is not null
             and id in ('15150000-0000-0000-0000-000000000401', '15150000-0000-0000-0000-000000000402', '15150000-0000-0000-0000-000000000403')),
  3, 'AC-IMP-040 exactly the three Paid claims carry its id');
select ok((select imprest_replenishment_id is null from expense_claims where id = '15150000-0000-0000-0000-000000000404'),
  'AC-IMP-040 the unpaid claim does not');
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Requested'), 'Approved') $$,
  '42501', null, 'AC-IMP-041 the custodian (and requester) cannot approve');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select lives_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Requested'), 'Approved') $$,
  'AC-IMP-041 a Finance user other than the custodian approves');
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Approved'), 'Paid', null, 'TRF-7') $$,
  '42501', null, 'AC-IMP-042 the approver cannot pay');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Approved'), 'Paid', null, 'TRF-7') $$,
  '42501', null, 'AC-IMP-042 the custodian cannot pay');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');  -- Admin = "F2" of the spec's example
select lives_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Approved'), 'Paid', null, 'TRF-7') $$,
  'AC-IMP-042 a third Finance-or-Admin user pays with a reference');
select is((select payment_reference from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Paid'
             and kind = 'replenishment'), 'TRF-7', 'AC-IMP-042 the reference is stamped');
select is(imprest_receipts_waiting('15150000-0000-0000-0000-0000000000d1'), 0::numeric, 'AC-IMP-042 receipts waiting fell by 800,000');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d1'), (10000000 - 800000 + 800000)::numeric,
  'AC-IMP-042 cash on hand rose by 800,000');
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and kind = 'replenishment'), 'Cancelled') $$,
  'P0001', null, 'AC-IMP-043 a Paid replenishment cannot move');
```

AC-IMP-043 release: a fourth Paid claim `…405` (100,000) is added by superuser after the payment; Fin1 requests (it joins
the new request), Fin2 rejects it, then `…405.imprest_replenishment_id is null`, then Fin1 requests again and `…405`
carries the newest id (`AC-IMP-043 a rejected request releases its claims; they join a new request`).

AC-IMP-046: H's funding (requested by Fin2 above) is approved by Fin1 (neither custodian nor requester); then, as
superuser, H's `float_amount` is lowered to 9,000,000 (a float change landing after the request); then the Admin's pay
throws P0001 `'%above its fixed amount%'` (`AC-IMP-046 a funding that would take the float above its amount is refused`).

AC-IMP-033 request half: as superuser, set P2's `project_manager_id` to PM1; then PM2 calling
`request_imprest_replenishment('15150000-0000-0000-0000-0000000000d2')` throws 42501 (`AC-IMP-033 a custodian who
stopped managing the project cannot request a replenishment`).

AC-IMP-045 (concurrent requests): copy the dblink idiom; the second session holds
`hashtextextended('imprest-float:15150000-0000-0000-0000-0000000000d1', 0)`; under `lock_timeout = '200ms'` Fin1's
request throws `55P03` (`AC-IMP-045 a replenishment request waits for the float lock, so two requests cannot both select
a receipt`); release, then two sequential requests: the second refuses with "no settled receipts waiting" while every
Paid claim carries exactly one replenishment id (`AC-IMP-045 each Paid claim joins exactly one request`).

**Mutation checks:** drop the `v_uid = v_f.custodian_id` arm of the SoD -> AC-IMP-041/042 custodian assertions red; drop
the `approved_by` pay refusal -> AC-IMP-042 approver assertion red.

### S2.10 Property test (AC-IMP-044)

Append to `imprest_replenishment.test.sql`, a fresh float K (`…d4`, P3, custodian Fin1, 10,000,000) funded by superuser
(Paid funding 10,000,000), then:

```sql
create temp table imp_steps (step int, ok boolean) on commit drop;
grant all on imp_steps to authenticated;
do $$
declare i int; v_op int; v_id uuid; v_adv uuid; v_amt numeric; v_k uuid := '15150000-0000-0000-0000-0000000000d4';
begin
  perform setseed(0.1515);
  for i in 1..60 loop
    v_op := floor(random() * 5)::int;
    v_amt := (floor(random() * 40) + 1) * 10000;       -- 10,000 .. 400,000, whole cents
    begin
      if v_op = 0 then                                 -- advance: create, submit, approve (Admin), pay (custodian)
        v_id := gen_random_uuid();
        insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, imprest_float_id)
        values (v_id, '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
                '15150000-0000-0000-0000-0000000000c3', 'Vehicle', 'prop adv', v_amt, 'Draft', v_k);
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Submitted');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Approved');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Paid');
      elsif v_op = 1 then                              -- return part of a random outstanding advance (custodian)
        select a.id into v_adv from expense_claims a where a.imprest_float_id = v_k and a.kind = 'advance' and a.status = 'Paid'
           and expense_advance_outstanding(a.id) > 0 order by random() limit 1;
        if v_adv is not null then
          perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
          perform record_expense_advance_return(v_adv, least(v_amt, expense_advance_outstanding(v_adv)), null);
        end if;
      elsif v_op in (2, 3) then                        -- claim, settling a random advance half the time
        select a.id into v_adv from expense_claims a where a.imprest_float_id = v_k and a.kind = 'advance' and a.status = 'Paid'
           and expense_advance_outstanding(a.id) > 0 and v_op = 3 order by random() limit 1;
        v_id := gen_random_uuid();
        insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, status, imprest_float_id, advance_id)
        values (v_id, '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
                '15150000-0000-0000-0000-0000000000c3', 'Vehicle', 'prop claim', 'Draft', v_k, v_adv);
        insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount)
        values (v_id, current_date, 'Other', 'prop', v_amt);
        insert into expense_claim_files (claim_id, org_id, file_path)
        values (v_id, '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-00000000000a/' || v_id || '/' || gen_random_uuid() || '/r.pdf');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Submitted');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Approved');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Paid');
      else                                             -- replenish: request (custodian), approve (Fin2), pay (Admin)
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
        v_id := request_imprest_replenishment(v_k);
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
        perform transition_imprest_replenishment(v_id, 'Approved');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
        perform transition_imprest_replenishment(v_id, 'Paid', null, 'P-' || i);
      end if;
    exception when sqlstate 'P0001' then
      null;  -- a refused step (overdraw, nothing to replenish, above limit) is a legal outcome; the identity must still hold
    end;
    insert into imp_steps values (i, imprest_cash_book(v_k) + imprest_advances_out(v_k) + imprest_receipts_waiting(v_k)
                                     = imprest_funded(v_k) and imprest_cash_book(v_k) >= 0);
  end loop;
end $$;
select is((select count(*)::int from imp_steps where not ok), 0,
  'AC-IMP-044 over 60 random movements the identity holds at every step and cash never goes negative');
select ok((select count(*) from imp_steps) = 60, 'AC-IMP-044 the property ran all 60 steps');
```

The `do` block runs as the session role; run it **before** `set local role authenticated` (superuser, so the direct
`insert`s pass the origination guard) and rely on `set_config` for `auth.uid()`. `assert_is_active_member` reads the
jwt `sub`, so every transition runs as the stated actor. A `42501` inside the loop is a **bug** and must fail the file:
only `P0001` is swallowed.

**Mutation check:** in `imprest_cash_book`, drop the returns term -> AC-IMP-044 goes red (and AC-IMP-031).

### S2.11 ACL, 0178, denominator

- `imprest_acl.test.sql`: add `public.request_imprest_replenishment(uuid, text)` and
  `public.transition_imprest_replenishment(uuid, text, text, text)` to both arrays; add
  `public.check_expense_claim_float()` to the internals block; bump `plan`.
- 0178: add `('request_imprest_replenishment'), ('transition_imprest_replenishment')`, **99 -> 101**; header note
  `-- ⚑ AMENDED BY 0423 (#1515): two replenishment writers join (+2, count 101). transition_expense_claim and
  record_expense_advance_return were already retained.`
- Denominator: the five derived-figure functions are SECURITY INVOKER (not listed as definers); add
  `check_expense_claim_float()` under `definer_functions`; add both RPCs under `rpcs` (`class: write`).

### S2.12 Closing self-assertion, rollback, gate

Append the 0422-style `do $$ ... $$` block covering the two new RPCs (authenticated yes, anon no), the internal trigger
function (neither), and the five invoker figures (authenticated yes, anon no). Rollback file
`supabase/migrations/rollback/0423_imprest_cash_down.sql`: re-create `record_expense_advance_return` with the 0270 §1 text
and `transition_expense_claim` with the 0247 §7 text (copy them verbatim from those files), then the header's drops.
Gate: the slice gate, with step 2 also running `expense_claims_transition`, `expense_claims_routing`,
`expense_claims_line_lock`, `expense_advances`, `0270_expense_advance_returns` and `0270_expense_postings_enqueue` (the
re-created functions' existing proofs). Commit `feat(imprest): site float charging, custodian payment and replenishment (#1515 S2)`.

---
## S3 - Position, counts, float choices, notifications (`0424_imprest_position.sql`)

Covers AC-IMP-050-052, 062, and completes AC-IMP-060/061. Header lists the reverse (drop the three triggers and their
functions, re-create `notify_expense_claim_transition` from 0247 §10 minus `-- 0424` lines, drop the four functions and
`imprest_cash_counts`).

### S3.1 Failing tests: position and counts (AC-IMP-050, 051)

Create `supabase/tests/imprest_position.test.sql` (new) = F1 + F2 + AC-IMP-031's float-G setup (advance `…310` Paid
1,000,000, a return of 300,000 inserted into `expense_advance_returns` and `returned_amount` 300,000 on `…310`, claim
`…311` Paid 500,000 with `advance_applied` 200,000) plus an Approved replenishment `…e9` on G of 500,000 (kind
`replenishment`, `…311.imprest_replenishment_id = …e9`), all as superuser:

```sql
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is((select row(float_amount, cash_book, advances_out, receipts_waiting, replenishment_in_flight, gap)::text
             from get_imprest_position('15150000-0000-0000-0000-0000000000d2')),
  row(5000000.00, 4000000.00, 500000.00, 500000.00, 500000.00, 0.00)::text,
  'AC-IMP-050 the position returns float, cash, advances out, receipts waiting, in flight and gap 0');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from get_imprest_position('15150000-0000-0000-0000-0000000000d2')), 0,
  'AC-IMP-050 another org gets no rows');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2, G's custodian; book is 4,000,000
select throws_like($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', 3950000, null) $$,
  '%note%', 'AC-IMP-051 a count with a variance and no note is refused');
select lives_ok($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', 3950000, 'one receipt missing') $$,
  'AC-IMP-051 with a note it is recorded');
select is((select row(book_amount, variance)::text from imprest_cash_counts where float_id = '15150000-0000-0000-0000-0000000000d2'),
  row(4000000.00, -50000.00)::text, 'AC-IMP-051 the book figure is frozen and the variance is counted − book');
select ok(exists (select 1 from audit_events where action = 'imprest_count.recorded'), 'AC-IMP-051 an audit row exists');
select throws_ok($$ update imprest_cash_counts set counted_amount = 1 $$, '42501', null, 'AC-IMP-051 a count cannot be updated');
select throws_ok($$ delete from imprest_cash_counts $$, '42501', null, 'AC-IMP-051 a count cannot be deleted');
```

Spec delta: AC-IMP-050 says "the setup of AC-IMP-031 plus an Approved replenishment of 800,000", but that setup has only
500,000 of receipts waiting, and a replenishment's amount is the receipts it takes (FR-IMP-050), so it can only be
500,000. The test uses 500,000; the asserted property (in flight shown, gap 0, other org no rows) is the spec's.

### S3.2 Counts table and `record_imprest_count`

```sql
create table public.imprest_cash_counts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id),
  float_id       uuid not null references public.imprest_floats(id),
  counted_amount numeric(14,2) not null,
  book_amount    numeric(14,2) not null,
  variance       numeric(14,2) not null,
  note           text,
  counted_by     uuid not null references public.profiles(id),
  counted_at     timestamptz not null default now(),
  constraint imprest_cash_counts_counted_range check (counted_amount >= 0 and counted_amount < 'Infinity'::numeric),
  constraint imprest_cash_counts_variance_math check (variance = counted_amount - book_amount),
  constraint imprest_cash_counts_note_on_variance check (variance = 0 or btrim(coalesce(note, '')) <> '')
);
create index imprest_cash_counts_float_idx on public.imprest_cash_counts (float_id, counted_at desc);
alter table public.imprest_cash_counts enable row level security;
alter table public.imprest_cash_counts force  row level security;
create policy imprest_cash_counts_select on public.imprest_cash_counts for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_floats f where f.id = imprest_cash_counts.float_id));
revoke all on public.imprest_cash_counts from public, anon, authenticated;
grant select on public.imprest_cash_counts to authenticated;
-- append-only for every writer, service role included (FR-IMP-062)
create or replace function public.refuse_imprest_count_change() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a cash count is append-only' using errcode = '42501';
end; $$;
revoke all on function public.refuse_imprest_count_change() from public, anon, authenticated;
create trigger imprest_cash_counts_append_only before update or delete on public.imprest_cash_counts
  for each row execute function public.refuse_imprest_count_change();

create or replace function public.record_imprest_count(p_float uuid, p_counted numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_book numeric; v_id uuid;
begin
  perform public.assert_is_active_member();
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  if not (public.auth_role() in ('Finance','Admin')
          or (v_uid = v_f.custodian_id and public.imprest_custodian_eligible(v_f.org_id, v_f.project_id, v_uid))) then
    raise exception 'only the custodian, Finance or an Admin records a cash count' using errcode = '42501';
  end if;
  if p_counted is null or not (p_counted >= 0 and p_counted < 'Infinity'::numeric) then
    raise exception 'a counted amount must be zero or more' using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(p_float);
  v_book := public.imprest_cash_book(p_float);
  if round(p_counted, 2) <> v_book and btrim(coalesce(p_note, '')) = '' then
    raise exception 'the count differs from the book by %: add a note', round(p_counted, 2) - v_book using errcode = 'P0001';
  end if;
  insert into public.imprest_cash_counts (org_id, float_id, counted_amount, book_amount, variance, note, counted_by)
  values (v_f.org_id, p_float, round(p_counted, 2), v_book, round(p_counted, 2) - v_book, nullif(btrim(p_note), ''), v_uid)
  returning id into v_id;
  perform public.log_audit('imprest_count.recorded', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'counted', round(p_counted, 2), 'book', v_book, 'variance', round(p_counted, 2) - v_book));
  return v_id;
end; $$;
revoke all on function public.record_imprest_count(uuid, numeric, text) from public, anon;
grant execute on function public.record_imprest_count(uuid, numeric, text) to authenticated;
```

### S3.3 Position and plan-usage reads (FR-IMP-060/061, NFR-IMP-006)

```sql
-- SECURITY INVOKER: a float the caller cannot see yields no row (AC-IMP-050). One row per call, never paged.
create or replace function public.get_imprest_position(p_float uuid)
returns table (float_id uuid, float_amount numeric, cash_book numeric, advances_out numeric, receipts_waiting numeric,
               replenishment_in_flight numeric, gap numeric, last_count_at timestamptz, last_count_variance numeric,
               month date, plan_lines jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  with f as (select fl.*, date_trunc('month', now() at time zone coalesce(o.default_timezone, 'UTC'))::date as m
               from public.imprest_floats fl join public.organizations o on o.id = fl.org_id where fl.id = p_float),
       n as (select public.imprest_cash_book(p_float) cb, public.imprest_advances_out(p_float) ao,
                    public.imprest_receipts_waiting(p_float) rw)
  select f.id, f.float_amount, n.cb, n.ao, n.rw,
         coalesce((select sum(r.amount) from public.imprest_replenishments r
                    where r.float_id = p_float and r.status in ('Requested','Approved')), 0),
         f.float_amount - (n.cb + n.ao + n.rw),
         (select c.counted_at from public.imprest_cash_counts c where c.float_id = p_float order by c.counted_at desc limit 1),
         (select c.variance   from public.imprest_cash_counts c where c.float_id = p_float order by c.counted_at desc limit 1),
         f.m,
         (select coalesce(jsonb_agg(u order by u.budget_category), '[]'::jsonb)
            from public.get_imprest_plan_usage(p_float, f.m) u)
    from f, n
$$;

create or replace function public.get_imprest_plan_usage(p_float uuid, p_month date)
returns table (budget_category public.budget_category, planned numeric, drawn numeric, remaining numeric, exceptions jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  with cats as (
    select l.budget_category, l.planned_amount from public.imprest_plans p join public.imprest_plan_lines l on l.plan_id = p.id
     where p.float_id = p_float and p.month = p_month and p.status = 'Approved'
    union
    select c.budget_category, 0 from public.expense_claims c
     where c.imprest_float_id = p_float and c.imprest_month = p_month and c.status in ('Approved','Paid')
       and not exists (select 1 from public.imprest_plans p join public.imprest_plan_lines l on l.plan_id = p.id
                        where p.float_id = p_float and p.month = p_month and p.status = 'Approved'
                          and l.budget_category = c.budget_category))
  select k.budget_category, k.planned_amount, public.imprest_drawn(p_float, p_month, k.budget_category),
         public.imprest_remaining(p_float, p_month, k.budget_category),
         coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'number', c.claim_number, 'kind', c.kind,
                                                       'amount', to_char(c.amount, 'FM999999999990.00'), 'status', c.status)
                                    order by c.submitted_at)
                     from public.expense_claims c
                    where c.imprest_float_id = p_float and c.imprest_month = p_month and c.budget_category = k.budget_category
                      and c.is_plan_exception), '[]'::jsonb)
    from cats k
   where exists (select 1 from public.imprest_floats f where f.id = p_float)
$$;
revoke all on function public.get_imprest_position(uuid), public.get_imprest_plan_usage(uuid, date) from public, anon;
grant execute on function public.get_imprest_position(uuid), public.get_imprest_plan_usage(uuid, date) to authenticated;
```

⚑ `get_imprest_plan_usage` must be created **before** `get_imprest_position` in the file (a SQL function body is
resolved at creation). Order in the migration: usage, then position.

AC-IMP-052, appended to `imprest_position.test.sql` (an Approved plan on G for this month, `Vehicle` 3,000,000, plus one
Approved float claim on G stamped `is_plan_exception = true` in `Vehicle`, as superuser):

```sql
select is((select planned from get_imprest_plan_usage('15150000-0000-0000-0000-0000000000d2',
             date_trunc('month', now() at time zone 'Asia/Jakarta')::date) where budget_category = 'Vehicle'), 3000000::numeric,
  'AC-IMP-052 plan usage lists the category''s planned amount');
select is((select jsonb_array_length(exceptions) from get_imprest_plan_usage('15150000-0000-0000-0000-0000000000d2',
             date_trunc('month', now() at time zone 'Asia/Jakarta')::date) where budget_category = 'Vehicle'), 1,
  'AC-IMP-052 and the exception item, with drawn and remaining beside it');
```

### S3.4 `imprest_float_choices` (PQ-4, FR-IMP-072)

```sql
-- DEFINER, narrow: the expense form's float picker for any active member. Returns only id, custodian name and this
-- month's remaining for the category — never the float amount, cash or other floats' data.
create or replace function public.imprest_float_choices(p_project uuid, p_category public.budget_category default null)
returns table (float_id uuid, custodian_name text, remaining numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, pf.full_name,
         case when p_category is null then null
              else public.imprest_remaining(f.id, date_trunc('month', now() at time zone coalesce(o.default_timezone, 'UTC'))::date,
                                            p_category) end
    from public.imprest_floats f
    join public.profiles pf on pf.id = f.custodian_id
    join public.organizations o on o.id = f.org_id
   where f.project_id = p_project and f.org_id = public.auth_org_id() and f.archived_at is null
     and public.is_active_member() and f.custodian_id is distinct from auth.uid()
   order by pf.full_name
$$;
revoke all on function public.imprest_float_choices(uuid, public.budget_category) from public, anon;
grant execute on function public.imprest_float_choices(uuid, public.budget_category) to authenticated;
```

(`custodian_id is distinct from auth.uid()` hides a custodian's own float from their own form: DD-IMP-7.2.) Test in
`imprest_rls.test.sql`: an Engineer sees **G's** id and remaining via `imprest_float_choices(P2, 'Vehicle')` while
`select count(*) from imprest_floats` stays 0 (`AC-IMP-061 an Engineer picks a float through the narrow chooser and still
reads no float row`); another org's caller gets 0 rows; PM2 calling it for P2 does not see G.

### S3.5 Notifications (FR-IMP-064, PQ-10)

Plans and replenishments, one trigger each:

```sql
create or replace function public.notify_imprest_plan_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_f public.imprest_floats%rowtype; v_label text := coalesce(new.number, 'Site cash plan');
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into v_f from public.imprest_floats where id = new.float_id;
  if new.status = 'Submitted' then
    -- the union of every line's route population, minus the author and the custodian (they cannot decide)
    for r in select distinct p.id from public.profiles p
              cross join lateral (select * from public.imprest_plan_lines l where l.plan_id = new.id) l
              cross join lateral public.spend_approval_route(new.org_id, v_f.project_id, l.budget_category, l.planned_amount,
                                                             v_f.currency, new.author_id, null, new.submitted_at) rt
             where p.org_id = new.org_id and p.id is distinct from new.author_id and p.id is distinct from v_f.custodian_id
               and case coalesce(rt.route, 'admin') when 'flat' then public.holds_spend_approval_authority(p.role)
                                                    when 'admin' then p.role = 'Admin'
                                                    else p.id = any (rt.approver_ids) end
    loop
      perform public.notify_workflow_user(new.org_id, r.id, 'Site cash plan awaiting your approval', v_label, 'info',
                                          'imprest_plan', new.id, v_label);
    end loop;
  elsif new.status in ('Approved','Rejected') then
    perform public.notify_workflow_user(new.org_id, new.author_id, 'Your site cash plan was ' || lower(new.status),
      coalesce(new.decision_notes, v_label), case new.status when 'Approved' then 'info' else 'warning' end,
      'imprest_plan', new.id, v_label);
  end if;
  return new;
end; $$;
revoke all on function public.notify_imprest_plan_transition() from public, anon, authenticated;
create trigger imprest_plans_notify_trg after update of status on public.imprest_plans
  for each row execute function public.notify_imprest_plan_transition();

create or replace function public.notify_imprest_replenishment() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_f public.imprest_floats%rowtype; v_noun text := case new.kind when 'funding' then 'Site float funding' else 'Site cash replenishment' end;
begin
  select * into v_f from public.imprest_floats where id = new.float_id;
  if tg_op = 'INSERT' then
    for r in select p.id from public.profiles p
              where p.org_id = new.org_id and p.role = 'Finance'
                and p.id is distinct from v_f.custodian_id and p.id is distinct from new.requested_by
    loop
      perform public.notify_workflow_user(new.org_id, r.id, v_noun || ' requested', new.number, 'info',
                                          'imprest_replenishment', new.id, new.number);
    end loop;
  elsif new.status is distinct from old.status and new.status in ('Approved','Paid') then
    perform public.notify_workflow_user(new.org_id, v_f.custodian_id, v_noun || ' ' || lower(new.status), new.number, 'info',
                                        'imprest_replenishment', new.id, new.number);
  end if;
  return new;
end; $$;
revoke all on function public.notify_imprest_replenishment() from public, anon, authenticated;
create trigger imprest_replenishments_notify_trg after insert or update of status on public.imprest_replenishments
  for each row execute function public.notify_imprest_replenishment();
```

`notify_expense_claim_transition` is re-created from 0247 §10 with these marked changes (everything else verbatim):

```sql
-- in the Draft → Submitted branch, after the existing loop:
    if new.imprest_float_id is not null                                                     -- 0424 FR-IMP-064
       and new.amount > public.imprest_remaining(new.imprest_float_id, new.imprest_month, new.budget_category) then  -- 0424
      for r in select p.id from public.profiles p cross join lateral                        -- 0424
                 public.imprest_senior_route(new.org_id, new.claimant_id) s                  -- 0424
                where p.org_id = new.org_id and p.id is distinct from new.claimant_id        -- 0424
                  and case s.route when 'org' then p.id = any (s.approver_ids) else p.role = 'Admin' end  -- 0424
      loop                                                                                  -- 0424
        perform public.notify_workflow_user(new.org_id, r.id, 'Out-of-plan site cash item awaiting your approval',  -- 0424
          new.title, 'warning', 'expense_claim', new.id, v_label);                          -- 0424
      end loop;                                                                             -- 0424
    end if;                                                                                 -- 0424
-- in the Submitted → Approved branch, replace the "ready to pay" Finance loop's WHERE with:
              where p.org_id = new.org_id
                and ((new.imprest_float_id is null and p.role = 'Finance')                   -- 0424 PQ-10
                     or p.id = (select f.custodian_id from public.imprest_floats f where f.id = new.imprest_float_id))  -- 0424
                and p.id is distinct from new.claimant_id and p.id is distinct from new.approved_by_id
```

### S3.6 Notification tests (AC-IMP-062)

Create `supabase/tests/imprest_notify.test.sql` (new) = F1 + F2 + a Draft plan by PM1 on F with one `Vehicle` line, a
Draft float claim by Eng1 on F with a line and a receipt (amount 100,000, no plan → out of plan), then:

```sql
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select transition_imprest_plan('15150000-0000-0000-0000-000000000601', 'Submitted');
select is((select array_agg(owner_id order by owner_id) from notifications where metadata->'entity'->>'type' = 'imprest_plan'),
  array['15150000-0000-0000-0000-0000000000a7']::uuid[], 'AC-IMP-062 a submitted plan notifies its routed approvers only, never the author or custodian');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select transition_expense_claim('15150000-0000-0000-0000-000000000602', 'Submitted');
select ok(exists (select 1 from notifications where owner_id = '15150000-0000-0000-0000-0000000000a7'
                    and title = 'Out-of-plan site cash item awaiting your approval'), 'AC-IMP-062 an exception notifies the senior set');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d1', 'funding');  -- F is fully funded → refused
```

The funding refusal above is expected (`throws_ok`, P0001); the replenishment-request notification uses a Paid float
claim seeded on F (as superuser) and asserts the recipients are exactly Fin2 (`…a3`): the custodian Fin1 and the
requester are excluded, and the PM/Engineer are not Finance (`AC-IMP-062 a replenishment request notifies Finance other
than the custodian and requester`). Then Fin2 approves and the custodian Fin1 receives "Site cash replenishment approved"
(`AC-IMP-062 the custodian hears of approval`); for a float record approved by PM1 the "ready to pay" notification goes
to Fin1 only, not Fin2 (`AC-IMP-062 a float record ready to pay notifies only its custodian`). The fixture plan
is `15150000-0000-0000-0000-000000000601`, the claim `…602`.

### S3.7 ACL, 0178, denominator, closing assertion, rollback, gate

- `imprest_acl.test.sql`: add `record_imprest_count`, `get_imprest_position`, `get_imprest_plan_usage`,
  `imprest_float_choices` (authenticated yes, anon no) and the three trigger functions + `refuse_imprest_count_change`
  to the internals block.
- 0178: only `record_imprest_count` is a client-callable **writer** (+1, **101 -> 102**); the reads are not listed.
- Denominator: table `imprest_cash_counts`; definers `record_imprest_count(uuid,numeric,text)`,
  `imprest_float_choices(uuid,budget_category)`, the three notify functions; rpcs `record_imprest_count` (write),
  `imprest_float_choices` as `{"class":"read","expect_denial":[],"shape":"empty-array","source":[...]}` (a
  cross-org caller gets no rows, not a denial).
- Closing `do $$` assertion, `rollback/0424_imprest_position_down.sql`, types, slice gate (also run
  `expense_claims_notify.test.sql`, the re-created notifier's existing proof). Commit
  `feat(imprest): site float position, cash counts and notifications (#1515 S3)`.

---
## S4 - Data layer: DAL, repository, hooks, rules, policy (no migration)

Covers AC-IMP-080, 081, 083, 085, and the float half of the expense action rules. Starts after S3's types are generated.
Sibling harnesses: `pmo-portal/src/lib/db/expenseClaims.test.ts` (DAL), `src/lib/repositories/expenses.test.ts`
(repository), `src/hooks/useExpenseClaims.test.tsx` (hooks), `src/lib/expenses/expenseRules.test.ts` (rules).

### S4.1 Failing test, then `src/lib/imprest/imprestRules.ts` (new) (AC-IMP-081)

`src/lib/imprest/imprestRules.test.ts` (new), titles and oracles:

- `AC-IMP-081 the custodian may request a replenishment and a funding, nobody else may` — custodian (Finance or PM) gets
  `requestReplenishment` (when `receiptsWaiting > 0`) and `requestFunding` (when `gap > 0` and no open funding); a
  non-custodian Finance user gets neither.
- `AC-IMP-081 a Requested replenishment: Finance/Admin who is neither custodian nor requester may approve and reject` —
  custodian, requester, PM and Engineer get none.
- `AC-IMP-081 an Approved replenishment: pay only for Finance/Admin who is not approver, requester or custodian`.
- `AC-IMP-081 plan actions follow transition_imprest_plan` — author: submit (Draft), reopen (Rejected), cancel; approval
  rank not author and not custodian: approve, reject (Submitted).
- `AC-IMP-081 position arithmetic is cent-exact` — `sumCents(['0.10', '0.20'])` is `30`; `gapCents` of float
  `'10000000.00'`, cash `'800000.10'`, advances `'0.20'`, receipts `'9199999.70'` is `0`.
- `AC-IMP-081 the exception hint matches FR-IMP-024` — `isPlanException(amount 700000, remaining 500000)` true;
  `(500000, 500000)` false; remaining `null` (no plan) -> true.

```ts
import type { Role } from '@/src/auth/AuthContext';

/** #1515 — the FE projection of the imprest RPCs (0422-0424). UX ONLY (ADR-0016): the RPCs decide. Money in cents. */
export type ImprestAction =
  | 'requestReplenishment' | 'requestFunding' | 'recordCount'
  | 'approveReplenishment' | 'rejectReplenishment' | 'payReplenishment' | 'cancelReplenishment'
  | 'submitPlan' | 'reopenPlan' | 'cancelPlan' | 'approvePlan' | 'rejectPlan';

const APPROVAL_RANK: readonly Role[] = ['Admin', 'Executive', 'Finance', 'Project Manager'];
const FINANCE_OR_ADMIN: readonly Role[] = ['Admin', 'Finance'];

/** A money string from an RPC (`'1234.50'`) or number to integer cents; never float arithmetic on money. */
export function toCents(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const [whole, frac = ''] = String(v).split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number((frac + '00').slice(0, 2)));
}
export const sumCents = (vs: Array<string | number | null | undefined>): number => vs.reduce<number>((a, v) => a + toCents(v), 0);
export function gapCents(p: { float_amount: string | number; cash_book: string | number; advances_out: string | number;
                              receipts_waiting: string | number }): number {
  return toCents(p.float_amount) - sumCents([p.cash_book, p.advances_out, p.receipts_waiting]);
}
/** FR-IMP-024 hint: no approved plan line (remaining null) means everything is out of plan. */
export function isPlanException(amount: number | string, remaining: number | string | null | undefined): boolean {
  return remaining == null || toCents(amount) > toCents(remaining);
}

export interface FloatCtx {
  userId: string | null | undefined;
  realRole: Role | null | undefined;
  custodianId: string;
  receiptsWaiting: string | number;
  gap: string | number;
  openFunding: boolean;
}
export function availableFloatActions(c: FloatCtx): ImprestAction[] {
  if (!c.userId || !c.realRole) return [];
  const out: ImprestAction[] = [];
  const custodian = c.userId === c.custodianId;
  if (custodian && toCents(c.receiptsWaiting) > 0) out.push('requestReplenishment');
  if (custodian && toCents(c.gap) > 0 && !c.openFunding) out.push('requestFunding');
  if (custodian || FINANCE_OR_ADMIN.includes(c.realRole)) out.push('recordCount');
  return out;
}

export interface ReplenishmentCtx {
  userId: string | null | undefined;
  realRole: Role | null | undefined;
  custodianId: string;
  rep: { status: string; requested_by: string; approved_by: string | null };
}
export function availableReplenishmentActions(c: ReplenishmentCtx): ImprestAction[] {
  if (!c.userId || !c.realRole) return [];
  const fin = FINANCE_OR_ADMIN.includes(c.realRole);
  const party = c.userId === c.custodianId || c.userId === c.rep.requested_by;
  const out: ImprestAction[] = [];
  if (c.rep.status === 'Requested' && fin && !party) out.push('approveReplenishment', 'rejectReplenishment');
  if (c.rep.status === 'Approved' && fin && !party && c.userId !== c.rep.approved_by) out.push('payReplenishment');
  if ((c.rep.status === 'Requested' && (fin || c.userId === c.rep.requested_by)) || (c.rep.status === 'Approved' && fin)) {
    out.push('cancelReplenishment');
  }
  return out;
}

export interface PlanCtx {
  userId: string | null | undefined;
  realRole: Role | null | undefined;
  custodianId: string;
  plan: { status: string; author_id: string };
}
export function availablePlanActions(c: PlanCtx): ImprestAction[] {
  if (!c.userId || !c.realRole) return [];
  const author = c.userId === c.plan.author_id;
  const out: ImprestAction[] = [];
  if (c.plan.status === 'Draft' && author) out.push('submitPlan');
  if (c.plan.status === 'Rejected' && author) out.push('reopenPlan');
  if (['Draft', 'Submitted', 'Rejected'].includes(c.plan.status) && (author || FINANCE_OR_ADMIN.includes(c.realRole))) out.push('cancelPlan');
  if (c.plan.status === 'Submitted' && !author && c.userId !== c.custodianId && APPROVAL_RANK.includes(c.realRole)) {
    out.push('approvePlan', 'rejectPlan');
  }
  return out;
}
```

Run `cd pmo-portal && npx vitest run src/lib/imprest/imprestRules.test.ts` red, then green.

### S4.2 Float records in `src/lib/expenses/expenseRules.ts` (DD-IMP-7 projection)

Failing tests appended to `src/lib/expenses/expenseRules.test.ts`:
- `AC-IMP-081 a float record: only its custodian gets pay, whatever their role` — PM custodian gets `pay`; a Finance user
  who is not the custodian does not.
- `AC-IMP-081 a float record: the custodian never gets approve or reject`.
- `AC-IMP-081 a record with no float keeps Finance-or-Admin pay` (regression: a PM never gets `pay`).

Change `ExpenseActionContext` and two lines of `availableExpenseActions`:

```ts
export interface ExpenseActionContext {
  claim: Pick<ExpenseClaimRow, 'kind' | 'status' | 'claimant_id' | 'approved_by_id'>;
  userId: string | null | undefined;
  realRole: Role | null | undefined;
  route?: RouteShape | null;
  advanceOutstanding?: number | null;
  /** #1515 DD-IMP-7: the custodian of the float this record is charged to; null/undefined = not a float record. */
  floatCustodianId?: string | null;
}
// inside availableExpenseActions:
  const onFloat = !!ctx.floatCustodianId;
  const isCustodian = onFloat && ctx.floatCustodianId === userId;
  if (s === 'Submitted' && !isClaimant && !isCustodian && APPROVAL_RANK.includes(realRole) && mayDecideRoutedApproval(ctx.route, userId, isAdmin)) {
    out.push('approve', 'reject');
  }
  const mayPay = onFloat ? isCustodian : financeOrAdmin;
  if (s === 'Approved' && mayPay && !isClaimant && claim.approved_by_id !== userId) out.push('pay');
  // recordReturn: Finance/Admin as today, or the float's custodian on a float advance
  if (claim.kind === 'advance' && s === 'Paid' && (financeOrAdmin || isCustodian) && !isClaimant && (ctx.advanceOutstanding ?? 0) > 0) {
    out.push('recordReturn');
  }
```

(Replace the existing approve, pay and recordReturn lines with these; `submit`, `reopen`, `cancel` are unchanged.)

### S4.3 DAL `src/lib/db/imprest.ts` (new) (AC-IMP-080)

Failing tests `src/lib/db/imprest.test.ts` (new), on the `expenseClaims.test.ts` mock harness:
- `AC-IMP-080 createPlan sends only float_id and month` — the insert payload's keys are exactly `['float_id', 'month']`.
- `AC-IMP-080 savePlanLine sends only plan_id, budget_category, planned_amount`.
- `AC-IMP-080 RPC writes send no org_id, status, amount or number` — `requestReplenishment` calls
  `rpc('request_imprest_replenishment', { p_float, p_kind })` and nothing else; `establishFloat` sends
  `{ p_project, p_custodian, p_amount }`.
- `AC-IMP-080 listFloats is bounded at 200 + 1 and reports truncated` — 201 rows back -> 200 returned and `truncated: true`.
- `AC-IMP-080 a plan-line update that lands no row is a 42501` — uses `assertWriteLanded`.

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Database, Tables } from '@/src/lib/supabase/database.types';

/**
 * Site imprest DAL (#1515, migrations 0422-0424). Floats, changes, replenishments and counts move only through RPCs;
 * plan headers and lines are table writes over granted columns (author, Draft/Rejected). Never sends org_id, status,
 * number, amount or a stamp. Lists bounded at LIST_LIMIT + 1 sentinel (money-path primer bucket 5).
 */
export type ImprestFloatRow = Tables<'imprest_floats'>;
export type ImprestPlanRow = Tables<'imprest_plans'>;
export type ImprestPlanLineRow = Tables<'imprest_plan_lines'>;
export type ImprestReplenishmentRow = Tables<'imprest_replenishments'>;
export type ImprestCountRow = Tables<'imprest_cash_counts'>;
export type BudgetCategory = Database['public']['Enums']['budget_category'];
export type ImprestPosition = Database['public']['Functions']['get_imprest_position']['Returns'][number];
export type ImprestPlanUsageRow = Database['public']['Functions']['get_imprest_plan_usage']['Returns'][number];
export type ImprestFloatChoice = Database['public']['Functions']['imprest_float_choices']['Returns'][number];

export const LIST_LIMIT = 200;
export interface Bounded<T> { rows: T[]; truncated: boolean }
const bounded = <T>(rows: T[] | null): Bounded<T> =>
  ({ rows: (rows ?? []).slice(0, LIST_LIMIT), truncated: (rows ?? []).length > LIST_LIMIT });
const fail = (error: { message: string; code?: string } | null): void => { if (error) throw new AppError(error.message, error.code); };

export async function listFloats(): Promise<Bounded<ImprestFloatRow & { project: { name: string } | null; custodian: { full_name: string } | null }>> {
  const { data, error } = await supabase.from('imprest_floats')
    .select('*, project:projects(name), custodian:profiles!imprest_floats_custodian_id_fkey(full_name)')
    .is('archived_at', null).order('created_at', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function getPosition(floatId: string): Promise<ImprestPosition | null> {
  const { data, error } = await supabase.rpc('get_imprest_position', { p_float: floatId });
  fail(error);
  return data?.[0] ?? null;
}
export async function getPlanUsage(floatId: string, month: string): Promise<ImprestPlanUsageRow[]> {
  const { data, error } = await supabase.rpc('get_imprest_plan_usage', { p_float: floatId, p_month: month });
  fail(error);
  return data ?? [];
}
export async function floatChoices(projectId: string, category: BudgetCategory | null): Promise<ImprestFloatChoice[]> {
  const { data, error } = await supabase.rpc('imprest_float_choices', { p_project: projectId, p_category: category ?? undefined });
  fail(error);
  return data ?? [];
}
export async function listPlans(floatId: string): Promise<Bounded<ImprestPlanRow>> {
  const { data, error } = await supabase.from('imprest_plans').select('*').eq('float_id', floatId)
    .order('month', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function listPlanLines(planId: string): Promise<ImprestPlanLineRow[]> {
  const { data, error } = await supabase.from('imprest_plan_lines').select('*').eq('plan_id', planId).order('budget_category');
  fail(error);
  return data ?? [];
}
export async function listReplenishments(floatId: string): Promise<Bounded<ImprestReplenishmentRow>> {
  const { data, error } = await supabase.from('imprest_replenishments').select('*').eq('float_id', floatId)
    .order('requested_at', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function listCounts(floatId: string): Promise<Bounded<ImprestCountRow>> {
  const { data, error } = await supabase.from('imprest_cash_counts').select('*').eq('float_id', floatId)
    .order('counted_at', { ascending: false }).limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
export async function createPlan(floatId: string, month: string): Promise<string> {
  const { data, error } = await supabase.from('imprest_plans').insert({ float_id: floatId, month }).select('id').single();
  fail(error);
  return data!.id;
}
export async function savePlanLine(planId: string, budgetCategory: BudgetCategory, plannedAmount: number): Promise<void> {
  const { data, error } = await supabase.from('imprest_plan_lines')
    .upsert({ plan_id: planId, budget_category: budgetCategory, planned_amount: plannedAmount }, { onConflict: 'plan_id,budget_category' })
    .select('id');
  fail(error);
  assertWriteLanded(data, 'the plan line was not saved: the plan is no longer a Draft you authored');
}
export async function deletePlanLine(lineId: string): Promise<void> {
  const { data, error } = await supabase.from('imprest_plan_lines').delete().eq('id', lineId).select('id');
  fail(error);
  assertWriteLanded(data, 'the plan line was not removed: the plan is no longer a Draft you authored');
}
const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  fail(error);
  return data;
};
export const setProcurementLimit = (amount: number) => rpc('set_imprest_procurement_limit', { p_amount: amount });
export const establishFloat = (projectId: string, custodianId: string, amount: number) =>
  rpc('establish_imprest_float', { p_project: projectId, p_custodian: custodianId, p_amount: amount }) as Promise<string>;
export const proposeFloatAmount = (floatId: string, amount: number) =>
  rpc('propose_imprest_float_amount', { p_float: floatId, p_amount: amount }) as Promise<string>;
export const decideFloatChange = (changeId: string, approve: boolean, notes?: string) =>
  rpc('decide_imprest_float_change', { p_change: changeId, p_approve: approve, p_notes: notes ?? null });
export const transitionPlan = (planId: string, to: 'Submitted' | 'Approved' | 'Rejected' | 'Cancelled' | 'Draft', notes?: string) =>
  rpc('transition_imprest_plan', { p_id: planId, p_to: to, p_notes: notes ?? null });
export const requestReplenishment = (floatId: string, kind: 'replenishment' | 'funding' = 'replenishment') =>
  rpc('request_imprest_replenishment', { p_float: floatId, p_kind: kind }) as Promise<string>;
export const transitionReplenishment = (id: string, to: 'Approved' | 'Rejected' | 'Paid' | 'Cancelled',
                                        opts: { notes?: string; paymentReference?: string } = {}) =>
  rpc('transition_imprest_replenishment', { p_id: id, p_to: to, p_notes: opts.notes ?? null,
                                            p_payment_reference: to === 'Paid' ? (opts.paymentReference ?? null) : null });
export const recordCount = (floatId: string, counted: number, note?: string) =>
  rpc('record_imprest_count', { p_float: floatId, p_counted: counted, p_note: note ?? null }) as Promise<string>;
```

⚑ The `profiles!imprest_floats_custodian_id_fkey` embed name is Postgres's default FK name for `custodian_id`; confirm it
in the generated `database.types.ts` (`Relationships`) and use that exact string. `new AppError(message, code)` and
`assertWriteLanded(data, message)` are the `@/src/lib/appError` calls `expenseClaims.ts` makes today.

### S4.4 Repository `src/lib/repositories/imprest.ts` (new) and registration

```ts
import * as dal from '@/src/lib/db/imprest';
/** #1515 — the API seam over the imprest DAL (ADR-0017). Thin by design: the RPCs hold every rule. */
export const imprestRepository = { ...dal };
export type ImprestRepository = typeof imprestRepository;
```

Register in `src/lib/repositories/index.ts`: `import { imprestRepository } from './imprest';` beside line 57's expenses
import, and `imprest: imprestRepository,` beside `expenseClaim: expenseClaimRepository,`. Test `src/lib/repositories/imprest.test.ts` (new): `imprestRepository.requestReplenishment` is the DAL
function (identity), on the `expenses.test.ts` pattern.

### S4.5 Hooks `src/hooks/useImprest.ts` (new) (AC-IMP-083)

Failing tests `src/hooks/useImprest.test.tsx` (new):
- `AC-IMP-083 every query key carries the org id` — keys are `['imprest-floats', orgId]`, `['imprest-position', orgId, id]`,
  `['imprest-plan-usage', orgId, id, month]`, `['imprest-plans', orgId, id]`, `['imprest-replenishments', orgId, id]`,
  `['imprest-counts', orgId, id]`, `['imprest-float-choices', orgId, projectId, category]`.
- `AC-IMP-083 every mutation invalidates position, plan usage, replenishments, claims and approvals` — after
  `useRequestReplenishment().mutateAsync`, `invalidateQueries` was called with each root in `IMPREST_QUERY_ROOTS` and
  each root in `EXPENSE_QUERY_ROOTS` and the approvals key.

```ts
export const IMPREST_QUERY_ROOTS = ['imprest-floats', 'imprest-position', 'imprest-plan-usage', 'imprest-plans',
  'imprest-replenishments', 'imprest-counts', 'imprest-float-choices'] as const;
```

One `useQuery` hook per DAL read (enabled only with an org id and the required ids), one `useMutation` hook per DAL write;
every mutation's `onSuccess` invalidates `IMPREST_QUERY_ROOTS`, `EXPENSE_QUERY_ROOTS` (from `useExpenseClaims.ts`) and
`expenseClaimsAwaitingKey`'s root, by prefix, exactly as `useExpenseClaims.ts` invalidates today.

### S4.6 Policy entities (AC-IMP-085)

`src/auth/policy.ts`: add `'imprestFloat' | 'imprestPlan' | 'imprestReplenishment'` to the entity union and:

```ts
  /**
   * Site imprest (#1515, 0422-0424). Floats, plans and replenishments are visible to approval rank (RLS). Status moves
   * and pay depend on identity (custodian, author, requester) and are projected by src/lib/imprest/imprestRules.ts.
   */
  // MASTER_DATA = Admin, Executive, Project Manager, Finance = approval rank (holds_spend_approval_authority)
  imprestFloat: { view: allow(MASTER_DATA), create: allow(IMPREST_SETUP), edit: allow(IMPREST_SETUP) },
  imprestPlan: { view: allow(MASTER_DATA), create: allow(MASTER_DATA) },
  imprestReplenishment: { view: allow(MASTER_DATA) },
```

Add `const IMPREST_SETUP: Role[] = ['Admin', 'Finance']; // establish a float, propose its amount (0422)` beside
`TAX_SETUP` (line ~163).
Tests in `src/auth/policy.test.ts`: `AC-IMP-085 an Engineer cannot view a float, plan or replenishment`; `AC-IMP-085 only
Admin and Finance create a float`; `AC-IMP-085 approval rank creates a plan`.

### S4.7 Gate and commit

From `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx vitest run src/lib/imprest/imprestRules.test.ts
src/lib/expenses/expenseRules.test.ts src/lib/db/imprest.test.ts src/lib/repositories/imprest.test.ts
src/hooks/useImprest.test.tsx src/auth/policy.test.ts`, eslint on the touched files. Commit
`feat(imprest): data layer, rules and policy (#1515 S4)`.

---

## S5 - Screens, expense form field, approvals, e2e (no migration)

Covers AC-IMP-082, 084, 090. UI lane (CLAUDE.md step 4): machine gates + `scripts/ux-proof.sh` on touched routes; one
Director rendered review; the owner judges screenshots. Load impeccable + taste + ui-ux-pro-max (owner rule). Strings
come from a new `imprest` i18n namespace via `useTranslation('imprest')`; en and id ship together.

### S5.1 i18n namespace

`pmo-portal/public/locales/en/imprest.json` and `public/locales/id/imprest.json` (new), same keys: `nav.siteCash`
("Site cash" / "Kas lapangan"), `list.title`, `list.empty`, `list.error`, `list.truncated`, `position.float`,
`position.cash`, `position.advancesOut`, `position.receiptsWaiting`, `position.inFlight`, `position.gap`,
`position.gapFlag` ("Books do not balance" / "Pembukuan tidak seimbang"), `position.varianceFlag`, `plan.title`,
`plan.planned`, `plan.drawn`, `plan.remaining`, `plan.exception` ("Out of plan" / "Di luar rencana"), `plan.none`,
`actions.requestReplenishment`, `actions.requestFunding`, `actions.approve`, `actions.reject`, `actions.pay`,
`actions.cancel`, `actions.recordCount`, `actions.submitPlan`, `form.chargeToFloat` ("Charge to site float" / "Bebankan ke
kas lapangan"), `form.remainingHint`, `form.exceptionHint`, `form.limitHint`, `posting.pending`, `posting.failed`,
`posting.uncertain`. Register the namespace wherever `expenseClaims` is registered (grep `'expenseClaims'` under
`src/lib/i18n*`). Run the launch-scope i18n gate the repo uses (`npm run check:guards` includes it).

### S5.2 `/imprest` list page (AC-IMP-082, FR-IMP-070)

`pmo-portal/pages/ImprestFloats.test.tsx` (new), on `pages/Companies.test.tsx`'s harness:
- `AC-IMP-082 the list shows each float's position` — float, cash, advances out, receipts waiting, gap, project and
  custodian render for each row from mocked `listFloats` + `getPosition`.
- `AC-IMP-082 a non-zero gap is flagged in text` — `position.gapFlag` text present on that row only (NFR-IMP-007).
- `AC-IMP-082 a failed read shows the error state, never a zero` — `listFloats` rejects -> `list.error` shown and no
  `0` money cell.
- `AC-IMP-082 a truncated list says so` — `truncated: true` -> `list.truncated` shown.

`pmo-portal/pages/ImprestFloats.tsx` (new): `useImprestFloats()` + one `useImprestPosition(id)` per row (the list is
bounded at 200), `DataTable`-style table on DESIGN.md tokens; money via the existing money formatter in
`src/lib/format`; an Admin/Finance **Establish float** button (`<CanWrite entity="imprestFloat" action="create">`) opening
an `EntityFormModal` (project `Combobox`, custodian `Combobox` filtered client-side to Finance members and the chosen
project's manager, amount `TextField`). Route `{ path: '/imprest', element: <ImprestFloatsPage /> }` in `App.tsx` beside
the `/expenses` routes (lazy import, same pattern).

### S5.3 `/imprest/:floatId` detail (AC-IMP-082, FR-IMP-071)

`pmo-portal/pages/ImprestFloatDetail.test.tsx` (new):
- `AC-IMP-082 the detail shows the plan table with exception items marked` — rows per category with planned, drawn,
  remaining; an exception item shows `plan.exception` text.
- `AC-IMP-082 the custodian sees Request replenishment and not Approve` — viewer = custodian, a Requested replenishment
  in the list: `actions.requestReplenishment` present, `actions.approve` absent.
- `AC-IMP-082 a non-custodian Finance user sees Approve on a Requested replenishment`.
- `AC-IMP-082 a failed position read shows the error state, not zeros`.

`pmo-portal/pages/ImprestFloatDetail.tsx` (new): position header (six figures + gap flag + last count variance), the
month's plan table from `position.plan_lines`, a **Plans** section (list + create Draft for next/current month + line
editor while Draft/Rejected, using `availablePlanActions`), **Receipts waiting** (the float's Paid claims without a
paid replenishment: `expense_claims` read filtered by `imprest_float_id`, linking to `/expenses/:id`), **Replenishments**
(table + `availableReplenishmentActions` buttons; Pay opens a `ConfirmDialog` with a payment-reference `TextField`),
**Counts** (append-only list + Record count modal requiring a note when the counted figure differs from cash). Every
destructive or money action confirms via `ConfirmDialog`; errors via `classifyMutationError`. Route
`/imprest/:floatId`.

### S5.4 Expense form field (AC-IMP-084, FR-IMP-072)

`pages/ExpenseClaimNew.test.tsx` additions (plan delta 4):
- `AC-IMP-084 Charge to site float lists only floats on the chosen project` — `floatChoices` called with the chosen
  project; options are its rows; changing the project refetches.
- `AC-IMP-084 the field shows the month's remaining and the exception hint` — remaining 500,000 and amount 700,000 ->
  `form.exceptionHint` shown; amount 400,000 -> not shown; amount above the org limit -> `form.limitHint` (read the
  limit from `org_imprest_settings`, one row).

`pages/ExpenseClaimNew.tsx`: a `SelectField` **Charge to site float** under the project field, shown only when
`floatChoices(project, category)` returns rows; sends `imprest_float_id` through the existing create/patch input (add
`imprestFloatId?: string | null` to `ExpenseClaimInput` in `src/lib/db/expenseClaims.ts` and map it to the
`imprest_float_id` column in the insert/update payload, the only DAL change). `ExpenseClaimDetail.tsx` passes
`floatCustodianId` (from `imprest_floats` when visible, else `null`) into `availableExpenseActions`, and shows the
exception banner with `get_expense_claim_approval_routes`' approvers when `is_plan_exception` is true (FR-IMP-025).

### S5.5 Approvals section (FR-IMP-073)

`pages/approvals/ImprestApprovalSection.tsx` (new) + test: lists Submitted plans the viewer may decide
(`availablePlanActions`) and Requested/Approved replenishments the viewer may approve/pay
(`availableReplenishmentActions`); exception items already appear through `ExpenseClaimApprovalSection` (they are expense
claims) and gain an **Out of plan** tag there when `is_plan_exception`. Mount it in `pages/Approvals.tsx` beside
`ExpenseClaimApprovalSection`. Test titles: `FR-IMP-073 a Finance user sees a Requested replenishment they may approve`;
`FR-IMP-073 the custodian does not see their own replenishment`.

### S5.6 Navigation (FR-IMP-074)

`src/components/shell/Rail.tsx`: a **Site cash** item to `/imprest` shown when `can('view', 'imprestFloat')`, placed
after Expenses; `src/components/shell/routeMatch.ts`: `/imprest` and `/imprest/:id` map to the module (breadcrumb);
the ⌘K command list gains the route where Expenses is listed (grep `'/expenses'` in the command palette source). Update
`src/components/shell/__tests__/routeMatch.test.ts` with the two paths.

### S5.7 E2E journey (AC-IMP-090)

`pmo-portal/e2e/AC-IMP-090-site-imprest-journey.spec.ts` (new), line 1 `// @e2e-isolation: self-isolated` (it creates its
own project and float with a per-run suffix; read `docs/e2e-parallel-conventions.md` and run
`scripts/check-e2e-isolation.sh`). Setup through the service client (seed helpers the expense e2e uses): a project managed
by the seed PM, a float with the seed Finance user as custodian, funded (Paid funding), an Approved plan for this month,
one Paid float claim with a receipt. Journey, as the users the seed provides:

1. Custodian opens `/imprest/<float>` and clicks **Request replenishment**.
2. A second Finance-or-Admin user approves it on the same page.
3. A third user pays it with reference `E2E-<suffix>`.
4. **Goal oracle:** the float page shows cash + receipts waiting equal to the float amount, receipts waiting `0`, gap
   `0`, and the claim's row marked replenished.
5. Out-of-plan branch: an Engineer files a float claim above the remaining; the project approver opens it and sees no
   **Approve**; the senior approver opens it and approves.

`test('AC-IMP-090 site imprest: replenish settled receipts and route an out-of-plan claim', ...)`. Run
`scripts/e2e-local.sh AC-IMP-090` (DB under the lock). The browser suite runs in CI on the release PR to `main`.

### S5.8 Gate and commit

From `pmo-portal/`: guards, typecheck, eslint on touched files, the touched vitest files (S5.2-S5.6), the e2e journey,
then `scripts/ux-proof.sh /imprest /imprest/<seed float id> /expenses/new /approvals` (every state: empty, loading,
error, truncated, gap flag, exception). Commit `feat(imprest): site cash screens, float field and approvals (#1515 S5)`.

---
## S6 - ERP posting: cash account, intents, ERPNext driver, contract suite (`0425_imprest_postings.sql`)

Covers AC-IMP-070, 071, 072 and NFR-IMP-008. **Money path: read the primer in full; the five buckets are the review
checklist.** Odoo's driver is #1509 (blocked by this issue); this slice ships the canonical command, the ERPNext driver
and the shared suite, with Odoo declared `pending` against #1509.

**PQ-11 (default taken):** a float record whose float has **no cash account** posts **nothing** (no approval journal,
no payment, no settlement, no return): spec §9 "a float with neither runs fully standalone". Off-float records keep
phase B unchanged. Changing this later is one predicate in the enqueue trigger.

### S6.1 The command and the workflow registry

`pmo-portal/src/lib/adapterSeam/connect/workflows.ts`: add to `WORKFLOWS` under process domains
`'imprest.transfer': { version: 1, summary: 'move cash between two of the company\'s own accounts once, by key' },`.
Typecheck now fails in both tier declaration files (the total record) until:
- `erpnext/workflowDeclarations.ts`: `'imprest.transfer': { status: 'supported', version: 1 },`
- `odoo/workflowDeclarations.ts`: `const ODOO_SITE_CASH = 1509;` and
  `'imprest.transfer': { status: 'pending', version: 1, issue: ODOO_SITE_CASH },`

`pmo-portal/src/lib/adapterSeam/imprestTransfer.ts` (new), tier-neutral (no tier name anywhere):

```ts
/**
 * #1515 §9 — the canonical site-cash transfer (`imprest.transfer`): head office bank → a float's cash account, once per
 * key. PMO terms only; each ERP adapter maps it to its own document (ERPNext: Journal Entry; Odoo: #1509).
 */
export interface ImprestTransfer {
  /** `impt:<replenishment uuid>:<paid_at epoch ms>` — the ADR-0058 idempotency key and the ERP anchor. */
  key: string;
  fromAccount: string;
  toAccount: string;
  /** 2-decimal string, > 0. */
  amount: string;
  /** YYYY-MM-DD, org timezone. */
  date: string;
  reference: string;
}
export const IMPREST_TRANSFER_KEY_RE = /^impt:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4,20}$/;
const MONEY = /^\d{1,12}\.\d{2}$/;
export function assertImprestTransfer(t: ImprestTransfer): ImprestTransfer {
  if (!IMPREST_TRANSFER_KEY_RE.test(t.key)) throw new Error(`imprest.transfer: bad key ${t.key}`);
  if (!MONEY.test(t.amount) || Number(t.amount) <= 0) throw new Error(`imprest.transfer: bad amount ${t.amount}`);
  if (!t.fromAccount || !t.toAccount || t.fromAccount === t.toAccount) throw new Error('imprest.transfer: the two accounts must differ');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error(`imprest.transfer: bad date ${t.date}`);
  return t;
}
```

### S6.2 Shared contract suite (AC-IMP-072, OD-ERP-ANYTIME-1)

`contractSuite/harness.ts`: add to `ErpHarness`

```ts
  /** imprest.transfer: each call starts an empty fake ERP. Absent until the tier posts site cash. */
  transfer?: () => TransferHarness;
```

and

```ts
export interface TransferHarness {
  post(t: import('../imprestTransfer.ts').ImprestTransfer): Promise<{ externalId: string }>;
  /** Ledger lines the fake ERP now holds for the key, normalised: account, debit and credit as 2-decimal strings. */
  lines(key: string): Array<{ account: string; debit: string; credit: string }>;
  documents(): Array<{ externalId: string; key: string }>;
  failNextWrite(fault: 'transport' | 'lost-response'): void;
}
```

`contractSuite/imprestTransfer.suite.ts` (new), registered in `contractSuite/index.ts` as `'imprest.transfer':
imprestTransferSuite`:

- `AC-IMP-072 a transfer posts one document moving the amount from the bank to the float's cash account` — one document;
  lines: debit `toAccount` 800000.00, credit `fromAccount` 800000.00, nothing else.
- `AC-IMP-072 posting the same key again adopts the first document: no second transfer` — same `externalId`, one doc.
- `AC-IMP-072 a lost answer then a retry leaves exactly one document` — `failNextWrite('lost-response')`, rejects
  `external-unreachable`, retry -> one doc with the retry's id.
- `AC-IMP-072 a transport failure writes nothing; the retry posts once`.
- `AC-IMP-072 a document with another key is never adopted` — pre-seed a doc keyed `impt:<other uuid>:1`; posting ours
  creates a second doc and returns its own id (primer bucket 2).

The ERPNext harness (`erpnext/contract.harness.ts`) implements `transfer()` over its existing mocked-transport fake,
driving the real `imprestTransferToBody` + `adapter.ts` anchor stamping; Odoo's harness leaves `transfer` undefined
(the runner skips `pending`). `tiers.contract.test.ts` then runs the suite for ERPNext automatically.

### S6.3 ERPNext driver

- `erpnext/doctypeRegistry.ts`: add `'imprest-transfer'` to `ErpDocKind` and
  `'imprest-transfer': { doctype: 'Journal Entry', submittable: true, submitOnCreate: true, anchorField: 'user_remark', anchorMutable: false },`
  (the `expense-journal` twin: `user_remark` survives validate+submit, immutable, so ADR-0058 C-1 allows reissue on a
  conclusive miss, spec §9).
- `erpnext/bodies/imprestTransfer.ts` (new):

```ts
import type { PmoRecord } from '../../contract.ts';
import { AdapterError } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { expenseJournalToBody } from './expenseJournal.ts';
import { assertImprestTransfer } from '../../imprestTransfer.ts';

/** #1515 — head office → float cash as a two-row Journal Entry with no party. `adapter.ts` stamps the key into user_remark. */
export function imprestTransferToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  let t;
  try {
    t = assertImprestTransfer({ key: String(rec.idempotency_key), fromAccount: String(rec.from_account),
      toAccount: String(rec.to_account), amount: String(rec.amount), date: String(rec.posting_date), reference: String(rec.reference) });
  } catch (e) {
    throw new AdapterError('commit-rejected', (e as Error).message);
  }
  const body = expenseJournalToBody({ ...rec, journal_rows: [
    { account: t.toAccount, debit: t.amount },
    { account: t.fromAccount, credit: t.amount },
  ] }, ctx) as Record<string, unknown>;
  return { ...body, voucher_type: 'Bank Entry', cheque_no: t.reference, cheque_date: t.date };
}
```

  `voucher_type: 'Bank Entry'` with `cheque_no`/`cheque_date` is ERPNext's required pair for a Bank-typed row; the
  builder confirms on the dev bed (`scripts/with-erpnext-lock.sh`) that a Cash-to-Bank JE submits with these fields and
  records the result in the PR (if the bench refuses, `voucher_type: 'Journal Entry'` without the cheque pair is the
  fallback; the suite does not depend on it).
- `erpnext/doctypeBodies.ts`: `'imprest-transfer': { toBody: imprestTransferToBody, fromDoc: expenseJournalFromDoc },`.
- `erpnext/bodies/imprestTransfer.test.ts` (new): `AC-IMP-072 the body has exactly two rows, no party, balanced`;
  `AC-IMP-072 equal accounts or a bad amount are commit-rejected`.

### S6.4 Failing tests: intents and the gate (AC-IMP-070, 071)

`supabase/tests/imprest_postings.test.sql` (new) = F1 + F2, plus an activated ERPNext binding and `expenses` ownership
row for the org (column lists as in `supabase/tests/0270_expense_postings_enqueue.test.sql`), float F with
`erp_cash_account_ref = 'Site Cash F - IMP'`, float G with **none**:

- `AC-IMP-070 a paid replenishment on a float with a cash account writes exactly one replenishment intent keyed by its
  paid stamp` — after Fin2 approves and the Admin pays a replenishment on F: one `imprest_posting_erp_mirror` row,
  `posting_identity = '<rep id>:replenishment'`, `state_stamp = paid_at`.
- `AC-IMP-070 no binding or no cash account: no intent` — the same on G -> 0 rows; on F after deleting the ownership row
  -> 0 rows.
- `AC-IMP-071 a paid float advance freezes the float's cash account in its gate truth` —
  `expense_posting_for_push(org, mirror)->>'float_cash_account' = 'Site Cash F - IMP'`.
- `AC-IMP-071 a float record whose float has no cash account enqueues nothing` (PQ-11) — a Paid advance on G -> 0
  `expense_posting_erp_mirror` rows for it.
- `AC-IMP-071 the gate accepts a PM custodian as the recorded payer and refuses one who no longer qualifies` — float G
  given a cash account; PM2 pays a float advance; `expense_posting_actor_check` lives; superuser reassigns P2's manager;
  it throws `expense-posting-actor-not-authorized`.

### S6.5 Migration `0425_imprest_postings.sql`

```sql
-- 0425_imprest_postings.sql — #1515 S6: site-float postings (spec §9, DD-IMP-6). ADR-0059 Posture B, ADR-0081 one
-- originator, ADR-0058 outbox. Re-creates enqueue_expense_claim_postings, enqueue_expense_return_posting,
-- expense_posting_actor_check and expense_posting_for_push from 0270/0354 text plus `-- 0425` lines.
-- REVERSE: rollback/0425_imprest_postings_down.sql (stop the sweep pass first).

-- §1 tier-neutral employment: any activated binding whose tier owns `expenses` (no tier literal: AC-ECA-043's spirit
-- holds in SQL too, so #1509 needs no change here).
create or replace function public.org_employs_imprest_postings(p_org_id uuid) returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (select 1 from public.external_org_bindings b
                   join public.external_domain_ownership d on d.org_id = b.org_id and d.external_tier = b.external_tier
                  where b.org_id = p_org_id and b.activated_at is not null and d.domain = 'expenses')
$$;
revoke all on function public.org_employs_imprest_postings(uuid) from public, anon, authenticated;
grant execute on function public.org_employs_imprest_postings(uuid) to service_role;

-- §2 the replenishment side mirror (one row per paid replenishment or funding).
create table public.imprest_posting_erp_mirror (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id),
  replenishment_id uuid not null references public.imprest_replenishments(id),
  posting          text not null default 'replenishment',
  posting_identity text not null,
  state_stamp      timestamptz not null,
  actor_id         uuid references public.profiles(id),
  push_state       text not null default 'pending',
  push_error       text,
  erp_name         text,
  pushed_at        timestamptz,
  last_attempt_at  timestamptz,
  attempt_count    int not null default 0,
  erp_docstatus    smallint,
  erp_modified     text,
  erp_cancelled_at timestamptz,
  created_at       timestamptz not null default now(),
  constraint imprest_posting_erp_mirror_posting  check (posting = 'replenishment'),
  constraint imprest_posting_erp_mirror_state    check (push_state in ('pending','failed','held','pushed')),
  constraint imprest_posting_erp_mirror_identity check (posting_identity = replenishment_id::text || ':replenishment'),
  constraint imprest_posting_erp_mirror_identity_unique unique (org_id, posting_identity)
);
create index imprest_posting_erp_mirror_queue_idx
  on public.imprest_posting_erp_mirror (org_id, push_state, last_attempt_at nulls first, created_at) where erp_cancelled_at is null;
alter table public.imprest_posting_erp_mirror enable row level security;
alter table public.imprest_posting_erp_mirror force  row level security;
create policy imprest_posting_erp_mirror_select on public.imprest_posting_erp_mirror for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_replenishments r where r.id = imprest_posting_erp_mirror.replenishment_id));
revoke all on public.imprest_posting_erp_mirror from public, anon, authenticated;
grant select on public.imprest_posting_erp_mirror to authenticated;
grant select, insert, update, delete on public.imprest_posting_erp_mirror to service_role;

create or replace function public.enqueue_imprest_replenishment_posting() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'Paid' and old.status is distinct from 'Paid'
     and public.org_employs_imprest_postings(new.org_id)
     and exists (select 1 from public.imprest_floats f where f.id = new.float_id and f.erp_cash_account_ref is not null) then
    insert into public.imprest_posting_erp_mirror (org_id, replenishment_id, posting_identity, state_stamp, actor_id)
    values (new.org_id, new.id, new.id::text || ':replenishment', new.paid_at, new.paid_by)
    on conflict (org_id, posting_identity) do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.enqueue_imprest_replenishment_posting() from public, anon, authenticated, service_role;
create trigger imprest_replenishments_enqueue_posting_trg after update of status on public.imprest_replenishments
  for each row when (old.status is distinct from new.status) execute function public.enqueue_imprest_replenishment_posting();

-- §3 the sweep's gate for a replenishment (service_role only; re-reads status, stamp, amount, accounts and the actor).
create or replace function public.imprest_posting_for_push(p_org_id uuid, p_mirror_id uuid) returns jsonb
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare m public.imprest_posting_erp_mirror%rowtype; r public.imprest_replenishments%rowtype; f public.imprest_floats%rowtype;
        v_role user_role; v_tz text;
begin
  select * into m from public.imprest_posting_erp_mirror where id = p_mirror_id and org_id = p_org_id;
  if not found then raise exception 'imprest posting not found' using errcode = 'P0002'; end if;
  select * into r from public.imprest_replenishments where id = m.replenishment_id and org_id = p_org_id;
  select * into f from public.imprest_floats where id = r.float_id and org_id = p_org_id;
  if r.status is distinct from 'Paid' or r.paid_at is distinct from m.state_stamp or f.erp_cash_account_ref is null then
    raise exception 'imprest-posting-precondition-failed' using errcode = 'P0001';
  end if;
  select pf.role into v_role from public.profiles pf where pf.id = m.actor_id and pf.org_id = p_org_id;
  if m.actor_id is null or not public.is_active_member(m.actor_id) or v_role not in ('Finance','Admin')
     or m.actor_id = f.custodian_id then
    raise exception 'imprest-posting-actor-not-authorized' using errcode = '42501';
  end if;
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = p_org_id), 'UTC');
  return jsonb_build_object('mirror_id', m.id, 'posting_identity', m.posting_identity, 'subject_id', r.id,
    'number', r.number, 'kind', r.kind, 'amount', to_char(r.amount, 'FM999999999990.00'), 'currency', f.currency,
    'float_id', f.id, 'float_cash_account', f.erp_cash_account_ref, 'reference', coalesce(r.payment_reference, r.number),
    'state_stamp', m.state_stamp, 'posting_date', to_char((m.state_stamp at time zone v_tz)::date, 'YYYY-MM-DD'),
    'actor_id', m.actor_id);
end; $$;
revoke all on function public.imprest_posting_for_push(uuid, uuid) from public, anon, authenticated;
grant execute on function public.imprest_posting_for_push(uuid, uuid) to service_role;
```

§4 re-creates, each from its current text (0270 §4/§5, `expense_posting_for_push` from **0354**, the latest definition:
`grep -n "function public.expense_posting_for_push" supabase/migrations/*.sql | tail -1` decides) with marked lines:

```sql
-- enqueue_expense_claim_postings: first statement after the employment check
  if new.imprest_float_id is not null and not exists (select 1 from public.imprest_floats f      -- 0425 PQ-11
       where f.id = new.imprest_float_id and f.erp_cash_account_ref is not null) then           -- 0425
    return new;                                                                                 -- 0425
  end if;                                                                                       -- 0425
-- enqueue_expense_return_posting: wrap the existing perform
  if public.org_employs_expense_postings(new.org_id)
     and not exists (select 1 from public.expense_claims a join public.imprest_floats f on f.id = a.imprest_float_id  -- 0425
                      where a.id = new.advance_id and f.erp_cash_account_ref is null) then                           -- 0425
-- expense_posting_actor_check: the role predicate becomes
  if not (v_role = 'Admin'
          or (m.posting = 'approval' and public.holds_spend_approval_authority(v_role))
          or (m.posting <> 'approval' and v_role = 'Finance')
          or (m.posting in ('claim-payment','advance-payment','advance-return','settlement')                        -- 0425 DD-IMP-7.5
              and exists (select 1 from public.expense_claims c join public.imprest_floats f on f.id = c.imprest_float_id  -- 0425
                           where c.id = m.claim_id and f.custodian_id = m.actor_id                                  -- 0425
                             and public.imprest_custodian_eligible(p_org_id, f.project_id, m.actor_id)))) then      -- 0425
-- expense_posting_for_push: one more key in the returned object
    'float_cash_account', (select f.erp_cash_account_ref from public.imprest_floats f where f.id = c.imprest_float_id),  -- 0425
```

⚑ The sweep calls `expense_posting_actor_check` as `service_role`, which now calls `imprest_custodian_eligible`. S1
revoked that function from PUBLIC and granted it to nobody, so §4 adds
`grant execute on function public.imprest_custodian_eligible(uuid, uuid, uuid) to service_role;` and the closing block
asserts `service_role` may and `anon`/`authenticated` may not execute it.

§5 the cash-account binding is written only by the service role (the validating edge function, S6.7). `authenticated`
holds no update grant on `imprest_floats` (S1). Add
`grant select, update (erp_cash_account_ref) on public.imprest_floats to service_role;` and assert in the closing block
that `authenticated` cannot update the column and `service_role` can.

Closing `do $$` block: `org_employs_imprest_postings` and `imprest_posting_for_push` service_role-only; the trigger
function no role; `imprest_posting_erp_mirror` authenticated SELECT only, service_role SELECT/INSERT/UPDATE.

### S6.6 Float variants in the command builder (AC-IMP-071)

`erpnext/expensePostingCommand.ts`: add `float_cash_account: string | null` to `ExpenseGateTruth` (parse:
`float_cash_account: d.float_cash_account === null || d.float_cash_account === undefined ? null : text('float_cash_account')`)
and in `buildExpensePostingCommand`'s payment/return case replace

```ts
      const cash = need(refs.cashAccount, 'the cash or bank account');
```

with

```ts
      // #1515 §9: a float record moves cash in or out of the float's own account, never the company default.
      const cash = truth.float_cash_account ?? need(refs.cashAccount, 'the cash or bank account');
```

`erpnext/expensePostingCommand.test.ts` additions: `AC-IMP-071 a float advance pays from the float's cash account`
(`paid_from` = float account); `AC-IMP-071 a float return lands in the float's cash account` (`paid_to` = float
account); `AC-IMP-071 a non-float payment still uses the company cash account` (regression). The float account is part
of the frozen payload, so the outbox digest binds it (primer: replay never re-decides a body).

The re-check before every posting (spec §9 "the same check re-runs"): `erpnext/expensePostingResolve.ts` gains, when
`truth.float_cash_account` is set, a read of that account through the same `ErpAccountFacts` fetch it already uses,
refusing with `refuse('imprest-cash-account-unfit')` unless `account_type === 'Cash'`, `company === binding company`,
not disabled and not a group (`imprestCashAccountFits(facts, company)`, a new pure function in
`erpnext/expenseAccountRules.ts` with its own unit tests: `AC-IMP-071 an account that no longer fits is refused, not
posted`). A refusal records the intent `failed` with that code; NFR-IMP-008 shows it.

### S6.7 Cash-account binding: `supabase/functions/imprest-cash-account/` (new)

A tier-neutral edge function (its name has no tier prefix, so AC-ECA-043 counts it; it holds **no** tier comparison):

```ts
// index.ts — POST { floatId, account } by an Admin or Finance member. Reads the org's binding, picks the tier's validator
// from a REGISTRY KEYED BY TIER (the allowed seam: no `tier === '...'` anywhere), validates, then writes
// imprest_floats.erp_cash_account_ref as service role and audits `imprest_float.cash_account`.
const VALIDATORS: Readonly<Record<string, CashAccountValidator>> = { [ERPNEXT_TIER]: validateErpnextCashAccount };
// a tier with no validator (Odoo until #1509) → 409 { code: 'imprest-cash-account-unsupported' } — fail closed.
```

`validateErpnextCashAccount` lives in `pmo-portal/src/lib/adapterSeam/erpnext/imprestCashAccount.ts` (new) and calls
`imprestCashAccountFits` from S6.6 over `accountFetch.ts`. `ERPNEXT_TIER` is imported from
`pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts` (line 23). Deno tests
`supabase/functions/imprest-cash-account/index.test.ts`: import the shipped handler from `./index.ts` and mock
`globalThis.fetch` (repo rule, `scripts/check-edge-fn-test-binding.mjs`): `AC-IMP-071 a Cash account of the bound
company is saved`; `AC-IMP-071 a Bank, other-company, disabled or group account is refused 422 and nothing is written`;
`AC-IMP-071 an Engineer or PM is refused 403`; `AC-IMP-071 a tier with no validator is refused, nothing written`. Add the
function to `scripts/isolation-probe-denominator.json` `edge_functions`.

### S6.8 The sweep pass (AC-IMP-072)

`supabase/functions/erpnext-sweep/imprestPostingBackstop.ts` (new): the `expensePostingBackstop.ts` shape (replay an
existing outbox row by key; else gate `imprest_posting_for_push` -> resolve -> fresh command through
`dispatchMoneyWrite`; per-row containment; round robin; `EXPENSE_BACKSTOP_TICK_LIMIT`), over
`imprest_posting_erp_mirror`. The command record:

```ts
{ id: truth.subject_id.toLowerCase(), erp_doc_kind: 'imprest-transfer', idempotency_key: imprestTransferKey(truth),
  from_account: refs.headOfficeAccount /* binding.cashAccount: default_cash_account ?? default_bank_account */,
  to_account: truth.float_cash_account, amount: truth.amount, posting_date: truth.posting_date,
  reference: truth.reference, company: refs.company, outbox_identity: truth.posting_identity }
```

with `imprestTransferKey = (t) => 'impt:' + t.subject_id.toLowerCase() + ':' + timestamptzEpochMs(t.state_stamp)`
(`budgetPushKey.ts`'s normaliser, as `expensePostingKey` does) and domain `'expenses'` (so 0270 §5b's read scope covers
its outbox rows). Wire it in `erpnext-sweep/index.ts` as pass (7b), right after pass (7), under the same expenses-domain
ownership comment; add `'imprest-transfer': EXPENSE_JOURNAL_FROM_DOC_FIELDS` to the inbound field map and admit
`IMPREST_TRANSFER_KEY_RE` in the Journal Entry poll discriminator beside `EXPENSE_JOURNAL_KEY_RE`
(`expensePollDiscriminators.test.ts` gains `AC-IMP-072 the poll adopts an impt: journal and never an exp-keyed or
foreign one`).

Tests `supabase/functions/erpnext-sweep/imprestPostingBackstop.test.ts` (new):
- `AC-IMP-072 a paid replenishment posts once` — one dispatch, intent `pushed`, `erp_name` stamped.
- `AC-IMP-072 a retried tick reuses the key and adopts only its own document` — second tick replays by key, no second
  dispatch.
- `AC-IMP-072 a gate refusal marks the intent failed and the queue still drains`.
- `AC-IMP-072 an uncertain attempt stays failed/held and is reported, never re-decided`.

### S6.9 The posting badge (NFR-IMP-008)

`get_imprest_position` is unchanged (it never reads the ERP). `src/lib/db/imprest.ts` gains
`listPostingStates(floatId)` reading `imprest_posting_erp_mirror` (replenishments) and `expense_posting_erp_mirror` for
the float's records (both RLS-scoped, bounded 200 + 1); `ImprestFloatDetail.tsx` shows `posting.pending` /
`posting.failed` / `posting.uncertain` text beside each movement whose intent is not `pushed`. Test in
`ImprestFloatDetail.test.tsx`: `AC-IMP-072 a failed posting is shown beside its replenishment`.

### S6.10 0178, denominator, ACL, gate

- 0178: no new client-callable writer (the edge function writes as service role): count stays **102**.
- Denominator: table `imprest_posting_erp_mirror`; definers `enqueue_imprest_replenishment_posting()` and the re-created
  ones (already listed); edge function `imprest-cash-account`.
- `imprest_acl.test.sql`: `imprest_posting_for_push` and `org_employs_imprest_postings` executable by neither `anon` nor
  `authenticated`.
- Gate: slice gate + `0270_expense_postings_enqueue`, `0270_expense_posting_gate`, `0270_expense_postings_acl`,
  `0354_expense_direct_cost_account` pgTAP; `npx vitest run src/lib/adapterSeam/contractSuite
  src/lib/adapterSeam/erpnext/bodies/imprestTransfer.test.ts src/lib/adapterSeam/erpnext/expensePostingCommand.test.ts
  src/lib/adapterSeam/erpnext/expensePostingResolve.test.ts`; `deno test supabase/functions/imprest-cash-account
  supabase/functions/erpnext-sweep/imprestPostingBackstop.test.ts supabase/functions/erpnext-sweep/expensePollDiscriminators.test.ts`;
  `node scripts/check-edge-fn-test-binding.mjs`. The served-fn money e2e against the bench is not required for this PR;
  the Director runs one replenishment through the dev bench before the release PR to `main`. Commit
  `feat(imprest): site float ERP postings and imprest.transfer contract (#1515 S6)`.

---

## Traceability (AC -> owning test, one owner each)

| AC | Owning layer | Test file | Slice |
|---|---|---|---|
| AC-IMP-001, 002 | pgTAP | `supabase/tests/imprest_floats.test.sql` | S1 |
| AC-IMP-003 | pgTAP | `supabase/tests/imprest_replenishment.test.sql` | S2 |
| AC-IMP-010-014 | pgTAP | `supabase/tests/imprest_plans.test.sql` (AC-IMP-014's float-claim half in `imprest_routing.test.sql`) | S1, S2 |
| AC-IMP-020-025 | pgTAP | `supabase/tests/imprest_routing.test.sql` | S2 |
| AC-IMP-026 | pgTAP | `supabase/tests/imprest_line_lock.test.sql` | S2 |
| AC-IMP-030-034 | pgTAP | `supabase/tests/imprest_cash.test.sql` (AC-IMP-033's request half in `imprest_replenishment.test.sql`) | S2 |
| AC-IMP-040-046 | pgTAP | `supabase/tests/imprest_replenishment.test.sql` | S2 |
| AC-IMP-050-052 | pgTAP | `supabase/tests/imprest_position.test.sql` | S3 |
| AC-IMP-060 | pgTAP | `supabase/tests/imprest_acl.test.sql` (+ 0178 allow-list) | S1-S3, S6 |
| AC-IMP-061 | pgTAP | `supabase/tests/imprest_rls.test.sql` | S1, S3 |
| AC-IMP-062 | pgTAP | `supabase/tests/imprest_notify.test.sql` | S3 |
| AC-IMP-070, 071 | pgTAP | `supabase/tests/imprest_postings.test.sql` (+ unit: `expensePostingCommand.test.ts`, `expenseAccountRules` tests; Deno: `imprest-cash-account/index.test.ts`) | S6 |
| AC-IMP-072 | Unit + Deno | `contractSuite/imprestTransfer.suite.ts` (via `tiers.contract.test.ts`), `erpnext-sweep/imprestPostingBackstop.test.ts` | S6 |
| AC-IMP-080 | Unit | `pmo-portal/src/lib/db/imprest.test.ts` | S4 |
| AC-IMP-081 | Unit | `pmo-portal/src/lib/imprest/imprestRules.test.ts` (+ float cases in `src/lib/expenses/expenseRules.test.ts`) | S4 |
| AC-IMP-082 | Unit (RTL) | `pmo-portal/pages/ImprestFloats.test.tsx`, `pages/ImprestFloatDetail.test.tsx` | S5 |
| AC-IMP-083 | Unit | `pmo-portal/src/hooks/useImprest.test.tsx` | S4 |
| AC-IMP-084 | Unit (RTL) | `pmo-portal/pages/ExpenseClaimNew.test.tsx` (plan delta 4) | S5 |
| AC-IMP-085 | Unit | `pmo-portal/src/auth/policy.test.ts` | S4 |
| AC-IMP-090 | E2E | `pmo-portal/e2e/AC-IMP-090-site-imprest-journey.spec.ts` | S5 |

Mutation-worthy ACs (spec §10) and the mutation each slice records in its PR body: AC-IMP-002 (S1.7), 012 (S1.10), 021
(S2.1), 023/024 (S2.6), 030/032/033 (S2.7), 041/042 (S2.9), 044 (S2.10).

## Scaling and risk notes (planner lens)

- **Reads stay O(float).** Every figure filters `expense_claims` by `imprest_float_id` (partial index) and, for drawn,
  by `(imprest_float_id, imprest_month, budget_category)`. The `/imprest` list calls one position RPC per row, bounded
  at 200 floats; past that, a set-returning `get_imprest_positions(p_float_ids uuid[])` is the upgrade (not built:
  one client has a handful of sites).
- **Lock scope is one float.** The advisory key serializes only work on the same float; floats never contend.
- **Derived, not stored.** No balance column can drift; the cost is recomputing sums per call, cheap at site volumes
  (tens of movements a month). A materialized balance is the upgrade if a float ever carries thousands of open records.
- **Duplicate logic avoided:** routing (`spend_approval_route`), numbering, notifications, audit, receipts storage and the
  posting outbox are all reused; the only new money writer is the replenishment table.

## Paths confirmed on `origin/dev` (`3e1813899`)

`supabase/migrations/0247_expense_claims.sql`, `0270_expense_postings.sql`, `0243_spend_approval_routing.sql`,
`0237_workflow_notifications.sql`, `0342_evidence_binding.sql`, `0343_money_integrity.sql`, `0354_expense_direct_cost_account.sql`,
`supabase/tests/0178_anon_executable_definers.test.sql` (count 94), `supabase/tests/expense_claims_line_lock.test.sql`,
`supabase/tests/expense_claims_routing.test.sql`, `supabase/tests/expense_claims_transition.test.sql`,
`scripts/check-migration-collisions.sh`, `scripts/check-isolation-denominator.mjs`, `scripts/isolation-probe-denominator.json`,
`pmo-portal/src/lib/db/expenseClaims.ts`, `src/lib/expenses/expenseRules.ts`, `src/hooks/useExpenseClaims.ts`,
`src/lib/repositories/index.ts`, `src/auth/policy.ts`, `src/lib/appError.ts`, `pages/ExpenseClaimNew.tsx`,
`pages/Approvals.tsx`, `pages/approvals/ExpenseClaimApprovalSection.tsx`, `src/components/shell/Rail.tsx`,
`src/components/shell/routeMatch.ts`, `App.tsx`, `public/locales/{en,id}/`, `src/lib/adapterSeam/connect/workflows.ts`,
`src/lib/adapterSeam/contractSuite/{harness,index,tiers,tiers.contract.test,tierBranch.test}.ts`,
`src/lib/adapterSeam/{erpnext,odoo}/workflowDeclarations.ts`, `src/lib/adapterSeam/erpnext/{doctypeRegistry,doctypeBodies,expensePostingCommand,expensePostingKey,expensePostingResolve,accountFetch}.ts`,
`src/lib/adapterSeam/erpnext/bodies/{expenseJournal,expensePayment}.ts`,
`supabase/functions/erpnext-sweep/{index,expensePostingBackstop}.ts`, `supabase/functions/erpnext-sweep/expensePollDiscriminators.test.ts`,
`scripts/with-db-lock.sh`, `scripts/e2e-local.sh`, `scripts/ux-proof.sh`.
