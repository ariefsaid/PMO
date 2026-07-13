#!/usr/bin/env node
/**
 * query.mjs — ad-hoc HogQL reads against PostHog (PMO product analytics).
 *
 * The read counterpart to provision-dashboards.mjs: lets the Director/agents/cron
 * ANALYSE ingested event data (not just provision dashboards). Same auth pattern.
 *
 * Auth (never hard-code secrets) — env:
 *   POSTHOG_API_KEY     personal API key with query:read (phx_…), 1Password `posthog-personal-api`
 *   POSTHOG_PROJECT_ID  numeric project id (default 465502)
 *   POSTHOG_HOST        default https://us.i.posthog.com
 *
 * Run (key never touches disk):
 *   POSTHOG_API_KEY=$(op-get.sh posthog-personal-api AS credential) \
 *     node scripts/posthog/query.mjs "select event, count() c from events \
 *       where timestamp > now() - interval 7 day group by event order by c desc"
 *
 * HogQL on argv[2] or stdin. Prints JSON { columns, results } (machine-readable);
 * pass --table for a quick console table.
 *
 * ponytail: thin fetch wrapper over PostHog's /query endpoint — no client lib, no
 * caching, no output formatting beyond JSON/table. Add pagination only if a query
 * ever returns >the API's default cap (it hasn't; PostHog caps HogQL rows server-side).
 */

const HOST = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
const KEY = process.env.POSTHOG_API_KEY;
const PID = process.env.POSTHOG_PROJECT_ID || '465502';

const asTable = process.argv.includes('--table');
const sql = (process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || '').trim()
  || (await readStdin()).trim();

if (!KEY) { console.error('Missing POSTHOG_API_KEY env.'); process.exit(2); }
if (!sql) {
  console.error('Usage: node query.mjs "<HogQL>"  [--table]\n' +
    'e.g.   node query.mjs "select event, count() c from events ' +
    "where timestamp > now() - interval 7 day group by event order by c desc\"");
  process.exit(2);
}

const res = await fetch(`${HOST}/api/projects/${PID}/query/`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
});
const text = await res.text();
if (!res.ok) { console.error(`${res.status}: ${text.slice(0, 600)}`); process.exit(1); }

const { columns = [], results = [] } = JSON.parse(text);
if (asTable) {
  console.table(results.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]]))));
} else {
  console.log(JSON.stringify({ columns, results }, null, 2));
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let d = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (d += c)).on('end', () => resolve(d));
  });
}
