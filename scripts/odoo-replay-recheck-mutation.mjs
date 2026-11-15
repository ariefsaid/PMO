#!/usr/bin/env node
// Mutation witness for #2283 review I1: disable the reissue re-check in the shared replay builder; the
// revenue and stock re-check tests must go red (the wrap runs for every domain, not only procurement).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(REPO, 'supabase/functions/adapter-dispatch/odooReplayDeps.ts');
const TEST = 'supabase/functions/adapter-dispatch/odooReplayDeps.test.ts';
const FROM = /const authorization = await asActor\('failed'\); \/\/ mut:reissue-recheck/;

const CONFIG = 'supabase/functions/adapter-dispatch/deno.json';
const run = () => spawnSync('deno', ['test', '--config', CONFIG, '--allow-env', '--allow-net', '--allow-read', TEST], {
  cwd: REPO, encoding: 'utf8', timeout: 240_000, env: { ...process.env, NO_COLOR: '1' },
});
const failedCount = (out) => Number(/(\d+) failed/.exec(out)?.[1] ?? NaN);

const original = readFileSync(SOURCE, 'utf8');
if (!FROM.test(original)) { console.error('mutation anchor `mut:reissue-recheck` not found'); process.exit(2); }
try {
  writeFileSync(SOURCE, original.replace(FROM, "const authorization = await Promise.resolve({ ok: true, status: 200, message: '' }); // mut:reissue-recheck"));
  const mutated = run();
  const red = failedCount(mutated.stdout + mutated.stderr);
  if (red !== 4) { console.error(`expected 4 failed with the reissue re-check disabled, saw ${red}`); process.exit(1); }
} finally {
  writeFileSync(SOURCE, original);
}
const clean = run();
const out = clean.stdout + clean.stderr;
if (failedCount(out) !== 0 || !/7 passed/.test(out)) { console.error('restored source is not green'); process.exit(1); }
console.log('reissue-recheck mutation: 4/4 re-check tests red when broken, 7 green when restored');
