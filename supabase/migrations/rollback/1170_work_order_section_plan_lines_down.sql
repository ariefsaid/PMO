-- Reverses 1170_work_order_section_plan_lines.sql (#2576). Reverse 1097..1099 first.
-- Refuses, with a clear message, when sectioned figures exist: dropping the column would merge them into the
-- unsectioned figure (the 0997 one-per-kind index would collide, or silently change the work order's plan).
do $$
begin
  if exists (select 1 from public.work_order_plan_lines where section_id is not null) then
    raise exception 'cannot reverse 1096: sectioned plan figures exist; move or delete them first';
  end if;
end $$;
revoke insert (section_id), update (section_id) on public.work_order_plan_lines from authenticated;
drop trigger if exists zz_work_order_plan_lines_section on public.work_order_plan_lines;
drop function if exists public.wos_check_child_section();

-- 0997 bodies restored.
create or replace function public.check_work_order_plan_line() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.work_order_plan_lines := case when tg_op = 'DELETE' then old else new end;
  v_org uuid; v_project uuid; v_status public.work_order_status;
begin
  select w.org_id, w.project_id, w.status into v_org, v_project, v_status
    from public.work_orders w where w.id = v_row.work_order_id;
  if tg_op = 'UPDATE' and (new.work_order_id is distinct from old.work_order_id or new.project_id is distinct from old.project_id
                           or new.org_id is distinct from old.org_id or new.kind is distinct from old.kind
                           or new.discipline_id is distinct from old.discipline_id) then
    raise exception 'WPVA_PLAN_KEY: a plan figure keeps its work order, discipline and kind' using errcode = '23514';
  end if;
  if v_org is distinct from v_row.org_id or v_project is distinct from v_row.project_id then
    raise exception 'WPVA_PLAN_WO: the work order belongs to another project' using errcode = '23514';
  end if;
  if v_status = 'Cancelled' then
    raise exception 'WPVA_PLAN_CANCELLED: a cancelled work order''s plan is frozen' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.discipline_id is not null and not exists (
       select 1 from public.cost_disciplines d
        where d.id = new.discipline_id and d.org_id = new.org_id and d.archived_at is null) then
    raise exception 'WPVA_PLAN_DISCIPLINE: the discipline is not on this organisation''s list' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.audit_work_order_plan_line() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.work_order_plan_lines := case when tg_op = 'DELETE' then old else new end;
  pick constant text[] := array['discipline_id', 'kind', 'value', 'note'];
  v_before jsonb; v_after jsonb;
begin
  if tg_op <> 'INSERT' then
    select jsonb_object_agg(k, to_jsonb(old) -> k) into v_before from unnest(pick) k;
  end if;
  if tg_op <> 'DELETE' then
    select jsonb_object_agg(k, to_jsonb(new) -> k) into v_after from unnest(pick) k;
    if tg_op = 'UPDATE' and v_after = v_before then return new; end if;
  end if;
  perform public.log_audit('work_order_plan.' || lower(tg_op), v_row.org_id, auth.uid(), v_row.work_order_id,
    jsonb_build_object('plan_line_id', v_row.id, 'before', v_before, 'after', v_after));
  return null;
end $$;

create or replace function public.set_work_order_plan(p_project_id uuid, p_work_order_id uuid, p_changes jsonb) returns integer
  language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_change jsonb;
  v_kind text;
  v_value text;
  v_note text;
  v_id uuid;
  v_count integer := 0;
begin
  if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.project_id = p_project_id
                  and w.org_id = public.auth_org_id()) then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 4 then
    raise exception 'invalid plan changes' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_changes) x
              where jsonb_typeof(x) <> 'object' or not x ? 'value'
                 or x->>'kind' is null or x->>'kind' not in ('direct_budget', 'indirect_budget', 'equipment_hours', 'crew_hours')
                 or (x ? 'note' and jsonb_typeof(x->'note') not in ('string', 'null'))
                 or jsonb_typeof(x->'value') not in ('string', 'null'))
     or (select count(*) <> count(distinct x->>'kind') from jsonb_array_elements(p_changes) x) then
    raise exception 'invalid plan changes' using errcode = '22023';
  end if;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_kind := v_change->>'kind';
    v_value := v_change->>'value';
    v_note := v_change->>'note';
    if v_value is not null and v_value !~ '^\d{1,15}(\.\d{1,2})?$' then
      raise exception 'invalid plan figure' using errcode = '23514';
    end if;
    select l.id into v_id from public.work_order_plan_lines l
     where l.org_id = public.auth_org_id() and l.project_id = p_project_id and l.work_order_id = p_work_order_id
       and l.discipline_id is null and l.kind = v_kind for update;
    if v_value is null then
      if v_id is not null then
        delete from public.work_order_plan_lines where id = v_id;
        v_count := v_count + 1;
      end if;
    elsif v_id is null then
      insert into public.work_order_plan_lines (project_id, work_order_id, discipline_id, kind, value, note)
        values (p_project_id, p_work_order_id, null, v_kind, v_value::numeric, v_note);
      v_count := v_count + 1;
    else
      update public.work_order_plan_lines set value = v_value::numeric, note = v_note where id = v_id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

drop index if exists public.work_order_plan_lines_section_idx;
drop index if exists public.work_order_plan_lines_one_per_kind;
create unique index work_order_plan_lines_one_per_kind on public.work_order_plan_lines
  (work_order_id, coalesce(discipline_id, '00000000-0000-0000-0000-000000000000'::uuid), kind);
alter table public.work_order_plan_lines drop constraint if exists work_order_plan_lines_section_wo_fk;
alter table public.work_order_plan_lines drop column if exists section_id;
