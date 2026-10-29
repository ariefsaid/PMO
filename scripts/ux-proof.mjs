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
const routes = process.argv.slice(2);
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
const authFile = path.join(APP, 'e2e/.auth/exec@acme.test.json');
if (!fs.existsSync(detector)) throw new Error(`Vendored detector missing: ${detector}; run scripts/vendor-skills.sh.`);
if (!fs.existsSync(authFile)) throw new Error(`Auth storage state missing: ${authFile}; run the Playwright setup project first.`);

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
process.exitCode = failed ? 1 : 0;
