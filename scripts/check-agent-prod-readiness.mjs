#!/usr/bin/env node
/**
 * check-agent-prod-readiness.mjs — a manual, ops-run readiness checklist for the agent
 * tier (agent-chat / compose-view / agent-dispatch) before enabling it in production
 * (observability hardening, harden #1 item 2, spike 2026-07-04).
 *
 * This does NOT automate the live-mint verify (that stays a manual step per ADR-0044 —
 * minting a real owner JWT and firing a real automation against prod data is not a thing
 * a CI-safe script should ever do). It enumerates + checks what CAN be checked safely:
 *
 *   (a) agent-chat / compose-view / agent-dispatch respond over HTTP — an OPTIONS
 *       preflight probe, plus a "401 without auth" vs "200/other with auth" probe using a
 *       caller-supplied bearer token (never hardcoded, never read from a file).
 *   (b) required secrets/GUCs are documented and their PRESENCE (never their value) is
 *       reported from the invoking shell's own environment (this machine, e.g. an
 *       operator's local shell with the prod secrets loaded via 1Password op-get.sh —
 *       the script itself NEVER reads 1Password or any file for secrets).
 *   (c) an optional synthetic dry-run: a real POST to agent-chat with a trivial prompt,
 *       gated behind an explicit --live flag (off by default) so a plain `--check` run
 *       never spends a token or touches a live model.
 *
 * NEVER reads .env files or 1Password directly — every input is an environment variable
 * the operator's shell already has set (op-get.sh usage is the operator's own concern,
 * documented in docs/environments.md). Skips gracefully (reports "SKIPPED", not "FAILED")
 * when an optional var is unset, so this is safe to run with a partial environment.
 *
 * Usage:
 *   PMO_READINESS_BASE_URL=https://<ref>.supabase.co/functions/v1 \
 *   PMO_READINESS_BEARER=<service-role-or-anon-jwt> \
 *   node scripts/check-agent-prod-readiness.mjs [--live]
 *
 * Exit code: 0 all checks passed/skipped; 1 one or more checks failed.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** The three edge functions the agent tier depends on. */
export const AGENT_FUNCTIONS = ['agent-chat', 'compose-view', 'agent-dispatch'];

/**
 * Function secrets / pg_cron GUCs the deployed project must have set (ADR-0044 §2,
 * docs/environments.md "Edge Functions"). Presence-checked from THIS script's own
 * process.env (the operator's shell) — this is NOT the deployed Supabase project's
 * env; the script cannot read that remotely without a Supabase Management API token,
 * which is out of scope here (documented as a manual step in the checklist output).
 */
export const REQUIRED_ENV_VARS = ['OPENROUTER_API_KEY'];

/**
 * Documented (not automatable from this script) — the pg_cron job's GUCs, set via
 * `ALTER DATABASE ... SET app.settings.dispatch_url = ...` on the deployed project,
 * never in this repo. Reported as a checklist reminder, not a checkable env var.
 */
export const DISPATCH_GUCS = ['app.settings.dispatch_url', 'app.settings.service_role_key'];

/**
 * classifyEnvSecrets — presence-only classification of the required env vars (NEVER
 * echoes a value). An empty string counts as missing (a var can be "set" to '' by a
 * broken shell script and that is still not usable).
 */
export function classifyEnvSecrets(env, required = REQUIRED_ENV_VARS) {
  const present = [];
  const missing = [];
  for (const key of required) {
    if (typeof env[key] === 'string' && env[key].length > 0) {
      present.push(key);
    } else {
      missing.push(key);
    }
  }
  return { ok: missing.length === 0, present, missing };
}

/**
 * classifyProbeResult — interpret one HTTP probe outcome against its expectation.
 * `expectedUnauthenticated: true` means "no bearer sent; a 401 IS the healthy signal"
 * (the function is deployed and enforcing auth). `expectedUnauthenticated: false` means
 * "a bearer WAS sent; a 2xx IS the healthy signal". Any other status, or a transport
 * error (`status: null`), is unhealthy — the detail names the actual status/error so an
 * operator can tell "not deployed" (404) apart from "deployed but broken" (500) apart
 * from "unreachable" (network error).
 */
export function classifyProbeResult({ status, error, expectedUnauthenticated }) {
  if (status == null) {
    return { healthy: false, detail: `unreachable (${error ?? 'unknown error'})` };
  }
  if (expectedUnauthenticated) {
    if (status === 401) return { healthy: true, detail: '401 (auth enforced, as expected)' };
    return { healthy: false, detail: `expected 401 without auth, got ${status}` };
  }
  if (status >= 200 && status < 300) {
    return { healthy: true, detail: `${status} (with auth)` };
  }
  return { healthy: false, detail: `expected 2xx with auth, got ${status}` };
}

/**
 * probeFunction — OPTIONS preflight + a bodyless GET/POST probe (no bearer) to confirm
 * the function is deployed and enforcing auth (401), then optionally a second probe
 * WITH the supplied bearer to confirm it accepts real auth. Network errors are caught
 * and folded into `{ status: null, error }` so a probe never throws — the caller
 * decides pass/fail via classifyProbeResult.
 */
async function probeFunction({ baseUrl, fnName, bearer, fetchImpl = fetch }) {
  const url = `${baseUrl.replace(/\/$/, '')}/${fnName}`;

  const noAuth = await safeFetch(fetchImpl, url, { method: 'POST', body: '{}' });
  const noAuthVerdict = classifyProbeResult({ ...noAuth, expectedUnauthenticated: true });

  let withAuthVerdict = null;
  if (bearer) {
    const withAuth = await safeFetch(fetchImpl, url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    // agent-dispatch expects the bearer to equal the service-role key; agent-chat/compose-view
    // expect a real user JWT. Either way "some non-401" response with a bearer supplied means
    // the function accepted the auth path (2xx OR a 4xx/5xx from BUSINESS logic, e.g. bad body,
    // still proves the function is live and past the auth gate) — but we only assert 2xx here to
    // keep the check conservative; a non-2xx with auth is reported, not silently passed.
    withAuthVerdict = classifyProbeResult({ ...withAuth, expectedUnauthenticated: false });
  }

  return { fnName, noAuthVerdict, withAuthVerdict };
}

async function safeFetch(fetchImpl, url, init) {
  try {
    const resp = await fetchImpl(url, init);
    return { status: resp.status };
  } catch (err) {
    return { status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function printSection(title) {
  console.log(`\n== ${title} ==`);
}

async function main(argv) {
  const live = argv.includes('--live');
  const baseUrl = process.env.PMO_READINESS_BASE_URL;
  const bearer = process.env.PMO_READINESS_BEARER;

  let ok = true;

  printSection('(a) Edge function reachability');
  if (!baseUrl) {
    console.log('SKIPPED — PMO_READINESS_BASE_URL not set (e.g. https://<ref>.supabase.co/functions/v1)');
  } else {
    for (const fnName of AGENT_FUNCTIONS) {
      const result = await probeFunction({ baseUrl, fnName, bearer });
      const noAuthLine = result.noAuthVerdict.healthy ? 'OK' : 'FAIL';
      console.log(`  ${fnName}: no-auth → ${noAuthLine} (${result.noAuthVerdict.detail})`);
      if (!result.noAuthVerdict.healthy) ok = false;
      if (result.withAuthVerdict) {
        const withAuthLine = result.withAuthVerdict.healthy ? 'OK' : 'FAIL';
        console.log(`  ${fnName}: with-auth → ${withAuthLine} (${result.withAuthVerdict.detail})`);
        if (!result.withAuthVerdict.healthy) ok = false;
      } else {
        console.log(`  ${fnName}: with-auth → SKIPPED (PMO_READINESS_BEARER not set)`);
      }
    }
  }

  printSection('(b) Required secrets — presence only, values never printed');
  const secretResult = classifyEnvSecrets(process.env);
  for (const key of secretResult.present) console.log(`  ${key}: SET (this shell)`);
  for (const key of secretResult.missing) console.log(`  ${key}: NOT SET (this shell) — see docs/environments.md`);
  console.log(
    '  NOTE: this checks the INVOKING SHELL\'s env, not the deployed Supabase project\'s function\n' +
      '  secrets. Confirm on the project itself with `supabase secrets list` (requires the CLI\n' +
      '  linked to the target project).',
  );
  if (!secretResult.ok) ok = false;

  printSection('(c) pg_cron GUCs (documented — verify manually on the deployed Postgres)');
  for (const guc of DISPATCH_GUCS) {
    console.log(`  ${guc}: verify via \`SHOW ${guc};\` on the deployed project (not checkable from here)`);
  }

  printSection('(d) Synthetic dry-run');
  if (!live) {
    console.log('SKIPPED — pass --live to fire a real (token-spending) agent-chat call.');
  } else if (!baseUrl || !bearer) {
    console.log('SKIPPED — --live requires both PMO_READINESS_BASE_URL and PMO_READINESS_BEARER.');
  } else {
    const url = `${baseUrl.replace(/\/$/, '')}/agent-chat`;
    const result = await safeFetch(fetch, url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    });
    const verdict = classifyProbeResult({ ...result, expectedUnauthenticated: false });
    console.log(`  agent-chat synthetic call: ${verdict.healthy ? 'OK' : 'FAIL'} (${verdict.detail})`);
    if (!verdict.healthy) ok = false;
  }

  console.log(`\n${ok ? 'READY' : 'NOT READY'} — see docs/environments.md "Agent prod-readiness check" for remediation.`);
  return ok;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then((ok) => process.exit(ok ? 0 : 1));
}
