import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

if (process.env.PMO_DB_LOCK_HELD !== '1') throw new Error('Run under scripts/with-db-lock.sh');
const container = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_pmo-portal';
const ids = { org:'15080000-0000-0000-0000-000000000101', actor:'15080000-0000-0000-0000-000000000102', unit:'15080000-0000-0000-0000-000000000103', item:'15080000-0000-0000-0000-000000000104', wh:'15080000-0000-0000-0000-000000000105', dest:'15080000-0000-0000-0000-000000000106', first:'15080000-0000-0000-0000-000000000107', second:'15080000-0000-0000-0000-000000000108' };
const args = ['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'];
function sql(statement) {
  const result = spawnSync('docker',args,{input:statement,encoding:'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}
function session(statement, keepOpen=false) {
  const child = spawn('docker',args); let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;}); child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done = new Promise(resolve=>child.on('close',code=>resolve({code,stdout,stderr})));
  child.stdin.write(statement+'\n'); if (!keepOpen) child.stdin.end();
  return { child, done };
}
async function waitFor(query, label) {
  for (let n=0;n<100;n++) { if (sql(query)==='1') return; await delay(50); }
  throw new Error(`Timed out waiting for ${label}`);
}
const state = (name, predicate) => `select count(*) from pg_stat_activity where application_name='${name}' and ${predicate};`;
const claim = id => `update public.external_command_outbox set state='committing',claim_generation=claim_generation+1 where pmo_record_id='${id}';`;
const save = id => `set local role authenticated; set local request.jwt.claims='{"sub":"${ids.actor}","role":"authenticated"}'; select public.save_stock_draft('${id}',jsonb_build_object('warehouse_id','${ids.wh}','to_warehouse_id','${ids.dest}'),jsonb_build_array(jsonb_build_object('item_id','${ids.item}','quantity',2)));`;
async function race(holderSql,waiterSql,prefix,expected) {
  const holder=session(`set application_name='${prefix}-holder'; begin; ${holderSql}`,true);
  let waiter;
  try {
    await waitFor(state(`${prefix}-holder`,"state='idle in transaction'"),`${prefix} holder`);
    waiter=session(`set application_name='${prefix}-waiter'; begin; ${waiterSql} commit;`);
    await waitFor(state(`${prefix}-waiter`,"wait_event_type='Lock'"),`${prefix} lock`);
    holder.child.stdin.end('commit;\n\\q\n');
    const first=await holder.done, second=await waiter.done;
    if (first.code!==0 || second.code===0 || !second.stderr.includes(expected)) throw new Error(`${prefix}: holder=${first.code}, waiter=${second.code}, ${second.stderr}`);
    console.log(`${prefix}: waiter blocked then refused ${expected}`);
  } finally { if (holder.child.exitCode===null) holder.child.kill(); if (waiter && waiter.child.exitCode===null) waiter.child.kill(); }
}
try {
  sql(`insert into organizations(id,name) values ('${ids.org}','Stock race');
insert into auth.users(id,email) values ('${ids.actor}','stock-race@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('${ids.actor}','${ids.org}','Stock race','stock-race@example.invalid','Engineer','active');
insert into stock_units(id,org_id,code,name,whole_only) values ('${ids.unit}','${ids.org}','R','Race',true);
insert into stock_items(id,org_id,code,name,unit_id) values ('${ids.item}','${ids.org}','R','Race','${ids.unit}');
insert into stock_warehouses(id,org_id,code,name,kind) values ('${ids.wh}','${ids.org}','W','Warehouse','site'),('${ids.dest}','${ids.org}','D','Destination','central');
insert into stock_warehouse_keepers(org_id,warehouse_id,user_id) values ('${ids.org}','${ids.wh}','${ids.actor}');
insert into external_domain_ownership(org_id,external_tier,domain) values ('${ids.org}','odoo','inventory');
insert into external_org_bindings(org_id,external_tier,site_url,secret_ref,status,config,activated_at) values ('${ids.org}','odoo','fixture','fixture','active','{"odoo_company_id":42}',now());
insert into stock_documents(id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by) values ('${ids.first}','${ids.org}','R1','transfer','${ids.wh}','${ids.dest}',current_date,'${ids.actor}'),('${ids.second}','${ids.org}','R2','transfer','${ids.wh}','${ids.dest}',current_date,'${ids.actor}');
insert into stock_document_lines(org_id,document_id,line_no,item_id,quantity) values ('${ids.org}','${ids.first}',1,'${ids.item}',1),('${ids.org}','${ids.second}',1,'${ids.item}',1);
set role service_role; insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
select '${ids.org}','inventory',d.id::text,'stock:'||d.id::text,'odoo','create','failed','${ids.actor}',jsonb_build_object('stockDocumentId',d.id,'documentRevision',d.revision,'odooCompanyId',42) from stock_documents d where d.id in ('${ids.first}','${ids.second}');`);
  await race(claim(ids.first),save(ids.first),'stock-claim-first','STK_PENDING');
  await race(save(ids.second),claim(ids.second),'stock-save-first','STK_COMMAND');
} finally {
  sql(`delete from external_command_outbox where org_id='${ids.org}'; delete from stock_document_lines where org_id='${ids.org}'; delete from stock_documents where org_id='${ids.org}'; delete from external_domain_ownership where org_id='${ids.org}'; delete from external_org_bindings where org_id='${ids.org}'; delete from stock_warehouse_keepers where org_id='${ids.org}'; delete from stock_items where org_id='${ids.org}'; delete from stock_units where org_id='${ids.org}'; delete from stock_warehouses where org_id='${ids.org}'; delete from profiles where id='${ids.actor}'; delete from auth.users where id='${ids.actor}'; delete from organizations where id='${ids.org}';`);
}
