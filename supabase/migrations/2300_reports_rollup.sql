-- AC-RR-001/002. The existing earned read (1272, field guard added in 1480)
-- supplies the project and currency keys and enforces membership and field access.
-- Billing uses the invoice_rows, inv and work inputs of get_project_finances (0791).
-- Cost uses the current work_order_cost_amounts (1933), once per project, and the
-- project totals and other-currency rules of rollupProject. Caller RLS applies to
-- projects, work orders and invoices. The inverse is 2300_reports_rollup_down.sql.
create function public.management_pack_project_totals() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_money boolean := coalesce(public.auth_role() in ('Admin', 'Executive', 'Finance', 'Project Manager'), false);
begin
  return (
    with earned as materialized (
      select * from public.management_pack_earned()
    ), project_keys as materialized (
      select distinct e.project_id from earned e where v_money
    ), invoice_rows as materialized (
      select i.id, i.org_id, i.project_id, i.currency
      from public.sales_invoices i join project_keys p on p.project_id = i.project_id
      where i.org_id = v_org and i.status in ('Submitted','Unpaid','Paid')
        and coalesce(i.erp_docstatus,1) <> 2 and i.erp_cancelled_at is null
        and i.paired_erp_invoice_id is null
    ), invoices as (
      select distinct i.project_id, i.currency from invoice_rows i
    ), work as (
      select i.project_id, w.currency,
        count(*) filter (where w.net is null or w.net::text in ('NaN','Infinity','-Infinity')
                          or w.recovery is null or w.recovery::text in ('NaN','Infinity','-Infinity')) as missing_work,
        sum(w.net + w.recovery) as revenue
      from public.sales_invoice_work_billed w
      join invoice_rows i on i.id = w.id and i.org_id = w.org_id
      where not w.is_down_payment
      group by i.project_id, w.currency
    ), costs as materialized (
      select p.project_id, l.work_order_id, l.currency, l.amount, l.reason
      from project_keys p cross join lateral public.work_order_cost_amounts(p.project_id) l
      where l.reason in ('counted','unassigned','split-when-custom','unresolved-direct')
    ), cost_totals as (
      select l.project_id, coalesce(l.currency, '?') as currency,
        case when count(*) filter (where l.amount is null) = 0 then sum(l.amount::numeric) end as cost
      from costs l where l.reason in ('counted','unassigned','split-when-custom')
      group by l.project_id, coalesce(l.currency, '?')
    ), incomparable as (
      select distinct l.project_id, w.currency
      from costs l join public.work_orders w on w.id = l.work_order_id and w.org_id = v_org
      where l.reason in ('counted','unresolved-direct') and l.currency is distinct from w.currency
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', e.project_id, 'currency', e.currency, 'project_name', p.name,
      'restricted', not v_money, 'earned', case when v_money then e.earned end,
      'unrated_lines', e.unrated_lines, 'work_orders', e.work_orders,
      'work_orders_without_progress', e.work_orders_without_progress,
      'billed', case when v_money and coalesce(w.missing_work, 0) = 0 then coalesce(w.revenue, 0)::text end,
      'cost', case when v_money then (case when c.project_id is null then 0.00 else c.cost end)::text end,
      'comparable', x.project_id is null
    ) order by e.project_id, e.currency), '[]'::jsonb)
    from earned e
    left join public.projects p on p.id = e.project_id and p.org_id = v_org and p.archived_at is null
      and p.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out', 'Internal Project')
    left join invoices i on i.project_id = e.project_id and i.currency = e.currency
    left join work w on w.project_id = i.project_id and w.currency = i.currency
    left join cost_totals c on c.project_id = e.project_id and c.currency = e.currency
    left join incomparable x on x.project_id = e.project_id and x.currency = e.currency
  );
end $$;

revoke all on function public.management_pack_project_totals() from public, anon;
grant execute on function public.management_pack_project_totals() to authenticated;
