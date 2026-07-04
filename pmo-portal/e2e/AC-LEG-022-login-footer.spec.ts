import { test, expect } from '@playwright/test';

/**
 * AC-LEG-022 — login footer links navigate correctly (cross-stack: rendered footer
 * link → router navigation / new tab). The footer lives on /login (unauthed), so no
 * signIn is needed. Help-leg opens wa.me in a new tab and requires VITE_HELP_WHATSAPP
 * in the dev-server env (see docs/plans/2026-07-04-legal-pages.md Slice 6 prerequisite).
 */
test.describe('AC-LEG-022 login footer links navigate correctly', () => {
  test('AC-LEG-022 Terms / Privacy / Help from the login footer', async ({ page }) => {
    await page.goto('/login');
    const footer = page.getByRole('contentinfo');

    // Terms → /terms
    await footer.getByRole('link', { name: /^terms$/i }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('heading', { level: 1, name: /terms of service/i })).toBeVisible();

    // Privacy → /privacy
    await page.goto('/login');
    await page.getByRole('contentinfo').getByRole('link', { name: /^privacy$/i }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeVisible();

    // Help → wa.me in a new tab (target=_blank). page.waitForEvent('popup') — the
    // type-safe pattern this repo already uses (e2e/AC-DOC-020…spec.ts:117);
    // context.waitForEvent('popup') does not type-check against this Playwright version.
    await page.goto('/login');
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('contentinfo').getByRole('link', { name: /contact support via whatsapp/i }).click();
    const newTab = await popupPromise;
    await expect.poll(() => newTab.url()).toContain('https://wa.me/');
    await newTab.close();
  });
});
