-- One complete set of reserved positions, under the caller's existing row visibility.
-- Rollback: supabase/migrations/rollback/0395_project_reserved_spend_currency_down.sql
create function public.project_reserved_position(p_project_id uuid)
returns table (project_currency text, budget_currency text, positions jsonb)
language sql stable security invoker set search_path = public, pg_catalog as $$
  with project as (
    select p.id, p.currency,
      (select case when count(distinct v.currency) = 1 then min(v.currency) end
       from public.budget_versions v where v.project_id = p.id and v.status = 'Active') as budget_currency
    from public.projects p where p.id = p_project_id
  ), positions as (
    select p.currency, sum(p.total_value)::numeric as amount
    from public.procurements p join project pr on pr.id = p.project_id
    where p.status::text in ('Approved', 'Vendor Quoted', 'Quote Selected')
    group by p.currency
  )
  select pr.currency, pr.budget_currency,
    coalesce((select jsonb_agg(jsonb_build_object('currency', pos.currency, 'amount', pos.amount::text)
                               order by pos.currency nulls last) from positions pos), '[]'::jsonb)
  from project pr
$$;
revoke all on function public.project_reserved_position(uuid) from public, anon;
grant execute on function public.project_reserved_position(uuid) to authenticated;
