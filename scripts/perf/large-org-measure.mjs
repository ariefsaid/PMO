#!/usr/bin/env node
// Large-organisation list + picker timing (#2480). LOCAL ONLY: it drives the seeded local stack
// (scripts/perf/large-org-seed.sql) through a real browser and prints how long each whole-set read
// takes to put rows/options on screen, plus the API requests and response bytes behind it.
//
//   scripts/with-db-lock.sh node scripts/perf/large-org-measure.mjs [baseUrl]
//
// Requires a dev/preview server already running (default http://localhost:5173) with .env.local
// pointing at the local stack, and a DB reset + large-org seed applied. Refuses a non-localhost base
// unless --allow-remote is passed (a large-org payload against a cloud project would be a real read).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(ROOT, 'pmo-portal/package.json'))('@playwright/test');

const args = process.argv.slice(2);
const allowRemote = args.includes('--allow-remote');
const base = (args.find((a) => a.startsWith('http')) ?? process.env.SHOT_BASE ?? 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.PERF_USER || 'exec@acme.test';
if (!allowRemote && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u.test(base)) {
  console.error(`refusing non-local base ${base} (pass --allow-remote if this is a disposable stack)`);
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${base}/login`);
await page.getByLabel(/email/i).fill(email);
await page.getByLabel(/password/i).fill('Passw0rd!dev');
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL(/\/$/, { timeout: 20000 });

/** Navigate and time from the request to the first painted row/option on that route. */
async function timeRoute(label, route, waitFor, count) {
  const rows = [];
  const onResp = async (resp) => {
    const u = resp.url();
    if (!u.includes(':54321')) return;
    const body = await resp.body().catch(() => Buffer.alloc(0));
    rows.push({ url: u.replace(/^.*:54321/u, ''), bytes: body.length });
  };
  page.on('response', onResp);
  const t0 = Date.now();
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
  if (typeof waitFor === 'string') await page.waitForSelector(waitFor, { timeout: 120000 });
  else await waitFor();
  const readyMs = Date.now() - t0;
  // Let every follow-on batch (money / delivery / task reads) land; "quick and complete" means the
  // screen is settled, not merely that the first row painted.
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1000);
  page.off('response', onResp);
  const settledMs = Date.now() - t0;
  const n = count ? await count() : null;
  const bytes = rows.reduce((s, r) => s + r.bytes, 0);
  const tally = {};
  for (const r of rows) {
    const k = r.url.split('?')[0];
    tally[k] = (tally[k] || 0) + 1;
  }
  console.log(`\n## ${label}  ${route}`);
  console.log(`  first-content ${readyMs} ms · settled ${settledMs} ms · api requests ${rows.length} · api bytes ${bytes}${n == null ? '' : ` · ${n.label} ${n.value}`}`);
  console.log('  by endpoint:', JSON.stringify(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8)));
  return { readyMs, settledMs, requests: rows.length, bytes, count: n?.value ?? null };
}

const list = await timeRoute(
  'Projects list (whole active set, 1,000-row guard)',
  '/projects',
  'tbody tr[id]',
  () => page.evaluate(() => ({ label: 'rendered rows', value: globalThis.document.querySelectorAll('tbody tr[id]').length })),
);

const picker = await timeRoute(
  'Project picker (/meetings/new)',
  '/meetings/new',
  () => page.waitForFunction(
    () => (globalThis.document.querySelector('select')?.options.length ?? 0) > 1,
    undefined,
    { timeout: 120000 },
  ),
  () => page.evaluate(() => {
    // The meeting form's only select is its project picker; options land after the whole-set read.
    const select = globalThis.document.querySelector('select');
    return { label: 'picker options', value: select ? select.options.length : 0 };
  }),
);

await browser.close();
console.log(`\nSUMMARY ${JSON.stringify({ list, picker })}`);
