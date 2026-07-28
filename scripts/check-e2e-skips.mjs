#!/usr/bin/env node
// Green-by-absence gate: a SKIPPED e2e test is not a passing one.
//
// The last CI run on main skipped 200 tests. Skips are invisible in a green tick, so a spec can
// stop exercising anything at all and nobody notices — AC-INV-001 skipped in CI for months while
// being permanently 503-red locally (its guard polarity was inverted; see #386).
//
// Same shape as scripts/audit-prod.mjs: an explicit, JUSTIFIED allowlist, and a STALE entry is
// itself a failure — so the list cannot quietly become "everything".
//
// Usage:  node scripts/check-e2e-skips.mjs <report.json> [more.json ...]
//         node scripts/check-e2e-skips.mjs --self-test
//
// ⚑ Pass EVERY lane's report to ONE invocation. Checked per-report, the `serial/` entry looks
// stale in the chromium report (and vice versa) and the gate would fail itself.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ⚑ pathToFileURL, NOT `file://${process.argv[1]}` — the hand-built form silently fails to match
// for any path needing percent-encoding (a directory with a space), so main() never runs and the
// gate reports success having scanned nothing. That exact bug shipped in the tile gate (#399).
const isRunAsMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

/**
 * Specs allowed to skip, keyed by the spec FILE **as the Playwright JSON reporter emits it** —
 * i.e. RELATIVE TO testDir (`AC-INV-001-invite.spec.ts`, `serial/AC-732-...`), never `e2e/...`.
 * A trailing slash matches a whole lane. `reason` must name the absent dependency, and
 * `restore` must say what would make it run again — a skip with no path back is a deleted test.
 * @type {Array<{file: string, reason: string, restore: string}>}
 */
export const ALLOWED_SKIPS = [
  // ── Served lane absent: config.toml sets [edge_runtime] enabled = false in CI *and* local, so
  // nothing serves functions/v1 unless scripts/serve-functions.sh is running (it exports
  // SUPABASE_FUNCTIONS_URL). These run in the served lane and skip everywhere else.
  {
    file: 'served-fn-smoke.spec.ts',
    reason: 'Served-lane boundary smoke — runs in CI\'s dedicated serve-functions step, not the ordinary lane.',
    restore: 'Runs whenever SUPABASE_FUNCTIONS_URL is set.',
  },
  {
    file: 'erpnext-feed-served-smoke.spec.ts',
    reason: 'Served-lane ERPNext feed smoke — needs both the served functions and a bench.',
    restore: 'Runs under scripts/serve-functions.sh with an ERPNext bench up.',
  },
  {
    file: 'AC-JWT-005-compose-view-auth.spec.ts',
    reason: 'Invokes the compose-view edge fn; also needs the stack env exported.',
    restore: 'Runs whenever SUPABASE_FUNCTIONS_URL + the stack env are present.',
  },
  {
    file: 'AC-INV-001-invite.spec.ts',
    reason: 'Invokes the REAL admin-invite-user edge fn (its goal oracle needs a live auth user + profile row).',
    restore: 'Runs whenever SUPABASE_FUNCTIONS_URL is set. Permanent fix: serve admin-invite-user in the ordinary lane, or page.route-mock it and seed the row.',
  },

  // ── ERPNext bench specs. A live Docker bench is a dev-bed concern, not CI's.
  // ⚑ These are the BENCH prefixes, NOT a blanket `serial/`. The blanket covered all 41 specs in
  // the lane while its own reason only justified the 32 bench ones — so a skip in any of the other
  // 9 (AC-732, AC-AU-001, AC-AUTH-005, AC-AUTHF-*, AC-CUA-*, AC-ENT-005, AC-IXD-PROC-W5-3) was
  // silently absorbed and reported "explained". That made #405's un-quarantine unverifiable: with
  // its specific allowlist entry deleted, nothing was left asserting AC-IXD-TS-W5-3 still RUNS —
  // a future `test.fixme` on it would have been invisible to every gate (demonstrated, 2026-07-28).
  ...['AC-BFY-', 'AC-BUD-', 'AC-ENA-', 'AC-SAR-', 'AC-TSP-'].map((prefix) => ({
    file: `serial/${prefix}`,
    reason: 'ERPNext bench specs — need a live Docker ERPNext bench.',
    restore: 'Run locally against the throwaway bench (scripts/e2e-local.sh with the bench up).',
  })),

  // ── Feature-flag quarantine: the incidents module is OFF. Code/DAL/RLS are preserved.
  {
    file: 'AC-IN-001-incidents-crud.spec.ts',
    reason: 'Incidents module is feature-flagged OFF; /incidents redirects home, so the journey is unreachable by design.',
    restore: 'Flip src/lib/features.ts incidents to true.',
  },
  {
    file: 'AC-INC-001-incident-detail.spec.ts',
    reason: 'Incidents module is feature-flagged OFF (same flag as AC-IN-001).',
    restore: 'Flip src/lib/features.ts incidents to true.',
  },

  // serial/AC-IXD-PROC-W5-3-approvals-inbox.spec.ts was un-quarantined 2026-07-27: its
  // AC-IXD-TS-W5-3 test now runs (drives the stacked fallback at a small viewport). The entry
  // was REMOVED — a skip allowlist entry for a test that runs again is STALE and fails this gate.
];

/** Walk the playwright JSON suite tree and collect every spec that did not actually run. */
function collectSkipped(report) {
  const out = [];
  const walk = (suite, file) => {
    const f = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      const everySkipped =
        spec.tests?.length > 0 &&
        spec.tests.every((t) => t.status === 'skipped' || t.results?.every((r) => r.status === 'skipped'));
      if (everySkipped) out.push({ file: spec.file ?? f, title: spec.title });
    }
    for (const child of suite.suites ?? []) walk(child, f);
  };
  for (const suite of report.suites ?? []) walk(suite, suite.file);
  return out;
}

// ⚑ LONGEST match, not the FIRST. Entries legitimately overlap: a lane prefix (`serial/`) and a
// specific spec inside that lane (`serial/AC-IXD-...`). With `.find()` the lane entry always won, so
// the specific entry was never marked "used" and the gate reported it STALE — failing itself on a
// correct allowlist (caught in CI, 2026-07-25). Longest-prefix is order-independent, so nobody has
// to remember to list specific entries before their lane.
const isAllowedIn = (allow, file) =>
  allow
    .filter((a) => file === a.file || file.startsWith(a.file))
    .sort((x, y) => y.file.length - x.file.length)[0];

/** Pure core so the self-test can exercise it without touching disk. */
export function audit(reports, allow = ALLOWED_SKIPS) {
  const skipped = reports.flatMap(collectSkipped);
  const unexplained = skipped.filter((s) => !isAllowedIn(allow, s.file));
  const used = new Set(skipped.map((s) => isAllowedIn(allow, s.file)?.file).filter(Boolean));
  const stale = allow.filter((a) => !used.has(a.file));
  return { skipped, unexplained, stale, used };
}

if (isRunAsMain && process.argv[2] === '--self-test') {
  const mk = (file) => ({ suites: [{ file, specs: [{ file, title: 't', tests: [{ status: 'skipped' }] }] }] });
  const ran = (file) => ({ suites: [{ file, specs: [{ file, title: 't', tests: [{ status: 'expected' }] }] }] });
  const allow = [{ file: 'ok.spec.ts', reason: 'r', restore: 'x' }];
  const a1 = audit([mk('ok.spec.ts')], allow);
  if (a1.unexplained.length || a1.stale.length) throw new Error('self-test FAIL: allowed skip flagged');
  const a2 = audit([mk('surprise.spec.ts'), mk('ok.spec.ts')], allow);
  if (a2.unexplained.length !== 1) throw new Error('self-test FAIL: unexplained skip not caught');
  const a3 = audit([ran('ok.spec.ts')], allow);
  if (a3.stale.length !== 1) throw new Error('self-test FAIL: stale entry not caught');
  // the multi-report contract: a lane-scoped entry must not look stale just because the other
  // lane's report was passed separately.
  const laneAllow = [{ file: 'serial/', reason: 'r', restore: 'x' }];
  const a4 = audit([ran('AC-1.spec.ts'), mk('serial/AC-2.spec.ts')], laneAllow);
  if (a4.stale.length) throw new Error('self-test FAIL: lane entry wrongly stale across reports');
  // OVERLAP: a lane prefix AND a specific spec inside it, lane listed FIRST. Both must count as used.
  const overlap = [
    { file: 'serial/', reason: 'lane', restore: 'x' },
    { file: 'serial/AC-2.spec.ts', reason: 'specific', restore: 'x' },
  ];
  const a5 = audit([mk('serial/AC-2.spec.ts'), mk('serial/AC-9.spec.ts')], overlap);
  if (a5.stale.length) throw new Error('self-test FAIL: specific entry under a lane prefix wrongly stale');
  if (a5.unexplained.length) throw new Error('self-test FAIL: lane-covered spec reported unexplained');
  console.log('check-e2e-skips self-test OK');
  process.exit(0);
}

// Importing this module (the self-test, or any harness exercising `audit`) must not run the CLI
// and must not process.exit — the pure core is only testable if importing it is side-effect free.
if (isRunAsMain) {
  const reportPaths = process.argv.slice(2);
  if (reportPaths.length === 0) {
    console.error('usage: check-e2e-skips.mjs <report.json> [more.json ...]  |  --self-test');
    process.exit(2);
  }
  const reports = reportPaths.map((p) => JSON.parse(readFileSync(p, 'utf8')));
  const { skipped, unexplained, stale: staleEntries } = audit(reports);

  for (const s of unexplained) {
    console.error(`✗ UNEXPLAINED SKIP  ${s.file}\n    ${s.title}`);
    console.error('    A skipped test proves nothing. Either make it run, or add a justified entry with a `restore` path.');
  }
  for (const a of staleEntries) {
    console.error(`✗ STALE ALLOWLIST ENTRY  ${a.file} — nothing skipped for it. Delete the entry.`);
  }
  for (const a of ALLOWED_SKIPS.filter((x) => !staleEntries.includes(x))) {
    console.log(`· allowed skip: ${a.file} — ${a.reason}`);
  }

  console.log(`check-e2e-skips: ${skipped.length} skipped, ${unexplained.length} unexplained, ${staleEntries.length} stale.`);
  if (unexplained.length || staleEntries.length) process.exit(1);
  console.log('check-e2e-skips: OK — every skip is explained and every entry is live.');
}
