#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'pmo-portal');
const require = createRequire(path.join(APP, 'package.json'));
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
// Runs in the page: measure only text with painted, non-hidden ancestors.
// `wordCount` counts CHROME only: a screen's own words (headings, labels, captions, help), never
// record data. Sample data grows as people work (rows, claims, review records), so counting it made
// unchanged screens drift over budget. Font-size metrics still cover every painted word, data
// included — a too-small cell is a real a11y finding.
function measureText() {
  const main = document.querySelector('main');
  if (!main) throw new Error('No main element to measure');
  // A text node is data when any ancestor is a row repeated beyond the first of its collection.
  // Three row shapes exist in this app: <tbody> rows, ARIA rows (role=row/listitem), and card
  // layouts that repeat an identically-shaped div/button per record (approvals queue, the 390
  // timesheet grid). The last one is caught by shape (tag + class) because it carries no list
  // semantics — without it the gate would still count record data as chrome.
  const shape = (element) => `${element.tagName}|${element.getAttribute('class') || ''}`;
  const isDataRow = (element) => {
    for (let node = element; node && node !== main; node = node.parentElement) {
      const tag = node.tagName;
      const role = node.getAttribute('role');
      if (tag === 'TBODY') return true;
      if (role === 'rowgroup' && !node.querySelector('[role="columnheader"], th')) return true;
      if (tag === 'LI' || role === 'listitem' || tag === 'TR' || role === 'row') {
        const list = node.parentElement?.closest('ul, ol, menu, [role="list"], [role="listbox"], table, thead, [role="table"], [role="grid"], [role="rowgroup"]');
        if (list) {
          const items = [...list.children].filter((child) => child.tagName === tag && child.getAttribute('role') === role);
          if (items.length > 1 && items[0] !== node) return true;
        }
      }
      const siblings = node.parentElement ? [...node.parentElement.children].filter((child) => shape(child) === shape(node)) : [];
      if (siblings.length > 2 && siblings[0] !== node) return true;
    }
    return false;
  };
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const sizes = {}; const samples = {}; let words = 0; let total = 0; let small = 0;
  for (let node; (node = walker.nextNode());) {
    const text = node.textContent.trim();
    if (!text) continue;
    const element = node.parentElement;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || !element.getClientRects().length || Number(style.opacity) === 0) continue;
    let hidden = false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const computed = getComputedStyle(parent);
      if (computed.display === 'none' || Number(computed.opacity) === 0 || computed.contentVisibility === 'hidden') { hidden = true; break; }
    }
    if (hidden) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    if (![...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)) continue;
    const size = parseFloat(style.fontSize);
    sizes[size] = (sizes[size] || 0) + text.length;
    total += text.length;
    if (!isDataRow(element)) words += text.split(/\s+/u).length;
    if (size < 14) { small += text.length; (samples[size] ||= []).length < 5 && samples[size].push(text.slice(0, 40)); }
  }
  const distinctFontSizes = Object.keys(sizes).map(Number).sort((a, b) => a - b);
  if (!total) throw new Error('No visible text in main');
  return { minFontPx: distinctFontSizes[0], pctCharsUnder14: small * 100 / total, distinctFontSizes, wordCount: words, smallTextSamples: samples };
}
function violations(metrics, baseline, label) {
  const failures = [];
  const samples = JSON.stringify(metrics.smallTextSamples);
  if (metrics.minFontPx < 12) failures.push(`${label}: minFontPx=${metrics.minFontPx} (<12); samples=${samples}`);
  if (metrics.pctCharsUnder14 > 15) failures.push(`${label}: pctCharsUnder14=${metrics.pctCharsUnder14.toFixed(2)} (>15); samples=${samples}`);
  if (baseline !== undefined && metrics.wordCount > baseline * 1.05) failures.push(`${label}: wordCount=${metrics.wordCount} (>105% of ${baseline}); samples=${samples}`);
  return failures;
}
async function launchBrowser() {
  const systemChrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => fs.existsSync(candidate));
  return chromium.launch({ headless: true, ...(systemChrome ? { executablePath: systemChrome } : {}) });
}
async function selfTest() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const cases = [
      { html: '<main><span style="font-size:11px">tiny text</span></main>', baseline: 2, expected: 'minFontPx' },
      { html: '<main><span style="font-size:13px">small text</span><span style="font-size:16px">normal text</span></main>', baseline: 4, expected: 'pctCharsUnder14' },
      { html: '<main style="font-size:16px">one two three four five six</main>', baseline: 5, expected: 'wordCount' },
      { html: '<main style="font-size:16px">one two three four five</main>', baseline: 5, expected: null },
    ];
    for (const fixture of cases) {
      await page.setContent(fixture.html);
      const result = violations(await page.evaluate(measureText), fixture.baseline, 'fixture @390');
      if (fixture.expected ? !result.some((failure) => failure.includes(fixture.expected)) : result.length) throw new Error(`Self-test failed: expected ${fixture.expected || 'pass'}, got ${result.join('; ')}`);
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
    console.log(JSON.stringify(await page.evaluate(measureText)));
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
console.log('route | width | min px | chars <14% | font sizes | words');
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
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await page.screenshot({ path: path.join(output, `${stem}.png`), fullPage: true });
        if (theme === 'light') {
          const metrics = await page.evaluate(measureText);
          const key = `${route}@${width}@${login}`;
          measurements.push({ route, width, login, ...metrics });
          console.log(`${route} | ${width} | ${metrics.minFontPx} | ${metrics.pctCharsUnder14.toFixed(2)} | ${metrics.distinctFontSizes.join(', ')} | ${metrics.wordCount}`);
          const errors = violations(metrics, updateBudget ? undefined : budget[key], `${route} @${width}`);
          for (const error of errors) console.error(error);
          if (errors.length) failed = true;
          if (updateBudget || budget[key] === undefined) budget[key] = metrics.wordCount;
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
fs.mkdirSync(path.dirname(budgetPath), { recursive: true });
fs.writeFileSync(budgetPath, `${JSON.stringify(budget, null, 2)}\n`);
process.exitCode = failed ? 1 : 0;
