-- 0160_budget_push_status_binding_gate.sql — AC-BUD-003 / FR-BUD-006(a) / FR-BUD-010.
--
-- ⚑ SUPERSEDES the `get_budget_push_status` gate shipped in 0149 (do NOT edit 0149 in place). Budget is
-- Posture B: PMO stays SoT and NO `external_domain_ownership` row for 'budget' is ever created
-- (FR-BUD-006(a)). The spec is explicit and twice-stated (FR-BUD-010): "⚑ `domain_externally_owned` does
-- NOT gain a `budget` row — employment is asserted by the BINDING + the push route, not by a flip."
--
-- The 0149 `unrecorded` CTE gated the never-pushed / unstamped-activation inference on
-- `public.domain_owned_by_tier(p.org_id,'budget','erpnext')`, which reads exactly that forbidden
-- `external_domain_ownership` row (0135). This migration moves the gate to the SPEC-NAMED signal: an
-- ACTIVE ERPNext binding — byte-for-byte the shape the served boundary's `orgEmploysErpnext` predicate
-- uses (`external_org_bindings` with `external_tier='erpnext'` and `activated_at is not null`). Nothing
-- else about the function changes: SECURITY INVOKER, the recorded-wins ordering, the MEDIUM-1 outbox
-- hold-releasable read and every column are preserved exactly.
--
-- SECURITY INVOKER (unchanged): RLS on `external_org_bindings`
-- (`org_id = auth_org_id() and is_active_member()`) is the org boundary for the exists() probe, exactly
-- as it was for `domain_owned_by_tier` — a cross-org read cannot see another org's binding and so never
-- infers a push banner for it.
--
-- Reversibility (ADR-0006): re-run 0149's `create or replace function public.get_budget_push_status(uuid)`.

-- ⚑ The SPEC-NAMED employ predicate for Posture-B budget, as an RPC so the dispatch's server-side
-- authorization gate (`adapter-dispatch/authGuard.ts`) can assert it the same way it asserts
-- `domain_owned_by_tier` for the Posture-A domains. Budget NEVER has a `domain_externally_owned('budget')`
-- row (FR-BUD-006(a)); its employment is the ACTIVE ERPNext binding (FR-BUD-010) — this is byte-for-byte
-- the shape the served boundary's `orgEmploysErpnext` helper uses (`external_org_bindings` with
-- `external_tier='erpnext'` and `activated_at is not null`).
--
-- SECURITY INVOKER: under the caller's JWT (the deputy client on the synchronous push) RLS on
-- `external_org_bindings` restricts to the caller's own org, so a cross-org push cannot fabricate
-- employment; under service_role (the sweep's recovery pass) RLS is bypassed and it reads the row
-- directly — exactly the dual-caller posture `domain_owned_by_tier` already relies on.
--
-- Reversibility (ADR-0006): drop function if exists public.org_has_active_erpnext_binding(uuid);
create or replace function public.org_has_active_erpnext_binding(p_org_id uuid)
  returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.external_org_bindings
     where org_id = p_org_id and external_tier = 'erpnext' and activated_at is not null
  )
$$;

revoke all on function public.org_has_active_erpnext_binding(uuid) from public;
grant execute on function public.org_has_active_erpnext_binding(uuid) to authenticated;
grant execute on function public.org_has_active_erpnext_binding(uuid) to service_role;
revoke execute on function public.org_has_active_erpnext_binding(uuid) from anon;

-- ⚑ MERGE RECONCILIATION (2026-07-24 — integrating #369 into dev after #368/FU-2 landed). FU-2's `0153`
-- rewrote this function for PER-YEAR fiscal reporting (+ FR-BFY-056 `stale_attribution`) but KEPT the
-- forbidden `domain_owned_by_tier(...,'budget',...)` gate — the exact gate AC-BUD-003 removes. So this
-- supersedes 0153 with 0153's IDENTICAL per-year body and 8-column return shape, changing ONLY the `owns`
-- gate to the ACTIVE-binding signal (FR-BUD-006(a)/FR-BUD-010): budget NEVER gains an
-- `external_domain_ownership('budget')` row; employment is the binding. Return shape matches 0153 exactly
-- (no 42P13). `org_has_active_erpnext_binding` (above) is the spec-named predicate, shared with authGuard.
create or replace function public.get_budget_push_status(p_project_id uuid)
returns table (
  push_state          text,
  push_error          text,
  unmapped_categories text[],
  erp_budget_name     text,
  fiscal_year         text,
  pushed_at           timestamptz,
  hold_releasable     boolean,
  -- FR-BFY-056 (0153): a push that SUCCEEDED but whose recorded span no longer matches the project's
  -- current dates, on a version that still has un-phased lines — reported so the surface can name it.
  stale_attribution   boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with active_version as (
    select v.id, v.activated_at
      from public.budget_versions v
     where v.project_id = p_project_id and v.status = 'Active'
     limit 1
  ),
  proj as (
    select p.start_date, p.end_date from public.projects p where p.id = p_project_id
  ),
  mirror as (
    select em.fiscal_year, em.push_state, em.push_error, em.unmapped_categories, em.erp_budget_name,
           em.pushed_at, em.pushed_project_start_date, em.pushed_project_end_date
      from public.budget_version_erp_mirror em
      join active_version av on av.id = em.budget_version_id
  ),
  phased as (
    select distinct li.fiscal_year
      from public.budget_line_items li
      join active_version av on av.id = li.budget_version_id
     where li.fiscal_year is not null
  ),
  has_unphased as (
    select exists (
      select 1 from public.budget_line_items li
       join active_version av on av.id = li.budget_version_id
      where li.fiscal_year is null) as v
  ),
  -- ⚑ AC-BUD-003 / FR-BUD-006(a) / FR-BUD-010 (mig 0160, superseding 0153's gate) — employment is the
  -- ACTIVE ERPNext binding, NOT a `domain_externally_owned('budget')` flip (spec forbids that row, twice-
  -- stated). `org_has_active_erpnext_binding` is byte-for-byte the `orgEmploysErpnext` signal; a non-
  -- employing org (no ERP to push to) never sees a push banner. SECURITY INVOKER: RLS on
  -- `external_org_bindings` is the org boundary, exactly as it was for `domain_owned_by_tier`.
  owns as (
    select public.org_has_active_erpnext_binding(
             (select p.org_id from public.projects p where p.id = p_project_id)) as v
  ),
  inferred as (
    select case when not (select o.v from owns o) then null
                when (select av.activated_at from active_version av) is null then 'unstamped-activation'
                else 'never-pushed' end as state
     where exists (select 1 from active_version)
  ),
  expected as (
    select p.fiscal_year from phased p
    union
    select m.fiscal_year from mirror m
  ),
  per_year as (
    select e.fiscal_year,
           coalesce(m.push_state, (select i.state from inferred i)) as push_state,
           m.push_error, m.unmapped_categories, m.erp_budget_name, m.pushed_at,
           coalesce(
             (select hu.v from has_unphased hu)
             and m.push_state = 'pushed'
             and m.pushed_project_start_date is not null
             and ( m.pushed_project_start_date is distinct from (select pr.start_date from proj pr)
                or m.pushed_project_end_date   is distinct from (select pr.end_date   from proj pr) ),
             false) as stale_attribution
      from expected e
      left join mirror m on m.fiscal_year = e.fiscal_year
  )
  select py.push_state, py.push_error, py.unmapped_categories, py.erp_budget_name,
         py.fiscal_year, py.pushed_at,
         -- MEDIUM-1, per year: only a genuinely `held` OUTBOX row leaves something to release. Two
         -- identities accepted: the year-qualified id, and — only on a year that HAS a mirror row — the
         -- legacy bare `<vid>` written by the pre-fan-out single-FY dispatcher.
         exists (
           select 1
             from public.external_command_outbox o
             cross join active_version av
            where o.domain = 'budget' and o.state = 'held'
              and ( o.pmo_record_id = av.id::text || ':' || public.budget_fiscal_year_token(py.fiscal_year)
                 or (o.pmo_record_id = av.id::text
                     and exists (select 1 from mirror m2 where m2.fiscal_year = py.fiscal_year)) )
         ) as hold_releasable,
         py.stale_attribution
    from per_year py
  union all
  -- The "nothing to report" row: exactly one, only when no year is expected at all. Carries the
  -- inference (`never-pushed` / `unstamped-activation`) where it applies and NULLs otherwise.
  select (select i.state from inferred i), null, null, null, null, null,
         exists (
           select 1 from public.external_command_outbox o
             cross join active_version av
            where o.domain = 'budget' and o.state = 'held' and o.pmo_record_id = av.id::text
         ),
         false
   where not exists (select 1 from expected)
   order by 5 nulls last;
$$;

revoke all on function public.get_budget_push_status(uuid) from public;
grant execute on function public.get_budget_push_status(uuid) to authenticated;
revoke execute on function public.get_budget_push_status(uuid) from anon;
