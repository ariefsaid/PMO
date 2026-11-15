import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const container = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_pmo-portal';
const args = ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];
const q = (sql) => {
  const r = spawnSync('docker', args, { input: sql, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
function session(sql) {
  const p = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.setEncoding('utf8').on('data', x => { out += x; });
  p.stderr.setEncoding('utf8').on('data', x => { err += x; });
  const done = once(p, 'close').then(([code]) => ({ code, out, err }));
  p.stdin.write(sql);
  return { p, done, output: () => out };
}
async function marker(s, text) {
  for (let i = 0; i < 100; i++) {
    if (s.output().includes(text)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`session did not reach ${text}: ${s.output()}`);
}
const org = 'a8710000-0000-0000-0000-000000000001';
const uid = 'a8710000-0000-0000-0000-000000000002';
const binding = 'a8710000-0000-0000-0000-000000000003';
const unit = 'a8710000-0000-0000-0000-000000000004';
const run = 'a8710000-0000-0000-0000-000000000005';
const p1 = 'a8710000-0000-0000-0000-000000000011';
const p2 = 'a8710000-0000-0000-0000-000000000012';
const i1 = 'a8710000-0000-0000-0000-000000000021';
const i2 = 'a8710000-0000-0000-0000-000000000022';
const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
let first, second;
try {
  q(`insert into organizations(id,name) values ('${org}','Race');
insert into auth.users(id,email) values ('${uid}','stock-race@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('${uid}','${org}','Admin','stock-race@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,status,config,activated_at) values ('${binding}','${org}','odoo','https://erp.example.test','test','active','{"odoo_company_id":1}',now());
insert into stock_units(id,org_id,code,name) values ('${unit}','${org}','EA','Each');
insert into stock_items(id,org_id,code,name,unit_id) values ('${i1}','${org}','I1','One','${unit}'),('${i2}','${org}','I2','Two','${unit}');
insert into erp_connect_runs(id,org_id,binding_id,external_tier,state) values ('${run}','${org}','${binding}','odoo','ready');
insert into erp_connect_staged(run_id,org_id,kind,external_id,row) values ('${run}','${org}','stock_item','101','{"externalId":"101","active":true}');
insert into erp_connect_proposals(id,org_id,binding_id,external_tier,run_id,kind,outcome,identity,pmo_ids,external_ids) values
 ('${p1}','${org}','${binding}','odoo','${run}','stock_item','link','race1',array['${i1}'],array['101']),
 ('${p2}','${org}','${binding}','odoo','${run}','stock_item','link','race2',array['${i2}'],array['101']);`);
  first = session(`begin; set local role authenticated; set local request.jwt.claims = '${claims}'; select public.accept_connect_proposals('odoo','stock_item',array['${p1}'::uuid]); select 'FIRST_READY';\n`);
  await marker(first, 'FIRST_READY');
  second = session(`set application_name = 'stock-connect-race-second'; begin; set local role authenticated; set local request.jwt.claims = '${claims}'; select 'SECOND_READY'; select public.accept_connect_proposals('odoo','stock_item',array['${p2}'::uuid]); select reason_text from public.erp_connect_proposals where id='${p2}'; commit;\n`);
  await marker(second, 'SECOND_READY');
  const waiting = q("select pg_sleep(0.3); select count(*) from pg_stat_activity where application_name='stock-connect-race-second' and wait_event_type='Lock';");
  assert.equal(waiting, '1', `second session must wait for the first transaction: ${waiting}`);
  first.p.stdin.end('commit;\n');
  second.p.stdin.end();
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.err);
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /Stock record is already linked: the ERP record has another PMO record/);
  assert.equal(q(`select count(*) from public.external_refs where org_id='${org}' and domain='stock_items' and external_record_id='101';`), '1');
  console.log('AC-OSP-006 concurrent competing accepts: one link, one named refusal');
} finally {
  first?.p.stdin.destroy(); second?.p.stdin.destroy();
  q(`delete from public.audit_events where org_id='${org}';
delete from public.erp_connect_proposals where org_id='${org}';
delete from public.erp_connect_staged where org_id='${org}';
delete from public.erp_connect_runs where org_id='${org}';
delete from public.external_refs where org_id='${org}';
delete from public.stock_items where org_id='${org}';
delete from public.stock_units where org_id='${org}';
delete from public.external_org_bindings where org_id='${org}';
delete from public.profiles where org_id='${org}';
delete from auth.users where id='${uid}';
delete from public.organizations where id='${org}';`);
}
