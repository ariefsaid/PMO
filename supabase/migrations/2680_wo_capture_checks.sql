-- 2680_wo_capture_checks.sql — a client's work order is captured as a Draft; the checks before it is issued are tasks (#2898).
-- Rollback: supabase/migrations/rollback/2680_wo_capture_checks_down.sql
-- (1) The organisation's standard checks: the list kept in work_order_checklist_items (1406, Admin-only through
--     now set_work_order_check_template) is copied onto each new Draft as open, unassigned tasks on its project. The issuer
--     then names an owner and a due date; the owner sees the task in My tasks and is told (notify_task_assignment).
--     The list ships empty, so an organisation that keeps none gets no tasks. Each line names a job role and a number of
--     days (3): at capture the task is due that many days later and goes to the one active holder of the job role.
-- (2) Cancelling a work order records why: cancel_work_order(id, reason) stores a 3 to 500 character reason, then moves the
--     row through transition_work_order, whose own role, organisation and transition gates still decide. Existing cancelled
--     rows keep an empty reason. The reason is readable by whoever reads the work order; it has no client UPDATE grant.

-- The copy is server authority whoever captured the Draft (a Finance creator too): the task-link check treats a task
-- written from inside another trigger as the server's, as it already treats a write with no signed-in user.
create or replace function public.check_task_work_order() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_project uuid; v_status public.work_order_status;
begin
  -- Structure columns on INSERT: an Engineer/Finance creator (0204) may not set either. No auth.uid() = server authority.
  -- 2680: so is a task written by another trigger (trigger depth 2+), e.g. the standard checks a new Draft copies.
  if tg_op = 'INSERT' and auth.uid() is not null
     and pg_trigger_depth() < 2
     and (new.work_order_id is not null or new.proof_required)
     and auth_role() not in ('Admin','Executive','Project Manager') then
    raise exception 'only a manager may link a task to a work order or require proof' using errcode = '42501';
  end if;

  if new.work_order_id is null then
    return new;
  end if;

  -- Moving a linked task to another project: name the way out (FR-TWOP-004).
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id
     and new.work_order_id is not distinct from old.work_order_id then
    raise exception 'task is linked to a work order of its current project; clear the work order before moving it'
      using errcode = '23514';
  end if;

  if new.project_id is null then
    raise exception 'a task without a project cannot name a work order' using errcode = '23514';
  end if;

  select w.org_id, w.project_id, w.status into v_org, v_project, v_status
    from public.work_orders w where w.id = new.work_order_id;
  if v_org is distinct from new.org_id or v_project is distinct from new.project_id then
    raise exception 'work order must belong to the task''s own project' using errcode = '23514';
  end if;
  if v_status = 'Cancelled'
     and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then
    raise exception 'a cancelled work order takes no new tasks' using errcode = '23514';
  end if;
  return new;
end $$;

create function public.copy_work_order_checks() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Due = the capture day plus the line's days. Owner = the one active person holding the line's job role; with none or
  -- several holders the task is left for the issuer to give an owner. A line never names a person.
  insert into public.tasks (org_id, project_id, work_order_id, name, status, end_date, assignee_id)
  select new.org_id, new.project_id, new.id, c.label, 'To Do',
         public.native_org_today(new.org_id) + c.target_days,
         (select (array_agg(p.id))[1] from public.profiles p
           where p.org_id = new.org_id and p.built_in_role = c.owner_job_role and p.status = 'active'
          having count(*) = 1)
    from public.work_order_checklist_items c
   where c.org_id = new.org_id and c.archived_at is null
   order by c.position;
  return new;
end; $$;
revoke all on function public.copy_work_order_checks() from public, anon, authenticated;

create trigger work_orders_zz_copy_checks after insert on public.work_orders
  for each row when (new.status = 'Draft') execute function public.copy_work_order_checks();

-- (3) A standard check names a job role and a number of days, never a person (set through set_work_order_check_template).
alter table public.work_order_checklist_items
  add column owner_job_role text,
  add column target_days integer check (target_days is null or target_days between 1 and 365);

create function public.set_work_order_check_template(p_items jsonb) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_el jsonb; v_pos integer := 0; v_id uuid; v_keep uuid[] := '{}';
begin
  perform public.assert_not_light();
  if v_org is null or auth.uid() is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an administrator can edit the standard checks' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'WOC_TEMPLATE: the standard checks are a list of at most 50 lines' using errcode = '22023';
  end if;
  -- validate the whole list before writing anything
  for v_el in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_el) <> 'object' or jsonb_typeof(v_el -> 'label') is distinct from 'string'
       or char_length(btrim(v_el ->> 'label')) not between 1 and 200
       or jsonb_typeof(v_el -> 'owner_job_role') is distinct from 'string'
       or public.built_in_role_base(v_el ->> 'owner_job_role') is null
       or public.is_light_role_key(v_el ->> 'owner_job_role')
       or jsonb_typeof(v_el -> 'target_days') is distinct from 'number'
       or (v_el ->> 'target_days') !~ '^[0-9]+$' or (v_el ->> 'target_days')::integer not between 1 and 365
       or (v_el ? 'id' and v_el -> 'id' <> 'null'::jsonb and (jsonb_typeof(v_el -> 'id') <> 'string'
            or (v_el ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
      raise exception 'WOC_TEMPLATE: every line needs a check of 1 to 200 characters, a job role and 1 to 365 days' using errcode = '22023';
    end if;
    if v_el ? 'id' and v_el -> 'id' <> 'null'::jsonb then
      v_id := (v_el ->> 'id')::uuid;
      if v_id = any (v_keep) or not exists (select 1 from public.work_order_checklist_items t where t.id = v_id and t.org_id = v_org) then
        raise exception 'WOC_TEMPLATE: a line is repeated or not on this organisation''s list' using errcode = '22023';
      end if;
      v_keep := v_keep || v_id;
    end if;
  end loop;
  v_keep := '{}';
  for v_el in select * from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    if v_el ? 'id' and v_el -> 'id' <> 'null'::jsonb then
      v_id := (v_el ->> 'id')::uuid;
      update public.work_order_checklist_items
         set label = btrim(v_el ->> 'label'), position = v_pos, owner_job_role = v_el ->> 'owner_job_role',
             target_days = (v_el ->> 'target_days')::integer, archived_at = null
       where id = v_id and org_id = v_org;
    else
      insert into public.work_order_checklist_items (org_id, label, position, required, owner_job_role, target_days)
      values (v_org, btrim(v_el ->> 'label'), v_pos, false, v_el ->> 'owner_job_role', (v_el ->> 'target_days')::integer)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  update public.work_order_checklist_items set archived_at = now()
   where org_id = v_org and archived_at is null and id <> all (v_keep);
  return v_pos;
end $$;
revoke all on function public.set_work_order_check_template(jsonb) from public, anon;
grant execute on function public.set_work_order_check_template(jsonb) to authenticated, service_role;

alter table public.work_orders add column cancel_reason text
  check (cancel_reason is null or char_length(cancel_reason) between 3 and 500);

create function public.cancel_work_order(p_id uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reason text := nullif(btrim(p_reason), ''); v_org uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'WOC_REASON: give a reason of 3 to 500 characters' using errcode = '23514';
  end if;
  select org_id into v_org from public.work_orders where id = p_id for update;
  if v_org is distinct from public.auth_org_id()
     or public.auth_role() is null or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.work_orders set cancel_reason = v_reason where id = p_id;
  perform public.transition_work_order(p_id, 'Cancelled');
end; $$;
revoke all on function public.cancel_work_order(uuid, text) from public, anon;
grant execute on function public.cancel_work_order(uuid, text) to authenticated, service_role;

-- (4) The candidate template editor is replaced by set_work_order_check_template; candidate records stay readable.
drop function public.set_work_order_candidate_template(jsonb);
