#!/usr/bin/env node
// Captures the PostgREST/RPC calls a real page load makes, per route, into scripts/perf/load-routes.json
// (the replay list for load-run.mjs). usage: node scripts/perf/load-capture.mjs [baseUrl] [--allow-remote] [--mix]
// Needs the dev server (default http://localhost:5173) on the local stack. Auth headers are never stored.
// --mix captures the role-mix screens of a large field organisation instead (scripts/perf/large-org-field-seed.sql, one login
// per role, phone viewport for site roles) into scripts/perf/load-mix-routes.json, the replay list for load-mix.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dateVars, seedId } from './load-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(ROOT, 'pmo-portal/package.json'))('@playwright/test');
const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) || 'http://localhost:5173';
if (!args.includes('--allow-remote') && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) {
  console.error(`refusing non-localhost target ${base}: this script types the seeded password into /login. Pass --allow-remote to override.`);
  process.exit(1);
}
const KEEP = ['accept', 'accept-profile', 'content-profile', 'content-type', 'prefer', 'range'];
const MIX = args.includes('--mix');
const ORG = '00000000-0000-0000-0000-000000000001';
// One login per role (the seed's account 1 of each); its own seeded rows become placeholders the runner fills per account.
const who = (role) => ({ email: `lf-${role}-1@perf.test`, ids: [[seedId(`lf-user-${role}-1`), '{userId}'], [ORG, '{orgId}']] });
const field = (role, extra) => ({ ...who(role), ids: [...who(role).ids, ...extra] });
const wo1 = [[seedId('lf-wo-1'), '{workOrderId}'], [seedId('lf-crew-1'), '{crewId}'], [seedId('lf-wh-1'), '{warehouseId}']];
const MIX_ROUTES = [
  { key: 'field-home', phone: true, path: '/my', ...field('field_user', [...wo1, [seedId(`lf-person-${seedId('lf-user-field_user-1')}`), '{personId}']]) },
  { key: 'foreman-home', phone: true, path: '/my', ...field('foreman', [...wo1, [seedId('lf-wo-151'), '{workOrderId2}'], [seedId('lf-crew-151'), '{crewId2}'], [seedId(`lf-person-${seedId('lf-user-foreman-1')}`), '{personId}']]) },
  ...['/', '/site-reports', '/work-orders/{workOrderId}', '/material-requests', '/material-requests/new', '/my-tasks', '/crews']
    .map((path, i) => ({ key: `site-${['home', 'reports', 'work-order', 'requests', 'request-new', 'tasks', 'crews'][i]}`, phone: true, path, ...field('site_supervisor', wo1) })),
  ...['/stock', '/stock/ledger', '/material-requests', '/']
    .map((path, i) => ({ key: `store-${['stock', 'ledger', 'requests', 'home'][i]}`, path, ...field('storekeeper', wo1) })),
  ...['/', '/work-orders', '/work-orders/{workOrderId}', '/approvals', '/projects/{projectId}', '/my-tasks']
    .map((path, i) => ({ key: `pm-${['home', 'work-orders', 'work-order', 'approvals', 'project', 'tasks'][i]}`, path, ...field('project_manager', wo1) })),
  ...['/', '/finance/billing-board', '/procurement', '/finance/receivables', '/finance/payables', '/approvals']
    .map((path, i) => ({ key: `fin-${['home', 'billing-board', 'procurement', 'receivables', 'payables', 'approvals'][i]}`, path, ...who('finance_officer') })),
  ...['/', '/reports', '/work-orders'].map((path, i) => ({ key: `exec-${['home', 'reports', 'work-orders'][i]}`, path, ...who('executive') })),
  ...['/', '/administration'].map((path, i) => ({ key: `admin-${['home', 'administration'][i]}`, path, ...who('administrator') })),
];
// --only a,b re-captures those keys into the existing fixture
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const ALL_ROUTES = MIX ? MIX_ROUTES : [
  { key: 'dashboard-exec', email: 'exec@acme.test', path: '/' },
  { key: 'dashboard-pm', email: 'pm@acme.test', path: '/' },
  { key: 'project', email: 'exec@acme.test', path: '/projects/:id' },
  { key: 'procurement', email: 'exec@acme.test', path: '/procurement' },
  { key: 'receivables', email: 'exec@acme.test', path: '/finance/receivables' },
];
const OUT = path.join(ROOT, MIX ? 'scripts/perf/load-mix-routes.json' : 'scripts/perf/load-routes.json');
const ROUTES = ONLY ? ALL_ROUTES.filter((r) => ONLY.includes(r.key)) : ALL_ROUTES;

// Stored calls carry placeholders, never the capturing user's ids or capture-time dates (public repo): load-run.mjs
// resolves {userId}/{orgId} per signed-in user and the date windows from today. A capture must fail on a leftover date.
const unknownDates = new Set();
const templatize = (s, ids) => {
  if (s === undefined) return s;
  for (const [id, ph] of ids) s = s.split(id).join(ph);
  for (const [k, d] of Object.entries(dateVars())) s = s.split(d).join(`{${k}}`);
  for (const d of s.match(/\d{4}-\d\d-\d\d/g) ?? []) unknownDates.add(d);
  return s;
};

// The project of work order 1, read as that login (the seed gives projects random ids). --mix needs the API the dev server uses.
const mixProjectId = async (email) => {
  const api = process.env.PERF_API_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!api || !anon) throw new Error('--mix needs PERF_API_URL and SUPABASE_ANON_KEY (the API the dev server points at)');
  const t = await (await fetch(`${api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!dev' }) })).json();
  const rows = await (await fetch(`${api}/rest/v1/work_orders?select=project_id&id=eq.${seedId('lf-wo-1')}`, { headers: { apikey: anon, authorization: `Bearer ${t.access_token}` } })).json();
  return rows[0].project_id;
};
const browser = await chromium.launch({ headless: true });
const out = ONLY ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const sessions = {};
for (const r of ROUTES) {
  const ctx = sessions[r.email] ??= await browser.newContext(r.phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (!sessions[`${r.email}:in`]) {
    await page.goto(`${base}/login`);
    await page.getByLabel(/email/i).fill(r.email);
    await page.getByLabel(/password/i).fill('Passw0rd!dev');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    sessions[`${r.email}:in`] = true;
  }
  let url = r.path;
  if (url === '/projects/:id') {
    await page.goto(`${base}/projects`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    await Promise.all([page.waitForURL(/\/projects\/[^/]+$/), page.locator('tbody tr').first().click()]);
    url = new URL(page.url()).pathname;
    await page.goto('about:blank');
  }
  const mixIds = r.ids ? [...r.ids, [await mixProjectId(r.email), '{projectId}']] : null;
  if (mixIds) for (const [id, ph] of mixIds) url = url.split(ph).join(id);
  const projectId = r.path === '/projects/:id' ? url.split('/').pop() : null;
  const calls = [];
  const raw = [];
  page.on('request', (q) => {
    const u = new URL(q.url());
    if (!/^\/(rest|functions)\/v1\//.test(u.pathname)) return;
    const headers = Object.fromEntries(Object.entries(q.headers()).filter(([k]) => KEEP.includes(k)));
    let p = u.pathname + u.search;
    if (projectId) p = p.split(projectId).join('{projectId}');
    raw.push({ method: q.method(), path: p, headers, body: q.postData() ? q.postData().split(projectId ?? '\0').join('{projectId}') : undefined });
  });
  await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const uid = raw.map((c) => c.path.match(/profiles\?select=\*&id=eq\.([0-9a-f-]{36})/)?.[1]).find(Boolean);
  const oid = raw.map((c) => c.path.match(/org_id=eq\.([0-9a-f-]{36})/)?.[1]).find(Boolean);
  const ids = mixIds ?? [[uid, '{userId}'], [oid, '{orgId}']].filter(([i]) => i);
  for (const c of raw) calls.push({ ...c, path: templatize(c.path, ids), body: templatize(c.body, ids) });
  out[r.key] = { email: r.email, route: r.path, ...(r.phone ? { phone: true } : {}), calls };
  // ids left in a stored call are data rows the screen read (a list's follow-on read): replayed as captured, for every login
  const left = calls.filter((c) => /[0-9a-f]{8}-[0-9a-f]{4}-/.test(c.path + (c.body ?? ''))).length;
  console.log(`${r.key}: ${calls.length} calls${left ? `, ${left} with data ids` : ''}`);
  await page.close();
}
await browser.close();
if (unknownDates.size) throw new Error(`dates ${[...unknownDates].join(', ')} are not known windows: extend dateVars in load-run.mjs before capturing`);
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
