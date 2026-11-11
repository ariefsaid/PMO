#!/usr/bin/env node
// Lighthouse user flow: signs in through the real /login form, then one navigation step per page.
// Desktop, 4x CPU. Run against a PRODUCTION build (npm run build && npm run preview -- --port 4199).
// usage: node scripts/perf/lighthouse-flow.mjs [baseUrl] [--allow-remote]   (default http://localhost:4199)
// Types the seeded password into the login form, so non-localhost targets are refused without --allow-remote.
// Reads chunk sizes from pmo-portal/dist (default outDir).
// Prints a markdown table.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const req = createRequire(path.join(ROOT, 'pmo-portal/package.json'));
const { chromium } = req('@playwright/test');
const puppeteer = req('puppeteer-core');
const { startFlow } = await import(req.resolve('lighthouse'));
const desktop = (await import(req.resolve('lighthouse/core/config/desktop-config.js'))).default;

const args = process.argv.slice(2);
const allowRemote = args.includes('--allow-remote');
const base = args.find((a) => !a.startsWith('--')) || 'http://localhost:4199';
if (!allowRemote && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) {
  console.error(`refusing non-localhost target ${base}: this script types the seeded password into /login. Pass --allow-remote to override.`);
  process.exit(1);
}
const password = 'Passw0rd!dev'; // seeded local-only password, same as e2e/helpers.ts SEED_PASSWORD
const ROLES = [
  { role: 'Executive', email: 'exec@acme.test', pages: ['/', '/projects/:id', '/procurement', '/finance/receivables'] },
  { role: 'Project Manager', email: 'pm@acme.test', pages: ['/'] },
];

// poll page.url() from node: page.waitForFunction hung on the signed-in app although location was already '/'
async function waitForPath(page, ok, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (ok(new URL(page.url()).pathname)) return;
  throw new Error(`timed out waiting for path, at ${page.url()}`);
}

const config = { ...desktop, settings: { ...desktop.settings, onlyCategories: ['performance'], throttling: { ...desktop.settings.throttling, cpuSlowdownMultiplier: 4 } } };
const RUNS = Number(process.env.LH_RUNS || 3); // scores swing 5-10 points run to run; report the median-score run
const all = [];

for (let run = 0; run < RUNS; run++) {
const rows = [];
for (const { role, email, pages } of ROLES) {
  const browser = await puppeteer.launch({ executablePath: chromium.executablePath(), headless: true, protocolTimeout: 600000 });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1350, height: 940 });
    page.on('dialog', (d) => { console.error(`dialog ${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
    await page.goto(`${base}/login`);
    await page.type('input[type=email], input[name=email]', email);
    await page.type('input[type=password]', password);
    await page.keyboard.press('Enter');
    await waitForPath(page, (p) => p === '/');

    const resolved = pages.slice();
    const pi = pages.indexOf('/projects/:id');
    if (pi >= 0) {
      await page.goto(`${base}/projects`, { waitUntil: 'domcontentloaded' });
      // first project row's id (rows have no anchor; a handle click on the row hung)
      let href = null;
      for (let i = 0; i < 200 && !href; i++) {
        href = await page.evaluate(() => (() => { const id = document.querySelector('tbody tr[id]')?.id; return id ? `/projects/${id}` : null; })());
        if (!href) await new Promise((r) => setTimeout(r, 100));
      }
      if (!href) throw new Error('no project row on /projects');
      await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded' });
      resolved[pi] = new URL(page.url()).pathname;
    }
    const flow = await startFlow(page, { config, flags: { disableStorageReset: true } });
    const names = [];
    for (const route of resolved) {
      names.push(route);
      console.error(new Date().toISOString(), role, 'navigate', route);
      await flow.navigate(`${base}${route}`, { name: route });
    }
    const flowResult = await flow.createFlowResult();
    if (process.env.LH_ARTIFACTS) { // raw traces + devtools logs per step, for long-task attribution
      fs.mkdirSync(process.env.LH_ARTIFACTS, { recursive: true });
      fs.writeFileSync(path.join(process.env.LH_ARTIFACTS, `run${run}-${role.replace(/ /g, '')}.json`), JSON.stringify({ artifacts: await flow.createArtifactsJson(), flowResult }));
    }
    flowResult.steps.forEach((s, i) => {
      const a = s.lhr.audits;
      // gzip size of each script the page requested, from the build output (the preview server does not compress)
      const gz = (a['network-requests'].details?.items ?? []).filter((r) => r.resourceType === 'Script').map((r) => {
        const f = path.join(ROOT, 'pmo-portal/dist', new URL(r.url).pathname);
        return { name: path.basename(f), kb: fs.existsSync(f) ? zlib.gzipSync(fs.readFileSync(f)).length / 1024 : 0 };
      }).sort((x, y) => y.kb - x.kb);
      const big = gz[0];
      rows.push({
        route: pages[i] === '/projects/:id' ? '/projects/:id' : names[i], role,
        lcp: a['largest-contentful-paint'].displayValue, tbt: a['total-blocking-time'].displayValue,
        cls: a['cumulative-layout-shift'].displayValue, score: Math.round(s.lhr.categories.performance.score * 100),
        chunk: big ? `${big.name} ${big.kb.toFixed(1)} kB gzip` : 'n/a',
        lcpEl: JSON.stringify(a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? a['largest-contentful-paint-element']?.displayValue ?? '').slice(0, 90),
        top: (a['bootup-time']?.details?.items ?? []).slice(0, 3).map((i) => `${path.basename(i.url || '')}:${Math.round(i.scripting)}ms script/${Math.round(i.total)}ms`).join(', '),
        long: (a['long-tasks']?.details?.items ?? []).length, unused: a['unused-javascript']?.displayValue ?? '',
        shift: (a['layout-shifts']?.details?.items ?? []).slice(0, 1).map((i) => (i.node?.snippet ?? '').slice(0, 70)).join(''),
        boot: a['bootup-time']?.displayValue ?? '',
      });
    });
  } finally {
    await browser.close();
  }
}

all.push(rows);
}
const rows = all[0].map((_, i) => all.map((r) => r[i]).sort((x, y) => x.score - y.score)[Math.floor(RUNS / 2)]);

console.log('| Page | Role | LCP | TBT | CLS | Score | Largest JS chunk (gzip) |\n|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| \`${r.route}\` | ${r.role} | ${r.lcp} | ${r.tbt} | ${r.cls} | ${r.score} | ${r.chunk} |`);
console.log('\ndiagnostics:');
for (const r of rows) console.log(`${r.role} ${r.route}: lcpEl=${r.lcpEl} longTasks=${r.long} bootup=${r.boot} unusedJS=${r.unused} top=${r.top} shift=${r.shift}`);
