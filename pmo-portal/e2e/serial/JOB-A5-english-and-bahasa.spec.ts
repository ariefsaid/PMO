// @e2e-isolation: serial — changes the shared PM seed profile's language and restores its NULL override in afterEach.
/**
 * JOB-A5 — English and Bahasa. A user switches their language in their profile.
 * Goal oracle: the navigation reads in Bahasa Indonesia and keeps it after a reload.
 */
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { serviceClient } from '../support/jobJourney';

const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const db = serviceClient('JOB-A5');

test.afterEach(async () => {
  const { error } = await db.from('profiles').update({ locale: null }).eq('id', PM_ID);
  if (error) throw new Error(`JOB-A5 restore language: ${error.message}`);
});

test('JOB-A5 switching the profile language to Bahasa Indonesia changes the navigation', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'pm@acme.test');
  await page.getByRole('button', { name: /account menu|menu akun/i }).click();
  await page.getByRole('menuitem', { name: /profile & preferences|profil & preferensi/i }).click();
  await page.getByLabel(/^(Interface language|Bahasa antarmuka)$/).selectOption('id');
  await page.getByRole('button', { name: /^(save|simpan)$/i }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await expect(page.getByRole('navigation', { name: 'Jejak navigasi' })).toContainText('Profil & preferensi');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await expect(page.getByRole('link', { name: 'Proyek', exact: true }).first()).toBeVisible({ timeout: 20_000 });
});
