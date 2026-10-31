// @e2e-isolation: read-only — stubbed statement reads and geometry assertions; no writes.
import { expect, test, type Page } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';
import { expectNoHorizontalOverflow } from '../support/layout-oracles';
import {
  FINANCE,
  installRoutes,
  forceLocale,
  type Locale,
  type ReadMode,
  type Theme,
} from '../support/financial-statement-fixtures';

async function openCompanyStatements(
  page: Page,
  locale: Locale,
  theme: Theme,
  mode: ReadMode = 'populated',
  width = 390,
) {
  const routes = await installRoutes(page, { projectId: null, mode });
  await forceLocale(page, locale);
  await signIn(page, FINANCE);
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.goto('/financial-statements');
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
  else await expect(page.locator('html')).not.toHaveClass(/dark/);
  await waitForFonts(page);
  return routes;
}

async function expectCompanyAccountLabel(page: Page) {
  // Statement format: one table, each account listed once.
  const accountLabel = page.getByText('Long native account label for responsive wrapping across narrow screens');
  await expect(page.getByRole('table')).toHaveCount(1);
  await expect(accountLabel).toHaveCount(1);
  await expect(accountLabel.first()).toBeVisible();
}

for (const width of [390, 1440] as const) {
  for (const locale of ['en', 'id'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`@layout AC-008 support: company native trial balance fits at ${width}px in ${locale}/${theme}`, async ({ page }) => {
        const routes = await openCompanyStatements(page, locale, theme, 'populated', width);
        await expect(page.getByRole('heading', { level: 1, name: locale === 'id' ? 'Laporan keuangan' : 'Financial statements' })).toBeVisible();
        await expectCompanyAccountLabel(page);
        await expectNoHorizontalOverflow(page);
        await expect.poll(routes.readCount).toBeGreaterThan(0);
      });
    }
  }
}
