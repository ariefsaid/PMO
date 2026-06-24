/**
 * AC-IMP-CYCLE-001 — Procurement-cycle bulk import: curated cross-stack journey (ADR-0035 M5).
 *
 * An admin uploads a one-sheet .xlsx with TWO cases:
 *   (a) case-001: a partial PR→VI→Payment case (no PO/Quotation — partial but valid under Model-C)
 *   (b) case-002: a PR-less VI→Payment case (no PR/PO required under Model-C)
 *
 * Goal oracle (binding — the app conforms to this, not the reverse):
 *   BOTH cases appear in the /procurement list after the import completes.
 *   case-001's title "E2E Full Case <runId>" is visible.
 *   case-002's title "E2E Invoice-only <runId>" is visible.
 *   Neither case is present BEFORE the import (created in this run only).
 *   The import wizard closes and the list is refreshed automatically.
 *
 * Journey: /procurement → "Import cycle" button → upload xlsx → mapping auto-maps
 * → preview shows 2 cases → "Import N records" → result summary → Done → list refetched.
 *
 * Isolation strategy: runId = Date.now() makes titles unique per attempt;
 * no seed rows needed (all data created in-test via the real import RPC chain).
 *
 * BDD authoring principle: test encodes the user's intuitive goal, not app internals.
 * On failure: fix the APP; only update the journey if a deliberate UX change was made.
 */

import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { login } from './helpers';

test.setTimeout(180_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitIndexReady(page: Page) {
  await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });
}

/**
 * Build a real .xlsx buffer that matches the 10-column cycle sheet contract:
 * case_ref | type | project | title | case_status | vendor | external_ref | status | date | amount
 */
async function buildCycleXlsx(
  fullTitle: string,
  invoiceTitle: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cycles');

  // Header row (matches the fixed 10-column contract)
  ws.addRow([
    'case_ref',
    'type',
    'project',
    'title',
    'case_status',
    'vendor',
    'external_ref',
    'status',
    'date',
    'amount',
  ]);

  // ── case-001: partial PR→VI→Payment (no PO/Quotation — still legal under Model-C) ──
  // PR row
  ws.addRow(['case-001', 'PR', '', fullTitle, 'Draft', '', 'EXT-PR-001', '', '', '']);
  // VI row (required: status ∈ {Received,Scheduled,Paid}, date YYYY-MM-DD)
  ws.addRow(['case-001', 'VI', '', '', '', '', 'EXT-VI-001', 'Received', '2024-03-15', '10000']);
  // Payment row
  ws.addRow(['case-001', 'Payment', '', '', '', '', 'EXT-PAY-001', '', '2024-03-20', '10000']);

  // ── case-002: PR-less VI→Payment (Model-C: no PR or PO required) ────────────
  // VI row
  ws.addRow(['case-002', 'VI', '', invoiceTitle, '', '', 'EXT-VI-002', 'Received', '2024-04-01', '5000']);
  // Payment row
  ws.addRow(['case-002', 'Payment', '', '', '', '', 'EXT-PAY-002', '', '2024-04-05', '5000']);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ── Test ──────────────────────────────────────────────────────────────────────

test(
  'AC-IMP-CYCLE-001: admin imports a cycle xlsx with a full case and a PR-less case — both cases land in the procurement list',
  async ({ page }) => {
    const runId = Date.now();
    const fullTitle = `E2E Full Case ${runId}`;
    const invoiceTitle = `E2E Invoice-only ${runId}`;

    const xlsx = await buildCycleXlsx(fullTitle, invoiceTitle);

    // ── Step 1: navigate to /procurement as admin ──────────────────────────────
    await login(page, 'admin@acme.test');
    await page.goto('/procurement');
    await waitIndexReady(page);

    // Confirm neither case exists yet
    await expect(page.getByText(fullTitle)).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(invoiceTitle)).not.toBeVisible({ timeout: 5_000 });

    // ── Step 2: open the cycle import wizard ──────────────────────────────────
    const cycleImportBtn = page.getByRole('button', { name: /import cycle/i });
    await expect(cycleImportBtn).toBeVisible({ timeout: 10_000 });
    await cycleImportBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });

    // Title confirms it's the cycle wizard
    await expect(dialog.getByRole('heading', { name: /import procurement cycle/i })).toBeVisible();

    // ── Step 3: upload the xlsx ───────────────────────────────────────────────
    await dialog.getByLabel(/choose an \.xlsx file/i).setInputFiles({
      name: 'cycles.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsx,
    });

    // ── Step 4: mapping step — auto-mapped (exact header names match contract) ─
    const nextBtn = dialog.getByRole('button', { name: /^next$/i });
    await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
    await nextBtn.click();

    // ── Step 5: preview — 2 cases shown; zero writes yet ─────────────────────
    const summary = dialog.getByTestId('cycle-import-summary');
    await expect(summary).toBeVisible({ timeout: 10_000 });
    await expect(summary).toContainText('2 cases');

    // Both case refs visible in the preview tree
    await expect(dialog.getByText('case-001')).toBeVisible();
    await expect(dialog.getByText('case-002')).toBeVisible();

    // ── Step 6: confirm the import (the single explicit write) ────────────────
    const importBtn = dialog.getByRole('button', { name: /import \d+ record/i });
    await expect(importBtn).toBeEnabled({ timeout: 5_000 });
    await importBtn.click();

    // ── Step 7: result step shows created count ──────────────────────────────
    const resultSummary = dialog.getByTestId('cycle-result-summary');
    await expect(resultSummary).toBeVisible({ timeout: 30_000 });
    // 5 records total: 3 for case-001 (PR+VI+Payment), 2 for case-002 (VI+Payment)
    await expect(resultSummary).toContainText('created');

    // ── Step 8: Done — closes wizard and refetches list ───────────────────────
    await dialog.getByRole('button', { name: /^done$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // ── GOAL ORACLE: BOTH cases appear in the procurement list ────────────────
    // The list auto-refetches on wizard close (didImport=true → onClose(true) → refetch).
    await expect(page.getByText(fullTitle)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(invoiceTitle)).toBeVisible({ timeout: 30_000 });
  },
);
