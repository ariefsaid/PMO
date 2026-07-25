#!/usr/bin/env node
// Blocking supply-chain gate for the PRODUCTION dependency tree.
//
// Replaces a bare `npm audit --omit=dev --audit-level=high`. Same severity bar, but an
// advisory may be waived ONLY by an explicit entry below carrying a reason and an expiry.
// An expired waiver fails the build, so a waiver cannot quietly become permanent — the
// failure mode is "someone must look again", not "nobody ever noticed".
//
// A NEW advisory is never waived by default: anything high+ that is not listed fails.
//
// Run: node scripts/audit-prod.mjs   (cwd-independent; audits pmo-portal/)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pmo-portal');

/**
 * @type {Array<{ghsa: string, package: string, reason: string, expires: string}>}
 * `expires` is the date this waiver stops working (UTC, YYYY-MM-DD). Keep them short.
 */
const WAIVERS = [
  {
    ghsa: 'GHSA-qwww-vcr4-c8h2',
    package: 'react-router',
    reason:
      'RSC-mode CSRF: an action can execute before the 400 response. NOT APPLICABLE — this app is a ' +
      'Vite SPA on BrowserRouter with no RSC mode, no framework mode, and no router actions (grep: no ' +
      '"createBrowserRouter" action/loader server entry, no @react-router/dev). The advisory covers ALL ' +
      'of react-router 7.x (fixed only in 8.3.0), so the fix is a v7 -> v8 MAJOR upgrade — scheduled ' +
      'debt, not a drive-by change inside a CI fix. Tracked in docs/backlog.md.',
    expires: '2026-09-01',
  },
];

// npm audit exits non-zero whenever it finds anything, so a throw here is the NORMAL path —
// the report we want is on the error's stdout. Only a missing/garbled report is a real error.
let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: APP_DIR,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (err) {
  raw = err.stdout;
  if (!raw) throw err;
}

const report = JSON.parse(raw);
const BLOCKING = new Set(['high', 'critical']);
const today = new Date().toISOString().slice(0, 10);

// Collect the ROOT advisories (via[] entries that are objects carry the real GHSA); packages
// flagged only because a dependency is vulnerable resolve once the root one does.
const found = new Map(); // ghsa -> {title, url, packages:Set}
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  if (!BLOCKING.has(v.severity)) continue;
  for (const via of v.via) {
    if (typeof via !== 'object') continue;
    const ghsa = (via.url ?? '').split('/').pop();
    if (!ghsa) continue;
    if (!found.has(ghsa)) found.set(ghsa, { title: via.title, url: via.url, packages: new Set() });
    found.get(ghsa).packages.add(name);
  }
}

const expired = WAIVERS.filter((w) => w.expires < today);
const unwaived = [...found].filter(([ghsa]) => !WAIVERS.some((w) => w.ghsa === ghsa && w.expires >= today));
const unused = WAIVERS.filter((w) => w.expires >= today && !found.has(w.ghsa));

for (const w of expired) {
  console.error(`✗ WAIVER EXPIRED ${w.ghsa} (${w.package}) expired ${w.expires} — re-triage or fix it.`);
}
for (const [ghsa, v] of unwaived) {
  console.error(`✗ ${ghsa} ${v.title}\n    packages: ${[...v.packages].join(', ')}\n    ${v.url}`);
}
for (const w of unused) {
  console.log(`· waiver ${w.ghsa} (${w.package}) no longer matches an advisory — delete it.`);
}
for (const w of WAIVERS.filter((x) => x.expires >= today && found.has(x.ghsa))) {
  console.log(`· WAIVED until ${w.expires}: ${w.ghsa} (${w.package})`);
}

if (expired.length || unwaived.length) {
  console.error(`\naudit-prod: FAILED — ${unwaived.length} unwaived, ${expired.length} expired.`);
  process.exit(1);
}
console.log(`audit-prod: OK — no unwaived high/critical advisories in the production tree.`);
