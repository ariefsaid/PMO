#!/usr/bin/env node
/**
 * Parallel `verify` — the same four gates as `npm run verify`
 * (typecheck · lint:ci · build · test) but run CONCURRENTLY instead of serially.
 *
 * Rationale (perf/test-speed): the three fast, independent checks
 * (typecheck ~22s, lint ~18s, build ~2s) are on the critical path in the serial
 * `verify` even though `test` (~6 min) dwarfs them. Running them alongside the
 * test run collapses the wall-clock to ≈ the test run alone.
 *
 * Design:
 *  - `test` streams live (it's the long pole you watch); the fast trio is buffered
 *    and its output is flushed only if it FAILS (a green run stays quiet).
 *  - Waits for ALL tasks (never fail-fast) so one invocation surfaces every failure
 *    — a typecheck error AND a lint error show up together, not one-at-a-time.
 *  - Exits non-zero if any gate failed. No new dependency — just child_process.
 *
 * This is a LOCAL convenience gate. CI keeps its own step ordering (ci.yml) and the
 * canonical `npm run verify` is unchanged — both remain the authority.
 */
import { spawn } from 'node:child_process';

const TASKS = [
  { name: 'typecheck', args: ['run', 'typecheck'], stream: false },
  { name: 'lint', args: ['run', 'lint:ci'], stream: false },
  { name: 'build', args: ['run', 'build'], stream: false },
  { name: 'test', args: ['run', 'test'], stream: true },
];

/** Spawn one npm task; resolve with its exit code, duration, and buffered output. */
function run(task) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    // `test` streams to the terminal live; the fast trio is captured for on-failure replay.
    const stdio = task.stream ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'];
    const child = spawn('npm', task.args, { stdio, shell: false });
    if (!task.stream) {
      child.stdout.on('data', (d) => chunks.push(d));
      child.stderr.on('data', (d) => chunks.push(d));
    }
    child.on('close', (code) => {
      resolve({
        name: task.name,
        code: code ?? 1,
        secs: ((Date.now() - started) / 1000).toFixed(1),
        output: Buffer.concat(chunks).toString(),
      });
    });
    child.on('error', (err) => {
      resolve({ name: task.name, code: 1, secs: '0.0', output: String(err) });
    });
  });
}

const results = await Promise.all(TASKS.map(run));

let failed = false;
for (const r of results) {
  if (r.code !== 0) {
    failed = true;
    if (r.output) {
      console.log(`\n===== ${r.name} — FAIL (${r.secs}s) =====`);
      console.log(r.output);
    }
  }
}

console.log('\n── verify:parallel ─────────────────────');
for (const r of results) {
  console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.name.padEnd(10)} ${r.secs}s`);
}
process.exit(failed ? 1 : 0);
