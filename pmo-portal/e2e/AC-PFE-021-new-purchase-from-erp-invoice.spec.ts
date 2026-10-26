// @e2e-isolation: self-isolated — creates its own project and ERP invoice row, deletes them (and the purchase it makes) after.
/** AC-PFE-021 — goal: the ERP invoice becomes a PMO purchase on the project, shown From ERPNext, status Vendor Invoiced, gone from the orphan list. */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey, clickOrphanAction } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const svcKey = requireServiceRoleKey();
test.skip(!svcKey, 'AC-PFE-021: SUPABASE_SERVICE_ROLE_KEY not set (local) — skipping');

test('AC-PFE-021: New purchase from an ERPNext invoice', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, svcKey!);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const projectId = crypto.randomUUID();
  const invoice = `ACC-PINV-PFE-${suffix}`;
  await admin.from('projects').insert({ id: projectId, org_id: ORG_ID, name: `PFE e2e ${suffix}`, status: 'Ongoing Project' }).throwOnError();
  await admin.from('erp_purchase_documents').insert({
    org_id: ORG_ID, erp_doctype: 'Purchase Invoice', erp_name: invoice, supplier: `SUP-${suffix}`,
    supplier_name: `PFE Supplier ${suffix}`, doc_date: '2026-02-01', currency: 'IDR', grand_total: 4_321_000, net_total: 3_900_000,
    outstanding_amount: 0, erp_status: 'Paid', erp_docstatus: 1, project_ids: [projectId], erp_modified: '2026-02-01 10:00:00',
  }).throwOnError();
  let purchaseId: string | null = null;
  try {
    await signIn(page, 'finance@acme.test');
    await page.goto(`/projects/${projectId}/procurement`);
    const orphans = page.getByRole('table', { name: 'ERPNext documents not in a purchase' });
    await clickOrphanAction(page, orphans.locator('tr', { hasText: invoice }), 'New purchase from this');
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}/);
    purchaseId = page.url().match(/procurement\/([0-9a-f-]{36})/)![1];

    // GOAL: the purchase is at the invoiced step (the status follows the linked invoice).
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Vendor Invoiced', { timeout: 15_000 });
    await page.getByRole('navigation', { name: 'Procurement sections' }).getByRole('link', { name: 'Documents' }).click();
    const linked = page.getByRole('row', { name: new RegExp(invoice) });
    await expect(linked).toContainText('From ERPNext');
    // Pre-tax or gross — the invoice's own amount is on the row, in rupiah.
    await expect(linked).toContainText(/(4[.,]321[.,]000|3[.,]900[.,]000)/);

    await page.goto(`/projects/${projectId}/procurement`);
    await expect(page.getByRole('row', { name: new RegExp(invoice) })).toHaveCount(0);
  } finally {
    if (purchaseId) {
      await admin.from('procurement_erp_links').delete().eq('procurement_id', purchaseId);
      await admin.from('procurement_status_events').delete().eq('procurement_id', purchaseId);
      await admin.from('procurements').delete().eq('id', purchaseId);
    }
    await admin.from('erp_purchase_documents').delete().eq('org_id', ORG_ID).eq('erp_name', invoice);
    await admin.from('projects').delete().eq('id', projectId);
  }
});
