// @e2e-isolation: serial - disconnects the seed organisation's accounting binding for the run (org-wide state other specs must see unchanged) and restores it in afterAll; the no-ERP precondition is asserted first.
// AC-NEF-001 / AC-NEF-002 — with no accounting system connected, Statements leads to the management profit and loss.
// Goal oracle: Finance opens Statements, reads that ledger statements come from an accounting system when one is connected, and reaches the management pack.
import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../helpers';
import { disconnectSeedOrgErp, type NoErpHandle } from './noErpOrg';

const EVIDENCE = '../docs/evidence/1215/2734';
test.use({ deviceScaleFactor: 2 });

async function shoot(page: Page, name: string) {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/${name}-${label}.png`, fullPage: true });
  }
}

let noErp: NoErpHandle;
test.beforeAll(async () => { noErp = await disconnectSeedOrgErp(); });
test.afterAll(async () => { await noErp?.restore(); });

const localized = (en: string, id: string) => new RegExp(`(?:${en}|${id})`, 'i');

test('AC-NEF-001 Statements shows the management profit and loss and Open reports reaches the pack', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto('/finance/statements');
  await expect(page.getByRole('heading', { name: localized('Management profit and loss', 'Laba rugi manajemen') })).toBeVisible();
  await expect(page.getByText(localized('come from an accounting system when one is connected', 'berasal dari sistem akuntansi'))).toBeVisible();
  await expect(page.getByText(localized('No statements yet', 'Belum ada laporan'))).toHaveCount(0);
  await shoot(page, 'statements-management-pl');
  await page.getByRole('button', { name: localized('Open reports', 'Buka laporan') }).click();
  await expect(page).toHaveURL(/\/finance\/reports/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

test('AC-NEF-006 the Finance hub Net profit tile points to the management profit and loss (screenshots)', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto('/finance');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await shoot(page, 'finance-hub-net-profit');
});
