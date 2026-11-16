// Tracked runner for the repository script tests (CI step "Repository script tests (non-DB)").
// Before #2332 the CI step built its file list inline with `mapfile`, which macOS bash 3.2
// lacks: a copied step got an empty list and `node --test` with no files runs EVERY test in
// the tree. This module owns the list and its exclusions so the Mac and the runner agree.
//
// Usage (from the repo root, as ci.yml does):
//   node scripts/run-script-tests.mjs --self-test   # guard: list non-empty, exclusions live, no leak
//   node scripts/run-script-tests.mjs --list        # print scripts/<file>, one per line
//   node scripts/run-script-tests.mjs               # run the list through `node --test`
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDir = path.join(repoRoot, 'scripts');

// Files that carry `.test.mjs` but are NOT run by this runner. One-line reason each; these are
// exactly the `! -name` exclusions the CI step carried before #2332. Exported so the test can
// pin the contract (every name live, none leaking into the list).
export const EXCLUDED = [
  // needs the database: pgtap job, "Financial statement script tests (local Supabase required)"
  'financial-statements-publication-race.test.mjs',
  // needs the database: pgtap job, "Financial statement script tests (local Supabase required)"
  'financial-statements-rollback.test.mjs',
  // needs the database: pgtap job + release path, "…nightly-intent race (local Supabase required)"
  'financial-statements-nightly-intent-race.test.mjs',
  // needs the database: pgtap job, "Financial statement script tests (local Supabase required)"
  '2195-journal-safety-rollback.test.mjs',
  // launches the Playwright ux-proof render: integration job, "Rendered proof self-test"
  'ux-proof.test.mjs',
  // needs the database: stock-connect job, under scripts/with-db-lock.sh
  'stock-connect-race.test.mjs',
  // needs the database: pgtap job, "AI credit allocation two-session race" under scripts/with-db-lock.sh
  'credit-allocation-race.test.mjs',
];

// Pure: from a directory listing of scripts/ (file names), the ordered test list this runner
// executes. depth 1 = the listing itself only ever holds scripts/ entries, no recursion.
export function listScriptTests(entries) {
  return entries
    .filter((name) => name.endsWith('.test.mjs'))
    .filter((name) => !EXCLUDED.includes(name))
    .sort();
}

// Pure: the --self-test checks. Returns problem strings; an empty array is healthy. Takes the
// listing so a test can call it with a fake directory. `listFn` defaults to the real list
// function; injecting a broken one proves the leak check fires (the self-test would catch a
// list function that stopped dropping exclusions). Asserts the list is non-empty, every
// EXCLUDED name still exists on disk (a stale exclusion fails here), and no listed file is
// excluded.
export function selfTestProblems(entries, listFn = listScriptTests) {
  const problems = [];
  const present = new Set(entries);
  const listed = listFn(entries);
  if (listed.length === 0) {
    problems.push('script test list is empty — refusing to run `node --test` with no files');
  }
  for (const name of EXCLUDED) {
    if (!present.has(name)) {
      problems.push(`stale exclusion: scripts/${name} no longer exists — drop it from EXCLUDED`);
    }
  }
  for (const name of listed) {
    if (EXCLUDED.includes(name)) {
      problems.push(`excluded file leaked into the run list: scripts/${name}`);
    }
  }
  return problems;
}

// The real directory listing (files only, depth 1).
export function readScriptsEntries() {
  return fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function main(argv) {
  const entries = readScriptsEntries();
  const files = listScriptTests(entries);

  if (argv.includes('--list')) {
    for (const name of files) console.log(`scripts/${name}`);
    return 0;
  }

  if (argv.includes('--self-test')) {
    const problems = selfTestProblems(entries);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`run-script-tests: ${problem}`);
      return 1;
    }
    console.log(
      `run-script-tests: self-test ok (${files.length} script tests, ${EXCLUDED.length} exclusions all live)`,
    );
    return 0;
  }

  if (files.length === 0) {
    console.error(
      'run-script-tests: no scripts/*.test.mjs files found — refusing to run `node --test` with no files (it would run every test file in the tree)',
    );
    return 1;
  }

  const result = spawnSync(
    process.execPath,
    ['--test', ...files.map((name) => path.join(scriptsDir, name))],
    { stdio: 'inherit', cwd: repoRoot },
  );
  if (result.error) {
    console.error(`run-script-tests: failed to spawn node --test: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

// Only execute when run directly, so `node --test` importing this module does not run main.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
