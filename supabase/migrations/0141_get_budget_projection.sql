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

-- `create or replace` CANNOT change a function's OUT columns ("cannot change return type of existing
-- function"), and NEW-6 adds one. Dropping first keeps this migration re-runnable against a database
-- that already has the previous shape, instead of failing halfway through the file.
drop function if exists public.get_budget_projection(uuid, text);

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
  push_error            text,
  -- ⚑ NEW-6 (audit round 4, 2026-07-22) — the blocking category NAMES, not just the code.
  -- `recordBudgetGateFailure` (adapter-dispatch) has always PERSISTED these (0137), because FR-BUD-113
  -- collected them precisely so an operator gets a to-do list. Nothing ever read them back: this RPC
  -- returned only `push_state`/`push_error`, so the primary money screen could render nothing but the
  -- bare code `budget-category-unmapped` — telling the Admin that *something* is unmapped while
  -- withholding the one fact that makes it fixable.
  -- The code STAYS in `push_error` (it is the machine-matchable token other logic keys on); the names
  -- ride ALONGSIDE it rather than replacing it. NULL when the failure had nothing to do with the map.
  unmapped_categories   text[]
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
    select em.push_state, em.push_error, em.unmapped_categories
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
  --
  -- ⚑ H-3 (Luna audit round 3, 2026-07-22) — the alarm no longer requires an activation STAMP.
  -- `0139` added `budget_versions.activated_at` nullable with NO backfill, so every version already
  -- Active at migration time carries NULL. Requiring the stamp here made that entire population
  -- INVISIBLE: `push_state` came back NULL and the screen looked clean while ERPNext enforced nothing
  -- at all — the exact failure the state above was introduced to kill, on the exact population a
  -- nullable-additive column creates. The stamp is not what makes an Active version real; it is what
  -- makes it PUSHABLE. So an unstamped Active version is reported as its own state rather than
  -- silently swallowed, because the operator's route out of it is different: `budgetPushKey` AND the
  -- server-side budget gate both refuse an unstamped version (deliberately — a money command keyed on
  -- an invented timestamp is worse than one that never runs), so Retry cannot help and is not offered.
  -- Activating a fresh version records a REAL activation act, which is both truthful and pushable.
  active_version as (
    select v.id, v.activated_at
      from public.budget_versions v
     where v.project_id = p_project_id and v.status = 'Active'
     limit 1
  ),
  unrecorded as (
    select case when (select av.activated_at from active_version av) is null
                then 'unstamped-activation'
                else 'never-pushed' end as state
     where exists (select 1 from active_version)
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
           (select state from unrecorded)
         ),
         (select push_error from push),
         -- NEW-6: only ever from a RECORDED push row. The `unrecorded` inference above ('never-pushed' /
         -- 'unstamped-activation') is derived from the ABSENCE of a mirror row, so by construction it has
         -- no category names to offer — NULL there is the truth, not a gap.
         (select unmapped_categories from push)
    from cells c
   order by c.category;
$$;

revoke all on function public.get_budget_projection(uuid, text) from public;
grant execute on function public.get_budget_projection(uuid, text) to authenticated;
revoke execute on function public.get_budget_projection(uuid, text) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- H-4 (Luna audit round 3, 2026-07-22) — WHICH fiscal years may be asked for.
--
-- `p_fiscal_year` above is matched by EQUALITY against `erp_actuals_snapshot.fiscal_year` and
-- `budget_version_erp_mirror.fiscal_year`, and both carry the ERPNext **Fiscal Year NAME** — whatever
-- the client declared in their own calendar (round-2 OQ-BUD-3b: `budgetGate.ts` resolves the push's
-- fiscal year from the client's `Fiscal Year` doctype BY NAME). A Jul–Jun client's is '2025-2026'.
--
-- The screen used to synthesize `new Date().getFullYear()`. For any non-calendar client that joins
-- NOTHING: actuals 0.00, variance = the entire budget, utilization ~0, no push banner — every figure
-- on the primary money screen silently wrong, with no way to navigate to the real year. The fix is
-- not a smarter format guess (PMO does not own the client's calendar and must never invent it) but to
-- offer ONLY years that exist in data, for ANY fiscal calendar:
--   • the mirror's own pushed years (every version, not just the Active one — a prior year's push is
--     legitimately inspectable), flagging the ACTIVE version's year as the sensible default;
--   • the ERP GL actuals' years;
--   • the PMO ETC rows' years.
-- No rows at all is an honest empty state ("no fiscal year on record"), never a fabricated year.
--
-- SECURITY INVOKER, exactly as above: RLS on the three source tables is the org boundary.
--
-- Reversibility (ADR-0006): drop function if exists public.list_budget_fiscal_years(uuid);
create or replace function public.list_budget_fiscal_years(p_project_id uuid)
returns table (fiscal_year text, is_active_push boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with active_push as (
    select em.fiscal_year
      from public.budget_version_erp_mirror em
      join public.budget_versions v on v.id = em.budget_version_id
     where v.project_id = p_project_id and v.status = 'Active'
  ),
  observed as (
    select em.fiscal_year
      from public.budget_version_erp_mirror em
      join public.budget_versions v on v.id = em.budget_version_id
     where v.project_id = p_project_id
    union
    select s.fiscal_year from public.erp_actuals_snapshot s where s.project_id = p_project_id
    union
    select bp.fiscal_year from public.budget_projections bp where bp.project_id = p_project_id
  )
  select o.fiscal_year,
         exists (select 1 from active_push ap where ap.fiscal_year = o.fiscal_year) as is_active_push
    from observed o
   -- `erp_actuals_snapshot.fiscal_year` is nullable (0101): a GL row whose fiscal year ERPNext never
   -- stated cannot be selected by an equality match anyway, so offering it would be an option that
   -- returns nothing. The empty string is the "no year selected" sentinel and is never an offer.
   where o.fiscal_year is not null and o.fiscal_year <> ''
   order by o.fiscal_year desc;
$$;

revoke all on function public.list_budget_fiscal_years(uuid) from public;
grant execute on function public.list_budget_fiscal_years(uuid) to authenticated;
revoke execute on function public.list_budget_fiscal_years(uuid) from anon;
