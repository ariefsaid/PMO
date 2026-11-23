-- Reverse of 1830_closeout_target_days.sql: restore both function bodies as they stood (1401/1402 with the light guard), drop the columns.
create or replace function public.instantiate_work_order_closeout_items() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.work_order_closeout_items (org_id, work_order_id, project_id, position, name, required, started_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.required, public.native_org_today(new.org_id)
    from public.closeout_checklist_templates t
   where t.org_id = new.org_id;
  return new;
end; $$;

create or replace function public.set_closeout_checklist(p_items jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid      := public.auth_org_id();
  v_role user_role := public.auth_role();
  v_item jsonb;
  v_pos  int := 0;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is null or v_role <> 'Admin' then
    raise exception 'only an Admin can set the organisation''s close-out checklist' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 then
    raise exception 'the close-out checklist is a list of at most 20 items' using errcode = '22023', detail = 'items-shape';
  end if;
  perform 1 from public.organizations o where o.id = v_org for update;
  delete from public.closeout_checklist_templates t where t.org_id = v_org;
  for v_item in select x from jsonb_array_elements(p_items) x loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' or coalesce(btrim(v_item ->> 'name'), '') = '' or length(btrim(v_item ->> 'name')) > 120 then
      raise exception 'every close-out item needs a name of 1 to 120 characters' using errcode = '23514', detail = 'item-name-invalid';
    end if;
    insert into public.closeout_checklist_templates (org_id, position, name, required)
    values (v_org, v_pos, btrim(v_item ->> 'name'), coalesce((v_item ->> 'required')::boolean, true));
  end loop;
  perform public.log_audit('closeout_checklist.set', v_org, auth.uid(), v_org, jsonb_build_object('items', v_pos));
  return v_pos;
end; $$;

drop index if exists public.work_order_closeout_items_overdue_idx;
alter table public.work_order_closeout_items
  drop constraint work_order_closeout_items_due_needs_target,
  drop column overdue_notified_at, drop column due_on, drop column target_days;
alter table public.closeout_checklist_templates drop column target_days;
