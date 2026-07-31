-- 0177_profiles_email_allowlist_narrow.test.sql — 0184 narrows the profiles UPDATE allow-list to
-- seven columns; email (the identity key) and three dead grants become non-client-writable.
-- Migration under test: supabase/migrations/0184_profiles_email_and_dead_grants_narrow.sql
--
-- THE DEFECT (0182 enumerated 0075's table-wide grant; email stayed in the list). profiles_update_self
-- (0007/0021) pins only org_id/role/manager_id, so ANY user could rewrite their OWN profiles.email
-- via `PATCH /rest/v1/profiles?id=eq.<self>`. profiles.email is an IDENTITY KEY in three live places:
--   • org_has_member_email() (0065) — the invite-duplicate gate (lower(pr.email) = lower(p_email)).
--   • erpnextFeedDeps.ts — the ERP Employee -> profile 'work-email-exact-match' link proposal.
--   • clickup-onboard/index.ts — joins profiles.email to ClickUp List members.
-- Squatting a colleague's email would poison all three. 0184 removes email (and the dead grants
-- company_id, utilization, updated_at) from the client allow-list.
--
-- ⚑ SAME TRAP, SAME SHAPE AS 0175/0182. A column-level `revoke update (email)` is a SILENT NO-OP
--   against a table-level grant; only revoke-table-wide-then-re-grant-the-list holds. The oracle is
--   has_column_privilege (authoritative) PLUS a behavioural refusal (the real vector) PLUS persisted
--   read-backs (never errcode alone).
--
-- ⚑ THIS RULING IS SPECIFICALLY ABOUT NOT OVER-BLOCKING. The owner kept self-edit of the five
--   non-app fields, so the positive controls (full_name self-edit, adminUsers.ts:51/:61, and
--   admin_set_user_status both directions) are MANDATORY — without them a migration that simply
--   revoked all eleven would pass the deny half.

begin;
create extension if not exists pgtap;
select plan(15);

-- ── Fixtures (inserted as table owner, RLS bypassed) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('01770000-0000-0000-0000-000000000001','PAN Org');

insert into auth.users (id, email) values
  ('01770000-0000-0000-0000-0000000000a1','pan-admin@example.com'),
  ('01770000-0000-0000-0000-0000000000c1','pan-pm@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01770000-0000-0000-0000-0000000000a1','01770000-0000-0000-0000-000000000001','PAN Admin','pan-admin@example.com','Admin','active'),
  ('01770000-0000-0000-0000-0000000000c1','01770000-0000-0000-0000-000000000001','PAN PM','pan-pm@example.com','Project Manager','active');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §A — THE COLUMN-PRIVILEGE ORACLE. Two completeness sweeps (string_agg over a VALUES set, like
-- 0173's RPC sweep), NOT eight separate ok()s: a single is() NAMES any column that drifts in either
-- direction. Expected empty in both — a future re-grant of a withheld column OR an over-revoke of a
-- kept one fails loudly and identifies the column.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select coalesce(string_agg(c, ', ' order by c), '')
     from (values ('email'),('company_id'),('utilization'),('updated_at'),
                  ('status'),('org_id'),('id'),('created_at')) v(c)
    where has_column_privilege('authenticated','public.profiles',c,'UPDATE')),
  '',
  'AC-PAN-001 NO withheld column is UPDATE-able by authenticated — email/company_id/utilization/updated_at (revoked by 0184) plus status/org_id/id/created_at (still ungranted per 0182). A non-empty list names exactly what re-leaked');

select is(
  (select coalesce(string_agg(c, ', ' order by c), '')
     from (values ('full_name'),('avatar_url'),('title'),('location'),('skills'),('role'),('manager_id')) v(c)
    where not has_column_privilege('authenticated','public.profiles',c,'UPDATE')),
  '',
  'AC-PAN-002 ALL seven allow-list columns ARE UPDATE-able — a non-empty list names exactly what an over-revoke dropped');

select is(has_table_privilege('authenticated','public.profiles','UPDATE'), false,
  'AC-PAN-003 has_table_privilege(profiles, UPDATE) is FALSE — there is no table-wide grant (a column revoke could not have achieved this, which is the whole point of the revoke-then-re-grant shape)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §B — THE REAL VECTOR, BEHAVIOURAL. A plain authenticated user attempting to rewrite their OWN
-- profiles.email is REFUSED at rewrite time (42501, before RLS is ever reached) and the email is
-- UNCHANGED on read-back. ⚑ The attempted value DIFFERS from the fixture's email or the oracle is
-- vacuous — 'pan-squatter@example.com' ≠ 'pan-pm@example.com'.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01770000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set email = 'pan-squatter@example.com' where id = auth.uid() $$,
  '42501', 'permission denied for table profiles',
  'AC-PAN-010 a user CANNOT rewrite their OWN profiles.email — the column grant refuses it before RLS is ever reached (at 0182 this was UPDATE 1, the squat vector)');
reset role;
select is((select email from public.profiles where id = '01770000-0000-0000-0000-0000000000c1'),
  'pan-pm@example.com',
  'AC-PAN-011 the PM''s email is UNCHANGED — the squat did not land (pan-pm@example.com ≠ pan-squatter@example.com, so the oracle is not vacuous)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §C — POSITIVE CONTROLS (mandatory — this ruling is specifically about NOT over-blocking).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- (1) The SAME user CAN still self-edit a kept field. full_name is in the allow-list and
--     profiles_update_self does not pin it (0172 AC-PHW-042 / 0004 HIGH-1 intact).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01770000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok(
  $$ update public.profiles set full_name = 'PAN PM Renamed' where id = auth.uid() $$,
  'AC-PAN-020 the same user CAN still self-edit full_name (no over-block — self-edit of non-pinned fields is intended behaviour)');
reset role;
select is((select full_name from public.profiles where id = '01770000-0000-0000-0000-0000000000c1'),
  'PAN PM Renamed',
  'AC-PAN-021 the self-edit of full_name PERSISTED (not a silent column/RLS no-op)');

-- (2) The EXACT client writes from adminUsers.ts STILL WORK for an Admin.
--       adminUsers.ts:51  ->  supabase.from('profiles').update({ role }).eq('id', id)
--       adminUsers.ts:61  ->  supabase.from('profiles').update({ manager_id }).eq('id', id)
set local role authenticated;
set local request.jwt.claims = '{"sub":"01770000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update public.profiles set role = 'Engineer' where id = '01770000-0000-0000-0000-0000000000c1' $$,
  'AC-PAN-030 adminUsers.ts:51 — an Admin''s update({ role }) STILL WORKS (role is in the allow-list; profiles_admin_write RLS still governs)');
select lives_ok(
  $$ update public.profiles set manager_id = '01770000-0000-0000-0000-0000000000a1'
       where id = '01770000-0000-0000-0000-0000000000c1' $$,
  'AC-PAN-032 adminUsers.ts:61 — an Admin''s update({ manager_id }) STILL WORKS (manager_id is in the allow-list)');
reset role;
select is((select role::text from public.profiles where id = '01770000-0000-0000-0000-0000000000c1'),
  'Engineer',
  'AC-PAN-031 the role change PERSISTED (not a silent column/RLS no-op)');
select is((select manager_id::text from public.profiles where id = '01770000-0000-0000-0000-0000000000c1'),
  '01770000-0000-0000-0000-0000000000a1',
  'AC-PAN-033 the manager assignment PERSISTED');

-- (3) admin_set_user_status STILL WORKS in BOTH directions. It is SECURITY DEFINER (runs as its
--     owner), so column grants do not bind it — the sanctioned offboarding path is untouched, and
--     is asserted rather than assumed.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01770000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select admin_set_user_status('01770000-0000-0000-0000-0000000000c1','disabled','01770000-0000-0000-0000-000000000001') $$,
  'AC-PAN-040 an Admin CAN disable a member via admin_set_user_status (the SECURITY DEFINER RPC is unaffected by the column allow-list)');
reset role;
select is((select status::text from public.profiles where id = '01770000-0000-0000-0000-0000000000c1'),
  'disabled',
  'AC-PAN-041 the offboarding really landed — status is disabled');
set local role authenticated;
set local request.jwt.claims = '{"sub":"01770000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select admin_set_user_status('01770000-0000-0000-0000-0000000000c1','active','01770000-0000-0000-0000-000000000001') $$,
  'AC-PAN-042 …and an Admin CAN re-activate the same member (both directions — offboarding is fully reversible through the sanctioned RPC)');
reset role;
select is((select status::text from public.profiles where id = '01770000-0000-0000-0000-0000000000c1'),
  'active',
  'AC-PAN-043 the member is active again — admin_set_user_status round-trips both ways');

select * from finish();
rollback;
