// Shared by the Odoo replay mutation witnesses: run the Deno test file, read its summary line, and
// print the run's output whenever it is not what the witness expects (CI shows only what we print).
import { spawnSync } from 'node:child_process';
import process from 'node:process';

export const runDenoTest = (cwd, config, test) => spawnSync('deno', ['test', '--config', config, '--allow-env', '--allow-net', '--allow-read', test], {
  cwd, encoding: 'utf8', timeout: 240_000, env: { ...process.env, NO_COLOR: '1' },
});

// `7 passed | 0 failed`; a run with no summary line (compile error, timeout) reads as NaN.
export const summary = (r) => {
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { out, passed: Number(/(\d+) passed/.exec(out)?.[1] ?? NaN), failed: Number(/(\d+) failed/.exec(out)?.[1] ?? NaN) };
};

export const fail = (why, r) => {
  const tail = summary(r).out.split('\n').slice(-60).join('\n');
  console.error(`${why}\nexit=${r.status} signal=${r.signal ?? ''} error=${r.error?.message ?? ''}\n--- deno output (last 60 lines) ---\n${tail}`);
  process.exit(1);
};
