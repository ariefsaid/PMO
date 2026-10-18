// @e2e-isolation: self-isolated — creates one synthetic invoice and linked receipt with per-run IDs, then removes only those rows.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { requireServiceRoleKey, signIn } from './helpers';

const SEED_ORG_ID = '00000000-0000-0000-0000-000000000001';
if (process.env.E2E_ORG_ID && process.env.E2E_ORG_ID !== SEED_ORG_ID) {
  throw new Error('AC-S40-005 is admitted only for the local seed organization.');
}
const ORG_ID = SEED_ORG_ID;
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL,
);
const serviceRoleKey = requireServiceRoleKey();
if (!serviceRoleKey) {
  throw new Error('AC-S40-005 requires the local service-role fixture client; run through scripts/e2e-local.sh.');
}

const admin = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });

interface Fixture {
  invoiceId: string;
  receiptId: string;
  invoiceNumber: string;
  receiptNumber: string;
  runMarker: string;
}

function persistFixtureLedger(testInfo: TestInfo, fixture: Fixture): string {
  const ledgerPath = testInfo.outputPath('ac-s40-005-fixture-owner.json');
  mkdirSync(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
  writeFileSync(ledgerPath, `${JSON.stringify({
    acceptance: 'AC-S40-005',
    orgId: ORG_ID,
    invoiceId: fixture.invoiceId,
    invoiceNumber: fixture.invoiceNumber,
    receiptId: fixture.receiptId,
    receiptNumber: fixture.receiptNumber,
    runMarker: fixture.runMarker,
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  chmodSync(ledgerPath, 0o600);
  return ledgerPath;
}

async function readOwnedInvoice(fixture: Fixture) {
  const { data, error } = await admin.from('sales_invoices')
    .select('id, org_id, si_number, reference_number')
    .eq('id', fixture.invoiceId)
    .eq('org_id', ORG_ID)
    .maybeSingle();
  if (error) throw new Error('AC-S40-005 could not verify the exact invoice fixture during cleanup.');
  if (!data) return null;
  if (data.si_number !== fixture.invoiceNumber || data.reference_number !== fixture.runMarker) {
    throw new Error('AC-S40-005 found an unexpected row at the owned invoice ID; preserving it for reconciliation.');
  }
  return data;
}

async function readOwnedReceipt(fixture: Fixture) {
  const { data, error } = await admin.from('incoming_payments')
    .select('id, org_id, ip_number, reference_number, sales_invoice_id')
    .eq('id', fixture.receiptId)
    .eq('org_id', ORG_ID)
    .maybeSingle();
  if (error) throw new Error('AC-S40-005 could not verify the exact receipt fixture during cleanup.');
  if (!data) return null;
  if (
    data.ip_number !== fixture.receiptNumber ||
    data.reference_number !== fixture.runMarker ||
    data.sales_invoice_id !== fixture.invoiceId
  ) {
    throw new Error('AC-S40-005 found an unexpected row at the owned receipt ID; preserving it for reconciliation.');
  }
  return data;
}

async function deleteOwnedReceipt(fixture: Fixture): Promise<void> {
  if (!(await readOwnedReceipt(fixture))) return;
  const { data, error } = await admin.from('incoming_payments').delete()
    .eq('id', fixture.receiptId)
    .eq('org_id', ORG_ID)
    .eq('ip_number', fixture.receiptNumber)
    .eq('reference_number', fixture.runMarker)
    .select('id');
  if (error) {
    const remains = await readOwnedReceipt(fixture);
    if (remains) throw new Error('AC-S40-005 receipt cleanup outcome is unknown; preserving the invoice and receipt for reconciliation.');
    return;
  }
  if (data?.length !== 1 && await readOwnedReceipt(fixture)) {
    throw new Error('AC-S40-005 receipt cleanup did not remove exactly the owned row; preserving remaining fixtures.');
  }
}

async function deleteOwnedInvoice(fixture: Fixture): Promise<void> {
  if (!(await readOwnedInvoice(fixture))) return;
  const { data, error } = await admin.from('sales_invoices').delete()
    .eq('id', fixture.invoiceId)
    .eq('org_id', ORG_ID)
    .eq('si_number', fixture.invoiceNumber)
    .eq('reference_number', fixture.runMarker)
    .select('id');
  if (error) {
    const remains = await readOwnedInvoice(fixture);
    if (remains) throw new Error('AC-S40-005 invoice cleanup outcome is unknown; preserving it for reconciliation.');
  } else if (data?.length !== 1 && await readOwnedInvoice(fixture)) {
    throw new Error('AC-S40-005 invoice cleanup did not remove exactly the owned row; preserving it for reconciliation.');
  }

  // 0278 records the synthetic invoice insert in record_changes. Remove only that history row;
  // append-only audit_events deliberately retain the four create/delete events for these IDs.
  const { error: historyError } = await admin.from('record_changes').delete()
    .eq('org_id', ORG_ID)
    .eq('entity_type', 'sales_invoice')
    .eq('entity_id', fixture.invoiceId);
  if (historyError) throw new Error('AC-S40-005 could not remove the exact synthetic invoice history row.');
}

async function seedFixture(fixture: Fixture, testInfo: TestInfo, armCleanup: () => void): Promise<void> {
  const [invoiceProbe, receiptProbe] = await Promise.all([
    admin.from('sales_invoices').select('id').eq('id', fixture.invoiceId).maybeSingle(),
    admin.from('incoming_payments').select('id').eq('id', fixture.receiptId).maybeSingle(),
  ]);
  const [invoiceNumberProbe, receiptNumberProbe] = await Promise.all([
    admin.from('sales_invoices').select('id').eq('org_id', ORG_ID).eq('si_number', fixture.invoiceNumber).maybeSingle(),
    admin.from('incoming_payments').select('id').eq('org_id', ORG_ID).eq('ip_number', fixture.receiptNumber).maybeSingle(),
  ]);
  if (invoiceProbe.error || receiptProbe.error || invoiceNumberProbe.error || receiptNumberProbe.error) {
    throw new Error('AC-S40-005 could not confirm fixture IDs are unused; no fixture writes were attempted.');
  }
  if (invoiceProbe.data || receiptProbe.data || invoiceNumberProbe.data || receiptNumberProbe.data) {
    throw new Error('AC-S40-005 generated a fixture ID already in use; no fixture writes were attempted.');
  }

  // Persist the exact owner IDs/markers before DML so an interrupted run can be reconciled.
  // If the preflight or attachment fails, cleanup is not armed and no existing row is touched.
  const ledgerPath = persistFixtureLedger(testInfo, fixture);
  await testInfo.attach('AC-S40-005 fixture owner IDs', { path: ledgerPath, contentType: 'application/json' });
  armCleanup();

  const invoice = await admin.from('sales_invoices').insert({
    id: fixture.invoiceId,
    org_id: ORG_ID,
    si_number: fixture.invoiceNumber,
    reference_number: fixture.runMarker,
    invoice_date: '2026-10-18',
    amount: null,
    erp_outstanding_amount: null,
    status: 'Draft',
    erp_docstatus: null,
    currency: 'USD',
    tax_treatment: 'exclusive',
    tax_amount: 0,
    pmo_native: false,
  }).select('id').single();
  if (invoice.error || invoice.data?.id !== fixture.invoiceId) {
    throw new Error('AC-S40-005 invoice fixture insert did not return its exact generated ID.');
  }

  const receipt = await admin.from('incoming_payments').insert({
    id: fixture.receiptId,
    org_id: ORG_ID,
    sales_invoice_id: fixture.invoiceId,
    ip_number: fixture.receiptNumber,
    reference_number: fixture.runMarker,
    date: '2026-10-18',
    amount: null,
    status: 'Scheduled',
    erp_docstatus: null,
    currency: 'USD',
    pmo_native: false,
  }).select('id').single();
  if (receipt.error || receipt.data?.id !== fixture.receiptId) {
    throw new Error('AC-S40-005 receipt fixture insert did not return its exact generated ID.');
  }
}

async function openPalette(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /command palette/i });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function searchAndOpen(
  page: Page,
  reference: string,
  canonicalPath: string,
  heading: RegExp,
): Promise<void> {
  await openPalette(page);
  const dialog = page.getByRole('dialog', { name: /command palette/i });
  const rpcResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/rest/v1/rpc/search_record_references')
      && response.request().method() === 'POST';
  });
  await dialog.getByRole('combobox').fill(reference);
  const response = await rpcResponse;
  expect(response.ok()).toBe(true);

  const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const result = page.getByRole('option', { name: new RegExp(escapedReference) });
  await expect(result).toBeVisible();
  await expect(result).toContainText(reference);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === canonicalPath);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

test('AC-S40-005: Finance searches a real reference result and opens its canonical invoice and receipt', async ({ page }, testInfo) => {
  const runToken = crypto.randomUUID();
  const marker = `AC-S40-005:${runToken}`;
  const compact = runToken.replaceAll('-', '').slice(0, 16).toUpperCase();
  const fixture: Fixture = {
    invoiceId: crypto.randomUUID(),
    receiptId: crypto.randomUUID(),
    invoiceNumber: `SI-AC-S40-005-${compact}`,
    receiptNumber: `IP-AC-S40-005-${compact}`,
    runMarker: marker,
  };

  let cleanupArmed = false;
  try {
    await seedFixture(fixture, testInfo, () => { cleanupArmed = true; });
    await signIn(page, 'finance@acme.test');
    await searchAndOpen(
      page,
      fixture.invoiceNumber,
      `/sales-invoices/${fixture.invoiceId}`,
      new RegExp(fixture.invoiceNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    await searchAndOpen(
      page,
      fixture.receiptNumber,
      `/incoming-payments/${fixture.receiptId}`,
      new RegExp(fixture.receiptNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  } finally {
    if (cleanupArmed) {
      await deleteOwnedReceipt(fixture);
      await deleteOwnedInvoice(fixture);
    }
  }
});
