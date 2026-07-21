-- 0141_get_budget_projection.sql — ERPNext P3c slice 6 (spec §5.7, FR-BUD-151/153, AC-BUD-053).
--
-- PMO's FORWARD VIEW, derived ON READ, never stored, NEVER pushed (FR-BUD-160). ⚑ "Projection" here is
-- PMO's own forward-looking derived view — NOT ADR-0055 §6's "projected into the ERP object" (that means
-- PUSHED; see pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.ts). Nothing this function computes
-- is ever sent to ERP.
--
-- SECURITY INVOKER (the get_project_budget idiom, 0005): it runs under the CALLER'S RLS, so org isolation
-- comes from the underlying tables' SELECT policies — no hand-rolled org filter, no security-definer.
--
-- Grain = PMO's CATEGORY (PMO is SoT, OD-BUDGET-1). Joining ERP account-grained actuals back to a
-- category requires the map's INVERSE — which is exactly why budget_category_account_map is a BIJECTION
-- (FR-BUD-111): without unique(org, erp_account) this join would be ambiguous and PMO would have to
-- INVENT a split (ADR-0048 violation).
--
-- A FULL OUTER join across (pmo budget lines) × (mapped actuals) × (PMO ETC rows): a category with an
-- actual or an ETC but NO budget line at all must still surface — an inner join would silently drop it,
-- hiding spend against a category the team never budgeted (worse than a big negative variance).
--
-- Money arithmetic is SQL `numeric`; the JS twin (pmo-portal/src/lib/budget/budgetProjection.ts) is the
-- unit oracle and MUST agree (AC-BUD-050/051 ↔ AC-BUD-053; supabase/tests/budget_projection_rpc.test.sql).
--
-- Reversibility (ADR-0006): drop function if exists public.get_budget_projection(uuid, text);

create or replace function public.get_budget_projection(p_project_id uuid, p_fiscal_year text)
returns table (
  category              public.budget_category,
  pmo_budget_amount     numeric,
  actuals_to_date       numeric,
  pmo_etc               numeric,
  projected_final_cost  numeric,
  projected_variance    numeric,
  projected_utilization numeric,
  push_state            text,
  push_error            text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with pmo_budget as (
    -- PMO SoT (OD-BUDGET-1): Sigma the ACTIVE version's line items per category. Not an ERP read-back.
    select li.category, sum(li.budgeted_amount) as pmo_budget_amount
      from public.budget_versions v
      join public.budget_line_items li on li.budget_version_id = v.id
     where v.project_id = p_project_id and v.status = 'Active'
     group by li.category
  ),
  actuals as (
    -- ERP GL truth (P2's shipped snapshot), mapped account -> category via the BIJECTION's inverse.
    select m.category, sum(s.net) as actuals_to_date
      from public.erp_actuals_snapshot s
      join public.budget_category_account_map m
        on m.org_id = s.org_id and m.erp_account = s.account
     where s.project_id = p_project_id and s.fiscal_year = p_fiscal_year
     group by m.category
  ),
  etc as (
    select bp.category, bp.pmo_etc
      from public.budget_projections bp
     where bp.project_id = p_project_id and bp.fiscal_year = p_fiscal_year
  ),
  push as (
    select em.push_state, em.push_error
      from public.budget_version_erp_mirror em
      join public.budget_versions v on v.id = em.budget_version_id
     where v.project_id = p_project_id and v.status = 'Active' and em.fiscal_year = p_fiscal_year
     limit 1
  ),
  -- ⚑ HIGH-C (Luna re-audit round 2, 2026-07-21) — "no row" is a STATE, not an absence of news.
  -- EVERY writer of `budget_version_erp_mirror` lives inside the `adapter-dispatch` edge function, so a
  -- dispatch that never REACHES it (dropped connection, tab closed mid-request, platform 502) leaves NO
  -- mirror row at all — and the sweep backstop's work queue IS that mirror, so nothing re-drives it and
  -- nobody is ever notified. `push_state` then came back NULL, which the operator surface renders as a
  -- perfectly clean screen while ERPNext keeps enforcing the previous budget (or none) indefinitely.
  -- The DB itself is the honest witness: an Active version carrying its `activated_at` stamp, in an org
  -- that HAS handed the `budget` domain to the ERPNext tier, with no mirror row for ANY fiscal year.
  --   • scoped on "any fiscal year", not this one, so viewing a year the push does not cover is NOT a
  --     false alarm (it stays NULL);
  --   • gated on real domain ownership, so a non-employing org — which has no ERP to push to — never
  --     sees a push banner at all;
  --   • a RECORDED push state always wins (this is only ever consulted when `push` is empty).
  unrecorded as (
    select 1
     where exists (
             select 1 from public.budget_versions v
              where v.project_id = p_project_id and v.status = 'Active' and v.activated_at is not null)
       and not exists (
             select 1 from public.budget_version_erp_mirror em
               join public.budget_versions v on v.id = em.budget_version_id
              where v.project_id = p_project_id and v.status = 'Active')
       and exists (
             select 1 from public.projects p
              where p.id = p_project_id
                and public.domain_owned_by_tier(p.org_id, 'budget', 'erpnext'))
  ),
  cells as (
    -- FULL OUTER: an ETC or an actual on a category the Active version does not budget MUST surface —
    -- never an inner join that silently drops it.
    select coalesce(b.category, a.category, e.category) as category,
           b.pmo_budget_amount,
           coalesce(a.actuals_to_date, 0) as actuals_to_date,
           coalesce(e.pmo_etc, 0)         as pmo_etc
      from pmo_budget b
      full outer join actuals a on a.category = b.category
      full outer join etc     e on e.category = coalesce(b.category, a.category)
  )
  select c.category,
         c.pmo_budget_amount,
         c.actuals_to_date,
         c.pmo_etc,
         (c.actuals_to_date + c.pmo_etc) as projected_final_cost,
         -- the JS oracle yields -EAC when there is no budget line at all; keep the two in step with an
         -- explicit case (a plain subtraction would yield NULL and lose the signal that spend happened
         -- against an unbudgeted category).
         case when c.pmo_budget_amount is null then -(c.actuals_to_date + c.pmo_etc)
              else c.pmo_budget_amount - (c.actuals_to_date + c.pmo_etc) end as projected_variance,
         -- NULLIF => NULL on a zero/absent budget: never a divide-by-zero, never Infinity (AC-BUD-051).
         ((c.actuals_to_date + c.pmo_etc) / nullif(c.pmo_budget_amount, 0)) as projected_utilization,
         coalesce(
           (select push_state from push),
           case when exists (select 1 from unrecorded) then 'never-pushed' end
         ),
         (select push_error from push)
    from cells c
   order by c.category;
$$;

revoke all on function public.get_budget_projection(uuid, text) from public;
grant execute on function public.get_budget_projection(uuid, text) to authenticated;
revoke execute on function public.get_budget_projection(uuid, text) from anon;
