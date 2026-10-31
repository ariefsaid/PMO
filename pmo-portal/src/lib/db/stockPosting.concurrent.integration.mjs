// #1512 S2b (NFR-STK-002, D3): two-session proof of the stock posting lock order, the oversell refusal and the idempotent race.
// Builder-run gate (like vendorWithholdingSlips.concurrent.integration.mjs, not in CI):
//   scripts/with-db-lock.sh node pmo-portal/src/lib/db/stockPosting.concurrent.integration.mjs
// Stock rows are append-only (no delete, even for the service role), so the fixture lives in a fresh throwaway
// organisation that is left behind; nothing outside it is written (control count below).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const psql = process.env.PSQL ?? '/opt/homebrew/opt/libpq/bin/psql';
const dbUrl = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ids = Object.fromEntries(['org', 'keeper', 'client', 'project', 'boq', 'unit', 'itemSell', 'itemLock', 'itemSwap', 'itemIdem', 'itemArch', 'itemRet', 'itemRet2', 'whArch', 'crid'].map((k) => [k, randomUUID()]));
const [whA, whB] = [randomUUID(), randomUUID()].sort();          // A < B, so "ascending" is observable
const app = (tag) => `stk-race-${tag}-${randomUUID()}`;

function session(sql, appName = app('s')) {
  const child = spawn(psql, [dbUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], { env: { ...process.env, PGAPPNAME: appName }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out: out.trim(), err })));
  child.stdin.end(sql);
  return { done, appName };
}
async function run(sql) {
  const r = await session(sql, 'stk-race-setup').done;
  if (r.code !== 0) throw new Error(`${r.err}\n${r.out}`);
  return r.out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForLock(appName) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await run(`select count(*) from pg_stat_activity where application_name='${appName}' and wait_event_type='Lock';`) === '1') return;
    await sleep(50);
  }
  throw new Error(`${appName} never waited on a lock`);
}
const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL ${msg}`); };
const asKeeper = `set local request.jwt.claims='{"sub":"${ids.keeper}","role":"authenticated"}'; set local role authenticated;`;
const lines = (item, qty, extra = '') => `jsonb_build_array(jsonb_build_object('item_id','${item}','quantity',${qty}${extra}))`;
const receive = (wh, item, qty, crid = null) =>
  `select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','${wh}'), ${lines(item, qty, ",'unit_cost',10")}, true${crid ? `, '${crid}'` : ''});`;
const issue = (wh, item, qty) =>
  `select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id','${wh}','project_id','${ids.project}'), ${lines(item, qty, `,'boq_item_id','${ids.boq}'`)}, true);`;
const transfer = (from, to, item, qty) =>
  `select public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id','${from}','to_warehouse_id','${to}'), ${lines(item, qty)}, true);`;
const holdRow = (item, wh, secs) => `begin; select 1 from public.stock_balances where item_id='${item}' and warehouse_id='${wh}' for update; select pg_sleep(${secs}); commit;`;
const tryRow = (item, wh) => session(`begin; select 1 from public.stock_balances where item_id='${item}' and warehouse_id='${wh}' for update nowait; rollback;`).done;
const balance = (item, wh) => run(`select qty_on_hand::text from public.stock_balances where item_id='${item}' and warehouse_id='${wh}';`);
const reconciles = (item) => run(`select count(*) from (select b.warehouse_id from public.stock_balances b
  left join (select warehouse_id, sum(qty_delta) q, sum(value_delta) v from public.stock_ledger where item_id='${item}' group by 1) s on s.warehouse_id = b.warehouse_id
  where b.item_id='${item}' and (coalesce(s.q,0) <> b.qty_on_hand or coalesce(s.v,0) <> b.value_on_hand)) bad;`);

const outsideBefore = await run(`select count(*) from public.stock_ledger where org_id <> '${ids.org}';`);

await run(`
insert into public.organizations(id,name,default_currency,default_timezone) values ('${ids.org}','Synthetic Stock Race','IDR','UTC');
insert into auth.users(id,email) values ('${ids.keeper}','${ids.keeper}@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values ('${ids.keeper}','${ids.org}','Synthetic keeper','${ids.keeper}@example.test','Engineer','active');
insert into public.companies(id,org_id,name,type) values ('${ids.client}','${ids.org}','Synthetic client','Client');
insert into public.projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,client_id) values ('${ids.project}','${ids.org}','Synthetic project','Ongoing Project',1,'exclusive',0,'${ids.client}');
insert into public.boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values ('${ids.boq}','${ids.org}','${ids.project}','R-1','race','m',1,1);
insert into public.stock_units(id,org_id,code,name,whole_only) values ('${ids.unit}','${ids.org}','pc','Piece',true);
insert into public.stock_items(id,org_id,code,name,unit_id) values
  ('${ids.itemSell}','${ids.org}','SELL','Oversell','${ids.unit}'), ('${ids.itemLock}','${ids.org}','LOCK','Lock order','${ids.unit}'),
  ('${ids.itemSwap}','${ids.org}','SWAP','Opposing','${ids.unit}'),  ('${ids.itemIdem}','${ids.org}','IDEM','Idempotent','${ids.unit}'),
  ('${ids.itemArch}','${ids.org}','ARCH','Archive race','${ids.unit}'),
  ('${ids.itemRet}','${ids.org}','RET','Return cap','${ids.unit}'), ('${ids.itemRet2}','${ids.org}','RET2','Return deadlock','${ids.unit}');
insert into public.stock_warehouses(id,org_id,code,name,kind) values ('${whA}','${ids.org}','RA','Race A','site'), ('${whB}','${ids.org}','RB','Race B','site'),
  ('${ids.whArch}','${ids.org}','RX','Race archive','site');
insert into public.stock_warehouse_keepers(org_id,warehouse_id,user_id) values ('${ids.org}','${whA}','${ids.keeper}'), ('${ids.org}','${whB}','${ids.keeper}'),
  ('${ids.org}','${ids.whArch}','${ids.keeper}');
`);
await run(`begin; ${asKeeper} ${receive(whA, ids.itemSell, 10)} ${receive(whA, ids.itemLock, 10)} ${receive(whB, ids.itemLock, 10)}
  ${receive(whA, ids.itemSwap, 1000)} ${receive(whB, ids.itemSwap, 1000)} ${receive(whA, ids.itemRet, 20)} ${receive(whA, ids.itemRet2, 20)} commit;`);

// 1. Oversell: two issues of 6 against 10 on hand; B waits for A's balance lock, then is refused.
{
  const a = session(`begin; ${asKeeper} ${issue(whA, ids.itemSell, 6)} select pg_sleep(1.5); commit;`);
  await sleep(150);
  const b = session(`begin; ${asKeeper} ${issue(whA, ids.itemSell, 6)} commit;`, app('oversell-b'));
  await waitForLock(b.appName);
  const [ra, rb] = [await a.done, await b.done];
  assert(ra.code === 0, `oversell: A must post (${ra.err})`);
  assert(rb.code !== 0 && rb.err.includes('STK_INSUFFICIENT'), `oversell: B must be refused STK_INSUFFICIENT (${rb.err})`);
  assert(await balance(ids.itemSell, whA) === '4.000', 'oversell: final balance must be 4');
  assert(await run(`select count(*) from public.stock_documents where org_id='${ids.org}' and kind='issue' and status='Posted';`) === '1', 'oversell: exactly one posted issue');
  console.log('PASS oversell: A posted, B waited then refused STK_INSUFFICIENT, balance 4, one posted issue.');
}

// 2. Lock order, forward: S1 holds B; a transfer A -> B blocks on B while already holding A.
{
  const hold = session(holdRow(ids.itemLock, whB, 3));
  await sleep(300);
  const s2 = session(`begin; ${asKeeper} ${transfer(whA, whB, ids.itemLock, 1)} commit;`, app('fwd'));
  await waitForLock(s2.appName);
  const probe = await tryRow(ids.itemLock, whA);
  assert(probe.code !== 0 && probe.err.includes('could not obtain lock'), `lock order forward: A must already be held by the A -> B transfer (${probe.err || 'probe got the lock'})`);
  const [rh, r2] = [await hold.done, await s2.done];
  assert(rh.code === 0 && r2.code === 0, `lock order forward: both sessions must finish (${rh.err}${r2.err})`);
  console.log('PASS lock order forward: the A -> B transfer held A while waiting for B.');
}

// 3. Lock order, reverse: S1 holds A; a transfer B -> A blocks on A holding nothing, so B is free.
{
  const hold = session(holdRow(ids.itemLock, whA, 3));
  await sleep(300);
  const s2 = session(`begin; ${asKeeper} ${transfer(whB, whA, ids.itemLock, 1)} commit;`, app('rev'));
  await waitForLock(s2.appName);
  const probe = await tryRow(ids.itemLock, whB);
  assert(probe.code === 0, `lock order reverse: B must be free while the B -> A transfer waits for A (${probe.err})`);
  const [rh, r2] = [await hold.done, await s2.done];
  assert(rh.code === 0 && r2.code === 0, `lock order reverse: both sessions must finish (${rh.err}${r2.err})`);
  console.log('PASS lock order reverse: the B -> A transfer locked by ascending key, not source first.');
}

// 4. Opposing transfers: 100 rounds of A -> B and B -> A together; zero deadlocks, balances reconcile.
{
  for (let i = 0; i < 100; i++) {
    const rs = await Promise.all([
      session(`begin; ${asKeeper} ${transfer(whA, whB, ids.itemSwap, 1)} commit;`).done,
      session(`begin; ${asKeeper} ${transfer(whB, whA, ids.itemSwap, 1)} commit;`).done,
    ]);
    for (const r of rs) assert(r.code === 0 && !r.err.includes('deadlock detected'), `opposing transfers round ${i}: ${r.err}`);
  }
  assert(await reconciles(ids.itemSwap) === '0', 'opposing transfers: balances must reconcile to the ledger');
  assert(await balance(ids.itemSwap, whA) === '1000.000' && await balance(ids.itemSwap, whB) === '1000.000', 'opposing transfers: both sides back at 1000');
  console.log('PASS opposing transfers: 100 rounds, zero deadlocks, balances reconcile.');
}

// 5. Idempotent race (AC-STK-012, unique-index path): one client_request_id, two sessions at once.
{
  const a = session(`begin; ${asKeeper} ${receive(whA, ids.itemIdem, 5, ids.crid)} select pg_sleep(1); commit;`);
  await sleep(150);
  const b = session(`begin; ${asKeeper} ${receive(whA, ids.itemIdem, 5, ids.crid)} commit;`, app('idem-b'));
  await waitForLock(b.appName);
  const [ra, rb] = [await a.done, await b.done];
  const uuid = /[0-9a-f-]{36}/;
  assert(ra.code === 0 && rb.code === 0, `idempotent: both calls succeed (${ra.err}${rb.err})`);
  assert(ra.out.match(uuid)?.[0] && ra.out.match(uuid)[0] === rb.out.match(uuid)?.[0], `idempotent: same document id (${ra.out} vs ${rb.out})`);
  assert(await run(`select count(*) from public.stock_documents where org_id='${ids.org}' and client_request_id='${ids.crid}';`) === '1', 'idempotent: exactly one document');
  assert(await run(`select count(*) from public.stock_ledger where org_id='${ids.org}' and item_id='${ids.itemIdem}';`) === '1', 'idempotent: exactly one ledger row');
  assert(await balance(ids.itemIdem, whA) === '5.000', 'idempotent: balance moved once');
  console.log('PASS idempotent race: same id, one document, one ledger row, balance moved once.');
}

// 6. Archive vs post, post first: an item with no stock is archived while its first receipt is in flight.
//    The archive must wait for the post, then be refused STK_HAS_STOCK (never an archived item holding stock).
{
  const p = session(`begin; ${asKeeper} ${receive(whA, ids.itemArch, 5)} select pg_sleep(1.5); commit;`);
  await sleep(300);
  const r = session(`update public.stock_items set archived_at = now() where id = '${ids.itemArch}';`, app('arch-item'));
  await waitForLock(r.appName);
  const [rp, rr] = [await p.done, await r.done];
  assert(rp.code === 0, `archive vs post (item): the post must commit (${rp.err})`);
  assert(rr.code !== 0 && rr.err.includes('STK_HAS_STOCK'), `archive vs post (item): the archive must be refused STK_HAS_STOCK (${rr.err || 'it committed'})`);
  assert(await run(`select (archived_at is null)::text from public.stock_items where id='${ids.itemArch}';`) === 'true', 'archive vs post (item): the item stays active');
  console.log('PASS archive vs post (item): the archive waited for the receipt, then was refused STK_HAS_STOCK.');
}

// 7. Archive vs post, archive first: a warehouse with no stock is being archived when a receipt into it posts.
//    The post must wait for the archive, then be refused STK_ARCHIVED (never stock in an archived warehouse).
{
  const r = session(`begin; update public.stock_warehouses set archived_at = now() where id = '${ids.whArch}'; select pg_sleep(1.5); commit;`);
  await sleep(300);
  const p = session(`begin; ${asKeeper} ${receive(ids.whArch, ids.itemSell, 5)} commit;`, app('arch-wh'));
  await waitForLock(p.appName);
  const [rr, rp] = [await r.done, await p.done];
  assert(rr.code === 0, `archive vs post (warehouse): the archive must commit (${rr.err})`);
  assert(rp.code !== 0 && rp.err.includes('STK_ARCHIVED'), `archive vs post (warehouse): the post must be refused STK_ARCHIVED (${rp.err || 'it committed'})`);
  assert(await run(`select count(*) from public.stock_balances where warehouse_id='${ids.whArch}' and qty_on_hand > 0;`) === '0', 'archive vs post (warehouse): no stock in the archived warehouse');
  console.log('PASS archive vs post (warehouse): the receipt waited for the archive, then was refused STK_ARCHIVED.');
}

// Returns: issue 2 of an item, then return against that issue line.
const issueLine = async (item) => {
  await run(`begin; ${asKeeper} ${issue(whA, item, 2)} commit;`);
  return run(`select l.id from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id where d.org_id='${ids.org}' and d.kind='issue' and l.item_id='${item}';`);
};
const ret = (wh, item, src, qty, post = true) =>
  `select public.create_stock_document(jsonb_build_object('kind','return','warehouse_id','${wh}','project_id','${ids.project}'), ${lines(item, qty, `,'source_line_id','${src}'`)}, ${post});`;

// 8. Return cap race: two returns of the whole issue, into two different warehouses (different balance locks),
//    A holds its post open; only the cited-line lock makes B wait, and B then re-checks the cap: it must be refused STK_RETURN_EXCEEDS.
{
  const src = await issueLine(ids.itemRet);
  // Drafts first, then post: create-and-post would already serialise on the per-org document number.
  const [dA, dB] = [await run(`begin; ${asKeeper} ${ret(whA, ids.itemRet, src, 2, false)} commit;`), await run(`begin; ${asKeeper} ${ret(whB, ids.itemRet, src, 2, false)} commit;`)];
  const a = session(`begin; ${asKeeper} select public.post_stock_document('${dA}'); select pg_sleep(1.5); commit;`);
  await sleep(300);
  const b = session(`begin; ${asKeeper} select public.post_stock_document('${dB}'); commit;`, app('retcap-b'));
  await waitForLock(b.appName);                       // B must queue on the cited line (it shares no balance row with A)
  const rs = [await a.done, await b.done];
  assert(rs.filter((r) => r.code === 0).length === 1, `return cap race: exactly one return posts (${rs.map((r) => r.err).join('|')})`);
  assert(rs.filter((r) => r.err.includes('STK_RETURN_EXCEEDS')).length === 1, `return cap race: the other is refused STK_RETURN_EXCEEDS (${rs.map((r) => r.err).join('|')})`);
  assert(await run(`select coalesce(sum(qty_delta),0)::text from public.stock_ledger where kind='return' and source_line_id='${src}';`) === '2.000', 'return cap race: returned in total 2');
  console.log('PASS return cap race: two returns into two warehouses, one posted, one refused STK_RETURN_EXCEEDS.');
}

// 9. Return deadlock: S1 saves a draft return of an issue line and holds its FK key-share on that line while S2 create-and-posts
//    a return of the same line; S1 then posts. The line lock must not conflict with the key-share, so neither is chosen as a deadlock victim.
{
  const src = await issueLine(ids.itemRet2);
  const draft = await run(`begin; ${asKeeper} ${ret(whA, ids.itemRet2, src, 1, false)} commit;`);
  const s1 = session(`begin; select 1 from public.stock_document_lines where id='${src}' for key share; select pg_sleep(1.5);
    ${asKeeper} select public.post_stock_document('${draft}'); commit;`);
  await sleep(400);
  const s2 = session(`begin; ${asKeeper} ${ret(whA, ids.itemRet2, src, 1)} commit;`, app('retdead'));
  const [r1, r2] = [await s1.done, await s2.done];
  assert(!r1.err.includes('deadlock detected') && !r2.err.includes('deadlock detected'), `return deadlock: no victim (${r1.err}${r2.err})`);
  assert(r1.code === 0 && r2.code === 0, `return deadlock: both returns post (${r1.err}${r2.err})`);
  console.log('PASS return deadlock: two returns of one issue line, one holding the key-share, no deadlock.');
}

const outsideAfter = await run(`select count(*) from public.stock_ledger where org_id <> '${ids.org}';`);
assert(outsideAfter === outsideBefore, `control: ledger rows outside the throwaway org changed ${outsideBefore} -> ${outsideAfter}`);
console.log(`PASS control: no ledger row outside the throwaway org (${outsideBefore}).`);
