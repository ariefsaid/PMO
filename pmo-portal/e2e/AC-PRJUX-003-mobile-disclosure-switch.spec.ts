// @e2e-isolation: read-only — exercises Projects toolbar without changing stored data.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test('AC-PRJUX-003: switching mobile toolbar disclosures keeps the tapped action reachable @360/@390', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/projects');

  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const filters = page.getByRole('button', { name: /^Filters/ });
    const more = page.getByRole('button', { name: /^More actions/ });
    await filters.click();
    const filtersRegion = page.getByRole('region', { name: 'Filters' });
    await expect(filtersRegion).toBeVisible();
    await waitForFonts(page);
    const filtersBox = await filtersRegion.boundingBox();
    expect(filtersBox).not.toBeNull();
    expect(filtersBox!.x).toBeGreaterThanOrEqual(0);
    expect(filtersBox!.x + filtersBox!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await more.click();
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const moreRegion = page.getByRole('region', { name: 'More actions' });
    await expect(moreRegion).toBeVisible();
    const moreBox = await moreRegion.boundingBox();
    expect(moreBox).not.toBeNull();
    expect(moreBox!.x).toBeGreaterThanOrEqual(0);
    expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();

    await filters.click();
    await page.getByRole('heading', { name: 'Projects', exact: true }).click();
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await expect(filters).toBeFocused();
  }
});
