import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const UP_PATH = new URL('../supabase/migrations/0292_m365_document_linking.sql', import.meta.url);
const DOWN_PATH = new URL('../supabase/migrations/rollback/0292_m365_document_linking_down.sql', import.meta.url);
const UPGRADE_TEST = 'supabase/migration-tests/m365_doc_linking_upgrade.test.sql';
const DB_CONTAINER = 'supabase_db_pmo-portal';

export function readMigrationPair(up = fs.readFileSync(UP_PATH, 'utf8'), down = fs.readFileSync(DOWN_PATH, 'utf8')) {
  const guardEnd = down.indexOf('end $$;');
  const firstDdl = down.search(/\b(drop|alter|create)\s+(trigger|function|table|index|type|policy|or replace function)\b/i);
  if (!up.includes('create type public.doc_source') || !up.includes('where file_path is not null')) {
    throw new Error('0292 up migration is missing the source type or upload backfill.');
  }
  if (guardEnd < 0 || firstDdl < 0 || firstDdl < guardEnd) {
    throw new Error('0292 down migration must run the live-reference refusal before DDL.');
  }
  for (const text of [
    'public.transition_document_status(p_doc_id uuid, p_to doc_status)',
    'grant insert on public.project_documents to authenticated',
    'm365_claim_document_checks',
    'drop table public.org_m365_document_settings',
  ]) if (!down.includes(text)) throw new Error(`0292 down migration is missing reversal step: ${text}`);
  return { up, down, guard: down.slice(0, guardEnd + 'end $$;'.length) };
}

const FIXTURE_IDS = {
  org: '10200000-0000-0000-0000-000000000001',
  user: '10200000-0000-0000-0000-000000000101',
  project: '10200000-0000-0000-0000-000000000201',
  procurement: '10200000-0000-0000-0000-000000000202',
  upload: '10200000-0000-0000-0000-000000000301',
  metadata: '10200000-0000-0000-0000-000000000302',
  guard: '10200000-0000-0000-0000-000000000303',
  procurementDoc: '10200000-0000-0000-0000-000000000311',
};

function fixtureParentsAndRows() {
  const i = FIXTURE_IDS;
  return `
insert into public.organizations(id,name) values ('${i.org}','Synthetic reversal org');
insert into auth.users(id,email) values ('${i.user}','m365-reversal@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('${i.user}','${i.org}','Synthetic reversal member','m365-reversal@example.invalid','Admin','active');
insert into public.projects(id,org_id,name,status) values
 ('${i.project}','${i.org}','Synthetic reversal project','Ongoing Project');
insert into public.procurements(id,org_id,title,project_id,requested_by_id,status,total_value) values
 ('${i.procurement}','${i.org}','Synthetic reversal procurement','${i.project}','${i.user}','Draft',0);
insert into public.project_documents
 (id,org_id,project_id,category,title,status,author_id,file_path,source)
values ('${i.upload}','${i.org}','${i.project}','Specification','Synthetic legacy upload','Draft','${i.user}','documents/m365-fixture.pdf','upload');
insert into public.project_documents
 (id,org_id,project_id,category,title,status,author_id)
values ('${i.metadata}','${i.org}','${i.project}','Specification','Synthetic metadata-only row','Draft','${i.user}');
insert into public.procurement_documents
 (id,org_id,procurement_id,type,reference_number,status,link)
values ('${i.procurementDoc}','${i.org}','${i.procurement}','evidence','legacy-url','Draft','https://example.invalid/legacy-reference');
`;
}

function catalogStateSql() {
  return `select jsonb_build_object(
    'tables',(select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod)) order by c.relname,a.attnum)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
      where n.nspname='public' and c.relname in ('project_documents','procurement_documents') and a.attnum>0 and not a.attisdropped),
    'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'cmd',cmd,'roles',roles,'permissive',permissive,'using',qual,'check',with_check) order by tablename,policyname)
      from pg_policies where schemaname='public' and tablename in ('project_documents','procurement_documents')),
    'table_grants',(select jsonb_agg(jsonb_build_object('table',table_name,'grantee',grantee,'privilege',privilege_type) order by table_name,grantee,privilege_type)
      from information_schema.role_table_grants where table_schema='public' and table_name in ('project_documents','procurement_documents')),
    'column_grants',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'grantee',grantee,'privilege',privilege_type) order by table_name,column_name,grantee,privilege_type)
      from information_schema.column_privileges where table_schema='public' and table_name in ('project_documents','procurement_documents')),
    'transition',pg_get_functiondef('public.transition_document_status(uuid,doc_status)'::regprocedure))`;
}

function stateAssertionSql(snapshotName) {
  return `do $$ begin if (${catalogStateSql()}) is distinct from (select snapshot from ${snapshotName}) then
    raise exception 'M365 reversal did not restore captured pre-feature catalogs'; end if; end $$;`;
}

function psql(sql, { allowErrors = false } = {}) {
  const result = spawnSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-X', '-qAt', '-v', `ON_ERROR_STOP=${allowErrors ? '0' : '1'}`, '-U', 'postgres', '-d', 'postgres'], {
    input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error) throw result.error;
  if (!allowErrors && result.status !== 0) throw new Error(output.trim() || `local psql exited ${result.status}`);
  return { status: result.status, output };
}

function verifyRefusal(down) {
  const i = FIXTURE_IDS;
  const sql = `begin;
set local client_min_messages=warning;
${fixtureParentsAndRows()}
create temporary table m365_before_guard as select (${catalogStateSql()}) as snapshot;
savepoint before_refusal;
insert into public.project_documents(id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
values ('${i.guard}','${i.org}','${i.project}','Specification','Synthetic live reference','Draft','${i.user}','onedrive','drive','guard-item','https://example.invalid/guard','Guard file','file','${i.user}',now());
${down}
rollback to savepoint before_refusal;
${stateAssertionSql('m365_before_guard')}
select 'M365_REFUSAL_STATE_OK';
rollback;
`;
  const result = psql(sql, { allowErrors: true });
  const refusal = 'Unlink Microsoft references and clear the default library before reversing this migration.';
  if (!result.output.includes(refusal)) throw new Error(`down migration did not refuse the synthetic live reference before DDL: ${result.output.slice(0,3000)}`);
  if (!result.output.includes('M365_REFUSAL_STATE_OK')) throw new Error(`live-reference refusal did not preserve the catalog snapshot: ${result.output.slice(-2000)}`);
}

function verifyTransactionalCycle({ up, down }) {
  const setup = fixtureParentsAndRows();
  const i = FIXTURE_IDS;
  const checks = `do $$ begin
  if not exists(select 1 from public.project_documents where id='${i.upload}' and source='upload' and file_path='documents/m365-fixture.pdf') then raise exception 'upload did not survive feature upgrade'; end if;
  if not exists(select 1 from public.project_documents where id='${i.metadata}' and source is null and project_id='${i.project}') then raise exception 'metadata-only row changed during upgrade'; end if;
  if not exists(select 1 from public.procurement_documents where id='${i.procurementDoc}' and source is null and link='https://example.invalid/legacy-reference') then raise exception 'plain URL changed during upgrade'; end if;
  if not exists(select 1 from public.profiles where id='${i.user}' and org_id='${i.org}') or not exists(select 1 from public.projects where id='${i.project}' and org_id='${i.org}') then raise exception 'parent or actor data changed'; end if;
end $$;`;
  const sql = `begin;
set local client_min_messages=warning;
${setup}
${down}
create temporary table m365_pre_feature_snapshot as select (${catalogStateSql()}) as snapshot;
${up}
${checks}
${down}
${stateAssertionSql('m365_pre_feature_snapshot')}
${up}
${checks}
rollback;
`;
  psql(sql);
}

function runUpgradeFixture(up, down) {
  const i = FIXTURE_IDS;
  const sql = `begin;
set local client_min_messages=warning;
insert into public.organizations(id,name) values ('${i.org}','Synthetic upgrade org');
insert into auth.users(id,email) values ('${i.user}','m365-upgrade@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values ('${i.user}','${i.org}','Synthetic upgrade member','m365-upgrade@example.invalid','Admin','active');
insert into public.projects(id,org_id,name,status) values ('${i.project}','${i.org}','Synthetic upgrade project','Ongoing Project');
insert into public.procurements(id,org_id,title,project_id,requested_by_id,status,total_value) values ('${i.procurement}','${i.org}','Synthetic upgrade procurement','${i.project}','${i.user}','Draft',0);
${down}
insert into public.project_documents(id,org_id,project_id,category,title,status,author_id,file_path) values
 ('${i.upload}','${i.org}','${i.project}','Specification','Synthetic legacy upload','Draft','${i.user}','documents/m365-fixture.pdf');
insert into public.project_documents(id,org_id,project_id,category,title,status,author_id) values
 ('${i.metadata}','${i.org}','${i.project}','Specification','Synthetic metadata-only row','Draft','${i.user}');
insert into public.procurement_documents(id,org_id,procurement_id,type,reference_number,status,link) values
 ('${i.procurementDoc}','${i.org}','${i.procurement}','evidence','legacy-url','Draft','https://example.invalid/legacy-reference');
${up}
commit;
`;
  psql(sql);
  try {
    const testOutput = execFileSync('supabase', ['test', 'db', UPGRADE_TEST], { cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 });
    if (!testOutput.includes('All tests successful')) throw new Error('upgrade backfill pgTAP did not report a complete pass.');
    const verify = psql(`select case when (select source='upload' and file_path='documents/m365-fixture.pdf' from public.project_documents where id='${i.upload}') and (select source is null and project_id='${i.project}' from public.project_documents where id='${i.metadata}') and (select source is null and link='https://example.invalid/legacy-reference' from public.procurement_documents where id='${i.procurementDoc}') then 'PASS' else 'FAIL' end;`);
    if (!verify.output.includes('PASS')) throw new Error('upgrade fixture changed legacy URL or parent data.');
  } finally {
    psql(`begin;
delete from public.audit_events where org_id='${i.org}';
delete from public.project_documents where id in ('${i.upload}','${i.metadata}');
delete from public.procurement_documents where id='${i.procurementDoc}';
delete from public.procurements where id='${i.procurement}';
delete from public.projects where id='${i.project}';
delete from public.profiles where id='${i.user}';
delete from auth.users where id='${i.user}';
delete from public.organizations where id='${i.org}';
commit;`);
  }
}

export function runReversalProof() {
  if (process.env.PMO_DB_LOCK_HELD !== '1') throw new Error('Run under scripts/with-db-lock.sh; refusing an unlocked local database.');
  const { up, down } = readMigrationPair();
  execFileSync('docker', ['inspect', DB_CONTAINER], { stdio: 'ignore' });
  verifyRefusal(down);
  verifyTransactionalCycle({ up, down });
  runUpgradeFixture(up, down);
  return { refusal: true, upDownUp: true, upgradeBackfill: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runReversalProof();
    console.log(`PASS local 0292 reversal witness: refusal=${result.refusal}, up/down/up=${result.upDownUp}, upgrade-backfill=${result.upgradeBackfill}`);
  } catch (error) {
    console.error(`FAIL local 0292 reversal witness: ${error.message}`);
    process.exitCode = 1;
  }
}
