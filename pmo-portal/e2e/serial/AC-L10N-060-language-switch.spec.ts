// @e2e-isolation: serial — changes the shared PM seed profile's locale and restores its NULL override in afterEach.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../helpers';

// AC-L10N-060 — a user switches language in the UI; once the page settles, a money figure and a
// date both render in Indonesian convention on the same screen. The journey mutates the shared
// `pm@acme.test` seed profile (org-global), so it lives in the serial lane and restores the NULL
// override in afterEach, keeping the spec retry-safe and un-poisoning later serial tests.
const PROJECT_ID = '40000000-0000-0000-0000-000000000001';

// The expected formatted strings, computed with the SAME Intl shapes the plan dictates so the
// assertion certifies the viewer's resolved locale rather than a hardcoded translation.
const MONEY_ID = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}).format(5_000_000);
const DATE_ID = new Intl.DateTimeFormat('id-ID', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
}).format(new Date('2026-01-06T00:00:00'));

/** The settings page's native labelled select; its option VALUES are locale-stable. */
function languageSelect(page: Page) {
  return page.locator('select');
}
/** The primary save button — name matches both English ("Save") and Bahasa ("Simpan") UIs. */
function saveButton(page: Page, { exact = false }: { exact?: boolean } = {}) {
  return page.getByRole('button', { name: /save|simpan/i, exact });
}

test('AC-L10N-060: switching to Bahasa Indonesia re-renders money and dates, and persists', async ({ page }) => {
  await signIn(page, 'pm@acme.test');

  // 1. Open /settings/profile, choose Bahasa Indonesia, save → html[lang] flips to id + success.
  await page.goto('/settings/profile');
  await expect(languageSelect(page)).toBeVisible();
  await languageSelect(page).selectOption('id');
  await saveButton(page, { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Pengaturan Profil');
  await expect(page.getByRole('status')).toHaveText(/preferences saved|preferensi disimpan/i);

  // 2. Persistence: reload keeps both the selection and the document language Indonesian.
  await page.reload();
  await expect(languageSelect(page)).toHaveValue('id');
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');

  // 3. Project detail → the SAME settled screen shows the contract value and start date in
  //    Indonesian convention (AC-L10N-060's goal oracle).
  await page.goto(`/projects/${PROJECT_ID}`);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByText(MONEY_ID, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(DATE_ID, { exact: true }).first()).toBeVisible();
});

test.afterEach(async ({ page }) => {
  // Restore the shared PM seed profile to its NULL (inherit) override, even after an assertion
  // failure, so the org-global state is clean for the next serial run.
  await page.goto('/settings/profile');
  await expect(languageSelect(page)).toBeVisible();
  await languageSelect(page).selectOption('inherit');
  await saveButton(page).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
