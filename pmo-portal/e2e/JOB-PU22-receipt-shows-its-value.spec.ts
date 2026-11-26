// @e2e-isolation: self-isolated — creates its own IDR project, received purchase, Issued work order and complete receipt (service role) and removes them afterwards; reads the seed org, users and supplier only.
/**
 * JOB-PU22 — the person who received Rp 45 million of goods sees the receipt's value (from the order lines) on the purchase, not a
 * dash; and the work order's cost page, which counts a receipt only once its supplier bill is recorded, says exactly that.
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { orgToday } from './support/jobJourney';
import { serviceClient, SEED_SUPPLIER_ID } from './procurement-fixture';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

/** Seed ids (supabase/seed.sql): the org, the Project Manager who raises the purchase and the Executive who approves it. */
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const EXEC_ID = '00000000-0000-0000-0000-0000000000a1';

/** Three lines at Rp 15 million: the Rp 45 million the receipt must show, read from the order lines. */
const QUANTITY = 3;
const RATE = 15_000_000;

let fixture: { id: string; url: string } | undefined;
let projectId: string | undefined;
let workOrderId: string | undefined;
let woNumber: string | undefined;
let receiptId: string | undefined;

test.beforeAll(async () => {
  const admin = serviceClient();

  // The seed org's default currency — and so every seeded project — is USD, while this journey's figures are rupiah
  // through and through. A work order must be denominated like its project (0193 §2 pin), so the fixture brings its own
  // IDR project rather than re-denominating a shared seed row, and the purchase, the order and its project all agree.
  const project = await admin.from('projects').insert({
    org_id: ORG_ID,
    name: `JOB-PU22 receipt ${Date.now()}`,
    status: 'Ongoing Project',
    project_manager_id: PM_ID,
    currency: 'IDR',
    contract_value: 75_000_000,
    tax_treatment: 'exclusive',
    tax_amount: 0,
  }).select('id').single();
  if (project.error || !project.data) throw new Error(`JOB-PU22 project: ${project.error?.message ?? 'no row returned'}`);
  projectId = project.data.id;

  const procurementId = randomUUID();
  const code = `E2E-${procurementId.slice(0, 8).toUpperCase()}`;
  const { error: procurementError } = await admin.from('procurements').insert({
    id: procurementId,
    code,
    title: `JOB-PU22 received ${code}`,
    project_id: projectId,
    requested_by_id: PM_ID,
    status: 'Received',
    total_value: RATE * QUANTITY,
    approved_by_id: EXEC_ID,
    vendor_id: SEED_SUPPLIER_ID,
    currency: 'IDR',
  });
  if (procurementError) throw new Error(`JOB-PU22 procurement: ${procurementError.message}`);
  fixture = { id: procurementId, url: `/procurement/${procurementId}` };

  const { error: itemError } = await admin.from('procurement_items').insert({
    procurement_id: procurementId, name: 'Fixture line', description: 'e2e fixture', quantity: QUANTITY, rate: RATE,
  });
  if (itemError) throw new Error(`JOB-PU22 procurement item: ${itemError.message}`);

  workOrderId = randomUUID();
  woNumber = `WO-PU22-${workOrderId.slice(0, 8).toUpperCase()}`;
  const { error: woError } = await admin.from('work_orders').insert({
    id: workOrderId,
    org_id: ORG_ID,
    project_id: projectId,
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
    .eq('id', procurementId);
  if (procUpdateError) throw new Error(`JOB-PU22 procurement update: ${procUpdateError.message}`);

  receiptId = randomUUID();
  const { error: receiptError } = await admin.from('procurement_receipts').insert({
    id: receiptId,
    procurement_id: procurementId,
    work_order_id: workOrderId,
    status: 'Complete',
    receipt_date: orgToday(),
    org_id: ORG_ID,
  });
  if (receiptError) throw new Error(`JOB-PU22 receipt: ${receiptError.message}`);
});

test.afterAll(async () => {
  const admin = serviceClient();
  const failures: string[] = [];
  const attempt = async (step: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const { error } = await op();
      if (error) failures.push(`${step}: ${error.message}`);
    } catch (e) {
      failures.push(`${step}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (receiptId) {
    await attempt('delete owned receipt', () => admin.from('procurement_receipts').delete().eq('id', receiptId!));
  }
  if (fixture?.id) {
    const tables = [
      'procurement_receipts',
      'purchase_orders',
      'purchase_requests',
      'procurement_documents',
      'procurement_status_events',
      'procurement_quotations',
      'procurement_items',
    ];
    for (const table of tables) {
      await attempt(`delete procurement child ${table}`, () => admin.from(table).delete().eq('procurement_id', fixture!.id));
    }
    await attempt('delete procurement', () => admin.from('procurements').delete().eq('id', fixture!.id));
  }
  if (workOrderId) {
    await attempt('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId!));
  }
  // The project goes last: the work order and the purchase both point at it, so they are gone by now.
  if (projectId) {
    await attempt('delete owned project', () => admin.from('projects').delete().eq('id', projectId!));
  }

  // Verify absence of owned rows to guarantee teardown actually succeeded
  if (receiptId) {
    const { data, error } = await admin.from('procurement_receipts').select('id').eq('id', receiptId);
    if (error) failures.push(`verify receipt absence: ${error.message}`);
    else if ((data ?? []).length > 0) failures.push('verify receipt absence: receipt row still exists');
  }
  if (fixture?.id) {
    const { data, error } = await admin.from('procurements').select('id').eq('id', fixture.id);
    if (error) failures.push(`verify procurement absence: ${error.message}`);
    else if ((data ?? []).length > 0) failures.push('verify procurement absence: procurement row still exists');
  }
  if (workOrderId) {
    const { data, error } = await admin.from('work_orders').select('id').eq('id', workOrderId);
    if (error) failures.push(`verify work order absence: ${error.message}`);
    else if ((data ?? []).length > 0) failures.push('verify work order absence: work order row still exists');
  }
  if (projectId) {
    const { data, error } = await admin.from('projects').select('id').eq('id', projectId);
    if (error) failures.push(`verify project absence: ${error.message}`);
    else if ((data ?? []).length > 0) failures.push('verify project absence: project row still exists');
  }

  if (failures.length > 0) {
    throw new Error(`JOB-PU22 teardown failed: ${failures.join('; ')}`);
  }
});

test('JOB-PU22 the receipt row shows its value read from the order lines (Rp 45 million)', async ({ page }) => {
  if (!fixture || !workOrderId || !woNumber || !receiptId) {
    throw new Error('JOB-PU22 fixture setup did not complete');
  }

  await signIn(page, 'finance@acme.test');
  await page.goto(`${fixture.url}/files`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  const value = page.getByTestId('receipt-value').first();
  await expect(value).toBeVisible({ timeout: 15_000 });
  await expect(value).toContainText(/45[.,]000[.,]000/);
  await expect(page.getByText('From the order lines').first()).toBeVisible();

  // Service-read owned IDs: establish no supplier bill recorded, and confirm WO / receipt binding
  const admin = serviceClient();
  const { data: bills, error: billsError } = await admin
    .from('procurement_invoices')
    .select('id')
    .eq('procurement_id', fixture.id);
  if (billsError) throw new Error(`JOB-PU22 bills: ${billsError.message}`);
  expect(bills).toHaveLength(0);

  const { data: boundReceipt, error: boundReceiptError } = await admin
    .from('procurement_receipts')
    .select('work_order_id')
    .eq('id', receiptId)
    .single();
  if (boundReceiptError || !boundReceipt) {
    throw new Error(`JOB-PU22 bound receipt: ${boundReceiptError?.message ?? 'missing row'}`);
  }
  expect(boundReceipt.work_order_id).toBe(workOrderId);

  // Navigate to real work-order cost page as lawful role (Finance)
  await page.goto(`/work-orders/${workOrderId}`);
  await openWorkOrderArea(page, 'cost');
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
