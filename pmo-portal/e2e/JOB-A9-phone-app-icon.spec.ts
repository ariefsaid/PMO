// @e2e-isolation: self-isolated — creates its own disposable job-role login (removed in afterEach); otherwise only reads the app's install files.
/**
 * JOB-A9 / TC-PA-16 — a phone browser is offered the app as an icon: the page advertises a web app manifest with the
 * name, the standalone display mode, the start address and 192/512 (plus maskable) icons, and the start address opens
 * PMO Portal. The browser's own "Add to home screen" menu is browser chrome, not app code; this proves every app-side
 * fact behind it.
 */
import { test, expect } from '@playwright/test';
import { serviceClient, runId } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(90_000);

const admin = serviceClient('JOB-A9');
let worker: Awaited<ReturnType<typeof roleJobUser>>;
test.afterEach(async () => { await worker?.cleanup(); });

test('JOB-A9 the phone home icon opens PMO Portal', async ({ page, request }) => {
  worker = await roleJobUser(admin, 'project_manager', runId('a9'));
  await worker.signIn(page);
  await page.goto('/');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');

  const manifestResponse = await request.get(new URL(manifestHref!, page.url()).toString());
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json() as {
    name: string; start_url: string; display: string; icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest.name).toBe('PMO Portal');
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');
  for (const size of ['192x192', '512x512']) {
    expect(manifest.icons.some((icon) => icon.sizes === size && icon.purpose === 'any'), `${size} icon`).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === size && icon.purpose === 'maskable'), `${size} maskable icon`).toBe(true);
  }
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, page.url()).toString());
    expect(response.status(), `${icon.src} is served`).toBe(200);
  }
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(touchIcon).toBe('/apple-touch-icon.png');
  expect((await request.get(new URL(touchIcon!, page.url()).toString())).status()).toBe(200);

  // Installable: a service worker is registered for the whole app and becomes active (a browser offers the icon only then).
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, script: reg.active?.scriptURL ?? '' };
  });
  expect(sw.scope).toBe(new URL('/', page.url()).toString());
  expect(sw.script).toBe(new URL('/sw.js', page.url()).toString());

  // The icon's start address opens PMO Portal itself (the signed-in shell, never an error page).
  await page.goto(manifest.start_url);
  await expect(page.getByRole('navigation', { name: /primary navigation/i })).toBeVisible({ timeout: 20_000 });
});
