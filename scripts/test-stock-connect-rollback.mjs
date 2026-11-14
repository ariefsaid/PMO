import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const container = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_pmo-portal';
const args = ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];
const down = readFileSync('supabase/migrations/rollback/0870_stock_connect_refs_down.sql', 'utf8');
const up = readFileSync('supabase/migrations/0870_stock_connect_refs.sql', 'utf8');
const names = ['apply_connect_link', 'accept_connect_proposals', 'unlink_connect_match', 'list_unlinkable_connect_matches', 'decide_connect_review'];
const sources = ['0750_party_link_rereads_revenue.sql', '0590_erp_connect_review_list.sql', '0496_odoo_project_links_config.sql', '0590_erp_connect_review_list.sql', '0590_erp_connect_review_list.sql'];
const previous = names.map((name, i) => {
  const text = readFileSync(`supabase/migrations/${sources[i]}`, 'utf8');
  const body = text.match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\nend \\$\\$;`, 'i'))?.[0];
  assert.ok(body, `missing predecessor for ${name}`);
  return body.replace(/^create function/i, 'create or replace function');
}).join('\n');
const q = sql => spawnSync('docker', args, { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const org = 'a8720000-0000-0000-0000-000000000001';
const binding = 'a8720000-0000-0000-0000-000000000002';
const run = 'a8720000-0000-0000-0000-000000000003';
const setup = `begin; insert into public.organizations (id,name) values ('${org}','Rollback test');\n`;
const bindingSql = `insert into public.external_org_bindings(id,org_id,external_tier,site_url,secret_ref,status,config) values ('${binding}','${org}','odoo','https://erp.example.test','test','active','{}');\n`;
const cases = [
  ['link', `insert into public.external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('${org}','stock_items','test','odoo','1');`],
  ['proposal', `${bindingSql}insert into public.erp_connect_proposals(org_id,binding_id,external_tier,kind,outcome,identity) values ('${org}','${binding}','odoo','stock_item','review','test');`],
  ['staged', `${bindingSql}insert into public.erp_connect_runs(id,org_id,binding_id,external_tier) values ('${run}','${org}','${binding}','odoo'); insert into public.erp_connect_staged(run_id,org_id,kind,external_id,row) values ('${run}','${org}','stock_warehouse','1','{}');`],
];
for (const [label, fixture] of cases) {
  const r = q(`${setup}${fixture}\n${down}`);
  assert.notEqual(r.status, 0, `${label} must refuse rollback`);
  assert.match(r.stderr, /stock connect rollback refused: stock links or setup rows exist/);
  console.log(`AC-OSP-006 rollback refused with ${label}`);
}
const predicate = `n.nspname='public' and p.proname in (${names.map(x => `'${x}'`).join(',')})`;
const catalogue = `select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as body, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${predicate}`;
const checks = `select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint where conname in ('erp_connect_staged_kind_check','erp_connect_proposals_kind_check')`;
const proof = `create temp table up_functions as ${catalogue};
create temp table up_checks as ${checks};
${previous}
create temp table before_functions as ${catalogue};
${up}
${down}
do $$ begin
 if (select count(*) from before_functions) <> 5 or exists ((select * from before_functions except ${catalogue}) union all (${catalogue} except select * from before_functions)) then
   raise exception 'rollback did not restore predecessor function bodies and grants';
 end if;
 if exists (select 1 from pg_constraint where conname in ('erp_connect_staged_kind_check','erp_connect_proposals_kind_check') and pg_get_constraintdef(oid) like '%stock_%') then
   raise exception 'rollback did not restore predecessor kind checks';
 end if;
end $$;
${up}
do $$ begin
 if exists ((select * from up_functions except ${catalogue}) union all (${catalogue} except select * from up_functions)) then raise exception 'up function bodies or grants differ'; end if;
 if exists ((select * from up_checks except ${checks}) union all (${checks} except select * from up_checks)) then raise exception 'up checks differ'; end if;
end $$;
select 'AC-OSP-006 empty rollback restores predecessors and reapply restores 0870';`;
const result = q(proof);
if (result.status !== 0) {
  const recovery = q(up);
  if (recovery.status !== 0) console.error(`Reapply recovery failed: ${recovery.stderr}`);
  throw new Error(result.stderr || result.stdout);
}
console.log(result.stdout.trim());
