// @e2e-isolation: self-isolated — owns an organisation, job logins and rental purchase.
import { test, expect } from '@playwright/test';
import { serviceClient, need, ok, runId } from './support/jobFixtures';
import { createJobRoleUser, removeJobOrganization } from './support/jobRoleUser';
import { jobRoleUser } from './support/jobRole';

test.setTimeout(180_000);

test('AC-VBJR-002 an equipment officer records a rental bill and a buyer reads it', async ({ page }) => {
  const db = serviceClient('vendor bill job roles');
  const orgId = crypto.randomUUID();
  const tag = runId('vendor-bill-role');
  let officer: Awaited<ReturnType<typeof createJobRoleUser>> | undefined;
  let buyer: Awaited<ReturnType<typeof createJobRoleUser>> | undefined;
  let adminId = '';
  try {
    ok('organisation', await db.from('organizations').insert({ id: orgId, name: tag, built_in_roles_enabled: true }));
    officer = await createJobRoleUser(db, orgId, 'equipment_officer');
    buyer = await createJobRoleUser(db, orgId, 'buyer');
    const admin = await jobRoleUser({ jobRole: 'administrator', role: 'Admin', org: orgId, service: db, run: tag, displayName: 'Journey Admin' });
    adminId = admin.id;
    const adminClient = serviceClient('vendor bill fixture admin');
    ok('Admin sign-in', await adminClient.auth.signInWithPassword({ email: admin.email, password: admin.password }));
    ok('purchase types', await adminClient.rpc('set_purchase_types_enabled', { p_enabled: true }));
    ok('match settings', await adminClient.rpc('set_three_way_match_settings', { p_enabled: true, p_quantity_tolerance_pct: 0, p_amount_tolerance_pct: 0 }));
    const rental = need('rental type', await db.from('purchase_types').select('id').eq('org_id', orgId).eq('is_rental', true).limit(1).single());
    const purchase = need('rental purchase', await db.from('procurements').insert({ org_id: orgId, title: tag, status: 'Vendor Invoiced', requested_by_id: adminId, purchase_type_id: rental.id, rental_from: '2026-11-01', rental_to: '2026-11-30' }).select('id').single());

    await officer.signIn(page);
    await page.goto(`/procurement/${purchase.id}`);
    await page.getByRole('button', { name: 'Record another document' }).click();
    await page.getByRole('menuitem', { name: 'Supplier invoice', exact: true }).click();
    const form = page.getByTestId('form-create-vi');
    await form.getByTestId('vi-ref-input').fill(tag);
    await form.getByTestId('vi-amount-input').fill('12000');
    await form.getByTestId('vi-tax-treatment-select').selectOption('exclusive');
    await form.getByTestId('vi-tax-amount-input').fill('0');
    await form.getByTestId('btn-save-vi').click();
    await page.getByRole('dialog', { name: 'Record this supplier invoice?' }).getByRole('button', { name: 'Save supplier invoice' }).click();
    await expect.poll(async () => need('bill', await db.from('procurement_invoices').select('id').eq('procurement_id', purchase.id))).toHaveLength(1);
    await page.getByRole('tab', { name: /^Files/ }).click();
    const officerRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Invoice', exact: true }) });
    await expect(officerRow).toBeVisible();
    await officerRow.getByRole('button', { name: /Row actions/ }).click();
    await page.getByRole('menuitem', { name: 'Three-way match', exact: true }).click();
    await expect(page.getByTestId('bill-match')).toBeVisible();
    await buyer.signIn(page);
    await page.goto(`/procurement/${purchase.id}/files`);
    const buyerRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Invoice', exact: true }) });
    await expect(buyerRow).toContainText(tag);
    await buyerRow.getByRole('button', { name: /Row actions/ }).click();
    await page.getByRole('menuitem', { name: 'Three-way match', exact: true }).click();
    await expect(page.getByTestId('bill-match')).toBeVisible();
  } finally {
    removeJobOrganization(orgId);
    for (const id of [officer?.id, buyer?.id, adminId].filter(Boolean)) ok('login cleanup', await db.auth.admin.deleteUser(id!));
  }
});
