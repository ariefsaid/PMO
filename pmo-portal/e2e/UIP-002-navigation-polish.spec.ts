// @e2e-isolation: read-only — only opens/closes navigation and follows an existing route.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

test('UIP-002: dashboard has no horizontal page overflow at 1440×900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'exec@acme.test');

  await expect(page.getByRole('main')).toBeVisible();
  await waitForFonts(page);
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
});

test('UIP-002: phone navigation uses the menu glyph, opens routes, and returns keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'exec@acme.test');

  const trigger = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(trigger.locator('svg')).toHaveAttribute('data-icon', 'menu');
  await trigger.click();

  const drawer = page.getByRole('dialog', { name: 'Navigation menu' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(drawer).toHaveCount(0);

  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await waitForFonts(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
