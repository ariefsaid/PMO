/**
 * AC-TBL-OVERFLOW-001 — the /projects Table view at desktop width must not scroll the PAGE sideways.
 *
 * Discover finding (2026-09-30): at 1440px the projects table is wider than its viewport, so it sits
 * in DataTable's `overflow-x-auto` wrapper and should scroll LOCALLY. The row-menu column's
 * `sr-only` "Actions" header is `position:absolute` and the wrapper was not a containing block, so it
 * escaped the clip and the whole document scrolled ~347px sideways.
 *
 * ORACLE: `documentElement.scrollWidth <= clientWidth` — the page-scroll measure. (The mobile sweep
 * deliberately uses a different oracle because `<main>` clips there; here the escape is what we want
 * to catch.)
 */
// @e2e-isolation: read-only — sign-in + navigate to /projects table view; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test.describe('AC-TBL-OVERFLOW-001 projects table does not scroll the page sideways', () => {
  test('AC-TBL-OVERFLOW-001 /projects table view @1440 has no page-level horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/projects?view=table');

    // Guard against measuring an empty shell: the desktop table branch, with data rows, must be up.
    const table = page.getByTestId('dt-table-branch');
    await expect(table).toBeVisible({ timeout: 20_000 });
    await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await waitForFonts(page);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      `page scrolls sideways on /projects table view: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`,
    ).toBeLessThanOrEqual(clientWidth);
  });
});
