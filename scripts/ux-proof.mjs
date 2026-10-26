#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { screenshotMainContent } from './ux-scroll-capture.mjs';

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

const base = (process.env.SHOT_BASE || 'http://localhost:5173').replace(/\/$/, '');
const area = (process.env.AREA || 'misc').replace(/[^a-zA-Z0-9_-]/g, '-');
const role = process.env.UX_ROLE || 'exec';
if (!['exec', 'finance', 'pm', 'engineer'].includes(role)) throw new Error(`Unsupported UX_ROLE: ${role}`);
const output = path.join(ROOT, 'docs/private/ux-shots', area, role);
const detector = path.join(ROOT, '.claude/skills/impeccable/scripts/impeccable');
const authFile = path.join(APP, 'e2e/.auth', `${role}@acme.test.json`);
const reviewedHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
if (!fs.existsSync(detector)) throw new Error(`Vendored detector missing: ${detector}; run scripts/vendor-skills.sh.`);
if (!fs.existsSync(authFile)) throw new Error(`Auth storage state missing: ${authFile}; run the Playwright setup project first.`);

const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
const localStorage = (auth.origins || []).flatMap((origin) => origin.localStorage || []);
if (!localStorage.length) throw new Error(`No localStorage session found in ${authFile}`);
fs.mkdirSync(output, { recursive: true });

const slug = (route) => route.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'root';
const countDetectorFindings = (value) => {
  const advisory = (item) => item?.advisory === true || item?.isAdvisory === true
    || item?.severity === 'advisory' || item?.category === 'advisory';
  if (Array.isArray(value)) return value.filter((item) => !advisory(item)).length;
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((sum, [key, item]) => sum + (key === 'advisories' ? 0 : countDetectorFindings(item)), 0);
};
const countDetectorAdvisories = (value) => {
  const advisory = (item) => item?.advisory === true || item?.isAdvisory === true
    || item?.severity === 'advisory' || item?.category === 'advisory';
  if (Array.isArray(value)) return value.filter(advisory).length;
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((sum, [key, item]) => sum + (
    key === 'advisories' && Array.isArray(item) ? item.length : countDetectorAdvisories(item)
  ), 0);
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
    let advisoryCount = 0;
    let seriousAxe = 0;
    let advisoryAxe = 0;
    for (const width of [390, 1440]) {
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
        const screenshotPath = path.join(output, `${stem}.png`);
        const { mainHeight: mainScrollHeight, headerHeight } = await screenshotMainContent(page, screenshotPath);
        fs.writeFileSync(path.join(output, `${stem}.capture.json`), `${JSON.stringify({
          reviewedHead,
          route,
          role,
          viewport: { width, height },
          theme,
          screenshotElement: 'main',
          expandedMainScrollHeight: mainScrollHeight,
          shellHeaderHeight: headerHeight,
          sourceDirs: (process.env.SRC_DIRS || '').split(/\s+/).filter(Boolean),
        }, null, 2)}\n`);

        const detect = spawnSync(detector, ['detect', '--cdp', `${cdpPort}`, '--target', page.url(), '--json'], {
          cwd: ROOT, encoding: 'utf8', timeout: 120_000,
        });
        if (detect.error) throw detect.error;
        let detectorJson;
        try { detectorJson = JSON.parse(detect.stdout); }
        catch { throw new Error(`Impeccable returned invalid JSON for ${route} @${width}: ${detect.stderr || detect.stdout}`); }
        fs.writeFileSync(path.join(output, `${stem}.detector.json`), `${JSON.stringify({ reviewedHead, result: detectorJson }, null, 2)}\n`);
        const currentDetectorFindings = countDetectorFindings(detectorJson);
        const currentAdvisories = countDetectorAdvisories(detectorJson);
        detectorCount += currentDetectorFindings;
        advisoryCount += currentAdvisories;
        if (currentDetectorFindings > 0) failed = true;

        const axeJson = await new AxeBuilder({ page }).analyze();
        fs.writeFileSync(path.join(output, `${stem}.axe.json`), `${JSON.stringify({ reviewedHead, result: axeJson }, null, 2)}\n`);
        const serious = axeJson.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
        const advisory = axeJson.violations.filter((violation) => ['moderate', 'minor'].includes(violation.impact));
        seriousAxe += serious.length;
        advisoryAxe += advisory.length;
        if (serious.length) failed = true;
        await context.close();
      }
    }
    console.log(`${route}: impeccable findings=${detectorCount}; detector advisory=${advisoryCount}; axe serious/critical=${seriousAxe}; axe advisory=${advisoryAxe}`);
  }
} finally {
  await browser.close();
}
process.exitCode = failed ? 1 : 0;
