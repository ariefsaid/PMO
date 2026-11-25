// @e2e-isolation: self-isolated — a disposable login on the seed org; only that person's own language preference changes, and the login is deleted in finally.
/**
 * JOB-A5 — English and Bahasa. A user switches their interface language in their profile.
 * Goal oracle: the navigation reads in Bahasa Indonesia, and the choice survives a reload.
 */
import { test, expect } from '@playwright/test';
import { runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

test('JOB-A5 a user switches the profile language to Bahasa Indonesia and the navigation follows', async ({ page }) => {
  const svc = serviceClient('JOB-A5');
  const user = await roleJobUser(svc, 'engineer', runId('a5-eng'));
  try {
    await user.signIn(page);
    await page.getByRole('button', { name: /account menu|menu akun/i }).click();
    await page.getByRole('menuitem', { name: /profile & preferences|profil & preferensi/i }).click();
    await page.getByLabel(/^(Interface language|Bahasa antarmuka)$/).selectOption('id');
    await page.getByRole('button', { name: /^(save|simpan)$/i }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.getByRole('navigation', { name: 'Jejak navigasi' })).toContainText('Profil & preferensi');

    // The choice is kept for the person, not just this page.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.getByRole('link', { name: 'Proyek', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await user.cleanup();
  }
});
