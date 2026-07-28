#!/usr/bin/env node
/**
 * Guard: every deployed edge function MUST route its entry point through serveWithErrorReporting
 * (ADR-0066 §3, FR-OBS-001/002).
 *
 * Why this exists (2026-07-25): v0.8.0's deploy revealed that adapter-dispatch had been serving an
 * 8-day-old build and 11 functions had NEVER been deployed -- and nothing alerted anyone, because
 * only 4 of 22 functions produced error_events at all. Hand-wiring 22 functions fixes today; this
 * gate is what stops the 23rd shipping unwired.
 *
 * Three failure classes this gate itself must never fall into silently (each guarded below):
 *   - the empty-list case: zero function directories found (bad path, renamed directory) must
 *     hard-fail, not report "0/0 wired" as green;
 *   - the unreadable-file case: a function directory whose index.ts cannot be read must be a
 *     reported failure for that function, never a silent skip;
 *   - the never-ran case: `main()` only executes when this file is the process entry point,
 *     checked via `pathToFileURL`, not a `file://${argv1}` template string (the latter breaks on
 *     any path needing percent-encoding — e.g. a space — and silently never runs main()).
 *
 * Run: node scripts/check-edge-fn-error-reporting.mjs   (paths resolve from this script)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Override seam for the CLI-level test suite ONLY (checkEdgeFnErrorReporting.test.ts spawns this
// script against a throwaway temp directory to prove the empty-input / unreadable-file guards
// below actually fire, rather than trusting the pure helpers alone). Unset in every real run.
const FUNCTIONS = process.env.EDGE_FN_ERROR_REPORTING_FUNCTIONS_DIR
  ? resolve(process.env.EDGE_FN_ERROR_REPORTING_FUNCTIONS_DIR)
  : resolve(REPO, 'supabase/functions');

/** Every deployed edge-function directory (has an index.ts, name does not start with `_`). */
export function deployedFunctionDirs(functionsDir) {
  return readdirSync(functionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((name) => existsSync(resolve(functionsDir, name, 'index.ts')))
    .sort();
}

/**
 * Pure check over one function's index.ts source. Returns an array of failure message strings
 * (empty = wired correctly). Kept pure/exported so the vitest suite can prove this gate CAN go
 * red without shelling out.
 */
export function checkFunctionSource(name, src) {
  const failures = [];

  if (!/serveWithErrorReporting/.test(src)) {
    failures.push(
      `must serve through serveWithErrorReporting('${name}', handler) -- an unwired function cannot report any failure`,
    );
    return failures; // nothing further to check meaningfully
  }
  if (!new RegExp(`serveWithErrorReporting\\(\\s*['"]${name}['"]`).test(src)) {
    failures.push(
      `serveWithErrorReporting must be called with the function's OWN name '${name}' (a copy-pasted name misattributes every error)`,
    );
  }
  if (/(^|[^.\w])Deno\.serve\s*\(/m.test(src)) {
    failures.push('bare Deno.serve( bypasses the error-reporting wrapper -- use serveWithErrorReporting');
  }
  return failures;
}

function main() {
  const dirs = deployedFunctionDirs(FUNCTIONS);

  // Empty-list case: a gate that scans zero functions and reports green is exactly the
  // green-by-absence failure class this program keeps hitting (see check-dashboard-tiles.mjs).
  if (dirs.length === 0) {
    console.error(
      `ERROR: 0 edge-function directories found under ${FUNCTIONS}.\n` +
      '  Either the path is wrong or every function directory was filtered out -- a gate that\n' +
      '  scanned nothing must not report success.',
    );
    process.exit(1);
  }

  let failed = false;
  const fail = (file, msg) => { console.error(`✗ ${file}\n    ${msg}`); failed = true; };

  for (const name of dirs) {
    const file = `supabase/functions/${name}/index.ts`;
    const path = resolve(FUNCTIONS, name, 'index.ts');

    let src;
    try {
      src = readFileSync(path, 'utf8');
    } catch (err) {
      // Unreadable-file case: a function whose source cannot be read is a REPORTED failure for
      // that function, never a silent skip that shrinks the scanned set without saying so.
      fail(file, `could not read this file: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const msg of checkFunctionSource(name, src)) fail(file, msg);
  }

  if (failed) {
    console.error('\nEvery edge function must route its entry point through serveWithErrorReporting (docs/adr/0066).');
    process.exit(1);
  }
  console.log(`✓ edge fns route through serveWithErrorReporting (${dirs.length}/${dirs.length})`);
}

/**
 * Whether this module is being run directly as the CLI entry point, vs. imported for its pure
 * helpers (checkEdgeFnErrorReporting.test.ts). A naive `import.meta.url === 'file://' + argv1`
 * template-string comparison breaks the instant the path needs percent-encoding (a space becomes
 * `%20` in a real `file://` URL but not in the raw argv string) — a tree copied to a directory
 * with a space in its name would silently never run `main()`: no output, exit 0, and `npm run
 * verify` records a PASSING gate that scanned zero functions. `pathToFileURL` builds the URL the
 * same way Node does internally, so the comparison is correct for any path Node can produce.
 */
export function isRunAsMain(importMetaUrl, argv1) {
  return importMetaUrl === pathToFileURL(argv1).href;
}

// Only run the CLI when this file is executed directly (`node scripts/check-edge-fn-error-reporting.mjs`)
// — not when imported for its pure helpers by checkEdgeFnErrorReporting.test.ts.
if (isRunAsMain(import.meta.url, process.argv[1])) {
  main();
}
