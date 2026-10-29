// @e2e-isolation: read-only — confirms rendered KPI money stays inside its tile at desktop and phone widths.
import { expect, test, type Locator } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';
import { formatExactMoney, formatShortMoney } from '../src/lib/format';
import { getActiveLocale, setActiveLocale } from '../src/lib/locale/activeLocale';

async function pinBahasaLocale(page: import('@playwright/test').Page) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const response = await route.fetch();
    const profile = await response.json() as Record<string, unknown> | Record<string, unknown>[];
    const localized = Array.isArray(profile)
      ? profile.map((row) => ({ ...row, locale: 'id', number_locale: 'id-ID' }))
      : { ...profile, locale: 'id', number_locale: 'id-ID' };
    await route.fulfill({ response, json: localized });
  });
}

function expectedShortIdUsd(value: number): string {
  const previous = getActiveLocale();
  setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
  try {
    return formatShortMoney(value, 'USD');
  } finally {
    setActiveLocale(previous);
  }
}

async function expectMoneyFits(tile: Locator, locator: Locator, shortValue: string, exactValue: string) {
  await expect(locator).toHaveText(shortValue);
  // A7 (RD-S1): the short value span carries the title, so AT reads the amount once.
  await expect(locator, 'the exact amount is the figure title').toHaveAttribute('title', exactValue);
  const amountMetrics = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: box.left,
      right: box.right,
    };
  });
  const containerMetrics = await tile.evaluate((container) => {
    const containerBox = container.getBoundingClientRect();
    const containerStyle = getComputedStyle(container);
    return {
      contentLeft: containerBox.left + Number.parseFloat(containerStyle.paddingLeft),
      contentRight: containerBox.right - Number.parseFloat(containerStyle.paddingRight),
    };
  });
  const metrics = { ...amountMetrics, ...containerMetrics };

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

  // #1403 owner ruling: active-contract tile removed; on-hand is the company figure
  const expectedShortAmount = expectedShortIdUsd(33_050_000);
  const expectedExactAmount = formatExactMoney('33050000', 'USD', 'id-ID', { wholeUnits: true })!;
  const companyFigures = page.getByRole('region', { name: 'Angka perusahaan' });
  const desktopTile = companyFigures.getByText('Kontrak berjalan', { exact: true }).locator('xpath=../..');
  const visibleAmount = desktopTile.locator('div.tabular > span[aria-hidden="true"]');
  await expect(desktopTile).toBeVisible();
  await expectMoneyFits(desktopTile, visibleAmount, expectedShortAmount, expectedExactAmount);

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneSpendLink = desktopTile.getByRole('link');
  await expect(phoneSpendLink).toBeVisible();
  await waitForFonts(page);
  await expectMoneyFits(desktopTile, visibleAmount, expectedShortAmount, expectedExactAmount);
});
