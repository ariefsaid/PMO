-- AC-007/AC-008 — source/save and save/activation share the project -> version lock order.
-- Each dblink statement commits only after the 1-second PgSleep barrier, so the second connection
-- enters its real RPC/write while the first still owns the trigger/RPC row locks. Each interleaving
-- uses its own project because row locks survive until the enclosing pgTAP transaction ends.
create temporary table whole_project_lock_dblink_extension_state as
  select exists (select 1 from pg_extension where extname = 'dblink') as preexisted;
set statement_timeout = '45s';
begin;
select plan(34);
create extension if not exists dblink;
create temporary table whole_project_lock_connect_status as
  select dblink_connect('whole_project_lock', format(
    'dbname=%s user=%s password=postgres host=%s port=%s',
    current_database(), current_user,
    coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
    coalesce(inet_server_port(), 5432)
  )) as status;
select dblink_exec('whole_project_lock', $$set statement_timeout = '30s'$$);
select dblink_exec('whole_project_lock', $setup$
  insert into organizations(id,name) values ('14760000-0000-0000-0000-000000000001','Whole-project lock test');
  insert into auth.users(id,email) values
    ('14760000-0000-0000-0000-0000000000a1','budget-lock-pm@example.invalid'),
    ('14760000-0000-0000-0000-0000000000a2','budget-lock-finance@example.invalid'),
    ('14760000-0000-0000-0000-0000000000a3','budget-lock-executive@example.invalid');
  insert into profiles(id,org_id,full_name,email,role,status) values
    ('14760000-0000-0000-0000-0000000000a1','14760000-0000-0000-0000-000000000001','Lock PM','budget-lock-pm@example.invalid','Project Manager','active'),
    ('14760000-0000-0000-0000-0000000000a2','14760000-0000-0000-0000-000000000001','Lock Finance','budget-lock-finance@example.invalid','Finance','active'),
    ('14760000-0000-0000-0000-0000000000a3','14760000-0000-0000-0000-000000000001','Lock Executive','budget-lock-executive@example.invalid','Executive','active');
  insert into projects(id,org_id,name,status,start_date,end_date) values
    ('14761111-0000-0000-0000-000000000001','14760000-0000-0000-0000-000000000001','Source-first project','Ongoing Project','2027-01-01','2027-12-31'),
    ('14761111-0000-0000-0000-000000000002','14760000-0000-0000-0000-000000000001','Save-first project','Ongoing Project','2027-01-01','2027-12-31'),
    ('14761111-0000-0000-0000-000000000003','14760000-0000-0000-0000-000000000001','Activation-boundary project','Ongoing Project','2027-01-01','2027-12-31');
  insert into budget_versions(id,org_id,project_id,version,name,status,created_by,budget_mode) values
    ('14762222-0000-0000-0000-000000000001','14760000-0000-0000-0000-000000000001','14761111-0000-0000-0000-000000000001',1,'Source before save','Draft','14760000-0000-0000-0000-0000000000a1','whole_project'),
    ('14762222-0000-0000-0000-000000000002','14760000-0000-0000-0000-000000000001','14761111-0000-0000-0000-000000000002',1,'Save before source','Draft','14760000-0000-0000-0000-0000000000a1','whole_project'),
    ('14762222-0000-0000-0000-000000000003','14760000-0000-0000-0000-000000000001','14761111-0000-0000-0000-000000000003',1,'Save before successor activation','Draft','14760000-0000-0000-0000-0000000000a1','whole_project'),
    ('14762222-0000-0000-0000-000000000004','14760000-0000-0000-0000-000000000001','14761111-0000-0000-0000-000000000003',2,'Existing annual active version','Active','14760000-0000-0000-0000-0000000000a1','per_year');
  insert into budget_line_items(org_id,budget_version_id,category,description,budgeted_amount,actual_amount) values
    ('14760000-0000-0000-0000-000000000001','14762222-0000-0000-0000-000000000001','Labor','source before save',100,0),
    ('14760000-0000-0000-0000-000000000001','14762222-0000-0000-0000-000000000002','Labor','save before source',100,0),
    ('14760000-0000-0000-0000-000000000001','14762222-0000-0000-0000-000000000003','Labor','save before activation',100,0);
$setup$);

select is(
  (select status from whole_project_lock_connect_status),
  'OK',
  'AC-007 the focused interleaving proof opens its second database connection'
);
create function pg_temp.wait_for_whole_project_sleep(p_pid integer) returns boolean
language plpgsql as $$
declare v_attempt integer;
begin
  for v_attempt in 1..100 loop
    if exists (select 1 from pg_stat_activity where pid = p_pid and wait_event = 'PgSleep') then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end;
$$;
create temporary table whole_project_lock_remote_pid(pid integer) on commit drop;
insert into whole_project_lock_remote_pid
  select pid from dblink('whole_project_lock','select pg_backend_pid()') as remote(pid integer);

-- Source edit owns the version row first. The save RPC starts against the old total and must wait;
-- once the edit commits, its stale total is rejected, and a save against the persisted source works.
select dblink_exec('whole_project_lock','set role authenticated');
select dblink_exec('whole_project_lock', $$set request.jwt.claims = '{"sub":"14760000-0000-0000-0000-0000000000a1","role":"authenticated"}'$$);
select is(dblink_send_query('whole_project_lock', $query$
  with changed as materialized (
    update public.budget_line_items set budgeted_amount = 120
     where budget_version_id = '14762222-0000-0000-0000-000000000001' and category = 'Labor'
     returning budget_version_id
  )
  select 'source edit settled'::text from changed cross join lateral (select pg_sleep(1)) as barrier
$query$), 1, 'AC-007 source-first worker starts its edit and enters the time-bounded lock barrier');
select ok(pg_temp.wait_for_whole_project_sleep((select pid from whole_project_lock_remote_pid)),
  'AC-007 source-first edit has updated the row and still holds the version lock');
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local lock_timeout = '300ms';
select throws_ok($$select public.save_budget_distribution(
  '14762222-0000-0000-0000-000000000001','by_days','{}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb
)$$, '55P03', null, 'AC-007 save waits behind an in-flight source edit instead of reading a mixed snapshot');
reset role;
set local lock_timeout = '0';
select is((select status from dblink_get_result('whole_project_lock') as result(status text)), 'source edit settled',
  'AC-007 source-first writer reaches commit after the save wait');
select is((select count(*)::integer from dblink_get_result('whole_project_lock') as result(status text)), 0,
  'AC-007 source-first async result is fully drained before the next interleaving');
select is((select budgeted_amount from budget_line_items where budget_version_id='14762222-0000-0000-0000-000000000001'), 120::numeric,
  'AC-007 source-first persisted source value is the committed edit');
select is((select count(*)::integer from budget_distribution_plans where budget_version_id='14762222-0000-0000-0000-000000000001'), 0,
  'AC-007 timed-out save left no partial distribution plan');
select dblink_exec('whole_project_lock', $$set request.jwt.claims = '{"sub":"14760000-0000-0000-0000-0000000000a2","role":"authenticated"}'$$);
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.save_budget_distribution(
  '14762222-0000-0000-0000-000000000001','by_days','{}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb
)$$, 'P0001', 'budget distribution for Labor must reconcile to its source lines',
  'AC-007 after source commits, save rejects the stale pre-edit source total');
select lives_ok($$select public.save_budget_distribution(
  '14762222-0000-0000-0000-000000000001','by_days','{}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"120.00","method":"by_days","is_override":false}]'::jsonb
)$$, 'AC-007 a subsequent save against the committed source total succeeds');
reset role;
select is((select amount from budget_year_distributions where budget_version_id='14762222-0000-0000-0000-000000000001'), 120::numeric,
  'AC-007 source-first final plan reconciles to the new source amount');
select is_empty($$select public.budget_distribution_gaps('14762222-0000-0000-0000-000000000001')$$,
  'AC-007 source-first final plan has no distribution gap');

-- Save owns the version row first. The source update waits and times out; once the plan commits, a
-- subsequent source update persists independently and the ordinary gap view reports the stale plan.
select dblink_exec('whole_project_lock', $$set request.jwt.claims = '{"sub":"14760000-0000-0000-0000-0000000000a2","role":"authenticated"}'$$);
select is(dblink_send_query('whole_project_lock', $query$
  with saved as materialized (
    select public.save_budget_distribution(
      '14762222-0000-0000-0000-000000000002','by_days','{}'::jsonb,
      '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,
      '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb
    )
  )
  select 'save settled'::text from saved cross join lateral (select pg_sleep(1)) as barrier
$query$), 1, 'AC-007 save-first worker persists its plan before entering the time-bounded barrier');
select ok(pg_temp.wait_for_whole_project_sleep((select pid from whole_project_lock_remote_pid)),
  'AC-007 save-first RPC has stored the plan and still holds the project/version locks');
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local lock_timeout = '300ms';
select throws_ok($$update public.budget_line_items set budgeted_amount = 120
  where budget_version_id='14762222-0000-0000-0000-000000000002' and category='Labor'$$,
  '55P03', null, 'AC-007 source update waits behind an in-flight distribution save');
reset role;
set local lock_timeout = '0';
select is((select status from dblink_get_result('whole_project_lock') as result(status text)), 'save settled',
  'AC-007 save-first writer reaches commit after the source wait');
select is((select count(*)::integer from dblink_get_result('whole_project_lock') as result(status text)), 0,
  'AC-007 save-first async result is fully drained before the next interleaving');
select is((select budgeted_amount from budget_line_items where budget_version_id='14762222-0000-0000-0000-000000000002'), 100::numeric,
  'AC-007 timed-out source edit left the source unchanged');
select is((select amount from budget_year_distributions where budget_version_id='14762222-0000-0000-0000-000000000002'), 100::numeric,
  'AC-007 save-first plan committed in full');
select is_empty($$select public.budget_distribution_gaps('14762222-0000-0000-0000-000000000002')$$,
  'AC-007 save-first plan initially reconciles to its source');
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$update public.budget_line_items set budgeted_amount = 120
  where budget_version_id='14762222-0000-0000-0000-000000000002' and category='Labor'$$,
  'AC-007 the source edit succeeds after the saved plan releases its lock');
reset role;
select is((select budgeted_amount from budget_line_items where budget_version_id='14762222-0000-0000-0000-000000000002'), 120::numeric,
  'AC-007 save-first final source contains the later edit');
select set_eq($$select public.budget_distribution_gaps('14762222-0000-0000-0000-000000000002')$$,
  $$values ('Labor')$$, 'AC-007 save-first final state exposes its real source/plan mismatch');

-- The concurrent whole-project activator waits for a save, then consumes its committed plan, queues
-- reconciliation for the different-mode predecessor, and activates the successor.
select dblink_exec('whole_project_lock', $$set request.jwt.claims = '{"sub":"14760000-0000-0000-0000-0000000000a2","role":"authenticated"}'$$);
select is(dblink_send_query('whole_project_lock', $query$
  with saved as materialized (
    select public.save_budget_distribution(
      '14762222-0000-0000-0000-000000000003','by_days','{}'::jsonb,
      '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,
      '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb
    )
  )
  select 'activation save settled'::text from saved cross join lateral (select pg_sleep(1)) as barrier
$query$), 1, 'AC-008 activation-boundary save enters its barrier with the complete plan persisted');
select ok(pg_temp.wait_for_whole_project_sleep((select pid from whole_project_lock_remote_pid)),
  'AC-008 activation-boundary save still owns the project/version locks');
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-0000000000a3","role":"authenticated"}';
set local lock_timeout = '3s';
select lives_ok($$select public.activate_budget_version('14762222-0000-0000-0000-000000000003')$$,
  'AC-008 concurrent activator waits for save, then activates from the committed plan and queues predecessor reconciliation');
set local lock_timeout = '0';
reset role;
select is((select status from dblink_get_result('whole_project_lock') as result(status text)), 'activation save settled',
  'AC-008 activation-boundary save commits after the activator acquires its lock');
select is((select count(*)::integer from dblink_get_result('whole_project_lock') as result(status text)), 0,
  'AC-008 activation-boundary async result is fully drained');
select is((select status::text from budget_versions where id='14762222-0000-0000-0000-000000000003'), 'Active',
  'AC-008 concurrent activation consumes the committed whole-project plan');
select is((select status::text from budget_versions where id='14762222-0000-0000-0000-000000000004'), 'Archived',
  'AC-008 concurrent activation archives the exact annual predecessor');
select is((select count(*)::integer from budget_archive_requests where budget_version_id='14762222-0000-0000-0000-000000000004' and queued_by_activation and live_target_count=0), 1,
  'AC-008 predecessor reconciliation is durably queued before the successor becomes Active');
select is((select method from budget_distribution_plans where budget_version_id='14762222-0000-0000-0000-000000000003'), 'by_days',
  'AC-008 activation leaves the committed save plan intact');
select is((select amount from budget_year_distributions where budget_version_id='14762222-0000-0000-0000-000000000003'), 100::numeric,
  'AC-008 activation preserves the exact saved yearly amount');
select is_empty($$select public.budget_distribution_gaps('14762222-0000-0000-0000-000000000003')$$,
  'AC-008 saved plan remains reconciled after activation');
select * from finish();
commit;

select dblink_exec('whole_project_lock', 'reset role');
select dblink_exec('whole_project_lock', 'reset request.jwt.claims');
select dblink_exec('whole_project_lock', $cleanup$
  delete from public.budget_year_distributions where budget_version_id::text like '14762222-%';
  delete from public.budget_distribution_plans where budget_version_id::text like '14762222-%';
  delete from public.budget_version_editors where budget_version_id::text like '14762222-%';
  delete from public.budget_archive_requests where budget_version_id::text like '14762222-%';
  -- Deleting the parent first lets the existing cascade guard remove its committed test lines safely,
  -- including the now-Active and Archived fixture versions, without rewriting their status history.
  delete from public.budget_versions where id::text like '14762222-%';
  delete from public.projects where id::text like '14761111-%';
  delete from public.record_changes where org_id = '14760000-0000-0000-0000-000000000001';
  delete from public.profiles where org_id = '14760000-0000-0000-0000-000000000001';
  delete from public.organizations where id = '14760000-0000-0000-0000-000000000001';
  delete from auth.users where id in (
    '14760000-0000-0000-0000-0000000000a1',
    '14760000-0000-0000-0000-0000000000a2',
    '14760000-0000-0000-0000-0000000000a3'
  );
$cleanup$);
select dblink_disconnect('whole_project_lock');
do $$
begin
  if not (select preexisted from whole_project_lock_dblink_extension_state) then
    drop extension dblink;
  end if;
end $$;
drop table whole_project_lock_dblink_extension_state;
drop table whole_project_lock_connect_status;
