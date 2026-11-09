-- Reverses 0721: both helpers return to their 0376 / 0497 bodies (engine always run). Owner and grants are unchanged.
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
     and (p_fiscal_year is null or c.fiscal_year = p_fiscal_year)
     and exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id())
   group by c.category
$$;
