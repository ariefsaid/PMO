-- 1830_closeout_target_days.sql — a close-out item can carry a target in days; its due day is worked out when the work order is issued (#2800).
-- FR-CTD-001/002. Proven by supabase/tests/1830_closeout_target_days.test.sql. Shape of 1360: every new column is nullable, so an
-- organisation or work order without targets reads as no target, no due day, never overdue.
-- set_closeout_checklist and instantiate_work_order_closeout_items are restated from the database at head (the latest migration
-- file defining each, 1401 and 1402, with the assert_not_light line the 1219/1530 rewrite added to the first).
-- drops: the two insert statements' column and values lines — instantiate_work_order_closeout_items and set_closeout_checklist each gain target_days (and due_on), so the lines that named the old column lists are rewritten; nothing else is removed.
-- ── REVERSE: rollback/1830_closeout_target_days_down.sql ─────────────────────────────────────────────────────────────

alter table public.closeout_checklist_templates
  add column target_days smallint check (target_days between 1 and 365);

alter table public.work_order_closeout_items
  add column target_days         smallint check (target_days between 1 and 365),
  add column due_on              date,
  add column overdue_notified_at timestamptz,
  add constraint work_order_closeout_items_due_needs_target check (due_on is null or target_days is not null);

-- The overdue runner's scan (1832): open items that carry a due day and were not yet notified.
create index work_order_closeout_items_overdue_idx on public.work_order_closeout_items (org_id, due_on)
  where done_on is null and due_on is not null and overdue_notified_at is null;

create or replace function public.instantiate_work_order_closeout_items() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.work_order_closeout_items (org_id, work_order_id, project_id, position, name, required, started_on, target_days, due_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.required,
         public.native_org_today(new.org_id),   -- every item is current from the issue day; a done required item restarts the next required one
         t.target_days,
         public.native_org_today(new.org_id) + t.target_days   -- calendar days from the issue day; null target gives null
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
  v_days text;
begin
  perform public.assert_not_light();
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role <> 'Admin' then
    raise exception 'only an Admin can set the organisation''s close-out checklist' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 then
    raise exception 'the close-out checklist is a list of at most 20 items' using errcode = '22023', detail = 'items-shape';
  end if;
  -- One list per organisation: serialise concurrent replacements on the organisation row.
  perform 1 from public.organizations o where o.id = v_org for update;
  delete from public.closeout_checklist_templates t where t.org_id = v_org;
  for v_item in select x from jsonb_array_elements(p_items) x loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' or coalesce(btrim(v_item ->> 'name'), '') = '' or length(btrim(v_item ->> 'name')) > 120 then
      raise exception 'every close-out item needs a name of 1 to 120 characters' using errcode = '23514', detail = 'item-name-invalid';
    end if;
    v_days := nullif(btrim(v_item ->> 'target_days'), '');
    if v_days is not null and (v_days !~ '^[0-9]{1,3}$' or v_days::int not between 1 and 365) then
      raise exception 'COT_TARGET_DAYS: a target is a whole number of days from 1 to 365' using errcode = '23514', detail = 'item-target-invalid';
    end if;
    insert into public.closeout_checklist_templates (org_id, position, name, required, target_days)
    values (v_org, v_pos, btrim(v_item ->> 'name'), coalesce((v_item ->> 'required')::boolean, true), v_days::smallint);
  end loop;
  perform public.log_audit('closeout_checklist.set', v_org, auth.uid(), v_org, jsonb_build_object('items', v_pos));
  return v_pos;
end; $$;
