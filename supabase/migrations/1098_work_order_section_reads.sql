-- 1098_work_order_section_reads.sql — #2576: the roll-up read and the readiness roll-up.
-- Spec docs/specs/work-order-sections.spec.md (FR-WOS-014 plan part, 016, 017, 020, 021; NFR-WOS-001/003);
-- plan docs/plans/2026-11-20-work-order-sections.md. Proven by supabase/tests/1095_work_order_sections.test.sql
-- (AC-WOS-001, 002, 012, 014). Not a money path: both reads are security INVOKER, so every row is read under the
-- caller's own RLS (a role that may not read plan figures sees them as null).
--
-- work_order_section_rollup(work_order): one row per section of the work order (archived ones too: records already
-- pointing at one keep it, so the roll-up must still count them) plus ONE row with section_id null, the unsectioned
-- remainder ("Not in a section"). With no section there are no rows at all (AC-WOS-001: the work order reads as before).
-- Every figure is an exact sum grouped by section_id over the same records the work-order total sums, so
-- sum(sections) + remainder = the work-order total by construction (the roll-up invariant, AC-WOS-002).
-- Progress is what the section owns: tasks (Done of total) and today's crews; validated daily-report quantities come
-- from work_order_section_progress below (a measure that does not exist is never zero-filled).
--
-- work_order_section_readiness: per work order, counts of LIVE sections per readiness and "all ready" (at least one live
-- section and every live section ready). A work order with no live section has no row.
--
-- ── REVERSE (also supabase/migrations/rollback/1098_work_order_section_reads_down.sql) ───────────────────────

create function public.work_order_section_rollup(p_work_order_id uuid)
  returns table (
    section_id uuid, code text, name text, location_note text, foreman_id uuid, readiness text, readiness_note text,
    sort_order integer, archived_at timestamptz,
    direct_budget numeric, indirect_budget numeric, equipment_hours numeric, crew_hours numeric,
    tasks_total integer, tasks_done integer, crews_today integer)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (
    select x.id, x.code, x.name, x.location_note, x.foreman_id, x.readiness, x.readiness_note, x.sort_order, x.archived_at
      from public.work_order_sections x where x.work_order_id = p_work_order_id
  ),
  keys as (
    select s.id as sid, s.code, s.name, s.location_note, s.foreman_id, s.readiness, s.readiness_note, s.sort_order, s.archived_at from s
    union all
    select null::uuid, null, null, null, null::uuid, null, null, null::integer, null::timestamptz where exists (select 1 from s)
  ),
  plan as (
    select l.section_id as sid, l.kind, sum(l.value) as v
      from public.work_order_plan_lines l where l.work_order_id = p_work_order_id group by l.section_id, l.kind
  ),
  tk as (
    select t.section_id as sid, count(*)::integer as total, (count(*) filter (where t.status = 'Done'))::integer as done
      from public.tasks t where t.work_order_id = p_work_order_id group by t.section_id
  ),
  cr as (
    select c.section_id as sid, count(*)::integer as n
      from public.work_order_crews c
     where c.work_order_id = p_work_order_id and current_date between c.valid_from and coalesce(c.valid_to, 'infinity'::date)
     group by c.section_id
  )
  select k.sid, k.code, k.name, k.location_note, k.foreman_id, k.readiness, k.readiness_note, k.sort_order, k.archived_at,
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'direct_budget'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'indirect_budget'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'equipment_hours'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'crew_hours'),
         coalesce((select t.total from tk t where t.sid is not distinct from k.sid), 0),
         coalesce((select t.done from tk t where t.sid is not distinct from k.sid), 0),
         coalesce((select c.n from cr c where c.sid is not distinct from k.sid), 0)
    from keys k
   order by (k.sid is null), k.sort_order, k.code
$$;
revoke all on function public.work_order_section_rollup(uuid) from public, anon;
grant execute on function public.work_order_section_rollup(uuid) to authenticated;

create view public.work_order_section_readiness with (security_invoker = true) as
  select s.org_id, s.work_order_id,
         (count(*))::integer as live_sections,
         (count(*) filter (where s.readiness = 'not_ready'))::integer as not_ready,
         (count(*) filter (where s.readiness = 'ready'))::integer as ready,
         (count(*) filter (where s.readiness = 'blocked'))::integer as blocked,
         (count(*) = count(*) filter (where s.readiness = 'ready')) as all_ready
    from public.work_order_sections s
   where s.archived_at is null
   group by s.org_id, s.work_order_id;
revoke all on public.work_order_section_readiness from public, anon, authenticated;
grant select on public.work_order_section_readiness to authenticated;
grant all on public.work_order_section_readiness to service_role;

-- Validated daily-report quantities per section and contract item (FR-WOS-016, #1522). Only the current validated
-- version of each report counts (a superseded or archived report never does), the same rule as the shipped validated
-- revenue read. One row per (section or null remainder) x contract item; a work order with no validated report has no
-- rows (the measure is absent, never zero-filled). Security INVOKER: the caller's own RLS and column grants apply.
-- sum(sections) + remainder is the work-order total per contract item by construction (FR-WOS-017).
create function public.work_order_section_progress(p_work_order_id uuid)
  returns table (section_id uuid, work_order_line_id uuid, unit text, quantity numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select l.section_id, l.work_order_line_id, l.unit, sum(l.quantity)
    from public.dsr_progress_lines l
    join public.daily_site_reports d on d.id = l.report_id
   where l.work_order_id = p_work_order_id and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
   group by l.section_id, l.work_order_line_id, l.unit
   order by (l.section_id is null), l.section_id, l.work_order_line_id
$$;
revoke all on function public.work_order_section_progress(uuid) from public, anon;
grant execute on function public.work_order_section_progress(uuid) to authenticated;
