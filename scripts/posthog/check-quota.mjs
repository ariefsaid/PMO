#!/usr/bin/env node
/**
 * check-quota — alerts when any PostHog free allowance passes 80% (FR-PHG-030/031).
 * Env: POSTHOG_API_KEY (personal, project:read), POSTHOG_PROJECT_ID, optional POSTHOG_HOST,
 * optional QUOTA_THRESHOLD (default 0.8). Feed the key via op-get.sh; never write it to disk.
 */
import { evaluateQuota, validateQuotaEnv, validateThreshold } from './quota.mjs';

const HOST = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
const KEY = process.env.POSTHOG_API_KEY;
const PID = process.env.POSTHOG_PROJECT_ID;
if (!KEY || !PID) {
  console.error('Missing POSTHOG_API_KEY and/or POSTHOG_PROJECT_ID env.');
  process.exit(2);
}

// SECURITY: validate BEFORE building the URL the API key travels to — a mis-set HOST/PID must never
// reach `fetch`. The threshold is validated here too: an unvalidated one silently DISABLES the alarm
// (`QUOTA_THRESHOLD=abc` → NaN → `ratio >= NaN` always false → exit 0 forever).
const RAW_THRESHOLD = process.env.QUOTA_THRESHOLD ?? '0.8';
const envErrors = [...validateQuotaEnv(HOST, PID), ...validateThreshold(RAW_THRESHOLD)];
if (envErrors.length > 0) {
  for (const e of envErrors) console.error(e);
  process.exit(2);
}

// exit 2 = "this check could not run" (setup/transport/shape). exit 1 = "a real quota breach".
// Keeping them distinct matters: posthog-quota.yml prints a PERMANENT-DATA-LOSS banner on 1, and a
// DNS blip rendering as that emergency is how an operator learns to ignore the banner.
let payload;
try {
  const res = await fetch(new URL(`/api/projects/${PID}/quota_limits/`, HOST), {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) {
    console.error(`quota_limits -> ${res.status}`);
    process.exit(2);
  }
  payload = await res.json();
} catch (err) {
  // Never interpolate the error itself — a fetch error can carry the request URL, and the key is in
  // this process's env. Name the class only.
  console.error(`quota_limits request failed (${err?.name ?? 'Error'}) — the check did not run.`);
  process.exit(2);
}

const { exitCode, lines, evaluated } = evaluateQuota(payload, Number(RAW_THRESHOLD));
for (const line of lines) console.error(line);
if (exitCode === 0) console.log(`✓ ${evaluated} PostHog allowance(s) checked, all below threshold`);
process.exit(exitCode);
