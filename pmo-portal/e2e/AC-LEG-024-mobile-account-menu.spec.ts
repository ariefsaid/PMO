// @e2e-isolation: read-only — signIn + mobile account menu nav to bare legal pages; no DB writes.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-LEG-024 — mobile account menu (<640px) Terms/Privacy links work. The entries
 * live in the real `acctOpen` dropdown (ContextBar.tsx). Each click leaves the
 * shell and lands on the bare public page (FR-LEG-003) — proven by the absence of
 * the ContextBar banner landmark.
 *
 * The Help leg is UNIT-OWNED (Director decision, ADR-0010 lowest-sufficient-layer):
 * navigating to an external wa.me URL is not meaningfully e2e-testable, and asserting
 * it here required VITE_HELP_WHATSAPP in the dev-server env — a fragility that bought
 * no real coverage. `src/components/shell/ContextBar.test.tsx` (AC-LEG-023) already
 * asserts the mobile-menu Help anchor's href/target/rel against an injected
 * legalConfig value.
 */
test.describe('AC-LEG-024 mobile account menu links', () => {
  test('AC-LEG-024 Terms / Privacy from the mobile account menu', async ({ page }) => {
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
  });
});
