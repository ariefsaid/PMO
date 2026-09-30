// @e2e-isolation: serial — writes a shared seed user's own profile preferences and restores all three to inherit in afterEach.
import { test, expect, type Page } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';

// AC-PLC-007 — on a 390px phone, a signed-in user chooses and saves all three personal display
// preferences (language, number format, timezone); the controls stay reachable, the feedback is
// understandable, and the updated display is visible without a reload — then survives one.
//
// The seed user is the timesheet co-location engineer: the least-shared seed profile (one other
// spec, in the parallel lane, which never overlaps this serial one). The spec writes that user's
// OWN preferences, so afterEach resets every override to inherit (NULL) even after a failure and
// re-reads it after a reload, so no leftover preference can leak into a later run.
const USER = 'ts-colocated-eng@acme.test';
const TIMEZONE = 'America/New_York';

test.use({ viewport: { width: 390, height: 844 } });

function languageSelect(page: Page) {
  return page.getByLabel(/interface language|bahasa antarmuka/i);
}
function numberSelect(page: Page) {
  return page.getByLabel(/number format|format angka/i);
}
function timezoneCombobox(page: Page) {
  return page.getByRole('combobox', { name: /timezone|zona waktu/i });
}
function saveButton(page: Page) {
  return page.getByRole('button', { name: /^(save|simpan)$/i });
}

async function openProfileFromAccountMenu(page: Page) {
  await page.getByRole('button', { name: /account menu|menu akun/i }).click();
  await page.getByRole('menuitem', { name: /profile & preferences|profil & preferensi/i }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(languageSelect(page)).toBeVisible();
}

/** No control may push the 390px page into horizontal scroll. */
async function expectNoHorizontalOverflow(page: Page) {
  await waitForFonts(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('AC-PLC-007: a phone user saves language, number format and timezone and sees them applied without a reload', async ({ page }) => {
  await signIn(page, USER);
  await openProfileFromAccountMenu(page);

  // Starting state: every preference inherits the seed org's defaults.
  await expect(languageSelect(page)).toHaveValue('inherit');
  await expect(numberSelect(page)).toHaveValue('inherit');
  await expect(page.getByText('Effective timezone: Asia/Jakarta')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Choose all three. English separators under a Bahasa UI proves number format is its own choice.
  await languageSelect(page).selectOption('id');
  await numberSelect(page).selectOption('en-US');
  await timezoneCombobox(page).click();
  await page.getByRole('searchbox', { name: /search timezones/i }).fill('New_York');
  await page.getByRole('listbox').getByRole('option', { name: TIMEZONE, exact: true }).click();
  await expect(timezoneCombobox(page)).toContainText(TIMEZONE);

  // The save action is reachable on the phone, and success is announced in the chosen language.
  await saveButton(page).scrollIntoViewIfNeeded();
  await expect(saveButton(page)).toBeInViewport();
  await saveButton(page).click();
  await expect(page.getByRole('status')).toHaveText('Preferensi disimpan');

  // Applied in this session, no reload: Bahasa labels, English digits, the chosen zone.
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Profil & preferensi');
  await expect(page.getByText('Bahasa aktif: Bahasa Indonesia')).toBeVisible();
  await expect(page.getByText('Format angka aktif: 1,234,567.89')).toBeVisible();
  await expect(page.getByText(`Zona waktu aktif: ${TIMEZONE}`)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Persistence: a reload reads the same three explicit choices back from the profile.
  await page.reload();
  await expect(languageSelect(page)).toHaveValue('id');
  await expect(numberSelect(page)).toHaveValue('en-US');
  await expect(timezoneCombobox(page)).toContainText(TIMEZONE);
  await expect(page.getByText(`Zona waktu aktif: ${TIMEZONE}`)).toBeVisible();
});

test.afterEach(async ({ page }) => {
  // Restore the seed user's three overrides to inherit (NULL), even after an assertion failure.
  // A direct route, not the menu: the restore must not depend on the shell a failure may have
  // left in any state. Signing in again covers a failure before the first sign-in completed.
  await signIn(page, USER);
  await page.goto('/settings/profile');
  await expect(languageSelect(page)).toBeVisible();
  await languageSelect(page).selectOption('inherit');
  await numberSelect(page).selectOption('inherit');
  await timezoneCombobox(page).click();
  await page.getByRole('listbox').getByRole('option', { name: /organization default|default organisasi/i }).click();
  await saveButton(page).click();
  await expect(page.getByRole('status')).toHaveText('Preferences saved');

  // Prove the restore persisted rather than trusting the success message.
  await page.reload();
  await expect(languageSelect(page)).toHaveValue('inherit');
  await expect(numberSelect(page)).toHaveValue('inherit');
  await expect(page.getByText('Effective timezone: Asia/Jakarta')).toBeVisible();
});
