// @e2e-isolation: self-isolated — unique company names (Date.now()), upload xlsx → preview → confirm; valid row created, invalid skipped; no seed coupling.
import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { login } from './helpers';

/**
 * AC-IMP-011  Bulk import — real cross-stack journey (binding BDD authoring principle).
 *
 * An admin uploads a 2-row .xlsx (one valid row + one invalid bad-enum row) → the wizard
 * auto-maps the columns → the preview shows the valid/invalid/total split with ZERO writes →
 * the admin confirms once → only the valid row is created via the real companies insert (RLS
 * stamps org_id) → on Done the list refetches and the new company is present.
 *
 * Goal oracle: after confirm + Done, the valid company's row IS in the Companies list and the
 * invalid one is NOT.
 */

test.setTimeout(120_000);

async function waitReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

/** The DataTable activation button is the stable, exact per-row doorway (mirrors AC-CO-001).
 *  CW-4b: rows navigate to /companies/:id — the activation button reads "Open <name>". */
function companyRow(page: Page, name: string) {
  return page.locator('table tbody tr').filter({
    has: page.getByRole('button', { name: `Open ${name}`, exact: true }),
  });
}

/** Build a real .xlsx buffer in-test (exceljs is a project dep). */
async function buildXlsx(rows: [string, string][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Companies');
  ws.addRow(['Company name', 'Type']);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

test(
  'AC-IMP-011: admin uploads a 2-row xlsx → maps → previews valid/invalid → confirms → the valid row appears in the Companies list (the invalid row does not)',
  async ({ page }) => {
    const runId = Date.now();
    const validName = `E2E-Import-${runId}`;
    const invalidName = `E2E-Import-Bad-${runId}`;
    const xlsx = await buildXlsx([
      [validName, 'Vendor'], // valid
      [invalidName, 'Partner'], // invalid enum → skipped, never created
    ]);

    await login(page, 'admin@acme.test');
    await page.goto('/companies');
    await waitReady(page);

    // ── Step 1: open the wizard from the toolbar Import button ─────────────────
    await page.getByRole('button', { name: /^import$/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });

    // ── Step 2: upload the xlsx (the hidden file input) ────────────────────────
    await dialog.getByLabel(/choose an \.xlsx file/i).setInputFiles({
      name: 'companies.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsx,
    });

    // ── Step 3: mapping auto-resolved → Next ───────────────────────────────────
    const nextBtn = dialog.getByRole('button', { name: /^next$/i });
    await expect(nextBtn).toBeEnabled({ timeout: 8_000 });
    await nextBtn.click();

    // ── Step 4: preview — 1 valid, 1 invalid, 2 total; NO write yet ────────────
    const summary = dialog.getByTestId('import-summary');
    await expect(summary).toContainText('1 valid');
    await expect(summary).toContainText('1 invalid');
    await expect(summary).toContainText('2 total');

    // ── Step 5: confirm the import (the single explicit write action) ──────────
    await dialog.getByRole('button', { name: /import 1 companies/i }).click();

    // result summary then Done (closing refetches the list)
    await expect(dialog.getByTestId('import-result-summary')).toContainText('1 created', {
      timeout: 15_000,
    });
    await dialog.getByRole('button', { name: /^done$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // ── GOAL ORACLE: the valid row IS in the list; the invalid one is NOT ──────
    const validRow = companyRow(page, validName);
    await expect(validRow).toBeVisible({ timeout: 15_000 });
    await expect(validRow.getByText('Vendor')).toBeVisible();
    await expect(companyRow(page, invalidName)).not.toBeVisible({ timeout: 5_000 });
  },
);
