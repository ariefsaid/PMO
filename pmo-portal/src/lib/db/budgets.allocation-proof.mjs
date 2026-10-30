// Run with the shared DB lock against the local seeded Supabase stack.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const org = '00000000-0000-0000-0000-000000000001';
const args = ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
function sql(query) {
  const result = spawnSync('docker', args, { input: query, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'local SQL failed');
  return result.stdout.trim();
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}
function combine(primary, cleanup) {
  return primary ? new AggregateError([primary, cleanup], 'Proof failed and cleanup also failed', { cause: primary }) : cleanup;
}

// Ownership begins only after the project's INSERT succeeds; later setup may fail.
export function fixture(query, project = randomUUID(), source = randomUUID()) {
  let owned = false;
  return {
    project, source,
    setup() {
      query(`insert into projects(id,org_id,code,name,status) values ('${project}','${org}','ALLOC-${project}','Allocation','Ongoing Project');`);
      owned = true;
      query(`insert into budget_versions(id,org_id,project_id,version,name,status) values ('${source}','${org}','${project}',1,'Source','Draft');`);
    },
    cleanup() {
      if (!owned) return;
      query(`delete from budget_version_editors where budget_version_id in (select id from budget_versions where project_id='${project}');
        delete from budget_line_items where budget_version_id in (select id from budget_versions where project_id='${project}');
        delete from budget_versions where project_id='${project}'; delete from projects where id='${project}';`);
      owned = false;
    },
  };
}

// Install lifetime handlers immediately, before any startup assertion or writer exists.
export async function withBlocker(blocker, work, timeout = 5000) {
  let output = '';
  let errors = '';
  let childError;
  blocker.stdout.on('data', data => { output += data; });
  blocker.stderr.on('data', data => { errors += data; });
  blocker.stdin.on('error', error => { childError ||= error; });
  const closed = new Promise(resolve => {
    blocker.once('error', error => { childError ||= error; });
    blocker.once('close', (code, signal) => resolve({ code, signal }));
  });
  let primary;
  let result;
  try {
    result = await work({ blocker, output: () => output, errors: () => errors, childError: () => childError });
  } catch (error) { primary = error; }
  try {
    if (!blocker.stdin.destroyed && !blocker.stdin.writableEnded) blocker.stdin.end('rollback;\n');
    let status;
    try { status = await bounded(closed, timeout, 'blocker did not exit after rollback'); }
    catch (error) {
      error.cleanupUnsafe = true;
      blocker.kill('SIGKILL');
      try { await bounded(closed, timeout, 'blocker did not settle after kill'); }
      catch (settleError) { settleError.cleanupUnsafe = true; throw combine(error, settleError); }
      throw error;
    }
    if (childError) throw childError;
    if (status.code !== 0) throw new Error(`blocker exited unsuccessfully: ${status.code ?? status.signal}`);
  } catch (error) {
    const unsafe = error.cleanupUnsafe;
    primary = combine(primary, error);
    if (unsafe) primary.cleanupUnsafe = true;
  }
  if (primary) throw primary;
  return result;
}

export function assertLocalUrl(value) {
  const url = new URL(value);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '54321' && !url.username && !url.password, 'proof requires local Supabase');
}

export async function runRace(label, createBudgetVersion, cloneVersion, clone, ids, options = {}) {
  const query = options.query || sql;
  const next = Number(query(`select coalesce(max(version),0)+1 from budget_versions where project_id='${ids.project}'`));
  const blocker = (options.spawn || spawn)('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let pending;
  let primary;
  try {
    await withBlocker(blocker, async ({ output, errors, childError }) => {
      blocker.stdin.write(`select pg_backend_pid(); begin; insert into budget_versions(org_id,project_id,version,name,status) values ('${org}','${ids.project}',${next},'Blocker','Draft');\n\\echo READY\n`);
      for (let n = 0; !output().includes('READY') && !childError() && blocker.exitCode === null && n < (options.startupPolls ?? 200); n++) await delay(50);
      assert.ok(output().includes('READY'), errors() || childError()?.message || 'blocker did not start');
      const blockerPid = Number(output().split('\n')[0]);
      assert.ok(Number.isInteger(blockerPid) && blockerPid > 0, 'invalid blocker PID');
      pending = Promise.allSettled([
        Promise.resolve().then(() => createBudgetVersion(ids.project, `${label} create`, { importBatchId: '04010000-0000-0000-0000-000000000099', importedAt: '2026-01-01T00:00:00Z', importKey: `${label}-key` })),
        Promise.resolve().then(() => clone ? cloneVersion(ids.source) : createBudgetVersion(ids.project, `${label} second`)),
      ]);
      let waiting = false;
      for (let n = 0; n < 200; n++) {
        const count = Number(query(`select count(*) from pg_stat_activity where wait_event_type='Lock' and ${blockerPid} = any(pg_blocking_pids(pid))`));
        if (count >= 2) { waiting = true; break; }
        await delay(50);
      }
      assert.ok(waiting, `${label}: both writers must contend on the held version`);
      blocker.stdin.end('commit;\n');
      const outcomes = await bounded(pending, 15000, 'writers did not settle after commit');
      assert.deepEqual(outcomes.map(x => x.status), ['fulfilled', 'fulfilled'], JSON.stringify(outcomes));
      const created = outcomes[0].value;
      assert.equal(created.import_key, `${label}-key`);
      assert.equal(created.import_batch_id, '04010000-0000-0000-0000-000000000099');
      assert.equal(created.currency, query(`select default_currency from organizations where id='${org}'`));
      assert.equal(created.imported_at, '2026-01-01T00:00:00+00:00');
      const resultIds = [created.id, clone ? outcomes[1].value : outcomes[1].value.id];
      assert.equal(query(`select count(distinct version) from budget_versions where id in ('${resultIds[0]}','${resultIds[1]}')`), '2');
      console.log(`${label}: two contending writes committed with distinct versions`);
    }, options.timeout);
  } catch (error) { primary = error; }
  // Never wait for writers until the blocker has been released and settled.
  if (pending) {
    try { await bounded(pending, 15000, 'writers did not settle after blocker teardown'); }
    catch (error) { primary = combine(primary, error); primary.cleanupUnsafe = true; }
  }
  if (primary) throw primary;
}

async function main() {
  const ids = fixture(sql);
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  let failure;
  try {
    ids.setup();
    const { supabase } = await server.ssrLoadModule('/src/lib/supabase/client.ts');
    assertLocalUrl(supabase.supabaseUrl);
    const { createBudgetVersion, cloneVersion } = await server.ssrLoadModule('/src/lib/db/budgets.ts');
    const login = await supabase.auth.signInWithPassword({ email: 'admin@acme.test', password: 'Passw0rd!dev' });
    assert.equal(login.error, null);
    if (process.argv[2] !== 'create-clone') await runRace('create-create', createBudgetVersion, cloneVersion, false, ids);
    if (process.argv[2] !== 'create-create') await runRace('create-clone', createBudgetVersion, cloneVersion, true, ids);
    await supabase.auth.signOut();
  } catch (error) { failure = error; }
  if (!failure?.cleanupUnsafe) {
    try { ids.cleanup(); } catch (error) { failure = combine(failure, error); }
  } else {
    failure = combine(failure, new Error(`Fixture ${ids.project} retained because teardown was not confirmed`));
  }
  try { await server.close(); } catch (error) { failure = combine(failure, error); }
  if (failure) throw failure;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
