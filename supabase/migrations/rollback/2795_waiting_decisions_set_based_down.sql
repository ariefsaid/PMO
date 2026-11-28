-- Rolls back 2795: restores the 2765 body of my_waiting_decisions().
create or replace function public.my_waiting_decisions()
  returns table (kind text, record_id uuid, project_id uuid, title text, created_at timestamptz)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
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
   where d.org_id = v_org and d.status = 'submitted' and public.daily_report_may_decide(d.id)
  union all
  -- work_order_issue: the gate's role set; a Project Manager only for the projects they manage; money rows follow the SoD predicate
  select 'work_order_issue'::text, w.id, w.project_id, (coalesce(w.wo_number || ' · ', '') || w.title)::text, w.created_at
    from public.work_orders w
    join public.projects p on p.id = w.project_id
   where w.org_id = v_org and w.status = 'Draft'
     and public.work_order_issue_may_decide(w.id)
     and (v_role <> 'Project Manager' or p.project_manager_id = v_uid)
     and coalesce(w.order_value, 0) > 0 and w.order_value_set_by is not null and w.order_value_set_by is distinct from v_uid
  union all
  -- delivery_record
  select 'delivery_record'::text, pr.id, pr.project_id, pr.title::text, pr.updated_at
    from public.procurements pr
    left join public.projects p on p.id = pr.project_id
   where pr.org_id = v_org and pr.status = 'Ordered'
     and public.delivery_record_may_decide(pr.id)
     and (v_role <> 'Project Manager' or pr.requested_by_id = v_uid or p.project_manager_id = v_uid)
  union all
  -- quantity_change
  select 'quantity_change'::text, q.id, q.project_id, coalesce(w.wo_number || ' · ', '') || w.title, coalesce(q.submitted_at, q.updated_at)
    from public.quantity_change_requests q
    join public.work_orders w on w.id = q.work_order_id
   where q.org_id = v_org and q.status = 'pending_approval' and public.quantity_change_may_decide(q.id)
  union all
  -- certificate
  select 'certificate'::text, c.id, c.project_id, pr.title::text, coalesce(c.submitted_at, c.created_at)
    from public.subcontract_certificates c
    join public.procurements pr on pr.id = c.procurement_id
   where c.org_id = v_org and c.status = 'submitted' and public.certificate_may_decide(c.id)
  union all
  -- transfer_receipt: narrower than the gate on purpose (a senior role may receive any transfer; only those addressed to the caller or kept by them are waiting for them)
  select 'transfer_receipt'::text, x.id, w.project_id, (x.number || ' · ' || w.name)::text, x.sent_at
    from public.stock_transfers x
    join public.stock_warehouses w on w.id = x.to_warehouse_id
   where x.org_id = v_org and x.status = 'Sent' and x.sent_by is distinct from v_uid
     and public.transfer_receipt_may_decide(x.id)
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
     and public.stock_writeoff_may_decide(sd.id)
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
     and public.attendance_decision_may_decide(asr.id)
     and public.attendance_day_undecided(asr.worker_id, asr.work_order_id, asr.work_date)
   group by dr.id, dr.project_id, aw.wo_number, aw.title, dr.work_date
  union all
  -- One decision job per order; the order receiving screen presents every pending count on it.
  select 'order_receiving'::text, po.id, p.project_id, (coalesce(po.po_number, p.title))::text, min(r.created_at)
    from public.order_receiving_requests r
    join public.purchase_orders po on po.id=r.po_id
    join public.procurements p on p.id=po.procurement_id
    join public.order_receiving_settings s on s.org_id=r.org_id and s.enabled
   where r.org_id=v_org and not public.order_receiving_approval_current(r.id) and r.stock_document_id is null and r.receiver_id<>v_uid
     and public.order_receiving_purchaser()
     and not coalesce(public.domain_externally_owned(v_org,'procurement'),false)
     and not coalesce(public.domain_externally_owned(v_org,'inventory'),false)
   group by po.id,p.project_id,po.po_number,p.title
  union all
  -- check_in: an outside-area phone clock-in waiting for the supervisor named to decide it (the same gate the Crews cards use)
  select 'check_in'::text, q.id, w.project_id, (pe.name || ' · ' || w.title)::text, q.checked_in_at
    from public.phone_check_ins q
    join public.work_orders w on w.id = q.work_order_id
    join public.people pe on pe.id = q.worker_id
   where q.org_id = v_org and q.status = 'pending' and public.phone_check_in_may_decide(q.id)
    ) as waiting(kind, record_id, project_id, title, created_at)
   order by waiting.created_at asc nulls last, waiting.kind asc, waiting.record_id asc;
end; $$;
