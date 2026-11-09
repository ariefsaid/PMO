#!/usr/bin/env node
// Captures the PostgREST/RPC calls a real page load makes, per route, into scripts/perf/load-routes.json
// (the replay list for load-run.mjs). usage: node scripts/perf/load-capture.mjs [baseUrl] [--allow-remote]
// Needs the dev server (default http://localhost:5173) on the local stack. Auth headers are never stored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dateVars } from './load-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(ROOT, 'pmo-portal/package.json'))('@playwright/test');
const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) || 'http://localhost:5173';
if (!args.includes('--allow-remote') && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) {
  console.error(`refusing non-localhost target ${base}: this script types the seeded password into /login. Pass --allow-remote to override.`);
  process.exit(1);
}
const KEEP = ['accept', 'accept-profile', 'content-profile', 'content-type', 'prefer', 'range'];
const ROUTES = [
  { key: 'dashboard-exec', email: 'exec@acme.test', path: '/' },
  { key: 'dashboard-pm', email: 'pm@acme.test', path: '/' },
  { key: 'project', email: 'exec@acme.test', path: '/projects/:id' },
  { key: 'procurement', email: 'exec@acme.test', path: '/procurement' },
  { key: 'receivables', email: 'exec@acme.test', path: '/finance/receivables' },
];

// Stored calls carry placeholders, never the capturing user's ids or capture-time dates (public repo): load-run.mjs
// resolves {userId}/{orgId} per signed-in user and the date windows from today. A capture must fail on a leftover date.
const templatize = (s, ids) => {
  if (s === undefined) return s;
  for (const [id, ph] of ids) s = s.split(id).join(ph);
  for (const [k, d] of Object.entries(dateVars())) s = s.split(d).join(`{${k}}`);
  const left = s.match(/\d{4}-\d\d-\d\d/);
  if (left) throw new Error(`date ${left[0]} is not a known window: extend dateVars in load-run.mjs before capturing`);
  return s;
};

const browser = await chromium.launch({ headless: true });
const out = {};
const sessions = {};
for (const r of ROUTES) {
  const ctx = sessions[r.email] ??= await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (!sessions[`${r.email}:in`]) {
    await page.goto(`${base}/login`);
    await page.getByLabel(/email/i).fill(r.email);
    await page.getByLabel(/password/i).fill('Passw0rd!dev');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/$/, { timeout: 20000 });
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
  const ids = [[uid, '{userId}'], [oid, '{orgId}']].filter(([i]) => i);
  for (const c of raw) calls.push({ ...c, path: templatize(c.path, ids), body: templatize(c.body, ids) });
  out[r.key] = { email: r.email, route: r.path, calls };
  console.log(`${r.key}: ${calls.length} calls`);
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(ROOT, 'scripts/perf/load-routes.json'), JSON.stringify(out, null, 1) + '\n');
