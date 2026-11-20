-- 0906_org_name_race.test.sql — two concurrent creates with the same name (#2264, ADR-0101).
--
-- AC id owned here (minted for #2264):
--   AC-ORG-029  when two creates of organizations whose names share one name key run at the same
--               time, the second one is refused with the plain `org_name_taken` error (23505), not
--               a raw unique-violation message, through operator_create_org_with_setup (the call the
--               operator-org function makes), and it leaves no Admin profile behind.
--
-- Two real sessions over dblink, because the race only exists between committed transactions:
--   session `first`  creates an organization and holds its transaction open;
--   session `second` runs operator_create_org_with_setup as a live Operator with the same name in
--                    another case and spacing. Its name check cannot see the uncommitted row, so it
--                    reaches the insert and waits on the unique index;
--   `first` commits, and `second` is refused by the index, which operator_create_org renames.
-- The test asserts `second` really was waiting on a lock before `first` committed, so it proves the
-- index path and not the earlier name check.
-- Committed fixtures use the 09061000- id prefix and are removed at the end.
--
-- MUTATION-CHECKED: removing operator_create_org's unique_violation handler (re-raising the raw
-- error) turns the AC-ORG-029 message assertion red with "duplicate key value violates unique constraint".
begin;
select plan(5);
create extension if not exists dblink with schema extensions;

select dblink_connect('org_race_setup', format('dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_connect('org_race_first', format('dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_connect('org_race_second', format('dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));

select dblink_exec('org_race_setup', $setup$
insert into organizations (id, name) values ('09061000-0000-0000-0000-000000000001', 'AC-RACE Home Org');
insert into auth.users (id, email) values
  ('09061000-0000-0000-0000-0000000000a1', 'ac-race-operator@example.com'),
  ('09061000-0000-0000-0000-0000000000b1', 'ac-race-new-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09061000-0000-0000-0000-0000000000a1', '09061000-0000-0000-0000-000000000001', 'Op',
   'ac-race-operator@example.com', 'Admin', 'active');
insert into platform_operators (user_id) values ('09061000-0000-0000-0000-0000000000a1');
$setup$);

-- `first` creates the organization and keeps its transaction open.
select dblink_exec('org_race_first', $q$begin;
  insert into organizations (id, name) values ('09061000-0000-0000-0000-000000000002', 'AC-RACE Twin Works')$q$);

-- `second` runs the Operator's create with the same name in another case and spacing.
create temp table org_race_second_pid as
  select pid from dblink('org_race_second', 'select pg_backend_pid()') as t(pid int);
select dblink_exec('org_race_second', $q$begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"09061000-0000-0000-0000-0000000000a1","role":"authenticated"}'$q$);
select dblink_send_query('org_race_second', $q$
  select public.operator_create_org_with_setup(' ac-race  TWIN works', '09061000-0000-0000-0000-0000000000b1',
    'New Admin', 'IDR', 'id', null, 'Asia/Jakarta', 'standard', '[]'::jsonb, null)::text$q$);

-- Wait (up to 10 s) until `second` is blocked on a lock: it passed the name check and reached the index.
do $$
declare i int := 0;
begin
  while i < 200 and not exists (
    select 1 from pg_stat_activity
     where pid = (select pid from org_race_second_pid) and wait_event_type = 'Lock') loop
    perform pg_sleep(0.05);
    i := i + 1;
  end loop;
end $$;
select ok(exists (select 1 from pg_stat_activity
                   where pid = (select pid from org_race_second_pid) and wait_event_type = 'Lock'),
  'AC-ORG-029 the second create passed the name check and waits on the first create''s row');

select dblink_exec('org_race_first', 'commit');

create temp table org_race_result as
  select * from dblink_get_result('org_race_second', false) as t(result text);
create temp table org_race_error as select dblink_error_message('org_race_second') as message;
-- Drain the end-of-results marker so the connection is free again.
select count(*) from dblink_get_result('org_race_second', false) as t(result text);

select is((select count(*)::int from org_race_result), 0,
  'AC-ORG-029 the second create returns no organization');
select matches((select message from org_race_error), 'org_name_taken',
  'AC-ORG-029 the second create is refused as org_name_taken');
select doesnt_match((select message from org_race_error), 'duplicate key',
  'AC-ORG-029 the refusal is not the raw unique-violation message');

select dblink_exec('org_race_second', 'rollback');

select is((select n::int from dblink('org_race_setup',
  $q$select count(*) from profiles where id = '09061000-0000-0000-0000-0000000000b1'$q$) as t(n bigint)), 0,
  'AC-ORG-029 the refused create leaves no Admin profile behind');

select dblink_exec('org_race_setup', $cleanup$
delete from platform_operators where user_id = '09061000-0000-0000-0000-0000000000a1';
delete from profiles where id in ('09061000-0000-0000-0000-0000000000a1', '09061000-0000-0000-0000-0000000000b1');
delete from auth.users where id in ('09061000-0000-0000-0000-0000000000a1', '09061000-0000-0000-0000-0000000000b1');
delete from organizations where id in ('09061000-0000-0000-0000-000000000001', '09061000-0000-0000-0000-000000000002');
$cleanup$);
select dblink_disconnect('org_race_first');
select dblink_disconnect('org_race_second');
select dblink_disconnect('org_race_setup');

select * from finish();
rollback;
