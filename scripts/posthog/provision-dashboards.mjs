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

// ── Query builders (HogQL InsightVizNode — verified shapes) ────────────────────
const DATE_FROM = '-30d';

function trend(series, { breakdown, interval = 'day', display } = {}) {
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'TrendsQuery',
      dateRange: { date_from: DATE_FROM },
      interval,
      series: series.map((s) => ({
        kind: 'EventsNode',
        event: s.event,
        name: s.label || s.event,
        math: s.math || 'total',
        ...(s.mathProperty ? { math_property: s.mathProperty } : {}),
      })),
      ...(breakdown
        ? { breakdownFilter: { breakdown_type: 'event', breakdown } }
        : {}),
      trendsFilter: display ? { display } : {},
    },
  };
}

function funnel(events, { interval = 'day' } = {}) {
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'FunnelsQuery',
      dateRange: { date_from: DATE_FROM },
      interval,
      series: events.map((e) => ({ kind: 'EventsNode', event: e, name: e })),
      funnelsFilter: {},
    },
  };
}

// ── The dashboard spec (name → tiles) ──────────────────────────────────────────
const NS = '[PMO]'; // name prefix so provisioned objects are greppable + upsert-keyed
const SPEC = [
  {
    dashboard: `${NS} Agent · Adoption & Reliability`,
    description: 'Agent panel usage, run outcomes, approval funnel, latency. Source: agent_* events.',
    insights: [
      { name: `${NS} Agent panel opens (daily)`, query: trend([{ event: 'agent_panel_opened' }]) },
      {
        name: `${NS} Agent runs — started / completed / errored`,
        query: trend([
          { event: 'agent_run_started', label: 'started' },
          { event: 'agent_run_completed', label: 'completed' },
          { event: 'agent_run_errored', label: 'errored' },
        ]),
      },
      {
        name: `${NS} Agent run errors by code`,
        query: trend([{ event: 'agent_run_errored' }], { breakdown: 'error_code', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Agent approval funnel (shown → decided)`,
        query: funnel(['agent_approval_shown', 'agent_approval_decided']),
      },
      {
        name: `${NS} Agent approval decisions (approved / denied)`,
        query: trend([{ event: 'agent_approval_decided' }], { breakdown: 'decision', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Agent run latency — avg duration_ms`,
        query: trend([{ event: 'agent_run_completed', label: 'avg ms', math: 'avg', mathProperty: 'duration_ms' }]),
      },
      {
        name: `${NS} Agent tool rounds — avg`,
        query: trend([{ event: 'agent_run_completed', label: 'avg rounds', math: 'avg', mathProperty: 'tool_round_count' }]),
      },
      {
        name: `${NS} Agent feedback by rating`,
        query: trend([{ event: 'agent_feedback_rated' }], { breakdown: 'rating', display: 'ActionsBarValue' }),
      },
      { name: `${NS} Agent threads resumed`, query: trend([{ event: 'agent_thread_resumed' }]) },
    ],
  },
  {
    dashboard: `${NS} Auth · Login Health`,
    description: 'Login success/failure, failure reasons, logout. Source: auth_* events.',
    insights: [
      {
        name: `${NS} Logins — success vs failed`,
        query: trend([
          { event: 'auth_login_succeeded', label: 'succeeded' },
          { event: 'auth_login_failed', label: 'failed' },
        ]),
      },
      {
        name: `${NS} Login failures by reason`,
        query: trend([{ event: 'auth_login_failed' }], { breakdown: 'reason_code', display: 'ActionsBarValue' }),
      },
      { name: `${NS} Logouts`, query: trend([{ event: 'auth_logout_succeeded' }]) },
    ],
  },
  {
    dashboard: `${NS} Product · Usage & Friction`,
    description: 'Navigation, detail opens, search/filter, and friction (validation/save/permission). Source: product events.',
    insights: [
      {
        name: `${NS} Top routes viewed`,
        query: trend([{ event: 'app_route_viewed' }], { breakdown: 'route', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Detail opens — project vs procurement`,
        query: trend([
          { event: 'project_detail_opened', label: 'project' },
          { event: 'procurement_detail_opened', label: 'procurement' },
        ]),
      },
      {
        name: `${NS} Search & filter usage`,
        query: trend([
          { event: 'search_used', label: 'search' },
          { event: 'filter_applied', label: 'filter' },
        ]),
      },
      {
        name: `${NS} Empty states seen by module`,
        query: trend([{ event: 'empty_state_seen' }], { breakdown: 'module', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Save failures by reason`,
        query: trend([{ event: 'save_failed' }], { breakdown: 'reason_code', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Permission-denied surfaces`,
        query: trend([{ event: 'permission_denied_seen' }], { breakdown: 'surface', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Form validation failures by module`,
        query: trend([{ event: 'form_validation_failed' }], { breakdown: 'module', display: 'ActionsBarValue' }),
      },
    ],
  },
];

// ── Upsert ─────────────────────────────────────────────────────────────────────
async function main() {
  const dashboards = await listAll('/dashboards/?limit=100');
  const insights = await listAll('/insights/?limit=500');
  const dashByName = new Map(dashboards.filter((d) => !d.deleted).map((d) => [d.name, d]));
  const insByName = new Map(insights.filter((i) => !i.deleted).map((i) => [i.name, i]));

  let created = { dashboards: 0, insights: 0 };
  let skipped = { dashboards: 0, insights: 0 };
  // Every `[PMO]` insight this run touched (created OR already-existing) — refreshed
  // below so a freshly-provisioned dashboard never renders blank tiles (root-cause
  // fix: an upserted insight's `result` stays null until something computes it).
  const provisionedIds = [];

  for (const spec of SPEC) {
    let dash = dashByName.get(spec.dashboard);
    if (!dash) {
      dash = await api('POST', '/dashboards/', { name: spec.dashboard, description: spec.description });
      created.dashboards++;
      console.log(`+ dashboard  ${spec.dashboard}  (id ${dash.id})`);
    } else {
      skipped.dashboards++;
      console.log(`= dashboard  ${spec.dashboard}  (id ${dash.id}, exists)`);
    }

    for (const ins of spec.insights) {
      const existing = insByName.get(ins.name);
      if (existing) {
        skipped.insights++;
        provisionedIds.push(existing.id);
        console.log(`  = insight  ${ins.name}  (exists)`);
        continue;
      }
      const body = { name: ins.name, query: ins.query, dashboards: [dash.id] };
      const made = await api('POST', '/insights/', body);
      insByName.set(ins.name, made);
      created.insights++;
      provisionedIds.push(made.id);
      console.log(`  + insight  ${ins.name}  (id ${made.id})`);
    }
  }

  console.log(
    `\nDone. dashboards: +${created.dashboards}/=${skipped.dashboards}  ` +
      `insights: +${created.insights}/=${skipped.insights}`,
  );

  // Force each provisioned insight to compute its `result` NOW (blocking refresh) —
  // otherwise a brand-new insight/dashboard renders BLANK until a human happens to
  // open it (PostHog only computes on-demand by default).
  let refreshed = 0;
  for (const id of provisionedIds) {
    await api('GET', `/insights/${id}/?refresh=blocking`);
    refreshed++;
  }
  console.log(`refreshed ${refreshed} insights`);
  console.log(`View: ${HOST}/project/${PID}/dashboard`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
