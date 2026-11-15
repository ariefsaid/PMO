// @e2e-isolation: read-only — types into the log-activity form but never submits; no DB write.
import { test, expect, type Page } from '@playwright/test';
import { login, pinEnglishLocale } from './helpers';

/**
 * AC-WIG-2080 (#2080): at phone width, every way out of a company page holding a half-written
 * activity asks first — the bottom bar, the More drawer and browser Back. Keep editing keeps the
 * typed text; Discard performs the exit the user asked for.
 *
 * GOAL ORACLE: the "Discard your changes?" sheet appears, the URL has NOT changed, and the typed
 * subject is still there; after Discard the destination loads.
 */
test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120_000);

// Seed: Meridian Steelworks has three contacts, so the Log-activity form is on the page.
const COMPANY = '/companies/c0000000-0000-0000-0000-000000000002';

async function startDraft(page: Page) {
  await pinEnglishLocale(page);
  await login(page, 'admin@acme.test');
  await page.goto(COMPANY);
  const subject = page.getByLabel('Subject');
  await expect(subject).toBeVisible({ timeout: 20_000 });
  await subject.fill('Half-written call');
  return subject;
}

async function expectSheetThenKeep(page: Page) {
  const sheet = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(sheet).toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveURL(new RegExp(`${COMPANY}$`));
  await sheet.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByLabel('Subject')).toHaveValue('Half-written call');
}

test('AC-WIG-2080: the phone bottom bar asks before leaving a half-written activity', async ({ page }) => {
  await startDraft(page);
  await page.getByTestId('phone-nav').getByRole('link').nth(1).click();
  await expectSheetThenKeep(page);
});

test('AC-WIG-2080: the More drawer asks before leaving a half-written activity', async ({ page }) => {
  await startDraft(page);
  await page.getByTestId('phone-nav').getByRole('button', { name: 'More' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Contacts' }).click();
  await expectSheetThenKeep(page);
});

test('AC-WIG-2080: browser Back asks, and Discard then goes back', async ({ page }) => {
  await login(page, 'admin@acme.test');
  await pinEnglishLocale(page);
  await page.goto('/companies');
  // In-app navigation, so Back is a router history change (a second page.goto would be a document load).
  await page.getByRole('button', { name: 'Open Meridian Steelworks' }).first().click();
  await expect(page).toHaveURL(new RegExp(`${COMPANY}$`));
  await expect(page.getByLabel('Subject')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Subject').fill('Half-written call');
  await page.goBack();
  const sheet = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(sheet).toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveURL(new RegExp(`${COMPANY}$`));
  await sheet.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/companies$/);
});
