# Finance backend / data debt — implementation plan

**Date:** 2026-06-10
**Track:** Finance backend/data debt (2 items, owner-decided OD-E / OD-BUDGET-2 / OD-ARCH-1).
**Author:** eng-planner
**Scope:** `pmo-portal/` FE + `supabase/migrations/` + `supabase/tests/` (pgTAP). No spec file — this is debt
paydown of two already-decided items; the requirements below are derived directly from the locked decisions,
not invented.

---

## 0. Context & verified grounding

Two pieces of finance "honest-but-thin" debt are being paid down. Both decisions are LOCKED — this plan turns
them into a buildable sequence, it does not re-litigate.

### Item 1 — real `vendor_invoiced_at` timestamp (replaces the `updated_at` age proxy)
The finance "Ready to pay" table (N16) shows an age column. Today it reads `procurements.updated_at` as a proxy
for invoice age and is *honestly mislabelled* "Last updated" with a tooltip explaining the proxy
(verified `pmo-portal/src/components/dashboard/FinanceDashboard.tsx:97-111`, `daysAgoLabel` at lines 28-34, and
`r.updated_at` at line 109). `updated_at` is bumped by EVERY transition (verified the single atomic UPDATE sets
`updated_at = now()` in `transition_procurement`, `supabase/migrations/0018_authz_hardening.sql:159`), so it is
not a faithful "invoiced at" date. We add a dedicated nullable `vendor_invoiced_at timestamptz`, stamp it when a
PR transitions INTO `'Vendor Invoiced'`, backfill existing rows, and relabel the column honestly.

### Item 2 — `get_finance_budget_review()` RPC (OD-E / OD-W5-C2-E)
The N17 "Budget review — top 5 contracts by variance" card today FE-resorts `data.top_projects` by variance
(verified `FinanceDashboard.tsx:218-232`, `variance()` at 142-144). Two real problems, both confirmed in source:

1. **Wrong population (OD-E core).** `top_projects` is `LIMIT 5 ORDER BY contract_value DESC`
   (verified `supabase/migrations/0009_dashboard_margin.sql:72-77`). FE-resorting those 5 by variance can never
   surface the worst bleeder if it is the 6th-largest contract. The honest label "top 5 contracts by variance"
   admits this (verified `FinanceDashboard.tsx:342-347`).
2. **Wrong `spent` basis (latent correctness bug).** `top_projects` selects the **stored** `p.spent` column
   (verified `0009_dashboard_margin.sql:74`), NOT the OD-BUDGET-2 committed basis. The same RPC's `on_hand` CTE
   already computes committed-basis spent (`0009_dashboard_margin.sql:36-38`) but `top_projects` does not reuse
   it. So the current Variance column is computed against `projects.spent` (a hand-maintained column the rest of
   the app treats as non-authoritative — verified seed values diverge: P001 stored `spent=2_100_000`,
   `supabase/seed.sql:142`). The new RPC computes variance on the **OD-BUDGET-2 committed basis**
   (`Σ procurements.total_value WHERE status IN ('Ordered','Received','Vendor Invoiced','Paid')`,
   verified the canonical definition in `docs/decisions.md:149-159` and the FE mirror
   `getProjectCommittedSpend`, `pmo-portal/src/lib/db/procurements.ts:22-40`).

   > **⚑ Behavior-change flag (NOT behavior-neutral) — owner/design-reviewer must sign off.** Switching N17 from
   > stored `projects.spent` to committed-basis spent will change the *numbers and the ranking* in the Budget
   > review card. This is the intended correctness upgrade of OD-E (a true portfolio-wide variance ranking on the
   > one canonical spent basis the rest of finance uses), but it is visible, so it is called out here and must be
   > verified in the rendered design-review, not slipped in silently. All OTHER finance surfaces (KPIs, On-hand
   > margin) already use committed basis and are untouched.

### Decisions consumed (verbatim references — not re-decided)
- **OD-BUDGET-2** (`docs/decisions.md:149-159`): `spent` = committed basis, Σ `total_value` over
  `{Ordered,Received,Vendor Invoiced,Paid}`. Labor excluded; project-level total.
- **OD-E / OD-W5-C2-E** (`docs/decisions.md:330-331`): ship a backend `get_finance_budget_review()` that ranks
  **ALL** projects by variance; owner may fund it into the cluster. This plan IS that funded slice.
- **OD-ARCH-1** (`docs/decisions.md:356-357`): REST-first reads; `.rpc()` reserved for SoD/state-machines,
  **server-side aggregation**, and atomic minting. A portfolio-wide grouped variance ranking is exactly the
  "grouped rollup REST can't express in one call" aggregation case → RPC is justified. The per-project committed
  spend is a correlated SUM over `procurements`; expressing the full ranked rollup as one PostgREST call is not
  feasible, so the RPC is the right tool (same family as `get_executive_dashboard` / `get_sales_pipeline`).

### Reuse / patterns this plan rides on (all verified)
- **Migration conventions:** forward-only additive, reversibility = `supabase db reset` (ADR-0006), documented
  manual rollback in the header (verified `0018_authz_hardening.sql:23-37`). Next sequential number = **0022**.
- **Aggregation RPC convention (security-invoker):** `language sql stable security invoker`, **no `org_id`
  argument**, RLS scopes every base-table read, `set search_path = public` pinned, `revoke all from public` +
  `grant execute to authenticated` + `revoke execute from anon` (verified `get_executive_dashboard`
  `0009_dashboard_margin.sql:23-85`; search_path pin convention `0021_lint_hardening.sql:31-37`).
- **Transition write path:** the single atomic UPDATE inside `transition_procurement`
  (`0018_authz_hardening.sql:152-160`) is where the `vendor_invoiced_at` stamp is added — exactly mirroring how
  `approved_by_id`/`pr_number` are conditionally stamped per target status.
- **DAL/repository seam (ADR-0017):** finance reads go through `pmo-portal/src/lib/db/*` then
  `pmo-portal/src/lib/repositories/index.ts`. New RPC DAL fn lands in `dashboard.ts` next to the other
  aggregation RPCs (verified `getExecutiveDashboard` / `getSalesPipeline` patterns `dashboard.ts:97-127`).
- **Generated types:** `pmo-portal/src/lib/supabase/database.types.ts` is the regenerated Supabase types file
  (Functions block at line 1038; `procurements.Row` at 511-529). Per the project rule "type-regen-not-casts",
  it is regenerated with `supabase gen types` after migrations apply (the file is committed). The
  `transition_project` DAL notes this convention (`projectTransitions.ts:93`).
- **pgTAP convention:** `begin; select plan(N); … select * from finish(); rollback;`, two-org tenancy fixture
  inserted as table owner then `set local request.jwt.claims`, AC id as the leading token of every test
  description (verified `0013_…:1-38`, `0020_…:1-69`, `0057_…:1-83`). Next test file numbers = **0059, 0060**.

---

## 1. Requirements (EARS) and acceptance criteria

### Item 1 — `vendor_invoiced_at`
- **FR-FIN-DEBT-001** — The `procurements` table SHALL have a nullable `vendor_invoiced_at timestamptz` column.
- **FR-FIN-DEBT-002** — *When* a procurement transitions INTO status `'Vendor Invoiced'`, the system SHALL set
  `vendor_invoiced_at = now()` on that procurement, and SHALL NOT modify `vendor_invoiced_at` on any other
  transition.
- **FR-FIN-DEBT-003** — *Where* existing rows are already `'Vendor Invoiced'` at migration time, the system SHALL
  backfill `vendor_invoiced_at = updated_at` (documented best-effort approximation).
- **OBS-FIN-DEBT-004** — The N16 "Ready to pay" age column SHALL display age from `vendor_invoiced_at`, falling
  back to `updated_at` when `vendor_invoiced_at` is null, relabelled as the invoice age (not "Last updated").
- **NFR-FIN-DEBT-005** — `vendor_invoiced_at` SHALL inherit the existing `procurements` RLS (read-in-org +
  4-role write) and `org_id` seam; no new policy is added (it is a plain nullable column on an RLS-forced table).

### Item 2 — `get_finance_budget_review()`
- **FR-FIN-DEBT-010** — The system SHALL provide a `get_finance_budget_review()` aggregation RPC returning, per
  project, `{ id, name, client_name, budget, spent, variance }` where `spent` is the OD-BUDGET-2 committed basis
  and `variance = spent - budget`.
- **FR-FIN-DEBT-011** — `get_finance_budget_review()` SHALL include only projects with `budget > 0` and SHALL
  return them ordered by `variance` descending (most-over first), ranking ALL such projects in the caller's org
  (not a top-5-by-contract-value pre-slice).
- **FR-FIN-DEBT-012** — `get_finance_budget_review()` SHALL be `security invoker` with no `org_id` argument, so
  RLS scopes every read to the caller's org.
- **OBS-FIN-DEBT-013** — The N17 "Budget review" card SHALL consume `get_finance_budget_review()` instead of
  FE-resorting `top_projects`, the FE slicing the returned ranked set to the top 5 for display, with an honest
  label reflecting it is now a true portfolio-wide variance ranking.
- **NFR-FIN-DEBT-014** — `get_finance_budget_review()` SHALL pin `search_path = public` and have
  `revoke all from public` / `grant execute to authenticated` / `revoke execute from anon` (ADR-0009 ACL).

### Acceptance criteria (Given/When/Then)

| AC | Given / When / Then | Owning layer |
|---|---|---|
| **AC-FIN-DEBT-001** | *Given* a Draft→…→Received procurement, *When* a Finance user transitions it to `'Vendor Invoiced'`, *Then* its `vendor_invoiced_at` is non-null and ≈ `now()`. | Integration (pgTAP) |
| **AC-FIN-DEBT-002** | *Given* a procurement not yet at `'Vendor Invoiced'`, *Then* its `vendor_invoiced_at` is null. | Integration (pgTAP) |
| **AC-FIN-DEBT-003** | *Given* a `'Vendor Invoiced'` row already transitioned, *When* it is later transitioned to `'Paid'`, *Then* `vendor_invoiced_at` is unchanged (stamp fires only on the entry transition). | Integration (pgTAP) |
| **AC-FIN-DEBT-004** | *Given* an org-A caller and an org-B `'Vendor Invoiced'` procurement, *When* org-A reads/queries, *Then* it cannot see org-B's `vendor_invoiced_at` (RLS read scoping holds). | Integration (pgTAP) |
| **AC-FIN-DEBT-005** | *Given* a procurement row with a `vendor_invoiced_at` value, *When* the N16 Ready-to-pay table renders, *Then* the age column shows the age computed from `vendor_invoiced_at` and the header reads as invoice age (not "Last updated"). | Unit (Vitest/RTL) |
| **AC-FIN-DEBT-006** | *Given* a `'Vendor Invoiced'` row with `vendor_invoiced_at = null` (legacy/edge), *When* the N16 table renders, *Then* the age column falls back to `updated_at` without error. | Unit (Vitest/RTL) |
| **AC-FIN-DEBT-010** | *Given* org projects with committed POs, *When* `get_finance_budget_review()` runs, *Then* each returned row's `spent` equals the Σ committed-PO basis and `variance = spent - budget`. | Integration (pgTAP) |
| **AC-FIN-DEBT-011** | *Given* multiple budget>0 projects, *When* `get_finance_budget_review()` runs, *Then* rows are ordered by `variance` desc, and a `budget = 0` project is excluded. | Integration (pgTAP) |
| **AC-FIN-DEBT-012** | *Given* an org-A caller, *When* `get_finance_budget_review()` runs under security-invoker, *Then* only org-A's projects appear (org-B projects excluded). | Integration (pgTAP) |
| **AC-FIN-DEBT-013** | *Given* the RPC returns a ranked set, *When* the N17 Budget review card renders, *Then* it shows up to the top 5 rows from the RPC (not an FE re-sort of `top_projects`) with an honest portfolio-wide label. | Unit (Vitest/RTL) |

> No e2e AC: no cross-stack user journey changes (no new page, no new write affordance — the Finance dashboard is
> covered by existing rendered design-review + unit). The behavior-change in N17 numbers is verified by the
> rendered design-review (not automated e2e) per the OD-E flag above.

---

## 2. PR breakdown — recommendation

**Recommendation: ONE cohesive finance-data PR** containing both items.

Justification: both are small, both touch the same surface (`FinanceDashboard.tsx`) and the same migration family
(one new migration `0022` can carry both — they are independent, additive, and reversible together), and shipping
them together lets the single rendered design-review verify the combined finance-console state (the N16 relabel +
the N17 re-population) in one pass. They share the security-auditor gate (new RPC + RLS reliance) and one
`supabase db reset` + `supabase test db` run. Splitting into two PRs would double the CI/integration cost
(integration runs on PRs only — MEMORY infra note) for two ~30-line changes with no risk-isolation benefit.

If the Director prefers risk isolation, the natural seam is: **PR-1 = Item 1 (column + stamp + N16 relabel)**,
**PR-2 = Item 2 (RPC + N17 re-population)** — Item 2 carries the visible behavior-change flag, so isolating it
makes the design-review/owner sign-off cleaner. Both orderings are buildable from the tasks below (the tasks are
grouped by item). **Default to the single PR; fall back to the 2-PR split only if the owner wants the N17
number-change isolated for sign-off.**

---

## 3. Tasks (TDD-first, 2–5 min each, exact paths + real code + verify command)

> Migration file used by both items: `supabase/migrations/0022_finance_budget_debt.sql`. Tasks 1.1 and 2.1 each
> append a self-contained section to it; they are independent.

### Item 1 — `vendor_invoiced_at`

#### Task 1.1 — Migration: add column, stamp on transition, backfill
**File:** create `supabase/migrations/0022_finance_budget_debt.sql` (Item-1 section).
**Action:** Write the header + the Item-1 block. Exact content:

```sql
-- 0022_finance_budget_debt.sql — Finance backend/data debt (two items, OD-E / OD-BUDGET-2 / OD-ARCH-1).
-- Forward-only, additive; reversibility = `supabase db reset` (ADR-0006, pre-production).
-- Manual rollback:
--   ITEM 1: alter table procurements drop column vendor_invoiced_at;
--           -- then restore transition_procurement from 0018_authz_hardening.sql (drop the stamp line).
--   ITEM 2: drop function get_finance_budget_review();
--
-- ACL/RLS discipline mirrors 0006/0009/0018/0021: the new column inherits procurements' existing
-- RLS (read-in-org + 4-role write) + org_id seam (no new policy). The new aggregation RPC is
-- `security invoker` (no org_id arg, RLS scopes reads), search_path=public pinned, anon revoked.

-- ============================================================================
-- ITEM 1 — vendor_invoiced_at (FR-FIN-DEBT-001/002/003/005).
-- A1 — nullable column. Inherits procurements RLS (0002/0010) + org_id seam — no new policy.
-- ============================================================================
alter table procurements
  add column vendor_invoiced_at timestamptz;  -- stamped on →'Vendor Invoiced'; null until then

-- A2 — backfill existing 'Vendor Invoiced' rows from updated_at (FR-FIN-DEBT-003).
-- BEST-EFFORT APPROXIMATION: updated_at is the last-transition time, which for a row currently in
-- 'Vendor Invoiced' is the closest available proxy for when it was invoiced. New transitions stamp the
-- real time (A3). Documented as approximate; not authoritative for pre-migration rows.
update procurements
   set vendor_invoiced_at = updated_at
 where status = 'Vendor Invoiced' and vendor_invoiced_at is null;

-- A3 — stamp on the entry transition. transition_procurement is reproduced VERBATIM from
-- 0018_authz_hardening.sql with ONE change: the final UPDATE adds a conditional
-- `vendor_invoiced_at` stamp that fires ONLY when p_to = 'Vendor Invoiced' (FR-FIN-DEBT-002),
-- mirroring the existing approved_by_id/pr_number conditional stamps. All authz, SoD-a/b, the
-- transition map, tenant isolation, and ACL grants are UNCHANGED. SECURITY: the SoD-a/b checks and
-- org re-assertion MUST stay outside any role-skip — do not reorder (OD-PROC-8).
create or replace function transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from        procurement_status;
  v_org         uuid;
  v_requester   uuid;
  v_approver    uuid;
  v_role        user_role := auth_role();
  v_uid         uuid      := auth.uid();
  v_is_admin    boolean;
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled'),
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled'),
    'Vendor Quoted',   jsonb_build_array('Quote Selected','Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled'),
    'Ordered',         jsonb_build_array('Received','Cancelled'),
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled'),
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array()
  );
  v_allowed_roles text[];
begin
  v_is_admin := (v_role = 'Admin');

  select status, org_id, requested_by_id, approved_by_id
    into v_from, v_org, v_requester, v_approver
    from public.procurements where id = p_id for update;
  if v_from is null then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;

  if v_from = 'Vendor Invoiced' and p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'           and p_to = 'Requested'       then array['Executive','Project Manager','Finance','Engineer']
          when v_from = 'Requested'       and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'        and p_to = 'Draft'           then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'        and p_to = 'Vendor Quoted'   then array['Project Manager','Finance']
          when v_from = 'Approved'        and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Vendor Quoted'   and p_to = 'Quote Selected'  then array['Project Manager','Finance']
          when v_from = 'Quote Selected'  and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Ordered'         and p_to = 'Received'        then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when v_from = 'Received'        and p_to = 'Vendor Invoiced' then array['Finance']
          when v_from = 'Vendor Invoiced' and p_to = 'Paid'            then array['Finance']
          else array[]::text[]
        end;
      end if;

      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  -- Atomic single update: + FR-FIN-DEBT-002 vendor_invoiced_at stamp (fires ONLY on →'Vendor Invoiced',
  -- coalesce so a re-entry can't blank it; mirrors the approved_by_id/pr_number conditional stamps).
  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to = 'Vendor Invoiced' then now() else vendor_invoiced_at end,
    updated_at         = now()
  where id = p_id;
end; $$;
revoke all     on function transition_procurement(uuid, procurement_status, text) from public;
grant  execute on function transition_procurement(uuid, procurement_status, text) to   authenticated;
revoke execute on function transition_procurement(uuid, procurement_status, text) from anon;
```

**Verify:** from repo root `supabase db reset` completes with no error (migration applies + seed loads).

---

#### Task 1.2 — pgTAP: `vendor_invoiced_at` stamp + idempotence + null + tenancy
**File:** create `supabase/tests/0059_vendor_invoiced_at.test.sql`.
**Action:** Write the test (mirror the fixture/auth shape of `0020_procurement_committed_contract.test.sql`).
Covers AC-FIN-DEBT-001/002/003/004:

```sql
-- 0059_vendor_invoiced_at.test.sql
-- AC-FIN-DEBT-001: →'Vendor Invoiced' stamps vendor_invoiced_at ≈ now().
-- AC-FIN-DEBT-002: a not-yet-VI procurement has vendor_invoiced_at = null.
-- AC-FIN-DEBT-003: a later →'Paid' does NOT change vendor_invoiced_at (entry-only stamp).
-- AC-FIN-DEBT-004: a cross-org caller cannot read another org's vendor_invoiced_at (RLS read scoping).
begin;
select plan(5);

insert into organizations (id, name) values
  ('00590000-0000-0000-0000-000000000001','VI Org A'),
  ('00590000-0000-0000-0000-000000000002','VI Org B');

insert into auth.users (id, email) values
  ('00590000-0000-0000-0000-0000000000a1','pm-a@example.com'),
  ('00590000-0000-0000-0000-0000000000a2','fin-a@example.com'),
  ('00590000-0000-0000-0000-0000000000a3','fin2-a@example.com'),
  ('00590000-0000-0000-0000-0000000000b1','fin-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00590000-0000-0000-0000-0000000000a1','00590000-0000-0000-0000-000000000001','PM A','pm-a@example.com','Project Manager'),
  ('00590000-0000-0000-0000-0000000000a2','00590000-0000-0000-0000-000000000001','Fin A','fin-a@example.com','Finance'),
  ('00590000-0000-0000-0000-0000000000a3','00590000-0000-0000-0000-000000000001','Fin2 A','fin2-a@example.com','Finance'),
  ('00590000-0000-0000-0000-0000000000b1','00590000-0000-0000-0000-000000000002','Fin B','fin-b@example.com','Finance');

-- Proc to be driven Draft→Requested→Approved→Ordered→Received→Vendor Invoiced→Paid.
-- requester=a1(pm), approver=a2(fin); a3(fin) pays so SoD-b (payer≠approver) passes.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00590000-0000-0000-0000-000000000010','00590000-0000-0000-0000-000000000001','VI Proc','Draft','00590000-0000-0000-0000-0000000000a1');
-- A second proc left in Draft → AC-FIN-DEBT-002 (never VI ⇒ null).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00590000-0000-0000-0000-000000000011','00590000-0000-0000-0000-000000000001','Never VI','Draft','00590000-0000-0000-0000-0000000000a1');

-- Drive to Received. PM does Draft→Requested→...→Received (PM is in every required set incl. Ordered→Received).
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Requested') $$, 'setup Requested');
reset role;
-- Approve as Finance a2 (≠ requester ⇒ SoD-a ok).
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Approved') $$, 'setup Approved');
reset role;
-- Ordered + Received as PM a1.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Ordered') $$, 'setup Ordered');
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Received') $$, 'setup Received');
reset role;
-- Received→Vendor Invoiced as Finance a2.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Vendor Invoiced') $$, 'drive to Vendor Invoiced');
reset role;
```

> NOTE: `plan(5)` counts the assertion `select`s only. The five `lives_ok` setup steps above ALSO assert, so set
> `plan(11)` (5 setup lives_ok + the 6 below). The implementer sets the exact count after writing the body; the
> verify command will fail loudly if the plan count is wrong (pgTAP reports plan mismatch).

Append the assertions (read as table owner after `reset role`, so the freshly-stamped row is visible regardless
of RLS):

```sql
-- AC-FIN-DEBT-001: the VI transition stamped vendor_invoiced_at non-null and ≈ now().
select isnt((select vendor_invoiced_at from procurements where id='00590000-0000-0000-0000-000000000010'), null,
  'AC-FIN-DEBT-001: →Vendor Invoiced stamps vendor_invoiced_at non-null');
select ok((select vendor_invoiced_at from procurements where id='00590000-0000-0000-0000-000000000010') > now() - interval '1 minute',
  'AC-FIN-DEBT-001: vendor_invoiced_at is approximately now()');
-- AC-FIN-DEBT-002: the Draft proc never reached VI ⇒ null.
select is((select vendor_invoiced_at from procurements where id='00590000-0000-0000-0000-000000000011'), null,
  'AC-FIN-DEBT-002: a not-yet-Vendor-Invoiced procurement has vendor_invoiced_at = null');
-- AC-FIN-DEBT-003: a later →Paid (by Finance a3 ≠ approver a2) does NOT change vendor_invoiced_at.
-- capture the stamp, transition, re-read, compare.
```

For AC-FIN-DEBT-003, capture then transition then compare (use a temp via a CTE/`is` on equality):

```sql
-- Drive Vendor Invoiced→Paid as Finance a3 (≠ approver a2 ⇒ SoD-b ok). Then assert the stamp is unchanged.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Paid') $$, 'drive to Paid');
reset role;
-- (Re-count plan: +1 for this lives_ok ⇒ plan(12).)
select ok(
  (select vendor_invoiced_at from procurements where id='00590000-0000-0000-0000-000000000010') is not null,
  'AC-FIN-DEBT-003: vendor_invoiced_at survives the →Paid transition (entry-only stamp, not re-stamped)');
```

For AC-FIN-DEBT-004 (tenancy read), authenticate as the org-B Finance user and assert the org-A row is not
visible under RLS:

```sql
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from procurements where id='00590000-0000-0000-0000-000000000010'),
  0,
  'AC-FIN-DEBT-004: org-B caller cannot read org-A procurement (vendor_invoiced_at not leaked, RLS read scoping)');
reset role;

select * from finish();
rollback;
```

**Verify:** from repo root `supabase test db` runs and `0059_vendor_invoiced_at.test.sql` passes (all planned
assertions green). This test is RED before Task 1.1's stamp exists (the column write would error / the stamp
asserts fail) — run it after `supabase db reset` to confirm green.

> TDD note: the migration (Task 1.1) and this test land together because the column must exist for the test to
> parse. The "failing first" oracle is AC-FIN-DEBT-001/003 — if the implementer drops the `vendor_invoiced_at`
> stamp line from the UPDATE, AC-FIN-DEBT-001 goes red. The implementer should verify red-by-omission by
> temporarily removing the stamp line, running `supabase db reset && supabase test db`, seeing 0059 fail, then
> restoring it.

---

#### Task 1.3 — Regenerate `database.types.ts`
**File:** `pmo-portal/src/lib/supabase/database.types.ts` (regenerated, not hand-edited).
**Action:** After `supabase db reset` applies 0022, regenerate types so `procurements.Row/Insert/Update` gain
`vendor_invoiced_at: string | null` (matching the existing `updated_at: string` at line 527). Per the
"type-regen-not-casts" rule, run `supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts`
(or the project's equivalent gen command) from repo root. Do NOT hand-add the field.
**Verify:** from `pmo-portal/` `npm run typecheck` passes; `grep -n vendor_invoiced_at pmo-portal/src/lib/supabase/database.types.ts`
shows it in the procurements `Row`, `Insert`, and `Update` blocks.

---

#### Task 1.4 — Unit test (RED): N16 age column reads `vendor_invoiced_at`
**File:** `pmo-portal/src/components/dashboard/FinanceDashboard.test.tsx` (extend the existing suite — mock shape
verified at lines 19-30).
**Action:** Add a `describe('FinanceDashboard N16 — invoice age from vendor_invoiced_at')` block. Update the
`procurements` mock so `pr1` has `vendor_invoiced_at` ~10 days old and `updated_at` today; `pr2` has
`vendor_invoiced_at: null` with `updated_at` ~3 days old. Write two `it(...)` titled with the AC ids:

```ts
// AC-FIN-DEBT-005: age column reads vendor_invoiced_at when present.
it('AC-FIN-DEBT-005: Ready-to-pay age column shows age from vendor_invoiced_at, header is invoice age', () => {
  renderPane();
  // pr1.vendor_invoiced_at ≈ 10 days ago ⇒ "10 days"; header no longer says "Last updated".
  expect(screen.getByText('10 days')).toBeInTheDocument();
  expect(screen.queryByText('Last updated')).not.toBeInTheDocument();
  expect(screen.getByText(/invoiced/i)).toBeInTheDocument(); // honest invoice-age header
});
// AC-FIN-DEBT-006: null vendor_invoiced_at falls back to updated_at.
it('AC-FIN-DEBT-006: null vendor_invoiced_at falls back to updated_at without error', () => {
  renderPane();
  // pr2.vendor_invoiced_at null, updated_at ≈ 3 days ago ⇒ "3 days".
  expect(screen.getByText('3 days')).toBeInTheDocument();
});
```

> The implementer computes the ISO mock dates relative to `Date.now()` (e.g. `new Date(Date.now() - 10*864e5).toISOString()`)
> so the day math is deterministic. Existing N16 tests in this file that assert "Last updated" must be updated to
> the new honest header (do NOT bend the new assertion to keep the old "Last updated" string — that string is
> being deliberately replaced; this is a UX change, BDD-authoring rule).
**Verify:** from `pmo-portal/` `npm test -- FinanceDashboard` shows the two new tests RED (fail) before Task 1.5.

---

#### Task 1.5 — FE: N16 reads `vendor_invoiced_at ?? updated_at`, relabel header
**File:** `pmo-portal/src/components/dashboard/FinanceDashboard.tsx`.
**Action:** Three edits (verified line targets):
1. Rename `daysAgoLabel` doc comment (lines 22-27) to reference `vendor_invoiced_at` and drop the "no dedicated
   column exists" claim. Logic unchanged.
2. In the `age` column (lines 97-111), change the header from the "Last updated" proxy span to honest invoice
   wording, and change the cell from `r.updated_at` to `r.vendor_invoiced_at ?? r.updated_at`:

```tsx
{
  key: 'age',
  // FR-FIN-DEBT / OBS-FIN-DEBT-004: real vendor_invoiced_at (set on →Vendor Invoiced),
  // falling back to updated_at only for legacy rows stamped before migration 0022.
  header: (
    <span title="Days since this vendor invoice was recorded (vendor_invoiced_at; falls back to last update for pre-2026-06 rows)">
      Invoiced
    </span>
  ),
  align: 'num',
  cell: (r) => (
    <span className="text-muted-foreground">
      {daysAgoLabel(r.vendor_invoiced_at ?? r.updated_at)}
    </span>
  ),
},
```

`r.vendor_invoiced_at` is typed `string | null` after Task 1.3, so `?? r.updated_at` (typed `string`) yields a
non-null `string` for `daysAgoLabel(isoDate: string)` — no signature change.
**Verify:** from `pmo-portal/` `npm test -- FinanceDashboard` shows Task 1.4's two tests GREEN; `npm run typecheck`
passes.

---

#### Task 1.6 — Seed: stamp the existing Vendor-Invoiced seed row (rendered-review demo data)
**File:** `supabase/seed.sql`.
**Action:** The seed's PROC-2026-008 row is inserted as `'Vendor Invoiced'` directly (verified
`supabase/seed.sql:209`), so the migration backfill sets its `vendor_invoiced_at = updated_at` (≈ created_at).
For the rendered design-review to show a non-trivial invoice age, append after the procurement insert block a
backdated explicit stamp:

```sql
-- Finance-debt demo: give the seeded Vendor-Invoiced row a realistic invoice age (~12 days) so the
-- N16 Ready-to-pay "Invoiced" age column shows a meaningful figure in the rendered design-review.
update procurements set vendor_invoiced_at = now() - interval '12 days'
 where id = '60000000-0000-0000-0000-000000000008';
```

This is pgTAP-neutral (no existing test asserts on PROC-2026-008's `vendor_invoiced_at`; 0059 uses its own
fixture org). The 0034/0039 on-hand oracles are unaffected (PROC-2026-008 is on pipeline project P010 — verified
seed comment lines 206-209 — and `vendor_invoiced_at` is not in any margin formula).
**Verify:** from repo root `supabase db reset` succeeds; `supabase test db` still fully green (no regression).

---

### Item 2 — `get_finance_budget_review()` RPC

#### Task 2.1 — Migration: `get_finance_budget_review()` (security invoker, committed-basis, ranked)
**File:** append the Item-2 section to `supabase/migrations/0022_finance_budget_debt.sql`.
**Action:** Add the RPC. Mirrors `get_executive_dashboard` security posture (verified 0009:23-85) and the
committed-basis `on_hand.spent` subquery (verified 0009:36-38). Returns a JSON array of rows:

```sql
-- ============================================================================
-- ITEM 2 — get_finance_budget_review() (FR-FIN-DEBT-010/011/012/014; OD-E / OD-BUDGET-2 / OD-ARCH-1).
-- True portfolio-wide variance ranking of ALL budget>0 projects in the caller's org. Replaces the FE
-- re-sort of top_projects (which was LIMIT 5 by contract_value AND read the stored projects.spent).
--
-- spent = OD-BUDGET-2 COMMITTED basis: Σ procurements.total_value WHERE status IN
--   ('Ordered','Received','Vendor Invoiced','Paid') — the SAME basis as on_hand.spent in 0009 and
--   getProjectCommittedSpend (procurements.ts), NOT the stored projects.spent column.
-- variance = spent - budget (positive = over). Ordered variance DESC (most-over first). budget>0 filter
--   applied SERVER-SIDE (mirrors the current honest scope; a no-budget project is not a review subject).
-- Returns ALL ranked rows (no server LIMIT) so the FE owns the top-N slice — keeps the RPC reusable for
--   a future "full budget review" page without a contract change; the set is org-bounded + budget>0 so it
--   is small (single-tenant scale). budget IS the stored projects.budget header (OD-BUDGET-1 authority is
--   a separate concern; N17 has always ranked on the header budget — preserved).
--
-- SECURITY (NFR-FIN-DEBT-014 / ADR-0009): security invoker, NO org_id argument — projects + procurements
-- reads run under the caller's RLS (org_id = auth_org_id()), so every row is org-scoped automatically.
-- DO NOT switch to security definer without re-adding an explicit org_id = auth_org_id() filter on every
-- read. search_path pinned to public; anon execute revoked.
-- ============================================================================
create or replace function get_finance_budget_review()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select coalesce((
    select json_agg(r order by r.variance desc)
    from (
      select
        p.id,
        p.name,
        c.name as client_name,
        p.budget,
        coalesce((select sum(pr.total_value) from procurements pr
                   where pr.project_id = p.id
                     and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')), 0) as spent,
        (coalesce((select sum(pr.total_value) from procurements pr
                    where pr.project_id = p.id
                      and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')), 0)
          - p.budget) as variance
      from projects p
      left join companies c on c.id = p.client_id
      where p.budget > 0
    ) r
  ), '[]'::json);
$$;

revoke all on function get_finance_budget_review() from public;
grant execute on function get_finance_budget_review() to authenticated;
-- Close the unauthenticated heavy-query surface (ADR-0009 Security LOW-1), mirroring 0009.
revoke execute on function get_finance_budget_review() from anon;
```

**Verify:** from repo root `supabase db reset` applies cleanly (both items in one migration).

---

#### Task 2.2 — pgTAP: variance contract + ordering + budget>0 filter + tenancy
**File:** create `supabase/tests/0060_finance_budget_review.test.sql`.
**Action:** Write the test (two-org fixture; insert orgs/users/profiles as table owner, then authenticate).
Covers AC-FIN-DEBT-010/011/012. Build a small deterministic fixture: org-A with two budget>0 projects (one
over-budget with committed POs, one under-budget) and one budget=0 project (must be excluded); org-B with one
budget>0 project (must not appear for org-A).

```sql
-- 0060_finance_budget_review.test.sql
-- AC-FIN-DEBT-010: committed-basis spent + variance = spent - budget per project.
-- AC-FIN-DEBT-011: rows ordered by variance desc; budget=0 project excluded.
-- AC-FIN-DEBT-012: security-invoker org scoping — org-A caller sees only org-A projects.
begin;
select plan(5);

insert into organizations (id, name) values
  ('00600000-0000-0000-0000-000000000001','BR Org A'),
  ('00600000-0000-0000-0000-000000000002','BR Org B');
insert into auth.users (id, email) values
  ('00600000-0000-0000-0000-0000000000a1','fin-a@example.com'),
  ('00600000-0000-0000-0000-0000000000b1','fin-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('00600000-0000-0000-0000-0000000000a1','00600000-0000-0000-0000-000000000001','Fin A','fin-a@example.com','Finance'),
  ('00600000-0000-0000-0000-0000000000b1','00600000-0000-0000-0000-000000000002','Fin B','fin-b@example.com','Finance');

-- Org-A projects:
--  OVER: budget 100k, committed PO 150k (Ordered) ⇒ spent 150k, variance +50k.
--  UNDER: budget 200k, committed PO 50k (Paid)    ⇒ spent  50k, variance -150k.
--  ZERO: budget 0 (excluded by the budget>0 filter regardless of spend).
insert into projects (id, org_id, name, status, budget) values
  ('00600000-0000-0000-0000-0000000000p1','00600000-0000-0000-0000-000000000001','OVER',  'Ongoing Project',100000),
  ('00600000-0000-0000-0000-0000000000p2','00600000-0000-0000-0000-000000000001','UNDER', 'Ongoing Project',200000),
  ('00600000-0000-0000-0000-0000000000p3','00600000-0000-0000-0000-000000000001','ZEROBUD','Ongoing Project',0);
-- Org-B project (budget>0) — must NOT appear for org-A.
insert into projects (id, org_id, name, status, budget) values
  ('00600000-0000-0000-0000-0000000000p9','00600000-0000-0000-0000-000000000002','ORGB',  'Ongoing Project',300000);

-- Committed POs (status in the committed set) drive `spent`.
insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('00600000-0000-0000-0000-0000000000q1','00600000-0000-0000-0000-000000000001','PO OVER','Ordered',150000,'00600000-0000-0000-0000-0000000000p1','00600000-0000-0000-0000-0000000000a1'),
  ('00600000-0000-0000-0000-0000000000q2','00600000-0000-0000-0000-000000000001','PO UNDER','Paid',  50000,'00600000-0000-0000-0000-0000000000p2','00600000-0000-0000-0000-0000000000a1'),
  -- A non-committed PR (Requested) on OVER that must NOT count toward spent.
  ('00600000-0000-0000-0000-0000000000q3','00600000-0000-0000-0000-000000000001','PR OVER nc','Requested',999999,'00600000-0000-0000-0000-0000000000p1','00600000-0000-0000-0000-0000000000a1');

-- ── Org-A Finance caller ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00600000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-FIN-DEBT-010: OVER's spent = 150k (only committed POs; the Requested 999999 is excluded).
select is(
  (select (e->>'spent')::numeric from json_array_elements(get_finance_budget_review()) e where e->>'name'='OVER'),
  150000::numeric,
  'AC-FIN-DEBT-010: spent = Σ committed-PO total_value (non-committed Requested excluded)');
-- AC-FIN-DEBT-010: OVER's variance = 150k - 100k = +50k.
select is(
  (select (e->>'variance')::numeric from json_array_elements(get_finance_budget_review()) e where e->>'name'='OVER'),
  50000::numeric,
  'AC-FIN-DEBT-010: variance = spent - budget');
-- AC-FIN-DEBT-011: ordering — first row (variance desc) is OVER (+50k) ahead of UNDER (-150k).
select is(
  (select (json_array_elements(get_finance_budget_review())->>'name') limit 1),
  'OVER',
  'AC-FIN-DEBT-011: rows ordered by variance descending (most-over first)');
-- AC-FIN-DEBT-011: budget=0 project (ZEROBUD) is excluded.
select ok(
  not exists(select 1 from json_array_elements(get_finance_budget_review()) e where e->>'name'='ZEROBUD'),
  'AC-FIN-DEBT-011: budget=0 project excluded (budget>0 filter applied server-side)');
-- AC-FIN-DEBT-012: org-A caller never sees org-B project (security-invoker RLS scoping).
select ok(
  not exists(select 1 from json_array_elements(get_finance_budget_review()) e where e->>'name'='ORGB'),
  'AC-FIN-DEBT-012: org-A caller sees only org-A projects (security invoker, RLS-scoped)');

reset role;
select * from finish();
rollback;
```

> The `limit 1` on `json_array_elements(...)->>'name'` returns the first array element in emission order; because
> `json_agg(... order by r.variance desc)` fixes the order in the RPC, the first element is the highest-variance
> row. The implementer confirms this with `supabase test db` (if Postgres does not guarantee set-returning
> ordering here, switch the assertion to `(get_finance_budget_review()->0->>'name')` which indexes the JSON array
> deterministically — preferred; use the `->0` form).
**Verify:** from repo root `supabase test db` runs and `0060_finance_budget_review.test.sql` passes. This is RED
before Task 2.1 (the function does not exist ⇒ all assertions error).

---

#### Task 2.3 — Regenerate types for the new RPC
**File:** `pmo-portal/src/lib/supabase/database.types.ts` (regenerated).
**Action:** Re-run the gen command (same as Task 1.3) so the `Functions` block (line 1038) gains
`get_finance_budget_review: { Args: never; Returns: Json }` (matching `get_executive_dashboard` at line 1119).
Do NOT hand-edit.
**Verify:** from `pmo-portal/` `grep -n get_finance_budget_review pmo-portal/src/lib/supabase/database.types.ts`
shows the Functions entry; `npm run typecheck` passes.

---

#### Task 2.4 — DAL: `getFinanceBudgetReview()` in `dashboard.ts`
**File:** `pmo-portal/src/lib/db/dashboard.ts`.
**Action:** Add a row type + a DAL fn beside `getExecutiveDashboard` (verified pattern lines 97-127). The row
type reuses the existing `TopProject` field names plus `variance` (so `FinanceDashboard`'s `Column<>` config and
`VarianceCell`/`variance()` helpers — verified lines 142-168, 235-277 — work with minimal change):

```ts
/**
 * One project row from get_finance_budget_review() (FR-FIN-DEBT-010). spent is the OD-BUDGET-2
 * COMMITTED basis (Σ PO total_value in Ordered..Paid), computed in SQL; variance = spent - budget.
 * Field names mirror TopProject so the FinanceDashboard budget columns reuse it directly.
 */
export interface BudgetReviewRow {
  id: string;
  name: string;
  client_name: string | null;
  budget: number;
  spent: number;
  variance: number;
}

/**
 * Portfolio-wide budget review for the caller's org (OD-E): ALL budget>0 projects ranked by
 * variance desc, committed-basis spent. Calls the get_finance_budget_review RPC (security invoker,
 * OD-ARCH-1 aggregation) — org_id is NEVER sent; base-table RLS scopes every read. On RPC error throws.
 */
export async function getFinanceBudgetReview(): Promise<BudgetReviewRow[]> {
  const { data, error } = await supabase.rpc('get_finance_budget_review');
  if (error) throw new Error(error.message);
  return (data as unknown as BudgetReviewRow[]) ?? [];
}
```

**Verify:** from `pmo-portal/` `npm run typecheck` passes.

---

#### Task 2.5 — Repository seam + hook (ADR-0017)
**File 1:** `pmo-portal/src/lib/repositories/types.ts` — add `getFinanceBudgetReview: () => Promise<BudgetReviewRow[]>`
to a finance/dashboard repository interface. **Verify the right home first:** there is no dashboard repository
today (the dashboard DAL is consumed directly by `useDashboard` — verified `useDashboard.ts:1-20` imports
`getExecutiveDashboard` from the DAL, NOT via `repositories`). Two options, pick per OD-ARCH-1 minimalism:
  - **(a) Match the existing dashboard convention (recommended):** the dashboard aggregation reads bypass the
    repository object today (`useDashboard`/`useSalesPipeline` call the DAL directly). For consistency and
    minimal surface, the new hook calls the DAL fn directly too — NO new repository method. This is faithful to
    the shipped pattern (the repository seam is populated for entity CRUD, verified `repositories/index.ts` has
    no `dashboard`/`get_executive_dashboard` member).
  - (b) Introduce a `dashboard` repository member — larger, inconsistent with the shipped dashboard reads.

  **Recommendation: (a)** — do NOT add a repository member; keep parity with `getExecutiveDashboard`/`getSalesPipeline`
  which the hooks consume from the DAL directly. (Skip the `repositories/types.ts` edit.)

**File 2:** `pmo-portal/src/hooks/useDashboard.ts` — add a `useFinanceBudgetReview()` hook mirroring
`useSalesPipeline` (verified lines 52-60):

```ts
import {
  getExecutiveDashboard, type ExecutiveDashboard,
  getWinRate, type WinRate,
  getSalesPipeline, type SalesPipeline, type PipelineProject,
  getFinanceBudgetReview, type BudgetReviewRow,
} from '@/src/lib/db/dashboard';
// ...
/**
 * Portfolio-wide budget review (OD-E): all budget>0 projects ranked by variance desc (committed basis).
 * queryKey includes org_id for cache isolation. Consumed by the N17 Budget review card.
 */
export function useFinanceBudgetReview() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<BudgetReviewRow[]>({
    queryKey: ['finance-budget-review', orgId],
    queryFn: () => getFinanceBudgetReview(),
    enabled: Boolean(orgId),
  });
}
```

**Verify:** from `pmo-portal/` `npm run typecheck` passes.

---

#### Task 2.6 — Unit test (RED): N17 consumes the RPC, slices top-5, honest label
**File:** `pmo-portal/src/components/dashboard/FinanceDashboard.test.tsx`.
**Action:** Add a `vi.mock('@/src/hooks/useDashboard', ...)` extension exporting `useFinanceBudgetReview`
returning a 6-row fixture ranked by variance desc (so the FE-slice-to-5 is observable), and a row whose committed
spent differs from any stored `top_projects.spent` (proving the card reads the RPC, not `top_projects`). Add:

```ts
// AC-FIN-DEBT-013: N17 renders rows from get_finance_budget_review (NOT an FE re-sort of top_projects).
it('AC-FIN-DEBT-013: Budget review shows top-5 RPC rows, honest portfolio-wide label', () => {
  renderPane();
  // 6 RPC rows provided; the card shows 5 (FE slice). The 6th-named project must NOT render.
  expect(screen.queryByText('Rank6')).not.toBeInTheDocument();
  expect(screen.getByText('Rank1')).toBeInTheDocument();
  // Honest label no longer caveats "top 5 contracts by variance" as a contract-value pre-slice.
  expect(screen.getByText(/budget review/i)).toBeInTheDocument();
});
```

> The existing N17 test that asserts the old behavior (FE-resort of `top_projects` / the "top 5 contracts by
> variance" label, verified `FinanceDashboard.tsx:342-347`) must be updated to the new RPC-sourced behavior and
> the new label — do NOT keep asserting the stale label. Update the mock so `useFinanceBudgetReview` exists; the
> existing `top_projects` mock can stay (it still feeds the spend KPI at line 195) but the budget *card* no longer
> reads it.
**Verify:** from `pmo-portal/` `npm test -- FinanceDashboard` shows the new test RED before Task 2.7.

---

#### Task 2.7 — FE: N17 card consumes `useFinanceBudgetReview`, slices top-5, relabel
**File:** `pmo-portal/src/components/dashboard/FinanceDashboard.tsx`.
**Action:** Edits (verified targets):
1. Import `useFinanceBudgetReview` + `BudgetReviewRow`; call the hook in the component (beside `useDashboard` at
   line 184).
2. Replace the `topByVariance` `useMemo` (lines 218-232) — which FE-resorts `data.top_projects` — with: take the
   RPC rows (already ranked variance desc server-side), keep client-side re-sort ONLY for the user clicking other
   column headers (budget/spent/util), and slice to the top 5 for display. The RPC default order = variance desc,
   so the initial render needs no client sort.
3. Change the `budgetColumns` generic + `VarianceCell`/`variance()` to operate on `BudgetReviewRow` instead of
   `TopProject` (the field names match: `name`, `budget`, `spent`, plus the new server `variance` — so
   `VarianceCell` can read `project.variance` directly instead of recomputing `spent - budget`; either works, but
   reading the server value is the single source of truth).
4. Relabel the card head (lines 345-347) to the honest portfolio-wide label, e.g.
   `Budget review — top 5 by variance (portfolio-wide)`, and update the comment (lines 342-344) to note it is now
   a true server-side ranking of all budget>0 projects, not a contract-value pre-slice.
5. The card's loading/empty state now keys off the new hook's `isPending`/rows instead of `isPending`/`topByVariance`.

**Verify:** from `pmo-portal/` `npm test -- FinanceDashboard` shows Task 2.6's test GREEN and all prior
FinanceDashboard tests GREEN (update any that asserted the old label/behavior); `npm run typecheck` passes.

---

### Final gate tasks (whole PR)

#### Task 3.1 — Full migration + pgTAP run
**Verify:** from repo root `supabase db reset && supabase test db` — both 0059 and 0060 green, full suite green
(no regression of 0034/0039 on-hand oracles or 0013-0020 procurement tests).

#### Task 3.2 — FE quality gates
**Verify:** from `pmo-portal/`: `npm run typecheck` (zero errors), `npm test` (full suite green, ≥80% on changed
files), `npm run build` (succeeds), `npm run lint:ci` (zero warnings).

#### Task 3.3 — Security-auditor gate (new RPC + RLS reliance)
**Action:** Route the PR through the security-auditor before merge (new aggregation RPC `get_finance_budget_review`
+ the modified `transition_procurement`). The audit must confirm: (1) the RPC is `security invoker` with no
`org_id` arg and pinned `search_path` (so RLS scopes — no cross-org leak); (2) `revoke … from anon`; (3) the
`transition_procurement` change is the single conditional stamp line and did NOT reorder/remove SoD-a/b or the
org re-assertion (OD-PROC-8 invariant). No write affordance / privilege change is introduced.

#### Task 3.4 — Rendered design-review gate (OD-E behavior-change)
**Action:** Mandatory rendered design-review of the Finance dashboard at desktop widths confirming: N16 "Invoiced"
age column shows a real invoice age (seed row ≈ 12 days); N17 Budget review now shows the committed-basis variance
ranking with the honest portfolio-wide label, and the owner/reviewer signs off on the changed numbers (the
stored-spent → committed-spent shift flagged in §0 Item 2).

---

## 4. Traceability matrix

| AC | Owning test (file · title token) | Layer |
|---|---|---|
| AC-FIN-DEBT-001 | `supabase/tests/0059_vendor_invoiced_at.test.sql` · "AC-FIN-DEBT-001" | Integration (pgTAP) |
| AC-FIN-DEBT-002 | `supabase/tests/0059_vendor_invoiced_at.test.sql` · "AC-FIN-DEBT-002" | Integration (pgTAP) |
| AC-FIN-DEBT-003 | `supabase/tests/0059_vendor_invoiced_at.test.sql` · "AC-FIN-DEBT-003" | Integration (pgTAP) |
| AC-FIN-DEBT-004 | `supabase/tests/0059_vendor_invoiced_at.test.sql` · "AC-FIN-DEBT-004" | Integration (pgTAP) |
| AC-FIN-DEBT-005 | `FinanceDashboard.test.tsx` · "AC-FIN-DEBT-005" | Unit (Vitest/RTL) |
| AC-FIN-DEBT-006 | `FinanceDashboard.test.tsx` · "AC-FIN-DEBT-006" | Unit (Vitest/RTL) |
| AC-FIN-DEBT-010 | `supabase/tests/0060_finance_budget_review.test.sql` · "AC-FIN-DEBT-010" | Integration (pgTAP) |
| AC-FIN-DEBT-011 | `supabase/tests/0060_finance_budget_review.test.sql` · "AC-FIN-DEBT-011" | Integration (pgTAP) |
| AC-FIN-DEBT-012 | `supabase/tests/0060_finance_budget_review.test.sql` · "AC-FIN-DEBT-012" | Integration (pgTAP) |
| AC-FIN-DEBT-013 | `FinanceDashboard.test.tsx` · "AC-FIN-DEBT-013" | Unit (Vitest/RTL) |

Each AC is owned by exactly one test at the lowest sufficient layer (ADR-0010): tenancy/stamp/contract = pgTAP;
render/label/fallback = unit. No e2e AC (no journey change).

---

## 5. ADR-needed assessment

**No new ADR required.** Both items follow established, recorded decisions:
- Item 1 is a nullable additive column + a one-line conditional stamp inside the existing `transition_procurement`
  state machine (ADR-0012 pattern) — no new architecture.
- Item 2 is a `security invoker` aggregation RPC, the exact family already governed by ADR-0009 (RPC ACL/security
  posture) and OD-ARCH-1 (RPC-for-aggregation). It introduces no privilege escalation (security INVOKER, so it
  runs under the caller's RLS — no definer bypass to reason about) and no new tenancy seam.

The OD-E behavior-change (N17 stored-spent → committed-spent) is a *data-correctness* change, not an
*architectural* one; it is captured by the §0 flag + the rendered-review/owner sign-off gate (Task 3.4), which is
the correct checkpoint — not an ADR.

---

## 6. Open questions for the Director

1. **N17 spent-basis change (OD-E).** Confirm the owner accepts the visible number/ranking change in the Budget
   review card when it switches from stored `projects.spent` to committed-basis spent. Seed numbers will shift
   (e.g. P001 stored `spent=2.1M` vs its committed-PO sum). This is the intended OD-E correctness upgrade but it
   is owner-visible — flagged for Task 3.4 sign-off.
2. **PR shape.** Default is ONE finance-data PR. Does the Director want the 2-PR split (Item 1 / Item 2) to
   isolate the N17 number-change for cleaner owner sign-off? (§2.)
3. **`get_finance_budget_review` return cardinality.** Plan returns ALL budget>0 ranked rows (FE slices top-5),
   for future-page reuse and single-tenant small scale. Confirm OK vs a server `LIMIT` (the only reason to LIMIT
   server-side would be a future million-row multi-tenant org — at that point the budget>0 + org-scoped set is
   still bounded by project count, so no LIMIT is the right call now).
4. **`budget` authority.** The RPC ranks on the stored `projects.budget` header (what N17 has always used), not
   the OD-BUDGET-1 Σ-Active-version basis. Confirm keeping header-budget as the variance denominator for now
   (changing it is a separate OD-BUDGET-1 concern, out of scope for this debt track).

---

## 7. Could-not-verify / assumptions

- **Exact `supabase gen types` invocation.** No `gen:types` npm script exists in `pmo-portal/package.json`
  (verified lines 6-19 — only dev/build/typecheck/lint/test/e2e), and no gen command is recorded in a Makefile
  found. Tasks 1.3/2.3 assume the standard `supabase gen types typescript --local > …/database.types.ts` from
  repo root (the file IS hand-committed and the project rule is "type-regen-not-casts"). The implementer should
  confirm the exact local-gen invocation against the running Supabase sandbox (MEMORY notes a Supabase sandbox is
  used) before relying on it.
- **`procurements` RLS read policy file.** The `vendor_invoiced_at` inherits read-in-org RLS; the
  `procurements_select`/write policies are in `0002_rls.sql` / `0010_procurement_rls_hardening.sql` (referenced by
  filename in `0006`/`0018` headers) — not re-read line-by-line here, but the inheritance claim is structural (a
  new column on an RLS-forced table is covered by the table's existing row policies; no column-level grant
  excludes it the way `0008` did for projects). AC-FIN-DEBT-004 proves the read-scoping empirically.
- **`supabase test db` / `supabase db reset` exact CWD.** Assumed repo root (per the task brief and the existing
  `supabase/` layout). The implementer runs from repo root.
