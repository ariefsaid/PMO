# Plan: built-in role set (#2709)

Spec: `docs/specs/builtin-role-set.spec.md`. Executor: one builder, ships alone. Default behaviour unchanged for every existing person.

## Files

| File | Purpose |
|---|---|
| `supabase/migrations/1200_builtin_role_catalogue.sql` | tables `built_in_roles`, `built_in_role_capabilities` (RLS on, select for signed-in, no writes), the 28-row seed (one tuple per line), helpers `built_in_role_base/_tier/_may_approve/_may_prepare/_may_stand_in`, `role_has_capability`, `built_in_role_sees_prices` |
| `supabase/migrations/1201_built_in_roles_setting.sql` | `organizations.built_in_roles_enabled` (default false), `org_built_in_roles_enabled`, `get_/set_built_in_roles_enabled` (Admin) |
| `supabase/migrations/1202_profiles_built_in_role.sql` | `profiles.built_in_role`, column UPDATE grant, trigger: setting gate, level sync, no role-only change while held, no self-assign |
| `supabase/migrations/1203_role_capability_actor_helpers.sql` | `actor_built_in_role`, `actor_has_role_capability`, `actor_sees_prices`, `actor_holds_built_in_role` |
| `supabase/migrations/rollback/120{0..3}_*_down.sql` | reverse; the 1202 down refuses while any profile holds a key |
| `supabase/tests/1200_builtin_role_catalogue.test.sql`, `1202_profiles_built_in_role.test.sql` | AC-001, 002, 004-011, 013 |
| `supabase/tests/inventory/anon-executable-definers/2709-builtin-roles.txt`, `scripts/isolation-probe-denominator.d/2709-builtin-roles.json` | definer and table inventories |
| `pmo-portal/src/auth/builtInRoles.ts` (+ test) | frontend mirror, AC-003 parity |
| `pmo-portal/src/lib/db/{orgs,adminUsers}.ts`, `src/lib/repositories/{admin,contracts/admin}.ts`, `src/hooks/useBuiltInRoles.ts` | DAL, repository seam, hooks |
| `pmo-portal/pages/admin/OrgBuiltInRoles.tsx` (+ test) | the setting (AC-014) |
| `pmo-portal/pages/admin-users/{UserForms,UserDirectory}.tsx`, `pages/AdminUsers.tsx` (+ `RoleForm.builtIn.test.tsx`) | role picker (AC-015) |
| `pmo-portal/e2e/serial/AC-BIR-001-built-in-roles-assignment.spec.ts` | journey + evidence shots (`EVIDENCE_SHOTS=1`) |
| `docs/evidence/1215/2709/*.png` | phone 390 and desktop 1440 for the setting and the picker |

## Steps (test first)

1. pgTAP 1200 with independent literal expectations; red; write 1200; green.
2. pgTAP 1201 (profile cases as real authenticated actors, persisted-value read-back); red; write 1201 and 1202; green.
3. vitest parity test; red; write `builtInRoles.ts`; green.
4. Mutation checks (four, spec section 4); record the red line for each; restore.
5. Gates: `npm run check:guards`, typecheck, eslint on changed files, `npx vitest related --run` on changed files, isolation-denominator guard (new tables and definer functions: update the manifest fragment), then reset+test as one lock hold with `0178_anon_executable_definers`, `0178_m365_member_gate`, `0646_rls_initplan`, plus the existing profile tests `0172_profiles_hierarchy_write`, `0175`, `0177`, `0655` to prove nothing existing moved.

## Rulings applied (Director, 2026-11-21)

Base levels as in the spec table; Deputy PM manager; Site Supervisor officer; medical documents HR + Administrator only; assignment UI behind one setting (default false), database-enforced.
