// @e2e-isolation: serial — mutates the shared finance@acme.test seed profile's locale; restored to
// `inherit` (English) in afterEach, even after a mid-test failure. Filed under e2e/serial/ (not the
// flat e2e/ path the plan sketched) because src/lib/i18n/I18nProvider.tsx resolves the UI language
// ONLY from the signed-in profile (no navigator.language / localStorage detection, FR-L10N-003) —
// so proving the Bahasa Indonesia half of this journey necessarily persists a profile row, exactly
// like the existing e2e/serial/AC-L10N-060-language-switch.spec.ts. Kept off pm@acme.test (that
// spec's own subject) to reduce contention within the serial lane.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../helpers';

/**
 * AC-LRC-013 (list-working-set-return, #683): at a 390px viewport, in English AND Bahasa
 * Indonesia, narrowing Companies, opening a record, and returning — once by KEYBOARD, once by
 * TOUCH — keeps every control reachable with a real accessible name, restores the working set
 * (type + search), and never overflows the viewport horizontally.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(120_000);

const OPEN_CABLECORE = { name: 'Open CableCore Electrical', exact: true };

/** The settings page's native labelled select; its option VALUES are locale-stable. */
function languageSelect(page: Page) {
  // Preferences now also carries a Number format select (#684); pick the language one by its label
  // in either interface language.
  return page.getByLabel(/^(Interface language|Bahasa antarmuka)$/);
}
/** The primary save button — name matches both English ("Save") and Bahasa ("Simpan") UIs. */
function saveButton(page: Page, { exact = false }: { exact?: boolean } = {}) {
  return page.getByRole('button', { name: /save|simpan/i, exact });
}

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).toHaveCount(0, { timeout: 20_000 });
}

/** Regression guard for the CSS-grid blowout (mirrors AC-CO-001c): `main` never exceeds the
 *  viewport width at 390px, in either locale. Waits for `<main>` to attach first — right after a
 *  full navigation (a fresh `page.goto`, or just after a locale switch re-fetches catalogues) the
 *  SPA shell can still be booting when this runs. */
async function expectNoHorizontalOverflow(page: Page) {
  await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    return { mainWidth: Math.round(main.getBoundingClientRect().width), vw: window.innerWidth };
  });
  expect(overflow.mainWidth).toBeLessThanOrEqual(overflow.vw + 1);
}

test(
  'AC-LRC-013: at 390px, narrowing Companies + opening + returning by keyboard (English) and by touch (Bahasa Indonesia) stay usable and restore the working set',
  async ({ page }) => {
    await signIn(page, 'finance@acme.test');

    // ── English pass: KEYBOARD-driven return ──────────────────────────────────────────────
    await page.goto('/companies');
    await waitReady(page);
    await expectNoHorizontalOverflow(page);

    await page.getByRole('tab', { name: /^Vendor$/i }).click();
    await expect(page).toHaveURL(/[?&]type=Vendor/);
    const searchEn = page.getByRole('searchbox', { name: /Search companies/i });
    await searchEn.fill('e');
    await expect(page).toHaveURL(/[?&]q=e(&|$)/);

    await page.getByRole('button', OPEN_CABLECORE).click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await expect(page.getByTestId('record-header')).toContainText('CableCore Electrical');

    const backBtnEn = page.getByRole('button', { name: 'Back to Companies', exact: true });
    await expect(backBtnEn).toBeVisible();
    await backBtnEn.focus();
    await expect(backBtnEn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]type=Vendor/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=e(&|$)/);
    await waitReady(page);
    await expect(page.getByRole('tab', { name: /^Vendor$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(searchEn).toHaveValue('e');
    await expectNoHorizontalOverflow(page);

    // ── Switch to Bahasa Indonesia through the account menu (own profile) ─────────────────
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: /profile & preferences/i }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(languageSelect(page)).toBeVisible();
    await languageSelect(page).selectOption('id');
    await saveButton(page, { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');

    // ── Bahasa pass: TOUCH-driven return ───────────────────────────────────────────────────
    await page.goto('/companies');
    await waitReady(page);
    await expectNoHorizontalOverflow(page);

    // The Vendor tab's label IS translated (`companies.type.vendor`); the Bahasa word happens to
    // be "Vendor" as well, so the same tab name is correct in both locales. The `?type=` URL value
    // is the untranslated enum by design (listWorkingSet.ts).
    await page.getByRole('tab', { name: /^Vendor$/i }).click();
    await expect(page).toHaveURL(/[?&]type=Vendor/);
    const searchId = page.getByRole('searchbox', { name: 'Cari perusahaan', exact: true });
    await expect(searchId).toBeVisible();
    await searchId.fill('e');
    await expect(page).toHaveURL(/[?&]q=e(&|$)/);

    await page.getByRole('button', OPEN_CABLECORE).tap();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+$/i, { timeout: 15_000 });
    await expect(page.getByTestId('record-header')).toContainText('CableCore Electrical');

    const backBtnId = page.getByRole('button', { name: 'Kembali ke Perusahaan', exact: true });
    await expect(backBtnId).toBeVisible();
    await backBtnId.tap();
    await expect(page).toHaveURL(/[?&]type=Vendor/, { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]q=e(&|$)/);
    await waitReady(page);
    await expect(page.getByRole('tab', { name: /^Vendor$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(searchId).toHaveValue('e');
    await expectNoHorizontalOverflow(page);
  },
);

test.afterEach(async ({ page }) => {
  // Restore finance@acme.test's shared seed profile to its NULL (inherit → English) override,
  // even after a mid-test failure, so the serial lane stays clean for the next run.
  const accountTrigger = page.getByRole('button', { name: /account menu|menu akun/i });
  if (await accountTrigger.count()) {
    await accountTrigger.click();
    await page
      .getByRole('menuitem', { name: /profile & preferences|profil & preferensi/i })
      .click();
  } else {
    await page.goto('/settings/profile');
  }
  await expect(languageSelect(page)).toBeVisible();
  await languageSelect(page).selectOption('inherit');
  await saveButton(page).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
