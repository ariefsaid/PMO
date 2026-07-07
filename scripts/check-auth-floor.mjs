#!/usr/bin/env node
/**
 * check-auth-floor.mjs — a read-only pre-flight that VERIFIES a per-client Supabase Cloud
 * project's Auth settings are production-safe BEFORE go-live (audit follow-up, #1
 * MVP-blocker). Turns the previously-printed-only checklist in docs/environments.md
 * ("Production auth floor") into an enforced gate: exit 1 on any FAIL so a caller
 * (scripts/provision-client.sh) can refuse to proceed.
 *
 * Repo is PUBLIC → a real client's project ref is discoverable, so a manually-executed
 * checklist is not a strong enough floor — if one step is skipped, a real tenant could go
 * live with open self-signup. This script calls the Supabase Management API directly
 * (read-only GET) and asserts the actual deployed config, not a human's memory of it.
 *
 * Management API endpoint: GET https://api.supabase.com/v1/projects/{ref}/config/auth
 * Fields asserted (Management API's GetAuthConfigResponse — NOT the same names as the
 * repo's local supabase/config.toml, which uses the CLI's own `enable_signup` /
 * `enable_confirmations` / `site_url` keys):
 *   - disable_signup (boolean)      — true means self-serve signup is OFF (the floor we want).
 *   - mailer_autoconfirm (boolean)  — true means new emails are auto-confirmed (NO confirmation
 *                                     email required); we want this FALSE so confirmations are
 *                                     enforced (external email confirmations ON).
 *   - uri_allow_list (string, comma-separated per the Management API — NOT an array; this script
 *     also tolerates an array defensively in case the API returns one) — the redirect allowlist;
 *     must contain NO localhost/127.0.0.1 entries.
 *   - site_url (string) — must itself not be a localhost/127.0.0.1 origin.
 * ASSUMPTION (flagged per the task): `disable_signup`/`mailer_autoconfirm`/`uri_allow_list` are
 * the field names documented in Supabase's Management API OpenAPI schema at the time of writing;
 * if the live API ever renames these, this script's classifiers take a plain config object so
 * only fetchAuthConfig's mapping (none needed today — the API returns w/ these names already)
 * would need updating.
 *
 * Never reads a secret file — the token is supplied by the CALLER's shell (op-get.sh
 * convention, per docs/environments.md), same as db-push-prod.sh. Never prints the token.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<Management API PAT, e.g. via op-get.sh> \
 *   SUPABASE_PROJECT_REF=<the target client's project ref> \
 *   node scripts/check-auth-floor.mjs
 *
 * Exit code: 0 = all three settings verified production-safe; 1 = any FAIL, or missing inputs
 * (can't verify → don't pass).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';

const LOCAL_HOST_PATTERN = /(localhost|127\.0\.0\.1)/i;

/** Normalize uri_allow_list to an array regardless of whether the API returns a CSV string or an array. */
function toAllowListArray(uriAllowList) {
  if (Array.isArray(uriAllowList)) return uriAllowList;
  if (typeof uriAllowList === 'string' && uriAllowList.length > 0) {
    return uriAllowList.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** AC-AUTHFLOOR-001: signup must be disabled (invite-only) on a real client project. */
export function classifySignupDisabled(config) {
  if (config.disable_signup === true) {
    return { healthy: true, detail: 'disable_signup=true (self-serve signup is OFF)' };
  }
  return {
    healthy: false,
    detail: `disable_signup=${JSON.stringify(config.disable_signup)} — self-signup is OPEN on a real tenant; set disable_signup=true`,
  };
}

/** AC-AUTHFLOOR-002: external email confirmations must be required (no auto-confirm / unconfirmed logins). */
export function classifyConfirmationsEnabled(config) {
  if (config.mailer_autoconfirm === false) {
    return { healthy: true, detail: 'mailer_autoconfirm=false (email confirmations are required)' };
  }
  return {
    healthy: false,
    detail: `mailer_autoconfirm=${JSON.stringify(config.mailer_autoconfirm)} — unconfirmed logins allowed; set mailer_autoconfirm=false`,
  };
}

/** AC-AUTHFLOOR-003: the redirect allowlist (and site_url) must contain NO localhost/127.0.0.1 entries. */
export function classifyRedirectAllowlist(config) {
  if (typeof config.site_url === 'string' && LOCAL_HOST_PATTERN.test(config.site_url)) {
    return { healthy: false, detail: `site_url is a local origin (${config.site_url}) — must be the deployed HTTPS origin` };
  }
  const entries = toAllowListArray(config.uri_allow_list);
  const badEntries = entries.filter((entry) => LOCAL_HOST_PATTERN.test(entry));
  if (badEntries.length > 0) {
    return {
      healthy: false,
      detail: `uri_allow_list contains local/insecure entries: ${badEntries.join(', ')} — remove every localhost/127.0.0.1 entry`,
    };
  }
  return { healthy: true, detail: 'site_url and uri_allow_list contain no localhost/127.0.0.1 entries' };
}

/**
 * evaluateAuthFloor — runs all three classifiers against one fetched config object and
 * returns an overall PASS/FAIL plus the individual per-setting verdicts (each named so a
 * caller/test can pinpoint exactly which setting failed).
 */
export function evaluateAuthFloor(config) {
  const checks = [
    { name: 'signup-disabled', ...classifySignupDisabled(config) },
    { name: 'confirmations-enabled', ...classifyConfirmationsEnabled(config) },
    { name: 'redirect-allowlist', ...classifyRedirectAllowlist(config) },
  ];
  return { ok: checks.every((c) => c.healthy), checks };
}

/**
 * fetchAuthConfig — read-only GET against the Management API auth-config endpoint. Never
 * throws (network/HTTP errors are folded into `{ ok: false, error }` so main() can print a
 * clean FAIL instead of an unhandled rejection); never logs the token.
 */
export async function fetchAuthConfig({ ref, token, fetchImpl = fetch }) {
  const url = `${MANAGEMENT_API_BASE}/projects/${ref}/config/auth`;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      return { ok: false, error: `Management API returned HTTP ${res.status} — check the token/ref are valid and the token has access to this project` };
    }
    const config = await res.json();
    return { ok: true, config };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function printUsageAndExit() {
  console.error('✗ Cannot verify the auth floor — missing required input(s).');
  console.error('  Supply BOTH of:');
  console.error('    SUPABASE_ACCESS_TOKEN  — a Supabase Management API personal access token');
  console.error('                             (e.g. via op-get.sh, per docs/environments.md — never a file)');
  console.error('    SUPABASE_PROJECT_REF   — the target client project\'s ref');
  console.error('  Example:');
  console.error('    SUPABASE_ACCESS_TOKEN=$(op-get.sh <item> <vault> <field>) \\');
  console.error('    SUPABASE_PROJECT_REF=<ref> node scripts/check-auth-floor.mjs');
  console.error('  Can\'t verify → refusing to report a pass.');
  process.exitCode = 1;
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;

  if (!token || !ref) {
    printUsageAndExit();
    return;
  }

  console.log(`→ Checking production auth floor for project ${ref}…`);
  const fetched = await fetchAuthConfig({ ref, token });
  if (!fetched.ok) {
    console.error(`✗ Could not fetch auth config: ${fetched.error}`);
    process.exitCode = 1;
    return;
  }

  const { ok, checks } = evaluateAuthFloor(fetched.config);
  for (const check of checks) {
    console.log(`${check.healthy ? 'PASS' : 'FAIL'}    ${check.name} — ${check.detail}`);
  }

  console.log(`\n${ok ? 'PASS' : 'FAIL'} — production auth floor ${ok ? 'is enforced' : 'is NOT enforced'} on ${ref}.`);
  if (!ok) {
    console.log('  See docs/environments.md "Production auth floor" to remediate, then re-run.');
  }
  process.exitCode = ok ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
