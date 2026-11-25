-- Rollback of 2680: no standard checks copied onto new Drafts and no cancel reason. Tasks already copied stay (they are ordinary tasks).
drop function if exists public.cancel_work_order(uuid, text);
alter table public.work_orders drop column if exists cancel_reason;
drop trigger if exists work_orders_zz_copy_checks on public.work_orders;
drop function if exists public.copy_work_order_checks();
drop function if exists public.set_work_order_check_template(jsonb);
alter table public.work_order_checklist_items drop column if exists owner_job_role, drop column if exists target_days;
-- The task-link check back to its 1038 body.
create or replace function public.check_task_work_order() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_project uuid; v_status public.work_order_status;
begin
  -- Structure columns on INSERT: an Engineer/Finance creator (0204) may not set either. No auth.uid() = server authority.
  if tg_op = 'INSERT' and auth.uid() is not null
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

-- The candidate template editor back, as its latest definition (1406, with the light-account guard 1480 added).
create or replace function public.set_work_order_candidate_template(p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id();
  v_el jsonb; v_pos integer := 0; v_id uuid; v_label text; v_req boolean;
  v_keep uuid[] := '{}';
begin
  perform public.assert_not_light();
  if v_org is null or auth.uid() is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an administrator can edit the assessment checklist' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'CWO_TEMPLATE: the checklist is a list of at most 50 items' using errcode = '22023';
  end if;
  -- validate the whole list before writing anything
  for v_el in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_el) <> 'object' or jsonb_typeof(v_el -> 'label') is distinct from 'string'
       or char_length(btrim(v_el ->> 'label')) not between 1 and 200
       or (v_el ? 'required' and jsonb_typeof(v_el -> 'required') <> 'boolean')
       or (v_el ? 'id' and v_el -> 'id' <> 'null'::jsonb and (jsonb_typeof(v_el -> 'id') <> 'string'
            or (v_el ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
      raise exception 'CWO_TEMPLATE: every item needs a label of 1 to 200 characters' using errcode = '22023';
    end if;
    if v_el ? 'id' and v_el -> 'id' <> 'null'::jsonb then
      v_id := (v_el ->> 'id')::uuid;
      if v_id = any (v_keep) or not exists (select 1 from public.work_order_checklist_items t where t.id = v_id and t.org_id = v_org) then
        raise exception 'CWO_TEMPLATE: an item is repeated or not on this organisation''s checklist' using errcode = '22023';
      end if;
      v_keep := v_keep || v_id;
    end if;
  end loop;
  v_keep := '{}';
  for v_el in select * from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    v_label := btrim(v_el ->> 'label');
    v_req := coalesce((v_el ->> 'required')::boolean, true);
    if v_el ? 'id' and v_el -> 'id' <> 'null'::jsonb then
      v_id := (v_el ->> 'id')::uuid;
      update public.work_order_checklist_items set label = v_label, position = v_pos, required = v_req, archived_at = null
       where id = v_id and org_id = v_org;
    else
      insert into public.work_order_checklist_items (org_id, label, position, required) values (v_org, v_label, v_pos, v_req) returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  update public.work_order_checklist_items set archived_at = now()
   where org_id = v_org and archived_at is null and id <> all (v_keep);
  return v_pos;
end $function$
;
revoke all on function public.set_work_order_candidate_template(jsonb) from public, anon;
grant execute on function public.set_work_order_candidate_template(jsonb) to authenticated;
