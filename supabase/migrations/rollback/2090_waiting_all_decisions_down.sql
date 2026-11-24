-- Restore the 2080 function.
create or replace function public.my_waiting_decisions()
  returns table (kind text, record_id uuid, project_id uuid, title text, created_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();   -- a light account decides nothing and sees no list (1209)
  if v_role is null or v_uid is null then return; end if;
  return query
  select waiting.kind, waiting.record_id, waiting.project_id, waiting.title, waiting.created_at
    from (
  -- daily_report
  select 'daily_report'::text, d.id, d.project_id,
         (coalesce(w.wo_number || ' · ', '') || w.title || ' · ' || to_char(d.work_date, 'YYYY-MM-DD'))::text,
         coalesce(d.submitted_at, d.updated_at)
    from public.daily_site_reports d
    join public.work_orders w on w.id = d.work_order_id
   where d.org_id = v_org and d.status = 'submitted' and d.author_id is distinct from v_uid
     and public.dsr_may_validate(d.project_id)
  union all
  -- work_order_issue: the gate's role set; a Project Manager only for the projects they manage; money rows follow the SoD predicate
  select 'work_order_issue'::text, w.id, w.project_id, (coalesce(w.wo_number || ' · ', '') || w.title)::text, w.created_at
    from public.work_orders w
    join public.projects p on p.id = w.project_id
   where w.org_id = v_org and w.status = 'Draft'
     and v_role in ('Admin', 'Executive', 'Project Manager', 'Finance')
     and (v_role <> 'Project Manager' or p.project_manager_id = v_uid)
     and coalesce(w.order_value, 0) > 0 and w.order_value_set_by is not null and w.order_value_set_by is distinct from v_uid
     and (public.holds_won_value_authority(v_role)
          or (w.order_value_set_at is not null and public.is_active_member(w.order_value_set_by)
              and public.may_approve_work_of(w.order_value_set_by, v_uid)))
  union all
  -- delivery_record
  select 'delivery_record'::text, pr.id, pr.project_id, pr.title::text, pr.updated_at
    from public.procurements pr
    left join public.projects p on p.id = pr.project_id
   where pr.org_id = v_org and pr.status = 'Ordered'
     and (v_role = 'Admin'
          or (pr.requested_by_id = v_uid and v_role in ('Executive', 'Project Manager', 'Finance', 'Engineer'))
          or (v_role = 'Project Manager' and p.project_manager_id = v_uid))
  union all
  -- quantity_change
  select 'quantity_change'::text, q.id, q.project_id, coalesce(w.wo_number || ' · ', '') || w.title, coalesce(q.submitted_at, q.updated_at)
    from public.quantity_change_requests q
    join public.work_orders w on w.id = q.work_order_id
   where q.org_id = v_org and q.status = 'pending_approval' and public.qcr_may_approve_role(v_org)
     and q.author_id is distinct from v_uid and not (v_uid = any (q.editor_ids)) and q.submitted_by is distinct from v_uid
  union all
  -- certificate
  select 'certificate'::text, c.id, c.project_id, pr.title::text, coalesce(c.submitted_at, c.created_at)
    from public.subcontract_certificates c
    join public.procurements pr on pr.id = c.procurement_id
   where c.org_id = v_org and c.status = 'submitted' and v_role in ('Admin', 'Finance', 'Executive')
     and c.prepared_by is distinct from v_uid and c.submitted_by is distinct from v_uid
  union all
  -- transfer_receipt: narrower than the gate on purpose (a senior role may receive any transfer; only those addressed to the caller or kept by them are waiting for them)
  select 'transfer_receipt'::text, x.id, w.project_id, (x.number || ' · ' || w.name)::text, x.sent_at
    from public.stock_transfers x
    join public.stock_warehouses w on w.id = x.to_warehouse_id
   where x.org_id = v_org and x.status = 'Sent' and x.sent_by is distinct from v_uid
     and (x.to_user_id = v_uid or exists (select 1 from public.stock_warehouse_keepers k
                                           where k.org_id = x.org_id and k.user_id = v_uid and k.warehouse_id = x.to_warehouse_id))
  union all
  -- equipment_plan
  select 'equipment_plan'::text, e.id, e.project_id, (pj.name || ' · ' || to_char(e.plan_month, 'YYYY-MM'))::text, coalesce(e.submitted_at, e.created_at)
    from public.equipment_plans e
    join public.projects pj on pj.id = e.project_id
   where e.org_id = v_org and e.status = 'Submitted' and public.equipment_plan_approver_ok(e.id)
  union all
  -- stock_writeoff: a Draft adjustment, or a count with a difference, that the caller may post (stock_assert_writeoff_approver, 0416:
  -- never its author, and rank 20 or above). A count with no difference is not listed: its author posts it (FR-STK-062).
  select 'stock_writeoff'::text, sd.id, wh.project_id, (sd.number || ' · ' || wh.name)::text, sd.created_at
    from public.stock_documents sd
    join public.stock_warehouses wh on wh.id = sd.warehouse_id
   where sd.org_id = v_org and sd.status = 'Draft' and sd.kind in ('adjustment', 'count')
     and sd.created_by is distinct from v_uid
     and coalesce(public.role_rank(v_role) >= 20, false)
     and (sd.kind = 'adjustment'
          or exists (select 1 from public.stock_document_lines sl
                       left join public.stock_balances sb on sb.item_id = sl.item_id and sb.warehouse_id = sd.warehouse_id
                      where sl.document_id = sd.id and sl.counted_quantity is distinct from coalesce(sb.qty_on_hand, 0)))
  union all
  -- attendance_decision: a work order's day with a second time record that disagrees with the site report's figure and is not decided,
  -- for the people attendance_second_record_may_decide() names, never one who recorded either figure (attendance_second_record_decide, 1701).
  -- One row per report: the decision is made on the site report of that day, which is where the row opens.
  select 'attendance_decision'::text, dr.id, dr.project_id,
         (coalesce(aw.wo_number || ' · ', '') || aw.title || ' · ' || to_char(dr.work_date, 'YYYY-MM-DD'))::text,
         min(asr.recorded_at)
    from public.daily_site_reports dr
    join public.work_orders aw on aw.id = dr.work_order_id
    join public.attendance_second_records asr on asr.work_order_id = dr.work_order_id and asr.work_date = dr.work_date and asr.org_id = v_org
    join public.attendance_days ad on ad.worker_id = asr.worker_id and ad.work_order_id = asr.work_order_id and ad.work_date = asr.work_date
   where dr.org_id = v_org and dr.supersedes_id is null and dr.archived_at is null
     and asr.decided_at is null and ad.locked_at is null and ad.submitted_at is null
     and not (v_uid = any (asr.recorded_by_ids)) and not (v_uid = any (ad.recorded_by_ids))
     and public.attendance_second_record_may_decide()
     and public.attendance_day_undecided(asr.worker_id, asr.work_order_id, asr.work_date)
   group by dr.id, dr.project_id, aw.wo_number, aw.title, dr.work_date
    ) as waiting(kind, record_id, project_id, title, created_at)
   order by waiting.created_at asc nulls last, waiting.kind asc, waiting.record_id asc;
end; $$;
revoke all on function public.my_waiting_decisions() from public, anon;
grant execute on function public.my_waiting_decisions() to authenticated;
