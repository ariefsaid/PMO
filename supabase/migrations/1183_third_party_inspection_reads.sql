-- 1183_third_party_inspection_reads.sql — #2580: the cost read, the prerequisite read and the overdue notice.
-- Spec FR-TPI-008/016/018. Proven by supabase/tests/1183_third_party_inspection_reads.test.sql.
--   tpi_costs(work_order)                  committed + billed per inspection per currency, from the LINKED case's records already
--                                          attributed to the work order (work_order_cost_lines, 0951). Server-side fence: a caller outside
--                                          Admin/Executive/Finance/Project Manager gets the rows with NULL amounts (the planning estimate
--                                          included: it is a figure, shown beside the real cost, never added to it). Writes nothing.
--   work_order_inspection_prerequisites()  the blocking inspections + one `complete` boolean, for #2522 / #2576 to call (a read only).
--   run_tpi_overdue_sweep(date)            one notice per recipient per inspection, from stored dates, through public.notifications.
-- ── REVERSE (rollback/1183_third_party_inspection_reads_down.sql): unschedule 'tpi-overdue', drop the three functions and tpi_is_complete.

-- The one definition of "complete" (FR-TPI-016, OD-TPI-2): reported with pass/conditional, or waived.
create function public.tpi_is_complete(p_status text, p_result text, p_waived_at timestamptz) returns boolean
  language sql immutable as $$
  select (p_status = 'reported' and p_result in ('pass','conditional')) or (p_waived_at is not null and p_status <> 'cancelled')
$$;
grant execute on function public.tpi_is_complete(text, text, timestamptz) to authenticated;

create function public.tpi_costs(p_work_order_id uuid)
  returns table(inspection_id uuid, currency text, committed numeric, billed numeric, estimate numeric, estimate_currency text)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_money boolean;
begin
  if not public.is_active_member() then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then
    raise exception 'work order not found' using errcode = 'P0002';   -- SECURITY: another org's work order reads as absent
  end if;
  v_money := public.auth_role() in ('Admin','Executive','Finance','Project Manager');
  if not v_money then
    return query select i.id, null::text, null::numeric, null::numeric, null::numeric, null::text
                   from public.third_party_inspections i where i.work_order_id = p_work_order_id and i.org_id = v_org
                  order by i.created_at, i.id;
    return;
  end if;
  return query
  with insp as (
    select i.id, i.work_order_id, i.procurement_id, i.created_at, i.estimate, i.estimate_currency from public.third_party_inspections i
     where i.work_order_id = p_work_order_id and i.org_id = v_org and i.status <> 'cancelled'
  ), committed as (
    select i.id as iid, po.currency, sum(po.amount) as amt
      from insp i
      join public.work_order_cost_lines l on l.source = 'purchase_order' and l.work_order_id = i.work_order_id and l.org_id = v_org
      join public.purchase_orders po on po.id = l.record_id and po.procurement_id = i.procurement_id and po.org_id = v_org
     where po.status in ('Issued','Acknowledged','Closed')                       -- a Draft order is not a commitment
       and coalesce(po.erp_docstatus, 1) <> 2 and po.erp_cancelled_at is null
       and po.amount is not null and po.amount::text not in ('NaN','Infinity','-Infinity')
     group by i.id, po.currency
  ), billed as (
    select i.id as iid, b.currency,
           sum(round(case when b.tax_treatment = 'inclusive' then b.amount - coalesce(b.tax_amount, 0) else b.amount end, 2)) as amt
      from insp i
      join public.work_order_cost_lines l on l.source = 'vendor_bill' and l.work_order_id = i.work_order_id and l.org_id = v_org
      join public.procurement_invoices b on b.id = l.record_id and b.procurement_id = i.procurement_id and b.org_id = v_org
     where b.voided_at is null and coalesce(b.erp_docstatus, 1) <> 2 and b.erp_cancelled_at is null   -- as work_order_cost_amounts (0999)
       and b.amount is not null and b.amount::text not in ('NaN','Infinity','-Infinity')
     group by i.id, b.currency
  ), merged as (
    select coalesce(c.iid, b.iid) as iid, coalesce(c.currency, b.currency) as cur, c.amt as c_amt, b.amt as b_amt
      from committed c full join billed b on b.iid = c.iid and b.currency is not distinct from c.currency
  )
  select i.id, m.cur, m.c_amt, m.b_amt, i.estimate, i.estimate_currency
    from insp i left join merged m on m.iid = i.id
   order by i.created_at, i.id, m.cur;
end $$;
revoke all on function public.tpi_costs(uuid) from public, anon;
grant execute on function public.tpi_costs(uuid) to authenticated;

-- invoker: the caller's own row rules apply (RLS on third_party_inspections); section is null until #2576.
create function public.work_order_inspection_prerequisites(p_work_order_id uuid, p_section_id uuid, p_gate text)
  returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_rows jsonb;
begin
  if p_section_id is not null then
    raise exception 'TPI_SECTION_UNAVAILABLE: work-order sections are not available yet' using errcode = '23514';
  end if;
  if p_gate is null or p_gate not in ('readiness','billing') then
    raise exception 'unknown gate' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'title', i.title, 'status', i.status, 'result', i.result,
           'waived_at', i.waived_at, 'waiver_reason', i.waiver_reason,
           'complete', public.tpi_is_complete(i.status, i.result, i.waived_at)) order by i.created_at, i.id), '[]'::jsonb)
    into v_rows
    from public.third_party_inspections i
   where i.work_order_id = p_work_order_id and i.status <> 'cancelled' and p_gate = any(i.required_for);
  return jsonb_build_object('complete',
           not exists (select 1 from jsonb_array_elements(v_rows) e where (e->>'complete')::boolean is not true),
           'inspections', v_rows);
end $$;
revoke all on function public.work_order_inspection_prerequisites(uuid, uuid, text) from public, anon;
grant execute on function public.work_order_inspection_prerequisites(uuid, uuid, text) to authenticated;

-- FR-TPI-018: past its planned date and not reported -> notify the requester and the project's manager ONCE.
create function public.run_tpi_overdue_sweep(p_as_of date default null) returns int
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := coalesce(p_as_of, current_date); r record; n int := 0;
begin
  for r in
    select i.id, i.org_id, i.title, i.created_by, p.project_manager_id
      from public.third_party_inspections i join public.projects p on p.id = i.project_id
     where i.status not in ('reported','cancelled') and i.planned_date < v_today and i.overdue_notified_at is null
     for update of i skip locked
  loop
    perform public.notify_workflow_user(r.org_id, r.created_by, 'Inspection overdue', r.title, 'warning', 'third_party_inspection', r.id, r.title);
    if r.project_manager_id is distinct from r.created_by then
      perform public.notify_workflow_user(r.org_id, r.project_manager_id, 'Inspection overdue', r.title, 'warning', 'third_party_inspection', r.id, r.title);
    end if;
    update public.third_party_inspections set overdue_notified_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.run_tpi_overdue_sweep(date) from public, anon, authenticated;
alter function public.run_tpi_overdue_sweep(date) owner to postgres;
grant execute on function public.run_tpi_overdue_sweep(date) to service_role;
select cron.schedule('tpi-overdue', '41 1 * * *', $$select public.run_tpi_overdue_sweep()$$);
