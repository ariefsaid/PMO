-- AC-010/012/016: range activation, source edits, dispatch, cancellation and reclaim share real
-- project/outbox locks. dblink supplies an independent committing session; barriers are bounded.
create temporary table budget_range_concurrency_extension_state as
  select exists (select 1 from pg_extension where extname='dblink') as preexisted;
create extension if not exists dblink;
select dblink_connect('budget_range_concurrency', format(
  'dbname=%s user=%s password=postgres host=%s port=%s', current_database(), current_user,
  coalesce(host(inet_server_addr()),'supabase_db_pmo-portal'),coalesce(inet_server_port(),5432)));
select dblink_exec('budget_range_concurrency', $$set statement_timeout='30s'$$);
select dblink_exec('budget_range_concurrency', $$set lock_timeout='10s'$$);
select dblink_exec('budget_range_concurrency', $setup$
  insert into public.organizations(id,name) values
    ('14790000-0000-0000-0000-000000000001','Range concurrency org');
  insert into auth.users(id,email) values
    ('14790000-0000-0000-0000-0000000000a1','range-concurrency-pm@example.invalid'),
    ('14790000-0000-0000-0000-0000000000a2','range-concurrency-finance@example.invalid'),
    ('14790000-0000-0000-0000-0000000000a3','range-concurrency-executive@example.invalid');
  insert into public.profiles(id,org_id,full_name,email,role,status) values
    ('14790000-0000-0000-0000-0000000000a1','14790000-0000-0000-0000-000000000001','Range PM','range-concurrency-pm@example.invalid','Project Manager','active'),
    ('14790000-0000-0000-0000-0000000000a2','14790000-0000-0000-0000-000000000001','Range Finance','range-concurrency-finance@example.invalid','Finance','active'),
    ('14790000-0000-0000-0000-0000000000a3','14790000-0000-0000-0000-000000000001','Range Executive','range-concurrency-executive@example.invalid','Executive','active');
  insert into public.projects(id,org_id,name,status,start_date,end_date) values
    ('14791111-0000-0000-0000-000000000001','14790000-0000-0000-0000-000000000001','Activation race','Ongoing Project','2027-01-01','2027-12-31'),
    ('14791111-0000-0000-0000-000000000002','14790000-0000-0000-0000-000000000001','Source race','Ongoing Project','2027-01-01','2027-12-31'),
    ('14791111-0000-0000-0000-000000000003','14790000-0000-0000-0000-000000000001','Dispatch race','Ongoing Project','2027-01-01','2028-12-31'),
    ('14791111-0000-0000-0000-000000000004','14790000-0000-0000-0000-000000000001','Cancellation race','Ongoing Project','2027-01-01','2029-12-31');
  insert into public.external_org_bindings(org_id,external_tier,site_url,secret_ref,version_major,activated_at)
  values ('14790000-0000-0000-0000-000000000001','erpnext','https://erp.example.invalid','fixture',16,'2026-11-01T00:00:00Z');
  insert into public.budget_versions(id,org_id,project_id,version,name,status,created_by,activated_at,budget_mode) values
    ('14792222-0000-0000-0000-000000000001','14790000-0000-0000-0000-000000000001','14791111-0000-0000-0000-000000000001',1,'Activation race one','Draft','14790000-0000-0000-0000-0000000000a1',null,'whole_project'),
    ('14792222-0000-0000-0000-000000000002','14790000-0000-0000-0000-000000000001','14791111-0000-0000-0000-000000000001',2,'Activation race two','Draft','14790000-0000-0000-0000-0000000000a1',null,'whole_project'),
    ('14792222-0000-0000-0000-000000000003','14790000-0000-0000-0000-000000000001','14791111-0000-0000-0000-000000000002',1,'Source race draft','Draft','14790000-0000-0000-0000-0000000000a1',null,'whole_project'),
    ('14792222-0000-0000-0000-000000000004','14790000-0000-0000-0000-000000000001','14791111-0000-0000-0000-000000000003',1,'Dispatch race annual','Active','14790000-0000-0000-0000-0000000000a1','2026-11-01T00:00:00Z','per_year'),
    ('14792222-0000-0000-0000-000000000005','14790000-0000-0000-0000-000000000001','14791111-0000-0000-0000-000000000003',2,'Dispatch race range successor','Draft','14790000-0000-0000-0000-0000000000a1',null,'whole_project'),
    ('14792222-0000-0000-0000-000000000006','14790000-0000-0000-0000-000000000001','14791111-0000-0000-0000-000000000004',1,'Cancellation predecessor','Active','14790000-0000-0000-0000-0000000000a1','2026-11-02T00:00:00Z','whole_project'),
    ('14792222-0000-0000-0000-000000000007','14790000-0000-0000-0000-000000000001','14791111-0000-0000-0000-000000000004',2,'Cancellation range successor','Draft','14790000-0000-0000-0000-0000000000a1',null,'whole_project');
  insert into public.budget_line_items(org_id,budget_version_id,category,description,budgeted_amount,actual_amount) values
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000001','Labor','Activation one',100,0),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000002','Labor','Activation two',100,0),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000003','Labor','Source race',100,0),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000005','Labor','Dispatch successor',100,0),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000007','Labor','Cancellation successor',100,0);
  insert into public.budget_distribution_plans(org_id,budget_version_id,method,inputs,category_overrides,basis) values
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000001','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000002','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000003','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000005','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000007','by_days','{}','{}','{"projectStart":"2027-01-01","projectEnd":"2029-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"},{"name":"FY29","start":"2029-01-01","end":"2029-12-31"}]}'::jsonb);
  insert into public.budget_year_distributions(org_id,budget_version_id,category,fiscal_year,ordinal,amount,method,is_override) values
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000001','Labor','FY27',0,100,'by_days',false),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000002','Labor','FY27',0,100,'by_days',false),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000003','Labor','FY27',0,100,'by_days',false),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000005','Labor','FY27',0,50,'by_days',false),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000005','Labor','FY28',1,50,'by_days',false),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000007','Labor','FY27',0,33.33,'by_days',false),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000007','Labor','FY28',1,33.34,'by_days',false),
    ('14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000007','Labor','FY29',2,33.33,'by_days',false);
  insert into public.budget_version_account_erp_mirror
    (id,org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account,budget_intent,push_state,
     activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,pushed_project_start_date,pushed_project_end_date)
  values ('14793333-0000-0000-0000-000000000001','14790000-0000-0000-0000-000000000001','14792222-0000-0000-0000-000000000006',
    'FY27','FY28','Labor','ensure','pushed','2026-11-02T00:00:00Z','BUD-RANGE-CONCURRENCY',1,
    '2026-11-02T00:00:00Z','2027-01-01','2028-12-31');
  insert into public.external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id)
  values ('14790000-0000-0000-0000-000000000001','budget',
    public.budget_account_identity('14792222-0000-0000-0000-000000000006','FY27','FY28','Labor'),
    'erpnext','BUD-RANGE-CONCURRENCY');
$setup$);

begin;
set local statement_timeout='45s';
select no_plan();
create temporary table budget_range_concurrency_remote_pid(pid integer) on commit drop;
insert into budget_range_concurrency_remote_pid
  select pid from dblink('budget_range_concurrency','select pg_backend_pid()') as remote(pid integer);
create function pg_temp.wait_for_range_concurrency_sleep(p_pid integer) returns boolean
language plpgsql as $$
declare v_attempt integer;
begin
  for v_attempt in 1..160 loop
    if exists(select 1 from pg_stat_activity where pid=p_pid and wait_event='PgSleep') then return true; end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end;
$$;

-- Two activators enter against the same project. The project lock serializes them and leaves one Active version.
select dblink_exec('budget_range_concurrency','set role authenticated');
select dblink_exec('budget_range_concurrency', $$set request.jwt.claims='{"sub":"14790000-0000-0000-0000-0000000000a2","role":"authenticated"}'$$);
select is(dblink_send_query('budget_range_concurrency',$query$
  with activated as materialized (select public.activate_budget_version('14792222-0000-0000-0000-000000000001'))
  select 'first activation settled'::text from activated cross join lateral (select pg_sleep(1)) barrier
$query$),1,'first activation enters the bounded lock barrier');
select ok(pg_temp.wait_for_range_concurrency_sleep((select pid from budget_range_concurrency_remote_pid)),
  'first activation holds the project lock while the second starts');
set local role authenticated;
set local request.jwt.claims='{"sub":"14790000-0000-0000-0000-0000000000a3","role":"authenticated"}';
set local lock_timeout='5s';
select lives_ok($$select public.activate_budget_version('14792222-0000-0000-0000-000000000002')$$,
  'second concurrent activation waits, then archives its exact predecessor');
set local lock_timeout='0';
reset role;
select is((select status from dblink_get_result('budget_range_concurrency') as result(status text)),
  'first activation settled','the first activation commits after the lock is released');
select is((select count(*)::integer from dblink_get_result('budget_range_concurrency') as result(status text)),
  0,'the asynchronous activation result is fully drained');
select is((select count(*)::integer from public.budget_versions where project_id='14791111-0000-0000-0000-000000000001' and status='Active'),
  1,'concurrent activations leave exactly one Active version');

-- A source edit owns the project/version lock first; the activation waits and rejects its stale saved plan.
select dblink_exec('budget_range_concurrency','reset role');
select dblink_exec('budget_range_concurrency', $$set request.jwt.claims='{"sub":"14790000-0000-0000-0000-0000000000a1","role":"authenticated"}'$$);
select dblink_exec('budget_range_concurrency','set role authenticated');
select is(dblink_send_query('budget_range_concurrency',$query$
  with changed as materialized (
    update public.budget_line_items set budgeted_amount=120
     where budget_version_id='14792222-0000-0000-0000-000000000003' returning budget_version_id
  ) select 'source edit settled'::text from changed cross join lateral (select pg_sleep(1)) barrier
$query$),1,'source edit enters its bounded version-lock barrier');
select ok(pg_temp.wait_for_range_concurrency_sleep((select pid from budget_range_concurrency_remote_pid)),
  'source edit owns its version lock while activation starts');
set local role authenticated;
set local request.jwt.claims='{"sub":"14790000-0000-0000-0000-0000000000a2","role":"authenticated"}';
set local lock_timeout='5s';
select throws_ok($$select public.activate_budget_version('14792222-0000-0000-0000-000000000003')$$,
  'P0001','budget distribution is incomplete for category Labor',
  'activation waits for the source edit and rejects the now-stale approved plan');
set local lock_timeout='0';
reset role;
select is((select status from dblink_get_result('budget_range_concurrency') as result(status text)),
  'source edit settled','the source edit commits before activation validates it');
select is((select count(*)::integer from dblink_get_result('budget_range_concurrency') as result(status text)),
  0,'the asynchronous source-edit result is fully drained');
select is((select status::text from public.budget_versions where id='14792222-0000-0000-0000-000000000003'),
  'Draft','the rejected stale-plan activation leaves its version Draft');

-- Dispatch takes the same project lock. Activation cannot snapshot a predecessor while its command is in flight.
select dblink_exec('budget_range_concurrency','reset role');
select dblink_send_query('budget_range_concurrency',$query$
  with inserted as materialized (
    insert into public.external_command_outbox
      (id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
    values ('14794444-0000-0000-0000-000000000001','14790000-0000-0000-0000-000000000001','budget',
      public.budget_account_identity('14792222-0000-0000-0000-000000000004','FY27','Labor'),'dispatch-race-key',
      'erpnext','create','pending','14790000-0000-0000-0000-0000000000a2',
      jsonb_build_object('id','14792222-0000-0000-0000-000000000004','projectId','14791111-0000-0000-0000-000000000003',
        'erp_doc_kind','budget','fiscal_year','FY27','erp_account','Labor','budget_intent','ensure',
        'outbox_identity',public.budget_account_identity('14792222-0000-0000-0000-000000000004','FY27','Labor')))
    returning id
  ) select 'dispatch settled'::text from inserted cross join lateral (select pg_sleep(1)) barrier
$query$);
select ok(pg_temp.wait_for_range_concurrency_sleep((select pid from budget_range_concurrency_remote_pid)),
  'dispatch insertion holds the project lock while range activation starts');
set local role authenticated;
set local request.jwt.claims='{"sub":"14790000-0000-0000-0000-0000000000a3","role":"authenticated"}';
set local lock_timeout='5s';
select throws_ok($$select public.activate_budget_version('14792222-0000-0000-0000-000000000005')$$,
  'P0001','an ERPNext Budget command is unsettled; retry activation after it has completed',
  'activation waits for dispatch and refuses an unsettled predecessor command');
set local lock_timeout='0';
reset role;
select is((select status from dblink_get_result('budget_range_concurrency') as result(status text)),
  'dispatch settled','the first dispatch commits before activation checks the target snapshot');
select is((select count(*)::integer from dblink_get_result('budget_range_concurrency') as result(status text)),
  0,'the asynchronous dispatch result is fully drained');
select is((select status::text from public.budget_versions where id='14792222-0000-0000-0000-000000000004'),
  'Active','dispatch-target conflict preserves the predecessor');
select is((select status::text from public.budget_versions where id='14792222-0000-0000-0000-000000000005'),
  'Draft','dispatch-target conflict leaves the successor Draft');

-- A confirmed range target is queued for cancellation before successor activation. Its live cancel command
-- takes the project lock; a successor write waits, then is refused while that cancellation remains pending.
-- Activation must commit in the independent session so the concurrent cancellation dispatcher can see
-- its durable intent; a main-session write here would remain invisible inside this pgTAP transaction.
select dblink_exec('budget_range_concurrency','reset role');
select dblink_exec('budget_range_concurrency','reset request.jwt.claims');
select dblink_exec('budget_range_concurrency','set role authenticated');
select dblink_exec('budget_range_concurrency', $$set request.jwt.claims='{"sub":"14790000-0000-0000-0000-0000000000a2","role":"authenticated"}'$$);
select is(dblink_exec('budget_range_concurrency', $remote$do $activation$
  begin perform public.activate_budget_version('14792222-0000-0000-0000-000000000007'); end
$activation$;$remote$), 'DO',
  'changed-range successor commits activation and makes its cancellation intent visible to the independent dispatcher');
select dblink_exec('budget_range_concurrency','reset role');
select dblink_exec('budget_range_concurrency','reset request.jwt.claims');
select is((select status::text from public.budget_versions where id='14792222-0000-0000-0000-000000000007'),
  'Active','committed changed-range activation leaves its successor Active');
select is((select status::text from public.budget_versions where id='14792222-0000-0000-0000-000000000006'),
  'Archived','committed changed-range activation archives its exact predecessor');
select is((select count(*)::integer from public.budget_archive_cancel_intents
  where budget_version_id='14792222-0000-0000-0000-000000000006' and state='pending'),
  1,'committed activation exposes exactly one durable predecessor cancellation intent');
select is(dblink_send_query('budget_range_concurrency',$query$
  with intent as materialized (
    select i.*, public.budget_account_identity(i.budget_version_id,i.fiscal_year,i.to_fiscal_year,i.erp_account) as identity
      from public.budget_archive_cancel_intents i where i.budget_version_id='14792222-0000-0000-0000-000000000006'
  ), inserted as materialized (
    insert into public.external_command_outbox
      (id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
    select '14794444-0000-0000-0000-000000000003',i.org_id,'budget',i.identity,
      'bud16-archive:'||i.identity||':'||floor(extract(epoch from i.activated_at_witness)*1000)::bigint::text,
      'erpnext','create','pending',i.actor_user_id,
      jsonb_build_object('id',i.budget_version_id,'projectId',i.project_id,'erp_doc_kind','budget',
        'fiscal_year',i.fiscal_year,'to_fiscal_year',i.to_fiscal_year,'budget_mode','whole_project',
        'erp_account',i.erp_account,'budget_intent','remove','budget_predecessor',i.erp_budget_name,
        'budget_predecessor_modified',i.erp_modified,'outbox_identity',i.identity,
        'activated_at',i.activated_at_witness,'project_start_date',i.pushed_project_start_date,
        'project_end_date',i.pushed_project_end_date,'budget_archive_cancel_job_id',i.id,
        'budget_archive_source_mirror_id',i.source_mirror_id)
      from intent i returning id
  ) select 'cancellation dispatch settled'::text from inserted cross join lateral (select pg_sleep(1)) barrier
$query$),1,'exact cancellation dispatch enters its bounded project-lock barrier');
select ok(pg_temp.wait_for_range_concurrency_sleep((select pid from budget_range_concurrency_remote_pid)),
  'cancellation dispatch holds the project lock while successor dispatch starts');
select throws_ok($$insert into public.external_command_outbox
  (id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
  values ('14794444-0000-0000-0000-000000000002','14790000-0000-0000-0000-000000000001','budget',
    public.budget_account_identity('14792222-0000-0000-0000-000000000007','FY27','FY29','Labor'),'successor-race-key',
    'erpnext','create','pending','14790000-0000-0000-0000-0000000000a2',
    jsonb_build_object('id','14792222-0000-0000-0000-000000000007','projectId','14791111-0000-0000-0000-000000000004',
      'erp_doc_kind','budget','budget_mode','whole_project','fiscal_year','FY27','to_fiscal_year','FY29',
      'erp_account','Labor','budget_intent','ensure',
      'outbox_identity',public.budget_account_identity('14792222-0000-0000-0000-000000000007','FY27','FY29','Labor')))$$,
  'P0001','budget push is blocked by an unresolved archive cancellation',
  'successor dispatch waits for cancellation and cannot cross the unresolved cancellation gap');
select is((select count(*)::integer from dblink_get_result('budget_range_concurrency') as result(status text)),
  1,'the cancellation-dispatch barrier returns one completion row');
select is((select count(*)::integer from dblink_get_result('budget_range_concurrency') as result(status text)),
  0,'the asynchronous cancellation result is fully drained');

-- Foreground and sweep share one CAS claim. The first holds the outbox row; the second sees no claimable row.
select dblink_exec('budget_range_concurrency','set role service_role');
select is(dblink_send_query('budget_range_concurrency',$query$
  with claimed as materialized (
    select public.claim_outbox_for_commit('14794444-0000-0000-0000-000000000003') as row
  ) select 'claim held'::text from claimed cross join lateral (select pg_sleep(1)) barrier
$query$),1,'foreground claimant enters the outbox row-lock barrier');
select ok(pg_temp.wait_for_range_concurrency_sleep((select pid from budget_range_concurrency_remote_pid)),
  'foreground claim owns the outbox while the sweep claim starts');
set local role service_role;
set local lock_timeout='5s';
select is((public.claim_outbox_for_commit('14794444-0000-0000-0000-000000000003')).id,null::uuid,
  'sweep claimant receives no row after foreground owns the generation');
set local lock_timeout='0';
reset role;
select is((select status from dblink_get_result('budget_range_concurrency') as result(status text)),
  'claim held','the foreground claim commits its sole generation');
select is((select count(*)::integer from dblink_get_result('budget_range_concurrency') as result(status text)),
  0,'the asynchronous claim result is fully drained');
select is((select claim_generation from public.external_command_outbox where id='14794444-0000-0000-0000-000000000003'),
  1,'foreground and sweep produce one claim generation and therefore one possible ERP POST');
select * from finish();
commit;

select dblink_exec('budget_range_concurrency','reset role');
select dblink_exec('budget_range_concurrency','reset request.jwt.claims');
select dblink_exec('budget_range_concurrency',$cleanup$
  delete from public.external_command_outbox where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.external_refs where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.budget_archive_cancel_intents where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.budget_archive_requests where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.budget_version_account_erp_mirror where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.budget_year_distributions where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.budget_distribution_plans where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.budget_versions where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.projects where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.external_org_bindings where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.notifications where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.record_changes where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.profiles where org_id='14790000-0000-0000-0000-000000000001';
  delete from public.organizations where id='14790000-0000-0000-0000-000000000001';
  delete from auth.users where id in ('14790000-0000-0000-0000-0000000000a1','14790000-0000-0000-0000-0000000000a2','14790000-0000-0000-0000-0000000000a3');
$cleanup$);
select dblink_disconnect('budget_range_concurrency');
do $$ begin
  if not (select preexisted from budget_range_concurrency_extension_state) then drop extension dblink; end if;
end $$;
drop table budget_range_concurrency_extension_state;
