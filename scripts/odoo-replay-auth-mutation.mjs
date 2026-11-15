#!/usr/bin/env node
// Mutation witness for #2283: disable the shared replay-authorization refusal; all three Odoo recovery domains must go red.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, runDenoTest, summary } from './lib/denoWitness.mjs';
import process from 'node:process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(REPO, 'supabase/functions/adapter-dispatch/odooReplayDeps.ts');
const TEST = 'supabase/functions/adapter-dispatch/odooReplayDeps.test.ts';
const FROM = /if \(!replayAuth\.ok\) (throw new AppError\(replayAuth\.message, 'commit-rejected'\);) \/\/ mut:replay-auth/;

const CONFIG = 'supabase/functions/adapter-dispatch/deno.json';
const run = () => runDenoTest(REPO, CONFIG, TEST);

const original = readFileSync(SOURCE, 'utf8');
if (!FROM.test(original)) { console.error('mutation anchor `mut:replay-auth` not found'); process.exit(2); }
let mutated;
try {
  writeFileSync(SOURCE, original.replace(FROM, 'if (false) $1 // mut:replay-auth'));
  mutated = run();
} finally {
  writeFileSync(SOURCE, original); // restore first: fail() exits, and exit skips finally blocks
}
const m = summary(mutated);
if (m.failed !== 3) fail(`expected 3 failed with authorization disabled, saw ${m.failed}`, mutated);
const total = m.passed + m.failed;
// The restored run must be fully green over the same tests the mutated run ran (no hard-coded count).
const clean = run();
const c = summary(clean);
if (c.failed !== 0 || c.passed !== total) fail(`restored source is not green (passed ${c.passed} of ${total}, failed ${c.failed})`, clean);
console.log('replay-auth mutation: 3/3 domains red when broken, green when restored');
