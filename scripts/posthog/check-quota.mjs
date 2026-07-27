#!/usr/bin/env node
/**
 * check-quota — alerts when any PostHog free allowance passes 80% (FR-PHG-030/031).
 * Env: POSTHOG_API_KEY (personal, project:read), POSTHOG_PROJECT_ID, optional POSTHOG_HOST,
 * optional QUOTA_THRESHOLD (default 0.8). Feed the key via op-get.sh; never write it to disk.
 */
import { evaluateQuota, validateQuotaEnv } from './quota.mjs';

const HOST = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
const KEY = process.env.POSTHOG_API_KEY;
const PID = process.env.POSTHOG_PROJECT_ID;
if (!KEY || !PID) {
  console.error('Missing POSTHOG_API_KEY and/or POSTHOG_PROJECT_ID env.');
  process.exit(2);
}

// SECURITY (review round 2 #5): validate BEFORE building the URL the API key travels to — a
// mis-set HOST/PID must never reach `fetch`.
const envErrors = validateQuotaEnv(HOST, PID);
if (envErrors.length > 0) {
  for (const e of envErrors) console.error(e);
  process.exit(2);
}

const res = await fetch(`${HOST}/api/projects/${PID}/quota_limits/`, {
  headers: { Authorization: `Bearer ${KEY}` },
});
if (!res.ok) {
  console.error(`quota_limits -> ${res.status}`);
  process.exit(2);
}

const { exitCode, lines } = evaluateQuota(await res.json(), Number(process.env.QUOTA_THRESHOLD ?? '0.8'));
for (const line of lines) console.error(line);
if (exitCode === 0) console.log('✓ all PostHog quotas below threshold');
process.exit(exitCode);
