// @e2e-isolation: read-only — rich seed navigation; no writes.
/**
 * UIP-006 — pm/finance contract and committed values remain visible at 1440px.
 *
 * Phase 2 (#1529) moved the UIP-005 tab work-fold battery and the UX-006 coarse-pointer hit area to
 * the /projects/:id layout sweep (e2e/layout/project-detail.layout.spec.ts). These remaining tests
 * are the DOWN lane's MOVE-COMPONENT rows (target:
 * pmo-portal/pages/project-detail/__tests__/ProjectOverview.moneyPosition.test.tsx) and stay in the
 * browser until that lane moves them below the browser.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

const projectPath = '/projects/41000000-0000-0000-0000-000000000001';

// #1402: seed.sql:935-950 has Paid USD 1,680,000 + Ordered USD 680,000, for 2,360,000 committed.
for (const role of ['pm', 'finance'] as const) {
  test(`UIP-006: ${role} contract and committed values remain visible at 1440px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, `${role}@acme.test`);
    await page.goto(`${projectPath}/overview`);
    const contractAmount = page.getByRole('region', { name: 'Money position' }).getByTestId('contract-value-amount');
    const budgetActual = page.getByRole('region', { name: 'Budget vs actual' });
    const committedValue = budgetActual.getByText('Plus 2,360,000 committed in purchase orders', { exact: true });
    await expect(contractAmount).toBeVisible();
    // #1402 copy (#1437): the block names USD once in its unit; keep the seeded committed total exact.
    await expect(budgetActual.getByText('USD · excl. PPN', { exact: true })).toBeVisible();
    await expect(committedValue).toHaveText('Plus 2,360,000 committed in purchase orders');
    // look relation retired: recomposed (#1402)
  });
}
