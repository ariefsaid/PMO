import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fixture, withBlocker, runRace, assertLocalUrl } from './budgets.allocation-proof.mjs';

function child(script) { return spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] }); }
test('collision is never cleaned; partial owned setup is cleaned', () => {
  const calls = [];
  const collision = fixture(q => { calls.push(q); throw Error('collision'); }, 'p', 's');
  assert.throws(() => collision.setup(), /collision/);
  collision.cleanup();
  assert.equal(calls.length, 1);
  const partialCalls = [];
  const partial = fixture(q => { partialCalls.push(q); if (partialCalls.length === 2) throw Error('source failed'); }, 'p', 's');
  assert.throws(() => partial.setup(), /source failed/);
  partial.cleanup();
  assert.match(partialCalls[2], /delete from projects/);
});
test('malformed PID releases and settles blocker before failure', async () => {
  let proc;
  await assert.rejects(runRace('bad', () => Promise.resolve(), () => Promise.resolve(), false, { project: 'p', source: 's' }, {
    query: () => '1', spawn: () => (proc = child("process.stdout.write('bad\\nREADY\\n'); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0))")), timeout: 1000,
  }), /invalid blocker PID/);
  assert.equal(proc.exitCode, 0);
});
test('failure releases blocker before awaiting waiting writers', async () => {
  let proc;
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  await assert.rejects(runRace('overlap', () => waiting, () => waiting, false, { project: 'p', source: 's' }, {
    query: q => { if (q.includes('pg_stat_activity')) throw Error('overlap failure'); return '1'; },
    spawn: () => { proc = child("process.stdout.write('123\\nREADY\\n'); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0))"); proc.on('close', release); return proc; }, timeout: 1000,
  }), /overlap failure/);
  assert.equal(proc.exitCode, 0);
});
test('startup exit and timeout settle child and retain original failure with cleanup error', async () => {
  const proc = child('process.exit(2)');
  await assert.rejects(withBlocker(proc, async () => { await new Promise(r => setTimeout(r, 100)); throw Error('startup failed'); }, 1000), error => error instanceof AggregateError && error.cause.message === 'startup failed');
  const stuck = child('process.stdin.resume(); setInterval(()=>{},1000)');
  await assert.rejects(withBlocker(stuck, async () => { throw Error('original'); }, 100), error => error.cleanupUnsafe && error.cause.message === 'original');
  assert.notEqual(stuck.signalCode, null);
});

test('rejects nonlocal PostgREST endpoints', () => {
  assert.doesNotThrow(() => assertLocalUrl('http://127.0.0.1:54321'));
  assert.throws(() => assertLocalUrl('https://example.com'));
});
test('startup timeout and spawn error settle before returning', async () => {
  let proc;
  await assert.rejects(runRace('timeout', () => {}, () => {}, false, { project: 'p', source: 's' }, {
    query: () => '1', spawn: () => (proc = child("process.stdin.resume(); process.stdin.on('end',()=>process.exit(0))")), startupPolls: 2, timeout: 1000,
  }), /blocker did not start/);
  assert.equal(proc.exitCode, 0);
  await assert.rejects(runRace('spawn', () => {}, () => {}, false, { project: 'p', source: 's' }, {
    query: () => '1', spawn: () => spawn('/nonexistent-allocation-proof-command', [], { stdio: ['pipe', 'pipe', 'pipe'] }), timeout: 1000,
  }), /Proof failed and cleanup also failed/);
});
test('rejected writer still settles the committed blocker', async () => {
  let proc;
  await assert.rejects(runRace('writer', () => { throw Error('writer failed'); }, () => {}, false, { project: 'p', source: 's' }, {
    query: q => q.includes('pg_stat_activity') ? '2' : '1',
    spawn: () => (proc = child("process.stdout.write('123\\nREADY\\n'); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0))")), timeout: 1000,
  }), /rejected/);
  assert.equal(proc.exitCode, 0);
});
