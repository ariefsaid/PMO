// @e2e-isolation: serial — turns the org-wide payment-channel switch on and off (Admin) and adds/removes its own channel; each purchase is this run's own.
/**
 * JOB-PU6 — payment channel and paid status: on a request that already holds its order, receipt and bill, the Finance Officer sets
 * how it will be paid and records the payment; the request's stages read sourced, received and paid, and a purchase with no
 * receipt still reads "Not recorded" for receive (received only after the receipt).
 */
import { expect, test } from '@playwright/test';
import { createProcurementFixture, type ProcurementFixture } from '../procurement-fixture';
import { roleJobUser } from '../support/roleJobUser';
import { ORG_ID, need, ok, runId, serviceClient } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { userClient } from '../support/stockFixture';

test.setTimeout(180_000);

const CHANNEL = `Bank transfer ${Date.now()}`;

type Purchase = ProcurementFixture & { poId: string; invoiceId: string };
let officer: Awaited<ReturnType<typeof roleJobUser>>;
let recorded: Purchase;
let unrecorded: Purchase;
let channelId = '';
let switchWasOn = false;

async function withDocuments(title: string, opts: { receipt: boolean; invoice: boolean }): Promise<Purchase> {
  const svc = serviceClient('JOB-PU6');
  const fixture = await createProcurementFixture({ status: 'Received', title, withSupplier: true });
  const po = need('order', await svc.from('purchase_orders').insert({
    org_id: ORG_ID, procurement_id: fixture.id, po_number: `PO-${title}-${Date.now()}`,
    status: 'Issued', date: orgToday(), amount: 12000, currency: 'USD',
  }).select('id').single());
  let invoiceId = '';
  if (opts.receipt) {
    ok('receipt', await svc.from('procurement_receipts').insert({
      org_id: ORG_ID, procurement_id: fixture.id, po_id: po.id, gr_number: `GR-${Date.now()}`,
      receipt_date: orgToday(), status: 'Complete',
    }));
  }
  if (opts.invoice) {
    invoiceId = need('invoice', await svc.from('procurement_invoices').insert({
      procurement_id: fixture.id, po_id: po.id, status: 'Received', invoice_date: orgToday(),
      amount: 12000, tax_treatment: 'exclusive', tax_amount: 0,
    }).select('id').single()).id as string;
  }
  ok('status', await svc.from('procurements').update({ status: 'Vendor Invoiced', approved_total_value: 12000 }).eq('id', fixture.id));
  return { ...fixture, poId: po.id as string, invoiceId };
}

async function dropInvoiceAndPayments(svc: ReturnType<typeof serviceClient>, purchase: Purchase) {
  ok('payments', await svc.from('payments').delete().eq('procurement_id', purchase.id));
  if (purchase.invoiceId) ok('invoice', await svc.from('procurement_invoices').delete().eq('id', purchase.invoiceId));
}

test.beforeAll(async () => {
  const svc = serviceClient('JOB-PU6');
  const admin = await userClient('admin@acme.test');
  const settings = await svc.from('org_payment_channel_settings').select('enabled').eq('org_id', ORG_ID).maybeSingle();
  ok('channel switch read', settings);
  switchWasOn = settings.data?.enabled === true;
  ok('channel switch', await admin.rpc('set_payment_channel_settings', { p_enabled: true }));
  channelId = need('channel', await admin.rpc('save_payment_channel', { p_id: null, p_name: CHANNEL })).id as string;

  officer = await roleJobUser(svc, 'finance_officer', runId('pu6-officer'), 'Finance');
  recorded = await withDocuments('JOB-PU6 recorded', { receipt: true, invoice: true });
  unrecorded = await withDocuments('JOB-PU6 no receipt', { receipt: false, invoice: true });
});

test.afterAll(async () => {
  const svc = serviceClient('JOB-PU6');
  if (recorded) await dropInvoiceAndPayments(svc, recorded);
  if (unrecorded) await dropInvoiceAndPayments(svc, unrecorded);
  await recorded?.cleanup();
  await unrecorded?.cleanup();
  const admin = await userClient('admin@acme.test');
  if (channelId) ok('channel cleanup', await admin.rpc('archive_payment_channel', { p_id: channelId, p_archived: true }));
  if (!switchWasOn) ok('switch restore', await admin.rpc('set_payment_channel_settings', { p_enabled: false }));
  await officer?.cleanup();
});

function stage(page: import('@playwright/test').Page, name: 'Order' | 'Receive' | 'Pay') {
  return page.getByTestId('procurement-stage-tracker').locator('li').filter({ has: page.getByText(name, { exact: true }) });
}

test('JOB-PU6 the officer sets the channel, records the payment, and the stages read sourced, received and paid', async ({ page }) => {
  await officer.signIn(page);
  await page.goto(recorded.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });

  // Sourced and received are already on the record; pay holds the bill alone.
  await expect(stage(page, 'Order')).toContainText('1 order');
  await expect(stage(page, 'Receive')).toContainText('1 receipt');
  await expect(stage(page, 'Pay')).toContainText('1 invoice');

  // How it will be paid: one value, a line of the purchase's Details.
  await page.getByRole('tab', { name: /^Details/ }).click();
  const channel = page.getByTestId('payment-channel-section');
  await expect(channel).toBeVisible({ timeout: 20_000 });
  await channel.getByLabel('Payment channel').selectOption({ label: CHANNEL });
  await channel.getByRole('button', { name: 'Save channel' }).click();
  await expect(channel.getByLabel('Payment channel')).toHaveValue(channelId, { timeout: 20_000 });

  // The payment itself, recorded from the purchase's Files ledger.
  await page.getByRole('tab', { name: /^Files/ }).click();
  await page.getByTestId('ledger-capture-open').click();
  const form = page.getByTestId('form-capture-payment');
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByTestId('payment-ref-input').fill(`PAY-${Date.now()}`);
  await form.getByTestId('payment-date-input').fill(orgToday());
  await form.getByTestId('payment-amount-input').fill('12000');
  await form.getByTestId('payment-save-btn').click();
  // The payment is only scheduled until the officer marks it paid: the page's Record payment action, confirmed.
  // The Files ledger offers a further payment record under the same name, so the page's own action is the one outside the ledger row.
  await page.getByRole('button', { name: 'Record payment', exact: true }).and(page.locator(':not([data-testid="ledger-capture-open"])')).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as Paid', exact: true }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Paid', { timeout: 20_000 });
  // The pay stage counts the bill and the payment together, so the recorded payment takes it from one record to two.
  await expect(stage(page, 'Pay')).toContainText('2 invoice', { timeout: 20_000 });
  // The checklist reads sourced, received and paid as done states, not only as counts.
  for (const name of ['Order', 'Receive', 'Pay'] as const) {
    await expect(stage(page, name).locator('span').first()).toHaveClass(/text-success-text/);
  }
  await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Payment', exact: true }) }).first()).toBeVisible();

  // Received only after the receipt: the sibling purchase holds an order and a bill but no receipt.
  await page.goto(unrecorded.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(stage(page, 'Order')).toContainText('1 order');
  await expect(stage(page, 'Receive')).toContainText('Not recorded');
  await expect(stage(page, 'Receive').locator('span').first()).not.toHaveClass(/text-success-text/);

  // The receipt arrives on this same purchase (the storekeeper's act, set up by the service client): Receive then reads done.
  ok('late receipt', await serviceClient('JOB-PU6').from('procurement_receipts').insert({
    org_id: ORG_ID, procurement_id: unrecorded.id, po_id: unrecorded.poId, gr_number: `GR-LATE-${Date.now()}`,
    receipt_date: orgToday(), status: 'Complete',
  }));
  await page.reload();
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(stage(page, 'Receive')).toContainText('1 receipt');
  await expect(stage(page, 'Receive').locator('span').first()).toHaveClass(/text-success-text/);
});
