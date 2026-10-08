import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const psql = '/opt/homebrew/opt/libpq/bin/psql';
const dbUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ids = Object.fromEntries(['org','user','vendor','case','bill','slipA','slipB','replacement'].map((key) => [key, randomUUID()]));
const appA = `bupot-a-${randomUUID()}`;
const appB = `bupot-b-${randomUUID()}`;

function run(sql, app = 'bupot-setup') {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, [dbUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], { env: { ...process.env, PGAPPNAME: app }, stdio: ['pipe','pipe','pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`${err}\n${out}`)));
    child.stdin.end(sql);
  });
}
function session(sql, app) {
  const child = spawn(psql, [dbUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], { env: { ...process.env, PGAPPNAME: app }, stdio: ['pipe','pipe','pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out, err })));
  child.stdin.end(sql);
  return { done, child };
}
const role = (actor) => `set local request.jwt.claims='{"sub":"${actor}","role":"authenticated"}'; set local role authenticated;`;
const recordSql = (slip, number) => `select * from public.record_vendor_withholding_slip('${slip}','${ids.vendor}','${number}',current_date,date_trunc('month',current_date)::date,'pph23',1000,100,array['${ids.bill}'::uuid],'{}');`;
const waitForAdvisory = async () => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await run(`select count(*) from pg_stat_activity where application_name='${appB}' and wait_event_type='Lock' and wait_event='advisory';`);
    if (result === '1') return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('B did not observably wait on the organization advisory lock');
};

await run(`
insert into public.organizations(id,name,default_currency,default_timezone) values ('${ids.org}','Synthetic Bupot Race','IDR','UTC');
insert into auth.users(id,email) values ('${ids.user}','${ids.user}@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values ('${ids.user}','${ids.org}','Synthetic race fixture','${ids.user}@example.test','Finance','active');
insert into public.companies(id,org_id,name,type) values ('${ids.vendor}','${ids.org}','Synthetic race vendor','Vendor');
insert into public.procurements(id,org_id,title,status,requested_by_id,vendor_id) values ('${ids.case}','${ids.org}','Synthetic race case','Paid','${ids.user}','${ids.vendor}');
insert into public.procurement_invoices(id,org_id,procurement_id,status,invoice_date,amount,currency,tax_treatment,tax_amount,withheld_amount,withheld_pph_type,reference_number)
values ('${ids.bill}','${ids.org}','${ids.case}','Paid',current_date,1000,'IDR','exclusive',0,100,'pph23','SYNTHETIC-RACE');
`);

try {
  // Duplicate reservation: A commits the first record while B is blocked in the real RPC.
  const a = session(`begin; ${role(ids.user)} ${recordSql(ids.slipA,'RACE-A')} select pg_sleep(1.5); commit;`, appA);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const b = session(`begin; ${role(ids.user)} ${recordSql(ids.slipB,'RACE-B')} commit;`, appB);
  await waitForAdvisory();
  const aResult = await a.done; if (aResult.code !== 0) throw new Error(`A duplicate race failed: ${aResult.err}`);
  const bResult = await b.done; if (bResult.code === 0 || !bResult.err.includes('bupot-bill-covered')) throw new Error(`B must refuse as covered after A commits: ${bResult.err}`);
  let counts = await run(`select (select count(*) from public.vendor_withholding_slips where org_id='${ids.org}' and status='active')||':'||(select count(*) from public.vendor_withholding_slip_bills where org_id='${ids.org}' and released_at is null);`);
  if (counts !== '1:1') throw new Error(`duplicate interleave left unexpected active evidence ${counts}`);
  console.log('PASS duplicate-record interleave: A committed; B waited then refused bupot-bill-covered; one active header/link.');

  // Void/re-record: B must wait for the complete void transaction, then reserve the same bill.
  const voidA = session(`begin; ${role(ids.user)} select * from public.void_vendor_withholding_slip('${ids.slipA}',1,'release for replacement'); select pg_sleep(1.5); commit;`, appA);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const replacementB = session(`begin; ${role(ids.user)} ${recordSql(ids.replacement,'REPLACEMENT-RACE')} commit;`, appB);
  await waitForAdvisory();
  const voidResult = await voidA.done; if (voidResult.code !== 0) throw new Error(`A void race failed: ${voidResult.err}`);
  const replacementResult = await replacementB.done; if (replacementResult.code !== 0) throw new Error(`B replacement should succeed after committed void: ${replacementResult.err}`);
  counts = await run(`select (select count(*) from public.vendor_withholding_slip_bills where org_id='${ids.org}' and released_at is not null)||':'||(select count(*) from public.vendor_withholding_slip_bills where org_id='${ids.org}' and released_at is null);`);
  if (counts !== '1:1') throw new Error(`void/re-record interleave did not retain/re-reserve exactly once: ${counts}`);
  console.log('PASS void/re-record interleave: B waited; old snapshot retained/released and one replacement reservation committed.');
} finally {
  await run(`begin; alter table public.vendor_withholding_slip_bills disable trigger vendor_withholding_slip_bills_integrity; alter table public.vendor_withholding_slips disable trigger vendor_withholding_slips_integrity; delete from public.record_changes where org_id='${ids.org}'; delete from public.audit_events where org_id='${ids.org}'; delete from public.vendor_withholding_slip_bills where org_id='${ids.org}'; delete from public.vendor_withholding_slips where org_id='${ids.org}'; alter table public.vendor_withholding_slip_bills enable trigger vendor_withholding_slip_bills_integrity; alter table public.vendor_withholding_slips enable trigger vendor_withholding_slips_integrity; delete from public.procurement_invoices where org_id='${ids.org}'; delete from public.procurements where org_id='${ids.org}'; delete from public.companies where org_id='${ids.org}'; delete from public.profiles where org_id='${ids.org}'; delete from auth.users where id='${ids.user}'; delete from public.organizations where id='${ids.org}'; commit;`);
}
