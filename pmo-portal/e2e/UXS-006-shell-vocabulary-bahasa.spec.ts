// @e2e-isolation: read-only — shell vocabulary in Bahasa via a route-mocked profile locale; no DB writes.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * UXS-006 (shell part) + UXS-030: the shell speaks the saved language. With the
 * interface in Bahasa Indonesia, the rail, the ⌘K palette, and the breadcrumb
 * share one localized vocabulary, and localized AND familiar English aliases
 * both find a destination without changing any URL or role rule.
 *
 * Journey (pm@acme.test — has the Vendors doorway, My Tasks, and Companies):
 *   1. rail shows "Tugas Saya" and "Vendor";
 *   2. palette finds Companies by the localized word ("perusahaan") and lands on
 *      /companies with a matching "Perusahaan" breadcrumb;
 *   3. palette "Vendor" opens the canonical filtered doorway
 *      /companies?type=Vendor whose breadcrumb reads "Vendor";
 *   4. palette "my tasks" (English alias in the id locale) finds "Tugas Saya".
 *
 * Bahasa without a persisted profile write: `I18nProvider` resolves the language
 * ONLY from the signed-in profile (FR-L10N-003), so the pass rewrites the profile
 * row the AuthProvider reads (`select=*&id=eq.<uid>`, single object) to carry
 * `locale: 'id'`. Keeps the spec read-only and parallel-safe.
 *
 * Owning layer: e2e (Playwright) — UXS-006 shell vocabulary. Registry/alias unit
 * pins live in routeMatch/Rail/CommandPalette suites; this journey proves the
 * rendered vocabulary end to end.
 */

async function forceBahasa(page: Page) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./.test(url)) return route.fallback();
    const response = await route.fetch();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
      body = { ...(body as Record<string, unknown>), locale: 'id', number_locale: 'id-ID' };
    }
    return route.fulfill({ response, json: body });
  });
}

/** Open the palette (⌘K toggles — only press when closed) and return its combobox. */
async function openPalette(page: Page) {
  const dialog = page.getByRole('dialog', { name: /command palette|palet perintah/i });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.keyboard.press('ControlOrMeta+k');
    }
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  return page.getByRole('combobox');
}

async function currentCrumb(page: Page, text: string | RegExp) {
  const crumb = page
    .getByRole('navigation', { name: /breadcrumb/i })
    .locator('[aria-current="page"]');
  await expect(crumb).toHaveText(text, { timeout: 10_000 });
}

test.describe('UXS-006: shell speaks the saved language', () => {
  test('rail, palette and breadcrumb share the localized vocabulary', async ({ page }) => {
    await forceBahasa(page);
    await signIn(page, 'pm@acme.test');

    // The rail uses the shared vocabulary, including the PM personal doorway
    // (its accessible name carries the hint, hence the prefix match; the nav
    // label itself is localized, hence the alternation).
    const rail = page.getByRole('navigation', { name: /primary navigation|navigasi utama/i });
    await expect(rail.getByRole('link', { name: /^Tugas Saya/ })).toBeVisible({ timeout: 10_000 });
    await expect(rail.getByRole('link', { name: 'Vendor' })).toBeVisible();
    await expect(page.locator('#rail-my-tasks-hint')).toHaveText(
      'Tugas Anda di seluruh proyek',
    );

    // A localized word finds its destination; the breadcrumb agrees with it.
    // Records whose type label matches rank first, so click the exact module
    // option rather than running whatever row is on top.
    await (await openPalette(page)).fill('perusahaan');
    await page.getByRole('option', { name: 'Perusahaan', exact: true }).click();
    await page.waitForURL('**/companies');
    await currentCrumb(page, 'Perusahaan');

    // The canonical Vendors doorway opens the existing Companies list filtered
    // to vendors, and its breadcrumb carries the doorway's own name.
    await (await openPalette(page)).fill('vendor');
    await page.getByRole('option', { name: 'Vendor', exact: true }).click();
    await page.waitForURL('**/companies?type=Vendor');
    await currentCrumb(page, 'Vendor');

    // The familiar English alias still finds the localized destination.
    await (await openPalette(page)).fill('my tasks');
    await page.getByRole('option', { name: /Tugas Saya/ }).click();
    await page.waitForURL('**/my-tasks');
    await currentCrumb(page, 'Tugas Saya');
  });
});
