-- Reverses 0651: project_committed_spend returns to its 0373 row-by-row body; drops procurement_ledger_held_many.
create or replace function public.project_committed_spend(p_project_id uuid)
returns table (currency text, amount numeric, is_project_currency boolean)
language sql stable security invoker set search_path = public, pg_catalog as $$
  with proj as (
    select pr.id, pr.currency from public.projects pr where pr.id = p_project_id
  ), positions as (
    select p.currency, sum(public.procurement_open_commitment(p)) as amount
      from public.procurements p join proj on p.project_id = proj.id
     where p.status::text = any (public.committed_procurement_statuses())
     group by p.currency
  )
  select proj.currency, coalesce(pos.amount, 0)::numeric, true
    from proj left join positions pos on pos.currency = proj.currency
  union all
  select pos.currency, pos.amount, false
    from positions pos cross join proj
   where pos.currency is distinct from proj.currency and pos.amount <> 0
  order by 3 desc, 1
$$;
drop function public.procurement_ledger_held_many(uuid[]);
