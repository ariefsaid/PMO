// @e2e-isolation: read-only — unauth footer link navigation; no login, no DB writes.
import { test, expect } from '@playwright/test';

/**
 * AC-LEG-022 — login footer Terms/Privacy links navigate correctly (cross-stack:
 * rendered footer link → router navigation). The footer lives on /login (unauthed),
 * so no signIn is needed.
 *
 * The Help leg is UNIT-OWNED (Director decision, ADR-0010 lowest-sufficient-layer):
 * navigating to an external wa.me URL is not meaningfully e2e-testable, and asserting
 * it here required VITE_HELP_WHATSAPP in the dev-server env — a fragility that bought
 * no real coverage. `src/auth/LoginPage.test.tsx` (AC-LEG-021) already asserts the
 * footer Help anchor's href/target/rel against an injected legalConfig value.
 */
test.describe('AC-LEG-022 login footer links navigate correctly', () => {
  test('AC-LEG-022 Terms / Privacy from the login footer', async ({ page }) => {
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
  });
});
