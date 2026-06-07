-- 0013_company_delete_admin_only.sql — narrow company hard-DELETE to Admin (CRUD+RBAC Companies slice).
--
-- The existing companies_write policy (0002_rls.sql) is FOR ALL with the four write-roles
-- (Admin, Executive, Project Manager, Finance) in both USING and WITH CHECK. Because FOR ALL covers
-- DELETE, that policy lets ALL FOUR write-roles hard-delete a company. The Companies RBAC contract
-- (docs/design/rbac-visibility.md §D, row ⋯ → Delete = ● Admin only) and the FE policy map
-- (src/auth/policy.ts company.delete = allow(ADMIN)) say hard-delete is Admin-only. RLS is the
-- enforcement authority; the FE gate is only a clarity projection — so the server must enforce it too.
--
-- Approach: add a RESTRICTIVE DELETE-only policy requiring Admin. PostgreSQL combines a restrictive
-- policy with AND against the permissive policies, and a restrictive policy only applies to the command
-- it names. So DELETE now requires (companies_write: org + 4-role) AND (Admin) = Admin only, while
-- INSERT / UPDATE / SELECT are completely unaffected (no restrictive policy on those commands). This
-- keeps INSERT/UPDATE/archive open to the four write-roles and only tightens the destructive DELETE.
-- The org guard still rides on the permissive companies_write USING, so a cross-org Admin still cannot
-- delete another org's company.
--
-- NOTE (ADR-0018): SOFT-archive remains a write-role action enforced as an UPDATE of archived_at
-- (companies_write FOR ALL). The "archive = Admin/Exec" split in §D is an FE convention only (the
-- Archive affordance is shown to Admin/Exec); the server authorizes archive for all four write-roles,
-- matching how 0012 set up the archive seam. This migration does NOT touch archive/UPDATE.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual rollback:
--   drop policy if exists companies_delete_admin_only on companies;

create policy companies_delete_admin_only on companies
  as restrictive
  for delete
  using (auth_role() = 'Admin');
