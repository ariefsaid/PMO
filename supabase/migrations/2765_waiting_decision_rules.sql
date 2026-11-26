-- The decision transitions and waiting queue read shared, internal authorization predicates.
-- drops: inline actor checks move into the shared predicates. Transition locks, diagnostics
-- and input validation are kept. The waiting queue also checks assignment and pending state.
-- drops: approve_subcontract_certificate(uuid) | "if auth.uid() = c.prepared_by or auth.uid() = c.submitted_by then" | certificate_may_decide(c.id) enforces both preparer and submitter separation of duties.
-- drops: attendance_second_record_decide(uuid,uuid,date,text,text) | "if not public.attendance_second_record_may_decide() then" | attendance_decision_may_decide(v_sec.id) delegates to the same role predicate and also enforces recorder and worker separation.
-- drops: dsr_validate(uuid) | "if not public.dsr_may_validate(r.project_id) then" | daily_report_may_decide(r.id) delegates to dsr_may_validate after its author separation check.
-- drops: my_waiting_decisions() | "where d.org_id = v_org and d.status = 'submitted' and d.author_id is distinct from v_uid" | daily_report_may_decide(d.id) supplies author separation and validation authority; org and submitted-status filters remain on the query.
-- drops: my_waiting_decisions() | "and public.dsr_may_validate(d.project_id)" | daily_report_may_decide(d.id) delegates to dsr_may_validate for project validation authority.
-- drops: my_waiting_decisions() | "and v_role in ('Admin', 'Executive', 'Project Manager', 'Finance')" | daily_report_may_decide(d.id) delegates to dsr_may_validate for eligible validation roles.
-- drops: my_waiting_decisions() | "and (public.holds_won_value_authority(v_role)" | work_order_issue_may_decide(w.id) checks value authority or an eligible value setter.
-- drops: my_waiting_decisions() | "or (w.order_value_set_at is not null and public.is_active_member(w.order_value_set_by)" | work_order_issue_may_decide(w.id) requires a recorded, active value setter.
-- drops: my_waiting_decisions() | "and public.may_approve_work_of(w.order_value_set_by, v_uid)))" | work_order_issue_may_decide(w.id) requires the caller to outrank the value setter.
-- drops: my_waiting_decisions() | "and (v_role = 'Admin'" | delivery_record_may_decide(pr.id) checks the eligible delivery role.
-- drops: my_waiting_decisions() | "or (pr.requested_by_id = v_uid and v_role in ('Executive', 'Project Manager', 'Finance', 'Engineer'))" | delivery_record_may_decide(pr.id) checks requester eligibility by role.
-- drops: my_waiting_decisions() | "or (v_role = 'Project Manager' and p.project_manager_id = v_uid))" | delivery_record_may_decide(pr.id) allows project managers only for their assigned project.
-- drops: my_waiting_decisions() | "where q.org_id = v_org and q.status = 'pending_approval' and public.qcr_may_approve_role(v_org)" | quantity_change_may_decide(q.id) supplies org and reviewer-role checks; the pending-status filter remains on the query.
-- drops: my_waiting_decisions() | "and q.author_id is distinct from v_uid and not (v_uid = any (q.editor_ids)) and q.submitted_by is distinct from v_uid" | quantity_change_may_decide(q.id) excludes authors, editors, and submitters.
-- drops: my_waiting_decisions() | "where c.org_id = v_org and c.status = 'submitted' and v_role in ('Admin', 'Finance', 'Executive')" | certificate_may_decide(c.id) checks org, eligible role, and the certificate's prepared/submitted users.
-- drops: my_waiting_decisions() | "and c.prepared_by is distinct from v_uid and c.submitted_by is distinct from v_uid" | certificate_may_decide(c.id) excludes the preparer and submitter.
-- drops: my_waiting_decisions() | "and sd.created_by is distinct from v_uid" | stock_writeoff_may_decide(sd.id) excludes the write-off author.
-- drops: my_waiting_decisions() | "and coalesce(public.role_rank(v_role) >= 20, false)" | stock_writeoff_may_decide(sd.id) checks rank or material coordinator authority.
-- drops: my_waiting_decisions() | "and not (v_uid = any (asr.recorded_by_ids)) and not (v_uid = any (ad.recorded_by_ids))" | attendance_decision_may_decide(asr.id) excludes anyone who recorded either figure.
-- drops: my_waiting_decisions() | "and public.attendance_second_record_may_decide()" | attendance_decision_may_decide(asr.id) delegates to the attendance decision role predicate.
-- drops: qcr_assert_approver(public.quantity_change_requests) | "declare v_uid uuid := auth.uid();" | quantity_change_may_decide(p_request.id) reads auth.uid() in its shared author/editor/submitter check.
-- drops: qcr_assert_approver(public.quantity_change_requests) | "if v_uid = p_request.author_id or v_uid = any (p_request.editor_ids) or v_uid is not distinct from p_request.submitted_by then" | quantity_change_may_decide(p_request.id) rejects author, editor, and submitter self-approval.
-- drops: qcr_assert_approver(public.quantity_change_requests) | "end if;" | quantity_change_may_decide(p_request.id) owns the completed author/editor/submitter self-approval check.
-- drops: stock_assert_writeoff_approver(public.stock_documents,uuid) | "v_rank_ok := coalesce(public.role_rank(public.auth_role()) >= 20, false)" | stock_writeoff_may_decide(p_doc.id) checks the required rank or material coordinator authority.
-- drops: stock_assert_writeoff_approver(public.stock_documents,uuid) | "or coalesce(public.actor_holds_job_role('material_coordinator'), false);" | stock_writeoff_may_decide(p_doc.id) checks the required rank or material coordinator authority.
-- drops: transition_procurement(uuid,procurement_status,text) | "if not v_is_admin then" | delivery_record_may_decide(p_id) guards Ordered to Received; remaining transitions retain their non-Admin role checks.
-- drops: transition_procurement(uuid,procurement_status,text) | "when v_from = 'Ordered'   and p_to = 'Received' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end" | delivery_record_may_decide(p_id) allows Admin/Project Manager or an eligible requester to receive.
-- drops: transition_work_order(uuid,public.work_order_status,boolean) | "if coalesce(v_value, 0) > 0" | work_order_issue_may_decide(p_id) includes the positive-value case in its issuance authorization predicate.
-- drops: transition_work_order(uuid,public.work_order_status,boolean) | "and not public.holds_won_value_authority(v_role)" | work_order_issue_may_decide(p_id) checks value authority before issuance.
-- drops: transition_work_order(uuid,public.work_order_status,boolean) | "and (    v_set_at is null" | work_order_issue_may_decide(p_id) checks for a recorded eligible value setter.
-- drops: transition_work_order(uuid,public.work_order_status,boolean) | "or v_set_by is null" | work_order_issue_may_decide(p_id) checks for a recorded eligible value setter.
-- drops: transition_work_order(uuid,public.work_order_status,boolean) | "or v_set_by is not distinct from auth.uid()" | work_order_issue_may_decide(p_id) excludes self-approval by the value setter.
-- drops: transition_work_order(uuid,public.work_order_status,boolean) | "or not public.is_active_member(v_set_by)" | work_order_issue_may_decide(p_id) requires the value setter to remain an active member.
-- drops: transition_work_order(uuid,public.work_order_status,boolean) | "or not public.may_approve_work_of(v_set_by, auth.uid()) )" | work_order_issue_may_decide(p_id) requires the caller to outrank the active value setter.
-- drops: transition_work_order(uuid,public.work_order_status,boolean) | "then" | work_order_issue_may_decide(p_id) returns false when the issuance authorization conditions are not satisfied.

create function public.stock_writeoff_may_decide(p_record uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select from public.stock_documents d
     where d.id = p_record and d.org_id = public.auth_org_id()
       and d.created_by is distinct from auth.uid()
       and (coalesce(public.role_rank(public.auth_role()) >= 20, false)
            or public.actor_holds_job_role('material_coordinator'))
  );
$$;
revoke all on function public.stock_writeoff_may_decide(uuid) from public, anon, authenticated, service_role;

create function public.daily_report_may_decide(p_record uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select from public.daily_site_reports d
     where d.id = p_record and d.org_id = public.auth_org_id()
       and d.author_id is distinct from auth.uid()
       and public.dsr_may_validate(d.project_id)
  );
$$;
revoke all on function public.daily_report_may_decide(uuid) from public, anon, authenticated, service_role;

create function public.quantity_change_may_decide(p_record uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select from public.quantity_change_requests q
     where q.id = p_record and q.org_id = public.auth_org_id()
       and public.qcr_may_approve_role(q.org_id)
       and not coalesce(auth.uid() = q.author_id or auth.uid() = any (q.editor_ids)
                        or auth.uid() is not distinct from q.submitted_by, false)
  );
$$;
revoke all on function public.quantity_change_may_decide(uuid) from public, anon, authenticated, service_role;

create function public.certificate_may_decide(p_record uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select from public.subcontract_certificates c
     where c.id = p_record and c.org_id = public.auth_org_id()
       and public.auth_role() in ('Admin', 'Finance', 'Executive')
       and c.prepared_by is distinct from auth.uid() and c.submitted_by is distinct from auth.uid()
  );
$$;
revoke all on function public.certificate_may_decide(uuid) from public, anon, authenticated, service_role;

create function public.attendance_decision_may_decide(p_record uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select from public.attendance_second_records s
      left join public.attendance_days d on d.worker_id = s.worker_id and d.work_order_id = s.work_order_id and d.work_date = s.work_date
      join public.people w on w.id = s.worker_id
     where s.id = p_record and s.org_id = public.auth_org_id()
       and not coalesce(auth.uid() = any (s.recorded_by_ids) or auth.uid() = any (d.recorded_by_ids), false)
       and w.profile_id is distinct from auth.uid()
       and public.attendance_second_record_may_decide()
  );
$$;
revoke all on function public.attendance_decision_may_decide(uuid) from public, anon, authenticated, service_role;

create function public.work_order_issue_may_decide(p_record uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select from public.work_orders w
     where w.id = p_record and w.org_id = public.auth_org_id()
       and public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance')
       and (coalesce(w.order_value, 0) <= 0 or public.holds_won_value_authority(public.auth_role())
            or (w.order_value_set_at is not null and w.order_value_set_by is not null
                and w.order_value_set_by is distinct from auth.uid()
                and public.is_active_member(w.order_value_set_by)
                and public.may_approve_work_of(w.order_value_set_by, auth.uid())))
  );
$$;
revoke all on function public.work_order_issue_may_decide(uuid) from public, anon, authenticated, service_role;

create function public.delivery_record_may_decide(p_record uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select from public.procurements p
     where p.id = p_record and p.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin', 'Project Manager')
            or (p.requested_by_id = auth.uid() and public.auth_role() in ('Executive', 'Finance', 'Engineer')))
  );
$$;
revoke all on function public.delivery_record_may_decide(uuid) from public, anon, authenticated, service_role;

create function public.transfer_receipt_may_decide(p_record uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select from public.stock_transfers t
     where t.id = p_record and t.org_id = public.auth_org_id()
       and public.stock_transfer_actor_ok(t, 'receive')
       and (t.sent_by is distinct from auth.uid() or coalesce(public.role_rank(public.auth_role()) >= 50, false))
  );
$$;
revoke all on function public.transfer_receipt_may_decide(uuid) from public, anon, authenticated, service_role;

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

create or replace function public.stock_assert_writeoff_approver(p_doc public.stock_documents, p_uid uuid) returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_self_ok boolean; v_rank_ok boolean;
begin
  v_self_ok := p_doc.created_by is distinct from p_uid;                                                   -- mut:selfapprove
  if not v_self_ok then raise exception 'STK_SELF_APPROVE: a write-off must be posted by someone other than its author' using errcode = 'P0001'; end if;
  v_rank_ok := (
    public.stock_writeoff_may_decide(p_doc.id) -- mut:writeoff_rank
  );
  if not v_rank_ok then raise exception 'STK_RANK: only a Project Manager or above, or the Material Coordinator, posts a write-off' using errcode = 'P0001'; end if;
end $$;

create or replace function public.dsr_validate(p_report uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); r public.daily_site_reports; l record; v record;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  select * into r from public.daily_site_reports where id = p_report and org_id = v_org for update;
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.status <> 'submitted' then raise exception 'only a submitted report can be validated' using errcode = '42501'; end if;
  -- FR-DSR-015: separation of duties, no sole-user exception.
  if not public.daily_report_may_decide(r.id) then
    if r.author_id = v_uid then
      raise exception 'the author of a report cannot validate it' using errcode = '42501';
    end if;
    raise exception 'you cannot validate site reports on this project' using errcode = '42501';
  end if;
  -- OD-DSR-4: the paper form's photo is the evidence.
  if not exists (select 1 from public.dsr_photos ph where ph.report_id = r.id and ph.kind = 'paper_form'
                 and public.dsr_photo_stored(ph.file_path)) then
    raise exception 'a photo of the paper form is required to validate' using errcode = '23514';
  end if;
  -- FR-DSR-011: freeze the rate in force on the work date.
  for l in select * from public.dsr_progress_lines where report_id = r.id loop
    select * into v from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, r.variant_id, r.work_date, r.area_id);
    update public.dsr_progress_lines set frozen_rate = v.rate, frozen_rate_id = v.rate_id, frozen_rate_source = v.source,
           frozen_amount = case when v.rate is null then null else public.dsr_line_amount(l.quantity, v.rate) end, frozen_at = now()
     where id = l.id;
  end loop;
  update public.daily_site_reports set status = 'validated', validated_by = v_uid, validated_at = now(), updated_at = now() where id = r.id;
  perform public.dsr_log(r.id, v_org, 'validated', null);
  if r.supersedes_id is not null then
    update public.daily_site_reports set superseded_at = now() where id = r.supersedes_id and superseded_at is null;
    perform public.dsr_log(r.supersedes_id, v_org, 'superseded', r.correction_reason);
  end if;
end $function$;

create or replace function public.qcr_assert_approver(p_request public.quantity_change_requests) returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public.quantity_change_may_decide(p_request.id) then return; end if;
  if not public.qcr_may_approve_role(p_request.org_id) then
    raise exception 'QCR_NOT_APPROVER: your role cannot approve or return quantity change requests; ask an approver, or an Admin to add your role to the reviewer list' using errcode = '42501';
  end if;
  raise exception 'QCR_SOD_AUTHOR: separation of duties: the person who raised, edited or submitted a request cannot approve it; ask another reviewer' using errcode = '42501';
end; $$;

create or replace function public.approve_subcontract_certificate(p_certificate uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); c public.subcontract_certificates; v_v jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin', 'Finance', 'Executive') then
    raise exception 'only Finance, Executive and Admin approve a certificate' using errcode = '42501'; end if;
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = v_org;
  if c.id is null then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  perform public.assert_feature_on(v_org, 'procurement');
  perform 1 from public.procurements where id = c.procurement_id and org_id = v_org for update;
  perform public.subcontract_po_lock(c.po_id);
  select * into c from public.subcontract_certificates where id = p_certificate for update;
  if c.status <> 'submitted' then raise exception 'only a submitted certificate can be approved' using errcode = '23514'; end if;
  -- SOD-CHECK
  if not public.certificate_may_decide(c.id) then
    raise exception 'separation of duties: a certificate needs a different approver' using errcode = '42501', detail = 'needs-different-approver'; end if;
  -- /SOD-CHECK
  if jsonb_array_length(coalesce(c.unrated, '[]'::jsonb)) > 0 then
    raise exception 'some measured work has no usable rate; rate it or set it aside' using errcode = '23514', detail = 'cert-unrated'; end if;
  if c.net < 0 then
    raise exception 'the backcharges (%) are more than the gross (%); the net would be negative', c.backcharge_total, c.gross
      using errcode = '23514', detail = 'cert-net-negative'; end if;
  -- CAP-CHECK
  v_v := public.subcontract_bill_cap_violation(c.po_id, (select jsonb_agg(jsonb_build_object('boq_item_id', l.boq_item_id, 'quantity', l.measured_quantity))
                                                          from public.subcontract_certificate_lines l where l.certificate_id = c.id), null);
  if v_v is not null then
    if v_v->>'reason' = 'over_cap' then
      raise exception 'line % cannot be approved: verified %, PO %, billed %, this certificate %',
        v_v->>'item_code', v_v->>'verified', v_v->>'po_qty', v_v->>'billed', v_v->>'requested' using errcode = 'SC001';
    end if;
    raise exception 'the bill cap could not be evaluated (%); approval is refused', v_v->>'reason' using errcode = 'SC001';
  end if;
  -- /CAP-CHECK
  perform set_config('pmo.spc_transition', 'on', true);
  update public.subcontract_certificates set status = 'approved', approved_by = auth.uid(), approved_at = now(), bill_refusal = null, bill_refusal_at = null
   where id = c.id;
  perform set_config('pmo.spc_transition', '', true);
  perform public.log_audit('subcontract_certificate.approve', v_org, auth.uid(), c.id, jsonb_build_object(
    'prepared_by', c.prepared_by, 'submitted_by', c.submitted_by, 'net', c.net));
end $$;

create or replace function public.attendance_second_record_decide(p_worker_id uuid, p_work_order_id uuid, p_work_date date,
                                                       p_stand text, p_reason text)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_day public.attendance_days;
  v_sec public.attendance_second_records;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_stand is null or p_stand not in ('day', 'second') then
    raise exception 'ATT_DECIDE_STAND: choose the site report figure or the second record' using errcode = '22023';
  end if;
  select * into v_sec from public.attendance_second_records s
   where s.worker_id = p_worker_id and s.work_order_id = p_work_order_id and s.work_date = p_work_date and s.org_id = v_org for update;
  if v_sec.id is null then
    raise exception 'second record not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('att-week:' || p_worker_id::text || ':' ||
            date_trunc('week', p_work_date::timestamp)::date::text, 0));
  select * into v_day from public.attendance_days a
   where a.worker_id = p_worker_id and a.work_order_id = p_work_order_id and a.work_date = p_work_date for update;
  if not public.attendance_decision_may_decide(v_sec.id) then
    if v_uid = any (v_sec.recorded_by_ids) or (v_day.id is not null and v_uid = any (v_day.recorded_by_ids)) then
      raise exception 'ATT_DECIDE_SAME_PERSON: you recorded one of these figures; someone else decides' using errcode = '42501';
    end if;
    if exists (select 1 from public.people w where w.id = p_worker_id and w.profile_id = v_uid) then
      raise exception 'ATT_DECIDE_SELF: this is your own working day; someone else decides which hours stand' using errcode = '42501';
    end if;
    raise exception 'ATT_DECIDER_ROLE: your role does not decide which hours stand' using errcode = '42501';
  end if;
  if v_sec.decided_at is not null then
    raise exception 'ATT_DECIDED: this day is already decided' using errcode = '55000';
  end if;
  if v_day.id is null then
    raise exception 'ATT_NO_DAY: the site report figure for this day is not recorded yet' using errcode = '23514';
  end if;
  if v_day.locked_at is not null or v_day.submitted_at is not null or exists (
       select 1 from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
        where e.id = v_day.timesheet_entry_id and t.status <> 'Draft') then
    raise exception 'ATT_SUBMITTED: this week is submitted; return it through the timesheet correction path to change it'
      using errcode = '55000';
  end if;
  if not public.attendance_day_undecided(p_worker_id, p_work_order_id, p_work_date) then
    raise exception 'ATT_NOT_DISAGREEING: the two records agree, nothing to decide' using errcode = '23514';
  end if;
  if v_reason is null then
    raise exception 'ATT_DECIDE_REASON: say why this figure stands' using errcode = '22023';
  end if;

  -- The decision marker tells the reopen trigger (1702) this change of the day's figure is the decision itself.
  perform set_config('pmo.pay_time_decide', 'on', true);
  update public.attendance_days a
     set status = case when p_stand = 'second' then v_sec.status else a.status end,
         hours = case when p_stand = 'second' then v_sec.hours else a.hours end,
         overtime_hours = case when p_stand = 'second' then v_sec.overtime_hours else a.overtime_hours end,
         -- The decider wrote the standing figure, and when the second record stands its author(s) wrote it too: all of them join the
         -- day's recorders, so the approval separation (attendance_decide_week, the timesheet trigger) refuses each of them.
         recorded_by_ids = (select array_agg(distinct x) from unnest(a.recorded_by_ids || v_uid
                              || case when p_stand = 'second' then v_sec.recorded_by_ids else '{}'::uuid[] end) x)
   where a.id = v_day.id;
  perform set_config('pmo.pay_time_decide', 'off', true);
  update public.attendance_second_records
     set standing = p_stand, decided_by = v_uid, decided_at = now(), decision_reason = v_reason
   where id = v_sec.id;
  perform public.log_audit('attendance.second_record_decide', v_org, v_uid, p_work_order_id,
            jsonb_build_object('worker_id', p_worker_id, 'work_date', p_work_date, 'stand', p_stand, 'reason', v_reason));
end $$;

create or replace function public.transition_work_order(
  p_id uuid,
  p_to public.work_order_status,
  p_over_commit_ack boolean default null)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from       public.work_order_status;
  v_org        uuid;
  v_project    uuid;
  v_value      numeric;
  v_set_by     uuid;
  v_set_at     timestamptz;
  v_number     text;
  v_role       user_role := auth_role();
  v_ceiling    numeric;
  v_treatment  text;      -- #513: this work order's own tax basis
  v_tax        numeric;   -- #513: this work order's own tax amount
  v_net        numeric;   -- #513: v_value normalised to net
  v_committed  numeric;
  v_exceeds    boolean := false;
  v_ack_by     uuid;
  v_ack_at     timestamptz;
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Issued','Cancelled'),
    'Issued',    jsonb_build_array('Closed','Cancelled'),
    'Closed',    jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  perform public.assert_not_light();
  -- Load + lock the work order. The witness pair is read under the SAME lock as the value it
  -- witnesses — a concurrent set_work_order_value takes that lock too, so they cannot be read torn.
  -- ⚑ #513: this row's OWN tax facts are read under the SAME lock as its value, for the same reason
  -- the witness pair is — a basis read separately from the figure it describes can be read torn.
  select status, org_id, project_id, order_value, order_value_set_by, order_value_set_at, wo_number,
         tax_treatment, tax_amount
    into v_from, v_org, v_project, v_value, v_set_by, v_set_at, v_number,
         v_treatment, v_tax
    from public.work_orders where id = p_id for update;
  if v_from is null then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;

  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org transitions.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SECURITY: this active-membership gate MUST stay — see the twin comment in set_work_order_value.
  perform public.assert_is_active_member();

  -- Coarse role gate (the transition_project shape: revenue is not procurement, so there is no
  -- per-transition matrix). SECURITY: MUST stay — without it any authenticated user may issue.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality: (from,to) must be in the data map and not a no-op.
  if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- The acknowledgement is meaningful ONLY on the issue step. Accepting it elsewhere would let a
  -- client attach it to every call and turn it into noise.
  if p_to is distinct from 'Issued' and p_over_commit_ack is not null then
    raise exception
      'the over-commitment acknowledgement applies only to issuing a work order, not to a % transition',
      p_to
      using errcode = 'P0001';
  end if;

  if p_to = 'Issued' then
    -- ── THE MONEY SoD. SECURITY: this block MUST stay. Without it one person sets the value on a
    -- Draft, issues it alone, and books client revenue at a figure NOBODY ELSE EVER APPROVED.
    -- Every clause is TOTAL (`is distinct from`, an explicit `is null` branch, helpers that all
    -- coalesce to FALSE) because a NULL-valued condition does not fire an `if` — the exact defect
    -- 0176 §6 had to repair in four other guards.
    --   (i)   there is money on the row              -> otherwise there is nothing to ratify;
    --   (ii)  the ISSUER does not themselves hold won-value authority -> a Finance/Exec/Admin issuer
    --         is already the accountable party and needs nobody;
    --   (iii) the value was authored by a DISTINCT, ACTIVE person who may approve THIS issuer's work.
    --         The direction matters and is easy to get backwards: the question is not "may the issuer
    --         approve the author?" but "did someone with authority OVER THE ISSUER put their name on
    --         this number?" A PM whose line manager set the value is cleared; a PM whose PEER set it
    --         is not.
    if not public.work_order_issue_may_decide(p_id) then
      if v_set_at is null or v_set_by is null then
        raise exception
          'this work order''s value has no recorded author, so you cannot issue it: the value must be set by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      elsif v_set_by is not distinct from auth.uid() then
        raise exception
          'you set this work order''s value yourself, so you cannot also issue it: the value must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      elsif not public.is_active_member(v_set_by) then
        -- Ordered BEFORE the seniority branch: an offboarded peer is offboarded first and not-senior
        -- second, and the operator needs "get someone who is still here".
        raise exception
          'this work order''s value was set by someone who is no longer an active member of this organisation, so you cannot issue it: it must be re-set by your supervisor or by someone who outranks you who is currently active, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      else
        raise exception
          'this work order''s value was not set by anyone senior to you, so you cannot issue it: it must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      end if;
    end if;

    -- ── THE DRAWDOWN, COMPUTED UNDER THE PARENT'S LOCK (DD-WO-2). Locking the project row is what
    -- serializes two concurrent issues on the SAME project: without it both read the same committed
    -- total, both decide they fit, and the pair lands over the ceiling with no acknowledgement.
    -- ⚑ #513: EVERY figure below is NET. Before this, the gate compared a work order's stated
    -- `order_value` against a `contract_value` with no tax basis at all, so an exclusive WO under an
    -- inclusive ceiling made the drawdown look SMALLER than it is — the control UNDER-detected the
    -- over-commitment it exists to detect, and nobody was ever asked to acknowledge it. The
    -- normalisation here is byte-identical to `get_project_drawdown`'s (§3), deliberately: a gate
    -- that computes the drawdown differently from the screen showing it is worse than either being
    -- wrong alone, because the two disagree and neither is visibly at fault.
    select (case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                 else p.contract_value end)
      into v_ceiling
      from public.projects p where p.id = v_project for update;
    if v_ceiling is null then
      raise exception 'work order parent project not found' using errcode = 'P0002';
    end if;

    select coalesce(sum(coalesce(wo.closing_value,case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                             else wo.order_value end)), 0)
      into v_committed
      from public.work_orders wo
     where wo.project_id = v_project and wo.status in ('Issued','Closed');

    v_net := case when v_treatment = 'inclusive' then coalesce(v_value, 0) - coalesce(v_tax, 0)
                  else coalesce(v_value, 0) end;

    v_exceeds := (v_committed + v_net) > v_ceiling;

    -- FAIL CLOSED: the acknowledgement is never assumed. `is not true` covers both NULL (the caller
    -- said nothing) and false (the caller explicitly declined) — a `= false` test would let an
    -- omitted parameter through.
    if v_exceeds and p_over_commit_ack is not true then
      raise exception
        'issuing this work order would commit % against a contract ceiling of % (already committed: %): this is allowed, but it must be acknowledged explicitly — re-issue with the over-commitment acknowledgement so the decision is recorded against your name',
        v_committed + v_net, v_ceiling, v_committed
        using errcode = 'P0001';
    end if;

    -- The mirror of fail-closed: an acknowledgement with nothing to acknowledge is refused rather
    -- than accepted-and-ignored. If it were ignored, a client could send it unconditionally and the
    -- stamp would stop meaning "a person looked at an over-commitment and chose it".
    if p_over_commit_ack is not null and not v_exceeds then
      raise exception
        'there is no over-commitment to acknowledge: committing % leaves the contract ceiling of % intact',
        v_committed + v_net, v_ceiling
        using errcode = 'P0001';
    end if;

    if v_exceeds then
      v_ack_by := auth.uid();
      v_ack_at := now();
    end if;

    -- Mint the document number (once) and stamp the issue. `coalesce` rather than an unconditional
    -- mint so a re-run can never burn a second number on the same row.
    update public.work_orders set
      status             = p_to,
      wo_number          = coalesce(wo_number, public.next_procurement_doc_number(v_org, 'WO')),
      issued_by          = auth.uid(),
      issued_at          = now(),
      over_commit_ack_by = v_ack_by,
      over_commit_ack_at = v_ack_at
    where id = p_id;

  elsif p_to = 'Closed' then
    if exists(select 1 from public.work_order_lines l where l.work_order_id=p_id) then
      raise exception 'this work order has contract lines: close it by confirming its final BAST' using errcode='42501';
    end if;
    update public.work_orders set status = p_to, closed_at = now() where id = p_id;
  else  -- 'Cancelled'
    update public.work_orders set status = p_to, cancelled_at = now() where id = p_id;
  end if;

  perform public.log_audit('work_order.transition', v_org, auth.uid(), p_id,
                           jsonb_build_object('from',               v_from::text,
                                              'to',                 p_to::text,
                                              'project_id',         v_project,
                                              'order_value',        v_value,
                                              'order_value_set_by', v_set_by,
                                              'order_value_set_at', v_set_at,
                                              'contract_ceiling',   v_ceiling,
                                              'committed_before',   v_committed,
                                              'over_commit_ack_by', v_ack_by));
end; $$;

create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from procurement_status; v_org uuid; v_requester uuid; v_approver uuid;
  v_project uuid; v_category public.budget_category; v_currency text; v_amount numeric; v_route record;
  v_pr_id uuid; v_pr_no text;                                                                          -- 0766
  v_role user_role := auth_role(); v_uid uuid := auth.uid(); v_is_admin boolean;
  v_gate text;                                                                                         -- 0362
  v_wo uuid; v_disc uuid;                                                               -- 1580
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled','Ordered','Received','Vendor Invoiced','Paid'),   -- 0362 skips
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled','Received','Vendor Invoiced','Paid'), -- 0362 skips
    'Vendor Quoted',   jsonb_build_array('Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled','Received','Vendor Invoiced','Paid'),               -- 0362 skips
    'Ordered',         jsonb_build_array('Received','Cancelled','Vendor Invoiced','Paid'),                         -- 0362 skips
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled','Paid'),                                    -- 0362 skip
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array());
  v_allowed_roles text[];
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select status, org_id, requested_by_id, approved_by_id, project_id, budget_category, currency, work_order_id, discipline_id   -- 1580
    into v_from, v_org, v_requester, v_approver, v_project, v_category, v_currency, v_wo, v_disc
    from public.procurements where id = p_id for update;
  if v_from is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- FR-PLN-006 closure: cancelling or rejecting an EXISTING purchase is a CLOSING transition (paid closes
  -- an already-invoiced one); a switch-off must not strand it. Every forward/minting transition is gated.
  if p_to is null or p_to::text not in ('Cancelled','Rejected','Paid') then
    perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  end if;

  if exists(select 1 from public.procurements where id=p_id and record_only) then
    v_gate := public.record_only_step_refusal(p_id,case p_to::text when 'Ordered' then 'purchase-order' when 'Received' then 'goods-receipt' when 'Vendor Invoiced' then 'purchase-invoice' when 'Paid' then 'paid' when 'Cancelled' then 'cancel' else 'unknown' end,null);
    if v_gate is not null then raise exception '%' ,v_gate using errcode='42501'; end if;
  end if;

  -- 0362 FR-PFE-006: a document step the purchase already holds is a no-op — its current step, or a lower step it
  -- has evidence for (e.g. Received, then a request for Ordered once an order is recorded).
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid')
     and (v_from = p_to
          or (public.procurement_step_rank(p_to) < public.procurement_step_rank(v_from)
              and (exists (select 1 from public.purchase_orders x where p_to = 'Ordered' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_receipts x where p_to = 'Received' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_invoices x where p_to = 'Vendor Invoiced' and x.procurement_id = p_id
                                and coalesce(x.erp_docstatus, 1) <> 2 and x.erp_cancelled_at is null)
                   or exists (select 1 from public.procurement_erp_links l
                                join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                               where l.procurement_id = p_id and d.erp_docstatus = 1
                                 and d.erp_doctype = case p_to::text when 'Ordered' then 'Purchase Order'
                                                     when 'Received' then 'Purchase Receipt' else 'Purchase Invoice' end)))) then
    return;
  end if;

  if public.record_only_step_refusal(p_id) is not null then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;

  if v_from = 'Vendor Quoted' and p_to = 'Quote Selected' then
    raise exception 'select a quote to move to Quote Selected' using errcode = 'P0001';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;
  -- 0749 (#1607): an ERP-owned purchase places its order through the connected system, never as a PMO-only row.
  if p_to = 'Ordered' and public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_id), false) then
    raise exception 'This purchase is managed in your connected system. Record the purchase order to place the order there.'
      using errcode = '42501';
  end if;

  if v_from='Requested' and p_to in ('Approved','Rejected')
    and (public.equipment_plan_purchase_submit_context(p_id)->>'is_submitter')::boolean then
    raise exception 'separation of duties: submitter cannot approve own procurement' using errcode='42501';
  end if;

  -- SoD-a (requester ≠ approver), outside the Admin skip (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;
  -- SoD-b (approver ≠ payer) on every path to Paid; the update guard re-checks it (0362, FR-PFE-016).
  if p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0362 FR-PFE-010: org purchase rules.
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid') then
    v_gate := public.procurement_gate_violation(p_id, p_to);
    if v_gate is not null then
      raise exception '%', public.procurement_gate_message(v_gate) using errcode = '23514', detail = v_gate;
    end if;
  end if;

  if v_from = 'Requested' and p_to in ('Approved','Rejected') then
    if v_project is not null then
      -- 1017: whole-project test lock, taken before the line lock (project -> line, everywhere).
      perform pg_advisory_xact_lock(hashtextextended('spend-project:' || v_project::text, 0));
      if v_category is not null then
        perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0));
      end if;
    end if;
    v_amount := public.procurement_request_amount(p_id);
    select * into v_route from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester,
             v_uid, public.procurement_submitted_at(p_id));
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
    end if;
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_category::text,
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  end if;

  if v_from = 'Ordered' and p_to = 'Received' then
    if not public.delivery_record_may_decide(p_id) then
      raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
    end if;
  elsif not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'     and p_to = 'Requested' then case when v_is_requester or (public.equipment_plan_purchase_submit_context(p_id)->>'may_submit')::boolean then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested' and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'  and p_to = 'Draft' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'  and p_to = 'Vendor Quoted' then array['Project Manager','Finance']
          when p_to = 'Ordered'                                then array['Project Manager','Finance']                    -- 0362: also from Draft
          when p_to = 'Received'                               then array['Project Manager','Finance']                    -- 0362: skip into Received
          when p_to = 'Vendor Invoiced'                        then array['Finance']
          when p_to = 'Paid'                                   then array['Finance']
          else array[]::text[]
        end;
      end if;
      if not (v_role::text = any (v_allowed_roles)) then
        -- 1842 roles-that-decide FR-RTD-009/010: a person who fills one of the organisation's ordering job roles orders an
        -- approved purchase; never one that skipped approval. Everyone else meets today's refusal, worded for ordering.
        if v_from = 'Approved' and p_to = 'Vendor Quoted' and public.actor_may_order_purchases() then
          null; -- the ordering right also starts sourcing
        elsif p_to = 'Ordered' and public.actor_may_order_purchases() then                              -- mut:order_gate
          if v_from not in ('Approved', 'Quote Selected') then                                        -- mut:order_approved
            raise exception 'PO_ORDER_NOT_APPROVED: this purchase has not been approved yet, so it cannot be ordered'
              using errcode = '42501';
          end if;
        elsif p_to = 'Ordered' then
          raise exception 'PO_ORDER_FORBIDDEN: you cannot order purchases; ask an Admin to name your built-in role as one that orders'
            using errcode = '42501';
        else
          raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
        end if;
      end if;
    end;
  end if;

  -- 0766 (#1986): a purchase request captured while the purchase was still Draft is the request this transition submits.
  if p_to = 'Requested' then
    select r.id, r.pr_number into v_pr_id, v_pr_no from public.purchase_requests r
     where r.procurement_id = p_id and r.status = 'Draft' and r.import_key is null and r.pr_number is not null
       and (select pr_number from public.procurements where id = p_id) is null
     order by r.created_at limit 1 for update;
  end if;

  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, v_pr_no, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected'  then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,  -- 0362: skips to Paid keep the stamp
    updated_at         = now()
  where id = p_id;

  if p_to = 'Requested' and v_pr_id is not null then
    update public.purchase_requests set status = 'Submitted' where id = v_pr_id;
  elsif p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date, work_order_id, discipline_id)   -- 1580: the request carries its cost attribution
    select p_id, p.pr_number, 'Submitted', public.native_org_today(v_org),
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc
      from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date, work_order_id, discipline_id, amount)   -- the order carries the selected quote
    select p_id, p.po_number, 'Issued', public.native_org_today(v_org),
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc,
           (select q.total_amount from public.procurement_quotations q where q.procurement_id = p_id and q.is_selected)
      from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_orders po where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    update public.payments set status = 'Paid', date = coalesce(date, public.native_org_today(v_org))
     where procurement_id = p_id and status = 'Scheduled';
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', public.native_org_today(v_org),
           coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                        - coalesce(i.withheld_amount, 0)) filter (where i.amount is not null), p.total_value),
           p.currency
      from public.procurements p left join public.procurement_invoices i on i.procurement_id = p.id
     where p.id = p_id and not exists (select 1 from public.payments pay where pay.procurement_id = p_id)
     group by p.id;
  end if;

  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;

create or replace function public.receive_stock_transfer(p_transfer uuid, p_lines jsonb, p_confirmation jsonb default null) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t public.stock_transfers; v_uid uuid := auth.uid(); e jsonb; l public.stock_transfer_lines; v_item record; v_c numeric; v_a numeric; v_r numeric;
  v_q text; v_reason text; v_acc jsonb := '[]'::jsonb; v_rej jsonb := '[]'::jsonb; v_open boolean; v_missing text; v_seen uuid[] := '{}';
begin
  perform public.assert_is_active_member();
  t := public.stock_lock_transfer(p_transfer, true);
  if t.status <> 'Sent' then raise exception 'STK_INVALID: this transfer was already received or cancelled' using errcode = 'P0001'; end if;
  if not public.transfer_receipt_may_decide(t.id) then
    if not public.stock_transfer_actor_ok(t, 'receive') then
      raise exception 'STK_NOT_RECEIVER: you do not keep the destination and the transfer is not addressed to you' using errcode = 'P0001'; end if;
    raise exception 'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it' using errcode = 'P0001';
  end if;
  if t.sent_by = v_uid then
    perform public.stock_assert_not_self_receive(t);
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) <> (select count(*) from public.stock_transfer_lines x where x.transfer_id = t.id) then
    raise exception 'STK_INVALID: give a count for every line of the transfer' using errcode = 'P0001'; end if;
  for e in select x from jsonb_array_elements(p_lines) as x loop
    select * into l from public.stock_transfer_lines x where x.id = (e->>'line_id')::uuid and x.transfer_id = t.id for update;
    if not found or l.id = any (v_seen) then raise exception 'STK_INVALID: a count names an unknown or repeated line' using errcode = 'P0001'; end if;
    v_seen := v_seen || l.id;
    v_c := (e->>'counted')::numeric; v_a := (e->>'accepted')::numeric; v_r := coalesce((e->>'rejected')::numeric, v_c - v_a);
    if v_c is null or v_a is null or v_c <> round(v_c, 3) or v_a <> round(v_a, 3) or v_r <> round(v_r, 3) then
      raise exception 'STK_INVALID: a count needs counted and accepted quantities (3 decimals at most)' using errcode = 'P0001'; end if;
    select i.needs_quality_check, u.whole_only into v_item from public.stock_items i join public.stock_units u on u.id = i.unit_id where i.id = l.item_id;
    if v_item.whole_only and (v_c <> trunc(v_c) or v_a <> trunc(v_a)) then
      raise exception 'STK_FRACTION: this item is counted in whole units' using errcode = 'P0001'; end if;
    v_q := nullif(e->>'quality_result', '');
    if v_item.needs_quality_check then
      if v_q is null or v_q not in ('pass', 'fail') then
        raise exception 'STK_QUALITY: this item needs a quality check: record pass or fail' using errcode = 'P0001'; end if;
    else v_q := null; end if;
    v_reason := nullif(btrim(coalesce(e->>'reject_reason', '')), '');
    update public.stock_transfer_lines set qty_counted = v_c, qty_accepted = v_a, qty_rejected = v_r, reject_reason = case when v_r > 0 then v_reason end,
           quality_result = v_q where id = l.id;                                  -- the table checks bound counted, accepted + rejected and a failed quality check
    if v_a > 0 then v_acc := v_acc || jsonb_build_object('item_id', l.item_id, 'quantity', v_a); end if;
    if v_r > 0 then v_rej := v_rej || jsonb_build_object('item_id', l.item_id, 'quantity', v_r); end if;
  end loop;
  if p_confirmation is not null then
    perform public.stock_insert_handover(t, p_confirmation || jsonb_build_object('stage', 'receive'));
  end if;
  v_missing := public.stock_proof_missing(t.id);
  if v_missing is not null and public.stock_proof_timing_of(t.org_id) = 'before_posting' then           -- mut:proof_check
    raise exception 'STK_PROOF_REQUIRED: this transfer needs its proof (%) before it can be received', v_missing using errcode = 'P0001'; end if;
  if jsonb_array_length(v_acc) > 0 then perform public.stock_post_leg(t, 'transfer', t.transit_warehouse_id, t.to_warehouse_id, v_acc, t.work_order_id, null); end if;
  if jsonb_array_length(v_rej) > 0 then perform public.stock_post_leg(t, 'transfer', t.transit_warehouse_id, t.from_warehouse_id, v_rej, null, null); end if;
  select exists (select 1 from public.stock_transfer_lines x where x.transfer_id = t.id and x.qty_counted < x.qty_sent and x.short_resolution is null) into v_open;
  update public.stock_transfers set status = case when v_open then 'Received' else 'Closed' end, received_by = v_uid, received_at = now() where id = t.id;
  if not v_open then perform public.stock_close_transit(t); end if;
  perform public.log_audit('stock.transfer.receive', t.org_id, v_uid, t.id, jsonb_build_object('number', t.number, 'short_open', v_open));
end $$;
