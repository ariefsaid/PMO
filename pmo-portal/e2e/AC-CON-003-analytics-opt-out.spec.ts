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

async function countPosthogRequests(page: import('@playwright/test').Page, run: () => Promise<void>) {
  const hits: string[] = [];
  await page.route(PH_HOST, async (route) => {
    hits.push(route.request().url());
    await route.abort();
  });
  await run();
  return hits;
}

test('AC-CON-003 CONTROL: an opted-in session DOES attempt PostHog requests', async ({ page }) => {
  const hits = await countPosthogRequests(page, async () => {
    await page.goto('/privacy');
    await page.waitForTimeout(2000);
  });
  expect(hits.length, 'the control must fail if analytics is not actually enabled in this lane')
    .toBeGreaterThan(0);
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
