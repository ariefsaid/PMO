// @e2e-isolation: read-only — confirms rendered KPI money stays inside its tile at desktop and phone widths.
import { expect, test, type Locator } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';
import { installIdrDashboardFixture } from './dashboard-idr.fixtures';

async function pinBahasaLocale(page: import('@playwright/test').Page) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const response = await route.fetch();
    const profile = await response.json() as Record<string, unknown> | Record<string, unknown>[];
    const localized = Array.isArray(profile)
      ? profile.map((row) => ({ ...row, locale: 'id' }))
      : { ...profile, locale: 'id' };
    await route.fulfill({ response, json: localized });
  });
}

async function expectMoneyFits(locator: Locator, value: string) {
  await expect(locator).toContainText(value);
  const metrics = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const container = element.parentElement;
    if (!container) throw new Error('Exact money figure must remain inside its labeled row');
    const containerBox = container.getBoundingClientRect();
    const containerStyle = getComputedStyle(container);
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: box.left,
      right: box.right,
      contentLeft: containerBox.left + Number.parseFloat(containerStyle.paddingLeft),
      contentRight: containerBox.right - Number.parseFloat(containerStyle.paddingRight),
    };
  });

  expect(metrics.scrollWidth, 'the complete formatted amount fits within its own rendered box')
    .toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.left, 'the formatted amount starts inside its tile content edge')
    .toBeGreaterThanOrEqual(metrics.contentLeft - 0.5);
  expect(metrics.right, 'the formatted amount box stays inside its tile content edge')
    .toBeLessThanOrEqual(metrics.contentRight + 0.5);
}

test('AC-FAA-010: long Indonesian Actual values stay fully visible in the Executive delivery book at desktop and phone widths', async ({ page }) => {
  await pinBahasaLocale(page);
  await installIdrDashboardFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'exec@acme.test');
  await page.goto('/');
  await waitForFonts(page);

  // The synthetic fixture keeps a full IDR value beside a separate USD row.
  const expectedAmount = '58.412.775.000';
  const deliveryBook = page.getByTestId('dashboard-delivery-book');
  await expect(deliveryBook).toBeVisible();
  await expectMoneyFits(deliveryBook.getByTestId('dashboard-known-actual').locator('span.inline-block').first(), expectedAmount);

  await page.setViewportSize({ width: 390, height: 844 });
  await waitForFonts(page);
  await expectMoneyFits(deliveryBook.getByTestId('dashboard-known-actual').locator('span.inline-block').first(), expectedAmount);
});
