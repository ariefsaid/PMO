-- AC-005/006: durable native-report invalidation, revision fencing and trusted context.
begin;
create extension if not exists pgtap;
select no_plan();

select ok(to_regclass('public.erp_financial_statement_dirty_date') is not null,
  'AC-005 dirty-date state is a dedicated machine table');
select ok(case when to_regclass('public.erp_financial_statement_dirty_date') is null then false else
    (select relrowsecurity and relforcerowsecurity from pg_class
      where oid=to_regclass('public.erp_financial_statement_dirty_date')) end,
  'AC-003 dirty-date state enables and forces RLS');
select is((select array_agg(attname::text order by attnum)::text from pg_attribute
  where attrelid=to_regclass('public.erp_financial_statement_dirty_date') and attnum>0 and not attisdropped),
  '{org_id,company,posting_date,revision}',
  'AC-005 dirty-date state contains only scoped identity and monotonic revision');
select ok(case when to_regclass('public.erp_financial_statement_dirty_date') is null then false else
    has_table_privilege('service_role','public.erp_financial_statement_dirty_date','SELECT')
    and not has_table_privilege('service_role','public.erp_financial_statement_dirty_date','INSERT')
    and not has_table_privilege('service_role','public.erp_financial_statement_dirty_date','UPDATE')
    and not has_table_privilege('service_role','public.erp_financial_statement_dirty_date','DELETE')
    and not has_table_privilege('authenticated','public.erp_financial_statement_dirty_date','SELECT')
    and not has_table_privilege('anon','public.erp_financial_statement_dirty_date','SELECT')
    and not has_table_privilege('service_role','public.erp_financial_statement_dirty_date','TRUNCATE') end,
  'AC-003 dirty-date rows are readable by service operations and not directly writable or user-readable');
select ok(not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
  where c.oid=to_regclass('public.erp_financial_statement_dirty_date') and acl.grantee=0
    and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')),
  'AC-003 PUBLIC receives no direct dirty-date table privilege');
select ok(case when to_regclass('public.erp_financial_statement_dirty_revision_seq') is null then false else
  not has_sequence_privilege('service_role','public.erp_financial_statement_dirty_revision_seq','USAGE')
  and not has_sequence_privilege('service_role','public.erp_financial_statement_dirty_revision_seq','SELECT')
  and not has_sequence_privilege('service_role','public.erp_financial_statement_dirty_revision_seq','UPDATE')
  and not has_sequence_privilege('authenticated','public.erp_financial_statement_dirty_revision_seq','USAGE')
  and not has_sequence_privilege('authenticated','public.erp_financial_statement_dirty_revision_seq','SELECT')
  and not has_sequence_privilege('authenticated','public.erp_financial_statement_dirty_revision_seq','UPDATE')
  and not has_sequence_privilege('anon','public.erp_financial_statement_dirty_revision_seq','USAGE')
  and not has_sequence_privilege('anon','public.erp_financial_statement_dirty_revision_seq','SELECT')
  and not has_sequence_privilege('anon','public.erp_financial_statement_dirty_revision_seq','UPDATE')
  and not exists(select 1 from pg_class c cross join lateral aclexplode(
    coalesce(c.relacl,acldefault('S',c.relowner))) acl
    where c.oid=to_regclass('public.erp_financial_statement_dirty_revision_seq')
      and acl.grantee=0 and acl.privilege_type in ('USAGE','SELECT','UPDATE')) end,
  'AC-005 dirty revision sequence is internal to the trigger path');
select ok(case when to_regprocedure('public.track_erp_statement_dirty_date()') is null then false else
    (select prosecdef and proconfig @> array['search_path=public, pg_temp']
       and not has_function_privilege('service_role',oid,'EXECUTE')
       and not has_function_privilege('authenticated',oid,'EXECUTE')
       and not has_function_privilege('anon',oid,'EXECUTE')
       and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) acl
         where acl.grantee=0 and acl.privilege_type='EXECUTE')
     from pg_proc where oid=to_regprocedure('public.track_erp_statement_dirty_date()')) end,
  'AC-003 GL invalidation trigger is fixed-search-path and not a callable public interface');
select ok(exists(select 1 from pg_trigger where tgrelid='public.erp_gl_entry_mirror'::regclass
    and tgname='erp_gl_entry_mirror_statement_dirty_date' and not tgisinternal and tgenabled='O'
    and tgtype=29),
  'AC-005 INSERT, UPDATE and DELETE on the GL mirror reach semantic invalidation');

select ok(to_regclass('public.erp_financial_statement_published_context') is not null,
  'AC-006 published native context has a separate machine-only table');
select is((select array_agg(attname::text order by attnum)::text from pg_attribute
  where attrelid=to_regclass('public.erp_financial_statement_published_context') and attnum>0 and not attisdropped),
  '{org_id,company,snapshot_id,source_generation,context}',
  'AC-006 trusted context is keyed by organization, company and published snapshot');
select ok(case when to_regclass('public.erp_financial_statement_published_context') is null then false else
    (select relrowsecurity and relforcerowsecurity from pg_class
      where oid=to_regclass('public.erp_financial_statement_published_context')) end,
  'AC-003 published native context enables and forces RLS');
select ok(case when to_regclass('public.erp_financial_statement_published_context') is null then false else
    has_table_privilege('service_role','public.erp_financial_statement_published_context','SELECT')
    and not has_table_privilege('service_role','public.erp_financial_statement_published_context','INSERT')
    and not has_table_privilege('service_role','public.erp_financial_statement_published_context','UPDATE')
    and not has_table_privilege('service_role','public.erp_financial_statement_published_context','DELETE')
    and not has_table_privilege('authenticated','public.erp_financial_statement_published_context','SELECT')
    and not has_table_privilege('anon','public.erp_financial_statement_published_context','SELECT')
    and not has_table_privilege('service_role','public.erp_financial_statement_published_context','TRUNCATE') end,
  'AC-003 published native context is service-readable and not directly writable or user-readable');
select ok(not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
  where c.oid=to_regclass('public.erp_financial_statement_published_context') and acl.grantee=0
    and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')),
  'AC-003 PUBLIC receives no direct published-context table privilege');
select ok(exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='erp_financial_statement_report_batch' and column_name='dirty_revision_cutoff'
    and is_nullable='NO' and data_type='bigint'),
  'AC-005 each admitted batch pins a dirty-revision cutoff');
select ok(case when to_regprocedure('public.persist_erp_statement_published_context()') is null then false else
    (select prosecdef and proconfig @> array['search_path=public, pg_temp']
       and not has_function_privilege('service_role',oid,'EXECUTE')
       and not has_function_privilege('authenticated',oid,'EXECUTE')
       and not has_function_privilege('anon',oid,'EXECUTE')
       and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) acl
         where acl.grantee=0 and acl.privilege_type='EXECUTE')
     from pg_proc where oid=to_regprocedure('public.persist_erp_statement_published_context()')) end,
  'AC-003 context capture reads the admitted batch through a private fixed-search-path trigger');
select ok(exists(select 1 from pg_trigger where tgrelid='public.erp_financial_statement_snapshot'::regclass
    and tgname='erp_financial_statement_snapshot_persist_native_context' and not tgisinternal
    and tgenabled='O' and tgtype=5),
  'AC-006 native snapshot insertion persists context before its batch header can be deleted');
select ok(case when to_regprocedure('public._erp_ack_statement_dirty_dates(uuid,text,bigint)') is null
    or to_regprocedure('public.publish_erp_financial_statements(uuid,uuid,uuid)') is null then false else
    (select prosecdef and proconfig @> array['search_path=public, pg_temp']
       and not has_function_privilege('service_role',oid,'EXECUTE')
       and not has_function_privilege('authenticated',oid,'EXECUTE')
       and not has_function_privilege('anon',oid,'EXECUTE')
       and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) acl
         where acl.grantee=0 and acl.privilege_type='EXECUTE')
     from pg_proc where oid=to_regprocedure('public._erp_ack_statement_dirty_dates(uuid,text,bigint)'))
     and position('_erp_ack_statement_dirty_dates' in
       pg_get_functiondef('public.publish_erp_financial_statements(uuid,uuid,uuid)'::regprocedure))>0 end,
  'AC-005 only atomic publication acknowledges captured revisions through a private helper');

insert into public.organizations(id,name,default_currency,default_timezone) values
 ('03210000-0000-0000-0000-000000000001','Synthetic 0321 statement org','IDR','UTC'),
 ('03210000-0000-0000-0000-000000000002','Synthetic 0321 statement org B','IDR','UTC');
set local role service_role;
insert into public.external_org_bindings
 (id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at,
  statement_full_ledger_replay_needed,statement_update_delayed,statement_last_attempt_at,statement_calendar)
values ('03210000-0000-0000-0000-000000000001','03210000-0000-0000-0000-000000000001','erpnext',
        'https://example.invalid','synthetic-0321-fixture',16,
        '{"company":"Native Test Co","project_map":{}}',
        '2026-10-18T09:00:00Z',true,false,'2026-10-18T09:00:00Z',
        '[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"},'
          '{"name":"FY25-26","start":"2025-07-01","end":"2026-06-30"}]');
insert into public.erp_sweep_lock(org_id,locked_until,holder)
values ('03210000-0000-0000-0000-000000000001',clock_timestamp()+interval '15 minutes',
        '03210000-0000-0000-0000-000000000101');
reset role;

create temporary table refresh_0321_context(context jsonb not null) on commit drop;
insert into refresh_0321_context values ('{
  "binding":{"id":"03210000-0000-0000-0000-000000000001","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16},
  "company":"Native Test Co",
  "profile":{"erpVersion":"16.33.0","frappeVersion":"16.31.0"},
  "calendar":[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"},{"name":"FY25-26","start":"2025-07-01","end":"2026-06-30"}],
  "projectMap":{},
  "language":"en",
  "presentation":{"metadata":{"erpVersion":"16.33.0","frappeVersion":"16.31.0","currency":"IDR","calendar":[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"},{"name":"FY25-26","start":"2025-07-01","end":"2026-06-30"}],"currencyPrecision":2,"roundingMethod":"erpnext_report_output","fractionUnits":100},"context":{"requestLanguage":"en","currencyPrecisionBranch":"currency_number_format","raw":{"company":{"name":"Native Test Co","currency":"IDR","defaultFinanceBook":null},"accountsSettings":{"ignoreOpeningCheck":0,"ignoreAccountClosingBalance":0},"currency":{"fractionUnits":100,"numberFormat":"#,###.##"}}}},
  "filterProfile":"erpnext-v16-standard-statements-v1"
}'::jsonb);
create temporary table refresh_0321_expected_pair(
  statement text not null, project_id uuid, period_kind text not null,
  current_start date not null, refresh_reason text not null
) on commit drop;
insert into refresh_0321_expected_pair(statement,project_id,period_kind,current_start,refresh_reason) values
  ('trial_balance',null,'month','2026-06-01','routine'),
  ('profit_and_loss',null,'month','2026-06-01','routine'),
  ('balance_sheet',null,'month','2026-06-01','routine'),
  ('trial_balance',null,'quarter','2026-04-01','routine'),
  ('profit_and_loss',null,'quarter','2026-04-01','routine'),
  ('balance_sheet',null,'quarter','2026-04-01','routine'),
  ('trial_balance',null,'fiscal_year','2025-07-01','routine'),
  ('profit_and_loss',null,'fiscal_year','2025-07-01','routine'),
  ('balance_sheet',null,'fiscal_year','2025-07-01','routine'),
  ('trial_balance',null,'month','2026-01-01','dirty'),
  ('trial_balance',null,'month','2026-02-01','dirty'),
  ('trial_balance',null,'month','2026-03-01','dirty'),
  ('trial_balance',null,'month','2026-04-01','dirty'),
  ('trial_balance',null,'month','2026-05-01','dirty'),
  ('balance_sheet',null,'month','2026-01-01','dirty'),
  ('balance_sheet',null,'month','2026-02-01','dirty'),
  ('balance_sheet',null,'month','2026-03-01','dirty'),
  ('balance_sheet',null,'month','2026-04-01','dirty'),
  ('balance_sheet',null,'month','2026-05-01','dirty'),
  ('trial_balance',null,'quarter','2026-01-01','dirty'),
  ('balance_sheet',null,'quarter','2026-01-01','dirty'),
  ('profit_and_loss',null,'month','2026-01-01','dirty'),
  ('profit_and_loss',null,'month','2026-02-01','dirty'),
  ('profit_and_loss',null,'quarter','2026-01-01','dirty');
create temporary table refresh_0321_behavior(name text primary key,passed boolean not null) on commit drop;
grant select,insert on refresh_0321_context,refresh_0321_expected_pair,refresh_0321_behavior to service_role;

-- The same source tests run against source207 as a real RED: absent 0321 schema is reported by
-- failed assertions, while the conditional behavior block avoids turning that expected RED into
-- a relation-resolution error. Once the migration is present, the block exercises shipped SQL.
set local role service_role;
do $$
declare
  v_context jsonb := (select context from pg_temp.refresh_0321_context);
  v_missing text[] := array[
    'AC-005 semantic source events mark their exact dirty date',
    'AC-005 equal timestamp and replay-metadata redelivery stays clean',
    'AC-005 equal-timestamp financial changes still advance the revision',
    'AC-005 company and date moves dirty both old and new identities',
    'AC-005 report dimensions, project and cancellation changes invalidate the date',
    'AC-005 direct deletion advances the dirty-date revision',
    'AC-005 deletion and completed replay retirement remain observable',
    'AC-005 date revisions are isolated by organization',
    'AC-005 captured dirty revisions clear while newer same-date revisions survive',
    'AC-006 published context preserves the actual admitted context through header deletion',
    'AC-006 pre-context publication is not silently adopted',
    'AC-005 unchanged compatible catalogue requests one latest begun pair per kind',
    'AC-005 cumulative historical dependencies refresh while out-of-range P&L does not',
    'AC-005 batch admission captures the current dirty revision cutoff'
  ];
  v_org uuid := '03210000-0000-0000-0000-000000000001';
  v_org_b uuid := '03210000-0000-0000-0000-000000000002';
  v_holder uuid := '03210000-0000-0000-0000-000000000101';
  v_dirty_before bigint;
  v_dirty_after bigint;
  v_old_revision bigint;
  v_new_revision bigint;
  v_org_b_revision bigint;
  v_direct_delete_before bigint;
  v_direct_delete_after bigint;
  v_cutoff bigint;
  v_admitted_cutoff boolean;
  v_batch_result jsonb;
  v_batch_id uuid;
  v_snapshot_id uuid := gen_random_uuid();
  v_started timestamptz := clock_timestamp()-interval '1 second';
  v_completed timestamptz := clock_timestamp();
  v_replay_id uuid := gen_random_uuid();
  v_legacy_snapshot_id uuid := gen_random_uuid();
begin
  if to_regclass('public.erp_financial_statement_dirty_date') is null
     or to_regclass('public.erp_financial_statement_published_context') is null
     or not exists(select 1 from information_schema.columns where table_schema='public'
       and table_name='erp_financial_statement_report_batch' and column_name='dirty_revision_cutoff') then
    insert into pg_temp.refresh_0321_behavior(name,passed)
      select item,false from unnest(v_missing) item;
    return;
  end if;

  insert into public.erp_gl_entry_mirror(org_id,erp_name,account,company,posting_date,debit,credit,
      project,erp_modified,is_cancelled,erp_docstatus,is_opening,finance_book)
    values (v_org,'dirty-main','Synthetic Account','Native Test Co','2025-02-10',10,0,
      'Project A','source-ts-1',false,1,'No','');
  select revision into v_dirty_before from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-02-10';
  insert into pg_temp.refresh_0321_behavior values
    (v_missing[1],v_dirty_before is not null and v_dirty_before>0);

  update public.erp_gl_entry_mirror set erp_modified='source-ts-2',as_of=as_of+interval '1 second',
    replay_seen_id=v_replay_id where org_id=v_org and erp_name='dirty-main';
  select revision into v_dirty_after from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-02-10';
  update public.erp_gl_entry_mirror set replay_seen_id=null
    where org_id=v_org and erp_name='dirty-main';
  select revision into v_new_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-02-10';
  insert into pg_temp.refresh_0321_behavior values
    (v_missing[2],coalesce(v_dirty_after=v_dirty_before and v_new_revision=v_dirty_before,false));

  update public.erp_gl_entry_mirror set debit=11
    where org_id=v_org and erp_name='dirty-main';
  select revision into v_new_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-02-10';
  insert into pg_temp.refresh_0321_behavior values
    (v_missing[3],coalesce(v_new_revision>v_dirty_before,false));
  v_dirty_before:=v_new_revision;

  update public.erp_gl_entry_mirror set company='Other Native Co',posting_date='2026-01-10'
    where org_id=v_org and erp_name='dirty-main';
  select revision into v_old_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-02-10';
  select revision into v_new_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Other Native Co' and posting_date='2026-01-10';
  insert into pg_temp.refresh_0321_behavior values
    (v_missing[4],coalesce(v_old_revision>v_dirty_before and v_new_revision>v_dirty_before,false));

  v_dirty_before:=v_new_revision;
  update public.erp_gl_entry_mirror set account='Synthetic Account Revised',cost_center='Operations',
    fiscal_year='FY25-26',party_type='Customer',party='Synthetic Customer',
    voucher_type='Journal Entry',voucher_no='JV-0321',erp_docstatus=2,
    is_opening='Yes',finance_book='Primary Book'
    where org_id=v_org and erp_name='dirty-main';
  select revision into v_old_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Other Native Co' and posting_date='2026-01-10';
  update public.erp_gl_entry_mirror set project='Project B'
    where org_id=v_org and erp_name='dirty-main';
  select revision into v_new_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Other Native Co' and posting_date='2026-01-10';
  update public.erp_gl_entry_mirror set is_cancelled=true
    where org_id=v_org and erp_name='dirty-main';
  select revision into v_dirty_after from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Other Native Co' and posting_date='2026-01-10';
  v_direct_delete_before:=v_dirty_after;
  insert into pg_temp.refresh_0321_behavior values
    (v_missing[5],coalesce(v_old_revision>v_dirty_before and v_new_revision>v_old_revision
      and v_dirty_after>v_new_revision,false));

  delete from public.erp_gl_entry_mirror where org_id=v_org and erp_name='dirty-main';
  select revision into v_direct_delete_after from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Other Native Co' and posting_date='2026-01-10';
  insert into pg_temp.refresh_0321_behavior values
    (v_missing[6],coalesce(v_direct_delete_after>v_direct_delete_before,false));
  insert into public.erp_gl_entry_mirror(org_id,erp_name,account,company,posting_date,debit,credit,
      erp_modified,is_cancelled,erp_docstatus,is_opening,finance_book)
    values (v_org,'replay-keep','Synthetic Account','Native Test Co','2025-04-02',1,0,
      'source-ts-1',false,1,'No','');
  insert into public.erp_gl_entry_mirror(org_id,erp_name,account,company,posting_date,debit,credit,
      erp_modified,is_cancelled,erp_docstatus,is_opening,finance_book)
    values (v_org,'replay-retire','Synthetic Account','Native Test Co','2025-04-01',1,0,
      'source-ts-1',false,1,'No','');
  update public.erp_gl_entry_mirror set replay_seen_id=v_replay_id
    where org_id=v_org and erp_name='replay-keep';
  select revision into v_dirty_before from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-04-02';
  perform public.finish_erp_gl_replay(v_org,'Native Test Co',v_replay_id,null);
  select revision into v_old_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-04-01';
  select revision into v_org_b_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-04-02';
  insert into pg_temp.refresh_0321_behavior values
    (v_missing[7],coalesce(not exists(select 1 from public.erp_gl_entry_mirror where org_id=v_org and erp_name='replay-retire')
      and exists(select 1 from public.erp_gl_entry_mirror where org_id=v_org and erp_name='replay-keep')
      and v_old_revision>v_dirty_before and v_org_b_revision=v_dirty_before
      and v_org_b_revision is not null,false));

  insert into public.erp_gl_entry_mirror(org_id,erp_name,account,company,posting_date,debit,credit,
      erp_modified,is_cancelled,erp_docstatus,is_opening,finance_book)
    values (v_org_b,'tenant-same-date','Synthetic Account','Native Test Co','2025-04-03',1,0,
      'source-ts-1',false,1,'No','');
  insert into public.erp_gl_entry_mirror(org_id,erp_name,account,company,posting_date,debit,credit,
      erp_modified,is_cancelled,erp_docstatus,is_opening,finance_book)
    values (v_org,'tenant-main','Synthetic Account','Native Test Co','2025-04-03',1,0,
      'source-ts-1',false,1,'No','');
  select revision into v_org_b_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org_b and company='Native Test Co' and posting_date='2025-04-03';
  select revision into v_dirty_before from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-04-03';
  update public.erp_gl_entry_mirror set debit=2 where org_id=v_org and erp_name='tenant-main';
  select revision into v_dirty_after from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-04-03';
  select revision into v_new_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org_b and company='Native Test Co' and posting_date='2025-04-03';
  insert into pg_temp.refresh_0321_behavior values
    (v_missing[8],coalesce(v_dirty_after>v_dirty_before and v_new_revision=v_org_b_revision,false));

  insert into public.erp_gl_entry_mirror(org_id,erp_name,account,company,posting_date,debit,credit,
      erp_modified,is_cancelled,erp_docstatus,is_opening,finance_book)
    values (v_org,'batch-newer','Synthetic Account','Native Test Co','2025-04-04',1,0,
      'source-ts-1',false,1,'No','');
  select max(revision) into v_cutoff from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co';
  select public.open_erp_statement_report_batch(v_org,v_holder,v_context) into v_batch_result;
  v_batch_id:=(v_batch_result->>'batchId')::uuid;
  if v_batch_id is null then raise exception 'test batch did not open'; end if;
  select v_cutoff is not null and dirty_revision_cutoff is not distinct from v_cutoff
    into v_admitted_cutoff from public.erp_financial_statement_report_batch
   where org_id=v_org and batch_id=v_batch_id;
  insert into pg_temp.refresh_0321_behavior values (v_missing[14],coalesce(v_admitted_cutoff,false));
  update public.erp_gl_entry_mirror set debit=3 where org_id=v_org and erp_name='batch-newer';
  select revision into v_new_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-04-04';
  insert into public.erp_financial_statement_snapshot
   (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
    current_start,current_end,prior_start,prior_end,currency,as_of,capture_started_at,capture_completed_at,
    source_report,report_version,filters,settings,payload,raw_reports,has_activity,display_precision,display_rounding_method)
  values (v_org,'Native Test Co',v_snapshot_id,v_batch_id,'profit_and_loss','company',null,'account_breakdown','month',
    '2025-08-01','2025-08-31','2025-07-01','2025-07-31','IDR',v_completed,v_started,v_completed,
    'Profit and Loss Statement','synthetic-0321-test',null,null,
    '{"current":{"rows":[]},"prior":{"rows":[]}}',
    '{"current":"{}","prior":"{}"}',false,2,'Commercial Rounding');
  insert into public.erp_financial_statement_snapshot
   (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
    current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values (v_org,'Native Test Co',v_legacy_snapshot_id,gen_random_uuid(),'profit_and_loss','company',null,'account_breakdown','month',
    '2025-09-01','2025-09-30','2025-08-01','2025-08-31','IDR',v_completed,
    '{"rows":[]}',false,2,'Commercial Rounding');

  insert into pg_temp.refresh_0321_behavior values
    (v_missing[10],(select context=v_context and company='Native Test Co'
         and source_generation=v_batch_id and snapshot_id=v_snapshot_id
       from public.erp_financial_statement_published_context
       where org_id=v_org and company='Native Test Co' and snapshot_id=v_snapshot_id));
  insert into pg_temp.refresh_0321_behavior values
    (v_missing[11],not exists(select 1 from public.erp_financial_statement_published_context
       where org_id=v_org and snapshot_id=v_legacy_snapshot_id));
end;
$$;
reset role;

-- Exercise the production selector independently from open's staging path. It keeps one begun
-- pair per kind with no dirty revisions, then widens only the exact historical dependency horizon.
do $$
declare
  v_context jsonb := (select context from pg_temp.refresh_0321_context);
  v_other_context jsonb;
  v_org uuid := '03210000-0000-0000-0000-000000000001';
  v_org_b uuid := '03210000-0000-0000-0000-000000000002';
  v_cutoff bigint;
  v_clean_count integer;
  v_dirty_count integer;
  v_cutoff_count integer;
  v_tb_month boolean;
  v_bs_month boolean;
  v_pl_february boolean;
  v_pl_march boolean;
  v_clean_keys boolean;
  v_dirty_keys boolean;
  v_dirty_sides boolean;
  v_cutoff_keys boolean;
  v_all_selected_pairs_have_two_sides boolean;
begin
  execute 'select count(*) from public._erp_statement_report_refresh_plan($1,$2,$3,$4)'
    into v_clean_count using v_org_b,v_context,date '2026-10-18',0;
  execute 'select not exists(
      select distinct p.statement,p.project_id,p.period_kind,p.current_start
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
      except
      select e.statement,e.project_id,e.period_kind,e.current_start
        from pg_temp.refresh_0321_expected_pair e where e.refresh_reason=''routine'')
    and not exists(
      select e.statement,e.project_id,e.period_kind,e.current_start
        from pg_temp.refresh_0321_expected_pair e where e.refresh_reason=''routine''
      except
      select distinct p.statement,p.project_id,p.period_kind,p.current_start
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p)'
    into v_clean_keys using v_org_b,v_context,date '2026-10-18',0;
  execute 'select not exists(
      select p.statement,p.project_id,p.period_kind,p.current_start,p.side
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
       group by p.statement,p.project_id,p.period_kind,p.current_start,p.side
      having count(*)<>1)
    and not exists(
      select p.statement,p.project_id,p.period_kind,p.current_start
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
       group by p.statement,p.project_id,p.period_kind,p.current_start
      having count(distinct p.side)<>2)'
    into v_all_selected_pairs_have_two_sides using v_org_b,v_context,date '2026-10-18',0;
  insert into pg_temp.refresh_0321_behavior values
    ('AC-005 unchanged compatible catalogue requests one latest begun pair per kind',
      v_clean_count=18 and v_clean_keys and v_all_selected_pairs_have_two_sides);

  select revision into v_cutoff from public.erp_financial_statement_dirty_date
   where org_id=v_org and company='Other Native Co' and posting_date='2026-01-10';
  if v_cutoff is null then
    insert into pg_temp.refresh_0321_behavior values
      ('AC-005 cumulative historical dependencies refresh while out-of-range P&L does not',false);
    return;
  end if;
  v_other_context:=jsonb_set(v_context,'{company}','"Other Native Co"'::jsonb);
  execute 'select count(*) from public._erp_statement_report_refresh_plan($1,$2,$3,$4)'
    into v_dirty_count using v_org,v_other_context,date '2026-10-18',v_cutoff;
  execute 'select not exists(
      select distinct p.statement,p.project_id,p.period_kind,p.current_start
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
      except
      select e.statement,e.project_id,e.period_kind,e.current_start
        from pg_temp.refresh_0321_expected_pair e)
    and not exists(
      select e.statement,e.project_id,e.period_kind,e.current_start
        from pg_temp.refresh_0321_expected_pair e
      except
      select distinct p.statement,p.project_id,p.period_kind,p.current_start
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p)'
    into v_dirty_keys using v_org,v_other_context,date '2026-10-18',v_cutoff;
  execute 'select not exists(
      select p.statement,p.project_id,p.period_kind,p.current_start,p.side
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
       group by p.statement,p.project_id,p.period_kind,p.current_start,p.side
      having count(*)<>1)
    and not exists(
      select p.statement,p.project_id,p.period_kind,p.current_start
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
       group by p.statement,p.project_id,p.period_kind,p.current_start
      having count(distinct p.side)<>2)'
    into v_dirty_sides using v_org,v_other_context,date '2026-10-18',v_cutoff;
  execute 'select exists(select 1 from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
      where p.statement=''trial_balance'' and p.period_kind=''month'' and p.current_start=date ''2026-02-01'')'
    into v_tb_month using v_org,v_other_context,date '2026-10-18',v_cutoff;
  execute 'select exists(select 1 from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
      where p.statement=''balance_sheet'' and p.period_kind=''month'' and p.current_start=date ''2026-02-01'')'
    into v_bs_month using v_org,v_other_context,date '2026-10-18',v_cutoff;
  execute 'select exists(select 1 from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
      where p.statement=''profit_and_loss'' and p.period_kind=''month'' and p.current_start=date ''2026-02-01'')'
    into v_pl_february using v_org,v_other_context,date '2026-10-18',v_cutoff;
  execute 'select exists(select 1 from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
      where p.statement=''profit_and_loss'' and p.period_kind=''month'' and p.current_start=date ''2026-03-01'')'
    into v_pl_march using v_org,v_other_context,date '2026-10-18',v_cutoff;
  execute 'select count(*) from public._erp_statement_report_refresh_plan($1,$2,$3,$4)'
    into v_cutoff_count using v_org,v_other_context,date '2026-10-18',v_cutoff-1;
  execute 'select not exists(
      select distinct p.statement,p.project_id,p.period_kind,p.current_start
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p
      except
      select e.statement,e.project_id,e.period_kind,e.current_start
        from pg_temp.refresh_0321_expected_pair e where e.refresh_reason=''routine'')
    and not exists(
      select e.statement,e.project_id,e.period_kind,e.current_start
        from pg_temp.refresh_0321_expected_pair e where e.refresh_reason=''routine''
      except
      select distinct p.statement,p.project_id,p.period_kind,p.current_start
        from public._erp_statement_report_refresh_plan($1,$2,$3,$4) p)'
    into v_cutoff_keys using v_org,v_other_context,date '2026-10-18',v_cutoff-1;
  insert into pg_temp.refresh_0321_behavior values
    ('AC-005 cumulative historical dependencies refresh while out-of-range P&L does not',
      v_dirty_count=48 and v_dirty_keys and v_dirty_sides and v_tb_month and v_bs_month and v_pl_february
      and not v_pl_march and v_cutoff_count=18 and v_cutoff_keys);
end;
$$;

-- A failed publisher transaction must roll back acknowledgment; successful publication clears
-- only the admitted revision, while another company and tenant keep their independent dirtiness.
do $$
declare
  v_org uuid := '03210000-0000-0000-0000-000000000001';
  v_batch_id uuid;
  v_cutoff bigint;
  v_new_revision bigint;
  v_failed_ack_rolled_back boolean;
  v_context jsonb := (select context from pg_temp.refresh_0321_context);
  v_snapshot_id uuid := (select snapshot_id from public.erp_financial_statement_snapshot
    where org_id='03210000-0000-0000-0000-000000000001'
      and source_generation=(select batch_id from public.erp_financial_statement_report_batch
        where org_id='03210000-0000-0000-0000-000000000001')
    order by capture_completed_at desc limit 1);
begin
  if to_regclass('public.erp_financial_statement_dirty_date') is null
     or to_regclass('public.erp_financial_statement_published_context') is null
     or not exists(select 1 from information_schema.columns where table_schema='public'
       and table_name='erp_financial_statement_report_batch' and column_name='dirty_revision_cutoff')
     or to_regprocedure('public._erp_ack_statement_dirty_dates(uuid,text,bigint)') is null then
    return;
  end if;
  select batch_id,dirty_revision_cutoff into v_batch_id,v_cutoff
    from public.erp_financial_statement_report_batch where org_id=v_org;
  select revision into v_new_revision from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-04-04';
  begin
    perform public._erp_ack_statement_dirty_dates(v_org,'Native Test Co',v_cutoff);
    raise exception 'simulate failed publication';
  exception when sqlstate 'P0001' then
    null;
  end;
  select exists(select 1 from public.erp_financial_statement_dirty_date
    where org_id=v_org and company='Native Test Co' and posting_date='2025-04-02'
      and revision<=v_cutoff) into v_failed_ack_rolled_back;
  perform public._erp_ack_statement_dirty_dates(v_org,'Native Test Co',v_cutoff);
  insert into pg_temp.refresh_0321_behavior values
    ('AC-005 captured dirty revisions clear while newer same-date revisions survive',
      v_failed_ack_rolled_back and v_new_revision>v_cutoff
      and exists(select 1 from public.erp_financial_statement_dirty_date
        where org_id=v_org and company='Native Test Co' and posting_date='2025-04-04'
          and revision=v_new_revision)
      and not exists(select 1 from public.erp_financial_statement_dirty_date
        where org_id=v_org and company='Native Test Co' and posting_date='2025-04-02'
          and revision<=v_cutoff)
      and exists(select 1 from public.erp_financial_statement_dirty_date
        where org_id=v_org and company='Other Native Co' and posting_date='2026-01-10')
      and exists(select 1 from public.erp_financial_statement_dirty_date
        where org_id='03210000-0000-0000-0000-000000000002'
          and company='Native Test Co' and posting_date='2025-04-03'));
  update pg_temp.refresh_0321_behavior set passed=passed and
    exists(select 1 from public.erp_financial_statement_published_context
      where org_id=v_org and company='Native Test Co' and snapshot_id=v_snapshot_id
        and source_generation=v_batch_id and context=v_context)
    where name='AC-006 published context preserves the actual admitted context through header deletion';
  delete from public.erp_financial_statement_report_batch where org_id=v_org and batch_id=v_batch_id;
  update pg_temp.refresh_0321_behavior set passed=passed and
    exists(select 1 from public.erp_financial_statement_published_context
      where org_id=v_org and company='Native Test Co' and snapshot_id=v_snapshot_id
        and source_generation=v_batch_id and context=v_context)
    where name='AC-006 published context preserves the actual admitted context through header deletion';
  delete from public.erp_financial_statement_snapshot where org_id=v_org and snapshot_id=v_snapshot_id;
  update pg_temp.refresh_0321_behavior set passed=passed and
    not exists(select 1 from public.erp_financial_statement_published_context
      where org_id=v_org and company='Native Test Co' and snapshot_id=v_snapshot_id)
    where name='AC-006 published context preserves the actual admitted context through header deletion';
end;
$$;

select ok(passed,name) from refresh_0321_behavior order by name;

set local role authenticated;
select throws_ok('select * from public.erp_financial_statement_dirty_date',
  case when to_regclass('public.erp_financial_statement_dirty_date') is null then '42P01' else '42501' end,
  null,'AC-003 authenticated cannot read dirty-date state');
select throws_ok('select * from public.erp_financial_statement_published_context',
  case when to_regclass('public.erp_financial_statement_published_context') is null then '42P01' else '42501' end,
  null,'AC-003 authenticated cannot read persisted native context');
reset role;
set local role anon;
select throws_ok('select * from public.erp_financial_statement_dirty_date',
  case when to_regclass('public.erp_financial_statement_dirty_date') is null then '42P01' else '42501' end,
  null,'AC-003 anon cannot read dirty-date state');
select throws_ok('select * from public.erp_financial_statement_published_context',
  case when to_regclass('public.erp_financial_statement_published_context') is null then '42P01' else '42501' end,
  null,'AC-003 anon cannot read persisted native context');
reset role;

select * from finish();
rollback;
