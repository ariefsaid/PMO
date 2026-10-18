// @e2e-isolation: read-only — confirms rendered KPI money stays inside its tile at desktop and phone widths.
import { expect, test, type Locator } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

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
    const container = element.closest('[data-testid="kpi-total-spend"]') ?? element.closest('a');
    if (!container) throw new Error('KPI amount must be inside its rendered tile');
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

test('AC-FAA-010: long Indonesian money values stay fully visible in Executive KPI tiles at desktop and phone widths', async ({ page }) => {
  await pinBahasaLocale(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'exec@acme.test');
  await page.goto('/');
  await waitForFonts(page);

  const expectedAmount = 'US$8.980.000,00';
  const desktopTile = page.getByTestId('kpi-total-spend');
  await expect(desktopTile).toBeVisible();
  await expectMoneyFits(desktopTile.locator('div.tabular'), expectedAmount);

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneSpendLink = page.getByRole('link', { name: /US\$8\.980\.000,00/ });
  await expect(phoneSpendLink).toBeVisible();
  await waitForFonts(page);
  await expectMoneyFits(phoneSpendLink.locator('span.tabular'), expectedAmount);
});
