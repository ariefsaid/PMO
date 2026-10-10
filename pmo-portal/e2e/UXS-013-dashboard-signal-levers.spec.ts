// @e2e-isolation: read-only — dashboard signal→lever journeys; nav/assert only over seeded data, no DB writes.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

/**
 * UXS-013 — a named risk/budget signal carries its own lever (rendered acceptance).
 *
 * Slice 7 oracles (2026-10-10 UX Discover synthesis §4):
 * - Rich phone risk journey: at 390×844 the Executive's "Projects at risk" block shows the seeded
 *   at-risk count with a risk-SPECIFIC doorway (`/projects?filter=at-risk`), not the all-projects
 *   link, and acting on it reaches the flagged record's filtered list (UXD-A-001).
 * - Finance one-step budget drill: the Budget review table's project cell is a semantic link into
 *   the canonical project Budget tab (`/projects/:id/budget`) — one activation from signal to lever
 *   (UXD-A-006). Amounts/ranking are untouched (fence): this spec only follows the existing link.
 *
 * Seed: SP-2402 "Cascade Foods 6.0 MW Ground-Mount PV" is the deliberate at-risk fixture
 * (committed spend over its 6,900,000 budget), so it appears in the at-risk filter and in the
 * budget review rows. Both journeys are navigation-only; locale defaults to en (id parity is
 * asserted at the component layer).
 */

const SP2402_ID = '41000000-0000-0000-0000-000000000002';
const SP2402_NAME = 'Cascade Foods 6.0 MW Ground-Mount PV';

test.describe('UXS-013 — a dashboard signal carries its lever', () => {
  test('phone Executive reaches the flagged project from the at-risk signal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'exec@acme.test');
    await page.goto('/');
    await waitForFonts(page);

    // The risk block carries a risk-specific doorway (zero risks render no false action).
    const riskLink = page.getByRole('link', { name: /Review \d+ at-risk projects?/ });
    await expect(riskLink).toBeVisible();
    await expect(riskLink).toHaveAttribute('href', '/projects?filter=at-risk');

    // Acting on the signal lands on the risk-filtered list, where the flagged record is reachable.
    await riskLink.click();
    await expect(page).toHaveURL(/\/projects\?filter=at-risk/);
    await expect(page.getByText(SP2402_NAME).first()).toBeVisible();
  });

  test('Finance opens the flagged project Budget tab from the budget exception in one step', async ({
    page,
  }) => {
    await signIn(page, 'finance@acme.test');
    await page.goto('/');
    await waitForFonts(page);

    // The budget exception names the project, and the name itself is the lever.
    const budgetLink = page.getByRole('link', { name: `Review ${SP2402_NAME} budget` });
    await expect(budgetLink).toBeVisible();

    await budgetLink.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${SP2402_ID}/budget$`));
    // The canonical Budget tab actually rendered (budget version card present).
    await expect(page.getByTestId('version-card').first()).toBeVisible();
  });
});
