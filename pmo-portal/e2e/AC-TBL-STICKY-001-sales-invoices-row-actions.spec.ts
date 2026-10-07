// @e2e-isolation: read-only — this spec signs in, stubs the Sales Invoices GET response, and measures layout; it performs no database write.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

const ORG = '00000000-0000-0000-0000-000000000001';
const EPSILON = 1;
const INVOICE = {
  id: 'aaaaaaaa-0000-0000-0000-000000000925',
  org_id: ORG,
  project_id: '40000000-0000-0000-0000-000000000013',
  customer_id: '30000000-0000-0000-0000-000000000001',
  si_number: 'SI-2026-00925',
  reference_number: `PO-${'WIDE-REFERENCE-'.repeat(20)}`,
  invoice_date: '2026-10-01',
  amount: 180_000_000,
  currency: 'IDR',
  tax_treatment: 'exclusive',
  tax_amount: 0,
  tax_rate: 11,
  tax_base_numerator: 1,
  tax_base_denominator: 1,
  erp_outstanding_amount: 180_000_000,
  status: 'Unpaid',
  erp_docstatus: 1,
  erp_modified: '2026-10-01T00:00:00Z',
  erp_amended_from: null,
  erp_cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z',
  author_user_id: null,
  sales_invoice_authors: [],
  erp_due_date: null,
  received_date: null,
  efaktur_number: null,
  efaktur_date: null,
  companies: { name: 'Northwind Contracting', erp_payment_terms_days: 30 },
};

test.describe('AC-TBL-STICKY-001 Sales Invoices row-actions geometry', () => {
  for (const width of [1280, 1440]) {
    test(`AC-TBL-STICKY-001: row-actions trigger stays inside the table scroller at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route('**/rest/v1/sales_invoices?**', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({ json: [INVOICE] });
      });
      await signIn(page, 'finance@acme.test');
      await page.goto('/sales-invoices');

      const scroller = page.getByTestId('dt-table-branch');
      await expect(scroller).toBeVisible({ timeout: 20_000 });
      await expect(scroller.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
      await expect(scroller.locator('tbody button[aria-label="Row actions"]').first()).toBeVisible();
      await waitForFonts(page);

      const geometry = await scroller.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const left = box.left + Number.parseFloat(style.borderLeftWidth);
        const buttons = [...element.querySelectorAll<HTMLButtonElement>('tbody button[aria-label="Row actions"]')]
          .filter((button) => button.offsetParent !== null)
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          });
        return {
          scroller: {
            left,
            right: left + element.clientWidth,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          },
          triggers: buttons,
        };
      });

      expect(geometry.triggers.length, 'expected at least one visible row-actions trigger').toBeGreaterThan(0);
      expect(
        geometry.scroller.scrollWidth,
        `Sales Invoices table should overflow to exercise sticky actions: ${JSON.stringify(geometry.scroller)}`,
      ).toBeGreaterThan(geometry.scroller.clientWidth);
      const outside = geometry.triggers.filter(
        ({ left, right }) => left < geometry.scroller.left - EPSILON || right > geometry.scroller.right + EPSILON,
      );
      expect(
        outside,
        `row-actions trigger boxes must stay within scroller box ${JSON.stringify(geometry.scroller)}; triggers: ${JSON.stringify(geometry.triggers)}`,
      ).toEqual([]);
    });
  }
});
