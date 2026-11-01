#!/usr/bin/env node
/**
 * provision-dashboards.mjs — dashboards-as-code for PostHog (PMO product analytics).
 *
 * Idempotent: dashboards + insights are upserted BY NAME (re-running never duplicates).
 * Grounded in the app's typed event catalog (pmo-portal/src/lib/analytics/events.ts) — every
 * event/property referenced below is one the app actually fires. IG-audit P2 (2026-07-10):
 * the "PostHog dashboards deferred" gap.
 *
 * Auth (never hard-code secrets): reads from env —
 *   POSTHOG_API_KEY     personal API key with dashboard:write + insight:write (phx_…)
 *   POSTHOG_PROJECT_ID  numeric project/team id (e.g. 465502)
 *   POSTHOG_HOST        default https://us.i.posthog.com
 * Run it via op-get.sh (see the run block in the PR / backlog) so the key never touches disk.
 *
 * ponytail: upsert-by-name (skip if the insight name already exists) — the laziest idempotency
 * that doesn't duplicate on re-run. Ceiling: it won't RE-PUSH an edited query onto an insight that
 * already exists (delete the insight in the UI to force a rebuild). Fine for provisioning.
 */

import { SPEC } from './dashboardSpec.mjs';
import { provision } from './provision.mjs';

const HOST = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
const KEY = process.env.POSTHOG_API_KEY;
const PID = process.env.POSTHOG_PROJECT_ID;
if (!KEY || !PID) {
  console.error('Missing POSTHOG_API_KEY and/or POSTHOG_PROJECT_ID env.');
  process.exit(2);
}

const base = `${HOST}/api/projects/${PID}`;
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

// Fetch all results across pagination for a listing endpoint.
async function listAll(path) {
  const out = [];
  let url = `${base}${path}`;
  while (url) {
    const res = await fetch(url, { headers: H });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const j = await res.json();
    out.push(...(j.results || []));
    url = j.next;
  }
  return out;
}


async function main() {
  const io = {
    listDashboards: () => listAll('/dashboards/?limit=100'),
    listInsights: () => listAll('/insights/?limit=500'),
    createDashboard: (b) => api('POST', '/dashboards/', b),
    createInsight: (b) => api('POST', '/insights/', b),
    refreshInsight: (id) => api('GET', `/insights/${id}/?refresh=blocking`),
    log: (m) => console.log(m),
  };
  const { created, skipped, provisionedIds } = await provision(SPEC, io);

  console.log(
    `\nDone. dashboards: +${created.dashboards}/=${skipped.dashboards}  ` +
      `insights: +${created.insights}/=${skipped.insights}`,
  );

  // Force each provisioned insight to compute its `result` NOW (blocking refresh) —
  // otherwise a brand-new insight/dashboard renders BLANK until a human happens to
  // open it (PostHog only computes on-demand by default).
  let refreshed = 0;
  for (const id of provisionedIds) {
    await io.refreshInsight(id);
    refreshed++;
  }
  console.log(`refreshed ${refreshed} insights`);
  console.log(`View: ${HOST}/project/${PID}/dashboard`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
