#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
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
if (!['exec', 'finance', 'pm', 'engineer', 'admin'].includes(role)) throw new Error(`Unsupported UX_ROLE: ${role}`);
const output = path.join(ROOT, 'docs/private/ux-shots', area, role);
const reviewedHead = execFileSync('git', ['rev-parse', process.env.SHOT_SOURCE_HEAD || 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const languages = (process.env.SHOT_LOCALES || 'en').split(',');
const fixture = process.env.SHOT_FIXTURE
  ? await import(pathToFileURL(path.resolve(ROOT, process.env.SHOT_FIXTURE)).href) : null;
const manifestFile = path.join(output, 'proof-manifest.json');
const manifest = process.env.SHOT_RESUME === '1' && fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  : { area, base, role, reviewedHead, captures: [], errors: [] };
if (process.env.SHOT_RESUME === '1') manifest.errors = manifest.errors.filter((entry) => !routes.includes(entry.route));
const detector = path.join(ROOT, '.claude/skills/impeccable/scripts/impeccable');
const authFile = path.resolve(APP, process.env.SHOT_AUTH || `e2e/.auth/${role}@acme.test.json`);
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
let nextPage = 0;
const cdpServer = net.createServer();
await new Promise((resolve, reject) => cdpServer.listen(0, '127.0.0.1', resolve).once('error', reject));
const cdpPort = cdpServer.address().port;
await new Promise((resolve, reject) => cdpServer.close((error) => error ? reject(error) : resolve()));
const browser = await chromium.launch({ headless: true, timeout: 120_000, args: [`--remote-debugging-port=${cdpPort}`] });
try {
  const captureRoute = async (route) => {
    let detectorCount = 0;
    let advisoryCount = 0;
    let seriousAxe = 0;
    let advisoryAxe = 0;
    for (const width of [390, 1440]) {
      const height = width === 390 ? 844 : 900;
      for (const theme of ['light', 'dark']) {
       for (const language of languages) {
        const stem = process.env.SHOT_LOCALES || fixture
          ? `${slug(route)}-${width}-${language}-${theme}${fixture ? '-real-proof' : '-proof'}`
          : `${slug(route)}-${width}-${theme}`;
        if (process.env.SHOT_RESUME === '1') {
          const existing = manifest.captures.find((entry) => entry.file === `${stem}.png`);
          try {
            const storedDetector = JSON.parse(fs.readFileSync(path.join(output, `${stem}.detector.json`), 'utf8'));
            const storedAxe = JSON.parse(fs.readFileSync(path.join(output, `${stem}.axe.json`), 'utf8'));
            const detected = storedDetector.result ?? storedDetector;
            const axe = storedAxe.result ?? storedAxe;
            const serious = axe.violations.filter((item) => ['serious', 'critical'].includes(item.impact)).length;
            if (existing?.geometry?.h1Count === 1 && existing.geometry.scrollWidth <= existing.geometry.clientWidth
                && fs.existsSync(path.join(output, `${stem}.png`)) && countDetectorFindings(detected) === 0 && serious === 0) {
              advisoryCount += countDetectorAdvisories(detected);
              advisoryAxe += axe.violations.length;
              continue;
            }
          } catch { /* Missing or invalid machine evidence is recaptured. */ }
        }
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, isMobile: width === 390, hasTouch: width === 390 });
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(90_000);
        page.setDefaultTimeout(90_000);
        await page.addInitScript(({ theme, language, items }) => {
          for (const { name, value } of items) window.localStorage.setItem(name, value);
          window.localStorage.setItem('theme', theme);
          window.localStorage.setItem('i18nextLng', language);
        }, { theme, language, items: localStorage });
        if (fixture) await fixture.install(page, { language, theme, width });
        await page.goto(`${base}${route}${route.includes('#') ? '' : `#ux-proof-${nextPage++}`}`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        await page.locator('main').or(page.locator('h1')).first().waitFor({ state: 'visible', timeout: 60_000 });
        if (fixture?.settle) await fixture.settle(page, route);
        await page.evaluate(async () => {
          await document.fonts.ready;
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          document.querySelector('.main-scroll')?.scrollTo(0, 0);
        });
        await page.screenshot({ path: path.join(output, `${stem}-viewport.png`), fullPage: false });
        const { mainHeight: mainScrollHeight, headerHeight } = await screenshotMainContent(page, path.join(output, `${stem}.png`));
        fs.writeFileSync(path.join(output, `${stem}.capture.json`), JSON.stringify({ reviewedHead, route, role, language, theme, viewport: { width, height }, expandedMainScrollHeight: mainScrollHeight, shellHeaderHeight: headerHeight, sourceDirs: (process.env.SRC_DIRS || '').split(/\s+/).filter(Boolean) }, null, 2));
        const geometry = await page.evaluate(() => ({
          h1Count: document.querySelectorAll('main h1').length,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          bodyAnimation: getComputedStyle(document.body).animationName,
          heading: document.querySelector('main h1')?.textContent,
        }));
        if (geometry.h1Count !== 1 || geometry.scrollWidth > geometry.clientWidth) failed = true;
        const png = fs.readFileSync(path.join(output, `${stem}.png`));
        manifest.captures = manifest.captures.filter((entry) => entry.file !== `${stem}.png`);
        manifest.captures.push({ file: `${stem}.png`, reviewedHead, role, route, url: page.url(), language, theme,
          geometry, viewport: { width, height }, pixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } });
        fs.writeFileSync(path.join(output, 'proof-manifest.json'), JSON.stringify(manifest, null, 2));

        // Keep route-mock callbacks alive while the detector inspects the page.
        // A synchronous child blocks Playwright's request interception and can
        // deadlock the detector's stylesheet reads on a mocked route.
        const detect = await new Promise((resolve, reject) => {
          execFile(detector, ['detect', '--cdp', `${cdpPort}`, '--target', page.url(), '--json'], {
            cwd: ROOT, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
          }, (error, stdout, stderr) => {
            if (error && ![1, 2].includes(error.code)) reject(error);
            else resolve({ stdout, stderr, status: error?.code ?? 0 });
          });
        });
        if (detect.status === 1) failed = true;
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
        seriousAxe += serious.length;
        advisoryAxe += axeJson.violations.filter((violation) => ['moderate', 'minor'].includes(violation.impact)).length;
        if (serious.length) failed = true;
        await context.close();
       }
      }
    }
    console.log(`${route}: impeccable findings=${detectorCount}; detector advisory=${advisoryCount}; axe serious/critical=${seriousAxe}; axe advisory=${advisoryAxe}`);
  };
  let nextRoute = 0;
  const concurrency = Math.max(1, Math.min(2, Number(process.env.SHOT_CONCURRENCY) || 1));
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextRoute < routes.length) {
      const route = routes[nextRoute++];
      try { await captureRoute(route); }
      catch (error) {
        failed = true;
        manifest.errors.push({ route, error: String(error) });
        fs.writeFileSync(path.join(output, 'proof-manifest.json'), JSON.stringify(manifest, null, 2));
        console.error(`${route}: proof failed: ${error}`);
      }
    }
  }));
} finally {
  await browser.close();
}
process.exitCode = failed ? 1 : 0;
