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
  // Keep shell labels deterministic when another journey changed the persisted seed locale.
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      return route.fulfill({ response, json: { ...body, locale: 'en', number_locale: 'en-US' } });
    }
    return route.fulfill({ response, json: body });
  });
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
