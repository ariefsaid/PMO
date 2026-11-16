#!/usr/bin/env node
// Guard: docs/ux/layout-baseline.json may only shrink. Against origin/dev, a key may not gain a
// failure fingerprint and a key that is new must be empty. `ux-proof.mjs --update-layout-baseline`
// never adds a fingerprint; `--seed-new` is the only way a new key is written, and this guard is what
// keeps a seeded key from carrying failures into dev.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'docs/ux/layout-baseline.json';

/** Errors for a head baseline measured against a base one; `base` null = the file does not exist on the base yet. */
export function compareBaselines(base, head) {
  const errors = [];
  for (const [key, value] of Object.entries(head)) {
    if (!Array.isArray(value) || value.some((fp) => typeof fp !== 'string')) { errors.push(`${key}: the value must be a list of fingerprints`); continue; }
    if (base === null) continue;
    if (!(key in base)) { if (value.length) errors.push(`${key}: a new key must be empty, it carries ${value.length} fingerprint(s)`); continue; }
    const allowed = new Set(base[key]);
    for (const fp of value) if (!allowed.has(fp)) errors.push(`${key}: gained fingerprint ${fp}`);
  }
  return errors;
}

/** True when every value is a list, i.e. the fingerprint format (the first version of the file stored counts). */
export function isFingerprintFormat(baseline) {
  return Object.values(baseline).every((value) => Array.isArray(value));
}

function selfTest() {
  const base = { a: ['x', 'y'], b: [] };
  const cases = [
    ['unchanged', { a: ['x', 'y'], b: [] }, 0],
    ['shrunk', { a: ['x'], b: [] }, 0],
    ['key gains a fingerprint', { a: ['x', 'y', 'z'], b: [] }, 1],
    ['a key swaps one fingerprint for another', { a: ['x', 'z'], b: [] }, 1],
    ['empty key gains one', { a: ['x'], b: ['q'] }, 1],
    ['new empty key', { a: ['x'], b: [], c: [] }, 0],
    ['new key with failures', { a: ['x'], b: [], c: ['q'] }, 1],
    ['count instead of list', { a: 3, b: [] }, 1],
  ];
  for (const [name, head, expected] of cases) {
    const got = compareBaselines(base, head).length;
    if (got !== expected) throw new Error(`self-test failed: ${name}: expected ${expected} error(s), got ${got}`);
  }
  if (compareBaselines(null, { a: ['x'] }).length) throw new Error('self-test failed: the first introduction of the file has nothing to compare against');
  if (isFingerprintFormat({ a: 3 }) || !isFingerprintFormat({ a: ['x'], b: [] })) throw new Error('self-test failed: the count format must be told apart from the fingerprint format');
  console.log('layout-baseline guard self-test passed');
}

if (process.argv.includes('--self-test')) { selfTest(); process.exit(0); }
const head = existsSync(path.join(ROOT, FILE)) ? JSON.parse(readFileSync(path.join(ROOT, FILE), 'utf8')) : {};
const ref = process.env.LAYOUT_BASELINE_BASE || 'origin/dev';
const exists = spawnSync('git', ['cat-file', '-e', `${ref}:${FILE}`], { cwd: ROOT });
let base = null;
if (exists.status === 0) {
  base = JSON.parse(spawnSync('git', ['show', `${ref}:${FILE}`], { cwd: ROOT, encoding: 'utf8' }).stdout);
  // A base still in the earlier count format has no fingerprints to compare; treat it as not introduced yet.
  if (!isFingerprintFormat(base)) base = null;
} else if (spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: ROOT }).status !== 0) {
  console.error(`layout-baseline guard: ${ref} is not available here; fetch it (git fetch origin dev) and re-run.`);
  process.exit(1);
}
const errors = compareBaselines(base, head);
if (errors.length) {
  console.error(`layout-baseline guard: ${FILE} grew against ${ref}:`);
  errors.forEach((error) => console.error(`  ${error}`));
  process.exit(1);
}
console.log(`layout-baseline guard: ${Object.keys(head).length} key(s), none grew against ${ref}${base === null ? ' (file not on the base yet)' : ''}`);
