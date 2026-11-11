#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { CHART_SELECTOR, measureText, violations } from './ux-proof-metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'pmo-portal');
const require = createRequire(path.join(APP, 'package.json'));
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
async function launchBrowser() {
  const systemChrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => fs.existsSync(candidate));
  return chromium.launch({ headless: true, ...(systemChrome ? { executablePath: systemChrome } : {}) });
}
async function selfTest() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    const cases = [
      { html: '<main><span style="font-size:11px">tiny text</span></main>', baseline: 2, expected: 'minFontPx' },
      { html: '<main><span style="font-size:13px">small text</span><span style="font-size:16px">normal text</span></main>', baseline: 4, expected: 'pctCharsUnder14' },
      { html: '<main style="font-size:16px">one two three four five six</main>', baseline: 5, expected: 'wordCount' },
      { html: '<main style="font-size:16px">one two three four five</main>', baseline: 5, expected: null },
    ];
    for (const fixture of cases) {
      await page.setContent(fixture.html);
      const result = violations(await page.evaluate(measureText, CHART_SELECTOR), fixture.baseline, 'fixture @390');
      if (fixture.expected ? !result.some((failure) => failure.includes(fixture.expected)) : result.length) throw new Error(`Self-test failed: expected ${fixture.expected || 'pass'}, got ${result.join('; ')}`);
    }
    await page.setContent('<main><span>page words</span><span class="sr-only">accessible duplicate</span><svg class="recharts-surface" width="10" height="10"><text>chart labels</text></svg></main>');
    const chartMetrics = await page.evaluate(measureText, CHART_SELECTOR);
    if (chartMetrics.wordCount !== 2 || chartMetrics.chartCount !== 1) throw new Error(`Self-test failed: chart labels should count as a chart, not page copy (${JSON.stringify(chartMetrics)})`);
    // The phone card branch marks each record; a menu of 2 records and one of 20 must read the
    // same, and a single record card must not leak into chrome either.
    const recordCard = (index) => `<li data-record-row=""><span>Record ${index} detail here</span></li>`;
    const recordList = (count, chrome = '') => `<main style="font-size:16px"><h1>Receivables</h1>${chrome}<ul role="list">${Array.from({ length: count }, (_, index) => recordCard(index + 1)).join('')}</ul></main>`;
    await page.setContent(recordList(2));
    const twoCards = await page.evaluate(measureText, CHART_SELECTOR);
    await page.setContent(recordList(20));
    const twentyCards = await page.evaluate(measureText, CHART_SELECTOR);
    await page.setContent(recordList(1));
    const oneCard = await page.evaluate(measureText, CHART_SELECTOR);
    await page.setContent(recordList(20, '<h2>Extra heading</h2>'));
    const moreChrome = await page.evaluate(measureText, CHART_SELECTOR);
    if (oneCard.wordCount !== twoCards.wordCount || twentyCards.wordCount !== twoCards.wordCount) throw new Error(`Self-test failed: record cards moved the word count (${oneCard.wordCount}/${twoCards.wordCount}/${twentyCards.wordCount})`);
    if (moreChrome.wordCount !== twoCards.wordCount + 2) throw new Error(`Self-test failed: chrome next to record cards must still count (${twoCards.wordCount} -> ${moreChrome.wordCount})`);
    await page.setContent('<main><span>visible copy</span><input style="font-size:15px"><button style="height:43px">Action</button></main>');
    const controlMetrics = await page.evaluate(measureText, CHART_SELECTOR);
    const controlFailures = violations(controlMetrics, undefined, 'fixture @390', undefined, 0);
    if (controlMetrics.smallInputCount !== 1 || !controlFailures.some((failure) => failure.includes('smallInputCount=1')) || !controlFailures.some((failure) => failure.includes('smallTargetCount=1'))) {
      throw new Error(`Self-test failed: phone inputs and action targets should be measured (${JSON.stringify({ controlMetrics, controlFailures })})`);
    }
    await page.setContent('<main style="min-width:500px"><span>wide copy</span></main>');
    const overflowMetrics = await page.evaluate(measureText, CHART_SELECTOR);
    if (!overflowMetrics.horizontalOverflow || !violations(overflowMetrics, undefined, 'fixture @390').some((failure) => failure.includes('horizontalOverflow'))) {
      throw new Error(`Self-test failed: document overflow should fail (${JSON.stringify(overflowMetrics)})`);
    }
    console.log('ux-proof self-test passed');
  } finally { await browser.close(); }
}
// Measure a static HTML fixture with the shipped measureText — the shape proofs in
// scripts/ux-proof.test.mjs (extra rows must not move the count; an extra heading must).
async function measureHtml(file) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify(await page.evaluate(measureText, CHART_SELECTOR)));
  } finally { await browser.close(); }
}
if (process.argv.includes('--self-test')) { await selfTest(); process.exit(0); }
if (process.argv.includes('--measure-html')) { await measureHtml(process.argv[process.argv.indexOf('--measure-html') + 1]); process.exit(0); }
const updateBudget = process.argv.includes('--update-word-budget');
const routes = process.argv.slice(2).filter((arg) => arg !== '--update-word-budget');
if (!routes.length || routes.some((route) => !route.startsWith('/'))) {
  console.error('usage: scripts/ux-proof.sh /route [/route ...]');
  process.exit(2);
}
const widths = process.env.UX_PROOF_WIDTHS
  ? process.env.UX_PROOF_WIDTHS.split(',').map((value) => Number(value.trim()))
  : [390, 1440];
if (!widths.length || widths.some((width) => !Number.isInteger(width) || width < 320)) {
  throw new Error('UX_PROOF_WIDTHS must be a comma-separated list of integer viewport widths >= 320.');
}

const base = (process.env.SHOT_BASE || 'http://localhost:5173').replace(/\/$/, '');
const area = (process.env.AREA || 'misc').replace(/[^a-zA-Z0-9_-]/g, '-');
const output = path.join(ROOT, 'docs/private/ux-shots', area);
const detector = path.join(ROOT, '.claude/skills/impeccable/scripts/impeccable');
const authFile = process.env.UX_PROOF_AUTH
  ? path.join(APP, 'e2e/.auth', process.env.UX_PROOF_AUTH)
  : path.join(APP, 'e2e/.auth/exec@acme.test.json');
if (!fs.existsSync(detector)) throw new Error(`Vendored detector missing: ${detector}; run scripts/vendor-skills.sh.`);
if (!fs.existsSync(authFile)) throw new Error(`Auth storage state missing: ${authFile}; run the Playwright setup project first.`);

const budgetPath = path.join(ROOT, 'docs/ux/word-budget.json');
const budget = fs.existsSync(budgetPath) ? JSON.parse(fs.readFileSync(budgetPath, 'utf8')) : {};
budget.targets ||= {};
const login = path.basename(authFile).replace(/\.json$/, '');
const measurements = [];

const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
const localStorage = (auth.origins || []).flatMap((origin) => origin.localStorage || []);
if (!localStorage.length) throw new Error(`No localStorage session found in ${authFile}`);
fs.mkdirSync(output, { recursive: true });

const slug = (route) => route.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'root';
const countDetectorFindings = (value) => {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value.findings)) return value.findings.length;
  if (Array.isArray(value.results)) return value.results.reduce((sum, item) => sum + countDetectorFindings(item), 0);
  return Object.entries(value).reduce((sum, [key, item]) => sum + (key === 'advisories' ? 0 : countDetectorFindings(item)), 0);
};

let failed = false;
console.log('route | width | charts | min px | chars <14% | font sizes | inputs <16 | targets <44 | overflow | words');
const cdpServer = net.createServer();
await new Promise((resolve, reject) => cdpServer.listen(0, '127.0.0.1', resolve).once('error', reject));
const cdpPort = cdpServer.address().port;
await new Promise((resolve, reject) => cdpServer.close((error) => error ? reject(error) : resolve()));
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${cdpPort}`] });
try {
  for (const route of routes) {
    let detectorCount = 0;
    let seriousAxe = 0;
    for (const width of widths) {
      const height = width === 390 ? 844 : 900;
      for (const theme of ['light', 'dark']) {
        const stem = `${slug(route)}-${width}-${theme}`;
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
        const page = await context.newPage();
        await page.addInitScript((nextTheme) => {
          localStorage.setItem('theme', nextTheme);
        }, theme);
        await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((items) => {
          for (const { name, value } of items) localStorage.setItem(name, value);
        }, localStorage);
        await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        await page.locator('main').or(page.locator('h1')).first().waitFor({ state: 'visible', timeout: 10_000 });
        await page.mouse.move(0, 0);
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await page.screenshot({ path: path.join(output, `${stem}.png`), fullPage: true });
        if (theme === 'light') {
          const metrics = await page.evaluate(measureText, CHART_SELECTOR);
          const key = `${route}@${width}@${login}`;
          measurements.push({ route, width, login, ...metrics });
          console.log(`${route} | ${width} | ${metrics.chartCount} | ${metrics.minFontPx} | ${metrics.pctCharsUnder14.toFixed(2)} | ${metrics.distinctFontSizes.join(', ')} | ${metrics.smallInputCount} | ${metrics.smallTargetCount} | ${metrics.horizontalOverflow} | ${metrics.wordCount}`);
          const oldTargetBaseline = budget.targets[key];
          const targetBaseline = updateBudget && oldTargetBaseline === undefined ? metrics.smallTargetCount : oldTargetBaseline;
          const errors = violations(metrics, budget[key], `${route} @${width}`, budget.charts?.[key], targetBaseline);
          if (!updateBudget && targetBaseline === undefined) errors.push(`${route} @${width}: missing shrink-only target baseline; run the measured seed after fixes.`);
          for (const error of errors) console.error(error);
          if (errors.length) failed = true;
          if (updateBudget) {
            budget[key] = Math.min(budget[key] ?? metrics.wordCount, metrics.wordCount);
            if (!errors.some((error) => /smallInputCount|horizontalOverflow/.test(error))) {
              budget.targets[key] = Math.min(oldTargetBaseline ?? metrics.smallTargetCount, metrics.smallTargetCount);
            }
          }
        }

        const detect = spawnSync(detector, ['detect', '--cdp', `${cdpPort}`, '--target', page.url(), '--json', '--no-advisory'], {
          cwd: ROOT, encoding: 'utf8', timeout: 120_000,
        });
        if (detect.error) throw detect.error;
        let detectorJson;
        try { detectorJson = JSON.parse(detect.stdout); }
        catch { throw new Error(`Impeccable returned invalid JSON for ${route} @${width}: ${detect.stderr || detect.stdout}`); }
        fs.writeFileSync(path.join(output, `${stem}.detector.json`), `${JSON.stringify(detectorJson, null, 2)}\n`);
        const currentDetectorFindings = countDetectorFindings(detectorJson);
        detectorCount += currentDetectorFindings;
        if (detect.status !== 0 || currentDetectorFindings > 0) failed = true;

        const axeJson = await new AxeBuilder({ page }).analyze();
        fs.writeFileSync(path.join(output, `${stem}.axe.json`), `${JSON.stringify(axeJson, null, 2)}\n`);
        const serious = axeJson.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
        seriousAxe += serious.length;
        if (serious.length) failed = true;
        await context.close();
      }
    }
    console.log(`${route}: impeccable findings=${detectorCount}; axe serious/critical=${seriousAxe}`);
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(output, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
if (updateBudget) {
  fs.mkdirSync(path.dirname(budgetPath), { recursive: true });
  fs.writeFileSync(budgetPath, `${JSON.stringify(budget, null, 2)}\n`);
}
process.exitCode = failed ? 1 : 0;
