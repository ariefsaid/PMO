// @e2e-isolation: read-only — sign-in and inspect the Projects table; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test('AC-TBL-RESIZE-001 AC-TBL-GEOM-001: Projects columns resize and remain in-scroller without page-level horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/projects?view=table');
  const scroller = page.getByTestId('dt-table-branch');
  await expect(scroller).toBeVisible({ timeout: 20_000 });
  await expect(scroller.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await waitForFonts(page);

  const scrollerBox = await scroller.boundingBox();
  expect(scrollerBox).not.toBeNull();
  const projectHeader = scroller.getByRole('columnheader', { name: 'Project', exact: true });
  const handle = page.getByRole('separator', { name: 'Resize Project column' });
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const headerBox = await projectHeader.boundingBox();
    const indicator = handle.locator('.datatable-resize-indicator');
    const indicatorBox = await indicator.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(indicatorBox).not.toBeNull();
    expect(indicatorBox!.width).toBe(2);
    expect(Math.abs(indicatorBox!.x + indicatorBox!.width / 2 - (headerBox!.x + headerBox!.width))).toBeLessThanOrEqual(1);
    await projectHeader.hover();
    await expect.poll(() => handle.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectCell = scroller.locator('tbody tr').first().locator('td').first();
  for (const element of [projectHeader, projectCell]) {
    const box = await element.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(scrollerBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(scrollerBox!.x + scrollerBox!.width + 1);
  }
  const rowActions = page.getByRole('button', { name: 'Row actions' }).first();
  await expect(rowActions).toBeVisible();
  const actionsBox = await rowActions.boundingBox();
  expect(actionsBox).not.toBeNull();
  expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(scrollerBox!.x + scrollerBox!.width + 1);

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
