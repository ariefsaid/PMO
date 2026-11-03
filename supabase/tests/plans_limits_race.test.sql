-- AC-PLN-009 / AC-PLN-010 [pgTAP] — simultaneous writers consume the final seat/project slot once.
-- The fixture rows are committed through dblink so each writer sees the same starting state.
create extension if not exists dblink;

select dblink_connect('s5_setup', format(
  'dbname=%s user=%s password=postgres host=%s port=%s application_name=s5_limits_setup',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_exec('s5_setup', 'set lock_timeout = ''2s''');
select dblink_exec('s5_setup', 'set statement_timeout = ''5s''');

-- Idempotent cleanup also heals a fixture left by an interrupted earlier run.
select dblink_exec('s5_setup', $clean$
  drop function if exists public.s5_plan_limits_race_attempt(text, uuid, uuid);
  delete from public.projects where org_id in (
    '0535c000-0000-0000-0000-000000000001', '0535c000-0000-0000-0000-000000000002');
  delete from public.profiles where org_id in (
    '0535c000-0000-0000-0000-000000000001', '0535c000-0000-0000-0000-000000000002');
  delete from public.organizations where id in (
    '0535c000-0000-0000-0000-000000000001', '0535c000-0000-0000-0000-000000000002');
  delete from auth.users where id between '0535c000-0000-0000-0000-000000000101'
                                       and '0535c000-0000-0000-0000-00000000010d';
$clean$);

select dblink_exec('s5_setup', $fixtures$
  insert into public.organizations (id, name) values
    ('0535c000-0000-0000-0000-000000000001', 'S5 Seat Race'),
    ('0535c000-0000-0000-0000-000000000002', 'S5 Project Race');
  insert into auth.users (id, email)
    select ('0535c000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid,
           's5-race-' || g || '@example.invalid'
      from generate_series(257, 269) g;
  insert into public.profiles (id, org_id, full_name, email, role, status)
    select ('0535c000-0000-0000-0000-' || lpad(to_hex(257 + g), 12, '0'))::uuid,
           '0535c000-0000-0000-0000-000000000001', 'Seat member ' || g,
           's5-race-' || (257 + g) || '@example.invalid', 'Finance', 'active'
      from generate_series(1, 9) g;
  insert into public.projects (id, org_id, name, status)
    select ('0535c000-0000-0000-0000-' || lpad(to_hex(400 + g), 12, '0'))::uuid,
           '0535c000-0000-0000-0000-000000000002', 'Project ' || g, 'Ongoing Project'
      from generate_series(1, 24) g;
  insert into public.org_plans (org_id, plan_id) values
    ('0535c000-0000-0000-0000-000000000001', 'starter'),
    ('0535c000-0000-0000-0000-000000000002', 'starter');
$fixtures$);

select dblink_exec('s5_setup', $helper$
  create function public.s5_plan_limits_race_attempt(p_kind text, p_id uuid, p_org_id uuid)
  returns text language plpgsql set search_path = public as $$
  begin
    if p_kind = 'seat' then
      insert into public.profiles (id, org_id, full_name, email, role, status)
      values (p_id, p_org_id, 'Seat contender', p_id::text || '@example.invalid', 'Finance', 'active');
      return 'success';
    elsif p_kind = 'project' then
      insert into public.projects (id, org_id, name, status)
      values (p_id, p_org_id, 'Project contender', 'Ongoing Project');
      return 'success';
    end if;
    raise exception 'unknown race kind';
  exception
    when sqlstate 'PL001' then return 'PL001';
    when sqlstate 'PL002' then return 'PL002';
  end
  $$;
  revoke all on function public.s5_plan_limits_race_attempt(text, uuid, uuid)
    from public, anon, authenticated, service_role;
$helper$);

select dblink_connect('s5_keeper', format(
  'dbname=%s user=%s password=postgres host=%s port=%s application_name=s5_limits_keeper',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_connect('s5_writer_a', format(
  'dbname=%s user=%s password=postgres host=%s port=%s application_name=s5_limits_writer_a',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_connect('s5_writer_b', format(
  'dbname=%s user=%s password=postgres host=%s port=%s application_name=s5_limits_writer_b',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));

-- Every dblink session has bounded lock and statement waits.
select dblink_exec('s5_keeper', 'set lock_timeout = ''2s''');
select dblink_exec('s5_keeper', 'set statement_timeout = ''5s''');
select dblink_exec('s5_writer_a', 'set lock_timeout = ''2s''');
select dblink_exec('s5_writer_a', 'set statement_timeout = ''5s''');
select dblink_exec('s5_writer_b', 'set lock_timeout = ''2s''');
select dblink_exec('s5_writer_b', 'set statement_timeout = ''5s''');

begin;
create extension if not exists pgtap;
select plan(8);

create function pg_temp.s5_wait_for_two_writers(p_app_a text, p_app_b text)
returns boolean language plpgsql as $$
declare
  v_deadline timestamptz := clock_timestamp() + interval '1 second';
begin
  loop
    if (select count(*) = 2 from pg_stat_activity
         where application_name in (p_app_a, p_app_b) and wait_event_type = 'Lock') then
      return true;
    end if;
    if clock_timestamp() >= v_deadline then
      return false;
    end if;
    perform pg_sleep(0.01);
  end loop;
end
$$;

-- Hold the organization lock before starting both writers. This makes both calls contend at the
-- same gate; their independent transactions then prove the final-slot result after release.
select dblink_exec('s5_keeper', 'begin');
select is(
  (select count(*)::int from dblink('s5_keeper', $q$
    select id from public.organizations
     where id = '0535c000-0000-0000-0000-000000000001' for update$q$) as t(id uuid)),
  1,
  'AC-PLN-009 setup: the seat organization lock is held by a separate session');
select dblink_send_query('s5_writer_a', $q$
  select public.s5_plan_limits_race_attempt('seat', '0535c000-0000-0000-0000-00000000010c',
    '0535c000-0000-0000-0000-000000000001')$q$);
select dblink_send_query('s5_writer_b', $q$
  select public.s5_plan_limits_race_attempt('seat', '0535c000-0000-0000-0000-00000000010d',
    '0535c000-0000-0000-0000-000000000001')$q$);
select ok(pg_temp.s5_wait_for_two_writers('s5_limits_writer_a', 's5_limits_writer_b'),
  'AC-PLN-009 both seat writers reach the locked organization concurrently');
select dblink_exec('s5_keeper', 'commit');
select is(
  (select array_agg(outcome order by outcome) from (
     select outcome from dblink_get_result('s5_writer_a') as t(outcome text)
     union all
     select outcome from dblink_get_result('s5_writer_b') as t(outcome text)
   ) outcomes),
  array['PL001', 'success']::text[],
  'AC-PLN-009 two writers starting with one seat left produce one success and one PL001');
select count(*) from dblink_get_result('s5_writer_a') as t(outcome text);
select count(*) from dblink_get_result('s5_writer_b') as t(outcome text);
select is(
  (select count(*)::int from public.profiles
    where org_id = '0535c000-0000-0000-0000-000000000001' and status = 'active'),
  10,
  'AC-PLN-009 exactly the final seat is consumed');

select dblink_exec('s5_keeper', 'begin');
select is(
  (select count(*)::int from dblink('s5_keeper', $q$
    select id from public.organizations
     where id = '0535c000-0000-0000-0000-000000000002' for update$q$) as t(id uuid)),
  1,
  'AC-PLN-010 setup: the project organization lock is held by a separate session');
select dblink_send_query('s5_writer_a', $q$
  select public.s5_plan_limits_race_attempt('project', '0535c000-0000-0000-0000-00000000010c',
    '0535c000-0000-0000-0000-000000000002')$q$);
select dblink_send_query('s5_writer_b', $q$
  select public.s5_plan_limits_race_attempt('project', '0535c000-0000-0000-0000-00000000010d',
    '0535c000-0000-0000-0000-000000000002')$q$);
select ok(pg_temp.s5_wait_for_two_writers('s5_limits_writer_a', 's5_limits_writer_b'),
  'AC-PLN-010 both project writers reach the locked organization concurrently');
select dblink_exec('s5_keeper', 'commit');
select is(
  (select array_agg(outcome order by outcome) from (
     select outcome from dblink_get_result('s5_writer_a') as t(outcome text)
     union all
     select outcome from dblink_get_result('s5_writer_b') as t(outcome text)
   ) outcomes),
  array['PL002', 'success']::text[],
  'AC-PLN-010 two creators starting with one project slot left produce one success and one PL002');
select count(*) from dblink_get_result('s5_writer_a') as t(outcome text);
select count(*) from dblink_get_result('s5_writer_b') as t(outcome text);
select is(
  (select count(*)::int from public.projects
    where org_id = '0535c000-0000-0000-0000-000000000002'
      and public.project_counts_toward_limit(status, archived_at)),
  25,
  'AC-PLN-010 exactly the final project slot is consumed');

select * from finish();
rollback;

select dblink_disconnect('s5_writer_b');
select dblink_disconnect('s5_writer_a');
select dblink_disconnect('s5_keeper');
select dblink_exec('s5_setup', $clean$
  drop function if exists public.s5_plan_limits_race_attempt(text, uuid, uuid);
  delete from public.projects where org_id in (
    '0535c000-0000-0000-0000-000000000001', '0535c000-0000-0000-0000-000000000002');
  delete from public.profiles where org_id in (
    '0535c000-0000-0000-0000-000000000001', '0535c000-0000-0000-0000-000000000002');
  delete from public.organizations where id in (
    '0535c000-0000-0000-0000-000000000001', '0535c000-0000-0000-0000-000000000002');
  delete from auth.users where id between '0535c000-0000-0000-0000-000000000101'
                                       and '0535c000-0000-0000-0000-00000000010d';
$clean$);
select dblink_disconnect('s5_setup');
drop extension if exists dblink;
