// @e2e-isolation: read-only — signs in, opens/closes the phone drawer and navigates; locale is pinned by rewriting the profile read, no DB writes.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-SHELL-001 — at phone width the bottom bar's More opens the navigation drawer; choosing a
 * screen closes it and focus lands back on the opener (More) rather than being lost.
 * Elements are found by role + accessible name, in English and Bahasa.
 */
const LOCALES = [
  { locale: 'en', more: /^more$/i, drawer: /navigation menu/i, target: /^projects$/i, url: /\/projects$/ },
  { locale: 'id', more: /^lainnya$/i, drawer: /menu navigasi/i, target: /^proyek$/i, url: /\/projects$/ },
] as const;

async function pinLocale(page: Page, locale: 'en' | 'id') {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(route.request().url())) return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    const body = await response.json().catch(() => null);
    if (!body || Array.isArray(body) || typeof body !== 'object' || !('locale' in body)) return route.fulfill({ response, json: body });
    return route.fulfill({ response, json: { ...body, locale, number_locale: locale === 'id' ? 'id-ID' : 'en-US' } });
  });
}

for (const L of LOCALES) {
  test(`AC-SHELL-001 phone More drawer opens, navigates, closes and returns focus (${L.locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await pinLocale(page, L.locale);
    await signIn(page, 'admin@acme.test');
    await page.goto('/');

    const bar = page.getByRole('navigation').filter({ has: page.getByRole('button', { name: L.more }) });
    const more = bar.getByRole('button', { name: L.more });
    await more.click();

    const drawer = page.getByRole('dialog', { name: L.drawer });
    await expect(drawer).toBeVisible();

    await drawer.getByRole('link', { name: L.target }).first().click();

    await expect(page).toHaveURL(L.url);
    await expect(drawer).toBeHidden();
    await expect(more).toBeFocused();
  });
}
