// @e2e-isolation: read-only — layout measurements on a seeded route; no writes.
import { test, expect } from '@playwright/test';
import { login, signIn, waitForFonts } from '../helpers';
import { formatExactMoney, formatShortMoney } from '../../src/lib/format';
import { getActiveLocale, setActiveLocale } from '../../src/lib/locale/activeLocale';
import { assertDashboardPaintAndDesktopAccount, assertShortAccountMenu, expectMoneyFits } from '../support/layout-oracles';
import { registerFigureLayout } from '../support/figure-layout';
import { registerLayoutSweep } from '../support/layout-sweep';

registerLayoutSweep({ path: '/', label: 'dashboard', icons: true, integrations: false });

test('@layout AC-ACCT-005 AC-1202 token utilities paint: active nav has a blue tint + blue text, ⌘K selection is highlighted', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, 'pm@acme.test');

  await assertDashboardPaintAndDesktopAccount(page);
});

registerFigureLayout('executive');
registerFigureLayout('pm');

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

test('@layout AC-FAA-010: long Indonesian money values stay fully visible in Executive KPI tiles at desktop and phone widths', async ({ page }) => {
  await pinBahasaLocale(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'exec@acme.test');
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
  // #1403: KPITile keeps its full-surface link beside the content wrapper, so scope to the tile root.
  const phoneSpendLink = desktopTile.locator('..').getByRole('link');
  await expect(phoneSpendLink).toBeVisible();
  await waitForFonts(page);
  await expectMoneyFits(desktopTile, visibleAmount, expectedShortAmount, expectedExactAmount);
});


test('@layout AC-ACCT-005 short phone menu and larger text remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/');
  await assertShortAccountMenu(page);
});
