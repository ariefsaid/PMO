-- Reverses 1095_work_order_sections.sql (#2576). Reverse 1099..1096 first: they reference this table.
drop table if exists public.work_order_section_readiness_events;
drop table if exists public.work_order_sections;
drop function if exists public.wos_events_append_only();
drop function if exists public.guard_work_order_section();
drop function if exists public.audit_work_order_section();
drop function if exists public.wos_archive_blockers(uuid);
