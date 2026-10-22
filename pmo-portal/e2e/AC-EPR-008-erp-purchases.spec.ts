// @e2e-isolation: self-isolated — creates its own uniquely named project and ERP purchase rows, and deletes them after.
/**
 * AC-EPR-008 — a user sees what a project bought in ERPNext without leaving PMO: the project's Procurement tab lists
 * the ERP purchase (supplier + amount, labelled as already in Actuals), and the org-wide list names the project.
 * Goal oracle: the purchase's supplier, amount and project on screen — not the presence of a section.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const svcKey = requireServiceRoleKey();
test.skip(!svcKey, 'AC-EPR-008: SUPABASE_SERVICE_ROLE_KEY not set (local) — skipping');

test('AC-EPR-008: a project shows its ERPNext purchases and the org list names the project', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, svcKey!);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const projectId = crypto.randomUUID();
  const projectName = `EPR e2e ${suffix}`;
  const supplier = `EPR Supplier ${suffix}`;
  const invoiceName = `ACC-PINV-E2E-${suffix}`;

  const { error: pErr } = await admin.from('projects').insert({ id: projectId, org_id: ORG_ID, name: projectName, status: 'Ongoing Project' });
  if (pErr) throw new Error(`seed project failed: ${pErr.message}`);
  // The sweep is the only writer in production; the e2e stands in for it with the service role.
  const { error: dErr } = await admin.from('erp_purchase_documents').insert({
    org_id: ORG_ID, erp_doctype: 'Purchase Invoice', erp_name: invoiceName, supplier_name: supplier,
    doc_date: '2026-02-01', due_date: '2026-03-01', bill_no: 'INV-E2E', currency: 'IDR', grand_total: 4_321_000,
    outstanding_amount: 0, erp_status: 'Paid', erp_docstatus: 1, project_ids: [projectId], erp_modified: '2026-02-01 10:00:00',
  });
  if (dErr) throw new Error(`seed ERP purchase failed: ${dErr.message}`);
  try {
    await signIn(page, 'finance@acme.test');
    await page.goto(`/projects/${projectId}/procurement`);

    const section = page.getByRole('region', { name: 'Purchases recorded in ERPNext' });
    await expect(section.getByText(/Already counted in Actuals/)).toBeVisible();
    const row = section.locator('tr', { hasText: invoiceName });
    await expect(row).toContainText(supplier);
    await expect(row).toContainText(/4[.,]321[.,]000/);
    await expect(row).toContainText('Paid');

    await section.getByRole('link', { name: 'All ERP purchases' }).click();
    await expect(page).toHaveURL(/\/erp-purchases$/);
    await expect(page.locator('tr', { hasText: invoiceName })).toContainText(projectName);
  } finally {
    await admin.from('erp_purchase_documents').delete().eq('org_id', ORG_ID).eq('erp_name', invoiceName);
    await admin.from('projects').delete().eq('id', projectId);
  }
});
