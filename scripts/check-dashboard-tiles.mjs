#!/usr/bin/env node
/**
 * Guard: no provisioned dashboard tile may depend on an event that has no call site
 * (FR-PHG-013, AC-PHG-013, ADR-0067).
 *
 * Why this exists (2026-07-25): TWO tiles have been provisioned for months against events that
 * cannot fire. `save_failed` needed an `entityType` prop nobody passes AND a rethrow every form
 * swallows; `permission_denied_seen` had zero call sites outright. An empty chart reads as
 * "our users never hit this", which is a product conclusion drawn from a broken measurement.
 *
 * Run: node scripts/check-dashboard-tiles.mjs   (paths resolve from this script; wired into verify)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = resolve(REPO, 'pmo-portal');

const tilesSrc = readFileSync(resolve(REPO, 'scripts/posthog/provision-dashboards.mjs'), 'utf8');
const registrySrc = readFileSync(resolve(APP, 'src/lib/analytics/eventCallSites.ts'), 'utf8');

// Every `{ event: 'x' }` and `funnel(['a','b'])` reference in the dashboard spec.
const tileEvents = new Set();
for (const m of tilesSrc.matchAll(/\bevent:\s*'([a-z0-9_$]+)'/g)) tileEvents.add(m[1]);
for (const m of tilesSrc.matchAll(/funnel\(\[([^\]]+)\]/g)) {
  for (const e of m[1].matchAll(/'([a-z0-9_$]+)'/g)) tileEvents.add(e[1]);
}

// A gate that scans zero tiles and reports green is the exact "empty registry reads as OK"
// failure class this program keeps hitting — an emptied/broken SPEC must hard-fail, not pass.
if (tileEvents.size === 0) {
  console.error(
    `ERROR: 0 dashboard-tile events found in ${resolve(REPO, 'scripts/posthog/provision-dashboards.mjs')}.\n` +
    '  Either the dashboard spec is empty/broken, or this script failed to parse it — either way,\n' +
    '  a gate that scanned nothing must not report success.',
  );
  process.exit(1);
}

// event -> { producer, kind } from the typed registry.
const registry = new Map();
for (const m of registrySrc.matchAll(/^\s{2}([a-z0-9_]+):\s*\{\s*producer:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'(facade|provider)'/gm)) {
  registry.set(m[1], { producer: m[2], kind: m[3] });
}

if (registry.size === 0) {
  console.error(
    `ERROR: 0 entries parsed from ${resolve(APP, 'src/lib/analytics/eventCallSites.ts')}.\n` +
    '  An unreadable/empty/reshaped registry must not silently pass every tile.',
  );
  process.exit(1);
}

// All non-test source outside src/lib/analytics/**.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === '.auth') continue;
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(name)) continue;
    if (p.includes(join('src', 'lib', 'analytics'))) continue;
    out.push(p);
  }
  return out;
}
const sourceFiles = [...walk(resolve(APP, 'src')), ...walk(resolve(APP, 'pages'))];

// A gate over "some sources" that silently found zero files (a bad path, a renamed directory)
// would pass every facade-kind event by default — hard-fail instead of green-by-absence.
if (sourceFiles.length === 0) {
  console.error(
    `ERROR: 0 source files scanned under ${resolve(APP, 'src')} / ${resolve(APP, 'pages')}.\n` +
    '  Not a real tree, or everything got filtered out — a gate that scanned nothing must not\n' +
    '  report success (this is the exact silent-pass class this gate exists to prevent).',
  );
  process.exit(1);
}

const sources = sourceFiles.map((p) => readFileSync(p, 'utf8')).join('\n');

let failed = false;
for (const event of [...tileEvents].sort()) {
  const entry = registry.get(event);
  if (!entry) {
    console.error(`✗ tile event '${event}' is not in pmo-portal/src/lib/analytics/eventCallSites.ts`);
    failed = true;
    continue;
  }
  if (entry.kind === 'provider') continue; // captured by the provider; no external caller expected
  if (!new RegExp(`\\b${entry.producer}\\b`).test(sources)) {
    console.error(
      `✗ tile event '${event}' has NO call site: '${entry.producer}' is never referenced outside src/lib/analytics/**.\n` +
      `    A provisioned tile for an event that cannot fire renders an empty chart that reads as a product fact.`,
    );
    failed = true;
  }
}

if (failed) {
  console.error('\nEvery provisioned dashboard tile must depend on an event with a real call site (docs/adr/0067).');
  process.exit(1);
}
console.log(`✓ dashboard tiles all have live call sites (${tileEvents.size} events)`);
