import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  namespacePredicate,
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
