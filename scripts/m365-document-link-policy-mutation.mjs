import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MUTATION_CASES = [
  { table: 'project_documents', policy: 'project_documents_write', command: 'ALL', operation: 'insert' },
  { table: 'project_documents', policy: 'project_documents_write', command: 'ALL', operation: 'update' },
  { table: 'project_documents', policy: 'project_documents_write', command: 'ALL', operation: 'delete' },
  { table: 'procurement_documents', policy: 'procurement_documents_write', command: 'ALL', operation: 'insert' },
  { table: 'procurement_documents', policy: 'procurement_documents_write', command: 'ALL', operation: 'update' },
  { table: 'procurement_documents', policy: 'procurement_documents_write', command: 'ALL', operation: 'delete' },
  { table: 'budget_version_document_links', policy: 'm365_budget_links_insert', command: 'INSERT', operation: 'insert' },
  { table: 'budget_version_document_links', policy: 'm365_budget_links_delete', command: 'DELETE', operation: 'delete' },
  { table: 'org_m365_document_settings', policy: 'm365_settings_insert', command: 'INSERT', operation: 'insert' },
  { table: 'org_m365_document_settings', policy: 'm365_settings_update', command: 'UPDATE', operation: 'update' },
];

// The separate restrictive delete rule is relaxed only inside this transaction to isolate the
// permissive write-policy oracle; its exact catalog expression is restored before the final probe.
const ISOLATION_POLICIES = [{ table: 'project_documents', policy: 'project_documents_delete_admin_only', command: 'DELETE' }];
const expected = new Map([...MUTATION_CASES, ...ISOLATION_POLICIES].map(({ table, policy, command }) => [`${table}.${policy}`, command]));
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;

export function parsePolicyCatalogRow(row) {
  const key = `${row?.tablename}.${row?.policyname}`;
  if (row?.schemaname !== 'public' || !expected.has(key)) throw new Error('Unexpected policy catalog identity; expected a public target policy.');
  if (row.cmd !== expected.get(key)) throw new Error(`Unexpected command for ${key}.`);
  const using = row.qual === null ? null : String(row.qual);
  const check = row.with_check === null ? null : String(row.with_check);
  if (row.cmd !== 'INSERT' && !using) throw new Error(`${key} is missing USING.`);
  if (row.cmd !== 'DELETE' && !check) throw new Error(`${key} is missing WITH CHECK.`);
  return { schema: row.schemaname, table: row.tablename, name: row.policyname, command: row.cmd, using, check };
}

export function policyAlterSql(policy, weaken) {
  const using = policy.command === 'INSERT' ? null : weaken ? 'true' : policy.using;
  const check = policy.command === 'DELETE' ? null : weaken ? 'true' : policy.check;
  if (policy.command !== 'INSERT' && !using) throw new Error('Policy restore requires USING.');
  if (policy.command !== 'DELETE' && !check) throw new Error('Policy restore requires WITH CHECK.');
  const clauses = [using === null ? null : `USING (${using})`, check === null ? null : `WITH CHECK (${check})`].filter(Boolean);
  return `ALTER POLICY ${identifier(policy.name)} ON ${identifier(policy.schema)}.${identifier(policy.table)} ${clauses.join(' ')};`;
}

const org = '10200000-0000-0000-0000-000000000001';
const settingsInsertOrg = '10200000-0000-0000-0000-000000000002';
const engineer = '10200000-0000-0000-0000-000000000101';
const settingsInsertEngineer = '10200000-0000-0000-0000-000000000103';
const pm = '10200000-0000-0000-0000-000000000102';
const project = '10200000-0000-0000-0000-000000000201';
const procurement = '10200000-0000-0000-0000-000000000202';
const budget = '10200000-0000-0000-0000-000000000203';
const projectIds = ['301', '302', '303'].map(id => `10200000-0000-0000-0000-000000000${id}`);
const projectProbeIds = ['331', '332', '333'].map(id => `10200000-0000-0000-0000-000000000${id}`);
const procurementIds = ['311', '312', '313'].map(id => `10200000-0000-0000-0000-000000000${id}`);
const procurementProbeIds = ['341', '342', '343'].map(id => `10200000-0000-0000-0000-000000000${id}`);
const budgetLinkIds = ['321', '322', '323'].map(id => `10200000-0000-0000-0000-000000000${id}`);

function fixtureSql() {
  const projectRows = projectIds.map((id, i) => `('${id}','${org}','${project}','Specification','Synthetic source ${i}','Draft','${pm}','onedrive','drive-mutation','project-item-${i}','https://example.invalid/project-${i}','Project file ${i}','file','${pm}',now())`).join(',\n');
  const procurementRows = procurementIds.map((id, i) => `('${id}','${org}','${procurement}','evidence','ref-${i}','Draft','2026-10-01','https://example.invalid/procurement-${i}','onedrive','drive-mutation','procurement-item-${i}','Procurement file ${i}','file','${pm}',now())`).join(',\n');
  const linkRows = budgetLinkIds.map((id, i) => `('${id}','${org}','${budget}','drive-mutation','budget-item-${i}','https://example.invalid/budget-${i}','Budget file ${i}','file','${pm}',now())`).join(',\n');
  return `
insert into public.organizations(id,name) values ('${org}','Synthetic policy mutation org'),('${settingsInsertOrg}','Synthetic settings insert org');
insert into auth.users(id,email) values ('${engineer}','mutation-engineer@example.invalid'),('${pm}','mutation-pm@example.invalid'),('${settingsInsertEngineer}','mutation-settings-engineer@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('${engineer}','${org}','Synthetic Engineer','mutation-engineer@example.invalid','Engineer','active'),
 ('${pm}','${org}','Synthetic Project Manager','mutation-pm@example.invalid','Project Manager','active'),
 ('${settingsInsertEngineer}','${settingsInsertOrg}','Synthetic Settings Engineer','mutation-settings-engineer@example.invalid','Engineer','active');
insert into public.org_features(org_id,feature_key,enabled,updated_by) values ('${org}','procurement',true,'${pm}');
insert into public.projects(id,org_id,name,status) values ('${project}','${org}','Synthetic mutation project','Ongoing Project');
insert into public.procurements(id,org_id,title,project_id,requested_by_id,status,total_value) values ('${procurement}','${org}','Synthetic mutation procurement','${project}','${pm}','Draft',0);
insert into public.budget_versions(id,org_id,project_id,version,name,status,created_by) values ('${budget}','${org}','${project}',77,'Synthetic mutation budget','Draft','${pm}');
insert into public.project_documents(id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
values ${projectRows};
insert into public.procurement_documents(id,org_id,procurement_id,type,reference_number,status,date,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
values ${procurementRows};
insert into public.budget_version_document_links(id,org_id,budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
values ${linkRows};
insert into public.org_m365_document_settings(org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by)
values ('${org}','site-mutation','Synthetic site','drive-mutation','Synthetic drive','${pm}');

-- Only the role guard is isolated; all other catalog grants, RLS policies, and triggers remain active.
alter table public.project_documents disable trigger project_m365_guard;
alter table public.procurement_documents disable trigger procurement_m365_guard;
alter table public.budget_version_document_links disable trigger budget_version_document_links_m365_stamp_guard;
create temporary table m365_policy_results(case_name text, phase text, changed boolean, note text);
grant insert on m365_policy_results to authenticated;
create function pg_temp.try_m365_policy_action(p_case text,p_phase text,p_sql text) returns void
language plpgsql as $$ declare n integer:=0; note text:=''; begin
  begin execute p_sql; get diagnostics n = row_count;
  exception when insufficient_privilege then get stacked diagnostics note = message_text; n:=0;
  end;
  if n=0 and note='' then note:='zero affected rows'; end if;
  insert into m365_policy_results values (p_case,p_phase,n>0,note);
end $$;
`;
}

function actionSql(caseInfo, phase) {
  const index = phase === 'baseline' ? 0 : phase === 'mutant' ? 1 : 2;
  if (caseInfo.table === 'project_documents') {
    const id = caseInfo.operation === 'insert' ? projectProbeIds[index] : projectIds[index];
    if (caseInfo.operation === 'insert') return `insert into public.project_documents(id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind) values ('${id}','${org}','${project}','Specification','Synthetic policy probe','Draft','${engineer}','onedrive','drive-mutation','probe-${index}','https://example.invalid/probe-${index}','Probe file','file') returning id`;
    if (caseInfo.operation === 'update') return `update public.project_documents set ms_item_name='Changed by policy probe' where id='${id}' returning id`;
    return `delete from public.project_documents where id='${id}' returning id`;
  }
  if (caseInfo.table === 'procurement_documents') {
    const id = caseInfo.operation === 'insert' ? procurementProbeIds[index] : procurementIds[index];
    if (caseInfo.operation === 'insert') return `insert into public.procurement_documents(id,org_id,procurement_id,type,reference_number,status,date,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind) values ('${id}','${org}','${procurement}','evidence','probe-${index}','Draft','2026-10-01','https://example.invalid/probe-${index}','onedrive','drive-mutation','probe-${index}','Probe file','file') returning id`;
    if (caseInfo.operation === 'update') return `update public.procurement_documents set ms_item_name='Changed by policy probe' where id='${id}' returning id`;
    return `delete from public.procurement_documents where id='${id}' returning id`;
  }
  if (caseInfo.table === 'budget_version_document_links') {
    const id = budgetLinkIds[index];
    if (caseInfo.operation === 'insert') return `insert into public.budget_version_document_links(budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind) values ('${budget}','drive-mutation','probe-${index}','https://example.invalid/probe-${index}','Probe file','file') returning id`;
    return `delete from public.budget_version_document_links where id='${id}' returning id`;
  }
  if (caseInfo.operation === 'insert') return `insert into public.org_m365_document_settings(default_site_id,default_site_name,default_drive_id,default_drive_name) values ('site-probe-${index}','Synthetic probe site','drive-probe-${index}','Synthetic probe drive') returning org_id`;
  return `update public.org_m365_document_settings set default_site_name='Changed by policy probe' where org_id='${org}' returning org_id`;
}

function policyQuerySql(table, policy) {
  return `select json_build_object('schemaname',schemaname,'tablename',tablename,'policyname',policyname,'cmd',cmd,'qual',qual,'with_check',with_check)::text from pg_policies where schemaname='public' and tablename=${literal(table)} and policyname=${literal(policy)};`;
}

function caseSql(caseInfo, policy, isolationPolicy) {
  const name = `${caseInfo.table}.${caseInfo.policy}:${caseInfo.operation}`;
  const actor = caseInfo.table === 'org_m365_document_settings' && caseInfo.operation === 'insert' ? settingsInsertEngineer : engineer;
  const mutate = policyAlterSql(policy, true);
  const restore = policyAlterSql(policy, false);
  const isolate = isolationPolicy ? policyAlterSql(isolationPolicy, true) : '';
  const restoreIsolation = isolationPolicy ? policyAlterSql(isolationPolicy, false) : '';
  const phase = p => `set local role authenticated;
set local request.jwt.claims = '{"sub":"${actor}","role":"authenticated"}';
select pg_temp.try_m365_policy_action(${literal(name)},${literal(p)},${literal(actionSql(caseInfo,p))});
reset role;`;
  return `
${isolate}
${phase('baseline')}
${mutate}
${phase('mutant')}
${restore}
${phase('restored')}
${restoreIsolation}
`;
}

function psql(sql) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export function buildMutationSql(policies) {
  const byKey = new Map(policies.map(policy => [`${policy.table}.${policy.name}`, policy]));
  const cases = MUTATION_CASES.map(item => {
    const policy = byKey.get(`${item.table}.${item.policy}`);
    const isolationPolicy = item.table === 'project_documents' && item.operation === 'delete'
      ? byKey.get('project_documents.project_documents_delete_admin_only') : null;
    if (!policy || policy.command !== item.command) throw new Error(`Catalog is missing expected policy ${item.table}.${item.policy}.`);
    if (item.table === 'project_documents' && item.operation === 'delete' && !isolationPolicy) throw new Error('Catalog is missing the independent project delete restriction needed to isolate the write-policy oracle.');
    return caseSql(item, policy, isolationPolicy);
  });
  return `begin;\nset local client_min_messages=warning;\n${fixtureSql()}\n${cases.join('\n')}\nselect json_agg(json_build_object('case',case_name,'phase',phase,'changed',changed,'note',note) order by case_name,phase)::text from m365_policy_results;\nrollback;\n`;
}

export function runMutationProof() {
  if (process.env.PMO_DB_LOCK_HELD !== '1') throw new Error('Run under scripts/with-db-lock.sh; refusing an unlocked database mutation.');
  const rows = JSON.parse(psql(`select coalesce(json_agg(json_build_object('schemaname',schemaname,'tablename',tablename,'policyname',policyname,'cmd',cmd,'qual',qual,'with_check',with_check)), '[]'::json)::text from pg_policies where schemaname='public' and (tablename,policyname) in (select * from (values ${[...MUTATION_CASES, ...ISOLATION_POLICIES].map(c => `(${literal(c.table)},${literal(c.policy)})`).filter((v,i,a)=>a.indexOf(v)===i).join(',')}) as targets(t,p));`));
  const policies = rows.map(parsePolicyCatalogRow);
  const sql = buildMutationSql(policies);
  const output = psql(sql);
  const payload = output.split('\n').filter(Boolean).at(-1);
  const results = JSON.parse(payload ?? 'null');
  if (!Array.isArray(results)) throw new Error('Local mutation proof returned no result manifest.');
  const grouped = new Map();
  for (const row of results) {
    const item = grouped.get(row.case) ?? {};
    item[row.phase] = row.changed;
    item[`${row.phase}_note`] = row.note;
    grouped.set(row.case, item);
  }
  for (const entry of MUTATION_CASES) {
    const key = `${entry.table}.${entry.policy}:${entry.operation}`;
    const result = grouped.get(key);
    if (!result || result.baseline !== false || result.mutant !== true || result.restored !== false) {
      throw new Error(`Mutation proof failed for ${key}; expected deny → allow → deny; observed ${JSON.stringify(result ?? null)}.`);
    }
  }
  return MUTATION_CASES.map(({ table, policy, operation }) => `${table}.${policy}:${operation}`).sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const killed = runMutationProof();
    console.log(`PASS local M365 link policy mutations: ${killed.length}/${MUTATION_CASES.length} killed; all policies restored`);
  } catch (error) {
    console.error(`FAIL local M365 link policy mutation: ${error.message}`);
    process.exitCode = 1;
  }
}
