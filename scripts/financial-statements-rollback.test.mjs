import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbContainer = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_pmo-portal';
const migrations = ['0294_statement_account_source', '0295_statement_ledger_source', '0296_replace_erp_account_chart', '0312_statement_gl_replay_finish', '0313_statement_gl_missing_reference', '0314_statement_company_replay'];
const sqlFile = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function psql(sql) {
  const result = spawnSync('docker', ['exec', '-i', dbContainer, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
    input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, output);
  return output.trim();
}

function verifyLocalTarget() {
  const target = execFileSync('docker', ['inspect', '--format', '{{.Name}}', dbContainer], { encoding: 'utf8' }).trim();
  assert.equal(target, `/${dbContainer}`, 'rollback test may target only the named local Supabase database container');
}

test('0320 down migration drops only the pre-context status RPC', () => {
  const down = sqlFile('supabase/migrations/rollback/0320_financial_statement_native_status_down.sql').trim();
  assert.match(down, /^drop function if exists public\.mark_erp_statement_report_refresh_attempt\(uuid,uuid,jsonb\);$/i);
  assert.doesNotMatch(down, /external_org_bindings|erp_financial_statement_snapshot|erp_financial_statement_report_(batch|pending)/i);
});

test('financial statement source migrations roll back and reapply inside a self-restoring transaction', () => {
  verifyLocalTarget();
  const upNative = sqlFile('supabase/migrations/0319_financial_statement_native_reports.sql');
  const downNative = sqlFile('supabase/migrations/rollback/0319_financial_statement_native_reports_down.sql');
  const upPublisher = sqlFile('supabase/migrations/0317_financial_statement_publisher.sql');
  const downPublisher = sqlFile('supabase/migrations/rollback/0317_financial_statement_publisher_down.sql');
  const upReads = sqlFile('supabase/migrations/0318_financial_statement_reads.sql');
  const downReads = sqlFile('supabase/migrations/rollback/0318_financial_statement_reads_down.sql');
  const [a294, a295, a296, a303, a304, a305] = migrations.map((name) => sqlFile(`supabase/migrations/${name}.sql`));
  const [d294, d295, d296, d303, d304, d305] = migrations.map((name) => sqlFile(`supabase/migrations/rollback/${name}_down.sql`));
  const fixture = `insert into public.erp_gl_entry_mirror(org_id,erp_name,company,account,debit,credit,erp_modified)
    values ('00000000-0000-0000-0000-000000000001','GL-ROLLBACK-FIXTURE','Rollback Co','Synthetic Account',0.123456789,0,'2026-01-01');`;
  const script = `begin;
set local client_min_messages=warning;
${downNative}
${downReads}
${downPublisher}
${fixture}
savepoint unsafe_narrowing;
\\set ON_ERROR_STOP off
${d295}
\\set ON_ERROR_STOP on
rollback to savepoint unsafe_narrowing;
do $$ begin
  if (select debit from public.erp_gl_entry_mirror where erp_name='GL-ROLLBACK-FIXTURE') <> 0.123456789 then
    raise exception 'unsafe numeric narrowing changed the source amount';
  end if;
  if (select data_type from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='debit') <> 'numeric' then
    raise exception 'unsafe numeric narrowing changed the column type';
  end if;
end $$;
${d305}
${d304}
${d303}
${d296}
update public.erp_gl_entry_mirror set debit=0 where erp_name='GL-ROLLBACK-FIXTURE';
${d295}
${d294}
${a294}
${a295}
${a296}
${a303}
${a304}
${a305}
${upPublisher}
${upReads}
${upNative}
rollback;
`;
  const output = psql(script);
  assert.match(output, /cannot narrow GL debit\/credit/i, 'down migration must explicitly refuse lossy numeric narrowing');
});

test('0319 native migration down/up preserves legacy data and refuses live captures', () => {
  verifyLocalTarget();
  const up = sqlFile('supabase/migrations/0319_financial_statement_native_reports.sql');
  const down = sqlFile('supabase/migrations/rollback/0319_financial_statement_native_reports_down.sql');
  const script = `begin;
set local client_min_messages=warning;
insert into public.organizations(id,name,default_currency,default_timezone)
  values ('03190400-0000-0000-0000-000000000001','Synthetic rollback guard org','IDR','UTC');
savepoint native_capture_guard;
insert into public.erp_financial_statement_snapshot
 (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
  current_start,current_end,prior_start,prior_end,currency,as_of,source_report,report_version,filters,settings,
  payload,has_activity,display_precision,display_rounding_method,raw_reports,capture_started_at,capture_completed_at)
values ('03190400-0000-0000-0000-000000000001','Synthetic rollback guard company',
 '03190400-0000-0000-0000-000000000002','03190400-0000-0000-0000-000000000003','trial_balance','company',null,
 'account_breakdown','month','2025-01-01','2025-01-31','2024-12-01','2024-12-31','IDR',
 '2026-10-18T09:00:01Z','Trial Balance','16.33.0','{}','{}','{"current":{},"prior":{}}',false,2,
 'Commercial Rounding','{"current":"{}","prior":"{}"}','2026-10-18T09:00:00Z','2026-10-18T09:00:01Z');
\\set ON_ERROR_STOP off
${down}
\\set ON_ERROR_STOP on
rollback to savepoint native_capture_guard;
do $$ begin
  if exists(select 1 from public.erp_financial_statement_snapshot
      where org_id='03190400-0000-0000-0000-000000000001' and raw_reports is not null) then
    raise exception 'failed native down changed persisted rows';
  end if;
end $$;
create temporary table before_0319_rows on commit drop as select to_jsonb(s) as row_json
  from public.erp_financial_statement_snapshot s;
create temporary table before_0319_binding on commit drop as select to_jsonb(b) as row_json
  from public.external_org_bindings b where b.external_tier='erpnext';
${down}
do $$ begin
  if to_regclass('public.erp_financial_statement_report_batch') is not null
     or to_regclass('public.erp_financial_statement_report_pending') is not null
     or to_regprocedure('public.open_erp_statement_report_batch(uuid,uuid,jsonb)') is not null
     or to_regprocedure('public.publish_erp_financial_statements(uuid,uuid,uuid)') is not null
     or exists(select 1 from information_schema.columns where table_schema='public'
       and table_name='erp_financial_statement_snapshot' and column_name in ('raw_reports','capture_started_at','capture_completed_at')) then
    raise exception '0319 native objects remained after down';
  end if;
  if to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)') is null then
    raise exception 'legacy publisher was not restored by 0319 down';
  end if;
  if exists(select row_json from before_0319_rows except
      select to_jsonb(s)-array['raw_reports','capture_started_at','capture_completed_at'] from public.erp_financial_statement_snapshot s)
     or exists(select to_jsonb(s)-array['raw_reports','capture_started_at','capture_completed_at'] from public.erp_financial_statement_snapshot s except select row_json from before_0319_rows)
     or exists(select row_json from before_0319_binding except select to_jsonb(b) from public.external_org_bindings b where b.external_tier='erpnext')
     or exists(select to_jsonb(b) from public.external_org_bindings b where b.external_tier='erpnext' except select row_json from before_0319_binding) then
    raise exception '0319 down changed legacy snapshot or binding data';
  end if;
end $$;
${up}
do $$ begin
  if to_regclass('public.erp_financial_statement_report_batch') is null
     or to_regclass('public.erp_financial_statement_report_pending') is null
     or to_regprocedure('public.open_erp_statement_report_batch(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.publish_erp_financial_statements(uuid,uuid,uuid)') is null then
    raise exception 'native surfaces missing after 0319 up';
  end if;
  if exists(select row_json from before_0319_rows except select to_jsonb(s) from public.erp_financial_statement_snapshot s)
     or exists(select to_jsonb(s) from public.erp_financial_statement_snapshot s except select row_json from before_0319_rows)
     or exists(select row_json from before_0319_binding except select to_jsonb(b) from public.external_org_bindings b where b.external_tier='erpnext')
     or exists(select to_jsonb(b) from public.external_org_bindings b where b.external_tier='erpnext' except select row_json from before_0319_binding) then
    raise exception '0319 up changed legacy snapshot or binding data';
  end if;
end $$;
select '0319_ROLLBACK_OK';
rollback;
`;
  const output = psql(script);
  assert.match(output, /0319 down refused while native report data or pending batches exist/i);
  assert.match(output, /0319_ROLLBACK_OK/);
});

test('0317 publisher down/up preserves all 0316 snapshot rows and restores the exact service-only RPC', () => {
  verifyLocalTarget();
  const up = sqlFile('supabase/migrations/0317_financial_statement_publisher.sql');
  const down = sqlFile('supabase/migrations/rollback/0317_financial_statement_publisher_down.sql');
  const upNative = sqlFile('supabase/migrations/0319_financial_statement_native_reports.sql');
  const downNative = sqlFile('supabase/migrations/rollback/0319_financial_statement_native_reports_down.sql');
  const script = `begin;
set local client_min_messages=warning;
${downNative}
create temporary table before_0316_rows on commit drop as
  select to_jsonb(s) as row_json from public.erp_financial_statement_snapshot s;
create temporary table before_0317_acl on commit drop as
  select p.prosecdef, p.proconfig, p.proacl
    from pg_proc p where p.oid=to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)');
${down}
do $$ begin
  if to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)') is not null then
    raise exception '0317 publisher remained after down';
  end if;
  if to_regclass('public.erp_financial_statement_snapshot') is null then
    raise exception '0316 snapshot table was removed by 0317 down';
  end if;
  if exists(select to_jsonb(s) from public.erp_financial_statement_snapshot s except select row_json from before_0316_rows)
     or exists(select row_json from before_0316_rows except select to_jsonb(s) from public.erp_financial_statement_snapshot s) then
    raise exception '0317 down changed 0316 snapshot rows';
  end if;
end $$;
${up}
do $$ begin
  if to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)') is null then
    raise exception '0317 publisher missing after up';
  end if;
  if not has_function_privilege('service_role','public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)','EXECUTE') then
    raise exception '0317 publisher ACL did not restore service-only execution';
  end if;
  if not (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid=to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)')) then
    raise exception '0317 publisher security properties did not restore';
  end if;
  if not exists (
    select 1 from before_0317_acl b join pg_proc p
      on p.oid=to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)')
     where p.prosecdef is not distinct from b.prosecdef
       and p.proconfig is not distinct from b.proconfig
       and p.proacl is not distinct from b.proacl
  ) then raise exception '0317 down/up changed publisher ACL/config'; end if;
  if exists(select to_jsonb(s) from public.erp_financial_statement_snapshot s except select row_json from before_0316_rows)
     or exists(select row_json from before_0316_rows except select to_jsonb(s) from public.erp_financial_statement_snapshot s) then
    raise exception '0317 up changed 0316 snapshot rows';
  end if;
end $$;
${upNative}
select '0317_ROLLBACK_OK';
rollback;
`;
  const output = psql(script);
  assert.match(output, /0317_ROLLBACK_OK/);
});

test('0318 reads down/up preserves source tables, publication rows, bindings and the accepted publisher', () => {
  verifyLocalTarget();
  const up = sqlFile('supabase/migrations/0318_financial_statement_reads.sql');
  const down = sqlFile('supabase/migrations/rollback/0318_financial_statement_reads_down.sql');
  const upNative = sqlFile('supabase/migrations/0319_financial_statement_native_reports.sql');
  const downNative = sqlFile('supabase/migrations/rollback/0319_financial_statement_native_reports_down.sql');
  const script = `begin;
set local client_min_messages=warning;
${downNative}
create temporary table before_0318_rows on commit drop as
  select to_jsonb(s) as row_json from public.erp_financial_statement_snapshot s;
create temporary table before_0318_binding on commit drop as
  select to_jsonb(binding) as row_json from public.external_org_bindings binding where external_tier='erpnext';
create temporary table before_0318_publisher on commit drop as
  select prosecdef,proconfig,proacl from pg_proc
   where oid=to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)');
${down}
do $$ begin
  if to_regprocedure('public.get_financial_statement_catalogue(uuid)') is not null
     or to_regprocedure('public.get_financial_statement(text,date,text,uuid,text,boolean)') is not null
     or to_regclass('public.erp_financial_statement_availability') is not null then
    raise exception '0318 read surfaces remained after down';
  end if;
  if to_regclass('public.erp_financial_statement_snapshot') is null
     or to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)') is null then
    raise exception '0318 down removed a predecessor publication object';
  end if;
  if exists(select row_json from before_0318_rows except select to_jsonb(s) from public.erp_financial_statement_snapshot s)
     or exists(select to_jsonb(s) from public.erp_financial_statement_snapshot s except select row_json from before_0318_rows)
     or exists(select row_json from before_0318_binding except select to_jsonb(binding) from public.external_org_bindings binding where external_tier='erpnext')
     or exists(select to_jsonb(binding) from public.external_org_bindings binding where external_tier='erpnext' except select row_json from before_0318_binding) then
    raise exception '0318 down changed stored publication or source status';
  end if;
end $$;
${up}
do $$ begin
  if to_regprocedure('public.get_financial_statement_catalogue(uuid)') is null
     or to_regprocedure('public.get_financial_statement(text,date,text,uuid,text,boolean)') is null
     or to_regclass('public.erp_financial_statement_availability') is null then
    raise exception '0318 read surfaces missing after up';
  end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.get_financial_statement_catalogue(uuid)')
       and not prosecdef and provolatile='s' and pronargdefaults=1 and proconfig @> array['search_path=public, pg_temp'])
     or not exists(select 1 from pg_proc where oid=to_regprocedure('public.get_financial_statement(text,date,text,uuid,text,boolean)')
       and not prosecdef and provolatile='s' and pronargdefaults=3 and proconfig @> array['search_path=public, pg_temp']) then
    raise exception '0318 read RPC security/default properties did not restore';
  end if;
  if not has_function_privilege('authenticated','public.get_financial_statement_catalogue(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_financial_statement(text,date,text,uuid,text,boolean)','EXECUTE')
     or has_function_privilege('anon','public.get_financial_statement_catalogue(uuid)','EXECUTE')
     or has_function_privilege('anon','public.get_financial_statement(text,date,text,uuid,text,boolean)','EXECUTE') then
    raise exception '0318 read RPC ACL did not restore';
  end if;
  if not (select reloptions @> array['security_barrier=true'] and pg_get_userbyid(relowner)='postgres'
            from pg_class where oid='public.erp_financial_statement_availability'::regclass)
     or not has_table_privilege('authenticated','public.erp_financial_statement_availability','SELECT')
     or has_table_privilege('anon','public.erp_financial_statement_availability','SELECT') then
    raise exception '0318 safe view security properties did not restore';
  end if;
  if exists(select row_json from before_0318_rows except select to_jsonb(s) from public.erp_financial_statement_snapshot s)
     or exists(select to_jsonb(s) from public.erp_financial_statement_snapshot s except select row_json from before_0318_rows)
     or exists(select row_json from before_0318_binding except select to_jsonb(binding) from public.external_org_bindings binding where external_tier='erpnext')
     or exists(select to_jsonb(binding) from public.external_org_bindings binding where external_tier='erpnext' except select row_json from before_0318_binding) then
    raise exception '0318 up changed existing publication or source status';
  end if;
  if not exists(select 1 from before_0318_publisher old join pg_proc live
    on live.oid=to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)')
    where live.prosecdef is not distinct from old.prosecdef and live.proconfig is not distinct from old.proconfig and live.proacl is not distinct from old.proacl) then
    raise exception '0318 down/up changed accepted 0317 publisher';
  end if;
end $$;
${upNative}
select '0318_ROLLBACK_OK';
rollback;
`;
  const output = psql(script);
  assert.match(output, /0318_ROLLBACK_OK/);
});

test('0318 inactive-member RPC gate mutation is detected by the bound denial behavior', () => {
  verifyLocalTarget();
  const downNative = sqlFile('supabase/migrations/rollback/0319_financial_statement_native_reports_down.sql');
  const script = `begin;
${downNative}
insert into public.organizations(id,name,default_currency,default_timezone)
  values ('03180100-0000-0000-0000-000000000001','Synthetic mutation org','IDR','UTC');
insert into auth.users(id,email) values
  ('03180100-0000-0000-0000-000000000002','statement-mutation@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
  ('03180100-0000-0000-0000-000000000002','03180100-0000-0000-0000-000000000001',
   'Synthetic disabled Finance','statement-mutation@example.test','Finance','disabled');
set local role authenticated;
set local request.jwt.claims='{"sub":"03180100-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  begin
    perform public.get_financial_statement_catalogue();
    raise exception 'inactive member unexpectedly executed the unmutated RPC';
  exception when insufficient_privilege then
    if sqlstate <> '42501' then raise; end if;
  end;
end $$;
reset role;
do $$ declare
  original_definition text;
  mutated_definition text;
begin
  select pg_get_functiondef(to_regprocedure('public.get_financial_statement_catalogue(uuid)')) into original_definition;
  mutated_definition := replace(original_definition,
    'or not coalesce(public.is_active_member(), false)', 'or false');
  if mutated_definition = original_definition then raise exception 'inactive-member mutation target drifted'; end if;
  execute mutated_definition;
end $$;
set local role authenticated;
set local request.jwt.claims='{"sub":"03180100-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ declare response jsonb;
begin
  response := public.get_financial_statement_catalogue();
  if response->>'state' <> 'unavailable' then
    raise exception 'inactive-member mutation did not change the bound RPC behavior';
  end if;
end $$;
select '0318_MUTATION_DETECTED';
rollback;
`;
  const output = psql(script);
  assert.match(output, /0318_MUTATION_DETECTED/);
});

test('0318 project-before-absence authorization mutation changes foreign project denial', () => {
  verifyLocalTarget();
  const downNative = sqlFile('supabase/migrations/rollback/0319_financial_statement_native_reports_down.sql');
  const script = `begin;
${downNative}
insert into public.organizations(id,name,default_currency,default_timezone) values
  ('03180200-0000-0000-0000-000000000001','Synthetic project caller org','IDR','UTC'),
  ('03180200-0000-0000-0000-000000000002','Synthetic foreign project org','IDR','UTC');
insert into auth.users(id,email) values ('03180200-0000-0000-0000-000000000003','statement-project-mutation@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
  ('03180200-0000-0000-0000-000000000003','03180200-0000-0000-0000-000000000001',
   'Synthetic caller Finance','statement-project-mutation@example.test','Finance','active');
insert into public.projects(id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
  tax_base_numerator,tax_base_denominator,subject_to_vat,project_manager_id) values
  ('03180200-0000-0000-0000-000000000004','03180200-0000-0000-0000-000000000002',
   'Synthetic foreign project','Ongoing Project','IDR',1000,'exclusive',0,0,1,1,false,null);
set local role authenticated;
set local request.jwt.claims='{"sub":"03180200-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  begin
    perform public.get_financial_statement_catalogue('03180200-0000-0000-0000-000000000004');
    raise exception 'foreign project unexpectedly passed the unmutated guard';
  exception when insufficient_privilege then
    if sqlstate <> '42501' then raise; end if;
  end;
end $$;
reset role;
do $$ declare
  original_definition text;
  mutated_definition text;
  guarded_block text := $guard$if p_project_id is not null and not exists (
    select 1 from public.projects project_row
    where project_row.id = p_project_id and project_row.org_id = v_org_id
  ) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;$guard$;
begin
  select pg_get_functiondef(to_regprocedure('public.get_financial_statement_catalogue(uuid)')) into original_definition;
  mutated_definition := replace(original_definition, guarded_block,
    'if p_project_id is not null then if false then raise exception ''Not permitted'' using errcode = ''42501''; end if; end if;');
  if mutated_definition = original_definition then raise exception 'project authorization mutation target drifted'; end if;
  execute mutated_definition;
end $$;
set local role authenticated;
set local request.jwt.claims='{"sub":"03180200-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ declare response jsonb;
begin
  response := public.get_financial_statement_catalogue('03180200-0000-0000-0000-000000000004');
  if response->>'state' <> 'unavailable' then
    raise exception 'project-authorization mutation did not change the bound RPC behavior';
  end if;
end $$;
select '0318_PROJECT_MUTATION_DETECTED';
rollback;
`;
  const output = psql(script);
  assert.match(output, /0318_PROJECT_MUTATION_DETECTED/);
});

test('0318 project-staff company-label view mutation is detected by the read envelope', () => {
  verifyLocalTarget();
  const migration = sqlFile('supabase/migrations/0318_financial_statement_reads.sql');
  const viewStart = migration.indexOf('create view public.erp_financial_statement_availability');
  const viewEnd = migration.indexOf('\nalter view public.erp_financial_statement_availability owner to postgres;', viewStart);
  assert.ok(viewStart >= 0 && viewEnd > viewStart, '0318 availability view definition remains locatable');
  let mutatedView = migration.slice(viewStart, viewEnd).replace('create view public.', 'create or replace view public.');
  const labelGate = "case when public.auth_role()::text in ('Admin', 'Finance', 'Executive')\n       then nullif(btrim(binding.config ->> 'company'), '') else null end as company_label,";
  mutatedView = mutatedView.replace(labelGate, "nullif(btrim(binding.config ->> 'company'), '') as company_label,");
  assert.notEqual(mutatedView, migration.slice(viewStart, viewEnd), 'company-label mutation target must match the shipped view');

  const downNative = sqlFile('supabase/migrations/rollback/0319_financial_statement_native_reports_down.sql');
  const script = `begin;
${downNative}
insert into public.organizations(id,name,default_currency,default_timezone)
  values ('03180300-0000-0000-0000-000000000001','Synthetic label-mutation org','IDR','UTC');
insert into auth.users(id,email) values ('03180300-0000-0000-0000-000000000002','statement-label-mutation@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
  ('03180300-0000-0000-0000-000000000002','03180300-0000-0000-0000-000000000001',
   'Synthetic label-mutation PM','statement-label-mutation@example.test','Project Manager','active');
insert into public.projects(id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
  tax_base_numerator,tax_base_denominator,subject_to_vat,project_manager_id) values
  ('03180300-0000-0000-0000-000000000003','03180300-0000-0000-0000-000000000001',
   'Synthetic label project','Ongoing Project','IDR',1000,'exclusive',0,0,1,1,false,'03180300-0000-0000-0000-000000000002');
insert into public.external_org_bindings(id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at,
  statement_full_ledger_replay_needed,statement_update_delayed,statement_last_attempt_at,statement_calendar)
values ('03180300-0000-0000-0000-000000000004','03180300-0000-0000-0000-000000000001','erpnext',
  'https://synthetic.invalid','fixture',16,'{"company":"Synthetic Private Label Co"}','2024-02-01T00:00:00Z',false,true,null,null);
set local role authenticated;
set local request.jwt.claims='{"sub":"03180300-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if public.get_financial_statement_catalogue('03180300-0000-0000-0000-000000000003')->'companyLabel' <> 'null'::jsonb then
    raise exception 'unmutated PM catalogue exposed a company label';
  end if;
end $$;
reset role;
${mutatedView}
set local role authenticated;
set local request.jwt.claims='{"sub":"03180300-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if public.get_financial_statement_catalogue('03180300-0000-0000-0000-000000000003')->'companyLabel' <> '"Synthetic Private Label Co"'::jsonb then
    raise exception 'company-label mutation did not change the bound read behavior';
  end if;
end $$;
select '0318_LABEL_MUTATION_DETECTED';
rollback;
`;
  const output = psql(script);
  assert.match(output, /0318_LABEL_MUTATION_DETECTED/);
});
