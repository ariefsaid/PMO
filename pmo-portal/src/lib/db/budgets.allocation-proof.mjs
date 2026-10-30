// Run with the shared DB lock against the local seeded Supabase stack.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'vite';

const project = '04010000-0000-0000-0000-000000000010';
const source = '04010000-0000-0000-0000-000000000011';
const org = '00000000-0000-0000-0000-000000000001';
const args = ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
function sql(query) {
  const result = spawnSync('docker', args, { input: query, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runRace(label, createBudgetVersion, cloneVersion, clone) {
  const next = Number(sql(`select coalesce(max(version),0)+1 from budget_versions where project_id='${project}'`));
  const blocker = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  blocker.stdout.on('data', data => { output += data; });
  blocker.stderr.on('data', data => { errors += data; });
  blocker.stdin.write(`select pg_backend_pid(); begin; insert into budget_versions(org_id,project_id,version,name,status) values ('${org}','${project}',${next},'Blocker','Draft');\n\\echo READY\n`);
  for (let n = 0; !output.includes('READY') && n < 200; n++) await delay(50);
  assert.ok(output.includes('READY'), errors || 'blocker did not start');
  const blockerPid = Number(output.split('\n')[0]);
  assert.ok(Number.isInteger(blockerPid) && blockerPid > 0);
  const pending = Promise.allSettled([
    createBudgetVersion(project, `${label} create`, { importBatchId: '04010000-0000-0000-0000-000000000099', importedAt: '2026-01-01T00:00:00Z', importKey: `${label}-key` }),
    clone ? cloneVersion(source) : createBudgetVersion(project, `${label} second`),
  ]);
  try {
    let waiting = false;
    for (let n = 0; n < 200; n++) {
      const count = Number(sql(`select count(*) from pg_stat_activity where wait_event_type='Lock' and ${blockerPid} = any(pg_blocking_pids(pid))`));
      if (count >= 2) { waiting = true; break; }
      await delay(50);
    }
    assert.ok(waiting, `${label}: both writers must contend on the held version`);
    blocker.stdin.end('commit;\n');
    const outcomes = await pending;
    assert.deepEqual(outcomes.map(x => x.status), ['fulfilled', 'fulfilled'], JSON.stringify(outcomes));
    const created = outcomes[0].value;
    assert.equal(created.import_key, `${label}-key`);
    assert.equal(created.import_batch_id, '04010000-0000-0000-0000-000000000099');
    assert.equal(created.currency, sql(`select default_currency from organizations where id='${org}'`));
    assert.equal(created.imported_at, '2026-01-01T00:00:00+00:00');
    const ids = [created.id, clone ? outcomes[1].value : outcomes[1].value.id];
    const versions = sql(`select count(distinct version) from budget_versions where id in ('${ids[0]}','${ids[1]}')`);
    assert.equal(versions, '2');
    console.log(`${label}: two contending writes committed with distinct versions`);
  } finally {
    if (!blocker.stdin.destroyed) blocker.stdin.end('rollback;\n');
    await pending;
  }
}
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  sql(`insert into projects(id,org_id,code,name,status) values ('${project}','${org}','ALLOC401','Allocation','Ongoing Project');
    insert into budget_versions(id,org_id,project_id,version,name,status) values ('${source}','${org}','${project}',1,'Source','Draft');`);
  const { supabase } = await server.ssrLoadModule('/src/lib/supabase/client.ts');
  const { createBudgetVersion, cloneVersion } = await server.ssrLoadModule('/src/lib/db/budgets.ts');
  const login = await supabase.auth.signInWithPassword({ email: 'admin@acme.test', password: 'Passw0rd!dev' });
  assert.equal(login.error, null);
  if (process.argv[2] !== 'create-clone') await runRace('create-create', createBudgetVersion, cloneVersion, false);
  if (process.argv[2] !== 'create-create') await runRace('create-clone', createBudgetVersion, cloneVersion, true);
  await supabase.auth.signOut();
} finally {
  sql(`delete from budget_version_editors where budget_version_id in (select id from budget_versions where project_id='${project}');
    delete from budget_line_items where budget_version_id in (select id from budget_versions where project_id='${project}');
    delete from budget_versions where project_id='${project}'; delete from projects where id='${project}';`);
  await server.close();
}
