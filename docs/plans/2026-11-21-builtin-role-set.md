# Plan: built-in role set (#2709)

Spec: `docs/specs/builtin-role-set.spec.md`. Executor: one builder, ships alone. Default behaviour unchanged for every existing person.

## Files

| File | Purpose |
|---|---|
| `supabase/migrations/1200_builtin_role_catalogue.sql` | tables `built_in_roles`, `built_in_role_capabilities` (RLS on, select for authenticated, no writes), seed (28 rows, one tuple per line), functions `built_in_role_base/_tier/_may_approve/_may_prepare/_may_stand_in`, `role_has_capability`, `built_in_role_sees_prices` |
| `supabase/migrations/1201_profiles_built_in_role.sql` | `profiles.built_in_role text references built_in_roles(key)`, BEFORE INSERT/UPDATE trigger (sync role, refuse role-only change, refuse self-assign), grant of the new column to the profile-admin update path as the existing allow-list requires |
| `supabase/migrations/1202_role_capability_actor_helpers.sql` | `actor_has_role_capability(text)`, `actor_sees_prices()` (security definer, fixed search_path, active member only) |
| `supabase/migrations/rollback/120{0,1,2}_*_down.sql` | reverse; 1201 down refuses while any profile holds a key |
| `supabase/tests/1200_builtin_role_catalogue.test.sql` | AC-001, 002, 007, 008, 010, 011 |
| `supabase/tests/1201_profiles_built_in_role.test.sql` | AC-004, 005, 006, 009 |
| `pmo-portal/src/auth/builtInRoles.ts` | FE mirror (28 rows, capabilities, helpers) |
| `pmo-portal/src/auth/builtInRoles.test.ts` | AC-003 (parses migration seed and compares), FR-011 |
| `docs/glossary.md` | terms: Built-in role, Base access level, Role tier, Role capability |
| `docs/decisions.md` | note: base-level choices for the 28 roles |

Migration 1203 and 1204 held in reserve; none planned.

## Steps (test first)

1. pgTAP 1200 with independent literal expectations; red; write 1200; green.
2. pgTAP 1201 (profile cases as real authenticated actors, persisted-value read-back); red; write 1201 and 1202; green.
3. vitest parity test; red; write `builtInRoles.ts`; green.
4. Mutation checks (four, spec section 4); record the red line for each; restore.
5. Gates: `npm run check:guards`, typecheck, eslint on changed files, `npx vitest related --run` on changed files, isolation-denominator guard (new tables and definer functions: update the manifest fragment), then reset+test as one lock hold with `0178_anon_executable_definers`, `0178_m365_member_gate`, `0646_rls_initplan`, plus the existing profile tests `0172_profiles_hierarchy_write`, `0175`, `0177`, `0655` to prove nothing existing moved.

## Open questions for the Director

1. Base-level choices in spec section 2 (notably Project Administrator = Engineer, Billing Officer = Finance, every non-finance manager = Project Manager). Rank and approval reach follow the base level, so a wrong base is a real access change. Confirm or amend.
2. Is Deputy Project Manager a manager (stands in for PM) or an officer? Spec treats it as manager (12 managers + 14 officers + 2 field = 28).
3. Should a Site Supervisor count as officer (spec) rather than manager?
4. Medical documents: spec gives HR Manager, HR Officer and Administrator; confirm Executive is excluded.
5. The assignment path today is the profile update API (existing hierarchy rule); an Admin UI to pick a role is not in this ticket. Acceptable?
