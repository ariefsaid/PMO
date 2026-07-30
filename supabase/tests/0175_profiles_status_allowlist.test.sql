-- 0175_profiles_status_allowlist.test.sql — profiles.status is ADMIN-ONLY, proven at every layer.
-- Migration under test: supabase/migrations/0182_profiles_status_column_allowlist.sql
--
-- THE DEFECT (reproduced live). 0075's table-wide `grant update on public.profiles to authenticated`
-- left every unnamed column in scope, so every RLS policy on profiles was ROW-scoped only. An
-- Executive could `update profiles set status='disabled'` on any subordinate (UPDATE 1), and ANY
-- user could disable THEMSELVES via profiles_update_self (which pins org_id/role/manager_id but NOT
-- status) — which also fires the irreversible m365_offboard_trigger cascade (0114). admin_set_user_status
-- refuses a self-disable; the RLS path did not.
--
-- 0182 revokes the table-wide UPDATE and re-grants an explicit column allow-list, so id, org_id,
-- created_at and status become non-writable by any client role. (⚑ A column-level revoke is a silent
-- no-op against a table-level grant — only revoke-table-wide-then-re-grant-the-list works; the
-- migration does exactly that, and has_column_privilege is the oracle.)
--
-- TWO denial shapes meet here, and the difference is the point:
--   • a COLUMN-PRIVILEGE denial raises 42501 at parse/rewrite time, BEFORE RLS is evaluated — so it
--     fires regardless of whether any RLS policy would have matched. Asserted with throws_ok AND a
--     persisted-state read-back (the value unchanged), never by errcode alone.
--   • admin_set_user_status is SECURITY DEFINER (runs as its owner): column grants do not bind a
--     definer, so offboarding is UNAFFECTED — asserted rather than assumed.

begin;
create extension if not exists pgtap;
select plan(22);

-- ── Fixtures (inserted as table owner, RLS bypassed) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('01750000-0000-0000-0000-000000000001','PSA Org');

insert into auth.users (id, email) values
  ('01750000-0000-0000-0000-0000000000a1','psa-exec@example.com'),
  ('01750000-0000-0000-0000-0000000000a2','psa-finance@example.com'),
  ('01750000-0000-0000-0000-0000000000a3','psa-pm@example.com'),
  ('01750000-0000-0000-0000-0000000000a4','psa-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01750000-0000-0000-0000-0000000000a1','01750000-0000-0000-0000-000000000001','PSA Exec','psa-exec@example.com','Executive','active'),
  ('01750000-0000-0000-0000-0000000000a2','01750000-0000-0000-0000-000000000001','PSA Finance','psa-finance@example.com','Finance','active'),
  ('01750000-0000-0000-0000-0000000000a3','01750000-0000-0000-0000-000000000001','PSA PM','psa-pm@example.com','Project Manager','active'),
  ('01750000-0000-0000-0000-0000000000a4','01750000-0000-0000-0000-000000000001','PSA Admin','psa-admin@example.com','Admin','active');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §A — status is non-writable. Before 0182 both of these were UPDATE 1 (the Executive disabled a
-- subordinate; any user disabled themselves — and the self-disable fired m365 offboarding).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set status = 'disabled' where id = '01750000-0000-0000-0000-0000000000a2' $$,
  '42501', 'permission denied for table profiles',
  'AC-PSA-001 an Executive CANNOT disable a Finance subordinate — the column grant refuses status before RLS is ever reached (at 0075 this was UPDATE 1)');

reset role;
select is((select status::text from public.profiles where id = '01750000-0000-0000-0000-0000000000a2'),
  'active',
  'AC-PSA-002 an Executive CANNOT disable a Finance subordinate — status is still active (the column grant refused the write before RLS was ever reached)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01750000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set status = 'disabled' where id = '01750000-0000-0000-0000-0000000000a3' $$,
  '42501', 'permission denied for table profiles',
  'AC-PSA-003 a user CANNOT disable THEMSELVES via profiles_update_self — status is not in the allow-list (the m365 offboard cascade is no longer self-serve)');
reset role;
select is((select status::text from public.profiles where id = '01750000-0000-0000-0000-0000000000a3'),
  'active',
  'AC-PSA-004 the PM is still active — the self-disable changed nothing');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §B — admin_set_user_status STILL WORKS (both directions). It is SECURITY DEFINER, so the column
-- allow-list does not bind it. This is the sanctioned offboarding path and it must be untouched.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01750000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ select admin_set_user_status('01750000-0000-0000-0000-0000000000a2','disabled','01750000-0000-0000-0000-000000000001') $$,
  'AC-PSA-010 an Admin CAN disable a member via admin_set_user_status (the SECURITY DEFINER RPC is unaffected by the column allow-list)');
reset role;
select is((select status::text from public.profiles where id = '01750000-0000-0000-0000-0000000000a2'),
  'disabled',
  'AC-PSA-011 the offboarding really landed — status is disabled');
set local role authenticated;
set local request.jwt.claims = '{"sub":"01750000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ select admin_set_user_status('01750000-0000-0000-0000-0000000000a2','active','01750000-0000-0000-0000-000000000001') $$,
  'AC-PSA-012 …and an Admin CAN re-activate the same member (both directions — offboarding is fully reversible through the sanctioned RPC)');
reset role;
select is((select status::text from public.profiles where id = '01750000-0000-0000-0000-0000000000a2'),
  'active',
  'AC-PSA-013 the member is active again — admin_set_user_status round-trips both ways');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §C — the exact client writes from adminUsers.ts STILL WORK for an Admin. These are the ONLY
-- client-side profile UPDATEs in the tree (lines 51 and 61) and both columns are in the allow-list.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01750000-0000-0000-0000-0000000000a4","role":"authenticated"}';
-- adminUsers.ts:51  ->  supabase.from('profiles').update({ role }).eq('id', id)
select lives_ok(
  $$ update public.profiles set role = 'Engineer' where id = '01750000-0000-0000-0000-0000000000a2' $$,
  'AC-PSA-020 adminUsers.ts:51 — an Admin''s update({ role }) STILL WORKS (role is in the allow-list; profiles_admin_write RLS still governs)');
-- adminUsers.ts:61  ->  supabase.from('profiles').update({ manager_id }).eq('id', id)
select lives_ok(
  $$ update public.profiles set manager_id = '01750000-0000-0000-0000-0000000000a4'
       where id = '01750000-0000-0000-0000-0000000000a2' $$,
  'AC-PSA-022 adminUsers.ts:61 — an Admin''s update({ manager_id }) STILL WORKS (manager_id is in the allow-list)');
reset role;
select is((select role::text from public.profiles where id = '01750000-0000-0000-0000-0000000000a2'),
  'Engineer',
  'AC-PSA-021 the role change PERSISTED (not a silent RLS/column no-op)');
select is((select manager_id::text from public.profiles where id = '01750000-0000-0000-0000-0000000000a2'),
  '01750000-0000-0000-0000-0000000000a4',
  'AC-PSA-023 the manager assignment PERSISTED');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §D — the column-privilege oracle. has_column_privilege is the authoritative check: it is FALSE
-- for the four withheld columns and TRUE for the allow-list. (A column-level revoke on a table-wide
-- grant would have left all of these TRUE — that is the trap 0182 avoids by revoke-then-re-grant.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(has_column_privilege('authenticated','public.profiles','status','UPDATE'), false,
  'AC-PSA-030 has_column_privilege(status, UPDATE) is FALSE — status is withheld from every client role');
select is(has_column_privilege('authenticated','public.profiles','org_id','UPDATE'), false,
  'AC-PSA-031 has_column_privilege(org_id, UPDATE) is FALSE — org_id is withheld (the tenant seam is not client-writable)');
select is(has_column_privilege('authenticated','public.profiles','id','UPDATE'), false,
  'AC-PSA-032 has_column_privilege(id, UPDATE) is FALSE — the PK is withheld');
select is(has_column_privilege('authenticated','public.profiles','created_at','UPDATE'), false,
  'AC-PSA-033 has_column_privilege(created_at, UPDATE) is FALSE — the creation witness is withheld');
select is(has_column_privilege('authenticated','public.profiles','role','UPDATE'), true,
  'AC-PSA-034 has_column_privilege(role, UPDATE) is TRUE — role is in the allow-list (adminUsers.ts:51)');
select is(has_column_privilege('authenticated','public.profiles','manager_id','UPDATE'), true,
  'AC-PSA-035 has_column_privilege(manager_id, UPDATE) is TRUE — manager_id is in the allow-list (adminUsers.ts:61)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §E — org_id is likewise non-writable. Same shape as status: the column grant refuses the write
-- before RLS, so neither a self-edit nor an Executive edit can re-point a profile's tenant.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01750000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set org_id = '01750000-0000-0000-0000-000000000099'
       where id = '01750000-0000-0000-0000-0000000000a3' $$,
  '42501', 'permission denied for table profiles',
  'AC-PSA-040 a user CANNOT re-point their OWN org_id — the tenant seam is withheld from the client');
reset role;
select is((select org_id::text from public.profiles where id = '01750000-0000-0000-0000-0000000000a3'),
  '01750000-0000-0000-0000-000000000001',
  'AC-PSA-041 the PM''s org_id is unchanged');
set local role authenticated;
set local request.jwt.claims = '{"sub":"01750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set org_id = '01750000-0000-0000-0000-000000000099'
       where id = '01750000-0000-0000-0000-0000000000a2' $$,
  '42501', 'permission denied for table profiles',
  'AC-PSA-042 an Executive CANNOT re-point a subordinate''s org_id either — org_id is withheld from every client role');
reset role;
select is((select org_id::text from public.profiles where id = '01750000-0000-0000-0000-0000000000a2'),
  '01750000-0000-0000-0000-000000000001',
  'AC-PSA-043 the Finance user''s org_id is unchanged');

select * from finish();
rollback;
