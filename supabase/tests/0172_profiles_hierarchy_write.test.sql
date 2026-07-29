-- 0172_profiles_hierarchy_write.test.sql — ADR-0070's PROFILE-EDITING rule, proven cell by cell.
-- Migration under test: supabase/migrations/0179_profiles_hierarchy_write.sql
--
-- THE OWNER'S RULING (2026-07-29, ADR-0070 "Profile editing follows the same order"):
--   "You may edit a profile only if you OUTRANK the person whose profile it is, and you may only
--    assign a role BELOW your own." — plus ONE carve-out: an Admin may edit a peer Admin, never
--    themselves.
--
--   | actor                    | may edit the profile of                  | may assign role            |
--   | Admin                    | anyone, incl. other Admins, NEVER self   | any                        |
--   | Executive                | Finance, Project Manager, Engineer       | Finance, PM, Engineer      |
--   | Finance / PM / Engineer  | nobody                                   | nobody                     |
--
-- ⚑ WHY EVERY CELL IS ASSERTED IN **BOTH** DIRECTIONS. `USING` governs WHOSE profile you may touch
--   (the pre-image); `WITH CHECK` governs WHAT YOU MAY SET IT TO (the post-image). Checking only one
--   leaves the other open, and that asymmetry is a defect this program has already had to repair
--   twice. The two mutations that catch it are named at each site:
--     • drop the rank test from WITH CHECK -> AC-PHW-021 (an Executive promotes a PM to Executive) goes green-to-red;
--     • drop the rank test from USING      -> AC-PHW-030 (an Executive DEMOTES an Admin to Finance) goes green-to-red.
--   AC-PHW-030 is the one a WITH-CHECK-only policy would let through, because 'Finance' IS a role an
--   Executive may assign — the illegal part is the SUBJECT, not the target role.
--
-- ⚑ NO SOURCE-TEXT ASSERTIONS. 0170's AC-PMS-021 asserted `prosrc like '%…MUST stay%'` and matched a
--   `--` COMMENT: deleting the whole guard left it green. Everything here is behaviour — an UPDATE is
--   attempted and the persisted row is read back as the table owner (RLS off) as the oracle.
--
-- Denials come in TWO SHAPES and the difference is the point:
--   • USING does not match  -> the row is invisible to the UPDATE: NO error, 0 rows, value unchanged.
--   • WITH CHECK fails      -> 42501 `new row violates row-level security policy for table "profiles"`.
--   Both are asserted by the persisted value, never by errcode alone.

begin;
select plan(53);

-- ── Fixtures (inserted as table owner, RLS bypassed) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('01720000-0000-0000-0000-000000000001','PHW Org A'),
  ('01720000-0000-0000-0000-000000000002','PHW Org B');

insert into auth.users (id, email) values
  ('01720000-0000-0000-0000-0000000000a1','phw-admin1@example.com'),
  ('01720000-0000-0000-0000-0000000000a2','phw-admin2@example.com'),
  ('01720000-0000-0000-0000-0000000000a9','phw-admin-disabled@example.com'),
  ('01720000-0000-0000-0000-0000000000e1','phw-exec1@example.com'),
  ('01720000-0000-0000-0000-0000000000e2','phw-exec2@example.com'),
  ('01720000-0000-0000-0000-0000000000f1','phw-finance@example.com'),
  ('01720000-0000-0000-0000-0000000000c1','phw-pm@example.com'),
  ('01720000-0000-0000-0000-0000000000d1','phw-engineer@example.com'),
  ('01720000-0000-0000-0000-0000000000d2','phw-newhire@example.com'),
  ('01720000-0000-0000-0000-0000000000b1','phw-exec-orgb@example.com');
-- d2 deliberately has NO profile row: it is the INSERT target, so the only thing that can refuse the
-- insert is RLS (a missing auth.users row would raise 23503 and prove nothing about the policy).

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01720000-0000-0000-0000-0000000000a1','01720000-0000-0000-0000-000000000001','PHW Admin One','phw-admin1@example.com','Admin','active'),
  ('01720000-0000-0000-0000-0000000000a2','01720000-0000-0000-0000-000000000001','PHW Admin Two','phw-admin2@example.com','Admin','active'),
  ('01720000-0000-0000-0000-0000000000a9','01720000-0000-0000-0000-000000000001','PHW Admin Gone','phw-admin-disabled@example.com','Admin','disabled'),
  ('01720000-0000-0000-0000-0000000000e1','01720000-0000-0000-0000-000000000001','PHW Exec One','phw-exec1@example.com','Executive','active'),
  ('01720000-0000-0000-0000-0000000000e2','01720000-0000-0000-0000-000000000001','PHW Exec Two','phw-exec2@example.com','Executive','active'),
  ('01720000-0000-0000-0000-0000000000f1','01720000-0000-0000-0000-000000000001','PHW Finance','phw-finance@example.com','Finance','active'),
  ('01720000-0000-0000-0000-0000000000c1','01720000-0000-0000-0000-000000000001','PHW PM','phw-pm@example.com','Project Manager','active'),
  ('01720000-0000-0000-0000-0000000000d1','01720000-0000-0000-0000-000000000001','PHW Engineer','phw-engineer@example.com','Engineer','active'),
  ('01720000-0000-0000-0000-0000000000b1','01720000-0000-0000-0000-000000000002','PHW Exec Org B','phw-exec-orgb@example.com','Executive','active');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ROW 3 OF THE MATRIX — Finance / Project Manager / Engineer may edit NOBODY.
--
-- ⚑ THIS IS THE AUTHORITY FLOOR, AND IT IS NOT IMPLIED BY OUTRANKING. Finance OUTRANKS a Project
--   Manager and a PM OUTRANKS an Engineer (0178's role_rank), so a policy that said only
--   "role_outranks(actor, subject)" would hand Finance and PMs profile-administration authority the
--   owner explicitly withheld — and a PM who can set a peer's manager_id can quietly re-point the
--   money SoD's approval line. The floor is what stops that.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select lives_ok(
  $$ update profiles set role = 'Engineer' where id = '01720000-0000-0000-0000-0000000000c1' $$,
  'AC-PHW-001 Finance UPDATE of a Project Manager raises nothing (USING matches no policy -> 0 rows)');
select lives_ok(
  $$ update profiles set manager_id = '01720000-0000-0000-0000-0000000000f1'
       where id = '01720000-0000-0000-0000-0000000000d1' $$,
  'AC-PHW-002 Finance UPDATE of an Engineer''s manager raises nothing (0 rows)');

set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok(
  $$ update profiles set manager_id = '01720000-0000-0000-0000-0000000000c1'
       where id = '01720000-0000-0000-0000-0000000000d1' $$,
  'AC-PHW-003 a PM cannot make themselves an Engineer''s supervisor (0 rows) — the money SoD''s approval line is not self-serve');

set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select lives_ok(
  $$ update profiles set role = 'Admin' where id = '01720000-0000-0000-0000-0000000000c1' $$,
  'AC-PHW-004 an Engineer cannot edit anyone (0 rows)');

reset role;
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000c1'),
  'Project Manager', 'AC-PHW-005 the PM''s role survived every Finance/Engineer attempt');
select ok((select manager_id is null from profiles where id = '01720000-0000-0000-0000-0000000000d1'),
  'AC-PHW-006 the Engineer''s manager_id is still NULL — no Finance and no PM re-routed it');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ROW 2 OF THE MATRIX, POSITIVE HALF — an Executive MAY edit Finance, PM and Engineer.
-- This is the WIDENING; before 0179 every one of these was a 0-row no-op.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000e1","role":"authenticated"}';

select lives_ok(
  $$ update profiles set role = 'Project Manager' where id = '01720000-0000-0000-0000-0000000000f1' $$,
  'AC-PHW-010 an Executive may re-role a Finance user');
select lives_ok(
  $$ update profiles set manager_id = '01720000-0000-0000-0000-0000000000e1'
       where id = '01720000-0000-0000-0000-0000000000c1' $$,
  'AC-PHW-011 an Executive may assign a Project Manager''s supervisor');
select lives_ok(
  $$ update profiles set full_name = 'PHW Engineer Renamed'
       where id = '01720000-0000-0000-0000-0000000000d1' $$,
  'AC-PHW-012 an Executive may edit an Engineer''s non-role fields');

reset role;
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000f1'),
  'Project Manager', 'AC-PHW-013 the Executive''s re-role PERSISTED (not a silent RLS no-op)');
select is((select manager_id::text from profiles where id = '01720000-0000-0000-0000-0000000000c1'),
  '01720000-0000-0000-0000-0000000000e1', 'AC-PHW-014 the Executive''s supervisor assignment PERSISTED');
select is((select full_name from profiles where id = '01720000-0000-0000-0000-0000000000d1'),
  'PHW Engineer Renamed', 'AC-PHW-015 the Executive''s metadata edit PERSISTED');

-- restore the Finance user's role so the rest of the matrix reads against the documented fixture
reset role;
update profiles set role = 'Finance' where id = '01720000-0000-0000-0000-0000000000f1';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ROW 2, NEGATIVE HALF — the Executive's ceiling, in BOTH clauses.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- WITH CHECK: the post-image role must be BELOW the actor's own. Executive does not outrank Executive.
select throws_ok(
  $$ update profiles set role = 'Executive' where id = '01720000-0000-0000-0000-0000000000c1' $$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'AC-PHW-021 an Executive cannot assign the Executive role (WITH CHECK) — "only an Admin may assign Executive" falls out of strict rank, it is not a special case');
select throws_ok(
  $$ update profiles set role = 'Admin' where id = '01720000-0000-0000-0000-0000000000c1' $$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'AC-PHW-022 an Executive cannot assign the Admin role (WITH CHECK)');

-- USING: whose profile may be touched at all.
select lives_ok(
  $$ update profiles set full_name = 'Peer Exec Renamed' where id = '01720000-0000-0000-0000-0000000000e2' $$,
  'AC-PHW-023 an Executive editing a PEER Executive raises nothing (USING matches nothing -> 0 rows)');
select lives_ok(
  $$ update profiles set manager_id = '01720000-0000-0000-0000-0000000000e1'
       where id = '01720000-0000-0000-0000-0000000000a1' $$,
  'AC-PHW-024 an Executive cannot make themselves an Admin''s supervisor (0 rows)');

-- ⚑ THE WITH-CHECK-ONLY MUTATION DETECTOR. 'Finance' IS a role an Executive may assign, so the
--   post-image alone is legal — only the SUBJECT (an Admin) is out of reach. A policy that tested
--   rank in WITH CHECK but not in USING would let this through.
select lives_ok(
  $$ update profiles set role = 'Finance' where id = '01720000-0000-0000-0000-0000000000a1' $$,
  'AC-PHW-030 an Executive cannot DEMOTE an Admin to a role they may otherwise assign (USING) -> 0 rows');

reset role;
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000a1'),
  'Admin', 'AC-PHW-031 the Admin is still an Admin — the Executive demotion changed nothing');
select is((select full_name from profiles where id = '01720000-0000-0000-0000-0000000000e2'),
  'PHW Exec Two', 'AC-PHW-032 the peer Executive''s row is untouched');
select ok((select manager_id is null from profiles where id = '01720000-0000-0000-0000-0000000000a1'),
  'AC-PHW-033 the Admin has no supervisor — an Executive cannot appoint themselves one');
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000c1'),
  'Project Manager', 'AC-PHW-034 the PM is still a PM after both rejected promotions');

-- THE LOAD-BEARING PIN (ADR-0070 precondition): profiles_update_self still pins role AND manager_id,
-- so an Executive cannot promote THEMSELVES to Admin in one statement. Without it the widening above
-- would be self-serve.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok(
  $$ update profiles set role = 'Admin' where id = '01720000-0000-0000-0000-0000000000e1' $$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'AC-PHW-040 an Executive cannot promote THEMSELVES (profiles_update_self pins role — load-bearing)');
select throws_ok(
  $$ update profiles set manager_id = '01720000-0000-0000-0000-0000000000d1'
       where id = '01720000-0000-0000-0000-0000000000e1' $$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'AC-PHW-041 an Executive cannot re-route their OWN approval line (profiles_update_self pins manager_id)');
select lives_ok(
  $$ update profiles set title = 'VP Delivery' where id = '01720000-0000-0000-0000-0000000000e1' $$,
  'AC-PHW-042 an Executive CAN still edit their own non-pinned fields (no over-block)');

reset role;
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000e1'),
  'Executive', 'AC-PHW-043 the Executive is still an Executive');
select is((select title from profiles where id = '01720000-0000-0000-0000-0000000000e1'),
  'VP Delivery', 'AC-PHW-044 the Executive''s own legitimate self-edit persisted');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ROW 1 — the Admin, including the ONE carve-out (a peer Admin) and the ONE bar (themselves).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ update profiles set role = 'Executive' where id = '01720000-0000-0000-0000-0000000000c1' $$,
  'AC-PHW-050 an Admin may assign the Executive role (rank, no special case)');
select lives_ok(
  $$ update profiles set manager_id = '01720000-0000-0000-0000-0000000000a1'
       where id = '01720000-0000-0000-0000-0000000000d1' $$,
  'AC-PHW-051 an Admin may assign any subordinate''s supervisor (unchanged authority)');

-- THE CARVE-OUT. Admin does not OUTRANK Admin, so without it nobody could ever edit an Admin's
-- profile and an Admin could never be demoted in-app. It is deliberately NOT generalised to
-- "equal rank may edit equal rank" — that would re-open AC-PHW-003 and AC-PHW-023.
select lives_ok(
  $$ update profiles set manager_id = '01720000-0000-0000-0000-0000000000a1'
       where id = '01720000-0000-0000-0000-0000000000a2' $$,
  'AC-PHW-052 an Admin may edit a PEER Admin''s profile while leaving them an Admin (USING + WITH CHECK carve-out)');
select lives_ok(
  $$ update profiles set role = 'Finance' where id = '01720000-0000-0000-0000-0000000000a2' $$,
  'AC-PHW-053 an Admin may DEMOTE a peer Admin — the reason the carve-out exists');

-- NEVER THEMSELVES. ⚑ This is a NARROWING of the pre-0179 behaviour: profiles_admin_write was FOR ALL
-- and matched the Admin's OWN row, so an Admin could change their own role and their own manager_id
-- (probed live at 0178: `update profiles set role='Engineer' where id=<self>` -> UPDATE 1). The owner
-- ruled it out; profiles_update_self's pin is what refuses it now, for the Admin exactly as for
-- everyone else.
-- ⚑ manager_id FIRST, role SECOND, deliberately: a mutation that opens the self-edit lets the role
--   change land, and an Admin who has just demoted THEMSELVES no longer satisfies any later Admin
--   assertion — so a role-first ordering would collapse the two into one signal.
select throws_ok(
  $$ update profiles set manager_id = '01720000-0000-0000-0000-0000000000e1'
       where id = '01720000-0000-0000-0000-0000000000a1' $$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'AC-PHW-061 an Admin cannot set their OWN manager_id (never themselves)');
select throws_ok(
  $$ update profiles set role = 'Engineer' where id = '01720000-0000-0000-0000-0000000000a1' $$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'AC-PHW-060 an Admin cannot change their OWN role (never themselves)');
select lives_ok(
  $$ update profiles set title = 'Head of Ops' where id = '01720000-0000-0000-0000-0000000000a1' $$,
  'AC-PHW-062 an Admin CAN still edit their own non-pinned fields (no over-block)');

reset role;
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000c1'),
  'Executive', 'AC-PHW-054 the Admin''s promotion to Executive persisted');
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000a2'),
  'Finance', 'AC-PHW-055 the peer-Admin demotion persisted');
select is((select manager_id::text from profiles where id = '01720000-0000-0000-0000-0000000000a2'),
  '01720000-0000-0000-0000-0000000000a1', 'AC-PHW-056 the peer-Admin supervisor assignment persisted');
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000a1'),
  'Admin', 'AC-PHW-063 the acting Admin''s own role is unchanged');
select ok((select manager_id is null from profiles where id = '01720000-0000-0000-0000-0000000000a1'),
  'AC-PHW-064 the acting Admin''s own manager_id is unchanged');
select is((select title from profiles where id = '01720000-0000-0000-0000-0000000000a1'),
  'Head of Ops', 'AC-PHW-065 the Admin''s legitimate self-edit persisted');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- CONTROLS THE RULING MUST NOT HAVE BROKEN.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- (a) INSERT and DELETE on profiles stay ADMIN-ONLY. The ruling is about EDITING; widening the
--     destructive and creating paths to Executives was never asked for (ADR-0019: destructive delete
--     is Admin-only). Proven in both directions.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok(
  $$ delete from profiles where id = '01720000-0000-0000-0000-0000000000d1' $$,
  'AC-PHW-070 an Executive DELETE of a subordinate profile raises nothing (0 rows — DELETE stayed Admin-only)');
select throws_ok(
  $$ insert into profiles (id, org_id, full_name, email, role)
     values ('01720000-0000-0000-0000-0000000000d2','01720000-0000-0000-0000-000000000001','PHW New Hire','phw-newhire@example.com','Engineer') $$,
  '42501', 'new row violates row-level security policy for table "profiles"',
  'AC-PHW-071 an Executive cannot INSERT a profile (INSERT stayed Admin-only)');

reset role;
select is((select count(*)::int from profiles where id = '01720000-0000-0000-0000-0000000000d1'), 1,
  'AC-PHW-072 the Engineer profile still exists — the Executive DELETE affected 0 rows');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into profiles (id, org_id, full_name, email, role)
     values ('01720000-0000-0000-0000-0000000000d2','01720000-0000-0000-0000-000000000001','PHW New Hire','phw-newhire@example.com','Engineer') $$,
  'AC-PHW-073 an Admin can still INSERT a profile (authority preserved)');
select lives_ok(
  $$ delete from profiles where id = '01720000-0000-0000-0000-0000000000d1' $$,
  'AC-PHW-074 an Admin can still DELETE a profile (authority preserved)');
reset role;
select is((select count(*)::int from profiles where id = '01720000-0000-0000-0000-0000000000d2'), 1,
  'AC-PHW-075 the Admin INSERT really created the row');
select is((select count(*)::int from profiles where id = '01720000-0000-0000-0000-0000000000d1'), 0,
  'AC-PHW-076 the Admin DELETE really removed the row');

-- (b) A DISABLED actor administers nobody, whatever their rank (is_active_member(), 0063 sweep).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000a9","role":"authenticated"}';
select lives_ok(
  $$ update profiles set role = 'Admin' where id = '01720000-0000-0000-0000-0000000000c1' $$,
  'AC-PHW-080 a DISABLED Admin edits nobody (0 rows — is_active_member() survives the rewrite)');
reset role;
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000c1'),
  'Executive', 'AC-PHW-081 the disabled Admin''s attempt changed nothing');

-- (c) Cross-org: rank does not cross a tenant boundary.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$ update profiles set role = 'Engineer' where id = '01720000-0000-0000-0000-0000000000f1' $$,
  'AC-PHW-090 an org-B Executive cannot edit an org-A Finance user (org gate -> 0 rows)');
reset role;
select is((select role::text from profiles where id = '01720000-0000-0000-0000-0000000000f1'),
  'Finance', 'AC-PHW-091 the org-A Finance user is untouched by the org-B Executive');

-- (d) OFFBOARDING IS UNAFFECTED. admin_set_user_status is a SECURITY DEFINER RPC that bypasses RLS
--     entirely, so none of the above can have changed it — asserted rather than assumed, and its
--     self-disable refusal is re-proven because "never themselves" is now a rule in two places.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01720000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select admin_set_user_status('01720000-0000-0000-0000-0000000000c1','disabled','01720000-0000-0000-0000-000000000001') $$,
  'AC-PHW-100 admin_set_user_status still disables another member (offboarding unaffected)');
select throws_ok(
  $$ select admin_set_user_status('01720000-0000-0000-0000-0000000000a1','disabled','01720000-0000-0000-0000-000000000001') $$,
  'P0001', 'cannot disable yourself',
  'AC-PHW-101 admin_set_user_status still refuses self-disable');
reset role;
select is((select status::text from profiles where id = '01720000-0000-0000-0000-0000000000c1'),
  'disabled', 'AC-PHW-102 the offboarding really landed');

select * from finish();
rollback;
