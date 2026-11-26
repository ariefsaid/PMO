#!/usr/bin/env node
// Concurrent signed-in users of a large field organisation, on the LOCAL stack seeded by scripts/perf/large-org-seed.sql +
// scripts/perf/large-org-field-seed.sql. Each virtual user signs in as its own account (role mix below), loads its first
// screen cold (every call the real page makes, scripts/perf/load-mix-routes.json from `load-capture.mjs --mix`), then moves
// between its role's screens with think time, replaying each screen's own calls (the shell's session reads again every
// 5 minutes), and makes the field day's real writes through the RPCs the screens call: clock-in, the roster tick,
// a material request, an approval decision.
// usage (on the stack's host, inside its DB lock):
//   node scripts/perf/load-mix.mjs --users 100 [--ramp 120] [--duration 600] [--think-scale 1] [--out dir] [--url ...] [--allow-remote]
// Output: <out>/summary.md (per screen / write / endpoint p50 p95 p99 and errors; DB connections, lock waits, CPU;
// top statements) and <out>/raw.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { percentile, fill, dateVars, seedId } from './load-run.mjs';

const sh = promisify(exec);
const ORG = '00000000-0000-0000-0000-000000000001';

// Share of the users per role (of 500: 220 field users, 150 foremen, 45 site supervisors, 20 storekeepers, 30 PMs,
// 20 finance, 10 executives, 5 admins); screen weights; mean think time between screens (uniform 0.5x..1.5x).
export const ROLES = {
  field_user: { share: 0.44, think: 20000, screens: { 'field-home': 1 } },
  foreman: { share: 0.30, think: 20000, screens: { 'foreman-home': 1 } },
  site_supervisor: { share: 0.09, think: 20000, screens: { 'site-home': 2, 'site-reports': 2, 'site-work-order': 2, 'site-requests': 2, 'site-request-new': 1, 'site-tasks': 1, 'site-crews': 1 } },
  storekeeper: { share: 0.04, think: 15000, screens: { 'store-stock': 3, 'store-ledger': 2, 'store-requests': 2, 'store-home': 1 } },
  project_manager: { share: 0.06, think: 15000, screens: { 'pm-home': 3, 'pm-work-orders': 2, 'pm-work-order': 2, 'pm-approvals': 2, 'pm-project': 1, 'pm-tasks': 1 } },
  finance_officer: { share: 0.04, think: 15000, screens: { 'fin-home': 2, 'fin-billing-board': 2, 'fin-procurement': 2, 'fin-receivables': 1, 'fin-payables': 1, 'fin-approvals': 1 } },
  executive: { share: 0.02, think: 15000, screens: { 'exec-home': 3, 'exec-reports': 1, 'exec-work-orders': 1 } },
  administrator: { share: 0.01, think: 15000, screens: { 'admin-home': 1, 'admin-administration': 1 } },
};

// The fixture's project ids come from the database it was captured on; a reset makes new ones and project-scoped RPCs
// then 500 (P0002). Map each distinct captured p_project_id to a real project of the seeded database, in order.
export function remapProjectIds(fixture, realIds) {
  const re = /"p_project_id":"([0-9a-f-]{36})"/g;
  const map = new Map();
  const swap = (s) => s?.replace(re, (_, id) => {
    if (!map.has(id)) map.set(id, realIds[map.size % realIds.length]);
    return `"p_project_id":"${map.get(id)}"`;
  });
  if (!realIds.length) return fixture;
  for (const r of Object.values(fixture)) for (const c of r.calls) { c.body = swap(c.body); }
  return fixture;
}

// One distribution over every entry's samples and failures (calls, screens or writes), as the whole run saw them.
export function pool(entries) {
  const ms = entries.flatMap((e) => e.ms);
  const err = entries.reduce((s, e) => s + e.err, 0);
  const n = entries.reduce((s, e) => s + e.n, 0);
  return { n, err, ms, rate: n ? err / n : 0 };
}

export function parseArgs(argv) {
  const o = { users: 100, ramp: 120, duration: 600, thinkScale: 1, maxInflight: 256, out: null, url: 'http://127.0.0.1:54321', allowRemote: false };
  const num = (k, v) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw new Error(`--${k} needs a positive number`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--users') o.users = num('users', argv[++i]);
    else if (a === '--ramp') o.ramp = num('ramp', argv[++i]);
    else if (a === '--duration') o.duration = num('duration', argv[++i]);
    else if (a === '--think-scale') o.thinkScale = num('think-scale', argv[++i]);
    else if (a === '--max-inflight') o.maxInflight = num('max-inflight', argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--url') o.url = argv[++i];
    else if (a === '--allow-remote') o.allowRemote = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.allowRemote && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(o.url).hostname)) {
    throw new Error(`refusing non-localhost target ${o.url}: this script signs in with the seeded password and writes. Pass --allow-remote to override.`);
  }
  return o;
}

// Accounts per role for N users: largest-remainder split of ROLES shares, account numbers 1..k of each role.
export function assignRoles(users) {
  const keys = Object.keys(ROLES);
  const raw = keys.map((k) => ROLES[k].share * users);
  const n = raw.map(Math.floor);
  const order = keys.map((_, i) => i).sort((a, b) => (raw[b] - n[b]) - (raw[a] - n[a]));
  for (let i = 0; n.reduce((s, x) => s + x, 0) < users; i++) n[order[i % keys.length]]++;
  return keys.flatMap((k, i) => Array.from({ length: n[i] }, (_, j) => ({ role: k, n: j + 1 })));
}

// The placeholders a screen's stored calls carry, for account n of a role (the seed's naming, large-org-field-seed.sql).
export function seedVars(role, n) {
  const userId = seedId(`lf-user-${role}-${n}`);
  const v = { userId, orgId: ORG, personId: seedId(`lf-person-${userId}`) };
  const wo = { field_user: 1 + (n - 1) % 300, foreman: n, site_supervisor: n, storekeeper: (n - 1) * 10 + 1, project_manager: (n - 1) * 10 + 1 }[role] ?? 1;
  Object.assign(v, { wo, workOrderId: seedId(`lf-wo-${wo}`), crewId: seedId(`lf-crew-${wo}`), warehouseId: seedId(`lf-wh-${1 + Math.floor((wo - 1) / 10)}`) });
  if (role === 'foreman') Object.assign(v, { wo2: n + 150, workOrderId2: seedId(`lf-wo-${n + 150}`), crewId2: seedId(`lf-crew-${n + 150}`) });
  return v;
}

// The people a crew's roster names (10 workers + the field users placed in it).
export function crewWorkers(c) {
  const out = Array.from({ length: 10 }, (_, i) => seedId(`lf-person-${(c - 1) * 10 + i + 1}`));
  for (let f = c; f <= 220; f += 300) out.push(seedId(`lf-person-${seedId(`lf-user-field_user-${f}`)}`));
  return out;
}

// A call is the shell's when every screen of that login makes it (or, for one-screen logins, 80% of all screens do).
export function shellCalls(fixture) {
  const sig = (c) => `${c.method} ${c.path} ${c.body ?? ''}`;
  const all = Object.values(fixture);
  const freq = {};
  for (const r of all) for (const s of new Set(r.calls.map(sig))) freq[s] = (freq[s] || 0) + 1;
  const byEmail = {};
  for (const r of all) (byEmail[r.email] ??= []).push(r);
  const shell = {};
  for (const [email, rs] of Object.entries(byEmail)) {
    const sets = rs.map((r) => new Set(r.calls.map(sig)));
    shell[email] = new Set(rs.length > 1 ? [...sets[0]].filter((s) => sets.every((x) => x.has(s)))
      : [...sets[0]].filter((s) => freq[s] >= 0.8 * all.length));
  }
  return { sig, shell };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const endpoint = (c) => `${c.method} ${c.path.split('?')[0].replace('/rest/v1/', '')}`;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = JSON.parse(fs.readFileSync(path.join(here, 'load-mix-routes.json'), 'utf8'));
  for (const r of Object.values(ROLES)) for (const k of Object.keys(r.screens)) if (!fixture[k]) throw new Error(`fixture has no screen ${k}`);
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!anon) throw new Error('set SUPABASE_ANON_KEY (the stack\'s anon key)');
  const out = o.out ?? path.join(process.cwd(), `load-mix-${o.users}u`);
  fs.mkdirSync(out, { recursive: true });
  const { sig, shell } = shellCalls(fixture);
  const dv = dateVars();

  // ── sign in every account (real password grant), resolve its rows ──
  const vus = assignRoles(o.users);
  const signIn = async (vu) => {
    vu.email = `lf-${vu.role}-${vu.n}@perf.test`;
    const r = await fetch(`${o.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: vu.email, password: 'Passw0rd!dev' }) });
    if (!r.ok) throw new Error(`sign-in ${vu.email}: ${r.status}`);
    vu.token = (await r.json()).access_token;
    vu.vars = { ...dv, ...seedVars(vu.role, vu.n) };
    const p = await (await fetch(`${o.url}/rest/v1/work_orders?select=project_id&id=eq.${vu.vars.workOrderId}`, { headers: { apikey: anon, authorization: `Bearer ${vu.token}` } })).json();
    vu.vars.projectId = p[0]?.project_id ?? seedId('none');
    vu.vars.neededBy = new Date(Date.parse(`${dv.today}T00:00:00Z`) + 3 * 864e5).toISOString().slice(0, 10);
  };
  for (let i = 0; i < vus.length; i += 20) await Promise.all(vus.slice(i, i + 20).map(signIn));
  console.error(`${vus.length} accounts signed in`);
  const viewer = vus.find((v) => ['executive', 'administrator', 'project_manager'].includes(v.role));
  if (viewer) {
    const rows = await (await fetch(`${o.url}/rest/v1/projects?select=id&order=code.asc&limit=30&code=like.LG-*`, { headers: { apikey: anon, authorization: `Bearer ${viewer.token}` } })).json();
    if (Array.isArray(rows)) remapProjectIds(fixture, rows.map((r) => r.id));
  }

  // ── samples ──
  const t0 = performance.now();
  const steadyAt = t0 + o.ramp * 1000, endAt = steadyAt + o.duration * 1000;
  const inSteady = () => { const t = performance.now(); return t >= steadyAt && t < endAt; };
  const pages = {}, calls = {}, writes = {};
  const add = (m, k, ms, ok, status) => { const e = (m[k] ??= { ms: [], n: 0, err: 0, codes: {} }); e.n++; if (ok) e.ms.push(ms); else { e.err++; e.codes[status] = (e.codes[status] || 0) + 1; } };
  const lag = monitorEventLoopDelay({ resolution: 20 });

  // Requests in flight across all users at most --max-inflight (default 256): the edge in front of the API holds the
  // phones' connections and keeps a bounded pool upstream; the local gateway alone has 512 worker connections. Time
  // spent waiting for a slot counts in the latency, as a proxy queue would.
  let inflight = 0;
  const waiters = [];
  const acquire = () => (inflight < o.maxInflight ? (inflight++, Promise.resolve()) : new Promise((r) => waiters.push(r)));
  const release = () => { const next = waiters.shift(); if (next) next(); else inflight--; };
  const call = async (vu, c, screen) => {
    const t = performance.now();
    let status;
    await acquire();
    try {
      const r = await fetch(`${o.url}${fill(c.path, vu.vars)}`, { method: c.method, headers: { ...c.headers, apikey: anon, authorization: `Bearer ${vu.token}` }, body: c.body ? fill(c.body, vu.vars) : undefined });
      const body = await r.text();
      status = r.ok ? 'ok' : `${r.status}${(body.match(/"code":"([^"]+)"/) ?? [])[1] ? ':' + body.match(/"code":"([^"]+)"/)[1] : ''}`;
      if (inSteady() && screen) add(calls, `${screen} ${endpoint(c)}`, performance.now() - t, r.ok, status);
      return { ok: r.ok, status, body };
    } catch (e) {
      status = `net:${e.cause?.code ?? e.message}`;
      if (inSteady() && screen) add(calls, `${screen} ${endpoint(c)}`, 0, false, status);
      return { ok: false, status, body: '' };
    } finally { release(); }
  };
  const loadScreen = async (vu, key, cold) => {
    const cs = fixture[key].calls.filter((c) => cold || !shell[fixture[key].email].has(sig(c)));
    const t = performance.now();
    // a browser keeps at most 6 requests in flight to one host over HTTP/1.1, as the capture's did
    const res = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, cs.length) }, async () => { while (next < cs.length) res.push(await call(vu, cs[next++], key)); }));
    const bad = res.filter((r) => !r.ok);
    if (inSteady()) add(pages, cold ? `${key} (cold)` : key, performance.now() - t, bad.length === 0, [...new Set(bad.map((b) => b.status))].join('|'));
  };
  const rpc = async (vu, name, args) => call(vu, { method: 'POST', path: `/rest/v1/rpc/${name}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const write = async (vu, name, fn) => {
    const t = performance.now();
    const r = await fn();
    if (inSteady()) add(writes, name, performance.now() - t, r.ok, r.status);
    return r;
  };

  // The field day's writes, with the arguments the screens send (src/lib/db/phoneCheckIn.ts, attendance.ts, materialRequests.ts).
  const WRITES = {
    field_user: { p: 1, once: true, run: (vu) => write(vu, 'clock-in (phone_check_in)', () => rpc(vu, 'phone_check_in', {
      p_work_order_id: vu.vars.workOrderId, p_crew_id: vu.vars.crewId, p_lat: -6.2 + vu.vars.wo * 0.001, p_lng: 106.8 + vu.vars.wo * 0.001,
      p_accuracy: 12, p_hours: 8, p_no_position: false })) },
    foreman: { p: 0.25, run: async (vu) => {
      for (const wo of [vu.vars.wo, vu.vars.wo2]) {
        const rows = crewWorkers(wo).map((worker_id) => ({ worker_id, status: 'present', hours: 8 }));
        await write(vu, 'roster tick (attendance_record)', () => rpc(vu, 'attendance_record', { p_work_order_id: seedId(`lf-wo-${wo}`), p_work_date: dv.today, p_source: 'roster_tick', p_rows: rows }));
      }
    } },
    site_supervisor: { p: 0.1, run: async (vu) => {
      const d = await write(vu, 'material request draft (mrq_save_draft)', () => rpc(vu, 'mrq_save_draft', {
        p_request_id: null, p_header: { work_order_id: vu.vars.workOrderId, needed_by: vu.vars.neededBy, to_warehouse_id: vu.vars.warehouseId, note: null },
        p_lines: [{ item_id: seedId(`lf-item-${1 + Math.floor(Math.random() * 200)}`), quantity: 5, over_plan_reason: 'Needed for this week' }] /* the work order has no material plan, so the screen asks for a reason */, p_client_request_id: randomUUID() }));
      if (d.ok) await write(vu, 'material request submit (mrq_submit)', () => rpc(vu, 'mrq_submit', { p_request_id: JSON.parse(d.body), p_client_request_id: randomUUID() }));
    } },
    project_manager: { p: 0.25, run: async (vu) => {
      const w = await rpc(vu, 'mrq_waiting_for_me', {});
      const step = w.ok ? JSON.parse(w.body).find((s) => s.step_position === 1) : null;
      if (step) await write(vu, 'approval decision (mrq_decide_step)', () => rpc(vu, 'mrq_decide_step', { p_request_id: step.request_id, p_step_position: 1, p_decision: 'approve', p_reason: null, p_source_warehouse_id: null }));
    } },
  };

  const pick = (screens) => { const e = Object.entries(screens); let x = Math.random() * e.reduce((s, [, w]) => s + w, 0); for (const [k, w] of e) if ((x -= w) <= 0) return k; return e[0][0]; };
  const runVu = async (vu, i) => {
    await sleep((i / vus.length) * o.ramp * 1000);
    const role = ROLES[vu.role];
    const first = Object.keys(role.screens)[0];
    await loadScreen(vu, first, true);
    let lastShell = performance.now();
    const w = WRITES[vu.role];
    let onceDone = false;
    while (performance.now() < endAt) {
      await sleep(role.think * o.thinkScale * (0.5 + Math.random()));
      if (performance.now() >= endAt) break;
      if (performance.now() - lastShell > 300000) { // session reads refresh every 5 minutes (SERVER_SESSION_STALE_TIME)
        lastShell = performance.now();
        await Promise.all(fixture[first].calls.filter((c) => shell[fixture[first].email].has(sig(c))).map((c) => call(vu, c, 'shell refresh')));
      }
      const key = pick(role.screens);
      await loadScreen(vu, key, false);
      if (w?.once && !onceDone && inSteady()) { onceDone = true; await w.run(vu); } // clock in once, early in the measured window; the home then reloads
      if (w && !w.once && Math.random() < w.p && (vu.role !== 'project_manager' || key === 'pm-approvals')) await w.run(vu);
    }
  };

  // ── DB / host sampler (every 5 s during steady state) ──
  const psql = async (q) => (await sh(`docker exec supabase_db_pmo-portal psql -U postgres -At -F '\t' -c "${q}"`)).stdout.trim();
  setTimeout(() => psql('select pg_stat_statements_reset()'), o.ramp * 1000); // statements of the steady state only
  const samples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      await sleep(5000);
      if (!inSteady()) continue;
      try {
        const [a, d] = await Promise.all([
          psql("select count(*), count(*) filter (where state = 'active'), count(*) filter (where wait_event_type = 'Lock'), count(*) filter (where usename = 'authenticator'), count(*) filter (where usename = 'authenticator' and state = 'active'), (select setting from pg_settings where name = 'max_connections') from pg_stat_activity where backend_type = 'client backend'"),
          sh("docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' supabase_db_pmo-portal supabase_rest_pmo-portal supabase_kong_pmo-portal supabase_auth_pmo-portal").then((r) => r.stdout),
        ]);
        const [total, active, lockWait, rest, restActive, maxConn] = a.split('\t').map(Number);
        const cpu = Object.fromEntries(d.trim().split('\n').map((l) => { const [n, c] = l.split(' '); return [n.replace(/^supabase_|_pmo-portal$/g, ''), parseFloat(c)]; }));
        samples.push({ t: Math.round((performance.now() - steadyAt) / 1000), total, active, lockWait, rest, restActive, maxConn, cpu, load: os.loadavg()[0].toFixed(1) });
      } catch (e) { samples.push({ error: e.message }); }
    }
  })();

  lag.enable();
  await Promise.all(vus.map(runVu));
  lag.disable();
  sampling = false;
  await sampler;
  const [busyMs, stmtCalls] = (await psql("select round(sum(total_exec_time))::bigint, sum(calls)::bigint from pg_stat_statements where query not ilike '%pg_stat_statements%'")).split('\t').map(Number);
  const top = await psql("select calls, round(total_exec_time)::int, round(mean_exec_time::numeric,1), round(max_exec_time::numeric)::int, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) from pg_stat_statements where query not ilike '%pg_stat_statements%' order by total_exec_time desc limit 25");

  // ── report ──
  const f = (n) => (Number.isFinite(n) ? Math.round(n) : 'n/a');
  const row = (k, e) => `| ${k} | ${e.n} | ${f(percentile(e.ms, 50))} | ${f(percentile(e.ms, 95))} | ${f(percentile(e.ms, 99))} | ${e.err} | ${Object.entries(e.codes).map(([c, x]) => `${c} x${x}`).join(' ') || '-'} |`;
  const head = (h) => `| ${h} | Count | p50 ms | p95 ms | p99 ms | Errors | Error statuses |\n|---|---|---|---|---|---|---|`;
  const totalCalls = Object.values(calls).reduce((s, e) => s + e.n, 0);
  const totalPages = Object.values(pages).reduce((s, e) => s + e.n, 0);
  const avg = (k) => samples.filter((s) => s.cpu).reduce((s, x) => s + (k(x) || 0), 0) / Math.max(1, samples.filter((s) => s.cpu).length);
  const max = (k) => Math.max(...samples.filter((s) => s.cpu).map(k));
  const poolCalls = pool(Object.values(calls)), poolPages = pool(Object.values(pages));
  const mix = Object.entries(vus.reduce((m, v) => ({ ...m, [v.role]: (m[v.role] || 0) + 1 }), {})).map(([r, n]) => `${r} ${n}`).join(', ');
  const md = [
    `# Load mix: ${o.users} users`, '',
    `Ramp ${o.ramp} s, steady ${o.duration} s (only steady state is measured), think scale ${o.thinkScale}, at most ${o.maxInflight} requests in flight. Mix: ${mix}.`,
    `Calls failed: ${Object.values(calls).reduce((s, e) => s + e.err, 0)} of ${totalCalls} (${Object.entries(Object.values(calls).reduce((m, e) => { for (const [c, x] of Object.entries(e.codes)) m[c] = (m[c] || 0) + x; return m; }, {})).map(([c, x]) => `${c} x${x}`).join(', ') || 'none'}).`,
    `Steady state: ${totalPages} screens (${(totalPages / o.duration).toFixed(1)}/s), ${totalCalls} API calls (${(totalCalls / o.duration).toFixed(1)}/s).`,
    `Load generator event-loop delay p99 ${f(lag.percentile(99) / 1e6)} ms (a high value means the generator, not the server, was saturated).`, '',
    `Overall (all API calls pooled): p50 ${f(percentile(poolCalls.ms, 50))} ms, p95 ${f(percentile(poolCalls.ms, 95))} ms, p99 ${f(percentile(poolCalls.ms, 99))} ms; error rate ${(poolCalls.rate * 100).toFixed(2)}% (${poolCalls.err} of ${poolCalls.n}).`,
    `Overall (whole screens pooled): p50 ${f(percentile(poolPages.ms, 50))} ms, p95 ${f(percentile(poolPages.ms, 95))} ms, p99 ${f(percentile(poolPages.ms, 99))} ms; error rate ${(poolPages.rate * 100).toFixed(2)}% (${poolPages.err} of ${poolPages.n}).`, '',
    '## Screens (whole screen: every call in parallel, first to last)', '', head('Screen'),
    ...Object.entries(pages).sort((a, b) => percentile(b[1].ms, 95) - percentile(a[1].ms, 95)).map(([k, e]) => row(k, e)), '',
    '## Writes', '', head('Write'), ...Object.entries(writes).map(([k, e]) => row(k, e)), '',
    '## Slowest API calls (screen, endpoint), top 25 by p95', '', head('Call'),
    ...Object.entries(calls).sort((a, b) => percentile(b[1].ms, 95) - percentile(a[1].ms, 95)).slice(0, 25).map(([k, e]) => row(k, e)), '',
    '## Database and host (sampled every 5 s in steady state)', '',
    `Client connections: avg ${avg((s) => s.total).toFixed(0)}, max ${max((s) => s.total)} of max_connections ${samples.find((s) => s.maxConn)?.maxConn}; PostgREST (authenticator) avg ${avg((s) => s.rest).toFixed(1)}, max ${max((s) => s.rest)}, active avg ${avg((s) => s.restActive).toFixed(1)}, max ${max((s) => s.restActive)}.`,
    `Statement time: ${f(busyMs / 1000)} s over ${o.duration} s of steady state = ${(busyMs / 1000 / o.duration).toFixed(1)} statements executing on average (connections the pool must hold busy), ${stmtCalls} statements.`,
    `Backends waiting on a lock: avg ${avg((s) => s.lockWait).toFixed(2)}, max ${max((s) => s.lockWait)}.`,
    `CPU % (100 = one core): db avg ${avg((s) => s.cpu.db).toFixed(0)} max ${f(max((s) => s.cpu.db))}; rest avg ${avg((s) => s.cpu.rest).toFixed(0)} max ${f(max((s) => s.cpu.rest))}; kong avg ${avg((s) => s.cpu.kong).toFixed(0)}; auth avg ${avg((s) => s.cpu.auth).toFixed(0)}. Load average max ${max((s) => Number(s.load))}.`, '',
    '## Top statements by total time (pg_stat_statements, steady state)', '', '| Calls | Total ms | Mean ms | Max ms | Query |', '|---|---|---|---|---|',
    ...top.split('\n').filter(Boolean).map((l) => `| ${l.split('\t').map((x) => x.replaceAll('|', '/')).join(' | ')} |`), '',
  ].join('\n');
  fs.writeFileSync(path.join(out, 'summary.md'), md);
  fs.writeFileSync(path.join(out, 'raw.json'), JSON.stringify({ options: o, mix, overall: { calls: { n: poolCalls.n, err: poolCalls.err, p50: percentile(poolCalls.ms, 50), p95: percentile(poolCalls.ms, 95), p99: percentile(poolCalls.ms, 99) }, pages: { n: poolPages.n, err: poolPages.err, p50: percentile(poolPages.ms, 50), p95: percentile(poolPages.ms, 95), p99: percentile(poolPages.ms, 99) } }, busyMs, stmtCalls, samples, pages: strip(pages), writes: strip(writes), calls: strip(calls), top }, null, 1));
  console.log(md);
}
const strip = (m) => Object.fromEntries(Object.entries(m).map(([k, e]) => [k, { n: e.n, err: e.err, codes: e.codes, p50: percentile(e.ms, 50), p95: percentile(e.ms, 95), p99: percentile(e.ms, 99), max: Math.max(...e.ms, 0) }]));

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
