#!/usr/bin/env node
// ci-failed-journeys.mjs — print the failed journeys of a CI run, grouped by lane.
// usage: node scripts/ci-failed-journeys.mjs <run-id>      (downloads the run's report artifacts via gh)
//        node scripts/ci-failed-journeys.mjs --dir <dir>   (reads pw-*.json under <dir>, any depth)
import { readdirSync, readFileSync, statSync, mkdtempSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Playwright JSON report → "file › title" of every spec whose tests did not pass or skip.
export function failedJourneys(report) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const bad = (spec.tests ?? []).some((t) => !['expected', 'skipped'].includes(t.status));
      if (bad) out.push(`${spec.file ?? suite.file ?? '?'} › ${spec.title}`);
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  return out;
}

const laneOf = (file) => basename(file).replace(/^pw-/, '').replace(/\.json$/, '');
const isReport = (f) => /^pw-(serial|consent|chromium-\d)\.json$/.test(basename(f));
const find = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? find(p) : isReport(p) ? [p] : [];
});

export function summarise(dir) {
  const lines = [];
  for (const f of find(dir).sort()) {
    let failed;
    try { failed = failedJourneys(JSON.parse(readFileSync(f, 'utf8'))); }
    catch { lines.push(`${laneOf(f)}: report unreadable`); continue; }
    lines.push(`${laneOf(f)}: ${failed.length ? `${failed.length} failed` : 'ok'}`, ...failed.map((j) => `  ✗ ${j}`));
  }
  return lines.join('\n') || 'no lane reports found';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, b] = process.argv.slice(2);
  let dir = b;
  if (a !== '--dir') {
    if (!/^\d+$/.test(a ?? '')) { console.error('usage: ci-failed-journeys.mjs <run-id> | --dir <dir>'); process.exit(2); }
    dir = mkdtempSync(join(tmpdir(), 'ci-journeys-'));
    for (const name of ['integration-e2e-reports', 'browser-chromium-1', 'browser-chromium-2', 'browser-chromium-3']) {
      try { execFileSync('gh', ['run', 'download', a, '-R', 'ariefsaid/PMO', '-n', name, '-D', join(dir, name)], { stdio: 'ignore' }); } catch { /* artifact absent */ }
    }
  }
  console.log(summarise(dir));
}
