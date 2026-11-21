// #2588: two-session proof of the opening-balance locks. Builder-run gate (like stockPosting.concurrent.integration.mjs, not in CI):
//   scripts/with-db-lock.sh node pmo-portal/src/lib/db/openingBalances.concurrent.integration.mjs
// 1. A work-order reversal holds the work order row (the row acceptance prepare takes), so neither runs beside the other.
// 2. Loads of one organisation queue, so two loads at different dates cannot both pass the one-go-live-date rule.
// Each run writes into fresh throwaway organisations that are left behind (opening rows are audited, never deleted).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const psql = process.env.PSQL ?? '/opt/homebrew/opt/libpq/bin/psql';
const dbUrl = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const app = (tag) => `opb-race-${tag}-${randomUUID()}`;

function session(sql, appName = app('s')) {
  const child = spawn(psql, [dbUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], { env: { ...process.env, PGAPPNAME: appName }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out: out.trim(), err })));
  child.stdin.end(sql);
  return { done, appName };
}
async function run(sql) {
  const r = await session(sql, 'opb-race-setup').done;
  if (r.code !== 0) throw new Error(`${r.err}\n${r.out}`);
  return r.out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(appName, where) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await run(`select count(*) from pg_stat_activity where application_name='${appName}' and ${where};`) === '1') return true;
    await sleep(20);
  }
  return false;
}
const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL ${msg}`); };
const asAdmin = (u) => `set local request.jwt.claims='{"sub":"${u}","role":"authenticated"}'; set local role authenticated;`;

// One organisation with an Admin, a project and `n` running work orders, each with one allocated line.
async function fixture(n) {
  const id = { org: randomUUID(), admin: randomUUID(), project: randomUUID(), wos: [], boqs: [] };
  let sql = `insert into public.organizations(id,name,default_currency,default_timezone) values ('${id.org}','Synthetic Opening ${id.org}','USD','UTC');
insert into auth.users(id,email) values ('${id.admin}','${id.admin}@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values ('${id.admin}','${id.org}','Synthetic admin','${id.admin}@example.test','Admin','active');
insert into public.projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,currency) values ('${id.project}','${id.org}','Synthetic project','Ongoing Project',100000,'exclusive',0,'USD');\n`;
  for (let i = 0; i < n; i++) {
    const wo = randomUUID(); const boq = randomUUID(); id.wos.push(wo); id.boqs.push(boq);
    sql += `insert into public.boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values ('${boq}','${id.org}','${id.project}','L${i}','line','m',10,100);
insert into public.work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount,currency) values ('${wo}','${id.org}','${id.project}','WO ${i}','Issued',1000,'exclusive',0,'USD');
insert into public.work_order_lines(org_id,work_order_id,boq_item_id,quantity) values ('${id.org}','${wo}','${boq}',10);\n`;
  }
  await run(sql);
  return id;
}
const load = (f, i, date) => `select public.load_work_order_opening('${f.wos[i]}', ${date}, '[{"boq_item_id":"${f.boqs[i]}","certified_quantity":1,"claimed_quantity":0}]'::jsonb);`;

// 1. reversal holds the work order row
{
  const f = await fixture(1);
  const opening = await run(`begin; ${asAdmin(f.admin)} ${load(f, 0, 'current_date - 3')} commit;`);
  const holder = session(`begin; ${asAdmin(f.admin)} select public.reverse_opening_balance('${opening}'); select pg_sleep(3); rollback;`, app('reverse'));
  assert(await waitFor(holder.appName, "wait_event='PgSleep'"), 'the reversal reached its pause');
  // NO KEY UPDATE conflicts with the reversal's FOR UPDATE but not with the key-share lock its later writes take, so a
  // refusal here proves the row is held from the start of the reversal (before its activity check), as acceptance prepare needs.
  const probe = await session(`begin; select 1 from public.work_orders where id='${f.wos[0]}' for no key update nowait; rollback;`).done;
  const held = await holder.done;
  assert(held.code === 0, `the reversal itself ran: ${held.err}`);
  assert(probe.code !== 0 && /could not obtain lock/.test(probe.err), 'a reversal in flight holds the work order row');
  console.log('ok 1 - a work-order reversal holds the work order row');
}

// 2. two loads at different dates in one organisation: the second waits, then is refused
{
  const f = await fixture(2);
  const first = session(`begin; ${asAdmin(f.admin)} ${load(f, 0, 'current_date - 3')} select pg_sleep(2); commit;`, app('first'));
  assert(await waitFor(first.appName, "wait_event='PgSleep'"), 'the first load reached its pause');
  const second = session(`begin; ${asAdmin(f.admin)} ${load(f, 1, 'current_date - 4')} commit;`, app('second'));
  const waited = await waitFor(second.appName, "wait_event_type='Lock'");
  const [a, b] = [await first.done, await second.done];
  assert(a.code === 0, `the first load committed: ${a.err}`);
  assert(waited, 'the second load queued behind the first');
  assert(b.code !== 0 && /one go-live date/.test(b.err), `the second load at another date is refused: ${b.err || b.out}`);
  const dates = await run(`select count(distinct as_of) from public.opening_balances where org_id='${f.org}' and reversed_at is null;`);
  assert(dates === '1', 'the organisation has one go-live date');
  console.log('ok 2 - concurrent loads keep one go-live date');
}
