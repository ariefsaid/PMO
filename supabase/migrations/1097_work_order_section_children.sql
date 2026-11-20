-- 1097_work_order_section_children.sql — #2576: a crew placement and a task may name a section of their work order.
-- Spec docs/specs/work-order-sections.spec.md (FR-WOS-010, 011 tasks, 012, 005); plan 2026-11-20-work-order-sections.md.
-- Proven by supabase/tests/1095_work_order_sections.test.sql (AC-WOS-003, 006, 017).
--
--   • work_order_crews.section_id (#2528, 1035): a crew works one section over the placement's date range. The shipped
--     no-overlap rule (a crew serves one work order on any day, `work_order_crews_no_overlap`) already stops one crew
--     being on two sections of a work order on the same day, so changing section ends one placement and starts another.
--     The column is set on INSERT only (the UPDATE grant stays valid_from/valid_to).
--   • tasks.section_id (#2531, 1038): a task of a work order may name one of its sections.
--   Both carry the composite foreign key (section_id, work_order_id) → work_order_sections (id, work_order_id)
--   (MATCH SIMPLE: null always passes) and the archived-section trigger from 1096.
--   A task's work_order_id is nullable, and a MATCH SIMPLE key passes when ANY column is null, so tasks also carry a
--   check: a section needs a work order.
--   • The section's archive guard now also counts its tasks that are not Done (AC-WOS-006).
--
-- NOT built here: daily-report progress lines (#1522, 1040). dsr_progress_lines carries no work_order_id of its own
-- (the report does), so a composite key needs a denormalised column plus a change to the report RPCs that write lines;
-- that is a separate migration, listed as an open question in the build report.
--
-- ── REVERSE (also supabase/migrations/rollback/1097_work_order_section_children_down.sql) ─────────────────────

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
