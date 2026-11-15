#!/usr/bin/env node
// Mutation witness for #2283: disable the shared replay-authorization refusal; all three Odoo recovery domains must go red.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(REPO, 'supabase/functions/adapter-dispatch/odooReplayDeps.ts');
const TEST = 'supabase/functions/adapter-dispatch/odooReplayDeps.test.ts';
const FROM = /if \(!replayAuth\.ok\) (throw new AppError\(replayAuth\.message, 'commit-rejected'\);) \/\/ mut:replay-auth/;

const CONFIG = 'supabase/functions/adapter-dispatch/deno.json';
const run = () => spawnSync('deno', ['test', '--config', CONFIG, '--allow-env', '--allow-net', '--allow-read', TEST], {
  cwd: REPO, encoding: 'utf8', timeout: 240_000, env: { ...process.env, NO_COLOR: '1' },
});
const failedCount = (out) => Number(/(\d+) failed/.exec(out)?.[1] ?? NaN);

const original = readFileSync(SOURCE, 'utf8');
if (!FROM.test(original)) { console.error('mutation anchor `mut:replay-auth` not found'); process.exit(2); }
try {
  writeFileSync(SOURCE, original.replace(FROM, 'if (false) $1 // mut:replay-auth'));
  const mutated = run();
  const red = failedCount(mutated.stdout + mutated.stderr);
  if (red !== 3) { console.error(`expected 3 failed with authorization disabled, saw ${red}`); process.exit(1); }
} finally {
  writeFileSync(SOURCE, original);
}
const clean = run();
const out = clean.stdout + clean.stderr;
if (failedCount(out) !== 0 || !/3 passed/.test(out)) { console.error('restored source is not green'); process.exit(1); }
console.log('replay-auth mutation: 3/3 domains red when broken, green when restored');
