// @e2e-isolation: self-isolated — creates its own supplier, old payable, project, work order, purchase and order, and deletes only its own rows.
/**
 * JOB-PU18 — a supplier with an old payable is marked at risk by the Procurement Manager; the status then shows
 * on the supplier and on its open purchase. Goal oracle: the saved status is on the supplier record AND the
 * supplier's purchase carries the warning naming that status.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

test('JOB-PU18 a supplier marked at risk shows on the supplier and on its orders', async ({ page }) => {
  const svc = serviceClient('JOB-PU18');
  const run = runId('pu18');
  const buyer = await roleJobUser(svc, 'procurement_manager', runId('pu18-pm'));
  const vendorId = randomUUID();
  const projectId = randomUUID();
  const workOrderId = randomUUID();
  const purchaseId = randomUUID();
  const orderId = randomUUID();
  const invoiceId = randomUUID();
  const vendorName = `${run} Supply`;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  try {
    // Precondition: a supplier whose payable is long unpaid, with an open purchase on a work order.
    need('vendor', await svc.from('companies').insert({ id: vendorId, org_id: ORG_ID, name: vendorName, type: 'Vendor' }).select('id').single());
    need('project', await svc.from('projects').insert({
      id: projectId, org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', contract_value: 1_000_000,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
    }).select('id').single());
    need('work order', await svc.from('work_orders').insert({
      id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${run} site work`, order_value: 100,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
    }).select('id').single());
    need('purchase', await svc.from('procurements').insert({
      id: purchaseId, org_id: ORG_ID, title: `${run} purchase`, status: 'Ordered', vendor_id: vendorId,
      currency: 'IDR', project_id: projectId,
    }).select('id').single());
    need('order', await svc.from('purchase_orders').insert({
      id: orderId, org_id: ORG_ID, procurement_id: purchaseId, status: 'Issued', amount: 500, work_order_id: workOrderId,
    }).select('id').single());
    need('old invoice', await svc.from('procurement_invoices').insert({
      id: invoiceId, org_id: ORG_ID, procurement_id: purchaseId, invoice_date: daysAgo(100), status: 'Received',
      amount: 1_000_000, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0,
    }).select('id').single());

    // 1. The Procurement Manager opens Purchasing -> Suppliers and opens this supplier.
    await buyer.signIn(page);
    await page.goto('/companies');
    await page.getByRole('tab', { name: /^(Suppliers?|Vendors?)$/ }).first().click();
    await page.getByLabel(/Search companies|Cari perusahaan/i).fill(vendorName);
    await expect(page.getByText(vendorName).first()).toBeVisible({ timeout: 20_000 });
    await page.goto(`/companies/${vendorId}`);

    // 2. Sets it to at risk, with a reason.
    const status = page.getByLabel(/^Status$/);
    await status.selectOption('at_risk');
    await page.getByLabel(/^Reason$/).fill('Payables are over three months old and deliveries are late');
    await page.getByRole('button', { name: 'Save status' }).click();
    await expect(page.getByTestId('supply-risk-current')).toContainText(/At risk|Berisiko/, { timeout: 20_000 });

    // 3. Goal: the status shows on the supplier...
    await page.goto(`/companies/${vendorId}`);
    await expect(page.getByTestId('supply-risk-current')).toContainText(/At risk|Berisiko/);

    // ...and on its order, where the buyer opens the purchase.
    await page.goto(`/procurement/${purchaseId}`);
    await expect(page.getByTestId('supply-risk-purchase-warning')).toContainText(vendorName, { timeout: 20_000 });
    await expect(page.getByTestId('supply-risk-purchase-warning')).toContainText(/at risk|berisiko/i);
  } finally {
    ok('order cleanup', await svc.from('purchase_orders').delete().eq('id', orderId));
    ok('invoice cleanup', await svc.from('procurement_invoices').delete().eq('id', invoiceId));
    ok('purchase cleanup', await svc.from('procurements').delete().eq('id', purchaseId));
    ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await svc.from('audit_events').delete().eq('entity_id', vendorId);
    await svc.from('record_changes').delete().eq('entity_id', vendorId);
    ok('vendor cleanup', await svc.from('companies').delete().eq('id', vendorId));
    await buyer.cleanup();
  }
});
