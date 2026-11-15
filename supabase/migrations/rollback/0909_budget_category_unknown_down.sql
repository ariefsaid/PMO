-- Rollback 0909: restore the 0560 body of project_finance_actuals and the unfiltered categories list.
do $migration$
declare
  v_definition text;
  v_new constant text := 'order by category) from gl where category is not null)';
  v_old constant text := 'order by category) from gl)';
begin
  select pg_get_functiondef('public.get_project_finances(uuid)'::regprocedure) into v_definition;
  if length(v_definition) - length(replace(v_definition, v_new, '')) <> length(v_new) then
    raise exception '0909 rollback expected one filtered categories list in get_project_finances';
  end if;
  execute replace(v_definition, v_new, v_old);
end;
$migration$;

create or replace function public.project_finance_actuals(p_project_id uuid)
returns table(category public.budget_category, mapped boolean, has_rows boolean,
              actuals_to_date numeric, actuals_as_of timestamptz, source_sum numeric,
              tagged_to_date numeric, attributed_to_date numeric, equipment_charge_to_date numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $function$
declare v_role public.user_role := public.auth_role();
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists(select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id()) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- Ledger readers keep the existing mapped snapshot and attribution calculation row for row.
  if public.org_reads_erp_ledger() then
    return query select * from public.project_mapped_actuals(p_project_id, null);
    return;
  end if;

  -- Without an active binding the ledger basis is not selected (0307): no snapshot or attribution term is read,
  -- even when an old snapshot survives a disconnect, so a ledger-posted purchase that PMO also records as paid
  -- counts once. Actuals = PMO paid purchases (pre-tax) + the internal equipment charge, in the project currency.
  -- Procurement.budget_category is the category link; an uncategorized paid purchase makes every category's
  -- coverage unknown instead of being misplaced.
  return query
  with target_project as (
    select p.id, p.org_id, p.currency, p.currency = o.default_currency as charge_in_project_currency
      from public.projects p join public.organizations o on o.id = p.org_id
     where p.id = p_project_id and p.org_id = public.auth_org_id()
  ), paid_procurements as (
    select pay.procurement_id, max(coalesce(pay.date::timestamp at time zone 'UTC', pay.created_at)) as actuals_as_of
      from public.payments pay join target_project p on pay.org_id = p.org_id
     where pay.status = 'Paid' and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
     group by pay.procurement_id
  ), paid_rows as (
    select pr.budget_category as category,
           case when pr.currency = p.currency then public.procurement_paid_pre_tax(pr) end as amount,
           pp.actuals_as_of
      from paid_procurements pp
      join public.procurements pr on pr.id = pp.procurement_id
      join target_project p on pr.project_id = p.id and pr.org_id = p.org_id
     where pr.origin is distinct from 'erp_link'
  ), category_totals as (
    select r.category,
           count(*)::int as purchase_count,
           case when count(*) filter (where r.amount is null) > 0 then null::numeric
                else sum(r.amount) end as amount
      from paid_rows r
     where r.category is not null
     group by r.category
  ), completeness as (
    select exists(select 1 from paid_rows r where r.category is null) as has_uncategorized
  ), charges as (
    -- The hire charge is priced in the org currency; on a project in another currency it is unknown, never relabelled.
    select q.category, q.n, q.as_of,
           case when (select charge_in_project_currency from target_project) then q.amount end as amount
      from public.equipment_charge_project_actuals(p_project_id, null) q
  ), recency as (
    select greatest((select max(r.actuals_as_of) from paid_rows r),
                    (select max(q.as_of) from charges q)) as actuals_as_of
  )
  select c.category,
         not complete.has_uncategorized as mapped,
         coalesce(total.purchase_count, 0) > 0 or coalesce(q.n, 0) > 0 as has_rows,
         case when complete.has_uncategorized then null::numeric
              else case when total.purchase_count is null then 0::numeric else total.amount end
                   + case when q.n is null then 0::numeric else q.amount end end as actuals_to_date,
         recent.actuals_as_of,
         case when complete.has_uncategorized then null::numeric
              else case when total.purchase_count is null then 0::numeric else total.amount end
                   + case when q.n is null then 0::numeric else q.amount end end as source_sum,
         case when complete.has_uncategorized then null::numeric
              when total.purchase_count is null then 0::numeric
              else total.amount end as tagged_to_date,
         case when complete.has_uncategorized then null::numeric else 0::numeric end as attributed_to_date,
         case when complete.has_uncategorized then null::numeric
              when q.n is null then 0::numeric else q.amount end as equipment_charge_to_date
    from unnest(enum_range(null::public.budget_category)) c(category)
    cross join completeness complete
    cross join recency recent
    left join category_totals total on total.category = c.category
    left join charges q on q.category = c.category;
end;
$function$;

revoke all on function public.project_finance_actuals(uuid) from public, anon, authenticated;
grant execute on function public.project_finance_actuals(uuid) to authenticated, service_role;
