-- 0045_user_views.sql — the user_views persistence entity (ADR-0036 §6/§10.1, Issue I1).
-- Owner-private-by-default saved-view definitions. Mirrors the Companies slice (0001 DDL + 0002 RLS
-- + 0004 force-rls + 0012 archive). Reuses auth_org_id()/auth_role() from 0002 (NOT redefined here).
-- Owner-decisions baked in: OD-1 scope CHECK permits 'shared_roles' but RLS does not yet row-level-
-- enforce it (treated as private until I6); OD-2 Admin may UPDATE/DELETE any same-org view (read of a
-- private row is NOT granted); OD-3 archive (soft) + delete (hard) both exposed; OQ-1 no name uniqueness;
-- OQ-2 no update_updated_at_column() trigger exists in the schema, so updated_at is bumped in the DAL.
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback:
--   drop index if exists public.user_views_user_id_idx;
--   drop index if exists public.user_views_live_idx;
--   drop index if exists public.user_views_org_id_idx;
--   drop policy if exists user_views_delete on user_views;
--   drop policy if exists user_views_update on user_views;
--   drop policy if exists user_views_insert on user_views;
--   drop policy if exists user_views_select on user_views;
--   drop table if exists public.user_views;

create table user_views (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  user_id     uuid not null references profiles(id) default auth.uid(),
  name        text not null,
  description text,
  spec        jsonb not null default '{}'::jsonb,
  scope       text not null default 'private' check (scope in ('private','shared_org','shared_roles')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

-- Hot-path indexes (NFR-UV-PERF-001): per-org listing + live-only fast path + owner-list fast path.
create index user_views_org_id_idx  on user_views (org_id);
create index user_views_live_idx    on user_views (org_id) where archived_at is null;
create index user_views_user_id_idx on user_views (user_id) where archived_at is null;

alter table user_views enable row level security;
alter table user_views force row level security;

-- SELECT: owner always; same-org members only for shared_org rows. A private/shared_roles row owned by
-- another user is invisible even to same-org members and to Admin (OD-1/OD-2 read asymmetry). org_id is
-- the wall: a shared_org row in another org is never returned (cross-org → 0 rows).
create policy user_views_select on user_views for select
  using (user_id = auth.uid() or (scope = 'shared_org' and org_id = auth_org_id()));

-- INSERT: org pinned to caller's org (default + check) and owner pinned to the caller (auth.uid()).
create policy user_views_insert on user_views for insert
  with check (org_id = auth_org_id() and user_id = auth.uid());

-- UPDATE: in-org AND (owner OR Admin); the post-image re-pins org AND ownership so an owner cannot
-- reassign user_id away from themselves via a hand-crafted PATCH (Admin may still retarget within the
-- org per OD-2). Mirrors the timesheets_update_own WITH CHECK hardening (0002_rls.sql). RLS is the
-- enforcement authority (NFR-UV-SEC-001); the production DAL never sends user_id, but the browser holds
-- a valid JWT + anon key, so the post-image owner predicate is required, not optional.
create policy user_views_update on user_views for update
  using (org_id = auth_org_id() and (user_id = auth.uid() or auth_role() = 'Admin'))
  with check (org_id = auth_org_id() and (user_id = auth.uid() or auth_role() = 'Admin'));

-- DELETE: in-org AND (owner OR Admin) (OD-2; OD-3 hard-delete path).
create policy user_views_delete on user_views for delete
  using (org_id = auth_org_id() and (user_id = auth.uid() or auth_role() = 'Admin'));
