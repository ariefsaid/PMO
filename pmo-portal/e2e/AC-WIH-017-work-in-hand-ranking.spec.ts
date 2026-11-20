// @e2e-isolation: self-isolated — creates its own uniquely named contracts, invoices and work order and deletes them (invoices, work order, then projects); the revenue entitlement is granted by rewriting this page's org_features
/**
 * AC-WIH-017 — a Finance user opens Work in hand from the Finance hub, sees contracts ranked by Left to bill with a work
 * order beneath its contract, switches the order to months of backlog and watches the rows re-sort, and opens a contract's
 * page from its row. Goal oracle: the order of the rows and the page that opens, not the presence of controls.
 *
 * Fixture (all amounts excl. tax, in the organisation's currency; invoices dated inside the billing window):
 *   BIG  contract 2,000,000 billed 1,000,000 -> Left to bill 1,000,000, backlog = M months (the months since billing began)
 *   SLOW contract   900,000 billed   100,000 -> Left to bill   800,000, backlog = 8 x M months
 * So BIG ranks first by Left to bill and SLOW ranks first by months of backlog, whatever M the run date gives.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const svcKey = requireServiceRoleKey();
test.skip(!svcKey, 'AC-WIH-017: SUPABASE_SERVICE_ROLE_KEY not set (local) — skipping');

/** The 15th of the month `back` months before this one (UTC; the window is wide enough for a boundary day). */
function dayInMonth(back: number): string {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 15));
  return m.toISOString().slice(0, 10);
}

test('AC-WIH-017: Finance ranks work in hand, switches the order and opens a contract', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, svcKey!);
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const big = { id: crypto.randomUUID(), name: `WIH big ${tag}` };
  const slow = { id: crypto.randomUUID(), name: `WIH slow ${tag}` };
  const workOrderId = crypto.randomUUID();
  const invoiceIds = [crypto.randomUUID(), crypto.randomUUID()];

  const { error: pErr } = await admin.from('projects').insert([
    { id: big.id, org_id: ORG_ID, name: big.name, status: 'Ongoing Project', contract_value: 2_000_000, tax_treatment: 'exclusive', tax_amount: 0 },
    { id: slow.id, org_id: ORG_ID, name: slow.name, status: 'Ongoing Project', contract_value: 900_000, tax_treatment: 'exclusive', tax_amount: 0 },
  ]);
  if (pErr) throw new Error(`seed projects failed: ${pErr.message}`);
  const { error: iErr } = await admin.from('sales_invoices').insert([
    { id: invoiceIds[0], org_id: ORG_ID, project_id: big.id, amount: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid', invoice_date: dayInMonth(2) },
    { id: invoiceIds[1], org_id: ORG_ID, project_id: slow.id, amount: 100_000, tax_treatment: 'exclusive', tax_amount: 0, status: 'Unpaid', invoice_date: dayInMonth(2) },
  ]);
  if (iErr) throw new Error(`seed invoices failed: ${iErr.message}`);
  const { error: wErr } = await admin.from('work_orders').insert({
    id: workOrderId, org_id: ORG_ID, project_id: big.id, title: `WIH order ${tag}`, status: 'Issued', order_value: 300_000, tax_treatment: 'exclusive', tax_amount: 0,
  });
  if (wErr) throw new Error(`seed work order failed: ${wErr.message}`);

  try {
    await page.route('**/rest/v1/org_features*', async (route) => {
      const response = await route.fetch({ maxRetries: 2 });
      if (!response.ok()) { await route.fulfill({ response }); return; }
      const rows = (await response.json()) as Array<{ feature_key?: string; enabled?: boolean }>;
      await route.fulfill({ response, json: [...rows.filter((r) => r.feature_key !== 'revenue'), { feature_key: 'revenue', enabled: true }] });
    });
    await signIn(page, 'finance@acme.test');

    // The user's route: Finance hub -> Work in hand.
    await page.goto('/finance');
    await page.getByRole('link', { name: 'Work in hand' }).first().click();
    await expect(page).toHaveURL(/\/finance\/work-in-hand/);
    await expect(page.getByRole('heading', { name: 'Work in hand' })).toBeVisible();

    const rowIndex = async (id: string) => page.locator('[data-testid^="wih-row-"]').evaluateAll(
      (els, wanted) => els.findIndex((el) => el.getAttribute('data-testid') === `wih-row-${wanted}`), id);

    const bigRow = page.getByTestId(`wih-row-${big.id}`);
    await expect(bigRow).toBeVisible();
    await expect(bigRow).toContainText(/1[.,]000[.,]000/);

    // Default order is Left to bill: BIG (1,000,000) before SLOW (800,000), and the work order sits under its contract.
    expect(await rowIndex(big.id)).toBeGreaterThanOrEqual(0);
    expect(await rowIndex(big.id)).toBeLessThan(await rowIndex(slow.id));
    expect(await rowIndex(workOrderId)).toBe((await rowIndex(big.id)) + 1);

    // Months of backlog order: SLOW (8 x the months billed) before BIG.
    await page.getByTestId('wih-sort-backlog').click();
    await expect.poll(async () => (await rowIndex(slow.id)) < (await rowIndex(big.id))).toBe(true);

    // A row opens its contract's page.
    await page.getByRole('link', { name: new RegExp(slow.name) }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${slow.id}`));
  } finally {
    await admin.from('work_orders').delete().eq('id', workOrderId);
    await admin.from('sales_invoices').delete().in('id', invoiceIds);
    await admin.from('projects').delete().in('id', [big.id, slow.id]);
  }
});
