#!/usr/bin/env node
// Region timing: hold matching requests for N ms, then report when each data-testid region first holds
// non-loading content. usage: node scripts/perf/region-timing.mjs --route /path --delay '<substr>=<ms>' --region <testId>...
// Local stack only (same login as measure.mjs: SHOT_BASE, PERF_USER).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export function parseDelay(s) {
  const i = s.lastIndexOf('=');
  const ms = Number(s.slice(i + 1));
  if (i <= 0 || !Number.isFinite(ms) || ms < 0 || s.slice(i + 1).trim() === '') throw new Error(`bad --delay "${s}" (want <url substring>=<ms>)`);
  return { match: s.slice(0, i), ms };
}

export function parseArgs(argv) {
  const o = { route: null, delays: [], regions: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--route') o.route = argv[++i];
    else if (a === '--delay') o.delays.push(parseDelay(argv[++i] ?? ''));
    else if (a === '--region') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o.regions.push(argv[++i]);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!o.route) throw new Error('--route is required');
  if (!o.route.startsWith('/')) throw new Error('--route must start with /');
  if (!o.regions.length) throw new Error('at least one --region is required');
  return o;
}

export function formatTable({ route, delayMs, delayed, rows }) {
  const out = [`**${route}** — delayed read: \`${delayed}\` held ${delayMs} ms`, '',
    '| region | ms to content | beat the delayed read |', '|---|---|---|'];
  for (const r of rows) {
    if (r.hook === false) out.push(`| ${r.region} | no hook | n/a |`);
    else if (r.ms == null) out.push(`| ${r.region} | never | no |`);
    else out.push(`| ${r.region} | ${Math.round(r.ms)} | ${r.ms < delayMs ? 'yes' : 'no'} |`);
  }
  return out.join('\n');
}

async function main() {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const { chromium } = createRequire(path.join(ROOT, 'pmo-portal/package.json'))('@playwright/test');
  const o = parseArgs(process.argv.slice(2));
  const base = process.env.SHOT_BASE || 'http://localhost:5173';
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) throw new Error('local stack only');
  const email = process.env.PERF_USER || 'exec@acme.test';
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill('Passw0rd!dev');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/$/, { timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  for (const d of o.delays) {
    await page.route((u) => u.port === '54321' && u.href.includes(d.match), async (route) => {
      await new Promise((r) => setTimeout(r, d.ms));
      await route.continue().catch(() => {});
    });
  }
  const delayMs = Math.max(0, ...o.delays.map((d) => d.ms));
  const limit = delayMs + 5000;
  const start = Date.now();
  await page.goto(`${base}${o.route}`, { waitUntil: 'commit' });
  const rows = [];
  const hooks = {};
  await Promise.all(o.regions.map(async (region) => {
    const sel = `[data-testid="${region}"]`;
    const ready = `${sel}:not([aria-busy="true"]):not(:has([aria-busy="true"])):not(:has([data-testid$="-loading"]))`;
    try {
      await page.waitForSelector(ready, { state: 'attached', timeout: limit });
      rows.push({ region, ms: Date.now() - start, hook: true });
    } catch {
      hooks[region] = (await page.locator(sel).count()) > 0;
      rows.push({ region, ms: null, hook: hooks[region] });
    }
  }));
  rows.sort((a, b) => o.regions.indexOf(a.region) - o.regions.indexOf(b.region));
  console.log(formatTable({ route: o.route, delayMs, delayed: o.delays.map((d) => d.match).join(', ') || 'none', rows }));
  await browser.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
