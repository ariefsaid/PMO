-- 1841_mrq_job_role_steps.sql — roles that decide (a): a material-request approval step can name a job role.
-- Spec docs/specs/roles-that-decide.spec.md §2.2 (FR-RTD-004..008). Proven by supabase/tests/roles_that_decide_mrq.test.sql;
-- the step-with-no-job-role path stays proven by the untouched mrq_approval / mrq_step_pin / mrq_stuck_pin / mrq_approver_inbox files.
-- Rollback: supabase/migrations/rollback/1841_mrq_job_role_steps_down.sql
--
-- A step with no job role (every existing step, the default) decides exactly as today: the decider's access level equals the step's.
-- A step naming a job role is decided by people who fill it (holds_job_role, 1840); its level column is the job role's base level,
-- set in the same statement, so the level column, the open-step index and the notification prefilter stay true.
-- Order, never-the-author, one person one step, the stand-in window and pins are unchanged. A step is "the same step" for the
-- one-person-one-step rule when (position, role, job_role, label) all match.
-- Naming a job role is refused while the organisation has built-in roles off (the existing 1201 setting); clearing is always allowed.
-- The borrowing step (1318) still names a level; it is not in this change.
--
-- Restated bodies, each from its latest definition at head, with the guard line the 1209/1461/1530 rewrite inserted:
--   mrq_step_authority 1045 (new p_job_role argument) · mrq_pinned_to 1120 (new p_job_role argument) · mrq_decide_step 1045 + 1461 ·
--   mrq_waiting_for_me 1045 + 1209 (returns job_role) · mrq_step_recipients 1336 · mrq_set_step_pin 1045 + 1530 ·
--   mrq_set_chain 1001 + 1530 · mrq_submit 1333 + 1461.
-- drops: the level-only holder comparisons (p.role = p_role, d.role = p_role, who.role = pin.role, p.role = v_role) and the
--        three-part step identity (position, role, label) — each replaced by its job-role-aware line beside it.

-- ── columns ───────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.approval_chain_steps   add column job_role text references public.built_in_roles(key);
alter table public.material_request_steps add column job_role text references public.built_in_roles(key);
alter table public.approval_step_pins     add column job_role text references public.built_in_roles(key);
comment on column public.approval_chain_steps.job_role is
  'roles-that-decide FR-RTD-004: the job role that decides this step; null = the step decides by its level (role) as before. '
  'While set, role = built_in_role_base(job_role).';
comment on column public.material_request_steps.job_role is 'roles-that-decide FR-RTD-006: the chain step''s job role, snapshotted at submit.';
comment on column public.approval_step_pins.job_role is 'roles-that-decide FR-RTD-007: the job role of the pinned step; the pin lapses when it changes.';

-- ── who fills a step: the step's job role through holds_job_role, else today's level equality ──────────────────
create function public.mrq_fills_step(p_profile uuid, p_role public.user_role, p_job_role text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_job_role is null
              then exists (select 1 from public.profiles p where p.id = p_profile and p.role = p_role)        -- mut:level_step
              else public.holds_job_role(p_profile, p_job_role) end                                           -- mut:job_role_step
$$;

-- ── authority and pin lookups gain the job role (new signatures; callers restated below) ──────────────────────
drop function public.mrq_waiting_for_me();
drop function public.mrq_step_authority(uuid, uuid, public.user_role, uuid, uuid);
drop function public.mrq_pinned_to(uuid, integer, public.user_role);

create or replace function public.mrq_pinned_to(p_project_id uuid, p_position integer, p_role public.user_role, p_job_role text) returns uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select pin.approver_id from public.approval_step_pins pin
    join public.profiles who on who.id = pin.approver_id and who.org_id = pin.org_id
   where pin.project_id = p_project_id and pin.position = p_position and pin.role = p_role
     and pin.job_role is not distinct from p_job_role                                                 -- mut:pin_job_role
     and who.status = 'active'                                                                        -- mut:pin_alive_status
     and public.mrq_fills_step(who.id, pin.role, pin.job_role);                                       -- mut:pin_alive_role
$$;

create or replace function public.mrq_step_authority(p_org uuid, p_uid uuid, p_role public.user_role, p_job_role text,
                                                     p_author uuid, p_pin uuid,
                                                     out ok boolean, out acting_for uuid)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := public.stock_org_today(p_org);
begin
  ok := exists (select 1 from public.profiles p
                 where p.id = p_uid and p.org_id = p_org and p.status = 'active'
                   and public.mrq_fills_step(p.id, p_role, p_job_role))                                -- mut:fills_direct
        and (p_pin is null or p_pin = p_uid);                                                          -- mut:pin_direct
  acting_for := null;
  if ok then return; end if;
  select s.delegator_id into acting_for
    from public.approval_stand_ins s
    join public.profiles d on d.id = s.delegator_id
   where s.org_id = p_org and s.stand_in_id = p_uid and s.revoked_at is null
     and v_today between s.starts_on and s.ends_on                                                    -- mut:standin_window
     and (p_pin is null or d.id = p_pin)                                                              -- mut:pin_stand_in
     and d.org_id = p_org and d.status = 'active' and public.mrq_fills_step(d.id, p_role, p_job_role)  -- mut:fills_stand_in
     and d.id <> p_author
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
  perform public.assert_not_light();
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
  select a.ok, a.acting_for into v_ok, v_for from public.mrq_step_authority(v_org, v_uid, s.role, s.job_role, r.created_by,
                                                                              public.mrq_pinned_to(r.project_id, s.position, s.role, s.job_role)) a;
  if not v_ok then
    if public.mrq_pinned_to(r.project_id, s.position, s.role, s.job_role) is not null
       and (select a.ok from public.mrq_step_authority(v_org, v_uid, s.role, s.job_role, r.created_by, null) a) then
      raise exception 'MRQ_NOT_PINNED: this step is pinned to another approver on this project' using errcode = '42501';
    end if;
    if s.job_role is not null then
      raise exception 'MRQ_NOT_JOB_ROLE: this step is for a job role you do not hold, and you stand in for no one who holds it today'
        using errcode = '42501';
    end if;
    raise exception 'MRQ_NOT_APPROVER: you do not hold this step''s role and stand in for no one who does today'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.material_request_steps x                                             -- mut:twice
              where x.request_id = r.id and x.id <> s.id and x.status in ('approved','returned','rejected')
                and (x.round = r.round or (x.position, x.role, x.job_role, x.label) is distinct from (s.position, s.role, s.job_role, s.label))
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
  returns table (request_id uuid, step_position integer, role public.user_role, job_role text, label text, acting_for uuid,
                 submitted_at timestamptz)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
begin
  perform public.assert_not_light();
  if v_org is null or not public.is_active_member() then return; end if;
  return query
  select q.request_id, q.position, q.role, q.job_role, q.label, q.acting_for, q.submitted_at
    from (
      select r.id as request_id, s.position, s.role, s.job_role, s.label, a.acting_for, r.submitted_at, r.round, s.id as step_id
        from public.material_requests r
        join public.material_request_steps s on s.request_id = r.id and s.round = r.round and s.status = 'open'
        cross join lateral public.mrq_step_authority(v_org, v_uid, s.role, s.job_role, r.created_by,
                                                          public.mrq_pinned_to(r.project_id, s.position, s.role, s.job_role)) a
       where r.org_id = v_org and r.status = 'pending' and r.created_by <> v_uid and a.ok
    ) q
   where not exists (select 1 from public.material_request_steps x
                      where x.request_id = q.request_id and x.id <> q.step_id and x.status in ('approved','returned','rejected')
                        and (x.round = q.round or (x.position, x.role, x.job_role, x.label) is distinct from (q.position, q.role, q.job_role, q.label))
                        and (x.decided_by = any(array_remove(array[v_uid, q.acting_for], null))
                             or x.acted_for = any(array_remove(array[v_uid, q.acting_for], null))))
   order by q.submitted_at, q.request_id;
end $$;

create or replace function public.mrq_step_recipients(p_step_id uuid) returns setof uuid
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.material_request_steps; r public.material_requests; v_pin uuid; c record; a record;
begin
  select * into s from public.material_request_steps x where x.id = p_step_id;
  if not found or s.status <> 'open' then return; end if;
  select * into r from public.material_requests x where x.id = s.request_id;
  if not found or r.status <> 'pending' or r.round <> s.round then return; end if;
  v_pin := public.mrq_pinned_to(r.project_id, s.position, s.role, s.job_role);
  for c in
    select p.id from public.profiles p
     where p.org_id = r.org_id and p.status = 'active' and p.id <> r.created_by                       -- mut:recipient_author
       and (p.role = s.role
            or exists (select 1 from public.approval_stand_ins si
                        where si.org_id = r.org_id and si.stand_in_id = p.id and si.revoked_at is null))
  loop
    select m.ok, m.acting_for into a
      from public.mrq_step_authority(r.org_id, c.id, s.role, s.job_role, r.created_by, v_pin) m;     -- mut:recipient_authority
    if not a.ok then continue; end if;
    if exists (select 1 from public.material_request_steps x                                          -- mut:recipient_twice
                where x.request_id = r.id and x.id <> s.id and x.status in ('approved','returned','rejected')
                  and (x.round = s.round or (x.position, x.role, x.job_role, x.label) is distinct from (s.position, s.role, s.job_role, s.label))
                  and (x.decided_by = any(array_remove(array[c.id, a.acting_for], null))
                       or x.acted_for = any(array_remove(array[c.id, a.acting_for], null)))) then
      continue;
    end if;
    return next c.id;
  end loop;
end $$;

-- Pin (or, with a null approver, unpin) one chain step on one project. The pinned person must fill the step.
create or replace function public.mrq_set_step_pin(p_project_id uuid, p_position integer, p_approver_id uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_manager uuid; v_role public.user_role; v_job_role text;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select pr.project_manager_id into v_manager from public.projects pr where pr.id = p_project_id and pr.org_id = v_org;
  if not found then raise exception 'MRQ_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001'; end if;
  if public.auth_role() is distinct from 'Admin' and v_manager is distinct from v_uid then
    raise exception 'MRQ_PIN_FORBIDDEN: only an Admin or the project''s manager can pin an approval step' using errcode = '42501'; end if;
  if p_approver_id is null then
    delete from public.approval_step_pins where project_id = p_project_id and position = p_position;
  else
    select c.role, c.job_role into v_role, v_job_role from public.approval_chain_steps c where c.org_id = v_org and c.position = p_position;
    if v_role is null then
      raise exception 'MRQ_PIN_INVALID: the chain has no step %', p_position using errcode = 'P0001'; end if;
    if not exists (select 1 from public.profiles p where p.id = p_approver_id and p.org_id = v_org
                      and p.status = 'active' and public.mrq_fills_step(p.id, v_role, v_job_role)) then   -- mut:pin_fills
      raise exception 'MRQ_PIN_INVALID: the approver must be an active member who holds the step''s role' using errcode = 'P0001'; end if;
    insert into public.approval_step_pins (org_id, project_id, position, role, job_role, approver_id, created_by)
    values (v_org, p_project_id, p_position, v_role, v_job_role, p_approver_id, v_uid)
    on conflict (project_id, position) do update
      set role = excluded.role, job_role = excluded.job_role, approver_id = excluded.approver_id,
          created_by = excluded.created_by, created_at = now();
  end if;
  perform public.log_audit('material_request.step_pin_set', v_org, v_uid, p_project_id,
                           jsonb_build_object('position', p_position, 'approver_id', p_approver_id));
end $$;

-- The chain: each step names a level ("role") or a job role ("job_role"); with a job role the level is its base level.
create or replace function public.mrq_set_chain(p_steps jsonb) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); e jsonb; n integer := 0; v_role public.user_role; v_job_role text;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'MRQ_ADMIN_ONLY: only an Admin can change the approval chain' using errcode = '42501'; end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 10 then
    raise exception 'MRQ_INVALID: a chain has 0 to 10 steps' using errcode = 'P0001'; end if;
  delete from public.approval_chain_steps where org_id = v_org;
  for e in select x from jsonb_array_elements(p_steps) as x loop
    n := n + 1;
    v_job_role := nullif(btrim(coalesce(e->>'job_role', '')), '');
    if v_job_role is not null then
      if not public.org_built_in_roles_enabled(v_org) then                                             -- mut:job_role_setting
        raise exception 'MRQ_JOB_ROLE_OFF: turn on built-in roles before a step can name a job role' using errcode = 'P0001'; end if;
      v_role := public.built_in_role_base(v_job_role);                                                  -- the level follows the job role
      if v_role is null then
        raise exception 'MRQ_JOB_ROLE_UNKNOWN: step % names a job role that does not exist', n using errcode = 'P0001'; end if;
    else
    begin v_role := (e->>'role')::public.user_role;
    exception when others then v_role := null; end;
    end if;
    if v_role is null then raise exception 'MRQ_INVALID: step % names an unknown role', n using errcode = 'P0001'; end if;
    if nullif(btrim(e->>'label'), '') is null or length(btrim(e->>'label')) > 80 then
      raise exception 'MRQ_INVALID: step % needs a label (1 to 80 characters)', n using errcode = 'P0001'; end if;
    insert into public.approval_chain_steps (org_id, position, role, job_role, label, only_over_plan)
    values (v_org, n, v_role, v_job_role, btrim(e->>'label'), coalesce((e->>'only_over_plan')::boolean, false));
  end loop;
  perform public.log_audit('material_request.chain_set', v_org, v_uid, null, jsonb_build_object('steps', p_steps));
end $$;

-- Submit: the snapshot carries each step's job role (FR-RTD-006). 1333 body; only the snapshot insert changes.
create or replace function public.mrq_submit(p_request_id uuid, p_client_request_id uuid default null) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo_status public.work_order_status;
  v_cutoff time; v_tz text; v_earliest date; l record; v_plan numeric; v_src text; v_prior numeric; v_over boolean := false;
  v_splan numeric; v_sprior numeric;
  v_round integer; v_steps integer;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.created_by <> v_uid then
    raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can change or submit it' using errcode = '42501'; end if;
  if p_client_request_id is not null and exists (
    select 1 from public.material_request_events e where e.request_id = r.id and e.action = 'submitted'
      and e.client_request_id = p_client_request_id
  ) then
    return;                                                                 -- FR-MRQ-004 replay, including earlier rounds
  end if;
  if r.status <> 'draft' then
    raise exception 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted' using errcode = 'P0001'; end if;
  select w.status into v_wo_status from public.work_orders w where w.id = r.work_order_id;
  if v_wo_status not in ('Draft','Issued') then
    raise exception 'MRQ_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;

  select s.cutoff_time into v_cutoff from public.material_request_settings s where s.org_id = v_org;
  select o.default_timezone into v_tz from public.organizations o where o.id = v_org;
  v_earliest := public.mrq_cutoff_earliest(v_cutoff, v_tz, r.needed_by, now());
  if v_earliest is not null then
    raise exception 'MRQ_CUTOFF: requests for tomorrow close at %; the earliest date you can request is %',
      to_char(v_cutoff, 'HH24:MI'), v_earliest using errcode = 'P0001';
  end if;

  -- Serialize submissions sharing a work order before reading prior quantities.
  perform pg_advisory_xact_lock(hashtextextended('mrq-plan:' || r.work_order_id::text, 0));
  for l in select * from public.material_request_lines x where x.request_id = r.id order by x.line_no for update loop
    select f.plan_qty, f.plan_source into v_plan, v_src from public.mrq_plan_figure(r.work_order_id, l.item_id) f;
    v_prior := public.mrq_prior_quantity(r.work_order_id, l.item_id, r.id);
    if v_prior + l.quantity > v_plan then
      v_over := true;
      if l.over_plan_reason is null then                                                               -- mut:over_plan
        raise exception 'MRQ_OVER_PLAN_REASON: line % is over plan and needs a reason (1 to 500 characters)', l.line_no
          using errcode = '23514';
      end if;
    end if;
    -- #2576 FR-WOS-015: the section's own allocation, when one is set, is a second check beside the work order's;
    -- the stricter applies, and both ask for the one existing over-plan reason. A section with no allocation for the
    -- item is checked against the work order's plan only.
    v_splan := null; v_sprior := null;
    if r.section_id is not null then
      v_splan := public.mrq_section_plan_quantity(r.section_id, l.item_id);
      if v_splan is not null then
        v_sprior := public.mrq_section_prior_quantity(r.section_id, l.item_id, r.id);
        if v_sprior + l.quantity > v_splan then                                                          -- mut:section_plan
          v_over := true;
          if l.over_plan_reason is null then
            raise exception 'MRQ_OVER_PLAN_REASON: line % is over its section''s plan and needs a reason (1 to 500 characters)', l.line_no
              using errcode = '23514';
          end if;
        end if;
      end if;
    end if;
    update public.material_request_lines set plan_qty = v_plan, plan_source = v_src, prior_qty = v_prior,
           section_plan_qty = v_splan, section_prior_qty = v_sprior where id = l.id;
  end loop;

  perform public.mrq_usage_check(r.id);                                    -- 1332 carried: #2686 warns only; a no-op while both thresholds are unset

  v_round := r.round + 1;
  insert into public.material_request_steps (org_id, request_id, round, position, role, job_role, label, status)
  select v_org, r.id, v_round, row_number() over (order by c.position), c.role, c.job_role, c.label, 'waiting'   -- mut:snapshot_job_role
    from public.approval_chain_steps c
   where c.org_id = v_org and (not c.only_over_plan or v_over);
  get diagnostics v_steps = row_count;
  if v_steps = 0 then
    raise exception 'MRQ_NO_CHAIN: no approval chain is set up for material requests; ask an Admin' using errcode = 'P0001'; end if;
  update public.material_request_steps set status = 'open' where request_id = r.id and round = v_round and position = 1;
  update public.material_requests
     set status = 'pending', round = v_round, submitted_at = now(), submit_request_id = p_client_request_id,
         decided_at = null, updated_at = now()
   where id = r.id;
  insert into public.material_request_events (org_id, request_id, action, from_status, to_status, actor_id, client_request_id)
  values (v_org, r.id, 'submitted', 'draft', 'pending', v_uid, p_client_request_id);
end $$;

-- ── ACL: internals nobody; client RPCs authenticated only (the recreated mrq_waiting_for_me needs its grant again) ────
revoke all on function public.mrq_fills_step(uuid, public.user_role, text),
  public.mrq_pinned_to(uuid, integer, public.user_role, text),
  public.mrq_step_authority(uuid, uuid, public.user_role, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mrq_waiting_for_me() from public, anon;
grant execute on function public.mrq_waiting_for_me() to authenticated;
