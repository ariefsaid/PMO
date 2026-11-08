// Capture helper for #2062 — meeting record (read + edit) and an approval with a note.
// Usage: BASE=http://localhost:5180 OUT=/tmp/shots-before node captures-2062.mjs
// Signs in as pm@acme.test (the seeded meeting's author + the Requested procurement's approver),
// saves storage state, then screenshots at 1440x900 and 390x844, light theme, fullPage.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://localhost:5180';
const OUT = process.env.OUT ?? '/tmp/shots';
const EMAIL = 'pm@acme.test';
const PASSWORD = 'Passw0rd!dev';
const MEETING = '/meetings/ee000000-0000-0000-0000-000000000001';
const PROCUREMENT = '/procurement/61000000-0000-0000-0000-000000000008';

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(new RegExp(`${BASE.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}/$`), { timeout: 20_000 });
}

async function shot(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
  console.log(`saved ${name}-${width}.png`);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const page = await context.newPage();
await signIn(page);
const state = await page.context().storageState();
fs.mkdirSync(path.join(process.cwd(), 'e2e/.auth'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'e2e/.auth/pm@acme.test.json'), JSON.stringify(state));

// ── Meeting record: read view ───────────────────────────────────────────────
await page.goto(`${BASE}${MEETING}`, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="minutes-blocknote"]').waitFor({ state: 'visible', timeout: 30_000 });
await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await shot(page, 'meeting-read', 1440, 900);
await shot(page, 'meeting-read', 390, 844);

// ── Meeting record: edit state ──────────────────────────────────────────────
// BEFORE: the editor is always live — click into it. AFTER: click the Edit button first.
const editButton = page.getByTestId('minutes-edit');
if (await editButton.count()) {
  await editButton.click();
  await page.waitForTimeout(300);
}
const editor = page.getByTestId('minutes-blocknote').locator('.bn-editor');
await editor.click();
await page.waitForTimeout(300);
await shot(page, 'meeting-edit', 1440, 900);
await shot(page, 'meeting-edit', 390, 844);

// ── Approval with a note (Requested procurement as the approver) ────────────
await page.goto(`${BASE}${PROCUREMENT}`, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="procurement-notes-input"]').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await shot(page, 'approval-note', 1440, 900);
await shot(page, 'approval-note', 390, 844);

await browser.close();
console.log('done');
