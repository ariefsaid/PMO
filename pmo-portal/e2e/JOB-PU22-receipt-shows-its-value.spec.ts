// @e2e-isolation: self-isolated — creates its own Ordered purchase (service role) with one priced line and a complete receipt on its own Issued work order, and removes them afterwards.
/**
 * JOB-PU22 — the person who received Rp 45 million of goods sees the receipt's value (from the order lines) on the purchase, not a
 * dash; and the work order's cost page, which counts a receipt only once its supplier bill is recorded, says exactly that.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { createProcurementFixture, serviceClient, type ProcurementFixture } from './procurement-fixture';

test.setTimeout(120_000);

let fixture: ProcurementFixture;
let workOrderId: string;
let woNumber: string;
let receiptId: string;

test.beforeAll(async () => {
  fixture = await createProcurementFixture({
    status: 'Received',
    title: 'JOB-PU22 received',
    withSupplier: true,
    quantity: 3,
    rate: 15_000_000,
  });

  const admin = serviceClient();
  const { data: proc, error: procFetchError } = await admin
    .from('procurements')
    .select('org_id, project_id')
    .eq('id', fixture.id)
    .single();
  if (procFetchError || !proc) throw new Error(`JOB-PU22 procurement lookup: ${procFetchError?.message}`);

  workOrderId = randomUUID();
  woNumber = `WO-PU22-${workOrderId.slice(0, 8).toUpperCase()}`;
  const { error: woError } = await admin.from('work_orders').insert({
    id: workOrderId,
    org_id: proc.org_id,
    project_id: proc.project_id,
    title: `JOB-PU22 work order ${woNumber}`,
    wo_number: woNumber,
    status: 'Issued',
    issued_at: new Date().toISOString(),
    order_value: 50_000_000,
    tax_treatment: 'exclusive',
    tax_amount: 0,
    currency: 'IDR',
  });
  if (woError) throw new Error(`JOB-PU22 work order: ${woError.message}`);

  const { error: procUpdateError } = await admin
    .from('procurements')
    .update({ work_order_id: workOrderId })
    .eq('id', fixture.id);
  if (procUpdateError) throw new Error(`JOB-PU22 procurement update: ${procUpdateError.message}`);

  receiptId = randomUUID();
  const { error: receiptError } = await admin.from('procurement_receipts').insert({
    id: receiptId,
    procurement_id: fixture.id,
    work_order_id: workOrderId,
    status: 'Complete',
    receipt_date: new Date().toISOString().slice(0, 10),
    org_id: proc.org_id,
  });
  if (receiptError) throw new Error(`JOB-PU22 receipt: ${receiptError.message}`);
});

test.afterAll(async () => {
  const admin = serviceClient();
  if (receiptId) {
    await admin.from('procurement_receipts').delete().eq('id', receiptId);
  }
  if (fixture) {
    await fixture.cleanup();
  }
  if (workOrderId) {
    await admin.from('work_orders').delete().eq('id', workOrderId);
  }
});

test('JOB-PU22 the receipt row shows its value read from the order lines (Rp 45 million)', async ({ page }) => {
  await signIn(page, 'finance@acme.test');
  await page.goto(`${fixture.url}/files`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  const value = page.getByTestId('receipt-value').first();
  await expect(value).toBeVisible({ timeout: 15_000 });
  await expect(value).toContainText(/45[.,]000[.,]000/);
  await expect(page.getByText('From the order lines').first()).toBeVisible();

  // Service-read owned IDs: establish no supplier bill recorded, and confirm WO / receipt binding
  const admin = serviceClient();
  const { data: bills } = await admin
    .from('procurement_invoices')
    .select('id')
    .eq('procurement_id', fixture.id);
  expect(bills ?? []).toHaveLength(0);

  const { data: boundReceipt } = await admin
    .from('procurement_receipts')
    .select('work_order_id')
    .eq('id', receiptId)
    .single();
  expect(boundReceipt?.work_order_id).toBe(workOrderId);

  // Navigate to real work-order cost page as lawful role (Finance)
  await page.goto(`/work-orders/${workOrderId}`);
  await expect(page.getByRole('heading', { name: woNumber })).toBeVisible({ timeout: 20_000 });

  // Assert goods receipt commitment explanation: no bill recorded, so 0 recognized direct cost
  const receiptGroup = page.getByTestId('cost-group-goods_receipt');
  await expect(receiptGroup).toBeVisible({ timeout: 15_000 });
  const commitment = page.getByTestId('cost-commitment-goods_receipt');
  await expect(commitment).toBeVisible({ timeout: 15_000 });
  await expect(commitment).toContainText(/receipt counts once its supplier bill is recorded/);
  await expect(page.getByTestId('cost-total-goods_receipt')).toHaveCount(0);
  await expect(page.getByTestId(`cost-line-${receiptId}`)).toBeVisible();
  await expect(page.getByText('Amount unavailable')).toHaveCount(0);
});
