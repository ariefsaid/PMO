import { test, expect, type Page } from '@playwright/test';
import { grantM365EntitlementFixture, signIn, stubM365StatusUnavailable, waitForFonts } from '../helpers';
import { assertIconSizes, assertNoBleed, assertProjectsDisclosures, assertPageWithinWidth } from './layout-oracles';

interface LayoutRoute {
  path: string;
  label: string;
  icons: boolean;
  integrations?: boolean;
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.getByRole('status', { name: 'Loading page' })).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await waitForFonts(page);
}

export function registerLayoutSweep(route: LayoutRoute) {
  for (const width of [360, 390]) {
    test(`@layout AC-MOBILE-OVERFLOW-001 ${route.label} @${width}${route.path === '/projects' ? ' AC-PRJUX-003' : ''}${route.path === '/' && width === 390 ? ' UIP-002' : ''}${route.icons && width === 390 ? ' AC-VISUAL-ICON-001' : ''}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await signIn(page, 'admin@acme.test');
      if (route.integrations) {
        await grantM365EntitlementFixture(page);
        await stubM365StatusUnavailable(page);
      }
      await page.goto(route.path);
      if (route.integrations) await expect(page.getByTestId('m365-connection-card')).toBeVisible({ timeout: 20_000 });
      await settle(page);
      await assertNoBleed(page, width);
      if (route.path === '/projects') await assertProjectsDisclosures(page, width);
      if (route.path === '/' && width === 390) await assertPageWithinWidth(page, width);
      if (route.icons && width === 390) {
        await page.setViewportSize({ width, height: 800 });
        await settle(page);
        await assertIconSizes(page);
      }
    });
  }
  if (route.icons) {
    test(`@layout AC-VISUAL-ICON-001 ${route.label} @desktop`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 860 });
      await signIn(page, 'admin@acme.test');
      await page.goto(route.path);
      await settle(page);
      await assertIconSizes(page);
    });
  }
}
