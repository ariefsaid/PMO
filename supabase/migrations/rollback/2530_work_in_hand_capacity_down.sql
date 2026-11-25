-- Reverses 2530_work_in_hand_capacity.sql.

-- Restore get_work_in_hand to 2281 body.
create or replace function public.get_work_in_hand(p_as_of date default null)
  returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org    uuid := public.auth_org_id();
  v_role   public.user_role := public.auth_role();
  v_tz     text;
  v_cur    text;
  v_as_of  date;
  v_month  date;
  v_from   date;
  v_last   date;
  v_bound  date;
  v_result jsonb;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(o.default_timezone, 'UTC'), o.default_currency
    into v_tz, v_cur
    from public.organizations o where o.id = v_org;

  v_as_of := coalesce(p_as_of, (now() at time zone v_tz)::date);
  v_month := date_trunc('month', v_as_of)::date;
  v_from  := (v_month - interval '6 months')::date;
  v_last  := (v_month - interval '1 month')::date;
  v_bound := (v_month + interval '1 month')::date;

  with proj_all as (
    select p.id, p.name, p.code, p.pmo_project_number, p.status::text as status, p.currency,
           case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                else p.contract_value end as contract_net
      from public.projects p
     where p.org_id = v_org
       and p.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out')
       and p.archived_at is null
       and (v_role <> 'Project Manager' or p.project_manager_id = auth.uid())
     order by 7 desc nulls last, p.id
     limit 501
  ),
  proj as (select * from proj_all order by contract_net desc nulls last, id limit 500),
  inv as (
    select w.project_id, w.work_order_id, w.currency, w.net, w.recovery, w.invoice_date
      from public.sales_invoice_work_billed w
     where w.org_id = v_org
       and w.status in ('Submitted', 'Unpaid', 'Paid')
       and not w.is_down_payment
       and w.invoice_date is not null
       and w.invoice_date < v_bound
       and w.project_id in (select id from proj)
  ),
  c_ok as (
    select i.project_id, date_trunc('month', i.invoice_date)::date as month, i.net + i.recovery as amt
      from inv i join proj p on p.id = i.project_id
     where i.net is not null and i.currency = p.currency
  ),
  c_issue as (
    select i.project_id,
           count(*) filter (where i.net is not null and i.currency <> p.currency)::int as foreign_count,
           count(*) filter (where i.net is null)::int as unpriced_count
      from inv i join proj p on p.id = i.project_id
     group by i.project_id
  ),
  c_sum as (select project_id, sum(amt) as billed, min(month) as first_month from c_ok group by project_id),
  c_win as (
    select project_id, jsonb_agg(jsonb_build_object('month', month, 'billed', billed::text) order by month) as months
      from (select project_id, month, sum(amt) as billed from c_ok
             where month >= v_from and month <= v_last group by project_id, month) x
     group by project_id
  ),
  wo_all as (
    select b.work_order_id, b.project_id, b.wo_number, b.title, b.currency, b.order_net, b.figures_complete
      from public.work_order_billing b
     where b.org_id = v_org and b.status = 'Issued' and b.project_id in (select id from proj)
     order by b.order_net desc nulls last, b.work_order_id
     limit 3001
  ),
  wo as (select * from wo_all order by order_net desc nulls last, work_order_id limit 3000),
  w_ok as (
    select c.work_order_id, c.month, c.billed as amt
      from public.work_order_billed_months_core((select coalesce(array_agg(wo.work_order_id), '{}'::uuid[]) from wo), v_bound) c
  ),
  w_issue as (
    select i.work_order_id,
           count(*) filter (where i.net is not null and i.currency <> wo.currency)::int as foreign_count,
           count(*) filter (where i.net is null)::int as unpriced_count
      from inv i join wo on wo.work_order_id = i.work_order_id
     group by i.work_order_id
  ),
  w_sum as (select work_order_id, sum(amt) as billed, min(month) as first_month from w_ok group by work_order_id),
  w_win as (
    select work_order_id, jsonb_agg(jsonb_build_object('month', month, 'billed', billed::text) order by month) as months
      from (select work_order_id, month, sum(amt) as billed from w_ok
             where month >= v_from and month <= v_last group by work_order_id, month) x
     group by work_order_id
  )
  select jsonb_build_object(
    'as_of', v_as_of,
    'timezone', v_tz,
    'org_currency', v_cur,
    'window_from', v_from,
    'window_to', v_last,
    'truncated', ((select count(*) from proj_all) > 500 or (select count(*) from wo_all) > 3000),
    'undated_invoice_count', (select count(*)::int from public.sales_invoice_work_billed w
                               where w.org_id = v_org and w.status in ('Submitted', 'Unpaid', 'Paid')
                                 and w.net is not null and w.invoice_date is null and not w.is_down_payment
                                 and (v_role <> 'Project Manager' or w.project_id in (
                                   select pm.id from public.projects pm
                                    where pm.org_id = v_org and pm.project_manager_id = auth.uid()
                                      and pm.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out')
                                      and pm.archived_at is null
                                 ))),
    'no_value', coalesce((select jsonb_agg(jsonb_build_object('project_id', p.id, 'name', p.name, 'code', p.code,
                                  'pmo_project_number', p.pmo_project_number, 'status', p.status, 'currency', p.currency)
                                  order by p.name, p.id)
                            from proj p where p.contract_net is null or p.contract_net <= 0), '[]'::jsonb),
    'contracts', coalesce((select jsonb_agg(jsonb_build_object(
        'project_id', p.id, 'name', p.name, 'code', p.code, 'pmo_project_number', p.pmo_project_number,
        'status', p.status, 'currency', p.currency, 'contract_net', p.contract_net::text,
        'incomplete', (coalesce(i.foreign_count, 0) > 0 or coalesce(i.unpriced_count, 0) > 0),
        'foreign_currency_invoice_count', coalesce(i.foreign_count, 0),
        'unpriced_invoice_count', coalesce(i.unpriced_count, 0),
        'billed_to_date', case when coalesce(i.foreign_count, 0) > 0 or coalesce(i.unpriced_count, 0) > 0 then null
                               else coalesce(s.billed, 0::numeric(14,2))::text end,
        'first_billing_month', case when coalesce(i.foreign_count, 0) > 0 or coalesce(i.unpriced_count, 0) > 0 then null
                                    else s.first_month end,
        'window_months', case when coalesce(i.foreign_count, 0) > 0 or coalesce(i.unpriced_count, 0) > 0 then '[]'::jsonb
                              else coalesce(w.months, '[]'::jsonb) end)
        order by p.name, p.id)
      from proj p
      left join c_issue i on i.project_id = p.id
      left join c_sum s on s.project_id = p.id
      left join c_win w on w.project_id = p.id
     where p.contract_net > 0), '[]'::jsonb),
    'work_orders', coalesce((select jsonb_agg(jsonb_build_object(
        'work_order_id', o.work_order_id, 'project_id', o.project_id, 'wo_number', o.wo_number, 'title', o.title,
        'status', 'Issued', 'currency', o.currency, 'order_net', o.order_net::text,
        'incomplete', not o.figures_complete,
        'foreign_currency_invoice_count', coalesce(i.foreign_count, 0),
        'unpriced_invoice_count', coalesce(i.unpriced_count, 0),
        'billed_to_date', case when not o.figures_complete then null else coalesce(s.billed, 0::numeric(14,2))::text end,
        'first_billing_month', case when not o.figures_complete then null else s.first_month end,
        'window_months', case when not o.figures_complete then '[]'::jsonb else coalesce(w.months, '[]'::jsonb) end)
        order by o.wo_number nulls last, o.work_order_id)
      from wo o
      left join w_issue i on i.work_order_id = o.work_order_id
      left join w_sum s on s.work_order_id = o.work_order_id
      left join w_win w on w.work_order_id = o.work_order_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
comment on function public.get_work_in_hand(date) is
  '#2575: Left to bill inputs per on-hand contract and Issued work order: net value, billed to date, the window''s billed work '
  'per organisation-local month, the first billing month. Read-only; billed work only from sales_invoice_work_billed. The rate '
  'and months of backlog are derived in pmo-portal/src/lib/workInHand.ts. Admin, Executive and Finance receive organization-wide rows; Project Managers receive rows for their assigned projects only.';
revoke all on function public.get_work_in_hand(date) from public, anon;
grant execute on function public.get_work_in_hand(date) to authenticated;

drop trigger zz_audit_org_setting_change on public.organizations;
create trigger zz_audit_org_setting_change after update on public.organizations for each row
  execute function public.audit_org_setting_change(
    'quantity_change_limit', 'built_in_roles_enabled', 'phone_check_in_supervisor_role', 'hide_prices_from_requesters',
    'clearance_checklist_enabled', 'leave_requests_enabled', 'leave_approver_role', 'crew_loans_enabled',
    'discipline_profit_enabled', 'performance_indices_enabled', 'performance_band_low', 'performance_band_high',
    'stock_transfer_mode', 'stock_proof_timing', 'stock_wo_transfers', 'stock_reservations', 'reservation_borrow_mode',
    'reservation_borrow_role', 'reservation_borrow_label', 'dsr_stock_issue', 'dsr_stock_issue_items',
    'purchase_line_planning', 'safety_records_enabled', 'equipment_availability_target_pct',
    'equipment_utilisation_target_pct', 'equipment_escalation_down_days', 'attendance_target_rate',
    'module_people_crews', 'module_site_day', 'module_stock', 'module_purchasing_extras', 'module_billing_extras',
    'work_order_checklist_enabled');

drop policy if exists organizations_update_work_in_hand_capacity on public.organizations;
revoke update (work_in_hand_monthly_capacity) on public.organizations from authenticated;
alter table public.organizations drop column if exists work_in_hand_monthly_capacity;
