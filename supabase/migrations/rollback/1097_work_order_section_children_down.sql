-- Reverses 1097_work_order_section_children.sql (#2576). Reverse 1099 and 1098 first.
create or replace function public.wos_archive_blockers(p_section_id uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select null::text
$$;
update public.record_history_config set captured = captured - 'section_id' where entity_type = 'task';
drop trigger if exists tasks_zz_section on public.tasks;
drop index if exists public.tasks_section_idx;
alter table public.tasks drop constraint if exists tasks_section_wo_fk, drop constraint if exists tasks_section_needs_work_order;
alter table public.tasks drop column if exists section_id;
revoke insert (section_id) on public.work_order_crews from authenticated;
drop trigger if exists zz_work_order_crews_section on public.work_order_crews;
drop index if exists public.work_order_crews_section_idx;
alter table public.work_order_crews drop constraint if exists work_order_crews_section_wo_fk;
alter table public.work_order_crews drop column if exists section_id;
