-- 0560 Budget actuals use PMO's own paid procurement payments when the org does not read the ERP ledger.
-- Rollback: supabase/migrations/rollback/0560_budget_pmo_paid_actuals_down.sql

-- The helper is granted to authenticated because get_project_finances is SECURITY INVOKER. It repeats that
-- RPC's membership, role, and project checks so the helper cannot become a less-restricted read path.
create function public.project_finance_actuals(p_project_id uuid)
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

  -- A paid payment is the PMO cash-spend fact. Its invoice is already the source of that payment amount, so
  -- summing both would double count. Procurement.budget_category is the category link shared by its invoices
  -- and payments. An uncategorized paid row makes the category coverage unknown instead of being misplaced.
  return query
  with target_project as (
    select p.id, p.org_id, p.currency
      from public.projects p
     where p.id = p_project_id and p.org_id = public.auth_org_id()
  ), paid_rows as (
    select pr.budget_category as category,
           case when pay.amount is not null
                     and pay.amount::text not in ('NaN','Infinity','-Infinity')
                     and pay.currency = p.currency
                then pay.amount end as amount,
           coalesce(pay.date::timestamp at time zone 'UTC', pay.created_at) as actuals_as_of
      from target_project p
      join public.procurements pr on pr.project_id = p.id and pr.org_id = p.org_id
      join public.payments pay on pay.procurement_id = pr.id and pay.org_id = pr.org_id
     where pay.org_id = p.org_id
       and pr.origin is distinct from 'erp_link'
       and pay.status = 'Paid'
       and coalesce(pay.erp_docstatus, 1) <> 2
       and pay.erp_cancelled_at is null
  ), category_totals as (
    select r.category,
           count(*)::int as payment_count,
           case when count(*) filter (where r.amount is null) > 0 then null::numeric
                else sum(r.amount) end as amount
      from paid_rows r
     where r.category is not null
     group by r.category
  ), completeness as (
    select exists(select 1 from paid_rows r where r.category is null) as has_uncategorized
  ), charges as (
    select * from public.equipment_charge_project_actuals(p_project_id, null)
  ), recency as (
    select greatest((select max(r.actuals_as_of) from paid_rows r),
                    (select max(q.as_of) from charges q)) as actuals_as_of
  )
  select c.category,
         not complete.has_uncategorized as mapped,
         coalesce(total.payment_count, 0) > 0 or coalesce(q.n, 0) > 0 as has_rows,
         case when complete.has_uncategorized then null::numeric
              when total.payment_count is null then coalesce(q.amount, 0)::numeric
              else total.amount + coalesce(q.amount, 0) end as actuals_to_date,
         recent.actuals_as_of,
         case when complete.has_uncategorized then null::numeric
              when total.payment_count is null then coalesce(q.amount, 0)::numeric
              else total.amount + coalesce(q.amount, 0) end as source_sum,
         case when complete.has_uncategorized then null::numeric
              when total.payment_count is null then 0::numeric
              else total.amount end as tagged_to_date,
         case when complete.has_uncategorized then null::numeric else 0::numeric end as attributed_to_date,
         case when complete.has_uncategorized then null::numeric else coalesce(q.amount, 0) end as equipment_charge_to_date
    from unnest(enum_range(null::public.budget_category)) c(category)
    cross join completeness complete
    cross join recency recent
    left join category_totals total on total.category = c.category
    left join charges q on q.category = c.category;
end;
$function$;

revoke all on function public.project_finance_actuals(uuid) from public, anon, authenticated;
grant execute on function public.project_finance_actuals(uuid) to authenticated, service_role;

-- Replace only the actuals source and currency expression in the large finance RPC. The guard makes this fail
-- closed if its source body drifts, while preserving every other payload field verbatim from the current body.
do $migration$
declare
  v_definition text;
  v_old_source constant text := 'select * from public.project_mapped_actuals(p_project_id,null)';
  v_new_source constant text := 'select * from public.project_finance_actuals(p_project_id)';
  v_old_currency constant text := $old$'currency',o.default_currency$old$;
  v_new_currency constant text := $new$'currency',case when public.org_reads_erp_ledger() then o.default_currency else p.currency end$new$;
begin
  select pg_get_functiondef('public.get_project_finances(uuid)'::regprocedure) into v_definition;
  if length(v_definition) - length(replace(v_definition, v_old_source, '')) <> length(v_old_source) then
    raise exception '0560 expected one project_mapped_actuals source in get_project_finances';
  end if;
  if length(v_definition) - length(replace(v_definition, v_old_currency, '')) <> length(v_old_currency) then
    raise exception '0560 expected one default-currency expression in get_project_finances';
  end if;
  v_definition := replace(v_definition, v_old_source, v_new_source);
  v_definition := replace(v_definition, v_old_currency, v_new_currency);
  execute v_definition;
end;
$migration$;

-- Open commitments share the paid-payment basis used by PMO actuals. Ledger readers retain their existing basis.
create or replace function public.procurement_open_commitment(p public.procurements) returns numeric
language sql stable security invoker set search_path = public, pg_catalog as $$
  select case
    when p.status::text in ('Cancelled','Rejected') then 0::numeric
    when public.org_reads_erp_ledger() then greatest(0::numeric, coalesce(p.total_value, 0) - coalesce(public.procurement_ledger_held(p.id), 0))
    when p.origin = 'erp_link' then coalesce(p.total_value, 0)::numeric
    else (select case
      when count(*) filter (where pay.amount is null or pay.amount::text in ('NaN','Infinity','-Infinity')
                             or pay.currency is distinct from p.currency) > 0 then null::numeric
      else greatest(0::numeric, coalesce(p.total_value, 0) - coalesce(sum(pay.amount), 0)) end
      from public.payments pay
      where pay.procurement_id = p.id and pay.org_id = p.org_id
        and pay.status = 'Paid' and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null)
    end
$$;
