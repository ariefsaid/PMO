// @e2e-isolation: read-only — public /privacy + /terms nav; a localStorage toggle only, no DB reads/writes.
import { test, expect } from '@playwright/test';

/**
 * AC-CON-003: Given a user who has opted out, When they navigate and trigger errors, Then no network
 * request is made to the PostHog host, and the preference survives a reload.
 *
 * The CONTROL assertion is load-bearing. Analytics is disabled whenever VITE_POSTHOG_KEY is not a
 * valid phc_ key, which is the default everywhere except this lane's dev server — so without first
 * proving that an OPTED-IN session DOES attempt PostHog requests, the opt-out assertion would pass
 * against a build with no analytics at all and prove nothing.
 */
const PH_HOST = /ph-e2e\.invalid/;
const POSTHOG_KEY = 'phc_e2econsentlanefakekey00000'; // matches playwright.config.ts's consent webServer env
// posthog-js's OWN persisted consent flag (consent.js: `OPT_OUT_PREFIX + token`, localStorage by
// default) — '1' granted, '0' denied. Reading this directly is what makes the in-session test below
// reliable: it is a synchronous SDK-internal state flip, not a network-flush timing race (see that
// test's own comment for why observing NETWORK traffic in-session turned out not to be viable here).
const SDK_CONSENT_KEY = `__ph_opt_in_out_${POSTHOG_KEY}`;

async function countPosthogRequests(
  page: import('@playwright/test').Page,
  run: (hits: string[]) => Promise<void>,
) {
  const hits: string[] = [];
  await page.route(PH_HOST, async (route) => {
    hits.push(route.request().url());
    await route.abort();
  });
  await run(hits);
  return hits;
}

test('AC-CON-003 CONTROL: an opted-in session DOES attempt PostHog requests', async ({ page }) => {
  const hits = await countPosthogRequests(page, async (hits) => {
    await page.goto('/privacy');
    await expect
      .poll(() => hits.length, { message: 'the control must fail if analytics is not actually enabled in this lane' })
      .toBeGreaterThan(0);
  });
  expect(hits.length, 'the control must fail if analytics is not actually enabled in this lane')
    .toBeGreaterThan(0);
});

test('AC-CON-003 (in-session): opting out immediately flips the REAL SDK\'s own consent state, before any reload, and it survives an SPA navigation and a thrown error', async ({ page }) => {
  // The reload-based test below only proves "we never called init() again" — a DIFFERENT
  // protection (client.ts's readOptOut() guard on doInit). This test is the case security flagged
  // as untested: the SDK is still LIVE in this tab (init already ran) and only
  // `posthog.opt_out_capturing()` (plus our own belt-and-braces guard on capture/captureException)
  // stands between the user and PostHog for the rest of this session.
  //
  // This asserts the REAL SDK's own persisted consent flag (posthog-js's `ConsentManager`,
  // `__ph_opt_in_out_<token>` in localStorage) rather than counting network requests. Tried the
  // network-count approach first and abandoned it: against this lane's synthetic host + `route.abort`
  // /`route.fulfill`, NO capture-endpoint traffic was ever observed within any reasonable wait —
  // even for a fully opted-IN session that never opts out at all (posthog-js's request queue appears
  // to need a real remote-config response shape to proceed past its startup fetches, not a synthetic
  // one). That makes a "zero requests" assertion in this narrow in-session window vacuous in EITHER
  // direction. The consent flag, in contrast, is a synchronous state write `opt_out_capturing()`
  // makes immediately and does not depend on anything reaching the network — and it is exactly the
  // mechanism spec/ADR-0067 relies on to say "capture stops now, in this session".
  await page.goto('/privacy');
  const toggle = page.getByRole('checkbox', { name: /usage analytics/i });

  // Baseline: an opted-in session has NOT denied consent at the SDK level (granted or pending).
  const beforeOptOut = await page.evaluate((key) => localStorage.getItem(key), SDK_CONSENT_KEY);
  expect(beforeOptOut).not.toBe('0');

  await toggle.check();
  await expect(toggle).toBeChecked();

  const readConsent = () => page.evaluate((key) => localStorage.getItem(key), SDK_CONSENT_KEY);
  await expect.poll(readConsent, { message: 'posthog.opt_out_capturing() must flip the REAL SDK consent flag immediately' })
    .toBe('0');

  // SPA navigation (react-router `Link`, not a full page load) — the in-memory SDK state (and our
  // `initialized` flag) survives this, unlike the reload-based test below.
  await page.getByRole('link', { name: /^Terms$/ }).click();
  await expect(page).toHaveURL(/\/terms$/);
  expect(await readConsent(), 'consent must not silently re-grant across an SPA navigation').toBe('0');

  // AC-CON-003's own wording is "navigate AND TRIGGER ERRORS" — dispatch an uncaught error;
  // AnalyticsProvider's global `window.addEventListener('error', ...)` routes this into
  // `analyticsClient.captureException`, which (belt-and-braces) no-ops for an opted-out browser
  // regardless of what the SDK's own consent flag says (client.test.ts unit-covers that no-op
  // directly against a mock; this e2e's job is only the consent-flag side of the story).
  await page.evaluate(() => {
    window.setTimeout(() => {
      throw new Error('AC-CON-003 in-session opt-out probe');
    }, 0);
  });
  await page.waitForTimeout(500);
  expect(await readConsent(), 'consent must not silently re-grant after an uncaught error').toBe('0');

  // Back to /privacy (SPA nav again) — the checkbox lives there, not on /terms.
  await page.getByRole('link', { name: /^Privacy$/ }).click();
  await expect(page.getByRole('checkbox', { name: /usage analytics/i })).toBeChecked();
  expect(await readConsent()).toBe('0');
});

test('AC-CON-003: after opting out, navigation makes ZERO PostHog requests and the choice survives a reload', async ({ page }) => {
  await page.goto('/privacy');
  const toggle = page.getByRole('checkbox', { name: /usage analytics/i });
  await toggle.check();
  await expect(toggle).toBeChecked();

  const hits = await countPosthogRequests(page, async () => {
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /usage analytics/i })).toBeChecked();
    await page.goto('/terms');
    await page.goto('/privacy');
    await page.waitForTimeout(2000);
  });

  expect(hits, `expected no PostHog traffic, got: ${hits.join(', ')}`).toEqual([]);
  await expect(page.getByRole('checkbox', { name: /usage analytics/i })).toBeChecked();
});
