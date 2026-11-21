// @e2e-isolation: read-only — signs in as the seed Finance user and only navigates; the seed organisation has no accounting system connected in this lane.
// AC-NEF-001 / AC-NEF-002 — with no accounting system connected, Statements leads to the management profit and loss.
// Goal oracle: Finance opens Statements, reads that ledger statements come from an accounting system when one is connected, and reaches the management pack.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

const localized = (en: string, id: string) => new RegExp(`(?:${en}|${id})`, 'i');

test('AC-NEF-001 Statements shows the management profit and loss and Open reports reaches the pack', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto('/finance/statements');
  await expect(page.getByRole('heading', { name: localized('Management profit and loss', 'Laba rugi manajemen') })).toBeVisible();
  await expect(page.getByText(localized('come from an accounting system when one is connected', 'berasal dari sistem akuntansi'))).toBeVisible();
  await expect(page.getByText(localized('No statements yet', 'Belum ada laporan'))).toHaveCount(0);
  await page.getByRole('button', { name: localized('Open reports', 'Buka laporan') }).click();
  await expect(page).toHaveURL(/\/finance\/reports/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});
