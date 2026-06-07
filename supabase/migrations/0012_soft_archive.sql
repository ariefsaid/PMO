-- 0012_soft_archive.sql — cross-cutting soft-archive primitive (ADR-0018).
-- Adds a nullable `archived_at timestamptz` to `projects` and `companies` (NULL = live row), a partial
-- `WHERE archived_at IS NULL` index on each (the default list-filter fast path), and the column-level
-- UPDATE grant that re-enables writing the new projects column after 0008's table-wide revoke.
--
-- This is the SHARED archive seam only. Entity-specific behavior lands with its slice, NOT here:
--   • companies block-delete-if-referenced  → companies CRUD slice
--   • contract_value SoD edit RPC (ADR-0019) → projects slice
--   • Engineer own-task-status RLS widening  → tasks slice
-- Procurement keeps Cancel (status 'Cancelled') and deliberately gets NO archived_at column (ADR-0018 §4).
--
-- RLS is UNCHANGED: the existing projects_write / companies_write FOR ALL policies
-- (org_id = auth_org_id() AND auth_role() IN the 4 write-roles, USING + WITH CHECK) already authorize an
-- UPDATE of this non-revoked column by the write-roles, scoped to the caller's org. The org_id seam is
-- intact (the column carries no org data; out-of-org archive is denied by the existing row policy).
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Forward-only/additive. Manual rollback:
--   drop index if exists public.projects_live_idx;
--   drop index if exists public.companies_live_idx;
--   revoke update (archived_at) on projects from authenticated;
--   alter table projects  drop column if exists archived_at;
--   alter table companies drop column if exists archived_at;

-- (1) Additive nullable column on each archivable entity. No default → existing rows are live (NULL).
alter table projects  add column archived_at timestamptz;
alter table companies add column archived_at timestamptz;

-- (2) Partial index for the default list filter (`WHERE archived_at IS NULL`). Keeps the live-only
-- listing scan small/fast regardless of how many rows are later archived. Lead column org_id matches the
-- per-org listing access pattern (mirrors projects_org_id_idx / companies_org_id_idx).
create index projects_live_idx  on projects  (org_id) where archived_at is null;
create index companies_live_idx on companies (org_id) where archived_at is null;

-- (3) Column-level UPDATE grant for the new projects column (ADR-0018 §6).
-- 0008_project_revenue.sql did `revoke update on projects from authenticated` then re-granted UPDATE on an
-- EXPLICIT column list (to make the win-capture columns RPC-only, MED-PR-1). A column added AFTER that
-- grant is NOT writable by `authenticated` until added to the grant — so without this line a write-role
-- could not archive a project (the FOR ALL row policy would pass but the column privilege would deny).
-- This is a column privilege, NOT an RLS change: it does not widen WHO may write (the row policy still
-- gates org + role) and it does not touch the four RPC-only columns. companies was never column-revoked,
-- so its table-wide UPDATE grant already covers archived_at — no companies grant needed.
grant update (archived_at) on projects to authenticated;
