// @e2e-isolation: read-only — measures the procurement list at desktop width; the browser rewrites only the
// READ response of procurements (page.route) to give one row a category, so no seed row is ever written.
/**
 * #1791 — the procurement list's All view at 1440 holds every column whole with Category present:
 * no column sits under the sticky actions column at rest, and the table never scrolls sideways.
 */
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';

test('@layout #1791: with Category shown, "Raised by" ends left of the actions column at 1440px', async ({ page }) => {
  await page.route('**/rest/v1/procurements?*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || /id=eq\./.test(request.url())) return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    let rows: unknown;
    try {
      rows = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (!Array.isArray(rows) || rows.length === 0) return route.fulfill({ response });
    const withCategory = rows.map((row, index) => (index === 0 ? { ...(row as object), budget_category: 'Materials' } : row));
    return route.fulfill({ response, json: withCategory });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/procurement?tab=all');
  await expect(page.getByRole('columnheader', { name: 'Category' })).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
  const m = await page.evaluate(() => {
    const table = document.querySelector('table')!;
    const scroller = table.closest('.overflow-x-auto, [class*="overflow-x"]') as HTMLElement;
    const heads = Array.from(table.querySelectorAll<HTMLElement>('thead th'));
    const widths: Record<string, number> = {};
    for (const th of heads) widths[th.dataset.colKey ?? 'actions'] = Math.round(th.getBoundingClientRect().width);
    const owner = table.querySelector<HTMLElement>('thead th[data-col-key="owner"]')!;
    const actions = heads[heads.length - 1];
    return {
      widths,
      tableWidth: Math.round(table.getBoundingClientRect().width),
      scrollerClient: scroller.clientWidth,
      scrollerScroll: scroller.scrollWidth,
      ownerRight: owner.getBoundingClientRect().right,
      actionsLeft: actions.getBoundingClientRect().left,
    };
  });
  console.log('WIDTHS', JSON.stringify(m));
  expect(m.ownerRight).toBeLessThanOrEqual(m.actionsLeft);
  expect(m.scrollerScroll).toBeLessThanOrEqual(m.scrollerClient);
});
