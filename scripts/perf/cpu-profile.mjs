#!/usr/bin/env node
// CPU profile of one page load at 4x CPU: long tasks (with the functions burning each), React commit count.
// Needs a production build WITH sourcemaps being served:
//   cd pmo-portal && npx vite build --mode lh --sourcemap --outDir /tmp/sm --emptyOutDir && npx vite preview --outDir /tmp/sm --port 4298
// usage: node scripts/perf/cpu-profile.mjs <baseUrl> <outDir> <email> <route>...   (needs the browser display awake: `caffeinate -u -d`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const req = createRequire(path.join(ROOT, 'pmo-portal/package.json'));
const { chromium } = req('@playwright/test');
const puppeteer = req('puppeteer-core');
const { TraceMap, originalPositionFor } = req('@jridgewell/trace-mapping');
const [base, outDir, email, ...routes] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const maps = new Map();
const mapFor = (url) => {
  if (!maps.has(url)) {
    const f = path.join(outDir, new URL(url).pathname + '.map');
    maps.set(url, fs.existsSync(f) ? new TraceMap(JSON.parse(fs.readFileSync(f, 'utf8'))) : null);
  }
  return maps.get(url);
};
// original "file:function" for a profile callFrame (0-based line/col -> 1-based line)
function label(cf) {
  const m = cf.url && mapFor(cf.url);
  if (!m) return `${cf.url ? path.basename(cf.url) : '(native)'}:${cf.functionName || '(anon)'}`;
  const o = originalPositionFor(m, { line: cf.lineNumber + 1, column: cf.columnNumber });
  const src = (o.source || '').replace(/^.*?pmo-portal\/node_modules\//, 'nm/').replace(/^.*?pmo-portal\//, '').replace(/^(\.\.\/)+/, '');
  return `${src || path.basename(cf.url)}:${o.line ?? ""}:${o.name || cf.functionName || "(anon)"}`;
}

const browser = await puppeteer.launch({ executablePath: chromium.executablePath(), headless: true, protocolTimeout: 600000 });
const hook = () => { // counts React commits without touching product code (React calls the DevTools hook if present)
  window.__commits = 0;
  window.__lt = [];
  window.__intl = { DateTimeFormat: [0, 0], NumberFormat: [0, 0], ListFormat: [0, 0], PluralRules: [0, 0] }; // [constructions, ms]
  for (const k of Object.keys(window.__intl)) {
    const Orig = Intl[k];
    Intl[k] = new Proxy(Orig, { construct(t, a, nt) { const s = performance.now(); const r = Reflect.construct(t, a, nt); window.__intl[k][0]++; window.__intl[k][1] += performance.now() - s; return r; } });
  }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1; }, onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true });
};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1350, height: 940 });
  await page.goto(`${base}/login`);
  await page.type('input[type=email], input[name=email]', email);
  await page.type('input[type=password]', 'Passw0rd!dev');
  await page.keyboard.press('Enter');
  for (const end = Date.now() + 30000; new URL(page.url()).pathname !== '/' && Date.now() < end; ) await sleep(100);
  await sleep(3000);
  await page.evaluateOnNewDocument(hook);
  const cdp = await page.createCDPSession();
  for (let route of routes) {
    if (route === '/projects/:id') {
      await page.goto(`${base}/projects`, { waitUntil: 'domcontentloaded' });
      let id = null;
      for (let i = 0; i < 200 && !id; i++) { id = await page.evaluate(() => document.querySelector('tbody tr[id]')?.id ?? null); if (!id) await sleep(100); }
      route = `/projects/${id}`;
    }
    await page.goto('about:blank');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Profiler.start');
    const t0 = Date.now();
    await page.goto(`${base}${route}`, { waitUntil: 'load' });
    await sleep(8000); // settle: queries resolve, charts render
    const { profile } = await cdp.send('Profiler.stop');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const commits = await page.evaluate(() => window.__commits);
    const lts = await page.evaluate(() => window.__lt);
    const intl = await page.evaluate(() => window.__intl);
    // self time per sample (microseconds -> ms), keyed by label
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    // a task = a run of consecutive non-idle samples; real long tasks at 4x are the runs over 50ms
    const runs = [];
    let cur = null;
    profile.samples.forEach((id, i) => {
      const n = byId.get(id);
      const l = label(n.callFrame);
      const dt = profile.timeDeltas[i] / 1000;
      if (n.callFrame.functionName === '(idle)') { cur = null; return; }
      if (!cur) runs.push((cur = { ms: 0, fns: new Map() }));
      cur.ms += dt;
      cur.fns.set(l, (cur.fns.get(l) || 0) + dt);
      if (n.callFrame.functionName !== '(program)') self.set(l, (self.get(l) || 0) + dt);
    });
    const sum = [...self.values()].reduce((a, b) => a + b, 0);
    console.log(`\n## ${route}  (4x CPU) wall ${Date.now() - t0}ms, React commits ${commits}, long tasks ${lts.length}, sum long-task ms ${lts.reduce((a, [, d]) => a + d, 0).toFixed(0)}, TBT-ish ${lts.reduce((a, [, d]) => a + Math.max(0, d - 50), 0).toFixed(0)}ms, JS self ${sum.toFixed(0)}ms`);
    console.log('Intl constructions [count, ms at 4x]:', JSON.stringify(Object.fromEntries(Object.entries(intl).map(([k, [n, ms]]) => [k, [n, Math.round(ms)]]))));
    console.log('long tasks (ms):', lts.map(([s, d]) => `${d.toFixed(0)}@${s.toFixed(0)}`).join(' '));
    console.log('main-thread tasks over 50ms, with the functions burning each (ms self):');
    for (const r of runs.filter((r) => r.ms > 50).sort((a, b) => b.ms - a.ms).slice(0, 8)) console.log(`  ${r.ms.toFixed(0)}ms: ` + [...r.fns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' | '));
    console.log('top self-time functions:');
    for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v.toFixed(0).padStart(5)}ms  ${k}`);
    // by package/source directory
    const pkg = new Map();
    for (const [k, v] of self) { const s = k.split(':')[0]; const p = s.startsWith('nm/') ? s.split('/').slice(0, s.split('/')[1]?.startsWith('@') ? 3 : 2).join('/') : s.split('/').slice(0, 2).join('/'); pkg.set(p, (pkg.get(p) || 0) + v); }
    console.log('self-time by package/dir:');
    for (const [k, v] of [...pkg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${v.toFixed(0).padStart(5)}ms  ${k}`);
  }
} finally {
  await browser.close();
}
