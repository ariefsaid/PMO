-- 1045_mrq_step_pins.sql — #2598 a project can pin a material-request approval step to a named person.
-- Spec docs/specs/material-requests.spec.md (FR-MRQ-022..025). Proven by supabase/tests/mrq_step_pin.test.sql.
--
-- approval_step_pins: per project and chain position, one named approver. No pin = the step stays role-level.
-- The pin applies to a request step only while its role still equals the pinned role (a chain edit that changes the
-- role at that position retires the pin silently; the setting screen shows it as unpinned).
-- The pin is read at decision time, so an Admin or the project's manager can re-point a pin on a request already open.
-- Written only by mrq_set_step_pin (Admin or the project's manager); no client holds a write grant (ADR-0019).
-- Every active org member sees every project (projects_select), so "can see the project" holds for any same-org member.
--
-- REVERSE: supabase/migrations/rollback/1045_mrq_step_pins_down.sql (restores the 1001 bodies; drops the table).

create table public.approval_step_pins (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id  uuid not null references public.projects(id) on delete cascade,
  position    integer not null check (position between 1 and 10),
  role        public.user_role not null,
  approver_id uuid not null references public.profiles(id),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  unique (project_id, position)
);
create index approval_step_pins_org_idx on public.approval_step_pins (org_id, project_id);
create trigger approval_step_pins_stamp_org_id before insert on public.approval_step_pins for each row execute function public.stamp_org_id();
alter table public.approval_step_pins enable row level security; alter table public.approval_step_pins force row level security;
create policy approval_step_pins_select on public.approval_step_pins for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.approval_step_pins from public, anon, authenticated;
grant select on public.approval_step_pins to authenticated;

-- The pinned approver for a request step, or null when the step is role-level.
create or replace function public.mrq_pinned_to(p_project_id uuid, p_position integer, p_role public.user_role) returns uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select pin.approver_id from public.approval_step_pins pin
   where pin.project_id = p_project_id and pin.position = p_position and pin.role = p_role;
$$;

-- Pin (or, with a null approver, unpin) one chain step on one project.
create or replace function public.mrq_set_step_pin(p_project_id uuid, p_position integer, p_approver_id uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_manager uuid; v_role public.user_role;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select pr.project_manager_id into v_manager from public.projects pr where pr.id = p_project_id and pr.org_id = v_org;
  if not found then raise exception 'MRQ_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001'; end if;
  if public.auth_role() is distinct from 'Admin' and v_manager is distinct from v_uid then
    raise exception 'MRQ_PIN_FORBIDDEN: only an Admin or the project''s manager can pin an approval step' using errcode = '42501'; end if;
  if p_approver_id is null then
    delete from public.approval_step_pins where project_id = p_project_id and position = p_position;
  else
    select c.role into v_role from public.approval_chain_steps c where c.org_id = v_org and c.position = p_position;
    if v_role is null then
      raise exception 'MRQ_PIN_INVALID: the chain has no step %', p_position using errcode = 'P0001'; end if;
    if not exists (select 1 from public.profiles p where p.id = p_approver_id and p.org_id = v_org
                      and p.status = 'active' and p.role = v_role) then
      raise exception 'MRQ_PIN_INVALID: the approver must be an active member who holds the step''s role' using errcode = 'P0001'; end if;
    insert into public.approval_step_pins (org_id, project_id, position, role, approver_id, created_by)
    values (v_org, p_project_id, p_position, v_role, p_approver_id, v_uid)
    on conflict (project_id, position) do update
      set role = excluded.role, approver_id = excluded.approver_id, created_by = excluded.created_by, created_at = now();
  end if;
  perform public.log_audit('material_request.step_pin_set', v_org, v_uid, p_project_id,
                           jsonb_build_object('position', p_position, 'approver_id', p_approver_id));
end $$;

-- The authority check gains the pin (new signature; the 1001 four-argument form is dropped with its callers).
drop function public.mrq_waiting_for_me();
drop function public.mrq_decide_step(uuid, integer, text, text, uuid);
drop function public.mrq_step_authority(uuid, uuid, public.user_role, uuid);

create or replace function public.mrq_step_authority(p_org uuid, p_uid uuid, p_role public.user_role, p_author uuid,
                                                     p_pin uuid,
                                                     out ok boolean, out acting_for uuid)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := public.stock_org_today(p_org);
begin
  ok := exists (select 1 from public.profiles p
                 where p.id = p_uid and p.org_id = p_org and p.status = 'active' and p.role = p_role)
        and (p_pin is null or p_pin = p_uid);                                                          -- mut:pin_direct
  acting_for := null;
  if ok then return; end if;
  select s.delegator_id into acting_for
    from public.approval_stand_ins s
    join public.profiles d on d.id = s.delegator_id
   where s.org_id = p_org and s.stand_in_id = p_uid and s.revoked_at is null
     and v_today between s.starts_on and s.ends_on                                                    -- mut:standin_window
     and (p_pin is null or d.id = p_pin)                                                              -- mut:pin_stand_in
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
  select a.ok, a.acting_for into v_ok, v_for from public.mrq_step_authority(v_org, v_uid, s.role, r.created_by,
                                                                              public.mrq_pinned_to(r.project_id, s.position, s.role)) a;
  if not v_ok then
    if public.mrq_pinned_to(r.project_id, s.position, s.role) is not null
       and (select a.ok from public.mrq_step_authority(v_org, v_uid, s.role, r.created_by, null) a) then
      raise exception 'MRQ_NOT_PINNED: this step is pinned to another approver on this project' using errcode = '42501';
    end if;
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
        cross join lateral public.mrq_step_authority(v_org, v_uid, s.role, r.created_by,
                                                          public.mrq_pinned_to(r.project_id, s.position, s.role)) a
       where r.org_id = v_org and r.status = 'pending' and r.created_by <> v_uid and a.ok
    ) q
   where not exists (select 1 from public.material_request_steps x
                      where x.request_id = q.request_id and x.id <> q.step_id and x.status in ('approved','returned','rejected')
                        and (x.round = q.round or (x.position, x.role, x.label) is distinct from (q.position, q.role, q.label))
                        and (x.decided_by = any(array_remove(array[v_uid, q.acting_for], null))
                             or x.acted_for = any(array_remove(array[v_uid, q.acting_for], null))))
   order by q.submitted_at, q.request_id;
end $$;

revoke all on function public.mrq_pinned_to(uuid, integer, public.user_role),
  public.mrq_step_authority(uuid, uuid, public.user_role, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mrq_set_step_pin(uuid, integer, uuid), public.mrq_decide_step(uuid, integer, text, text, uuid),
  public.mrq_waiting_for_me() from public, anon;
grant execute on function public.mrq_set_step_pin(uuid, integer, uuid), public.mrq_decide_step(uuid, integer, text, text, uuid),
  public.mrq_waiting_for_me() to authenticated;
