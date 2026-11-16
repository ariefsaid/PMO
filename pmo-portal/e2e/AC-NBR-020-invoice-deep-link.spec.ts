// @e2e-isolation: read-only — opens a seeded invoice by deep link and holds the list request; no DB writes.
/**
 * AC-NBR-020 (#2197) — Given a Finance user and a slow invoice-list request, when they open an invoice deep
 * link, the invoice record shows before the list request finishes.
 * Goal oracle: the invoice number heading is visible while the list read is still held.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

const SEEDED_INVOICE_ID = 'b5000000-0000-0000-0000-000000000001';
const SEEDED_INVOICE_NUMBER = 'DEMO-SI-2402-001';
const LIST_DELAY_MS = 3000;

test('AC-NBR-020 invoice deep link shows the record before the list request finishes', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  // Warm the dev bundle first so the timing below measures the data reads, not a cold compile.
  await page.goto('/sales-invoices');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  let listReleasedAt = 0;
  await page.route(/\/rest\/v1\/sales_invoices\?/, async (route) => {
    const url = route.request().url();
    // Hold the list read only; the by-id read carries an id filter and goes straight through.
    if (/[?&]id=eq\./.test(url)) return route.continue();
    await new Promise((resolve) => setTimeout(resolve, LIST_DELAY_MS));
    listReleasedAt = Date.now();
    return route.continue();
  });
  await page.goto(`/sales-invoices/${SEEDED_INVOICE_ID}`);
  await expect(page.getByText(SEEDED_INVOICE_NUMBER).first()).toBeVisible({ timeout: LIST_DELAY_MS - 500 });
  expect(listReleasedAt, 'the record showed while the list request was still held').toBe(0);
});
