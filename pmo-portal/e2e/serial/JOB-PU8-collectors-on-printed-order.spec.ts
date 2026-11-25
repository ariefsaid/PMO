// @e2e-isolation: serial — sets the org-wide purchase-order print switch and the authorised-collectors list (Admin), then restores both; the purchase order itself is this run's own.
/**
 * JOB-PU8 — only named people collect goods: with two people named as authorised collectors, the Buyer prints the purchase
 * order and both names stand on its "Authorised to collect" line; printing one copy for a single collector names only them.
 */
import { expect } from '@playwright/test';
import { buyerTest as test } from '../support/buyerOrdering';
import { createProcurementFixture, type ProcurementFixture } from '../procurement-fixture';
import { roleJobUser } from '../support/roleJobUser';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { userClient } from '../support/stockFixture';

test.setTimeout(150_000);

const COLLECTORS = ['A. Collector', 'B. Collector'];

let buyer: Awaited<ReturnType<typeof roleJobUser>>;
let purchase: ProcurementFixture;
let poId = '';
let before: { print_enabled: boolean; signature_blocks: string[]; authorised_collectors: string[] } | null = null;

test.beforeAll(async () => {
  const svc = serviceClient('JOB-PU8');
  const admin = await userClient('admin@acme.test');
  buyer = await roleJobUser(svc, 'buyer', runId('pu8-buyer'));
  const row = await svc.from('purchase_order_settings').select('print_enabled,signature_blocks,authorised_collectors').eq('org_id', ORG_ID).maybeSingle();
  ok('print settings read', row);
  before = (row.data as typeof before) ?? null;
  ok('print settings', await admin.rpc('po_set_print_settings', {
    p_enabled: true,
    p_signature_blocks: before?.signature_blocks?.length ? before.signature_blocks : ['Prepared by', 'Approved by', 'Vendor acceptance'],
    p_authorised_collectors: COLLECTORS,
  }));

  purchase = await createProcurementFixture({ status: 'Approved', title: 'JOB-PU8 collectors', withSupplier: true });
  const po = need('purchase order', await svc.from('purchase_orders').insert({
    org_id: ORG_ID, procurement_id: purchase.id, po_number: `PO-${Date.now()}`,
    status: 'Issued', date: new Date().toISOString().slice(0, 10), amount: 12000, currency: 'USD',
  }).select('id').single());
  poId = po.id as string;
  ok('purchase ordered', await svc.from('procurements').update({ status: 'Ordered' }).eq('id', purchase.id));
});

test.afterAll(async () => {
  await purchase?.cleanup();
  await buyer?.cleanup();
  const admin = await userClient('admin@acme.test');
  const r = await admin.rpc('po_set_print_settings', {
    p_enabled: before?.print_enabled ?? false,
    p_signature_blocks: before?.signature_blocks ?? ['Prepared by', 'Approved by', 'Vendor acceptance'],
    p_authorised_collectors: before?.authorised_collectors ?? [],
  });
  if (r.error) throw new Error(`JOB-PU8 restore print settings: ${r.error.message}`);
});

test('JOB-PU8 the printed order names both authorised collectors, and one copy names only the chosen one', async ({ page }) => {
  await buyer.signIn(page);
  await page.goto(`/procurement/${purchase.id}/purchase-orders/${poId}/print`);
  await expect(page.getByTestId('po-disabled-state')).toHaveCount(0);
  await expect(page.getByText('Authorised to collect').first()).toBeVisible({ timeout: 20_000 });
  const line = page.getByTestId('authorised-collectors-list');
  await expect(line).toContainText(COLLECTORS[0]);
  await expect(line).toContainText(COLLECTORS[1]);

  // A copy handed to one collector names that person alone.
  await page.getByTestId('collector-picker-select').selectOption({ label: COLLECTORS[1] });
  await expect(line).toContainText(COLLECTORS[1]);
  await expect(line).not.toContainText(COLLECTORS[0]);
});
