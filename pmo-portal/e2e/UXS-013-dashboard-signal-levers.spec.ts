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
 * The Executive journey uses the seeded at-risk project and clears approval reads so the risk action
 * is the primary action. Finance gets a synthetic Budget review row whose id opens the seeded
 * project's real Budget tab. Both journeys are navigation-only. Each pins the profile response to
 * English because the shared demo DB may retain another locale; id parity is asserted at component
 * layer.
 */

const SP2402_ID = '41000000-0000-0000-0000-000000000002';
const FINANCE_FIXTURE_NAME = 'Synthetic budget exception project';

async function installFinanceBudgetFixture(page: import('@playwright/test').Page) {
  await page.route('**/rest/v1/rpc/get_finance_budget_review*', (route) => route.fulfill({
    json: [{
      id: SP2402_ID,
      name: FINANCE_FIXTURE_NAME,
      client_name: 'Synthetic client',
      status: 'Ongoing Project',
      currency: 'USD',
      budget: 690_000,
      budget_currency: 'USD',
      spent: 780_000,
      variance: -90_000,
      actual_currency: 'USD',
      actual_complete: true,
      actual_coverage_count: 5,
      actual_coverage_total: 5,
      actual_as_of: '2026-09-30T00:00:00Z',
    }],
  }));
}

/** Pin the signed-in persona's resolved locale to en for this journey, whatever the shared DB says. */
async function pinEnglishLocale(page: import('@playwright/test').Page) {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    const response = await route.fetch();
    const profile = await response.json() as Record<string, unknown> | Record<string, unknown>[];
    const localized = Array.isArray(profile)
      ? profile.map((row) => ({ ...row, locale: 'en' }))
      : { ...profile, locale: 'en' };
    await route.fulfill({ response, json: localized });
  });
}

test.describe('UXS-013 — a dashboard signal carries its lever', () => {
  test('phone Executive reaches the flagged project from the at-risk signal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await pinEnglishLocale(page);
    // Keep the risk-specific primary action in view by making this journey's approval queues clear.
    await page.route('**/rest/v1/procurements?*', (route) => route.fulfill({ json: [] }));
    await page.route('**/rest/v1/timesheets?*', (route) => route.fulfill({ json: [] }));
    await signIn(page, 'exec@acme.test');
    await page.goto('/');
    await waitForFonts(page);

    // The compact attention summary carries a risk-specific doorway (zero risks render no false action).
    const riskLink = page.getByRole('link', { name: 'Review at-risk projects' });
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
    await pinEnglishLocale(page);
    await installFinanceBudgetFixture(page);
    await signIn(page, 'finance@acme.test');
    await page.goto('/');
    await waitForFonts(page);

    // The budget exception names the project, and the name itself is the lever.
    const budgetLink = page.locator(`a[href="/projects/${SP2402_ID}/budget"]`);
    await expect(budgetLink).toBeVisible();

    await budgetLink.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${SP2402_ID}/budget$`));
    // The canonical Budget tab actually rendered (budget version card present).
    await expect(page.getByTestId('version-card').first()).toBeVisible();
  });
});
