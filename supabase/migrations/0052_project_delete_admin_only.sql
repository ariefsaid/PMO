-- 0052_project_delete_admin_only.sql
-- RED-4 (HIGH, live prod) — non-admin project hard-delete (ADR-0019 violation).
--
-- VULNERABILITY (gpt-5.5 red-team): projects_write (0002_rls.sql) is a coarse `for all` policy for the
-- four write-roles (Admin, Executive, Project Manager, Finance) in USING + WITH CHECK. Because `for all`
-- covers DELETE, ANY of those four roles can hard-DELETE a project. ADR-0019 + the FE policy map
-- (src/auth/policy.ts / ProjectDetailHeader "Admin-only (rbac-visibility §B2/§K)") say destructive delete
-- is Admin-only. RLS is the enforcement authority; the FE hide is only a clarity projection.
--
-- LEGIT-USAGE FINDING (verified before locking down): the app already gates the project-delete affordance
-- to Admin ONLY — ProjectDetailHeader.tsx:133 `canDelete = may('delete','project')` (Admin-only), and
-- deleteProject (src/lib/db/projects.ts:205) documents this exact server gap ("the FE hide is therefore
-- the only Admin-only narrowing today ... a SERVER gap to close"). No non-admin UI path calls delete. So
-- this migration ONLY closes the RLS gap; no UI change is needed and no legitimate flow is broken.
--
-- FIX (mirrors 0013 companies_delete_admin_only / 0017 project_documents): add a RESTRICTIVE DELETE-only
-- policy requiring Admin. PostgreSQL AND-combines a restrictive policy with the permissive projects_write,
-- and it applies ONLY to DELETE — so DELETE now requires (org + 4-role) AND (Admin) = Admin only, while
-- INSERT / UPDATE (incl. soft-archive) / SELECT are completely unaffected. The org guard still rides on
-- the permissive projects_write USING, so a cross-org Admin still cannot delete another org's project.
-- FK RESTRICT (23503) on referenced children (e.g. procurements, timesheet entries) is unchanged: an
-- Admin deleting a referenced project still gets 23503 ("in use").
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual rollback:
--   drop policy if exists projects_delete_admin_only on projects;

create policy projects_delete_admin_only on projects
  as restrictive
  for delete
  using (auth_role() = 'Admin');
