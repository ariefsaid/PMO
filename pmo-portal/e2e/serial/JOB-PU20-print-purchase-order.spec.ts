// @e2e-isolation: serial — turning purchase-order printing on is an organisation-wide setting (one row for the whole org); the spec restores its previous value in finally.
/**
 * JOB-PU20 — with printing turned on by an Admin, the Buyer opens an approved purchase order, presses Print, and the
 * printed page carries the order's lines. Goal oracle: the print view shows this order's number and each line's item,
 * quantity and rate, not an empty page.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { ORG_ID, need, ok, runId, serviceClient, PM_ID } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { userClient } from '../support/stockFixture';

test.setTimeout(180_000);

test('JOB-PU20 the Buyer prints an approved purchase order with its lines', async ({ page }) => {
  const svc = serviceClient('JOB-PU20');
  const admin = await userClient('admin@acme.test');
  const buyer = await roleJobUser(svc, 'buyer', runId('pu20-buyer'));
  const run = runId('pu20');
  const purchaseId = randomUUID();
  const poId = randomUUID();
  const projectId = randomUUID();
  const workOrderId = randomUUID();
  const itemId = randomUUID();
  const poNumber = `PO-PU20-${run.slice(-8).toUpperCase()}`;
  const itemCode = `MAT-${run.slice(-8).toUpperCase()}`;
  let printedBefore: { print_enabled: boolean; signature_blocks: string[] | null; authorised_collectors: string[] | null } | null = null;
  try {
    need('project', await svc.from('projects').insert({
      id: projectId, org_id: ORG_ID, name: `${run} project`, status: 'Ongoing Project', currency: 'IDR', project_manager_id: PM_ID,
    }).select('id').single());
    need('work order', await svc.from('work_orders').insert({
      id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${run} site work`, order_value: 1200,
      tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
    }).select('id').single());
    need('contract item', await svc.from('boq_items').insert({
      id: itemId, org_id: ORG_ID, project_id: projectId, item_code: itemCode, description: `${run} ready-mix`, unit: 'm3', quantity: 100, rate: 12,
    }).select('id').single());
    need('purchase', await svc.from('procurements').insert({
      id: purchaseId, org_id: ORG_ID, project_id: projectId, title: `${run} purchase`, status: 'Ordered', currency: 'IDR',
      total_value: 1200, approved_total_value: 1200, budget_category: 'Materials', requested_by_id: PM_ID,
    }).select('id').single());
    need('approved order', await svc.from('purchase_orders').insert({
      id: poId, org_id: ORG_ID, procurement_id: purchaseId, status: 'Issued', amount: 1200, currency: 'IDR',
      po_number: poNumber, work_order_id: workOrderId, date: new Date().toISOString().slice(0, 10),
    }).select('id').single());
    need('order line', await svc.from('purchase_order_lines').insert({
      org_id: ORG_ID, po_id: poId, revision: 1, boq_item_id: itemId, quantity: 100, rate: 12, unit: 'm3',
    }).select('boq_item_id').single());

    // An Admin turns printing on (organisation-wide), remembering the previous value for the reset.
    const before = await svc.from('purchase_order_settings').select('print_enabled, signature_blocks, authorised_collectors').eq('org_id', ORG_ID).maybeSingle();
    if (before.error) throw before.error;
    printedBefore = before.data;
    need('printing on', await admin.rpc('po_set_print_settings', {
      p_enabled: true,
      p_signature_blocks: printedBefore?.signature_blocks ?? ['Prepared by', 'Approved by', 'Vendor acceptance'],
      p_authorised_collectors: printedBefore?.authorised_collectors ?? [],
    }));

    // 1. The Buyer opens the approved order and presses Print.
    await buyer.signIn(page);
    await page.goto(`/procurement/${purchaseId}`);
    await page.getByTestId('print-purchase-order-inline').click();
    await expect(page).toHaveURL(new RegExp(`/procurement/${purchaseId}/purchase-orders/${poId}/print$`), { timeout: 20_000 });

    // 2. Goal: the printed page carries this order's number and the line's item, quantity and rate.
    await expect(page.getByText(poNumber).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(itemCode).first()).toBeVisible();
    await expect(page.getByText(/ready-mix/).first()).toBeVisible();
  } finally {
    if (printedBefore) {
      await admin.rpc('po_set_print_settings', {
        p_enabled: printedBefore.print_enabled,
        p_signature_blocks: printedBefore.signature_blocks ?? ['Prepared by', 'Approved by', 'Vendor acceptance'],
        p_authorised_collectors: printedBefore.authorised_collectors ?? [],
      });
    }
    ok('order line cleanup', await svc.from('purchase_order_lines').delete().eq('po_id', poId));
    ok('order cleanup', await svc.from('purchase_orders').delete().eq('id', poId));
    ok('purchase cleanup', await svc.from('procurements').delete().eq('id', purchaseId));
    ok('contract item cleanup', await svc.from('boq_items').delete().eq('id', itemId));
    ok('work order cleanup', await svc.from('work_orders').delete().eq('id', workOrderId));
    ok('project cleanup', await svc.from('projects').delete().eq('id', projectId));
    await buyer.cleanup();
  }
});
