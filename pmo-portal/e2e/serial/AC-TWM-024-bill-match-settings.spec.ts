// @e2e-isolation: serial — switches the organisation's three-way match on, which holds every new bill without match lines org-wide; reset in afterEach.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { login, requireServiceRoleKey } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

// AC-TWM-024 — curated journey (#2634): an Admin switches the three-way match on in Accounting setup; a bill recorded
// after that is held (it has no match lines); the receipt and the bill's lines are filled in the app; the bill clears
// with NO exception. Goal oracle: the bill's hold is gone and no exception row exists.
// The purchase, its ordered item, its receipt and its bill are created per run by service role and removed afterwards.
const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const EXEC_ID = '00000000-0000-0000-0000-0000000000a1';
const SEED_PROJECT_ID = '40000000-0000-0000-0000-000000000003';

function serviceClient(): SupabaseClient {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('this journey requires the service-role key supplied by scripts/e2e-local.sh or CI.');
  const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL);
  if (!url) throw new Error('this journey requires SUPABASE_URL supplied by scripts/e2e-local.sh or CI.');
  return createClient(url, key, { auth: { persistSession: false } });
}

const admin = serviceClient;
let procId = '';
let invoiceId = '';

async function switchMatchOff(db: SupabaseClient) {
  await db.from('org_three_way_match_settings').update({ enabled: false, quantity_tolerance_pct: 0, amount_tolerance_pct: 0 }).neq('org_id', '00000000-0000-0000-0000-000000000000');
}

test.afterEach(async () => {
  const db = admin();
  await switchMatchOff(db);
  if (invoiceId) await db.from('procurement_invoices').delete().eq('id', invoiceId);
  if (procId) {
    await db.from('procurement_receipts').delete().eq('procurement_id', procId);
    await db.from('procurement_items').delete().eq('procurement_id', procId);
    await db.from('procurements').delete().eq('id', procId);
  }
  procId = ''; invoiceId = '';
});

test('AC-TWM-024 an Admin switches the match on and fixes a held bill\'s lines in the app; it clears with no exception', async ({ page }) => {
  test.setTimeout(120_000);
  const db = admin();
  procId = randomUUID();
  const code = `E2E-${procId.slice(0, 8).toUpperCase()}`;
  await switchMatchOff(db);
  const proc = await db.from('procurements').insert({
    id: procId, code, title: `Match journey ${code}`, project_id: SEED_PROJECT_ID, requested_by_id: PM_ID,
    status: 'Vendor Invoiced', total_value: 100000, approved_total_value: 100000, approved_by_id: EXEC_ID,
  });
  if (proc.error) throw new Error(`purchase insert failed: ${proc.error.message}`);
  const item = await db.from('procurement_items').insert({ procurement_id: procId, name: 'Cement', description: 'e2e', quantity: 100, rate: 1000 });
  if (item.error) throw new Error(`item insert failed: ${item.error.message}`);
  const receipt = await db.from('procurement_receipts').insert({ procurement_id: procId, status: 'Partial', receipt_date: '2026-11-20' });
  if (receipt.error) throw new Error(`receipt insert failed: ${receipt.error.message}`);

  await login(page, 'admin@acme.test');
  await page.goto('/administration/accounting');
  const toggle = page.getByRole('switch', { name: 'Check vendor bills against the order and receipts before payment' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // A bill recorded after the switch-on is in scope and, with no lines, held.
  const bill = await db.from('procurement_invoices').insert({
    procurement_id: procId, status: 'Received', invoice_date: '2026-11-21', amount: 60000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single();
  if (bill.error) throw new Error(`bill insert failed: ${bill.error.message}`);
  invoiceId = bill.data.id as string;

  await page.goto(`/procurement/${procId}`);
  const held = page.getByTestId(`bill-match-held-${invoiceId}`);
  await expect(held).toBeVisible();

  // The receipt's quantities, then the bill's lines.
  await page.getByRole('button', { name: 'Row actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Record received quantities' }).click();
  await page.locator('input[id^="match-qty-"]').first().fill('60');
  await page.getByRole('button', { name: 'Save lines' }).click();
  await expect(page.getByTestId('match-lines-result')).toContainText('Receipt lines saved');
  await page.getByRole('button', { name: 'Done' }).click();

  await held.getByRole('button', { name: 'Edit bill lines' }).click();
  await page.locator('input[id^="match-qty-"]').first().fill('60');
  await page.getByRole('button', { name: 'Save lines' }).click();
  await expect(page.getByTestId('match-lines-result')).toContainText('This bill now matches');
  await page.getByRole('button', { name: 'Done' }).click();

  // Goal: the hold is gone, and it was not cleared by an exception.
  await expect(page.getByTestId(`bill-match-held-${invoiceId}`)).toHaveCount(0);
  const exceptions = await db.from('bill_match_exceptions').select('invoice_id').eq('invoice_id', invoiceId);
  expect(exceptions.data ?? []).toHaveLength(0);
});
