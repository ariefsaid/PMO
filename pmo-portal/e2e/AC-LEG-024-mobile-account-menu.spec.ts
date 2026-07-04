import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-LEG-024 — mobile account menu (<640px) links work. The entries live in the
 * real `acctOpen` dropdown (ContextBar.tsx). Each Terms/Privacy click leaves the
 * shell and lands on the bare public page (FR-LEG-003) — proven by the absence of
 * the ContextBar banner landmark. Help-leg requires VITE_HELP_WHATSAPP (see plan
 * Slice 6 prerequisite).
 */
test.describe('AC-LEG-024 mobile account menu links', () => {
  test('AC-LEG-024 Terms / Privacy / Help from the mobile account menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/'); // inside the shell so the ContextBar renders

    // Terms
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByTestId('mobile-account-menu').getByRole('menuitem', { name: /^terms$/i }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('banner')).toHaveCount(0); // bare page — no ContextBar

    // Privacy
    await page.goto('/');
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByTestId('mobile-account-menu').getByRole('menuitem', { name: /^privacy$/i }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('banner')).toHaveCount(0);

    // Help → wa.me new tab. page.waitForEvent('popup') — the type-safe pattern this
    // repo already uses (e2e/AC-DOC-020…spec.ts:117); context.waitForEvent('popup')
    // does not type-check against this Playwright version.
    await page.goto('/');
    await page.getByRole('button', { name: /account menu/i }).click();
    const popupPromise = page.waitForEvent('popup');
    await page.getByTestId('mobile-account-menu').getByRole('menuitem', { name: /contact support via whatsapp/i }).click();
    const newTab = await popupPromise;
    await expect.poll(() => newTab.url()).toContain('https://wa.me/');
    await newTab.close();
  });
});
