#!/usr/bin/env node
// Repeatable multi-user load run against the LOCAL stack. Signs in seeded users (password grant), then N virtual
// users replay the PostgREST/RPC call set a page load makes (scripts/perf/load-routes.json, from load-capture.mjs),
// all calls of a page in parallel as the browser does, for D seconds with think time.
// usage: scripts/with-db-lock.sh node scripts/perf/load-run.mjs [--users 50] [--duration 60] [--routes a,b] [--think 1000]
//        [--url http://127.0.0.1:54321] [--no-db-stats] [--allow-remote]
// Output: markdown table, per route: pages, whole-page p50/p95/p99 (ms), failed calls, then DB top statements.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const o = { users: 50, duration: 60, think: 1000, routes: null, url: 'http://127.0.0.1:54321', dbStats: true, allowRemote: false };
  const num = (k, v) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw new Error(`--${k} needs a positive number`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--users') o.users = num('users', argv[++i]);
    else if (a === '--duration') o.duration = num('duration', argv[++i]);
    else if (a === '--think') o.think = num('think', argv[++i]);
    else if (a === '--routes') o.routes = String(argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--url') o.url = argv[++i];
    else if (a === '--no-db-stats') o.dbStats = false;
    else if (a === '--allow-remote') o.allowRemote = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.allowRemote && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(o.url).hostname)) {
    throw new Error(`refusing non-localhost target ${o.url}: this script signs in with the seeded password. Pass --allow-remote to override.`);
  }
  return o;
}

// nearest-rank percentile over unsorted values
export function percentile(values, p) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export function summarize(pages) {
  const ok = pages.filter((p) => p.failed === 0).map((p) => p.ms);
  return {
    pages: pages.length, p50: percentile(ok, 50), p95: percentile(ok, 95), p99: percentile(ok, 99),
    failedCalls: pages.reduce((s, p) => s + p.failed, 0), failedPages: pages.filter((p) => p.failed > 0).length,
  };
}

// date windows the dashboards ask for, relative to today (the fixture stores placeholders, not capture-time dates)
export function dateVars(now = new Date()) {
  const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return { yearStart: iso(y, 0, 1), monthStart: iso(y, m, 1), monthEnd: iso(y, m + 1, 0), monthStartMinus1: iso(y, m - 1, 1), monthStartMinus12: iso(y - 1, m, 1) };
}

export function fill(s, vars) {
  return s.replace(/\{(\w+)\}/g, (_, k) => {
    if (vars[k] === undefined) throw new Error(`unresolved placeholder {${k}}`);
    return vars[k];
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/perf/load-routes.json'), 'utf8'));
  const keys = o.routes ?? Object.keys(fixture);
  for (const k of keys) if (!fixture[k]) throw new Error(`unknown route ${k}; have ${Object.keys(fixture).join(', ')}`);
  const anon = process.env.SUPABASE_ANON_KEY || (spawnSync('supabase', ['status', '-o', 'env'], { cwd: ROOT, encoding: 'utf8' }).stdout.match(/ANON_KEY="([^"]+)"/) || [])[1];
  if (!anon) throw new Error('no anon key: start the local stack or set SUPABASE_ANON_KEY');

  const tokens = {}; // one session per seeded email, shared by the virtual users on that route
  const who = {}; // per email: userId + orgId resolved at run time (never stored in the fixture)
  for (const email of new Set(keys.map((k) => fixture[k].email))) {
    const r = await fetch(`${o.url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Passw0rd!dev' }), // seeded local-only password
    });
    if (!r.ok) throw new Error(`sign-in ${email} failed: ${r.status}`);
    const body = await r.json();
    tokens[email] = body.access_token;
    const pr = await fetch(`${o.url}/rest/v1/profiles?select=org_id&id=eq.${body.user.id}`, { headers: { apikey: anon, authorization: `Bearer ${body.access_token}` } });
    who[email] = { userId: body.user.id, orgId: (await pr.json())[0]?.org_id };
    if (!who[email].orgId) throw new Error(`no profile/org for ${email}`);
  }

  const psql = (sql) => spawnSync('docker', ['exec', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-At', '-F', '\t', '-c', sql], { encoding: 'utf8' });
  const statsOn = o.dbStats && psql('select pg_stat_statements_reset()').status === 0; // ponytail: container name fixed to the local stack

  const loadPage = async (route, vars) => {
    const hdr = { apikey: anon, authorization: `Bearer ${tokens[route.email]}` };
    const t0 = performance.now();
    const res = await Promise.all(route.calls.map(async (c) => {
      const sub = (s) => fill(s, vars);
      try {
        const r = await fetch(`${o.url}${sub(c.path)}`, { method: c.method, headers: { ...c.headers, ...hdr }, body: c.body ? sub(c.body) : undefined });
        await r.arrayBuffer();
        return r.ok || r.status;
      } catch { return 'net'; }
    }));
    return { ms: performance.now() - t0, failed: res.filter((x) => x !== true).length, statuses: res.filter((x) => x !== true) };
  };

  const results = [];
  for (const k of keys) {
    const route = fixture[k];
    const vars = { ...dateVars(), ...who[route.email] };
    if (route.calls.some((c) => c.path.includes('{projectId}'))) {
      const r = await fetch(`${o.url}/rest/v1/projects?select=id&order=created_at.asc&limit=1`, { headers: { apikey: anon, authorization: `Bearer ${tokens[route.email]}` } });
      vars.projectId = (await r.json())[0]?.id;
    }
    const pages = [];
    const end = performance.now() + o.duration * 1000;
    await Promise.all(Array.from({ length: o.users }, async (_, i) => {
      await sleep((i / o.users) * o.think); // stagger the first page load
      while (performance.now() < end) {
        pages.push(await loadPage(route, vars));
        await sleep(o.think * (0.5 + Math.random()));
      }
    }));
    const codes = {};
    for (const p of pages) for (const c of p.statuses) codes[c] = (codes[c] || 0) + 1;
    results.push({ key: k, calls: route.calls.length, codes: Object.entries(codes).map(([c, n]) => `${c}x${n}`).join(' ') || '-', ...summarize(pages) });
    console.error(`${k}: ${pages.length} pages`);
  }

  const f = (n) => (Number.isNaN(n) ? 'n/a' : Math.round(n));
  console.log(`\n${o.users} users, ${o.duration} s per route, think ${o.think} ms\n`);
  console.log('| Route | Calls/page | Pages | p50 ms | p95 ms | p99 ms | Failed calls | Failure statuses |\n|---|---|---|---|---|---|---|---|');
  for (const r of results) console.log(`| ${r.key} | ${r.calls} | ${r.pages} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} | ${r.failedCalls} | ${r.codes} |`);
  if (statsOn) {
    const q = psql("select calls, round(total_exec_time)::int, round(mean_exec_time::numeric,2), left(regexp_replace(query, '\\s+', ' ', 'g'), 110) from pg_stat_statements where query not ilike '%pg_stat_statements%' order by total_exec_time desc limit 8");
    console.log('\nDB top statements by total time (pg_stat_statements)\n\n| Calls | Total ms | Mean ms | Query |\n|---|---|---|---|');
    for (const l of q.stdout.trim().split('\n').filter(Boolean)) console.log(`| ${l.split('\t').join(' | ').replaceAll('|  |', '|')} |`);
  } else console.log('\nDB statements: pg_stat_statements unavailable (or --no-db-stats).');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
