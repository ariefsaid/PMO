// @e2e-isolation: self-isolated — creates its own project, two ERP invoices and a purchase, deletes them after.
/** AC-PFE-022 — goal: two ERPNext invoices are linked to an existing purchase in one action; both then show "From ERPNext" on it. */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey, pickComboboxOption } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const svcKey = requireServiceRoleKey();
test.skip(!svcKey, 'AC-PFE-022: SUPABASE_SERVICE_ROLE_KEY not set (local) — skipping');

test('AC-PFE-022: bulk-link two ERPNext invoices to a purchase', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, svcKey!);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const projectId = crypto.randomUUID();
  const purchaseId = crypto.randomUUID();
  const title = `PFE bulk ${suffix}`;
  const names = [`ACC-PINV-PFE-${suffix}-A`, `ACC-PINV-PFE-${suffix}-B`];
  const supplier = `PFE Supplier ${suffix}`;

  const { data: finance } = await admin.from('profiles').select('id').eq('email', 'finance@acme.test').single().throwOnError();
  await admin.from('projects').insert({ id: projectId, org_id: ORG_ID, name: `PFE bulk project ${suffix}`, status: 'Ongoing Project' }).throwOnError();
  await admin.from('procurements').insert({
    id: purchaseId, org_id: ORG_ID, project_id: projectId, title, status: 'Ordered', currency: 'IDR',
    total_value: 5_000_000, requested_by_id: finance!.id,
  }).throwOnError();
  await admin.from('erp_purchase_documents').insert(names.map((n, i) => ({
    org_id: ORG_ID, erp_doctype: 'Purchase Invoice', erp_name: n, supplier: `SUP-${suffix}`, supplier_name: supplier,
    doc_date: '2026-02-01', currency: 'IDR', grand_total: 1_000_000 * (i + 1), net_total: 900_000 * (i + 1),
    outstanding_amount: 0, erp_status: 'Paid', erp_docstatus: 1, project_ids: [projectId], erp_modified: '2026-02-01 10:00:00',
  }))).throwOnError();
  try {
    await signIn(page, 'finance@acme.test');
    await page.goto(`/projects/${projectId}/procurement`);
    await page.getByRole('checkbox', { name: `Select ${names[0]}` }).check();
    await page.getByRole('checkbox', { name: `Select ${names[1]}` }).check();
    await page.getByRole('button', { name: 'Link 2 to purchase' }).click();

    const dialog = page.getByRole('dialog');
    await pickComboboxOption(dialog, page, /^purchase/i, new RegExp(title));
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();

    // GOAL: we land on the purchase and both invoices are on it, marked From ERPNext.
    await expect(page).toHaveURL(new RegExp(`/procurement/${purchaseId}`));
    await page.getByRole('navigation', { name: 'Procurement sections' }).getByRole('link', { name: 'Documents' }).click();
    for (const n of names) {
      await expect(page.getByRole('row', { name: new RegExp(n) })).toContainText('From ERPNext');
    }
  } finally {
    await admin.from('procurement_erp_links').delete().eq('procurement_id', purchaseId);
    await admin.from('procurement_status_events').delete().eq('procurement_id', purchaseId);
    await admin.from('procurements').delete().eq('id', purchaseId);
    await admin.from('erp_purchase_documents').delete().eq('org_id', ORG_ID).in('erp_name', names);
    await admin.from('projects').delete().eq('id', projectId);
  }
});
