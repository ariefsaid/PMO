-- Reverses 1810_change_review_approver_roles.sql: qcr_assert_approver (1177), qcr_approval_state (1178 plus the assert_not_light first statement 1219 put in the database) and qcr_submit (1176 plus the assert_not_light first statement 1530 put in the database) go back to their live pre-1810 forms, then the setting goes.
create or replace function public.qcr_assert_approver(p_request public.quantity_change_requests) returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if public.auth_role() not in ('Admin','Executive','Finance') then
    raise exception 'not authorized to approve quantity change requests' using errcode = '42501';
  end if;
  if v_uid = p_request.author_id or v_uid = any (p_request.editor_ids) or v_uid is not distinct from p_request.submitted_by then
    raise exception 'separation of duties: the author cannot approve this request' using errcode = '42501';
  end if;
end; $$;

create or replace function public.qcr_approval_state(p_request_id uuid)
returns table (can_approve boolean, reason text, eligible_approver_exists boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_req public.quantity_change_requests; v_reason text;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id;
  if not found or v_req.org_id is distinct from public.auth_org_id() then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  v_reason := case
    when public.auth_role() not in ('Admin','Executive','Finance') then 'role'
    when v_uid = v_req.author_id then 'author'
    when v_uid = any (v_req.editor_ids) then 'editor'
    when v_uid is not distinct from v_req.submitted_by then 'submitter'
    when v_req.status <> 'pending_approval' then 'status'
  end;
  return query select v_reason is null, v_reason,
    exists (select 1 from public.profiles p
             where p.org_id = v_req.org_id and public.is_active_member(p.id) and p.role in ('Admin','Executive','Finance')
               and p.id <> v_req.author_id and p.id <> all (v_req.editor_ids)
               and p.id is distinct from v_req.submitted_by);
end; $$;

create or replace function public.qcr_submit(p_request_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req record; v_wo_status text; r record;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to submit a quantity change request' using errcode = '42501';
  end if;
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id for update;
  if not found or v_req.org_id is distinct from v_org then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_uid <> all (v_req.editor_ids) then
    raise exception 'only the author or an editor of this request can submit it' using errcode = '42501';
  end if;
  if v_req.status <> 'draft' then
    raise exception 'only a draft can be submitted; this request is %', v_req.status using errcode = 'P0001';
  end if;
  select w.status into v_wo_status from public.work_orders w where w.id = v_req.work_order_id;
  if v_wo_status in ('Closed','Cancelled') then
    raise exception 'a % work order cannot take a quantity change request', v_wo_status using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.quantity_change_request_lines l where l.request_id = p_request_id) then
    raise exception 'a change request needs at least one line' using errcode = '23502';
  end if;
  update public.quantity_change_requests
     set status = 'pending_approval', submitted_by = v_uid, submitted_at = now(),
         first_submitted_at = coalesce(first_submitted_at, now()), updated_at = now()
   where id = p_request_id;
  perform public.qcr_log(p_request_id, 'submitted', 'draft', 'pending_approval');
  -- Tell everyone who could approve it (never the people it is separated from).
  for r in select p.id from public.profiles p
            where p.org_id = v_org and p.role in ('Admin','Executive','Finance') and public.is_active_member(p.id)
              and p.id <> v_req.author_id and p.id <> v_uid and p.id <> all (v_req.editor_ids) loop
    perform public.notify_workflow_user(v_org, r.id, 'Quantity change request awaiting approval',
      'A quantity change request has been submitted for your approval.', 'info', 'quantity_change_request', p_request_id, 'Quantity change request');
  end loop;
end; $$;

drop trigger if exists organizations_audit_qcr_approver_roles on public.organizations;
drop trigger if exists organizations_check_qcr_approver_roles on public.organizations;
drop function if exists public.audit_org_qcr_approver_roles();
drop function if exists public.check_qcr_approver_roles();
drop function if exists public.qcr_may_approve_role(uuid);
drop function if exists public.qcr_profile_may_approve(public.user_role, text, uuid);
drop policy if exists organizations_update_quantity_change_approver_roles on public.organizations;
revoke update (quantity_change_approver_roles) on public.organizations from authenticated;
alter table public.organizations drop column quantity_change_approver_roles;
