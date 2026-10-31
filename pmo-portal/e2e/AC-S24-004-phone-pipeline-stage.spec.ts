// @e2e-isolation: read-only — pipeline reads are route-stubbed with synthetic rows; no DB writes.
/**
 * AC-S24-004 (#1400-ish redesign) — the stage/search/Lost-recovery and desktop funnel/board
 * behaviour cases. Phase 2 (#1529) moved the phone identity/geometry/disclosure/activation rows to
 * the /sales layout sweep (e2e/layout/project-detail... e2e/layout/sales.layout.spec.ts); the
 * synthetic pipeline fixtures they shared now live in e2e/support/sales-pipeline-fixtures.ts.
 *
 * These remaining tests are the DOWN lane's MOVE-COMPONENT rows (target:
 * pmo-portal/pages/SalesPipeline.test.tsx) and stay in the browser until that lane moves them.
 */
import { test, expect, type TestInfo } from '@playwright/test';
import { OPEN_PROJECTS, openSalesPipeline } from './support/sales-pipeline-fixtures';

for (const locale of ['en', 'id'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`AC-S24-004: phone stage, search, and Lost recovery in ${locale}/${theme}`, async ({ page }) => {
      await openSalesPipeline(page, locale, theme, { width: 390, height: 844 });
      const selector = page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' });
      await expect(selector).toBeVisible();
      await expect(page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' })).toHaveCount(1);
      const phoneList = page.getByTestId('sales-phone-stage-list');
      await expect(phoneList.locator(':scope > li')).toHaveCount(OPEN_PROJECTS.length);
      await selector.selectOption('Negotiation');
      await expect(page).toHaveURL(/[?&]status=Negotiation/);
      await expect(phoneList.locator(':scope > li')).toHaveCount(1);
      await expect(phoneList.getByText('Negotiation for Network Maintenance')).toBeVisible();
      await expect(phoneList.getByText('Integrated maintenance planning for regional facilities and remote teams')).toHaveCount(0);

      await page.getByRole('searchbox', { name: locale === 'id' ? 'Cari proyek' : 'Search projects' }).fill('no synthetic match');
      await expect(page.getByText(locale === 'id' ? 'Tidak ada proyek pada tahap ini' : 'No projects in this stage')).toBeVisible();
      await page.getByRole('button', { name: locale === 'id' ? 'Hapus filter' : 'Clear filters' }).click();
      await expect(page).toHaveURL(/\/sales\?view=kanban$/);
      await expect(phoneList.locator(':scope > li')).toHaveCount(OPEN_PROJECTS.length);

      await page.getByRole('tab', { name: locale === 'id' ? /Kalah/ : /Lost/ }).click();
      await expect(page).toHaveURL(/[?&]scope=Lost/);
      await expect(page).toHaveURL(/[?&]view=table/);
      await expect(page.getByText('Synthetic Lost Coverage Contract')).toBeVisible();
      await expect(page.getByText('Synthetic Declined Service Bid')).toBeVisible();
      await expect(page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' })).toHaveCount(0);
    });

    test(`AC-S24-004: desktop funnel and board in ${locale}/${theme}`, async ({ page }, testInfo: TestInfo) => {
      await openSalesPipeline(page, locale, theme, { width: 1440, height: 900 });
      await expect(page.getByRole('region', { name: /Pipeline summary|Ringkasan pipeline/i })).toBeVisible();
      await expect(page.getByTestId('stage-Leads')).toBeVisible();
      await expect(page.getByTestId('stage-Tender Submitted')).toBeVisible();
      await expect(page.getByRole('combobox', { name: locale === 'id' ? 'Tahap pipeline' : 'Pipeline stage' })).toHaveCount(0);
      const desktopBoard = page.locator('.kanban-scroll');
      const desktopShot = testInfo.outputPath(`S24-desktop-${locale}-${theme}-1440.png`);
      await desktopBoard.screenshot({ path: desktopShot, animations: 'disabled' });
      await testInfo.attach(`S24 desktop board ${locale} ${theme} 1440`, { path: desktopShot, contentType: 'image/png' });
    });
  }
}
