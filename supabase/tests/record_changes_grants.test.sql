-- record_changes_grants.test.sql — #719 record change history, grants and definer hygiene (spec D4).
-- AC-CHG-009: every client write path to record_changes, and any client read of record_history_config,
-- is refused at the PRIVILEGE layer (42501), not merely filtered by a policy.
-- AC-CHG-010: the function ACLs, asserted on pg_proc.proacl directly (falling back to acldefault only when
-- proacl is NULL, which itself means PUBLIC EXECUTE and fails), so the proof does not depend on the local
-- stack's default privileges, which differ from hosted Supabase's.
-- Migration under test: 0260_record_change_history.sql.
begin;
create extension if not exists pgtap;
select plan(22);

insert into organizations (id, name) values
  ('07190000-0000-0000-0000-000000000001', 'CHG Org A');
insert into auth.users (id, email) values
  ('07190000-0000-0000-0000-0000000000a1', 'chg-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07190000-0000-0000-0000-0000000000a1', '07190000-0000-0000-0000-000000000001', 'CHG Admin', 'chg-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, code, name, status) values
  ('07190000-0000-0000-0000-0000000000c1', '07190000-0000-0000-0000-000000000001', 'CHG-1', 'Alpha', 'Ongoing Project');

-- ── AC-CHG-009: authenticated (an active Admin of the row's own org — the most-privileged client) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into record_changes (org_id, entity_type, entity_id, op)
     values ('07190000-0000-0000-0000-000000000001', 'project', '07190000-0000-0000-0000-0000000000c1', 'update') $$,
  '42501', null, 'AC-CHG-009 authenticated INSERT into record_changes is privilege-denied');
select throws_ok($$ update record_changes set changes = '{}' $$,
  '42501', null, 'AC-CHG-009 authenticated UPDATE of record_changes is privilege-denied');
select throws_ok($$ delete from record_changes $$,
  '42501', null, 'AC-CHG-009 authenticated DELETE from record_changes is privilege-denied');
select throws_ok($$ truncate record_changes $$,
  '42501', null, 'AC-CHG-009 authenticated TRUNCATE of record_changes is privilege-denied');
select throws_ok($$ select * from record_history_config $$,
  '42501', null, 'AC-CHG-009 authenticated cannot read record_history_config');
select throws_ok($$ update record_history_config set omit_cols = '{}' $$,
  '42501', null, 'AC-CHG-009 authenticated cannot modify record_history_config');
select lives_ok($$ select count(*) from record_changes $$,
  'AC-CHG-009 (control) authenticated SELECT on record_changes is granted (the policy scopes it)');

-- ── AC-CHG-009: anon ────────────────────────────────────────────────────────────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ insert into record_changes (org_id, entity_type, entity_id, op)
     values ('07190000-0000-0000-0000-000000000001', 'project', '07190000-0000-0000-0000-0000000000c1', 'update') $$,
  '42501', null, 'AC-CHG-009 anon INSERT into record_changes is privilege-denied');
select throws_ok($$ update record_changes set changes = '{}' $$,
  '42501', null, 'AC-CHG-009 anon UPDATE of record_changes is privilege-denied');
select throws_ok($$ delete from record_changes $$,
  '42501', null, 'AC-CHG-009 anon DELETE from record_changes is privilege-denied');
select throws_ok($$ truncate record_changes $$,
  '42501', null, 'AC-CHG-009 anon TRUNCATE of record_changes is privilege-denied');
select throws_ok($$ select * from record_changes $$,
  '42501', null, 'AC-CHG-009 anon cannot read record_changes');
select throws_ok($$ select * from record_history_config $$,
  '42501', null, 'AC-CHG-009 anon cannot read record_history_config');
reset role;
set local request.jwt.claims = '';

-- ── AC-CHG-009: catalog form (covers roles without a session above) ─────────────────────────────
select is(
  (select string_agg(r || ':' || p, ', ' order by r, p)
     from unnest(array['anon', 'authenticated']) r,
          unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    where has_table_privilege(r, 'public.record_changes', p)
       or has_table_privilege(r, 'public.record_history_config', p)),
  null, 'AC-CHG-009 no client role holds any write-class privilege on either table (offenders named)');
select ok(not has_table_privilege('anon', 'public.record_history_config', 'SELECT')
          and not has_table_privilege('authenticated', 'public.record_history_config', 'SELECT')
          and not has_table_privilege('anon', 'public.record_changes', 'SELECT'),
  'AC-CHG-009 SELECT reaches record_changes for authenticated only, and record_history_config for no client');
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.record_changes'::regclass), 1,
  'AC-CHG-009 record_changes has exactly one policy');
select is(
  (select polcmd::text from pg_policy where polrelid = 'public.record_changes'::regclass), 'r',
  'AC-CHG-009 and that policy is SELECT');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.record_changes'::regclass),
  'AC-CHG-009 record_changes has FORCE RLS');

-- ── AC-CHG-010: function ACL, read from proacl (the hosted-default-independent oracle) ───────────
create temp view chg_fn_exec with (security_invoker = true) as
select p.proname, coalesce(grantee.rolname, 'PUBLIC') as grantee
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_roles grantee on grantee.oid = a.grantee
 where n.nspname = 'public'
   and p.proname in ('record_change_capture', 'record_history_visible', 'list_record_history')
   and a.privilege_type = 'EXECUTE';

select is(
  (select string_agg(grantee, ',' order by grantee) from chg_fn_exec where proname = 'record_change_capture'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  null, 'AC-CHG-010 no client role (nor PUBLIC) may EXECUTE record_change_capture');
select is(
  (select string_agg(grantee, ',' order by grantee) from chg_fn_exec where proname = 'record_history_visible'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  'authenticated,service_role', 'AC-CHG-010 record_history_visible: authenticated + service_role only, not anon or PUBLIC');
select is(
  (select string_agg(grantee, ',' order by grantee) from chg_fn_exec where proname = 'list_record_history'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  'authenticated,service_role', 'AC-CHG-010 list_record_history: authenticated + service_role only, not anon or PUBLIC');
select is(
  (select string_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end, ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('record_change_capture', 'record_history_visible', 'list_record_history')),
  'list_record_history:invoker,record_change_capture:definer,record_history_visible:invoker',
  'AC-CHG-010 only the trigger function is a definer; the predicate and the read API run as the caller');

select * from finish();
rollback;
