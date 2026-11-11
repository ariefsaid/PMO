#!/usr/bin/env node
// Per-route request count + response bytes against the local stack, and (with --lh) Lighthouse perf
// score under 4x CPU throttle. usage: node scripts/perf/measure.mjs [--lh] /route [/route ...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(ROOT, 'pmo-portal/package.json'))('@playwright/test');
const args = process.argv.slice(2);
const lh = args.includes('--lh');
const routes = args.filter((a) => a.startsWith('/'));
const base = process.env.SHOT_BASE || 'http://localhost:5173';
const email = process.env.PERF_USER || 'exec@acme.test';

const srv = net.createServer();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
await new Promise((r) => srv.close(r));
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.getByLabel(/email/i).fill(email);
await page.getByLabel(/password/i).fill('Passw0rd!dev');
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL(/\/$/, { timeout: 20000 });

for (const route of routes) {
  const rows = [];
  const onResp = async (resp) => {
    const u = resp.url();
    if (!u.includes(':54321')) return;
    const body = await resp.body().catch(() => Buffer.alloc(0));
    rows.push({ m: resp.request().method(), u: u.replace(/^.*:54321/, ''), b: body.length });
  };
  page.on('response', onResp);
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  page.off('response', onResp);
  const bytes = rows.reduce((s, r) => s + r.b, 0);
  const tally = {};
  for (const r of rows) { const k = r.u.split('?')[0]; tally[k] = (tally[k] || 0) + 1; }
  console.log(`\n## ${route}  requests=${rows.length} bytes=${bytes}`);
  if (process.env.PERF_VERBOSE) for (const r of rows) console.log(`  ${r.m} ${r.b}B ${r.u.slice(0, 160)}`);
  console.log('  by endpoint:', JSON.stringify(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8)));
  if (lh) {
    await page.goto('about:blank'); // lighthouse drives this tab; the session lives in the shared context
    const out = spawnSync('npx', ['-y', 'lighthouse', `${base}${route}`, `--port=${port}`, '--only-categories=performance',
      '--throttling.cpuSlowdownMultiplier=4', '--disable-storage-reset', '--output=json', '--quiet'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    try {
      const j = JSON.parse(out.stdout);
      const a = j.audits;
      console.log(`  lighthouse perf=${Math.round(j.categories.performance.score * 100)} LCP=${a['largest-contentful-paint'].displayValue} TBT=${a['total-blocking-time'].displayValue} CLS=${a['cumulative-layout-shift'].displayValue}`);
    } catch { console.log('  lighthouse failed', (out.stderr || '').slice(0, 400)); }
  }
}
await browser.close();
