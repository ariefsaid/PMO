import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import {
  CLEANUP_ORDER,
  ownedBackendSql,
  ownedWaitersSql,
  ownershipPlan,
  parseRaceTap,
  raceTapProblems,
  sessionPrelude,
  startSession,
} from './nightly-intent-race-session.mjs';

// AC-NS-004/005 concurrent interleaving evidence for the dormant 0644 nightly/intent slice.
//
// Two independent sessions invoke the SHIPPED service RPCs; no algorithm is copied here. The barrier is
// deterministic: an owner session holds the organization's state row, both service sessions are observed
// queueing behind it (by their own application names), and only then is it released.
//
// This file runs in CI's `pgtap` job after the local Supabase stack exists, and in the release
// `integration` path; it is excluded from `verify`'s no-DB script glob.
//
// Ownership: the fixture uses one declared id namespace. Every session carries a unique application name
// derived from this process, so waits and teardown target only our own backends. Setup refuses to write
// if ANY row already exists for the namespace, is a single all-or-nothing transaction, and teardown
// removes only namespace rows and then proves both that they are gone and that no foreign row changed.

const container = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_pmo-portal';

const org = '06440000-0000-0000-0000-000000000001';
const otherOrg = '06440000-0000-0000-0000-000000000002';
const binding = '06440000-0000-0000-0000-000000000011';
const otherBinding = '06440000-0000-0000-0000-000000000012';
const holder = '06440000-0000-0000-0000-000000000101';
const otherHolder = '06440000-0000-0000-0000-000000000102';
const ownedOrgs = [org, otherOrg];
const activatedAt = '2026-10-18T09:00:00Z';
const RANGE_DAYS = 62;

// One immutable run namespace, supplied by the proof driver so the outer owned-backend sweep can find
// every session this file starts. The fallback keeps the file runnable on its own.
const NAMESPACE = process.env.Q12_RACE_NAMESPACE || `q12_0644_race_${process.pid}`;
const sessionApp = (suffix) => `${NAMESPACE}_${suffix}`;
const PSQL_TIMEOUT_MS = 90_000;
const OWNERSHIP_FILE = process.env.Q12_RACE_OWNERSHIP_FILE || null;
const DOCKER_ARGS = ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];


function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const uuidLiteral = (value) => `${sqlLiteral(value)}::uuid`;
const uuidList = (values) => values.map(uuidLiteral).join(',');

function psqlSync(sql, suffix = 'oneshot') {
  const result = spawnSync(
    'docker',
    DOCKER_ARGS,
    { input: sessionPrelude(sessionApp(suffix)) + sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: PSQL_TIMEOUT_MS, killSignal: 'SIGKILL' },
  );
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`psql killed by ${result.signal} after ${PSQL_TIMEOUT_MS}ms: ${result.stderr ?? ''}`);
  return { status: result.status, stdout: result.stdout ?? '', output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function startPsql(sql, suffix, keepOpen = false) {
  // The session holds its own transaction open, so it keeps running until released; the outer test
  // timeout is not what bounds it — the owned stop/reap path below does.
  return startSession({
    dockerArgs: DOCKER_ARGS,
    sql,
    applicationName: sessionApp(suffix),
    keepOpen,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(description, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function lastLine(out) {
  return out.trim().split('\n').at(-1) ?? '';
}

function ownedBackendCount() {
  const result = psqlSync(ownedBackendSql(NAMESPACE), 'backend-probe');
  assert.equal(result.status, 0, result.output);
  return Number(lastLine(result.stdout));
}

/** Lock waiters belonging to THIS run only — a matching query from any other session is not evidence. */
function ownedLockWaiters(needle) {
  const result = psqlSync(ownedWaitersSql(NAMESPACE, needle), 'waiter-probe');
  assert.equal(result.status, 0, result.output);
  return Number(lastLine(result.stdout));
}

async function waitForOwnedWaiters(needle, count) {
  await until(`${count} owned ${needle} lock wait(s)`, () => ownedLockWaiters(needle) >= count);
}

/** Exactly one of our sessions is alive and idle-in-transaction: identity + readiness while connected. */
function ownedBarrierSessions() {
  const result = psqlSync(
    `select count(*) from pg_stat_activity
      where left(application_name, ${NAMESPACE.length}) = ${sqlLiteral(NAMESPACE)}
        and state='idle in transaction' and pid <> pg_backend_pid();`,
    'barrier-probe',
  );
  assert.equal(result.status, 0, result.output);
  return Number(lastLine(result.stdout));
}

async function waitForBarrierIdentity() {
  await until('exactly one owned idle-in-transaction barrier backend', () => ownedBarrierSessions() === 1);
}

/** Order-independent digest of every row in an affected table: counts cannot see a changed value. */
function tableDigest(table) {
  return `(select md5(coalesce(string_agg(row_json, '|' order by row_json), '')) from (select to_jsonb(t)::text as row_json from public.${table} t) rows)`;
}

/** Fixture inventory: our namespace rows plus a row digest per affected table (not just counts). */
function inventorySql() {
  return `select jsonb_build_object(
    'owned', (select count(*) from public.organizations where id in (${uuidList(ownedOrgs)}))
      + (select count(*) from public.external_org_bindings where org_id in (${uuidList(ownedOrgs)}))
      + (select count(*) from public.erp_sweep_lock where org_id in (${uuidList(ownedOrgs)}))
      + (select count(*) from public.erp_statement_change_state where org_id in (${uuidList(ownedOrgs)}))
      + (select count(*) from public.erp_statement_nightly_obligation where org_id in (${uuidList(ownedOrgs)})),
    'digests', jsonb_build_object(
      'organizations', ${tableDigest('organizations')},
      'bindings', ${tableDigest('external_org_bindings')},
      'locks', ${tableDigest('erp_sweep_lock')},
      'states', ${tableDigest('erp_statement_change_state')},
      'obligations', ${tableDigest('erp_statement_nightly_obligation')})
  )::text;`;
}

function inventory(suffix) {
  const result = psqlSync(inventorySql(), suffix);
  assert.equal(result.status, 0, result.output);
  return JSON.parse(lastLine(result.stdout));
}

let baselineDigests = null;
let fixtureCreated = false;

function deleteExactOwnedIds(suffix) {
  const result = psqlSync(cleanupSql(), suffix);
  assert.equal(result.status, 0, `owned fixture delete failed: ${result.output}`);
}

function cleanupSql() {
  return `begin;
    delete from public.erp_statement_nightly_obligation where org_id in (${uuidList(ownedOrgs)});
    delete from public.erp_statement_change_state where org_id in (${uuidList(ownedOrgs)});
    delete from public.erp_sweep_lock where org_id in (${uuidList(ownedOrgs)});
    delete from public.external_org_bindings where org_id in (${uuidList(ownedOrgs)});
    delete from public.organizations where id in (${uuidList(ownedOrgs)});
    commit;`;
}

function setupSql() {
  return `begin;
    insert into public.organizations(id,name,default_currency,default_timezone) values
      (${uuidLiteral(org)},'Synthetic nightly intent race org','IDR','UTC'),
      (${uuidLiteral(otherOrg)},'Synthetic nightly intent race org B','IDR','UTC');
    insert into public.external_org_bindings(id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at) values
      (${uuidLiteral(binding)},${uuidLiteral(org)},'erpnext','https://example.invalid','race-test-only',16,
        '{"company":"Race A","project_map":{}}',${sqlLiteral(activatedAt)}::timestamptz),
      (${uuidLiteral(otherBinding)},${uuidLiteral(otherOrg)},'erpnext','https://example.invalid','race-test-only',16,
        '{"company":"Race B","project_map":{}}',${sqlLiteral(activatedAt)}::timestamptz);
    insert into public.erp_sweep_lock(org_id,holder,locked_until) values
      (${uuidLiteral(org)},${uuidLiteral(holder)},clock_timestamp()+interval '30 minutes'),
      (${uuidLiteral(otherOrg)},${uuidLiteral(otherHolder)},clock_timestamp()+interval '30 minutes');
    set local role service_role;
    select public.sync_erp_statement_change_scope(${uuidLiteral(org)},${uuidLiteral(holder)},${uuidLiteral(binding)},${sqlLiteral(activatedAt)}::timestamptz);
    select public.sync_erp_statement_change_scope(${uuidLiteral(otherOrg)},${uuidLiteral(otherHolder)},${uuidLiteral(otherBinding)},${sqlLiteral(activatedAt)}::timestamptz);
    reset role;
    update public.erp_statement_change_state set enabled=true where org_id in (${uuidList(ownedOrgs)});
    commit;`;
}

async function setupFixture(journal) {
  const inspected = spawnSync('docker', ['inspect', '--format', '{{.Name}}', container], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(inspected.stdout.trim(), `/${container}`, 'race proof must use the exact local Supabase database container');

  // Admission: refuse to write into a namespace that already holds a row. This is read-only.
  const pre = inventory('preflight');
  if (pre.owned !== 0) {
    throw new Error(`owned-namespace collision: ${pre.owned} row(s) already exist for this fixture's ids; refusing to write or delete`);
  }
  baselineDigests = pre.digests;

  // Record ownership BEFORE creating anything, so an interrupted outer run knows exactly which fixture
  // rows it may delete and nothing else.
  const ownership = {
    namespace: NAMESPACE,
    orgs: ownedOrgs,
    bindings: [binding, otherBinding],
    holders: [holder, otherHolder],
    pre_owned: pre.owned,
    tables: ['erp_statement_nightly_obligation', 'erp_statement_change_state', 'erp_sweep_lock', 'external_org_bindings', 'organizations'],
  };
  if (journal) writeFileSync(journal, JSON.stringify({ ...ownership, phase: 'creating' }) + '\n', { flag: 'wx' });

  // One transaction: either the whole fixture exists or nothing does.
  const setup = psqlSync(setupSql(), 'fixture-setup');
  if (setup.status !== 0) {
    // The COMMIT may have landed before the client failed, so reconcile by exact owned ids instead of
    // assuming nothing was written; the phase stays `creating` until that reconciliation proves absence.
    const after = inventory('setup-failed');
    if (after.owned !== 0) {
      deleteExactOwnedIds('setup-failed-reconcile');
      const reconciled = inventory('setup-failed-reconciled');
      assert.equal(reconciled.owned, 0, 'a setup whose COMMIT landed must be removed by exact owned ids');
      for (const key of Object.keys(baselineDigests ?? {})) {
        assert.equal(reconciled.digests[key], baselineDigests[key], `setup reconciliation changed foreign rows (${key})`);
      }
      if (journal) writeFileSync(journal, JSON.stringify({ ...ownership, phase: 'reconciled' }) + '\n');
    } else if (journal) {
      writeFileSync(journal, JSON.stringify({ ...ownership, phase: 'absent' }) + '\n');
    }
    throw new Error(`fixture setup failed: ${setup.output}`);
  }
  fixtureCreated = true;
  if (journal) writeFileSync(journal, JSON.stringify({ ...ownership, phase: 'created' }) + '\n');
}

async function stopOwnedSessions(sessions) {
  const survivors = [];
  for (const session of sessions) {
    if (!session || session.child.exitCode !== null) continue;
    try { session.child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  for (const session of sessions) {
    if (!session) continue;
    let closed = await Promise.race([session.done.catch(() => null), sleep(3_000).then(() => null)]);
    if (!closed && session.child.exitCode === null) {
      try { session.child.kill('SIGKILL'); } catch { /* already gone */ }
      closed = await Promise.race([session.done.catch(() => null), sleep(3_000).then(() => null)]);
    }
    // An outer kill of the docker CLI is not proof the child closed: require the close event.
    if (!closed) survivors.push(session.applicationName);
  }
  assert.deepEqual(survivors, [], `owned sessions did not close after SIGKILL: ${survivors.join(', ')}`);
}

/** Positively stop and reap our backends, then prove none remain before any fixture is deleted. */
async function reapOwnedBackends() {
  await until('owned backends to drain', () => ownedBackendCount() === 0, 15_000).catch(async () => {
    psqlSync(`select pg_terminate_backend(pid) from pg_stat_activity
      where left(application_name, ${NAMESPACE.length}) = ${sqlLiteral(NAMESPACE)} and pid <> pg_backend_pid();`, 'backend-reap');
    await until('owned backends to drain after terminate', () => ownedBackendCount() === 0, 10_000);
  });
}

async function cleanupFixture(journal) {
  // CLEANUP_ORDER: our sessions are already stopped by the caller; then drain our own backends, delete
  // ONLY the exact owned ids, and finally prove owned == 0 and that no foreign row digest moved.
  await reapOwnedBackends();
  if (journal && existsSync(journal)) {
    // A malformed/unreconcilable record must fail restoration instead of silently deleting nothing.
    ownershipPlan(JSON.parse(readFileSync(journal, 'utf8')), ownedOrgs);
  }
  const probe = inventory('post-cleanup-probe');
  if (probe.owned !== 0) {
    // Covers the "setup COMMIT landed but the client failed" case, where the in-process flag is false.
    deleteExactOwnedIds('fixture-cleanup');
    fixtureCreated = false;
  }
  const post = inventory('post-cleanup');
  assert.equal(post.owned, 0, 'only the owned synthetic fixture is removed');
  for (const key of Object.keys(baselineDigests ?? {})) {
    assert.equal(post.digests[key], baselineDigests[key], `cleanup changed rows outside the owned namespace (${key})`);
  }
  if (journal) writeFileSync(journal, JSON.stringify({ namespace: NAMESPACE, phase: 'cleaned' }) + '\n');
}

async function withFixture(scenario, body) {
  const journal = OWNERSHIP_FILE ? `${OWNERSHIP_FILE}.${scenario}` : null;
  await setupFixture(journal);
  try {
    await body();
  } finally {
    await cleanupFixture(journal);
  }
}

function startBarrier(targetOrg = org) {
  // The barrier MUST keep its transaction open: closing stdin makes psql exit and silently releases the
  // lock the two service sessions are supposed to queue on (keepOpen is the whole point of the helper).
  return startPsql(
    `begin; select 1 from public.erp_statement_change_state where org_id=${uuidLiteral(targetOrg)} for update; select 'BARRIER_LOCKED';\n`,
    'barrier',
    true,
  );
}

async function releaseBarrier(session) {
  if (!session || session.child.exitCode !== null) return;
  session.release('commit;\n');
  const released = await Promise.race([session.done, sleep(5_000).then(() => null)]);
  assert.ok(released, `barrier session did not finish: ${session.output}`);
  assert.equal(released.status, 0, released.output);
}

function manualIntentSql(targetOrg, targetHolder, targetBinding) {
  return `begin; set local role service_role;
select public.request_erp_statement_manual_intent(${uuidLiteral(targetOrg)},${uuidLiteral(targetHolder)},${uuidLiteral(targetBinding)},${sqlLiteral(activatedAt)}::timestamptz)::text;
commit;`;
}

function nightlyDueSql(targetOrg, targetHolder, targetBinding) {
  return `begin; set local role service_role;
select public.record_erp_statement_nightly_due(${uuidLiteral(targetOrg)},${uuidLiteral(targetHolder)},${uuidLiteral(targetBinding)},${sqlLiteral(activatedAt)}::timestamptz)::text;
commit;`;
}

function stateRow(targetOrg = org) {
  const result = psqlSync(`select jsonb_build_object(
      'intent_revision',intent_revision::text,
      'last_manual_at',coalesce(last_manual_at::text,''),
      'next_nightly_date',next_nightly_date::text,
      'retry_failures',retry_failures,
      'diagnostic_result',coalesce(diagnostic_result::text,'')
    )::text from public.erp_statement_change_state where org_id=${uuidLiteral(targetOrg)};`, 'state-read');
  assert.equal(result.status, 0, result.output);
  return JSON.parse(lastLine(result.stdout));
}

function obligationFacts(targetOrg = org) {
  const result = psqlSync(`select jsonb_build_object(
      'rows',count(*),
      'dates',count(distinct local_date),
      'first',min(local_date)::text,
      'last',max(local_date)::text,
      'generations',count(published_generation),
      'completions',count(completed_at)
    )::text from public.erp_statement_nightly_obligation where org_id=${uuidLiteral(targetOrg)};`, 'obligation-read');
  assert.equal(result.status, 0, result.output);
  return JSON.parse(lastLine(result.stdout));
}

test('AC-NS-005 concurrent manual intents serialize on the same org and one other org proceeds independently', { timeout: 120_000 }, async () => {
  let barrier;
  let first;
  let second;
  await withFixture('manual', async () => {
    try {
      const before = stateRow();
      assert.equal(before.intent_revision, '0');

      // Negative body: a stale lease holder is refused and changes nothing, before any contention.
      const refused = psqlSync(manualIntentSql(org, otherHolder, binding), 'manual-refused');
      assert.notEqual(refused.status, 0, 'a stale lease holder must be refused');
      assert.match(refused.output, /statement scope unavailable/);
      assert.equal(stateRow().intent_revision, '0', 'a refused manual request leaves the revision untouched');

      barrier = startBarrier();
      await until('owner state row lock acquisition', () => barrier.output.includes('BARRIER_LOCKED'));
      await waitForBarrierIdentity();

      first = startPsql(manualIntentSql(org, holder, binding), 'manual-a');
      second = startPsql(manualIntentSql(org, holder, binding), 'manual-b');
      await waitForOwnedWaiters('request_erp_statement_manual_intent', 2);

      // Another organization's request is not blocked by the first organization's held state row.
      const independent = psqlSync(manualIntentSql(otherOrg, otherHolder, otherBinding), 'manual-other-org');
      assert.equal(independent.status, 0, independent.output);
      assert.equal(JSON.parse(lastLine(independent.stdout)).status, 'accepted');
      assert.equal(stateRow(otherOrg).intent_revision, '1', 'other-org intent is independent of the blocked org');
      assert.equal(stateRow().intent_revision, '0', 'blocked org has not mutated while its state row is held');

      await releaseBarrier(barrier);
      barrier = null;

      const results = await Promise.all([first.done, second.done]);
      for (const result of results) assert.equal(result.status, 0, result.output);
      first = null;
      second = null;

      const statuses = results.map((result) => JSON.parse(lastLine(result.stdout))).sort((a, b) => a.status.localeCompare(b.status));
      assert.deepEqual(statuses.map((entry) => entry.status), ['accepted', 'coalesced']);
      const accepted = statuses.find((entry) => entry.status === 'accepted');
      const coalesced = statuses.find((entry) => entry.status === 'coalesced');
      assert.equal(accepted.intent_revision, '1', 'accepted intent revision is the decimal string for one increment');
      assert.equal(coalesced.intent_revision, '1', 'coalesced intent reports the same unchanged revision');
      assert.match(accepted.manual_available_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);

      const after = stateRow();
      assert.equal(after.intent_revision, '1', 'exactly one counter increment across both concurrent requests');
      assert.equal(after.retry_failures, 0, 'manual intent never touches retry backoff');
      assert.equal(after.diagnostic_result, '', 'manual intent never touches the diagnostic result');
    } finally {
      if (barrier && barrier.child.exitCode === null) scenarioReleaseQuietly(barrier);
      await stopOwnedSessions([barrier, first, second]);
    }
  });
});

test('AC-NS-004 concurrent nightly recordings materialize every due date exactly once within the per-call bound', { timeout: 120_000 }, async () => {
  let barrier;
  let first;
  let second;
  await withFixture('nightly', async () => {
    try {
      const seeded = psqlSync(`begin;
        update public.erp_statement_change_state
          set next_nightly_date=(current_date - ${RANGE_DAYS}) where org_id=${uuidLiteral(org)};
        commit;`, 'fixture-cursor');
      assert.equal(seeded.status, 0, seeded.output);
      const cursorBefore = stateRow().next_nightly_date;
      assert.equal(cursorBefore, psqlSync(`select (current_date - ${RANGE_DAYS})::text;`, 'cursor-read').stdout.trim());

      // Negative body: a stale lease holder is refused and materializes nothing.
      const refused = psqlSync(nightlyDueSql(org, otherHolder, binding), 'nightly-refused');
      assert.notEqual(refused.status, 0, 'a stale lease holder must be refused');
      assert.match(refused.output, /statement scope unavailable/);
      assert.equal(obligationFacts().rows, 0, 'a refused recording writes no obligation');

      barrier = startBarrier();
      await until('owner state row lock acquisition', () => barrier.output.includes('BARRIER_LOCKED'));
      await waitForBarrierIdentity();

      first = startPsql(nightlyDueSql(org, holder, binding), 'nightly-a');
      second = startPsql(nightlyDueSql(org, holder, binding), 'nightly-b');
      await waitForOwnedWaiters('record_erp_statement_nightly_due', 2);
      assert.equal(obligationFacts().rows, 0, 'no obligation is visible while both recordings queue behind the held state row');

      await releaseBarrier(barrier);
      barrier = null;

      const results = await Promise.all([first.done, second.done]);
      for (const result of results) assert.equal(result.status, 0, result.output);
      first = null;
      second = null;

      const payloads = results.map((result) => JSON.parse(lastLine(result.stdout)));
      for (const payload of payloads) {
        assert.equal(payload.status, 'recorded');
        assert.ok(payload.inserted >= 1 && payload.inserted <= 31, `per-call bound respected: ${payload.inserted}`);
      }
      assert.equal(payloads.reduce((sum, payload) => sum + payload.inserted, 0), RANGE_DAYS,
        'together the two serialized calls materialize exactly the 62 missed dates');

      const facts = obligationFacts();
      assert.equal(facts.rows, RANGE_DAYS, 'every due date exists exactly once');
      assert.equal(facts.dates, RANGE_DAYS, 'no duplicate local date');
      assert.equal(facts.first, cursorBefore, 'materialization starts at the durable cursor');
      assert.equal(
        psqlSync(`select (${sqlLiteral(cursorBefore)}::date + ${RANGE_DAYS - 1})::text;`, 'contiguity').stdout.trim(),
        facts.last,
        'materialization is contiguous through the last missed date',
      );
      assert.equal(facts.generations, 0, 'reserved completion columns stay null in this slice');
      assert.equal(facts.completions, 0, 'no publication completion is claimable here');

      const cursorAfter = stateRow().next_nightly_date;
      assert.equal(cursorAfter, psqlSync('select current_date::text;', 'cursor-now').stdout.trim(),
        'the durable cursor advances past every materialized date');
      const midway = psqlSync(`select (${sqlLiteral(cursorBefore)}::date + 31)::text;`, 'cursor-midway').stdout.trim();
      assert.deepEqual(
        payloads.map((payload) => payload.next_nightly_date).sort(),
        [midway, cursorAfter].sort(),
        'each serialized call advanced the cursor by exactly its own 31 processed dates',
      );
      for (const payload of payloads) assert.equal(typeof payload.more_due, 'boolean');
    } finally {
      if (barrier && barrier.child.exitCode === null) scenarioReleaseQuietly(barrier);
      await stopOwnedSessions([barrier, first, second]);
    }
  });
});
