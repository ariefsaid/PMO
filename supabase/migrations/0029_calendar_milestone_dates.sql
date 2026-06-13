-- 0029_calendar_milestone_dates.sql — Project Calendar read (FR-CAL-002).
-- Batch dated-milestone read across projects for the read-only calendar view. security INVOKER →
-- RLS on project_milestones (0023: org_id = auth_org_id()) scopes rows; org_id is NEVER threaded
-- from the client; no SoD axis (read-only aggregation, ADR-0019 boundary). Mirrors the
-- get_projects_delivery(uuid[]) security-invoker shape (0023 §5). Milestones with a null
-- target_date are excluded server-side (OBS-CAL-001).
-- Reversibility (forward-only post-deploy; `supabase db reset` pre-prod):
--   drop function if exists get_projects_milestone_dates(uuid[]);
create or replace function get_projects_milestone_dates(p_ids uuid[])
  returns table (id uuid, project_id uuid, name text, target_date date)
  language sql stable security invoker set search_path = public as $$
  select m.id, m.project_id, m.name, m.target_date
    from project_milestones m
   where m.project_id = any(p_ids)
     and m.target_date is not null
   order by m.target_date, m.sort_order;
$$;
revoke all     on function get_projects_milestone_dates(uuid[]) from public;
grant  execute on function get_projects_milestone_dates(uuid[]) to   authenticated;
revoke execute on function get_projects_milestone_dates(uuid[]) from anon;
