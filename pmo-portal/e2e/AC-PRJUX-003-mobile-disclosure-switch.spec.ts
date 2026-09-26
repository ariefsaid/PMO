// @e2e-isolation: read-only — exercises Projects toolbar without changing stored data.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test('AC-PRJUX-003: switching mobile toolbar disclosures keeps the tapped action reachable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/projects');

  const filters = page.getByRole('button', { name: /^Filters/ });
  const more = page.getByRole('button', { name: /^More actions/ });
  await filters.click();
  const filtersRegion = page.getByRole('region', { name: 'Filters' });
  await expect(filtersRegion).toBeVisible();
  const filtersBox = await filtersRegion.boundingBox();
  expect(filtersBox).not.toBeNull();
  expect(filtersBox!.x).toBeGreaterThanOrEqual(0);
  expect(filtersBox!.x + filtersBox!.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await more.click();
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const moreRegion = page.getByRole('region', { name: 'More actions' });
  await expect(moreRegion).toBeVisible();
  const moreBox = await moreRegion.boundingBox();
  expect(moreBox).not.toBeNull();
  expect(moreBox!.x).toBeGreaterThanOrEqual(0);
  expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
