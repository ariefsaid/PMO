// Two-session proof for #564: concurrent re-splits of one org's AI credit pool never allocate more
// than the pool's total. pgTAP runs in one transaction and cannot race; this opens two sessions.
//   1. Two Admin re-splits, each fitting alone, race for the same unallocated credit: the second
//      waits for the first, then is refused; the sum stays within the pool.
//   2. Two direct writes that skip the RPC race the same way: the database's commit-time check
//      refuses the second.
import assert from 'node:assert/strict';
import test from 'node:test';
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
const waitingFor = (name) =>
  q(`select pg_sleep(0.3); select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`);

const org = '09070000-0000-0000-0000-00000000e001';
const admin = '09070000-0000-0000-0000-00000000e0a1';
const userB = '09070000-0000-0000-0000-00000000e0b1';
const userC = '09070000-0000-0000-0000-00000000e0c1';
const claims = JSON.stringify({ sub: admin, role: 'authenticated' });
const asAdmin = `set local role authenticated; set local request.jwt.claims = '${claims}';`;
const allocated = () => q(`select coalesce(sum(amount),0) from public.credit_allocations where org_id='${org}';`);

function seed() {
  q(`insert into organizations(id,name) values ('${org}','Allocation race');
insert into auth.users(id,email) values ('${admin}','alloc-race-a@example.test'),('${userB}','alloc-race-b@example.test'),('${userC}','alloc-race-c@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('${admin}','${org}','Admin','alloc-race-a@example.test','Admin','active'),
 ('${userB}','${org}','B','alloc-race-b@example.test','Engineer','active'),
 ('${userC}','${org}','C','alloc-race-c@example.test','Engineer','active');
insert into credits(org_id,owner_id,amount,granted_by) values ('${org}',null,100,'${admin}');`);
}
function cleanup() {
  q(`delete from public.credit_allocations where org_id='${org}';
delete from public.credits where org_id='${org}';
delete from public.profiles where org_id='${org}';
delete from auth.users where id in ('${admin}','${userB}','${userC}');
delete from public.organizations where id='${org}';`);
}

async function race(firstSql, secondSql, name) {
  const first = session(`begin; ${firstSql} select 'FIRST_READY';\n`);
  let second;
  try {
    await marker(first, 'FIRST_READY');
    second = session(`set application_name = '${name}'; begin; select 'SECOND_READY'; ${secondSql} commit;\n`);
    await marker(second, 'SECOND_READY');
    assert.equal(waitingFor(name), '1', 'the second session must wait for the first');
    first.p.stdin.end('commit;\n');
    second.p.stdin.end();
    return await Promise.all([first.done, second.done]);
  } finally {
    first.p.stdin.destroy(); second?.p.stdin.destroy();
  }
}

test('AC-ALLOC-010 two concurrent re-splits never allocate past the pool total', async () => {
  seed();
  try {
    const [a, b] = await race(
      `${asAdmin} select public.admin_move_credit_allocation(null,'${userB}',60);`,
      `${asAdmin} select public.admin_move_credit_allocation(null,'${userC}',60);`,
      'credit-allocation-race-rpc');
    assert.equal(a.code, 0, a.err);
    assert.notEqual(b.code, 0, 'the second re-split must be refused');
    assert.match(b.err, /insufficient_unallocated/);
    assert.equal(allocated(), '60');
    assert.equal(q(`select sum(amount) from public.credits where org_id='${org}';`), '100');
  } finally { cleanup(); }
});

test('AC-ALLOC-011 two concurrent direct writes are refused at commit past the pool total', async () => {
  seed();
  try {
    const [a, b] = await race(
      `insert into public.credit_allocations(org_id,user_id,amount) values ('${org}','${userB}',60); set constraints all immediate;`,
      `insert into public.credit_allocations(org_id,user_id,amount) values ('${org}','${userC}',60);`,
      'credit-allocation-race-direct');
    assert.equal(a.code, 0, a.err);
    assert.notEqual(b.code, 0, 'the second direct write must be refused');
    assert.match(b.err, /allocation_exceeds_pool/);
    assert.equal(allocated(), '60');
  } finally { cleanup(); }
});
