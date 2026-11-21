-- 1171_work_order_section_children.sql — #2576: a crew placement and a task may name a section of their work order.
-- Spec docs/specs/work-order-sections.spec.md (FR-WOS-010, 011 tasks, 012, 005); plan 2026-11-20-work-order-sections.md.
-- Proven by supabase/tests/1169_work_order_sections.test.sql (AC-WOS-003, 006, 017).
--
--   • work_order_crews.section_id (#2528, 1035): a crew works one section over the placement's date range. The shipped
--     no-overlap rule (a crew serves one work order on any day, `work_order_crews_no_overlap`) already stops one crew
--     being on two sections of a work order on the same day, so changing section ends one placement and starts another.
--     The column is set on INSERT only (the UPDATE grant stays valid_from/valid_to).
--   • tasks.section_id (#2531, 1038): a task of a work order may name one of its sections.
--   Both carry the composite foreign key (section_id, work_order_id) → work_order_sections (id, work_order_id)
--   (MATCH SIMPLE: null always passes) and the archived-section trigger from 1170.
--   A task's work_order_id is nullable, and a MATCH SIMPLE key passes when ANY column is null, so tasks also carry a
--   check: a section needs a work order.
--   • The section's archive guard now also counts its tasks that are not Done (AC-WOS-006).
--
-- Also built here: daily-report progress lines (#1522, 1040/1041): see the section at the end of this file.
--
-- ── REVERSE (also supabase/migrations/rollback/1171_work_order_section_children_down.sql) ─────────────────────

alter table public.work_order_crews add column section_id uuid;
alter table public.work_order_crews
  add constraint work_order_crews_section_wo_fk foreign key (section_id, work_order_id)
  references public.work_order_sections (id, work_order_id);
create index work_order_crews_section_idx on public.work_order_crews (work_order_id, section_id);
create trigger zz_work_order_crews_section before insert or update of section_id on public.work_order_crews
  for each row execute function public.wos_check_child_section();
grant insert (section_id) on public.work_order_crews to authenticated;

alter table public.tasks add column section_id uuid;
alter table public.tasks
  add constraint tasks_section_needs_work_order check (section_id is null or work_order_id is not null),
  add constraint tasks_section_wo_fk foreign key (section_id, work_order_id)
  references public.work_order_sections (id, work_order_id);
create index tasks_section_idx on public.tasks (work_order_id, section_id) where section_id is not null;
create trigger tasks_zz_section before insert or update of section_id on public.tasks
  for each row execute function public.wos_check_child_section();
-- Change-history registry (record_changes_catalog_gate): the new column is captured row history.
update public.record_history_config
   set captured = captured || '{"section_id":"ref"}'::jsonb
 where entity_type = 'task';

create or replace function public.wos_archive_blockers(p_section_id uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when n > 0 then n::text || ' task(s) of this section are not done' end
    from (select count(*) as n from public.tasks t where t.section_id = p_section_id and t.status <> 'Done') x
$$;

-- ── daily-report progress lines (#1522, 1040/1041) ────────────────────────────────────────────────────────────
-- A progress line may name a section of its report's work order (FR-WOS-011/012). The line carries no work_order_id of
-- its own (its report does), so the composite key needs one: stamped from the report by a trigger (never from the
-- caller), backfilled for existing lines. The writers (dsr_replace_lines, dsr_correct) are restated whole below.
alter table public.dsr_progress_lines add column work_order_id uuid;
alter table public.dsr_progress_lines add column section_id uuid;
update public.dsr_progress_lines l set work_order_id = r.work_order_id
  from public.daily_site_reports r where r.id = l.report_id;
alter table public.dsr_progress_lines alter column work_order_id set not null;
alter table public.dsr_progress_lines
  add constraint dsr_progress_lines_section_wo_fk foreign key (section_id, work_order_id)
  references public.work_order_sections (id, work_order_id);
create index dsr_progress_lines_section_idx on public.dsr_progress_lines (work_order_id, section_id) where section_id is not null;
create function public.wos_stamp_dsr_line_wo() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select r.work_order_id into new.work_order_id from public.daily_site_reports r where r.id = new.report_id;
  return new;
end $$;
revoke all on function public.wos_stamp_dsr_line_wo() from public, anon, authenticated;
create trigger dsr_progress_lines_aa_stamp_wo before insert on public.dsr_progress_lines
  for each row execute function public.wos_stamp_dsr_line_wo();
create trigger dsr_progress_lines_zz_section before insert or update of section_id on public.dsr_progress_lines
  for each row execute function public.wos_check_child_section();
revoke select on public.dsr_progress_lines from authenticated;
grant select (id, org_id, report_id, position, work_order_line_id, sub_stage, quantity, unit, frozen_at, work_order_id, section_id)
  on public.dsr_progress_lines to authenticated;

create or replace function public.dsr_replace_lines(p_report public.daily_site_reports, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; v_pos integer; v_qty numeric; v_unit text; v_min integer; v_line uuid; v_item uuid; v_reason uuid; v_sec uuid;
begin
  delete from public.dsr_progress_lines where report_id = p_report.id;
  delete from public.dsr_idle_periods where report_id = p_report.id;
  delete from public.dsr_consumables where report_id = p_report.id;

  v_pos := 0;
  for e in select * from jsonb_array_elements(coalesce(p->'progress', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    begin v_line := (e->>'work_order_line_id')::uuid; exception when others then v_line := null; end;
    select bi.unit into v_unit from public.work_order_lines l join public.boq_items bi on bi.id = l.boq_item_id
     where l.id = v_line and l.work_order_id = p_report.work_order_id and l.org_id = p_report.org_id;
    if v_unit is null then
      raise exception 'progress line % is not a contract item of this work order', v_pos using errcode = '23514';
    end if;
    begin v_qty := (e->>'quantity')::numeric; exception when others then v_qty := null; end;
    if v_qty is null or v_qty <= 0 or v_qty >= 100000000000 or round(v_qty, 3) <> v_qty then
      raise exception 'progress line % needs a positive quantity with at most 3 decimals', v_pos using errcode = '22023';
    end if;
    v_sec := null;
    if nullif(e->>'section_id', '') is not null then
      begin v_sec := (e->>'section_id')::uuid; exception when others then v_sec := null; end;
      if not exists (select 1 from public.work_order_sections s
                      where s.id = v_sec and s.work_order_id = p_report.work_order_id and s.org_id = p_report.org_id) then
        raise exception 'progress line % names a section that is not on this work order', v_pos using errcode = '23514';
      end if;
    end if;
    insert into public.dsr_progress_lines (org_id, report_id, position, work_order_line_id, section_id, sub_stage, quantity, unit)
    values (p_report.org_id, p_report.id, v_pos, v_line, v_sec, nullif(btrim(coalesce(e->>'sub_stage', '')), ''), v_qty, v_unit);
  end loop;

  v_pos := 0;
  for e in select * from jsonb_array_elements(coalesce(p->'idle', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    begin v_min := (e->>'minutes')::integer; exception when others then v_min := null; end;
    if v_min is null or v_min not between 1 and 1440 then
      raise exception 'idle period % needs 1 to 1440 minutes', v_pos using errcode = '22023';
    end if;
    begin v_reason := (e->>'reason_id')::uuid; exception when others then v_reason := null; end;
    if not exists (select 1 from public.dsr_idle_reasons r where r.id = v_reason and r.org_id = p_report.org_id and r.archived_at is null) then
      raise exception 'idle period % has an unknown reason', v_pos using errcode = '23503';
    end if;
    insert into public.dsr_idle_periods (org_id, report_id, position, minutes, reason_id) values (p_report.org_id, p_report.id, v_pos, v_min, v_reason);
  end loop;

  v_pos := 0;
  for e in select * from jsonb_array_elements(coalesce(p->'consumables', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    begin v_item := (e->>'stock_item_id')::uuid; exception when others then v_item := null; end;
    select u.code into v_unit from public.stock_items s join public.stock_units u on u.id = s.unit_id
     where s.id = v_item and s.org_id = p_report.org_id;
    if v_unit is null then raise exception 'consumable % is not a stock item of this organisation', v_pos using errcode = '23503'; end if;
    begin v_qty := (e->>'quantity')::numeric; exception when others then v_qty := null; end;
    if v_qty is null or v_qty <= 0 or v_qty >= 100000000000 or round(v_qty, 3) <> v_qty then
      raise exception 'consumable % needs a positive quantity with at most 3 decimals', v_pos using errcode = '22023';
    end if;
    insert into public.dsr_consumables (org_id, report_id, position, stock_item_id, quantity, unit)
    values (p_report.org_id, p_report.id, v_pos, v_item, v_qty, v_unit);
  end loop;
end $$;

create or replace function public.dsr_correct(p_report uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; r public.daily_site_reports; n public.daily_site_reports; v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  if char_length(v_reason) not between 1 and 500 then raise exception 'a reason is required to correct a report' using errcode = '22023'; end if;
  select * into r from public.daily_site_reports where id = p_report and org_id = v_org for update;
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.status <> 'validated' or r.superseded_at is not null then
    raise exception 'only the current validated report can be corrected' using errcode = '42501';
  end if;
  if not public.dsr_may_validate(r.project_id) then raise exception 'you cannot correct this report' using errcode = '42501'; end if;
  if exists (select 1 from public.daily_site_reports d where d.supersedes_id = r.id) then
    raise exception 'a correction of this report already exists' using errcode = '23505';
  end if;
  insert into public.daily_site_reports (org_id, project_id, work_order_id, work_date, version, supersedes_id, correction_reason,
         author_id, variant_id, start_time, end_time, weather_id, weather_note, note)
  values (v_org, r.project_id, r.work_order_id, r.work_date, r.version + 1, r.id, v_reason,
         auth.uid(), r.variant_id, r.start_time, r.end_time, r.weather_id, r.weather_note, r.note)
  returning * into n;
  insert into public.dsr_progress_lines (org_id, report_id, position, work_order_line_id, section_id, sub_stage, quantity, unit)
    select org_id, n.id, position, work_order_line_id, section_id, sub_stage, quantity, unit from public.dsr_progress_lines where report_id = r.id;
  insert into public.dsr_idle_periods (org_id, report_id, position, minutes, reason_id)
    select org_id, n.id, position, minutes, reason_id from public.dsr_idle_periods where report_id = r.id;
  insert into public.dsr_consumables (org_id, report_id, position, stock_item_id, quantity, unit)
    select org_id, n.id, position, stock_item_id, quantity, unit from public.dsr_consumables where report_id = r.id;
  insert into public.dsr_photos (org_id, report_id, kind, file_path, uploaded_by_id)
    select org_id, n.id, kind, file_path, uploaded_by_id from public.dsr_photos where report_id = r.id;
  perform public.dsr_log(n.id, v_org, 'corrected', v_reason);
  return n.id;
end $$;
