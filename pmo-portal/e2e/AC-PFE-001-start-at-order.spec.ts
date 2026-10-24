// @e2e-isolation: self-isolated — creates its own uniquely titled purchase and deletes it (service role) after.
/** AC-PFE-001 — goal: a draft purchase's first document can be the Order; recording the order puts it at Ordered with the PO on the ledger, no request/approval step taken. */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey, pickComboboxOption } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
test.skip(!svcKey, 'AC-PFE-001: SUPABASE_SERVICE_ROLE_KEY not set (local) — skipping');

test('AC-PFE-001: record an order as the first document of a draft purchase', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, svcKey!);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const title = `PFE start-at-order ${suffix}`;
  const poRef = `PO-PFE-${suffix}`;
  let purchaseId: string | null = null;
  try {
    await signIn(page, 'pm@acme.test');
    await page.goto('/procurement/new');
    await page.getByLabel('Title').fill(title);
    await pickComboboxOption(page, page, /^project/i);
    await page.getByRole('button', { name: 'Save' }).click();

    // A saved draft: nothing recorded yet, no approval requested.
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}/, { timeout: 20_000 });
    purchaseId = page.url().match(/procurement\/([0-9a-f-]{36})/)![1];
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tablist', { name: 'Procurement sections' }).getByRole('tab', { name: /Documents/ }).click();
    // An empty Draft offers "Record the first document": choose Order, then capture it.
    await page.getByLabel('Record the first document').selectOption({ label: 'Order' });
    await page.getByTestId('ledger-capture-open').click();
    await page.getByTestId('purchase_order-ref-input').fill(poRef);
    await page.getByTestId('purchase_order-amount-input').fill('5000000');
    await page.getByTestId('purchase_order-save-btn').click();

    // GOAL: Ordered, and the PO is on the ledger — the request step was never taken.
    await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 15_000 });
    await expect(page.getByText(poRef).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Submit Request' })).toHaveCount(0);

    // Persisted, not just rendered: the order row exists and the purchase is Ordered in the database.
    const { data: po } = await admin.from('purchase_orders').select('id').eq('procurement_id', purchaseId).throwOnError();
    expect(po).toHaveLength(1);
    const { data: row } = await admin.from('procurements').select('status').eq('id', purchaseId).single().throwOnError();
    expect(row!.status).toBe('Ordered');
  } finally {
    if (purchaseId) {
      for (const t of ['payments', 'procurement_invoices', 'procurement_receipts', 'purchase_orders', 'purchase_requests']) {
        await admin.from(t).delete().eq('procurement_id', purchaseId);
      }
      await admin.from('procurement_status_events').delete().eq('procurement_id', purchaseId);
      await admin.from('procurements').delete().eq('id', purchaseId);
    }
  }
});
