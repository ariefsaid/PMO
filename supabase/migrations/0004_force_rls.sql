-- 0004_force_rls.sql — defense-in-depth: force RLS on every business table.
--
-- Background: `enable row level security` makes RLS apply to ordinary roles
-- (including Supabase's `authenticated` and `anon` API roles).  However, by
-- default the TABLE OWNER role bypasses RLS entirely.  `force row level
-- security` closes that gap: even the owner is subject to all policies.
--
-- This does NOT affect superuser connections (e.g. migrations, seed scripts run
-- via `supabase db reset` / psql as postgres) — superuser always bypasses FORCE.
-- It also does not affect security-definer functions that already set an
-- explicit search_path (auth_org_id, auth_role) because those run as the
-- definer's role, not the caller's.
--
-- The change is purely additive; no existing policy is altered.

alter table organizations          force row level security;
alter table profiles               force row level security;
alter table companies              force row level security;
alter table projects               force row level security;
alter table procurements           force row level security;
alter table procurement_items      force row level security;
alter table procurement_quotations force row level security;
alter table procurement_documents  force row level security;
alter table budget_versions        force row level security;
alter table budget_line_items      force row level security;
alter table timesheets             force row level security;
alter table timesheet_entries      force row level security;
alter table tasks                  force row level security;
alter table task_dependencies      force row level security;
alter table incident_reports       force row level security;
alter table project_documents      force row level security;
