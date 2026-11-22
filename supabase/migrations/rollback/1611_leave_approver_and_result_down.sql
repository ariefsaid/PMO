-- Reverses 1611_leave_approver_and_result.sql: the 1241 shapes of leave_requests_visible and leave_request_decide (with the
-- 1461 light-account guard), and the 1025 template guard.
delete from public.notifications where message_key in ('leaveApproved', 'leaveRejected');
create or replace function public.notifications_message_template_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_budget_owner name;
begin
  if tg_op = 'UPDATE' then
    if new.message_key is distinct from old.message_key or new.message_params is distinct from old.message_params then
      raise exception 'notification message is immutable' using errcode = '42501';
    end if;
    return new;
  end if;
  select pg_get_userbyid(p.proowner) into v_budget_owner
    from pg_catalog.pg_proc p
   where p.oid = 'public.archive_budget_version_with_cancel_intent(uuid,boolean,uuid)'::regprocedure;
  if current_user = v_budget_owner
     and new.metadata->>'action_required' = 'budget-archive-live-erp'
     and new.body = 'ERPNext may still be enforcing a budget for this project after this archive. Cancel the listed ERPNext Budget documents, or activate a new PMO budget.' then
    new.message_key := 'budgetArchiveWarning';
    new.message_params := '{}'::jsonb;
  elsif current_user = 'service_role'
     and new.message_key in ('unassignedInvoice', 'budgetCancellationHeld', 'budgetRetryAuthorization', 'budgetPushFailed')
     and jsonb_typeof(new.message_params) = 'object' then
    null;
  else
    new.message_key := 'literal';
    new.message_params := jsonb_build_object('body', new.body);
  end if;
  return new;
end; $$;

create or replace function public.leave_request_decide(p_id uuid, p_decision text, p_note text)
  returns text
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_req public.leave_requests;
  v_profile uuid;
begin
  perform public.assert_not_light();
  if v_org is null or not public.is_active_member() then
    raise exception 'LV_FORBIDDEN: not an active member' using errcode = '42501';
  end if;
  if p_decision not in ('Approved', 'Rejected') then
    raise exception 'LV_DECISION: decide Approved or Rejected' using errcode = '22023';
  end if;
  select * into v_req from public.leave_requests r where r.id = p_id and r.org_id = v_org for update;
  if not found then
    raise exception 'LV_NOT_FOUND: no such request' using errcode = 'P0002';
  end if;
  select w.profile_id into v_profile from public.people w where w.id = v_req.person_id;
  if v_req.entered_by = v_uid or coalesce(v_profile = v_uid, false) then
    raise exception 'LV_SOD: you cannot decide your own request, or one you entered' using errcode = '42501';
  end if;
  if not public.leave_authority(v_req.person_id) then
    raise exception 'LV_FORBIDDEN: you cannot decide this request' using errcode = '42501';
  end if;
  if v_req.status <> 'Pending' then
    raise exception 'LV_DECIDED: this request is already %', lower(v_req.status) using errcode = '23514';
  end if;
  if p_decision = 'Rejected' and nullif(btrim(p_note), '') is null then
    raise exception 'LV_NOTE: give a reason when rejecting' using errcode = '23514';
  end if;
  update public.leave_requests set status = p_decision, decided_by = v_uid, decided_at = now(),
         decision_note = nullif(btrim(p_note), '') where id = p_id;
  perform public.log_audit('leave.' || lower(p_decision), v_org, v_uid, p_id, '{}'::jsonb);
  return p_decision;
end $$;

drop function public.leave_requests_visible();
create function public.leave_requests_visible()
  returns table (id uuid, person_id uuid, person_name text, leave_type_id uuid, type_name text, start_date date,
                 end_date date, days integer, reason text, status text, decided_at timestamptz, decision_note text,
                 is_mine boolean, can_decide boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select r.id, r.person_id, w.name, r.leave_type_id, t.name, r.start_date, r.end_date, (r.end_date - r.start_date + 1),
         r.reason, r.status, r.decided_at, r.decision_note,
         (r.entered_by = (select auth.uid())
            or exists (select 1 from public.people me where me.id = r.person_id and me.profile_id = (select auth.uid()))),
         (r.status = 'Pending' and public.leave_authority(r.person_id)
            and r.entered_by <> (select auth.uid())
            and not exists (select 1 from public.people me where me.id = r.person_id and me.profile_id = (select auth.uid())))
    from public.leave_requests r
    join public.people_directory w on w.id = r.person_id
    join public.leave_types t on t.id = r.leave_type_id
   where public.leave_enabled()
   order by (r.status = 'Pending') desc, r.start_date desc, r.id
$$;
revoke all on function public.leave_requests_visible() from public, anon;
grant execute on function public.leave_requests_visible() to authenticated;
