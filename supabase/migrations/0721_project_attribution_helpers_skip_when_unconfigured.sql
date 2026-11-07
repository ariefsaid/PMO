-- 0721 (Q12 perf): the two per-project actuals helpers behind the project page skip their engine when the org has nothing configured.
-- Cause: get_project_overview_read -> get_project_finances -> project_finance_actuals -> project_mapped_actuals reads
--   cost_attribution_project_actuals() and equipment_charge_project_actuals(). Each reaches a large SQL engine
--   (cost_attribution_engine / equipment_hire_charges) that is planned and run on every call even for an org with no
--   attribution rule and no equipment cost setting, where it can only return zero rows (about 90 ms each on the seed).
--   0720 guarded the org-wide twins for the dashboards; this is the same change for the per-project pair.
-- Change: one uncorrelated EXISTS per helper. The engine function scan is then never executed. Same bodies otherwise
--   (0376 / 0497), same security definer, owner, search_path and grants (create or replace keeps them). Output is identical:
--   no current rule and no actual_cost setting => no allocation row; no hire_rate setting => no charge row.
-- Rollback: supabase/migrations/rollback/0721_project_attribution_helpers_skip_when_unconfigured_down.sql
-- No begin/commit: the rollback round trip wraps this file in its own transaction.

create or replace function public.cost_attribution_project_actuals(p_project_id uuid, p_fiscal_year text default null)
returns table(category public.budget_category, n bigint, amount numeric, source_sum numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.category, count(*),
         case when count(*) filter (where a.amount is null or a.amount::text in ('NaN','Infinity','-Infinity')) > 0
              then null else sum(a.amount) end,
         sum(a.amount), max(a.as_of)
    from public.cost_attribution_allocations(public.auth_org_id(), null, null, p_project_id) a
    join public.budget_category_account_map m on m.org_id = public.auth_org_id() and m.erp_account = a.account
   where public.is_active_member()
     and (exists (select 1 from public.cost_attribution_rules r where r.org_id = public.auth_org_id() and r.is_current)   -- 0721
          or exists (select 1 from public.equipment_costing_settings s where s.org_id = public.auth_org_id() and s.basis = 'actual_cost'))
     and (p_fiscal_year is null or a.fiscal_year = p_fiscal_year)
     and (a.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
     and exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id())
   group by m.category
$$;

create or replace function public.equipment_charge_project_actuals(p_project_id uuid, p_fiscal_year text default null)
returns table(category public.budget_category, n bigint, amount numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.category, count(*), sum(c.amount), max(c.as_of)
    from public.equipment_hire_charges(public.auth_org_id(), null, p_project_id) c
   where public.is_active_member()
     and coalesce(public.auth_role()::text in ('Admin','Finance','Executive','Project Manager'), false)   -- FR-EQU-062
     and exists (select 1 from public.equipment_costing_settings s where s.org_id = public.auth_org_id() and s.basis = 'hire_rate')   -- 0721
     and (p_fiscal_year is null or c.fiscal_year = p_fiscal_year)
     and exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id())
   group by c.category
$$;
