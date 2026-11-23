-- Reverse of 1906_gap_fix_union_bodies.sql: restores the bodies at 1768 (worker_effective_crew, work_order_roster) and 1841 (mrq_decide_step).

CREATE OR REPLACE FUNCTION public.worker_effective_crew(p_worker_id uuid, p_date date)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    (select l.host_crew_id from public.crew_loans l
      where l.worker_id = p_worker_id and l.org_id = public.auth_org_id() and p_date between l.valid_from and l.valid_to
      limit 1),
    public.worker_followed_crew(p_worker_id, p_date),
    (select m.crew_id from public.crew_members m
      where m.worker_id = p_worker_id and m.org_id = public.auth_org_id()
        and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
        and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                         where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                           and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
      order by m.valid_from desc, m.id
      limit 1))
$function$;

CREATE OR REPLACE FUNCTION public.work_order_roster(p_work_order_id uuid, p_date date)
 RETURNS TABLE(crew_id uuid, crew_code text, crew_name text, field_controller_id uuid, members jsonb, roles jsonb, shortfall integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with rostered as (
    select c.id, c.code, c.name, c.field_controller_id
      from public.work_order_crews r join public.crews c on c.id = r.crew_id
     where r.work_order_id = p_work_order_id
       and p_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
  ), placed as (
    select x.crew_id, x.worker_id, w.name as display_name, x.standard_role_id, x.on_loan, x.followed, x.from_crew_name
      from (
        select m.crew_id, m.worker_id, m.standard_role_id, false as on_loan, false as followed, null::text as from_crew_name
          from public.crew_members m
         where m.crew_id in (select id from rostered)
           and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
           and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                            where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                              and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
        union all
        select l.host_crew_id, l.worker_id, null::uuid, true, false, null::text
          from public.crew_loans l
         where l.host_crew_id in (select id from rostered)
           and p_date between l.valid_from and l.valid_to
        union all
        -- 1768: a person recorded on the day as following this crew (no loan, no placement change)
        select f.crew_id, f.worker_id, null::uuid, false, true,
               (select hc.name from public.crew_members hm join public.crews hc on hc.id = hm.crew_id
                 where hm.worker_id = f.worker_id and p_date between hm.valid_from and coalesce(hm.valid_to, 'infinity'::date)
                 order by hm.valid_from desc, hm.id limit 1)
          from (select distinct a.followed_crew_id as crew_id, a.worker_id from public.attendance_days a
                 where a.work_date = p_date and a.followed_crew_id in (select id from rostered)) f
      ) x
      join public.people_directory w on w.id = x.worker_id
     where public.worker_effective_crew(x.worker_id, p_date) = x.crew_id
  ), role_counts as (
    select s.crew_id, s.id, s.name, s.headcount, s.sort_order,
           (select count(*)::int from placed p where p.crew_id = s.crew_id and p.standard_role_id = s.id) as placed
      from public.crew_standard_roles s where s.crew_id in (select id from rostered)
  )
  select r.id, r.code, r.name, r.field_controller_id,
         coalesce((select jsonb_agg(jsonb_build_object('worker_id', p.worker_id, 'display_name', p.display_name,
                                                       'standard_role_id', p.standard_role_id,
                                                       'off_rotation', exists (
                                                         select 1 from public.crew_worker_rotation_off o
                                                          where o.worker_id = p.worker_id and p_date between o.off_from and o.off_to))
                                    || case when p.on_loan then jsonb_build_object('on_loan', true) else '{}'::jsonb end
                                    || case when p.followed then jsonb_build_object('followed', true, 'from_crew_name', p.from_crew_name) else '{}'::jsonb end
                                    order by p.display_name, p.worker_id)
                     from placed p where p.crew_id = r.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('standard_role_id', rc.id, 'name', rc.name,
                                                       'headcount', rc.headcount, 'placed', rc.placed,
                                                       'shortfall', greatest(rc.headcount - rc.placed, 0))
                                    order by rc.sort_order, rc.name)
                     from role_counts rc where rc.crew_id = r.id), '[]'::jsonb),
         coalesce((select sum(greatest(rc.headcount - rc.placed, 0))::int from role_counts rc where rc.crew_id = r.id), 0)
    from rostered r
   order by r.code, r.id
$function$;

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
