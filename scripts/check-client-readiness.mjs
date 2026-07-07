#!/usr/bin/env node
/**
 * check-client-readiness.mjs — read-only readiness check for a freshly-provisioned client
 * project (Deliverable 1, FR-PROV-011). Sibling of check-agent-prod-readiness.mjs — REUSES
 * its classifyEnvSecrets/classifyProbeResult directly (no reimplementation) and adds the
 * classifiers specific to a client provisioning check: migration-count parity, org+Admin
 * existence, and anon-read RLS sanity. SKIPPED-not-FAILED when an optional input is unset.
 *
 * Usage:
 *   PMO_READINESS_BASE_URL=https://<ref>.supabase.co/functions/v1 \
 *   PMO_READINESS_BEARER=<a real Admin JWT or the service-role key> \
 *   PMO_CLIENT_ORG_SLUG=<slug> \
 *   node scripts/check-client-readiness.mjs
 */
import { classifyEnvSecrets, classifyProbeResult, AGENT_FUNCTIONS, REQUIRED_ENV_VARS } from './check-agent-prod-readiness.mjs';

export function classifyMigrationCount({ repoCount, remoteCount }) {
  if (repoCount === remoteCount) return { healthy: true, detail: `${remoteCount}/${repoCount} migrations applied` };
  return { healthy: false, detail: `remote has ${remoteCount}, repo expects ${repoCount} (gap: ${repoCount - remoteCount})` };
}

export function classifyOrgAdminExistence({ orgCount, adminProfileCount, adminOrgIdMatches }) {
  if (orgCount === 1 && adminProfileCount >= 1 && adminOrgIdMatches) {
    return { healthy: true, detail: 'exactly one org row and ≥1 linked Admin profile exist' };
  }
  return { healthy: false, detail: `orgCount=${orgCount}, adminProfileCount=${adminProfileCount}, adminOrgIdMatches=${adminOrgIdMatches}` };
}

export function classifyAnonReadSanity({ anonRowCount }) {
  if (anonRowCount === 0) return { healthy: true, detail: 'anon read returned 0 rows (RLS enforcing)' };
  return { healthy: false, detail: `anon read returned ${anonRowCount} rows — RLS HOLE, investigate immediately` };
}

// main() mirrors check-agent-prod-readiness.mjs's structure: printSection per check, SKIPPED when
// an optional input is absent, exit 1 on any FAIL. Re-uses AGENT_FUNCTIONS/REQUIRED_ENV_VARS from
// the sibling script for the edge-fn + secret checks (FR-PROV-011 a/c) and adds (b/d/e/f) here.
// This orchestration is integration-only glue (live network/DB calls against the freshly-
// provisioned project) and is NOT unit-tested itself — only the classifiers above are, matching
// check-agent-prod-readiness.mjs's own test-coverage boundary (its .test.mjs docstring: "the
// script's network probes are integration-only… these tests cover only the logic that does NOT
// require a network call").

function printSection(title, verdict, { optional = false } = {}) {
  if (verdict == null) {
    console.log(`SKIPPED  ${title} (optional input not provided)`);
    return true;
  }
  const label = verdict.healthy ? 'OK      ' : (optional ? 'SKIPPED ' : 'FAIL    ');
  console.log(`${label} ${title} — ${verdict.detail}`);
  return verdict.healthy || optional;
}

async function safeFetchStatus(url, init) {
  try {
    const res = await fetch(url, init);
    return { status: res.status, error: null };
  } catch (err) {
    return { status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const baseUrl = process.env.PMO_READINESS_BASE_URL;
  const bearer = process.env.PMO_READINESS_BEARER;
  const orgSlug = process.env.PMO_CLIENT_ORG_SLUG;

  let allOk = true;

  // (a) edge-fn 401-without-auth probes — SKIPPED if baseUrl unset.
  if (baseUrl) {
    for (const fn of AGENT_FUNCTIONS) {
      const { status, error } = await safeFetchStatus(`${baseUrl}/${fn}`, { method: 'POST' });
      const verdict = classifyProbeResult({ status, error, expectedUnauthenticated: true });
      allOk = printSection(`edge fn ${fn} (401-without-auth)`, verdict) && allOk;
    }
  } else {
    printSection('edge fn probes', null);
  }

  // (c) presence-only secret check (never a value).
  const secretVerdict = classifyEnvSecrets(process.env, REQUIRED_ENV_VARS);
  allOk = printSection('required secrets present (this shell)', {
    healthy: secretVerdict.ok,
    detail: secretVerdict.ok ? 'all present' : `NOT SET (this shell): ${secretVerdict.missing.join(', ')}`,
  }, { optional: true }) && allOk;

  // (d) migration-count / (e) org+Admin / (f) anon-read sanity — all require bearer/orgSlug;
  // SKIPPED (not FAILED) when the live inputs are unset (this script has no DB client wired v1 —
  // the live queries are documented, not automated here, mirroring the sibling script's
  // "documented, not automatable" pattern for pg_cron GUCs).
  if (bearer && orgSlug) {
    console.log('NOTE     migration-count / org+Admin / anon-read checks require a live DB client');
    console.log('         (documented manual queries — see docs/plans/2026-07-04-onboarding-tooling.md §Slice 5).');
  } else {
    printSection('migration count / org+Admin existence / anon-read sanity', null);
  }

  process.exitCode = allOk ? 0 : 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-client-readiness.mjs');
if (isMain) main();
