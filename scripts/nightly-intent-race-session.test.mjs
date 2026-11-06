import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CLEANUP_ORDER,
  namespacePredicate,
  ownershipPlan,
  ownedBackendSql,
  ownedWaitersSql,
  parseRaceTap,
  raceTapProblems,
  sessionPrelude,
  startSession,
} from './nightly-intent-race-session.mjs';

// Offline lifecycle controls for the 0644 race harness: no docker, no database, no psql.
// These bind to the ACTUAL helpers the harness uses, so the barrier/release/namespace contract is
// proved before any runtime rather than asserted in prose.

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.writes = [];
  child.ended = 0;
  child.writableEnded = false;
  child.stdin = {
    write: (chunk) => { child.writes.push(chunk); return true; },
    end: () => { child.ended += 1; child.stdin.writableEnded = true; },
  };
  child.kill = () => { child.killed = true; };
  return child;
}

function spawnReturning(child) {
  const spawn = () => child;
  return spawn;
}

test('a keep-open session leaves stdin open until an explicit release', () => {
  const child = fakeChild();
  const session = startSession({
    spawn: spawnReturning(child),
    dockerArgs: ['exec'],
    sql: "begin; select 1 for update; select 'BARRIER_LOCKED';\n",
    applicationName: 'q12_0644_test_barrier',
    keepOpen: true,
    spawnImpl: spawnReturning(child),
  });
  assert.equal(child.ended, 0, 'the barrier must NOT close stdin: closing it rolls the lock back');
  assert.equal(session.stdinOpen, true);
  assert.match(child.writes[0], /application_name='q12_0644_test_barrier'/);
  session.release('commit;\n');
  assert.deepEqual(child.writes.at(-1), 'commit;\n');
  assert.equal(child.ended, 1, 'release commits and then closes');
  assert.throws(() => session.release('commit;\n'), /already closed/, 'a second release must fail loudly');
});

test('a non-barrier session closes its stdin immediately', () => {
  const child = fakeChild();
  startSession({
    spawn: spawnReturning(child),
    dockerArgs: ['exec'],
    sql: 'select 1;\n',
    applicationName: 'q12_0644_test_oneshot',
    spawnImpl: spawnReturning(child),
  });
  assert.equal(child.ended, 1);
  assert.equal(child.writes.length, 1, 'no release write for a one-shot session');
});

test('every session carries the namespace and bounded PG timeouts', () => {
  const prelude = sessionPrelude('q12_0644_run_1_barrier');
  assert.match(prelude, /set application_name='q12_0644_run_1_barrier';/);
  assert.match(prelude, /statement_timeout='60s'/);
  assert.match(prelude, /lock_timeout='20s'/);
  assert.match(prelude, /idle_in_transaction_session_timeout='120s'/);
});

test('namespace matching is literal: underscores are not LIKE wildcards', () => {
  const predicate = namespacePredicate('q12_0644_run_1');
  assert.match(predicate, /^left\(application_name, 14\) = 'q12_0644_run_1'$/);
  assert.doesNotMatch(predicate, /LIKE/i);
  assert.match(ownedBackendSql('q12_0644_run_1'), /pid <> pg_backend_pid\(\)/);
  assert.match(ownedWaitersSql('q12_0644_run_1', 'record_erp_statement_nightly_due'), /count\(distinct pid\)/);
});

test('the race TAP summary must be exactly two passing tests and no skips or todos', () => {
  const good = [
    'ok 1 - AC-NS-005 concurrent manual intents',
    'ok 2 - AC-NS-004 concurrent nightly recordings',
    '',
    '1..2',
    '# tests 2',
    '# pass 2',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
  ].join('\n');
  assert.deepEqual(raceTapProblems(parseRaceTap(good)), []);

  const skipped = good.replace('# skipped 0', '# skipped 1');
  assert.match(raceTapProblems(parseRaceTap(skipped)).join('; '), /skipped/);

  const todo = good.replace('# todo 0', '# todo 1');
  assert.match(raceTapProblems(parseRaceTap(todo)).join('; '), /todo/);

  const failing = good.replace('ok 2 - ', 'not ok 2 - ').replace('# pass 2', '# pass 1').replace('# fail 0', '# fail 1');
  const problems = raceTapProblems(parseRaceTap(failing)).join('; ');
  assert.match(problems, /0 failing/);
  assert.match(problems, /not ok: AC-NS-004/);

  const oneTest = good.replace('# tests 2', '# tests 1').replace('# pass 2', '# pass 1').replace('ok 2 - AC-NS-004 concurrent nightly recordings\n', '');
  assert.match(raceTapProblems(parseRaceTap(oneTest)).join('; '), /expected 2 tests, saw 1/);

  const missing = good.replace(/# tests 2\n# pass 2\n/, '');
  assert.match(raceTapProblems(parseRaceTap(missing)).join('; '), /expected 2 tests, saw null/);
});

test('ownership reconciliation treats a possibly-committed setup as owned, and malformed records as fatal', () => {
  const orgs = ['06440000-0000-0000-0000-000000000001', '06440000-0000-0000-0000-000000000002'];
  const base = { namespace: 'q12_0644_race', orgs, pre_owned: 0 };

  assert.deepEqual(ownershipPlan({ ...base, phase: 'creating' }, orgs).deleteOrgs, orgs,
    'a setup whose COMMIT may have landed is still owned');
  assert.deepEqual(ownershipPlan({ ...base, phase: 'created' }, orgs).deleteOrgs, orgs);
  assert.deepEqual(ownershipPlan({ ...base, phase: 'cleaned' }, orgs).deleteOrgs, []);
  assert.deepEqual(ownershipPlan({ ...base, phase: 'absent' }, orgs).deleteOrgs, []);
  assert.deepEqual(ownershipPlan({ ...base, phase: 'reconciled' }, orgs).deleteOrgs, []);

  for (const [label, record] of [
    ['missing record', null],
    ['unknown phase', { ...base, phase: 'halfway' }],
    ['no phase', { ...base }],
    ['dirty namespace', { ...base, phase: 'creating', pre_owned: 3 }],
    ['wrong id count', { ...base, phase: 'creating', orgs: [orgs[0]] }],
    ['foreign id', { ...base, phase: 'creating', orgs: [orgs[0], '06440000-0000-0000-0000-0000000000ff'] }],
  ]) {
    assert.throws(() => ownershipPlan(record, orgs), /race ownership/, label);
  }

  assert.deepEqual(CLEANUP_ORDER, [
    'stop-sessions',
    'drain-owned-backends',
    'delete-exact-owned-ids',
    'assert-owned-zero-and-foreign-digests',
  ], 'cleanup order is fixed: sessions, backends, exact ids, then proofs');
});

test('shipped race caller starts a real child through the default spawn interface', async () => {
  const { readFileSync, mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('./financial-statements-nightly-intent-race.test.mjs', import.meta.url), 'utf8');
  const caller = source.match(/function startPsql\(sql, suffix, keepOpen = false\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(caller, 'shipped startPsql caller must exist');
  const directory = mkdtempSync(join(tmpdir(), 'nightly-mock-psql-'));
  const oldPath = process.env.PATH;
  try {
    writeFileSync(join(directory, 'docker'), '#!/bin/sh\ncat\n', { mode: 0o755 });
    process.env.PATH = `${directory}:${oldPath}`;
    const startPsql = runInNewContext(`(${caller})`, { startSession, DOCKER_ARGS: [], sessionApp: (suffix) => `test_${suffix}` });
    const session = startPsql('select 1;\n', 'barrier', true);
    assert.equal(session.stdinOpen, true);
    session.release('commit;\n');
    const result = await session.done;
    assert.equal(result.status, 0);
    assert.match(result.stdout, /select 1;\ncommit;/);
    assert.equal(result.stderr, '');
  } finally {
    process.env.PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shipped fixture caller preserves distinct journals through two sequential scenarios', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('./financial-statements-nightly-intent-race.test.mjs', import.meta.url), 'utf8');
  assert.match(source, /withFixture\('manual',/);
  assert.match(source, /withFixture\('nightly',/);
  const caller = source.match(/async function withFixture\(scenario, body\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(caller);
  const directory = mkdtempSync(join(tmpdir(), 'nightly-journals-'));
  const base = join(directory, 'ownership.json');
  try {
    const withFixture = runInNewContext(`(${caller})`, {
      OWNERSHIP_FILE: base,
      setupFixture: async (path) => writeFileSync(path, 'created', { flag: 'wx' }),
      cleanupFixture: async (path) => writeFileSync(path, 'cleaned'),
    });
    await withFixture('manual', async () => {});
    await withFixture('nightly', async () => {});
    assert.equal(readFileSync(`${base}.manual`, 'utf8'), 'cleaned');
    assert.equal(readFileSync(`${base}.nightly`, 'utf8'), 'cleaned');
    assert.throws(() => readFileSync(base), { code: 'ENOENT' });
    await assert.rejects(withFixture('manual', async () => {}), { code: 'EEXIST' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('real caller result preserves stderr and refuses nonzero, empty or partial JSON', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('./financial-statements-nightly-intent-race.test.mjs', import.meta.url), 'utf8');
  const caller = source.match(/function startPsql\(sql, suffix, keepOpen = false\) \{[\s\S]*?\n\}/)[0];
  const line = source.match(/function lastLine\(out\) \{[\s\S]*?\n\}/)[0];
  assert.ok((source.match(/JSON\.parse\(lastLine\(result\.stdout\)\)/g) ?? []).length >= 2);
  const directory = mkdtempSync(join(tmpdir(), 'nightly-results-'));
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = `${directory}:${oldPath}`;
    const startPsql = runInNewContext(`(${caller})`, { startSession, DOCKER_ARGS: [], sessionApp: (suffix) => `test_${suffix}` });
    const lastLine = runInNewContext(`(${line})`);
    for (const [script, status, stdout, stderr] of [
      ["printf '{\"status\":\"accepted\"}\\n'; printf 'notice\\n' >&2", 0, '{"status":"accepted"}\n', 'notice\n'],
      ["printf 'broken\\n' >&2; exit 7", 7, '', 'broken\n'],
      ['exit 0', 0, '', ''],
      ["printf '{\"status\":'", 0, '{"status":', ''],
    ]) {
      writeFileSync(join(directory, 'docker'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
      const result = await startPsql('select 1;\n', 'request').done;
      assert.equal(result.status, status);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, stderr);
      if (status !== 0) assert.throws(() => assert.equal(result.status, 0, result.output));
      else if (!stdout || stdout.endsWith(':')) assert.throws(() => JSON.parse(lastLine(result.stdout)));
      else assert.equal(JSON.parse(lastLine(result.stdout)).status, 'accepted');
    }
  } finally {
    process.env.PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
