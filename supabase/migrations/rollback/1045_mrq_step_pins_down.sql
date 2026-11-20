-- Reverses 1045_mrq_step_pins.sql: restores the 1001 authority, decide and queue bodies; drops the pins. Loses pin rows only.
drop function public.mrq_waiting_for_me();
drop function public.mrq_decide_step(uuid, integer, text, text, uuid);
drop function public.mrq_step_authority(uuid, uuid, public.user_role, uuid, uuid);
drop function public.mrq_set_step_pin(uuid, integer, uuid);
drop function public.mrq_pinned_to(uuid, integer, public.user_role);
drop table public.approval_step_pins;

create or replace function public.mrq_step_authority(p_org uuid, p_uid uuid, p_role public.user_role, p_author uuid,
                                                     out ok boolean, out acting_for uuid)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := public.stock_org_today(p_org);
begin
  ok := exists (select 1 from public.profiles p
                 where p.id = p_uid and p.org_id = p_org and p.status = 'active' and p.role = p_role);
  acting_for := null;
  if ok then return; end if;
  select s.delegator_id into acting_for
    from public.approval_stand_ins s
    join public.profiles d on d.id = s.delegator_id
   where s.org_id = p_org and s.stand_in_id = p_uid and s.revoked_at is null
     and v_today between s.starts_on and s.ends_on                                                    -- mut:standin_window
     and d.org_id = p_org and d.status = 'active' and d.role = p_role and d.id <> p_author
     and exists (select 1 from public.profiles me where me.id = p_uid and me.org_id = p_org and me.status = 'active')
   order by s.created_at, s.id
   limit 1;
  ok := acting_for is not null;
end $$;

create or replace function public.mrq_decide_step(p_request_id uuid, p_step_position integer, p_decision text,
                                                  p_reason text default null, p_source_warehouse_id uuid default null)
  returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; s public.material_request_steps;
  v_ok boolean; v_for uuid; v_reason text := nullif(btrim(p_reason), ''); v_next integer;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then
    raise exception 'MRQ_NOT_PENDING: the request is not waiting for approval' using errcode = 'P0001'; end if;
  select * into s from public.material_request_steps x
   where x.request_id = r.id and x.round = r.round and x.status = 'open';
  if s.position is distinct from p_step_position then                                                  -- mut:order
    raise exception 'MRQ_OUT_OF_ORDER: step % is not the open step; steps are decided in order', p_step_position
      using errcode = 'P0001';
  end if;
  if r.created_by = v_uid then                                                                         -- mut:author
    raise exception 'MRQ_SOD_AUTHOR: you cannot decide a request you raised' using errcode = '42501';
  end if;
  select a.ok, a.acting_for into v_ok, v_for from public.mrq_step_authority(v_org, v_uid, s.role, r.created_by) a;
  if not v_ok then
    raise exception 'MRQ_NOT_APPROVER: you do not hold this step''s role and stand in for no one who does today'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.material_request_steps x                                             -- mut:twice
              where x.request_id = r.id and x.id <> s.id and x.status in ('approved','returned','rejected')
                and (x.round = r.round or (x.position, x.role, x.label) is distinct from (s.position, s.role, s.label))
                and (x.decided_by = any(array_remove(array[v_uid, v_for], null))
                     or x.acted_for = any(array_remove(array[v_uid, v_for], null)))) then
    raise exception 'MRQ_SOD_TWICE: you already decided another step of this request' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve','return','reject') then
    raise exception 'MRQ_INVALID: a decision is approve, return or reject' using errcode = 'P0001'; end if;
  if p_decision in ('return','reject') and (v_reason is null or length(v_reason) > 500) then
    raise exception 'MRQ_REASON_REQUIRED: a return or rejection needs a reason (1 to 500 characters)' using errcode = 'P0001'; end if;

  if p_decision = 'approve' then
    update public.material_request_steps
       set status = 'approved', decided_by = v_uid, acted_for = v_for, decided_at = now(), reason = v_reason
     where id = s.id;
    select min(x.position) into v_next from public.material_request_steps x
     where x.request_id = r.id and x.round = r.round and x.status = 'waiting';
    if v_next is not null then
      update public.material_request_steps set status = 'open'
       where request_id = r.id and round = r.round and position = v_next;
      perform public.mrq_log(r, 'approved_step', 'pending', 'pending', s.position, v_uid, v_for, v_reason);
    else
      -- Final step: approve and create the transfer draft in this one transaction (FR-MRQ-011). Any failure in
      -- the transfer path raises and rolls the whole decision back, leaving the step open.
      update public.material_requests set status = 'approved', decided_at = now(), updated_at = now() where id = r.id;
      perform public.mrq_log(r, 'approved_step', 'pending', 'pending', s.position, v_uid, v_for, v_reason);
      perform public.mrq_log(r, 'approved', 'pending', 'approved', s.position, v_uid, v_for, null);
      perform public.mrq_create_transfer_core(r.id, p_source_warehouse_id);
    end if;
  else
    update public.material_request_steps
       set status = case p_decision when 'return' then 'returned' else 'rejected' end,
           decided_by = v_uid, acted_for = v_for, decided_at = now(), reason = v_reason
     where id = s.id;
    update public.material_request_steps set status = 'superseded'
     where request_id = r.id and round = r.round and status = 'waiting';
    update public.material_requests
       set status = case p_decision when 'return' then 'draft' else 'rejected' end,
           decided_at = case p_decision when 'reject' then now() end, updated_at = now()
     where id = r.id;
    perform public.mrq_log(r, case p_decision when 'return' then 'returned' else 'rejected' end, 'pending',
                           case p_decision when 'return' then 'draft' else 'rejected' end, s.position, v_uid, v_for, v_reason);
  end if;
end $$;

create or replace function public.mrq_waiting_for_me()
  returns table (request_id uuid, step_position integer, role public.user_role, label text, acting_for uuid, submitted_at timestamptz)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
begin
  if v_org is null or not public.is_active_member() then return; end if;
  return query
  select q.request_id, q.position, q.role, q.label, q.acting_for, q.submitted_at
    from (
      select r.id as request_id, s.position, s.role, s.label, a.acting_for, r.submitted_at, r.round, s.id as step_id
        from public.material_requests r
        join public.material_request_steps s on s.request_id = r.id and s.round = r.round and s.status = 'open'
        cross join lateral public.mrq_step_authority(v_org, v_uid, s.role, r.created_by) a
       where r.org_id = v_org and r.status = 'pending' and r.created_by <> v_uid and a.ok
    ) q
   where not exists (select 1 from public.material_request_steps x
                      where x.request_id = q.request_id and x.id <> q.step_id and x.status in ('approved','returned','rejected')
                        and (x.round = q.round or (x.position, x.role, x.label) is distinct from (q.position, q.role, q.label))
                        and (x.decided_by = any(array_remove(array[v_uid, q.acting_for], null))
                             or x.acted_for = any(array_remove(array[v_uid, q.acting_for], null))))
   order by q.submitted_at, q.request_id;
end $$;

revoke all on function public.mrq_step_authority(uuid, uuid, public.user_role, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mrq_decide_step(uuid, integer, text, text, uuid), public.mrq_waiting_for_me() from public, anon;
grant execute on function public.mrq_decide_step(uuid, integer, text, text, uuid), public.mrq_waiting_for_me() to authenticated;
