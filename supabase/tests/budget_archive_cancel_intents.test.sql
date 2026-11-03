-- #1422 / FR-BUD-122: archiving and queuing ERPNext cancellation is atomic,
-- idempotent, actor-attributed, and preserves the existing four-role gate.
-- dblink must outlive the test transaction: the post-rollback cleanup below deletes rows the second
-- session committed. Remember whether this run created it, so only run-created extension state is
-- removed (a pre-existing extension is never dropped) and the shared catalog returns to baseline.
create temp table _budget_archive_dblink_extension_state as
select exists (select 1 from pg_extension where extname = 'dblink') as existed_before_test;
create extension if not exists dblink;
begin;
-- Bound accidental fixture cycles while the explicit 500ms lock-timeout probes below continue to
-- prove that the intended competing writer blocks at the shared project decision lock.
set local statement_timeout = '30s';
select plan(118);
select dblink_connect('archive_race', format('dbname=%s user=%s password=postgres host=%s port=%s', current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(),5432)));
select dblink_exec('archive_race', $$set statement_timeout = '20s'$$);
select dblink_exec('archive_race', $$set lock_timeout = '5s'$$);
select dblink_exec('archive_race', $q$
 insert into organizations(id,name) values ('04040000-0000-0000-0000-000000000001','Archive race');
 insert into auth.users(id) values ('04040000-0000-0000-0000-000000000002');
 insert into profiles(id,org_id,full_name,email,role,status) values ('04040000-0000-0000-0000-000000000002','04040000-0000-0000-0000-000000000001','Race actor','archive-race@example.invalid','Finance','active');
 insert into projects(id,org_id,name,status) values ('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000001','Race project','Ongoing Project');
 insert into projects(id,org_id,name,status) values ('04040000-0000-0000-0000-000000000008','04040000-0000-0000-0000-000000000001','Other race project','Ongoing Project');
 insert into projects(id,org_id,name,status) values ('04040000-0000-0000-0000-00000000001f','04040000-0000-0000-0000-000000000001','Reverse interleaving project','Ongoing Project');
 insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values ('04040000-0000-0000-0000-000000000004','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000003',1,'Race budget','Archived','2026-10-28T00:00:00Z');
 insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values
   ('04040000-0000-0000-0000-000000000009','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000003',2,'Race successor','Active','2026-10-29T00:00:00Z'),
   ('04040000-0000-0000-0000-00000000000a','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000003',3,'Race older target','Archived','2026-10-27T00:00:00Z'),
   ('04040000-0000-0000-0000-00000000000b','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000008',1,'Other project budget','Active','2026-10-29T00:00:00Z');
 insert into budget_versions(id,org_id,project_id,version,name,status,activated_at) values
   ('04040000-0000-0000-0000-000000000020','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-00000000001f',1,'Reverse archive target','Archived','2026-10-27T00:00:00Z'),
   ('04040000-0000-0000-0000-000000000021','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-00000000001f',2,'Reverse successor','Active','2026-10-29T00:00:00Z');
 insert into budget_version_account_erp_mirror(id,org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_docstatus) values ('04040000-0000-0000-0000-000000000005','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000004','2026','Labor','remove','pending','2026-10-28T00:00:00Z','BUD-RACE',1);
 insert into budget_version_account_erp_mirror(id,org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_docstatus,pushed_project_start_date,pushed_project_end_date) values
   ('04040000-0000-0000-0000-00000000000c','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-00000000000a','2026','Labor','remove','pending','2026-10-27T00:00:00Z','BUD-RACE-OLD',1,'2026-01-01','2026-12-31');
 insert into budget_version_erp_mirror(id,org_id,budget_version_id,fiscal_year,push_state,activated_at_witness,erp_budget_name,erp_docstatus,pushed_project_start_date,pushed_project_end_date) values
   ('04040000-0000-0000-0000-00000000000d','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-00000000000a','2026','pending','2026-10-27T00:00:00Z','BUD-RACE-LEGACY',1,'2026-01-01','2026-12-31');
 insert into budget_version_account_erp_mirror(id,org_id,budget_version_id,fiscal_year,erp_account,budget_intent,push_state,activated_at_witness,erp_budget_name,erp_docstatus,pushed_project_start_date,pushed_project_end_date) values
   ('04040000-0000-0000-0000-000000000022','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000020','2026','Labor','remove','pending','2026-10-27T00:00:00Z','BUD-REVERSE-ACCOUNT',1,'2026-01-01','2026-12-31');
 insert into budget_archive_requests(id,org_id,project_id,budget_version_id,requested_by,cancel_erp) values ('04040000-0000-0000-0000-000000000006','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000004','04040000-0000-0000-0000-000000000002',true);
 insert into budget_archive_cancel_intents(id,org_id,request_id,project_id,budget_version_id,source_mirror_id,actor_user_id,fiscal_year,erp_account,erp_budget_name,activated_at_witness) values ('04040000-0000-0000-0000-000000000007','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000006','04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000004','04040000-0000-0000-0000-000000000005','04040000-0000-0000-0000-000000000002','2026','Labor','BUD-RACE','2026-10-28T00:00:00Z');
 insert into budget_archive_requests(id,org_id,project_id,budget_version_id,requested_by,cancel_erp) values
   ('04040000-0000-0000-0000-000000000023','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-00000000001f','04040000-0000-0000-0000-000000000020','04040000-0000-0000-0000-000000000002',true);
 insert into budget_archive_cancel_intents(id,org_id,request_id,project_id,budget_version_id,source_kind,source_mirror_id,actor_user_id,fiscal_year,erp_account,erp_budget_name,activated_at_witness,pushed_project_start_date,pushed_project_end_date,state)
 values ('04040000-0000-0000-0000-000000000024','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000023','04040000-0000-0000-0000-00000000001f','04040000-0000-0000-0000-000000000020','account','04040000-0000-0000-0000-000000000022','04040000-0000-0000-0000-000000000002','2026','Labor','BUD-REVERSE-ACCOUNT','2026-10-27T00:00:00Z','2026-01-01','2026-12-31','superseded');
$q$);

select dblink_exec('archive_race','begin');
select is((select result from dblink('archive_race', $$select public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000007','retry','retry')$$) as t(result text)), 'applied', 'first retry takes the intent lock');
set local lock_timeout='500ms';
select throws_ok($$select public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000007','retry','retry')$$,'55P03',null,'concurrent retry waits on the project archive decision');
select dblink_exec('archive_race','commit');
select is((select result from dblink('archive_race', $$select public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000007','retry','retry')$$) as t(result text)), 'applied', 'retry converges after the lock releases');
select is((select count(*)::int from error_events where org_id='04040000-0000-0000-0000-000000000001' and error_code='budget-archive-cancel-retry'), 1, 'serialized retries emit one event');
set local lock_timeout='0';

create function pg_temp.enqueue_budget_successor(
  p_project_id uuid, p_version_id uuid, p_fiscal_year text, p_account text, p_actor uuid, p_key text
) returns void language plpgsql as $$
declare v_identity text := public.budget_account_identity(p_version_id, p_fiscal_year, p_account);
begin
  insert into public.external_command_outbox
    (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
  values (
    '04040000-0000-0000-0000-000000000001','budget',v_identity,p_key,'erpnext','create','pending',p_actor,
    jsonb_build_object('id',p_version_id,'projectId',p_project_id,'erp_doc_kind','budget',
      'fiscal_year',p_fiscal_year,'erp_account',p_account,'budget_intent','ensure','outbox_identity',v_identity)
  );
end $$;

create function pg_temp.enqueue_budget_archive_cancel(p_job_id uuid)
returns void language plpgsql as $$
declare
  v_job public.budget_archive_cancel_intents%rowtype;
  v_identity text;
  v_key text;
  v_payload jsonb;
begin
  select * into v_job from public.budget_archive_cancel_intents where id=p_job_id;
  if not found then raise exception 'archive intent missing'; end if;
  v_identity := case when v_job.source_kind='legacy'
    then public.budget_legacy_identity(v_job.budget_version_id,v_job.fiscal_year)
    else public.budget_account_identity(v_job.budget_version_id,v_job.fiscal_year,v_job.erp_account) end;
  v_key := case when v_job.source_kind='legacy' then 'bud15-archive:' else 'bud16-archive:' end
    || v_identity || ':' || floor(extract(epoch from v_job.activated_at_witness) * 1000)::bigint::text;
  v_payload := jsonb_build_object(
    'id',v_job.budget_version_id,'projectId',v_job.project_id,'erp_doc_kind','budget',
    'fiscal_year',v_job.fiscal_year,'erp_account',v_job.erp_account,'budget_intent','remove',
    'budget_predecessor',v_job.erp_budget_name,'outbox_identity',v_identity,
    'activated_at',v_job.activated_at_witness,'project_start_date',v_job.pushed_project_start_date,
    'project_end_date',v_job.pushed_project_end_date,
    'budget_archive_cancel_job_id',v_job.id,'budget_archive_source_mirror_id',v_job.source_mirror_id
  );
  if v_job.source_kind='legacy' then v_payload := v_payload || jsonb_build_object('source_kind','legacy'); end if;
  insert into public.external_command_outbox
    (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
  values (v_job.org_id,'budget',v_identity,v_key,'erpnext','create','pending',v_job.actor_user_id,v_payload);
end $$;

create function pg_temp.try_budget_successor(
  p_project_id uuid, p_version_id uuid, p_fiscal_year text, p_account text, p_actor uuid, p_key text
) returns text language plpgsql as $$
declare v_state text; v_message text;
begin
  begin
    perform pg_temp.enqueue_budget_successor(p_project_id,p_version_id,p_fiscal_year,p_account,p_actor,p_key);
    raise exception using errcode='PZ001', message='archive-test-probe-accepted';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state='PZ001' and v_message='archive-test-probe-accepted' then return 'accepted'; end if;
    return v_state || '|' || v_message;
  end;
end $$;

create function pg_temp.try_budget_archive_cancel(p_job_id uuid)
returns text language plpgsql as $$
declare v_state text; v_message text;
begin
  begin
    perform pg_temp.enqueue_budget_archive_cancel(p_job_id);
    raise exception using errcode='PZ001', message='archive-test-probe-accepted';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state='PZ001' and v_message='archive-test-probe-accepted' then return 'accepted'; end if;
    return v_state || '|' || v_message;
  end;
end $$;

-- A pending account cancellation fences only its overlapping (project, fiscal-year, account) grain.
select is(pg_temp.try_budget_successor('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000009','2026','Labor','04040000-0000-0000-0000-000000000002','successor-labor-blocked'),
  'P0001|budget push is blocked by an unresolved archive cancellation',
  'AC-BUD-122: a pending same-grain cancellation blocks a successor push');
-- Hold the archive decision transaction open after it returns its durable intent. A new successor insert
-- must wait for that short transaction, then read the committed fence rather than outrun it.
select dblink_exec('archive_race','begin');
select value from dblink('archive_race', $$select set_config('request.jwt.claims','{"sub":"04040000-0000-0000-0000-000000000002","role":"authenticated"}',true)$$) as t(value text);
select is((select result->>'request_id' from dblink('archive_race', $$select public.archive_budget_version_with_cancel_intent('04040000-0000-0000-0000-000000000004',true,'04040000-0000-0000-0000-000000000006')$$) as t(result jsonb)),
  '04040000-0000-0000-0000-000000000006','AC-BUD-122: replay keeps the project decision lock through the caller transaction');
set local lock_timeout='500ms';
select is(split_part(pg_temp.try_budget_successor('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000009','2026','Labor','04040000-0000-0000-0000-000000000002','successor-lock-wait'),'|',1),
  '55P03','AC-BUD-122: a successor outbox waits while the archive decision owns the project lock');
select dblink_exec('archive_race','commit');
set local lock_timeout='0';
select is(pg_temp.try_budget_successor('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000009','2026','Labor','04040000-0000-0000-0000-000000000002','successor-after-archive'),
  'P0001|budget push is blocked by an unresolved archive cancellation',
  'AC-BUD-122: the successor remains fenced after the archive transaction commits');
select is((select result from dblink('archive_race', $$select public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000007','superseded','no command was issued')$$) as t(result text)), 'applied',
  'AC-BUD-122: an unissued archive intent can be superseded');
insert into public.budget_archive_requests(id,org_id,project_id,budget_version_id,requested_by,cancel_erp)
values ('04040000-0000-0000-0000-000000000010','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-00000000000a','04040000-0000-0000-0000-000000000002',true);
insert into public.budget_archive_cancel_intents(id,org_id,request_id,project_id,budget_version_id,source_mirror_id,actor_user_id,fiscal_year,erp_account,erp_budget_name,activated_at_witness,pushed_project_start_date,pushed_project_end_date,state)
values ('04040000-0000-0000-0000-000000000011','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000010','04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-00000000000a','04040000-0000-0000-0000-00000000000c','04040000-0000-0000-0000-000000000002','2026','Labor','BUD-RACE-OLD','2026-10-27T00:00:00Z','2026-01-01','2026-12-31','superseded');
select is(pg_temp.try_budget_successor('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000009','2026','Labor','04040000-0000-0000-0000-000000000002','successor-after-unissued-superseded'),
  'accepted','AC-BUD-122: an unissued superseded intent releases its grain');

-- Reverse interleaving uses a dedicated project so earlier archive assertions in this test's outer
-- transaction cannot pre-lock the same project row. A successor outbox owns the shared project lock
-- first; the archive-cancel outbox waits, then refuses the now-visible command.
-- Start with an unissued job so it does not fence the first writer; mark it pending only after that
-- writer owns the shared project lock, reproducing the opposite side of the race.
select dblink_exec('archive_race','begin');
select dblink_exec('archive_race', $q$
 insert into public.external_command_outbox
   (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
 values (
   '04040000-0000-0000-0000-000000000001','budget',public.budget_account_identity('04040000-0000-0000-0000-000000000021','2026','Labor'),
   'successor-outbox-lock-holder','erpnext','create','pending','04040000-0000-0000-0000-000000000002',
   jsonb_build_object('id','04040000-0000-0000-0000-000000000021','projectId','04040000-0000-0000-0000-00000000001f',
     'erp_doc_kind','budget','fiscal_year','2026','erp_account','Labor','budget_intent','ensure',
     'outbox_identity',public.budget_account_identity('04040000-0000-0000-0000-000000000021','2026','Labor'))
 );
 update public.budget_archive_cancel_intents set state='pending'
  where id='04040000-0000-0000-0000-000000000024';
$q$);
set local lock_timeout='500ms';
select is(split_part(pg_temp.try_budget_archive_cancel('04040000-0000-0000-0000-000000000024'),'|',1),
  '55P03','AC-BUD-122: an archive outbox waits for the successor outbox insert lock');
select dblink_exec('archive_race','commit');
set local lock_timeout='0';
select is(pg_temp.try_budget_archive_cancel('04040000-0000-0000-0000-000000000024'),
  'P0001|an overlapping budget command is unsettled for this project grain',
  'AC-BUD-122: the archive outbox refuses an overlapping pending successor command');
update public.external_command_outbox set state='confirmed' where idempotency_key='successor-outbox-lock-holder';
select lives_ok($$select pg_temp.enqueue_budget_archive_cancel('04040000-0000-0000-0000-000000000024')$$,
  'AC-BUD-122: the exact archive outbox can proceed after the overlapping command settles');

-- A cancellation that was issued and then superseded remains a fence. Only a confirmed mirror tombstone
-- and confirmed outbox can move it to complete and release the successor grain.
select is((select count(*)::int from public.external_command_outbox
  where org_id='04040000-0000-0000-0000-000000000001'
    and payload->>'budget_archive_cancel_job_id'='04040000-0000-0000-0000-000000000024'
    and state='pending'), 1,
  'AC-BUD-122: the exact durable intent produces one cancellation outbox');
select throws_ok($$select public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000024','complete','premature')$$,
  '22023','invalid archive transition','AC-BUD-122: a service retry/hold transition cannot mark a cancellation complete');
select is(public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000024','superseded','retry later'), 'applied',
  'AC-BUD-122: a pending issued cancellation can be superseded without losing its durable state');
select is(pg_temp.try_budget_successor('04040000-0000-0000-0000-00000000001f','04040000-0000-0000-0000-000000000021','2026','Labor','04040000-0000-0000-0000-000000000002','successor-after-superseded-issued'),
  'P0001|budget push is blocked by an unresolved archive cancellation',
  'AC-BUD-122: a superseded but issued cancellation still fences the successor');
select is(pg_temp.try_budget_successor('04040000-0000-0000-0000-00000000001f','04040000-0000-0000-0000-000000000021','2026','Materials','04040000-0000-0000-0000-000000000002','successor-disjoint-account-during-fence'),
  'accepted','AC-BUD-122: an account cancellation leaves a disjoint account grain available');
select is(pg_temp.try_budget_successor('04040000-0000-0000-0000-00000000001f','04040000-0000-0000-0000-000000000021','2027','Labor','04040000-0000-0000-0000-000000000002','successor-disjoint-year-during-fence'),
  'accepted','AC-BUD-122: an account cancellation leaves another fiscal year available');
update public.budget_version_account_erp_mirror
   set erp_docstatus=2,erp_cancelled_at='2026-10-30T00:00:00Z'
 where id='04040000-0000-0000-0000-000000000022';
update public.external_command_outbox set state='confirmed'
 where org_id='04040000-0000-0000-0000-000000000001'
   and payload->>'budget_archive_cancel_job_id'='04040000-0000-0000-0000-000000000024';
update public.budget_archive_cancel_intents set state='complete'
 where id='04040000-0000-0000-0000-000000000024';
select lives_ok($$select pg_temp.enqueue_budget_successor('04040000-0000-0000-0000-00000000001f','04040000-0000-0000-0000-000000000021','2026','Labor','04040000-0000-0000-0000-000000000002','successor-after-confirmed-cancel')$$,
  'AC-BUD-122: a confirmed mirror tombstone and outbox release the exact successor grain');
update public.external_command_outbox set state='confirmed' where idempotency_key='successor-after-confirmed-cancel';

select lives_ok($$select pg_temp.enqueue_budget_successor('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000009','2026','Materials','04040000-0000-0000-0000-000000000002','successor-materials-allowed')$$,
  'AC-BUD-122: an account cancellation does not block a disjoint account grain');
update public.external_command_outbox set state='confirmed' where idempotency_key='successor-materials-allowed';
select lives_ok($$select pg_temp.enqueue_budget_successor('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000009','2027','Labor','04040000-0000-0000-0000-000000000002','successor-other-year-allowed')$$,
  'AC-BUD-122: an account cancellation does not block another fiscal year');
update public.external_command_outbox set state='confirmed' where idempotency_key='successor-other-year-allowed';
select lives_ok($$select pg_temp.enqueue_budget_successor('04040000-0000-0000-0000-000000000008','04040000-0000-0000-0000-00000000000b','2026','Labor','04040000-0000-0000-0000-000000000002','successor-other-project-allowed')$$,
  'AC-BUD-122: an archive fence never crosses into another project');
update public.external_command_outbox set state='confirmed' where idempotency_key='successor-other-project-allowed';

insert into public.budget_archive_requests(id,org_id,project_id,budget_version_id,requested_by,cancel_erp)
values ('04040000-0000-0000-0000-000000000014','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-00000000000a','04040000-0000-0000-0000-000000000002',true);
insert into public.budget_archive_cancel_intents(id,org_id,request_id,project_id,budget_version_id,source_mirror_id,source_kind,actor_user_id,fiscal_year,erp_account,erp_budget_name,activated_at_witness,pushed_project_start_date,pushed_project_end_date)
values ('04040000-0000-0000-0000-000000000015','04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000014','04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-00000000000a','04040000-0000-0000-0000-00000000000d','legacy','04040000-0000-0000-0000-000000000002','2026',null,'BUD-RACE-LEGACY','2026-10-27T00:00:00Z','2026-01-01','2026-12-31');
select is(pg_temp.try_budget_successor('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000009','2026','Materials','04040000-0000-0000-0000-000000000002','successor-materials-blocked-by-legacy'),
  'P0001|budget push is blocked by an unresolved archive cancellation',
  'AC-BUD-122: a year-grained legacy cancellation blocks every account successor in that year');
select is(public.transition_budget_archive_cancel_intent('04040000-0000-0000-0000-000000000001','04040000-0000-0000-0000-000000000015','superseded','no command was issued'), 'applied',
  'AC-BUD-122: an unissued legacy cancellation can be superseded');
select lives_ok($$select pg_temp.enqueue_budget_successor('04040000-0000-0000-0000-000000000003','04040000-0000-0000-0000-000000000009','2026','Materials','04040000-0000-0000-0000-000000000002','successor-materials-after-unissued-legacy')$$,
  'AC-BUD-122: an unissued superseded legacy cancellation releases the year-grain fence');
update public.external_command_outbox set state='confirmed' where idempotency_key='successor-materials-after-unissued-legacy';

insert into organizations (id, name) values
  ('03870000-0000-0000-0000-000000000001', 'Archive Intent Org');
insert into auth.users (id, email) values
  ('03870000-0000-0000-0000-0000000000a1', 'archive-finance@example.invalid'),
  ('03870000-0000-0000-0000-0000000000a2', 'archive-engineer@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03870000-0000-0000-0000-0000000000a1', '03870000-0000-0000-0000-000000000001', 'Archive Finance', 'archive-finance@example.invalid', 'Finance', 'active'),
  ('03870000-0000-0000-0000-0000000000a2', '03870000-0000-0000-0000-000000000001', 'Archive Engineer', 'archive-engineer@example.invalid', 'Engineer', 'active');
insert into projects (id, org_id, name, status) values
  ('03870000-0000-0000-0000-0000000000c1', '03870000-0000-0000-0000-000000000001', 'Cancel Project', 'Ongoing Project'),
  ('03870000-0000-0000-0000-0000000000c2', '03870000-0000-0000-0000-000000000001', 'Keep Project', 'Ongoing Project'),
  ('03870000-0000-0000-0000-0000000000c3', '03870000-0000-0000-0000-000000000001', 'Denied Project', 'Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status, activated_at) values
  ('03870000-0000-0000-0000-0000000000d1', '03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000c1', 1, 'Cancel Budget', 'Active', '2026-10-28T00:00:00Z'),
  ('03870000-0000-0000-0000-0000000000d2', '03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000c2', 1, 'Keep Budget', 'Active', '2026-10-28T00:00:00Z'),
  ('03870000-0000-0000-0000-0000000000d3', '03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000c3', 1, 'Denied Budget', 'Active', '2026-10-28T00:00:00Z');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, version_major, activated_at)
values ('03870000-0000-0000-0000-000000000001', 'erpnext', 'https://erp.example.invalid', 'fixture', 16, now());
insert into budget_version_account_erp_mirror
  (org_id, budget_version_id, fiscal_year, erp_account, budget_intent, push_state, activated_at_witness,
   erp_budget_name, erp_docstatus, pushed_project_start_date, pushed_project_end_date)
values
  -- A failed retry can leave the previous successful ERP document live; its known document name still needs cancellation.
  ('03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000d1', '2026', '5100 - Labor - AC', 'ensure', 'failed', '2026-10-28T00:00:00Z', 'BUD-ARCHIVE-1', 1, '2026-01-01', '2026-12-31'),
  ('03870000-0000-0000-0000-000000000001', '03870000-0000-0000-0000-0000000000d2', '2026', '5100 - Labor - AC', 'ensure', 'pushed', '2026-10-28T00:00:00Z', 'BUD-ARCHIVE-2', 1, '2026-01-01', '2026-12-31');
-- #1462: an automatic cancellation is only proven safe when PMO's OWN creation record names the exact
-- document for the exact year-qualified identity. Both live targets below carry it.
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03870000-0000-0000-0000-000000000001', 'budget', public.budget_account_identity('03870000-0000-0000-0000-0000000000d1', '2026', '5100 - Labor - AC'), 'erpnext', 'BUD-ARCHIVE-1'),
  ('03870000-0000-0000-0000-000000000001', 'budget', public.budget_account_identity('03870000-0000-0000-0000-0000000000d2', '2026', '5100 - Labor - AC'), 'erpnext', 'BUD-ARCHIVE-2');

select ok(not has_column_privilege('authenticated', 'public.budget_versions', 'status', 'UPDATE'),
  'AC-BUD-122: authenticated status updates cannot bypass the durable archive RPC');
select ok(has_function_privilege('authenticated', 'public.archive_budget_version_with_cancel_intent(uuid,boolean,uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.archive_budget_version_with_cancel_intent(uuid,boolean,uuid)', 'EXECUTE'),
  'AC-BUD-122: only authenticated callers can execute the archive RPC');
select ok(not has_table_privilege('authenticated', 'public.budget_archive_cancel_intents', 'SELECT')
          and not has_table_privilege('authenticated', 'public.budget_archive_cancel_intents', 'INSERT'),
  'AC-BUD-122: cancellation intents are service-role owned');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.archive_budget_version_with_cancel_intent('03870000-0000-0000-0000-0000000000d1', true, '03870000-0000-0000-0000-0000000000e1')->>'live_target_count', '1',
  'AC-BUD-122: Finance archives and queues the one live v16 ERP Budget');
reset role;

select is((select status::text from budget_versions where id='03870000-0000-0000-0000-0000000000d1'), 'Archived',
  'AC-BUD-122: the budget is archived in the same transaction as its cancellation intent');
select is((select count(*)::int from budget_archive_cancel_intents where budget_version_id='03870000-0000-0000-0000-0000000000d1' and state='pending'), 1,
  'AC-BUD-122: a pending intent survives independently of the browser request');
select is((select actor_user_id from budget_archive_cancel_intents where budget_version_id='03870000-0000-0000-0000-0000000000d1'), '03870000-0000-0000-0000-0000000000a1'::uuid,
  'AC-BUD-122: sweep recovery retains the verified initiating actor');
select is((select budget_intent from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'remove',
  'AC-BUD-122: the mirror records the persisted cancellation decision');
select lives_ok($$ insert into external_command_outbox
  (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
  values (
    '03870000-0000-0000-0000-000000000001','budget',
    public.budget_account_identity('03870000-0000-0000-0000-0000000000d1','2026','5100 - Labor - AC'),
    'bud16-archive:' || public.budget_account_identity('03870000-0000-0000-0000-0000000000d1','2026','5100 - Labor - AC') || ':' || floor(extract(epoch from '2026-10-28T00:00:00Z'::timestamptz) * 1000)::bigint::text,
    'erpnext','create','pending','03870000-0000-0000-0000-0000000000a1',
    jsonb_build_object(
      'id','03870000-0000-0000-0000-0000000000d1','projectId','03870000-0000-0000-0000-0000000000c1',
      'erp_doc_kind','budget','fiscal_year','2026','erp_account','5100 - Labor - AC',
      'budget_intent','remove','budget_predecessor','BUD-ARCHIVE-1',
      'outbox_identity',public.budget_account_identity('03870000-0000-0000-0000-0000000000d1','2026','5100 - Labor - AC'),
      'activated_at','2026-10-28T00:00:00Z','project_start_date','2026-01-01','project_end_date','2026-12-31',
      'budget_archive_cancel_job_id',(select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e1'),
      'budget_archive_source_mirror_id',(select id from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1')
    )
  ) $$,
  'AC-BUD-122: the durable actor-attributed archive outbox accepts its exact request and canonical dates');
update external_command_outbox set state='confirmed'
 where org_id='03870000-0000-0000-0000-000000000001' and domain='budget'
   and pmo_record_id=public.budget_account_identity('03870000-0000-0000-0000-0000000000d1','2026','5100 - Labor - AC');
select throws_ok($$ insert into external_command_outbox
  (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
  values ('03870000-0000-0000-0000-000000000001','budget','03870000-0000-0000-0000-0000000000d1',
          'stale-active-push','erpnext','create','pending','03870000-0000-0000-0000-0000000000a1',
          '{"id":"03870000-0000-0000-0000-0000000000d1","erp_doc_kind":"budget"}') $$,
  'P0001','budget outbox command requires an Active budget version',
  'AC-BUD-122: the database rejects a stale push insert after archive commits');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.archive_budget_version_with_cancel_intent('03870000-0000-0000-0000-0000000000d1', false)->>'cancel_erp'), 'true',
  'AC-BUD-122: repeating archive returns the stored operator decision without changing it');
reset role;

-- The archive remains fenced until every exact-target cancellation has settled.
select throws_ok($$ update budget_versions set status='Active'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'P0001', 'budget archive cancellation is unresolved; complete cancellation before reactivating',
 'AC-BUD-122: reactivation cannot cross an unresolved cancellation');
select throws_ok($$ update budget_versions set activated_at='2026-10-29T00:00:00Z'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'P0001', 'budget archive cancellation is unresolved; complete cancellation before reactivating',
 'AC-BUD-122: the activation witness is fenced while cancellation is unresolved');
update budget_archive_cancel_intents set state='held'
 where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select throws_ok($$ update budget_versions set status='Draft'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'P0001', 'budget archive cancellation is unresolved; complete cancellation before reactivating',
 'AC-BUD-122: a held intent cannot be bypassed by returning to Draft');
update budget_archive_cancel_intents set state='superseded'
 where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select throws_ok($$ update budget_versions set status='Active'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'P0001', 'budget archive cancellation is unresolved; complete cancellation before reactivating',
 'AC-BUD-122: superseding an intent does not release an issued cancellation');
select lives_ok($$ update budget_versions set name='Renamed archived budget'
 where id='03870000-0000-0000-0000-0000000000d1' $$,
 'AC-BUD-122: unrelated archived metadata remains editable');
update budget_archive_cancel_intents set state='complete'
 where budget_version_id='03870000-0000-0000-0000-0000000000d1';

update budget_versions set status='Active', activated_at='2026-10-29T00:00:00Z'
 where id='03870000-0000-0000-0000-0000000000d1';
update budget_version_account_erp_mirror
   set budget_intent='ensure', push_state='pushed', activated_at_witness='2026-10-29T00:00:00Z',
       erp_budget_name='BUD-ARCHIVE-REACTIVATED', erp_cancelled_at=null, erp_docstatus=1
 where budget_version_id='03870000-0000-0000-0000-0000000000d1';
update external_refs set external_record_id='BUD-ARCHIVE-REACTIVATED'
 where org_id='03870000-0000-0000-0000-000000000001' and domain='budget'
   and pmo_record_id=public.budget_account_identity('03870000-0000-0000-0000-0000000000d1', '2026', '5100 - Labor - AC');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.archive_budget_version_with_cancel_intent('03870000-0000-0000-0000-0000000000d1', true, '03870000-0000-0000-0000-0000000000e2')->>'live_target_count', '1',
  'AC-BUD-122: a reactivated version can be archived with a distinct request id');
reset role;
select is((select count(*)::int from budget_archive_requests where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 2,
  'AC-BUD-122: each activation cycle retains its own archive decision');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03870000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.archive_budget_version_with_cancel_intent('03870000-0000-0000-0000-0000000000d3', true) $$,
  '42501', 'not authorized to archive this budget version',
  'AC-BUD-122: a role outside the shipped four-role budget write gate is refused');
reset role;

-- The sweep transition and its durable signal share one database transaction.
set local role service_role;
select lives_ok($$ select public.transition_budget_archive_cancel_intent(
  '03870000-0000-0000-0000-000000000001',
  (select id from public.budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'),
  'held', 'operator review') $$, 'archive hold transition succeeds');
reset role;
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'hold persists the intent');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'held', 'hold persists the matching mirror');
select is((select count(*)::int from error_events where fn='erpnext-sweep' and error_code='budget-archive-cancel-held' and org_id='03870000-0000-0000-0000-000000000001'), 1, 'hold records an independently drainable action event');
select lives_ok($$ select public.transition_budget_archive_cancel_intent(
  '03870000-0000-0000-0000-000000000001',
  (select id from public.budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'),
  'held', 'operator review') $$, 'repeating the hold is idempotent');
select is((select count(*)::int from error_events where fn='erpnext-sweep' and error_code='budget-archive-cancel-held' and org_id='03870000-0000-0000-0000-000000000001'), 1, 'repeated transition does not duplicate the durable signal');
select ok(not has_function_privilege('authenticated', 'public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)', 'EXECUTE') and has_function_privilege('service_role', 'public.transition_budget_archive_cancel_intent(uuid,uuid,text,text)', 'EXECUTE'), 'transition is service only');
set local role authenticated;
select throws_ok($$select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001','03870000-0000-0000-0000-0000000000e2','held','review')$$, '42501', null, 'authenticated role cannot execute the service transaction');
reset role;
update budget_archive_cancel_intents set state='pending' where request_id='03870000-0000-0000-0000-0000000000e2';
update budget_version_account_erp_mirror set push_state='pending' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
delete from error_events where fn='erpnext-sweep' and error_code='budget-archive-cancel-held';
select throws_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000099', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'P0001', null, 'another org cannot transition the intent');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'cross-org attempt leaves the intent pending');
update budget_version_account_erp_mirror set erp_budget_name='different' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select is(public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review'), 'stale', 'a changed mirror witness refuses the transition');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'changed witness leaves intent retryable');
select is((select count(*)::int from error_events where error_code='budget-archive-cancel-stale' and org_id='03870000-0000-0000-0000-000000000001'), 1, 'stale witness records an independently actionable event');
update budget_version_account_erp_mirror set erp_budget_name='BUD-ARCHIVE-REACTIVATED' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
create function pg_temp.fail_archive_transition() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
create trigger test_archive_event_failure before insert on error_events for each row execute function pg_temp.fail_archive_transition();
select throws_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'P0001', 'injected failure', 'event insertion failure aborts the transaction');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'event failure rolls back intent');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'pending', 'event failure rolls back mirror');
drop trigger test_archive_event_failure on error_events;
select lives_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'retry after event failure converges');
update budget_archive_cancel_intents set state='pending' where request_id='03870000-0000-0000-0000-0000000000e2';
update budget_version_account_erp_mirror set push_state='pending' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
create trigger test_archive_mirror_failure before update on budget_version_account_erp_mirror for each row execute function pg_temp.fail_archive_transition();
select throws_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'P0001', 'injected failure', 'mirror failure aborts the transition');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'mirror failure rolls back intent');
drop trigger test_archive_mirror_failure on budget_version_account_erp_mirror;
create trigger test_archive_intent_failure before update on budget_archive_cancel_intents for each row execute function pg_temp.fail_archive_transition();
select throws_ok($$ select public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'held', 'review') $$, 'P0001', 'injected failure', 'intent failure aborts the transition');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'pending', 'intent failure leaves mirror unchanged');
drop trigger test_archive_intent_failure on budget_archive_cancel_intents;
select is(public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'retry', 'retry later'), 'applied', 'retry persists atomically');
select is((select state from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'pending', 'retry retains pending intent');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'failed', 'retry persists the mirror failure');
select is((select count(*)::int from error_events where error_code='budget-archive-cancel-retry' and org_id='03870000-0000-0000-0000-000000000001'), 1, 'retry records the durable signal');
update budget_version_account_erp_mirror set push_state='held' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select is(public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'retry', 'retry'), 'stale', 'retry cannot overwrite an independently held mirror');
select is((select push_state from budget_version_account_erp_mirror where budget_version_id='03870000-0000-0000-0000-0000000000d1'), 'held', 'independent hold is preserved');
update budget_version_account_erp_mirror set push_state='failed' where budget_version_id='03870000-0000-0000-0000-0000000000d1';
select is(public.transition_budget_archive_cancel_intent('03870000-0000-0000-0000-000000000001', (select id from budget_archive_cancel_intents where request_id='03870000-0000-0000-0000-0000000000e2'), 'superseded', null), 'applied', 'supersession persists atomically');

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- #1462 — an OLDER (year-grained) push joins the archive disclosure and cancellation decision.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
insert into organizations (id, name) values
  ('05750000-0000-0000-0000-000000000001', 'Legacy Archive Org'),
  ('05750000-0000-0000-0000-000000000002', 'Legacy Archive Other Org');
insert into auth.users (id, email) values
  ('05750000-0000-0000-0000-0000000000a1', 'legacy-finance@example.invalid'),
  ('05750000-0000-0000-0000-0000000000a2', 'legacy-engineer@example.invalid'),
  ('05750000-0000-0000-0000-0000000000a3', 'legacy-other@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05750000-0000-0000-0000-0000000000a1', '05750000-0000-0000-0000-000000000001', 'Legacy Finance', 'legacy-finance@example.invalid', 'Finance', 'active'),
  ('05750000-0000-0000-0000-0000000000a2', '05750000-0000-0000-0000-000000000001', 'Legacy Engineer', 'legacy-engineer@example.invalid', 'Engineer', 'active'),
  ('05750000-0000-0000-0000-0000000000a3', '05750000-0000-0000-0000-000000000002', 'Other Finance', 'legacy-other@example.invalid', 'Finance', 'active');
insert into projects (id, org_id, name, status) values
  ('05750000-0000-0000-0000-0000000000c1', '05750000-0000-0000-0000-000000000001', 'Legacy v15 project', 'Ongoing Project'),
  ('05750000-0000-0000-0000-0000000000c2', '05750000-0000-0000-0000-000000000001', 'Mixed project', 'Ongoing Project'),
  ('05750000-0000-0000-0000-0000000000c3', '05750000-0000-0000-0000-000000000001', 'Ambiguous project', 'Ongoing Project'),
  ('05750000-0000-0000-0000-0000000000c4', '05750000-0000-0000-0000-000000000001', 'Unbound project', 'Ongoing Project'),
  ('05750000-0000-0000-0000-0000000000c5', '05750000-0000-0000-0000-000000000001', 'Null witness project', 'Ongoing Project'),
  ('05750000-0000-0000-0000-0000000000c6', '05750000-0000-0000-0000-000000000001', 'No provenance project', 'Ongoing Project'),
  ('05750000-0000-0000-0000-0000000000c7', '05750000-0000-0000-0000-000000000002', 'Other org project', 'Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status, activated_at) values
  ('05750000-0000-0000-0000-0000000000d1', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000c1', 1, 'Legacy v15 budget', 'Active', '2026-10-28T00:00:00Z'),
  ('05750000-0000-0000-0000-0000000000d2', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000c2', 1, 'Mixed budget', 'Active', '2026-10-28T00:00:00Z'),
  ('05750000-0000-0000-0000-0000000000d3', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000c3', 1, 'Ambiguous budget', 'Active', '2026-10-28T00:00:00Z'),
  ('05750000-0000-0000-0000-0000000000d4', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000c4', 1, 'Unbound budget', 'Active', '2026-10-28T00:00:00Z'),
  ('05750000-0000-0000-0000-0000000000d5', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000c5', 1, 'Null witness budget', 'Active', '2026-10-28T00:00:00Z'),
  ('05750000-0000-0000-0000-0000000000d6', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000c6', 1, 'No provenance budget', 'Active', '2026-10-28T00:00:00Z'),
  ('05750000-0000-0000-0000-0000000000d7', '05750000-0000-0000-0000-000000000002', '05750000-0000-0000-0000-0000000000c7', 1, 'Other org budget', 'Active', '2026-10-28T00:00:00Z');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, version_major, activated_at)
values
  ('05750000-0000-0000-0000-000000000001', 'erpnext', 'https://erp.example.invalid', 'fixture', 15, now()),
  ('05750000-0000-0000-0000-000000000002', 'erpnext', 'https://erp.example.invalid', 'fixture', 16, now());

-- v15 legacy push: one year-grained document, its own year-qualified provenance.
insert into budget_version_erp_mirror
  (id, org_id, budget_version_id, fiscal_year, push_state, activated_at_witness, erp_budget_name,
   erp_docstatus, pushed_project_start_date, pushed_project_end_date)
values
  ('05750000-0000-0000-0000-0000000000e1', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d1', '2026', 'pushed', '2026-10-28T00:00:00Z', 'BUD-LEGACY-15', 1, '2026-01-01', '2026-12-31');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('05750000-0000-0000-0000-000000000001', 'budget',
        '05750000-0000-0000-0000-0000000000d1:' || public.budget_fiscal_year_token('2026'), 'erpnext', 'BUD-LEGACY-15');

-- mixed v16 org: an account-grained document AND an old year-grained one on the same project.
insert into budget_version_account_erp_mirror
  (org_id, budget_version_id, fiscal_year, erp_account, budget_intent, push_state, activated_at_witness,
   erp_budget_name, erp_docstatus, pushed_project_start_date, pushed_project_end_date)
values
  ('05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d2', '2026', '5100 - Labor - AC', 'ensure', 'pushed',
   '2026-10-28T00:00:00Z', 'BUD-ACCOUNT-16', 1, '2026-01-01', '2026-12-31');
insert into budget_version_erp_mirror
  (id, org_id, budget_version_id, fiscal_year, push_state, activated_at_witness, erp_budget_name,
   erp_docstatus, pushed_project_start_date, pushed_project_end_date)
values
  ('05750000-0000-0000-0000-0000000000e2', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d2', '2026', 'pushed', '2026-10-28T00:00:00Z', 'BUD-LEGACY-16', 1, '2026-01-01', '2026-12-31');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('05750000-0000-0000-0000-000000000001', 'budget', public.budget_account_identity('05750000-0000-0000-0000-0000000000d2', '2026', '5100 - Labor - AC'), 'erpnext', 'BUD-ACCOUNT-16'),
  ('05750000-0000-0000-0000-000000000001', 'budget', '05750000-0000-0000-0000-0000000000d2:' || public.budget_fiscal_year_token('2026'), 'erpnext', 'BUD-LEGACY-16');

-- the SAME ERP document named by both kinds: ambiguous, must never be chosen automatically.
insert into budget_version_account_erp_mirror
  (org_id, budget_version_id, fiscal_year, erp_account, budget_intent, push_state, activated_at_witness,
   erp_budget_name, erp_docstatus, pushed_project_start_date, pushed_project_end_date)
values
  ('05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d3', '2026', '5200 - Travel - AC', 'ensure', 'pushed',
   '2026-10-28T00:00:00Z', 'BUD-DUPLICATE', 1, '2026-01-01', '2026-12-31');
insert into budget_version_erp_mirror
  (id, org_id, budget_version_id, fiscal_year, push_state, activated_at_witness, erp_budget_name,
   erp_docstatus, pushed_project_start_date, pushed_project_end_date)
values
  ('05750000-0000-0000-0000-0000000000e3', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d3', '2026', 'pushed', '2026-10-28T00:00:00Z', 'BUD-DUPLICATE', 1, '2026-01-01', '2026-12-31');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('05750000-0000-0000-0000-000000000001', 'budget', public.budget_account_identity('05750000-0000-0000-0000-0000000000d3', '2026', '5200 - Travel - AC'), 'erpnext', 'BUD-DUPLICATE');

-- unbound org, no witness, and no recorded provenance rows.
insert into budget_version_erp_mirror
  (id, org_id, budget_version_id, fiscal_year, push_state, activated_at_witness, erp_budget_name,
   erp_docstatus, pushed_project_start_date, pushed_project_end_date)
values
  ('05750000-0000-0000-0000-0000000000e4', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d4', '2026', 'pushed', '2026-10-28T00:00:00Z', 'BUD-UNBOUND', 1, '2026-01-01', '2026-12-31'),
  ('05750000-0000-0000-0000-0000000000e5', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d5', '2026', 'pushed', null, 'BUD-NO-WITNESS', 1, '2026-01-01', '2026-12-31'),
  ('05750000-0000-0000-0000-0000000000e6', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d6', '2026', 'pushed', '2026-10-28T00:00:00Z', 'BUD-NO-REF', 1, '2026-01-01', '2026-12-31'),
  ('05750000-0000-0000-0000-0000000000e7', '05750000-0000-0000-0000-000000000002', '05750000-0000-0000-0000-0000000000d7', '2026', 'pushed', '2026-10-28T00:00:00Z', 'BUD-OTHER-ORG', 1, '2026-01-01', '2026-12-31');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('05750000-0000-0000-0000-000000000001', 'budget', '05750000-0000-0000-0000-0000000000d4:' || public.budget_fiscal_year_token('2026'), 'erpnext', 'BUD-UNBOUND'),
  ('05750000-0000-0000-0000-000000000001', 'budget', '05750000-0000-0000-0000-0000000000d5:' || public.budget_fiscal_year_token('2026'), 'erpnext', 'BUD-NO-WITNESS'),
  ('05750000-0000-0000-0000-000000000002', 'budget', '05750000-0000-0000-0000-0000000000d7:' || public.budget_fiscal_year_token('2026'), 'erpnext', 'BUD-OTHER-ORG');

select ok(has_function_privilege('authenticated', 'public.get_budget_archive_targets(uuid)', 'EXECUTE'),
  'AC-BUD-122: an authenticated member may read the archive inventory');
select ok(not has_function_privilege('anon', 'public.get_budget_archive_targets(uuid)', 'EXECUTE'),
  'AC-BUD-122: anon cannot read the archive inventory');

set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select source_kind from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d1')), 'legacy',
  'AC-BUD-122: an older push is disclosed as a legacy target (no invented account)');
select is((select eligible from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d1')), true,
  'AC-BUD-122: a fully witnessed legacy target is eligible');
select is((select reason from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d1')), 'eligible',
  'AC-BUD-122: the safe eligibility reason is reported');
select is(public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d1', true, '05750000-0000-0000-0000-0000000000f1')->>'live_target_count', '1',
  'AC-BUD-122: a v15 legacy document is counted as a live target');
reset role;
select ok(exists(select 1 from budget_archive_cancel_intents
  where budget_version_id='05750000-0000-0000-0000-0000000000d1' and source_kind='legacy' and erp_account is null),
  'AC-BUD-122: the legacy intent names the year-grained mirror with no account');
select is((select fiscal_year from budget_archive_cancel_intents where budget_version_id='05750000-0000-0000-0000-0000000000d1'), '2026',
  'AC-BUD-122: the legacy intent retains its own fiscal year provenance');
select is((select push_state from budget_version_erp_mirror where id='05750000-0000-0000-0000-0000000000e1'), 'pending',
  'AC-BUD-122: the legacy mirror records the persisted cancellation decision');
select is((select status::text from budget_versions where id='05750000-0000-0000-0000-0000000000d1'), 'Archived',
  'AC-BUD-122: the archive and the legacy cancellation are one transaction');

set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d1', false)->>'request_id', '05750000-0000-0000-0000-0000000000f1',
  'AC-BUD-122: replaying the archive returns the stored request instead of a new decision');
reset role;
select is((select count(*)::int from budget_archive_cancel_intents where budget_version_id='05750000-0000-0000-0000-0000000000d1'), 1,
  'AC-BUD-122: a replay does not mint a second cancellation intent');
insert into budget_version_erp_mirror
  (id, org_id, budget_version_id, fiscal_year, push_state, activated_at_witness, erp_budget_name, erp_docstatus, erp_cancelled_at)
values ('05750000-0000-0000-0000-0000000000e8', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d1', '2027', 'pushed', '2026-10-28T00:00:00Z', 'BUD-ALREADY-CANCELLED', 2, now());
select is((select count(*)::int from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d1')), 1,
  'AC-BUD-122: a cancelled legacy mirror is excluded from the live target inventory');

-- A duplicate name on a different archived version in the same project makes the source ambiguous.
-- The target still has its own exact ref; the second mirror cannot be silently adopted as that source.
insert into budget_versions (id, org_id, project_id, version, name, status, activated_at) values
  ('05750000-0000-0000-0000-0000000000d8', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000c1', 2, 'Duplicate source budget', 'Active', '2026-10-30T00:00:00Z'),
  ('05750000-0000-0000-0000-0000000000d9', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000c1', 3, 'Older duplicate source', 'Archived', '2026-10-29T00:00:00Z');
insert into budget_version_erp_mirror
  (id, org_id, budget_version_id, fiscal_year, push_state, activated_at_witness, erp_budget_name,
   erp_docstatus, pushed_project_start_date, pushed_project_end_date)
values
  ('05750000-0000-0000-0000-0000000000e9', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d8', '2026', 'pushed', '2026-10-30T00:00:00Z', 'BUD-DUPLICATE-SOURCE', 1, '2026-01-01', '2026-12-31'),
  ('05750000-0000-0000-0000-0000000000ea', '05750000-0000-0000-0000-000000000001', '05750000-0000-0000-0000-0000000000d9', '2026', 'failed', '2026-10-29T00:00:00Z', 'BUD-DUPLICATE-SOURCE', 1, '2026-01-01', '2026-12-31');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('05750000-0000-0000-0000-000000000001', 'budget',
        '05750000-0000-0000-0000-0000000000d8:' || public.budget_fiscal_year_token('2026'),
        'erpnext', 'BUD-DUPLICATE-SOURCE');
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select reason from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d8')),
  'ambiguous-sources','AC-BUD-122: duplicate year-grained sources remain visible but cannot be selected for cancellation');
select throws_like($$ select public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d8', true, '05750000-0000-0000-0000-0000000000f8') $$,
  '%cannot be proven safe%','AC-BUD-122: a duplicate year-grained source refuses the whole cancellation');
reset role;
select is((select status::text from budget_versions where id='05750000-0000-0000-0000-0000000000d8'), 'Active',
  'AC-BUD-122: refusing a duplicate source leaves the version Active');
select is((select count(*)::int from budget_archive_cancel_intents where budget_version_id='05750000-0000-0000-0000-0000000000d8'), 0,
  'AC-BUD-122: refusing a duplicate source creates no partial intent');

update external_org_bindings set version_major = 16 where org_id='05750000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select eligible from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d2') where source_kind='legacy'), false,
  'AC-BUD-122: an upgraded legacy target remains visible but is not cancellable without v16 shape evidence');
select is((select reason from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d2') where source_kind='legacy'), 'legacy-v16-shape-unproven',
  'AC-BUD-122: v16 legacy holds expose a safe, explicit reason');
select throws_like($$ select public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d2', true, '05750000-0000-0000-0000-0000000000f2') $$,
  '%cannot be proven safe%',
  'AC-BUD-122: mixed v16 targets refuse a partial cancellation');
reset role;
select is((select status::text from budget_versions where id='05750000-0000-0000-0000-0000000000d2'), 'Active',
  'AC-BUD-122: refusing the mixed cancellation leaves the version Active');
select is((select count(*)::int from budget_archive_cancel_intents where budget_version_id='05750000-0000-0000-0000-0000000000d2'), 0,
  'AC-BUD-122: a mixed cancellation refusal creates no partial jobs');
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d2', false, '05750000-0000-0000-0000-0000000000f2')->>'live_target_count', '2',
  'AC-BUD-122: archive without cancellation counts both account and legacy documents');
reset role;
select is((select count(*)::int from budget_archive_cancel_intents where budget_version_id='05750000-0000-0000-0000-0000000000d2'), 0,
  'AC-BUD-122: archive without cancellation creates no cancellation intent');
select ok(exists(select 1 from notifications where org_id='05750000-0000-0000-0000-000000000001'
  and owner_id='05750000-0000-0000-0000-0000000000a1'
  and metadata @> '{"action_required":"budget-archive-live-erp","versionId":"05750000-0000-0000-0000-0000000000d2","targetCount":2}'::jsonb),
  'AC-BUD-122: archive without cancellation warns about the mixed targets');

set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_like($$ select public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d3', true, '05750000-0000-0000-0000-0000000000f3') $$,
  '%cannot be proven safe%',
  'AC-BUD-122: an ambiguous target aborts the whole cancel request');
reset role;
select is((select status::text from budget_versions where id='05750000-0000-0000-0000-0000000000d3'), 'Active',
  'AC-BUD-122: a refused cancel request leaves the version Active');
select is((select count(*)::int from budget_archive_requests where budget_version_id='05750000-0000-0000-0000-0000000000d3'), 0,
  'AC-BUD-122: a refused cancel request records no archive decision');
select is((select count(*)::int from budget_archive_cancel_intents where budget_version_id='05750000-0000-0000-0000-0000000000d3'), 0,
  'AC-BUD-122: a refused cancel request queues nothing');

update external_org_bindings set activated_at = null where org_id='05750000-0000-0000-0000-000000000001';
insert into external_command_outbox
  (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
values ('05750000-0000-0000-0000-000000000001','budget','05750000-0000-0000-0000-0000000000d4',
        'pending-before-archive','erpnext','create','pending','05750000-0000-0000-0000-0000000000a1',
        '{"id":"05750000-0000-0000-0000-0000000000d4","erp_doc_kind":"budget"}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d4', false, '05750000-0000-0000-0000-000000000f4b') $$,
  'P0001','an ERPNext Budget command is unsettled; retry the archive after it has completed',
  'AC-BUD-122: an unsettled budget push blocks archive even when inventory cannot prove ownership');
reset role;
delete from external_command_outbox where idempotency_key='pending-before-archive';
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_like($$ select public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d4', true, '05750000-0000-0000-0000-000000000f4a') $$,
  '%cannot be proven safe%',
  'AC-BUD-122: an unbound org cannot prove a cancellation can be issued');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d4', false, '05750000-0000-0000-0000-0000000000f4')::jsonb->>'live_target_count', '1',
  'AC-BUD-122: an unbound org still archives, disclosing the live target count');
reset role;
select ok(exists(select 1 from notifications
  where org_id='05750000-0000-0000-0000-000000000001' and owner_id='05750000-0000-0000-0000-0000000000a1'
    and metadata @> '{"action_required":"budget-archive-live-erp","versionId":"05750000-0000-0000-0000-0000000000d4"}'::jsonb),
  'AC-BUD-122: archiving without cancellation leaves a durable operator warning');
update external_org_bindings set activated_at = now() where org_id='05750000-0000-0000-0000-000000000001';
update external_org_bindings set version_major = 17 where org_id='05750000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select reason from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d4')), 'binding-unsupported',
  'AC-BUD-122: an unknown binding major leaves the named target visible but ineligible');
reset role;
update external_org_bindings set version_major = 16 where org_id='05750000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_like($$ select public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d5', true, '05750000-0000-0000-0000-000000000f5a') $$,
  '%cannot be proven safe%',
  'AC-BUD-122: a null activation witness is a hold, never an absence proof');
select is(public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d5', false, '05750000-0000-0000-0000-0000000000f5')::jsonb->>'live_target_count', '1',
  'AC-BUD-122: a null-witness legacy row is still disclosed');
reset role;
select is((select count(*)::int from budget_archive_cancel_intents where budget_version_id='05750000-0000-0000-0000-0000000000d5'), 0,
  'AC-BUD-122: an unwitnessed legacy row is never auto-cancelled');

update external_org_bindings set version_major = 15 where org_id='05750000-0000-0000-0000-000000000001';
-- A matching identity/name ref under a DIFFERENT org is not provenance for this source.
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('05750000-0000-0000-0000-000000000002', 'budget',
        '05750000-0000-0000-0000-0000000000d6:' || public.budget_fiscal_year_token('2026'),
        'erpnext', 'BUD-NO-REF');
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select reason from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d6')),
  'provenance-unproven','AC-BUD-122: another org’s exact name and identity cannot satisfy this source reference');
select throws_like($$ select public.archive_budget_version_with_cancel_intent('05750000-0000-0000-0000-0000000000d6', true, '05750000-0000-0000-0000-0000000000f6') $$,
  '%cannot be proven safe%',
  'AC-BUD-122: a legacy target with no recorded provenance is never guessed');
reset role;
update budget_version_erp_mirror set activated_at_witness='2026-10-27T00:00:00Z' where id='05750000-0000-0000-0000-0000000000e6';
update external_org_bindings set version_major = 15 where org_id='05750000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select reason from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d6')), 'witness-changed',
  'AC-BUD-122: a stale witness remains visible with an ineligible reason');
reset role;
select is((select count(*)::int from budget_archive_cancel_intents where org_id='05750000-0000-0000-0000-000000000002'), 0,
  'AC-BUD-122: another org never gains an intent');
select is((select count(*)::int from notifications where org_id='05750000-0000-0000-0000-000000000002'), 0,
  'AC-BUD-122: another org never gains a notice');
select is((select count(*)::int from budget_archive_cancel_intents where org_id='05750000-0000-0000-0000-000000000002' and source_kind='legacy'), 0,
  'AC-BUD-122: cross-org legacy rows stay outside this archive');

set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select * from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d1') $$,
  '42501', 'not authorized to read budget archive targets',
  'AC-BUD-122: a role outside the archive gate cannot read the inventory');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"05750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select * from public.get_budget_archive_targets('05750000-0000-0000-0000-0000000000d7') $$,
  '42501', 'budget version not found',
  'AC-BUD-122: the inventory cannot disclose another organization project');
reset role;

select finish();
rollback;
select dblink_exec('archive_race', $$delete from external_command_outbox where org_id='04040000-0000-0000-0000-000000000001'; delete from error_events where org_id='04040000-0000-0000-0000-000000000001'; delete from projects where org_id='04040000-0000-0000-0000-000000000001'; delete from profiles where org_id='04040000-0000-0000-0000-000000000001'; delete from organizations where id='04040000-0000-0000-0000-000000000001'; delete from auth.users where id='04040000-0000-0000-0000-000000000002'$$);
select dblink_disconnect('archive_race');
do $$
begin
  if not (select existed_before_test from pg_temp._budget_archive_dblink_extension_state) then
    drop extension dblink;
  end if;
end;
$$;
drop table pg_temp._budget_archive_dblink_extension_state;
