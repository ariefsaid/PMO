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
 *
 * The pure parsing/matching helpers below are exported so pmo-portal/src/lib/analytics/
 * checkDashboardTiles.test.ts can unit-test them directly (Vitest, part of `npm test`/`verify` —
 * SECURITY 2026-07-27 review round 2 #7 found two integrity gaps here that a manual demo alone
 * would not have kept regression-tested).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = resolve(REPO, 'pmo-portal');

/**
 * Every `{ event: 'x' }` / `{ event: "x" }` / `` { event: `x` } `` and `funnel([...])` reference
 * in the dashboard spec. SECURITY (#7): the original regex matched ONLY single-quoted event
 * names — a tile authored with double quotes or a template literal (both valid, unremarkable JS)
 * was silently invisible to this gate, while `tileEvents.size > 0` still reported green (this
 * catches TOTAL parse failure — an empty/broken spec — but not SELECTIVE invisibility of one
 * differently-quoted tile). Matches any of the 3 quote characters, backreferenced so an open `'`
 * can't be closed by a stray `"`.
 */
export function extractTileEvents(tilesSrc) {
  const tileEvents = new Set();
  for (const m of tilesSrc.matchAll(/\bevent:\s*(['"`])([a-z0-9_$]+)\1/g)) tileEvents.add(m[2]);
  for (const m of tilesSrc.matchAll(/funnel\(\[([^\]]+)\]/g)) {
    for (const e of m[1].matchAll(/(['"`])([a-z0-9_$]+)\1/g)) tileEvents.add(e[2]);
  }
  return tileEvents;
}

/** event -> { producer, kind } from the typed registry (eventCallSites.ts's own literal shape —
 *  always single-quoted TS source we author ourselves, unlike the dashboard spec above). */
export function extractRegistry(registrySrc) {
  const registry = new Map();
  for (const m of registrySrc.matchAll(
    /^\s{2}([a-z0-9_]+):\s*\{\s*producer:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'(facade|provider)'/gm,
  )) {
    registry.set(m[1], { producer: m[2], kind: m[3] });
  }
  return registry;
}

/**
 * SECURITY (#7): requires a real CALL shape (`producer(`), not a bare identifier mention. The
 * original check (`\bproducer\b`) was satisfied by a COMMENT referencing the producer's name —
 * exactly the "wrapper exists, nothing calls it" trap this whole gate exists to catch, one level
 * deeper. Disclosed residual: a comment that happens to spell out a call-shaped mention (e.g.
 * `// see trackFoo(...)`) still satisfies this — full comment-stripping was judged too risky here
 * (a naive strip can mis-parse `//` inside a URL string literal) for the marginal gain.
 */
export function hasCallSite(sources, producer) {
  return new RegExp(`\\b${producer}\\s*\\(`).test(sources);
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

function main() {
  const tilesSrc = readFileSync(resolve(REPO, 'scripts/posthog/provision-dashboards.mjs'), 'utf8');
  const registrySrc = readFileSync(resolve(APP, 'src/lib/analytics/eventCallSites.ts'), 'utf8');

  const tileEvents = extractTileEvents(tilesSrc);

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

  const registry = extractRegistry(registrySrc);

  if (registry.size === 0) {
    console.error(
      `ERROR: 0 entries parsed from ${resolve(APP, 'src/lib/analytics/eventCallSites.ts')}.\n` +
      '  An unreadable/empty/reshaped registry must not silently pass every tile.',
    );
    process.exit(1);
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
    if (!hasCallSite(sources, entry.producer)) {
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
}

// Only run the CLI when this file is executed directly (`node scripts/check-dashboard-tiles.mjs`)
// — not when imported for its pure helpers by checkDashboardTiles.test.ts.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
