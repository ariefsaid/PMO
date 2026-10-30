-- Group attributed ledger entries once per year, with the same authority and employee narrowing as
-- cost_attribution_project_actuals. The public summary below retains caller RLS for tagged snapshots.
create function public.budget_attributed_year_sums(p_project_id uuid, p_fiscal_years text[])
returns table(fiscal_year text, category public.budget_category, source_sum numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.fiscal_year, m.category, sum(a.amount), max(a.as_of)
    from public.cost_attribution_allocations(public.auth_org_id(), null, null, p_project_id) a
    join public.budget_category_account_map m on m.org_id = public.auth_org_id() and m.erp_account = a.account
   where public.is_active_member()
     and a.fiscal_year = any(p_fiscal_years)
     and (a.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
     and exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id())
   group by a.fiscal_year, m.category
$$;
alter function public.budget_attributed_year_sums(uuid,text[]) owner to postgres;
revoke all on function public.budget_attributed_year_sums(uuid,text[]) from public, anon, authenticated;
grant execute on function public.budget_attributed_year_sums(uuid,text[]) to authenticated;

create function public.first_budget_spending_year(p_project_id uuid, p_fiscal_years text[])
returns text language sql stable security invoker set search_path = public, pg_temp as $$
  with generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
     where s.org_id = public.auth_org_id()
     order by s.created_at desc, s.id desc limit 1
  ), reading as materialized (
    select s.* from public.erp_actuals_snapshot s
     where s.org_id = public.auth_org_id() and s.project_id = p_project_id
       and s.snapshot_id = (select snapshot_id from generation)
       and s.fiscal_year = any(p_fiscal_years)
       and exists (select 1 from public.projects p where p.id = p_project_id)
  ), tagged as (
    select r.fiscal_year, m.category, sum(r.net) as source_sum
      from reading r join public.budget_category_account_map m
        on m.org_id = r.org_id and m.erp_account = r.account
     group by r.fiscal_year, m.category
  ), attributed as materialized (
    select * from public.budget_attributed_year_sums(p_project_id, p_fiscal_years)
     where exists (select 1 from public.projects p where p.id = p_project_id)
  ), reading_dates as (
    select fiscal_year, max(as_of) as as_of from (
      select fiscal_year, as_of from reading
      union all select fiscal_year, as_of from attributed
    ) dates group by fiscal_year
  ), categories as (
    select coalesce(t.fiscal_year, a.fiscal_year) as fiscal_year,
      case when t.category is not null and a.category is not null then t.source_sum + a.source_sum
           when t.category is not null then t.source_sum else a.source_sum end as source_sum
      from tagged t full join attributed a on a.fiscal_year = t.fiscal_year and a.category = t.category
  )
  select y.fiscal_year from unnest(p_fiscal_years) with ordinality y(fiscal_year, position)
   where exists (select 1 from categories c join reading_dates d using (fiscal_year)
                  where c.fiscal_year = y.fiscal_year and d.as_of is not null and c.source_sum <> 0)
   order by y.position limit 1
$$;
revoke all on function public.first_budget_spending_year(uuid,text[]) from public, anon, authenticated;
grant execute on function public.first_budget_spending_year(uuid,text[]) to authenticated;
