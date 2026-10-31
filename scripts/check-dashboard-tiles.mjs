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
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/** event -> { producer, kind: 'server' } from supabase/functions/_shared/serverEventProducers.ts.
 *  Event names may start with `$` (the PostHog `$ai_*` family). */
export function extractServerRegistry(src) {
  const m = new Map();
  for (const x of src.matchAll(/^\s{2}(\$?[a-z0-9_]+):\s*\{\s*producer:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'server'/gm)) {
    m.set(x[1], { producer: x[2], kind: 'server' });
  }
  return m;
}

/** Tile events the browser registry does not own must be server events with a producer CALL in a
 *  function dir (never in `_shared/`, so the producer's own definition cannot satisfy the check). */
export function checkServerEvents(tileEvents, serverRegistry, serverSources, browserEvents = new Set()) {
  const failures = [];
  for (const ev of [...tileEvents].sort()) {
    if (browserEvents.has(ev)) continue;
    const entry = serverRegistry.get(ev);
    if (!entry) {
      failures.push(`tile event '${ev}' is in neither the browser nor the server producer registry`);
      continue;
    }
    if (!hasCallSite(serverSources, entry.producer)) {
      failures.push(`tile event '${ev}' has NO server call site: '${entry.producer}(' is never called under supabase/functions/<fn>/`);
    }
  }
  return failures;
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

// The dashboard spec is split: dashboardSpec.mjs (legacy tiles) + one fragment per slice in
// scripts/posthog/spec/*.mjs. Concatenated so every tile is scanned; zero files hard-fails.
const SPEC_DIR = resolve(REPO, 'scripts/posthog');
function readTilesSource() {
  const files = [
    join(SPEC_DIR, 'dashboardSpec.mjs'),
    ...readdirSync(join(SPEC_DIR, 'spec')).filter((n) => n.endsWith('.mjs')).sort().map((n) => join(SPEC_DIR, 'spec', n)),
  ];
  return files.map((p) => readFileSync(p, 'utf8')).join('\n');
}

// Non-test .ts under supabase/functions/<fn>/, excluding _shared/.
function walkServer(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '_shared') continue;
    if (statSync(p).isDirectory()) { walkServer(p, out); continue; }
    if (!/\.ts$/.test(name) || /\.(test|spec)\.ts$/.test(name)) continue;
    out.push(p);
  }
  return out;
}

function main() {
  const tilesSrc = readTilesSource();
  const registrySrc = readFileSync(resolve(APP, 'src/lib/analytics/eventCallSites.ts'), 'utf8');

  const tileEvents = extractTileEvents(tilesSrc);

  // A gate that scans zero tiles and reports green is the exact "empty registry reads as OK"
  // failure class this program keeps hitting — an emptied/broken SPEC must hard-fail, not pass.
  if (tileEvents.size === 0) {
    console.error(
      `ERROR: 0 dashboard-tile events found in ${SPEC_DIR}/dashboardSpec.mjs + spec/*.mjs.\n` +
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

  const serverRegistrySrc = readFileSync(resolve(REPO, 'supabase/functions/_shared/serverEventProducers.ts'), 'utf8');
  const serverRegistry = extractServerRegistry(serverRegistrySrc);
  if (serverRegistry.size === 0) {
    console.error(
      `ERROR: 0 entries parsed from ${resolve(REPO, 'supabase/functions/_shared/serverEventProducers.ts')}.\n` +
      '  An unreadable/empty/reshaped server registry must not silently pass every server tile.',
    );
    process.exit(1);
  }
  const serverFiles = walkServer(resolve(REPO, 'supabase/functions'));
  if (serverFiles.length === 0) {
    console.error(
      `ERROR: 0 source files scanned under ${resolve(REPO, 'supabase/functions')}.\n` +
      '  A gate that scanned nothing must not report success.',
    );
    process.exit(1);
  }
  const serverSources = serverFiles.map((p) => readFileSync(p, 'utf8')).join('\n');

  let failed = false;
  const browserEvents = new Set(registry.keys());
  for (const event of [...tileEvents].sort()) {
    const entry = registry.get(event);
    if (!entry) continue; // not a browser event: checked against the server registry below
    if (entry.kind === 'provider') continue; // captured by the provider; no external caller expected
    if (!hasCallSite(sources, entry.producer)) {
      console.error(
        `✗ tile event '${event}' has NO call site: '${entry.producer}' is never referenced outside src/lib/analytics/**.\n` +
        `    A provisioned tile for an event that cannot fire renders an empty chart that reads as a product fact.`,
      );
      failed = true;
    }
  }
  for (const f of checkServerEvents(tileEvents, serverRegistry, serverSources, browserEvents)) {
    console.error(`✗ ${f}`);
    failed = true;
  }

  if (failed) {
    console.error('\nEvery provisioned dashboard tile must depend on an event with a real call site (docs/adr/0067).');
    process.exit(1);
  }
  console.log(`✓ dashboard tiles all have live call sites (${tileEvents.size} events)`);
}

/**
 * BLOCKING (code-quality review): whether this module is being run directly as the CLI entry
 * point, vs. imported for its pure helpers (checkDashboardTiles.test.ts). A naive
 * `import.meta.url === 'file://' + argv1` template-string comparison breaks the instant the path
 * needs percent-encoding (a space becomes `%20` in a real `file://` URL but not in the raw argv
 * string) — a tree copied to a directory with a space in its name silently never runs `main()`:
 * no output, exit 0, and `npm run verify` records a PASSING gate that scanned zero tiles. This is
 * the exact green-by-absence class this file's own three empty-input guards exist to prevent —
 * they can't fire if `main()` itself never executes. `pathToFileURL` builds the URL the same way
 * Node does internally, so the comparison is correct for any path Node can actually produce.
 */
export function isRunAsMain(importMetaUrl, argv1) {
  return importMetaUrl === pathToFileURL(argv1).href;
}

// Only run the CLI when this file is executed directly (`node scripts/check-dashboard-tiles.mjs`)
// — not when imported for its pure helpers by checkDashboardTiles.test.ts.
if (isRunAsMain(import.meta.url, process.argv[1])) {
  main();
}
