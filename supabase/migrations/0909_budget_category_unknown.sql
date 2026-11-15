-- 0909 (#2330) Budget by category: a paid purchase with no budget category no longer marks every category unknown.
-- Rollback: supabase/migrations/rollback/0909_budget_category_unknown_down.sql
--
-- On the PMO paid-purchase basis (no active ERP binding, 0307/0560) one uncategorized paid purchase nulled every
-- category of project_finance_actuals. Now each category keeps the figure it was read at, the uncategorized spend is
-- its own row (category NULL) whose amount is unknown, and get_project_finances' totals that would include it read
-- NULL (incomplete). The categories list keeps naming only real budget categories. The ERP-ledger branch is unchanged.

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
  -- Procurement.budget_category is the category link. Paid spend with no category is one extra row of its own
  -- (category NULL, amount unknown, mapped so every total that would include it reads NULL — incomplete — rather
  -- than a partial sum); every category that was read keeps its figure (#2330).
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
  ), uncategorized as (
    select count(*)::int as purchase_count,
           case when count(*) filter (where r.amount is null) > 0 then null::numeric
                else sum(r.amount) end as amount
      from paid_rows r
     where r.category is null
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
         true as mapped,
         coalesce(total.purchase_count, 0) > 0 or coalesce(q.n, 0) > 0 as has_rows,
         case when total.purchase_count is null then 0::numeric else total.amount end
           + case when q.n is null then 0::numeric else q.amount end as actuals_to_date,
         recent.actuals_as_of,
         case when total.purchase_count is null then 0::numeric else total.amount end
           + case when q.n is null then 0::numeric else q.amount end as source_sum,
         case when total.purchase_count is null then 0::numeric else total.amount end as tagged_to_date,
         0::numeric as attributed_to_date,
         case when q.n is null then 0::numeric else q.amount end as equipment_charge_to_date
    from unnest(enum_range(null::public.budget_category)) c(category)
    cross join recency recent
    left join category_totals total on total.category = c.category
    left join charges q on q.category = c.category
  union all
  -- The uncategorized paid spend: what was paid is stated in source_sum; where it belongs is unknown.
  select null::public.budget_category, true, true, null::numeric, recent.actuals_as_of, u.amount,
         null::numeric, 0::numeric, 0::numeric
    from uncategorized u cross join recency recent
   where u.purchase_count > 0;
end;
$function$;

revoke all on function public.project_finance_actuals(uuid) from public, anon, authenticated;
grant execute on function public.project_finance_actuals(uuid) to authenticated, service_role;

-- The categories list names budget categories only; the uncategorized row still reaches every total.
do $migration$
declare
  v_definition text;
  v_old constant text := 'order by category) from gl)';
  v_new constant text := 'order by category) from gl where category is not null)';
begin
  select pg_get_functiondef('public.get_project_finances(uuid)'::regprocedure) into v_definition;
  if length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
    raise exception '0909 expected one categories list in get_project_finances';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
