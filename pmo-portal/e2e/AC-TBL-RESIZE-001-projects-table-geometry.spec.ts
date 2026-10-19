// @e2e-isolation: read-only — sign-in and inspect the Projects table; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test('AC-TBL-RESIZE-001: Projects columns resize without page-level horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/projects?view=table');
  const scroller = page.getByTestId('dt-table-branch');
  await expect(scroller).toBeVisible({ timeout: 20_000 });
  await expect(scroller.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await waitForFonts(page);

  const handle = page.getByRole('separator', { name: 'Resize Project column' });
  await expect(handle).toBeVisible();
  const before = await scroller.getByRole('columnheader', { name: 'Project', exact: true }).evaluate((el) => el.getBoundingClientRect().width);
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 64, box!.y + box!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => scroller.getByRole('columnheader', { name: 'Project', exact: true }).evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(before + 40);
  let dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('dt-card-branch')).toBeVisible();
  await expect(page.getByTestId('dt-table-branch')).toHaveCount(0);
  dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
