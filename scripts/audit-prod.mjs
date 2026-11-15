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
// Audits every shipped/operator tree: pmo-portal/ (the app) AND scripts/ (the CLI tools' own
// package.json + lock). Same bar and same waiver rules for both.
// Run: node scripts/audit-prod.mjs   (cwd-independent)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const AUDIT_DIRS = [path.join(HERE, '..', 'pmo-portal'), HERE];

/**
 * @type {Array<{ghsa: string, package: string, reason: string, expires: string}>}
 * `expires` is the date this waiver stops working (UTC, YYYY-MM-DD). Keep them short.
 */
// Empty by design. The bar is: FIX the advisory. A waiver is a last resort for something both
// unfixable and provably unreachable — and it still expires. GHSA-qwww-vcr4-c8h2 (react-router)
// was waived here on 2026-07-24 and is now GONE because the v7 -> v8.3.0 upgrade actually shipped.
export const WAIVERS = [];

const BLOCKING = new Set(['high', 'critical']);

// npm audit exits non-zero whenever it finds anything, so a throw here is the NORMAL path —
// the report we want is on the error's stdout. Only a missing/garbled report is a real error.
function runAudit(cwd) {
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    raw = err.stdout;
    if (!raw) throw err;
  }
  return JSON.parse(raw);
}

// Collect the ROOT advisories (via[] entries that are objects carry the real GHSA); packages
// flagged only because a dependency is vulnerable resolve once the root one does.
export function collectFound(report) {
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
  return found;
}

export function evaluate(found, waivers, today) {
  return {
    expired: waivers.filter((w) => w.expires < today),
    unwaived: [...found].filter(([ghsa]) => !waivers.some((w) => w.ghsa === ghsa && w.expires >= today)),
    unused: waivers.filter((w) => w.expires >= today && !found.has(w.ghsa)),
    active: waivers.filter((w) => w.expires >= today && found.has(w.ghsa)),
  };
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  let failed = 0;
  for (const dir of AUDIT_DIRS) {
    const label = path.basename(path.resolve(dir));
    const { expired, unwaived, unused, active } = evaluate(collectFound(runAudit(dir)), WAIVERS, today);
    for (const w of expired) {
      console.error(`✗ [${label}] WAIVER EXPIRED ${w.ghsa} (${w.package}) expired ${w.expires} — re-triage or fix it.`);
    }
    for (const [ghsa, v] of unwaived) {
      console.error(`✗ [${label}] ${ghsa} ${v.title}\n    packages: ${[...v.packages].join(', ')}\n    ${v.url}`);
    }
    for (const w of unused) console.log(`· [${label}] waiver ${w.ghsa} (${w.package}) no longer matches an advisory.`);
    for (const w of active) console.log(`· [${label}] WAIVED until ${w.expires}: ${w.ghsa} (${w.package})`);
    failed += unwaived.length + expired.length;
  }
  if (failed) {
    console.error(`\naudit-prod: FAILED — ${failed} unwaived/expired finding(s).`);
    process.exit(1);
  }
  console.log('audit-prod: OK — no unwaived high/critical advisories in the production trees.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
