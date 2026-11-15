#!/usr/bin/env node
// Mutation witness for #2283 review I1: disable the reissue re-check in the shared replay builder; the
// revenue and stock re-check tests must go red (the wrap runs for every domain, not only procurement).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, runDenoTest, summary } from './lib/denoWitness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(REPO, 'supabase/functions/adapter-dispatch/odooReplayDeps.ts');
const TEST = 'supabase/functions/adapter-dispatch/odooReplayDeps.test.ts';
const FROM = /const authorization = await asActor\('failed'\); \/\/ mut:reissue-recheck/;

const CONFIG = 'supabase/functions/adapter-dispatch/deno.json';
const run = () => runDenoTest(REPO, CONFIG, TEST);

const original = readFileSync(SOURCE, 'utf8');
if (!FROM.test(original)) { console.error('mutation anchor `mut:reissue-recheck` not found'); process.exit(2); }
let mutated;
try {
  writeFileSync(SOURCE, original.replace(FROM, "const authorization = await Promise.resolve({ ok: true, status: 200, message: '' }); // mut:reissue-recheck"));
  mutated = run();
} finally {
  writeFileSync(SOURCE, original); // restore first: fail() exits, and exit skips finally blocks
}
const m = summary(mutated);
if (m.failed !== 4) fail(`expected 4 failed with the reissue re-check disabled, saw ${m.failed}`, mutated);
const total = m.passed + m.failed;
// The restored run must be fully green over the same tests the mutated run ran (no hard-coded count).
const clean = run();
const c = summary(clean);
if (c.failed !== 0 || c.passed !== total) fail(`restored source is not green (passed ${c.passed} of ${total}, failed ${c.failed})`, clean);
console.log('reissue-recheck mutation: 4/4 re-check tests red when broken, all green when restored');
