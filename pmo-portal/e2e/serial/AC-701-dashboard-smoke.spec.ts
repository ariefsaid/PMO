// @e2e-isolation: serial — same reason as AC-1117: it asserts the org's company-wide on-hand figures,
// which any parallel-lane spec that creates a project shifts (confirmed on the v0.35 release run).
import { test, expect } from '@playwright/test';
import { login } from '../helpers';
import { overrideProfile, localePatch } from '../support/profile-override';

async function pinViewerLocale(page: import('@playwright/test').Page) {
  await overrideProfile(page, localePatch('en'));
}

// AC-701 (+ AC-709 org-scope) — real RPC over the real seed yields org-scoped KPIs in the real UI.
test('AC-701 Executive sees real org-scoped KPI values from the RPC', async ({ page }) => {
  await pinViewerLocale(page);
  await login(page, 'exec@acme.test');
  await expect(page).toHaveURL(/\/$/);
  // #1403 owner ruling: active-contract tile removed; on-hand is the company figure
  const companyFigures = page.getByRole('region', { name: 'Company figures' });
  const contractTile = companyFigures.getByText('Contract on hand · excl. tax', { exact: true }).locator('xpath=../..');
  // SP-2401 + SP-2402 + P001 + P003 + P013 = 5 Ongoing projects (rich solar seed, PR-#118 resync)
  // The tile names the signed-contract count explicitly; its count and RPC value remain the oracle.
  await expect(contractTile).toContainText('7 with a signed contract', { timeout: 20_000 });
  // Contract on hand includes the canonical USD on-hand basis: $23.05M ongoing plus $10M won/close-out.
  await expect(contractTile).toContainText('$33.1M');
  await expect(contractTile.locator('[title="$33,050,000"]')).toBeVisible();
});
