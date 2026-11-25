// @e2e-isolation: serial — turns the org-wide three-way match on and off with zero tolerance (Admin); purchase, order, receipt and invoice are this run's own.
/**
 * JOB-PU7 — match the invoice to the order: an order for 10 is received as 8; the Finance Officer records a bill for 10 and the match
 * flags it as billed more than received and holds it from payment. The officer cannot approve their own bill; the Finance Manager
 * approves the exception with a reason, the hold lifts, and the record shows who approved it and why.
 */
import { expect, test } from '@playwright/test';
import { createProcurementFixture, type ProcurementFixture } from '../procurement-fixture';
import { roleJobUser } from '../support/roleJobUser';
import { ORG_ID, need, ok, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { orgToday } from '../support/jobJourney';
import { userClient } from '../support/stockFixture';

test.setTimeout(240_000);

const MANAGER_NAME = 'Match reviewing manager';
const REASON = 'Short delivery agreed with supplier';

let officer: Awaited<ReturnType<typeof roleJobUser>>;
let manager: Awaited<ReturnType<typeof roleJobUser>>;
let purchase: ProcurementFixture;
let itemId = '';
let invoiceId = '';
type MatchSettings = { enabled: boolean; enabled_at: string | null; quantity_tolerance_pct: number; amount_tolerance_pct: number; updated_by: string | null };
let before: MatchSettings | null = null;

test.beforeAll(async () => {
  const svc = serviceClient('JOB-PU7');
  const admin = await userClient('admin@acme.test');
  const current = await svc.from('org_three_way_match_settings')
    .select('enabled,enabled_at,quantity_tolerance_pct,amount_tolerance_pct,updated_by').eq('org_id', ORG_ID).maybeSingle();
  ok('match settings read', current);
  before = (current.data as MatchSettings | null) ?? null;
  // The Admin switches the match on through its own writer; the table itself is read-only.
  ok('match on', await admin.rpc('set_three_way_match_settings', { p_enabled: true, p_quantity_tolerance_pct: 0, p_amount_tolerance_pct: 0 }));

  officer = await roleJobUser(svc, 'finance_officer', runId('pu7-officer'), 'Finance');
  manager = await roleJobUser(svc, 'finance_manager', runId('pu7-manager'), 'Finance');
  ok('manager name', await svc.from('profiles').update({ full_name: MANAGER_NAME }).eq('id', manager.id));

  // An order for 10 at 1,200, received as 8.
  purchase = await createProcurementFixture({ status: 'Approved', title: 'JOB-PU7 match', withSupplier: true, quantity: 10, rate: 1200 });
  itemId = need('purchase line', await svc.from('procurement_items').select('id').eq('procurement_id', purchase.id).limit(1).single()).id as string;
  ok('currency', await svc.from('procurements').update({ currency: 'USD' }).eq('id', purchase.id));
  const po = need('order', await svc.from('purchase_orders').insert({
    org_id: ORG_ID, procurement_id: purchase.id, po_number: `PO-7-${Date.now()}`,
    status: 'Issued', date: orgToday(), amount: 12000, currency: 'USD',
  }).select('id').single());
  const receipt = need('receipt', await svc.from('procurement_receipts').insert({
    org_id: ORG_ID, procurement_id: purchase.id, po_id: po.id, gr_number: `GR-7-${Date.now()}`,
    receipt_date: orgToday(), status: 'Partial',
  }).select('id').single());
  ok('receipt line', await svc.from('procurement_receipt_lines').insert({ receipt_id: receipt.id, item_id: itemId, org_id: ORG_ID, quantity: 8, recorded_by: officer.id }));
  ok('ordered', await svc.from('procurements').update({ status: 'Ordered' }).eq('id', purchase.id));
});

test.afterAll(async () => {
  if (invoiceId) {
    sqlAsOwner(`delete from public.bill_match_exceptions where invoice_id = '${invoiceId}';
      delete from public.procurement_bill_match_lines where invoice_id = '${invoiceId}';
      delete from public.procurement_bill_matches where invoice_id = '${invoiceId}';
      delete from public.procurement_invoices where id = '${invoiceId}';`);
  }
  await purchase?.cleanup();
  const admin = await userClient('admin@acme.test');
  ok('match restore', await admin.rpc('set_three_way_match_settings', {
    p_enabled: before?.enabled ?? false,
    p_quantity_tolerance_pct: before?.quantity_tolerance_pct ?? 0,
    p_amount_tolerance_pct: before?.amount_tolerance_pct ?? 0,
  }));
  await officer?.cleanup(); await manager?.cleanup();
});

function billRow(page: import('@playwright/test').Page) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Invoice', exact: true }) });
}
async function openMatch(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: /^Files/ }).click();
  await expect(billRow(page).first()).toBeVisible({ timeout: 20_000 });
  await billRow(page).first().getByRole('button', { name: /Row actions/ }).click();
  await page.getByRole('menuitem', { name: 'Three-way match', exact: true }).click();
  await expect(page.getByTestId('bill-match')).toBeVisible({ timeout: 20_000 });
}
async function closeMatch(page: import('@playwright/test').Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bill-match')).toBeHidden({ timeout: 10_000 });
}

test('JOB-PU7 the over-receipt bill is held, the officer cannot approve it, and the manager releases it with a reason', async ({ page }) => {
  // 1-2. The officer records the supplier's bill for 10 against the order for 10, received as 8.
  await officer.signIn(page);
  await page.goto(purchase.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Record another document' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Supplier invoice', exact: true }).click();
  const form = page.getByTestId('form-create-vi');
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByTestId('vi-ref-input').fill(`INV-${Date.now()}`);
  await form.getByTestId('vi-amount-input').fill('12000');
  await form.getByTestId('vi-date-input').fill(orgToday());
  await form.getByTestId('vi-tax-treatment-select').selectOption('exclusive');
  await form.getByTestId('vi-tax-amount-input').fill('0');
  await form.getByTestId('btn-save-vi').click();
  await page.getByRole('dialog', { name: 'Record this supplier invoice?' }).getByRole('button', { name: 'Save supplier invoice' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Vendor Invoiced', { timeout: 20_000 });
  await page.getByRole('tab', { name: /^Files/ }).click();
  await expect(billRow(page).first()).toContainText(/12[.,]000/);
  invoiceId = need('invoice', await serviceClient('JOB-PU7').from('procurement_invoices').select('id').eq('procurement_id', purchase.id).limit(1).single()).id as string;

  // The bill's own lines say what it bills: 10 at 1,200 — over the 8 received.
  await billRow(page).first().getByRole('button', { name: /Row actions/ }).click();
  await page.getByRole('menuitem', { name: 'Edit bill lines', exact: true }).click();
  const editor = page.getByTestId('match-lines-editor');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.getByLabel('Quantity').fill('10');
  await editor.getByLabel('Rate').fill('1200');
  await page.getByRole('button', { name: 'Save lines' }).click();
  await expect(page.getByTestId('match-lines-result')).toContainText(/still held|does not yet match/i, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  // 3. The match flags it: billed 10 over a receipt of 8, and payments wait.
  await openMatch(page);
  const drawer = page.getByTestId('bill-match');
  await expect(drawer).toContainText('Billed more than received', { timeout: 20_000 });
  await expect(drawer).toContainText('Payments on this purchase are held');
  // The quantities say why: 10 ordered, 8 received, 10 billed (2 over the receipt).
  const line = drawer.getByTestId(`bill-match-line-${itemId}`);
  await expect(line.getByRole('cell').nth(0)).toHaveText('10');
  await expect(line.getByRole('cell').nth(1)).toHaveText('8');
  await expect(line.getByRole('cell').nth(2)).toHaveText('10');

  // Separation of duties: the person who recorded the bill cannot approve its exception.
  await drawer.getByRole('button', { name: 'Approve exception' }).click();
  const confirm = page.getByRole('dialog', { name: /Approve an exception for/ });
  await confirm.getByLabel('Reason').fill(REASON);
  await confirm.getByRole('button', { name: 'Approve exception' }).click();
  await expect(confirm).toContainText(/You recorded this bill or its lines/i, { timeout: 20_000 });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await closeMatch(page);

  // The Finance Manager approves it with a reason; the hold lifts and the record names who and why.
  await manager.signIn(page);
  await page.goto(purchase.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await openMatch(page);
  await page.getByTestId('bill-match').getByRole('button', { name: 'Approve exception' }).click();
  const approve = page.getByRole('dialog', { name: /Approve an exception for/ });
  await approve.getByLabel('Reason').fill(REASON);
  await approve.getByRole('button', { name: 'Approve exception' }).click();
  await expect(page.getByTestId('bill-match')).toContainText('Exception approved', { timeout: 20_000 });
  await expect(page.getByTestId('bill-match-exception')).toContainText(MANAGER_NAME);
  await expect(page.getByTestId('bill-match-exception')).toContainText(REASON);
  await closeMatch(page);
  await expect(page.locator('[data-testid^="bill-match-held-"]')).toHaveCount(0);
});
