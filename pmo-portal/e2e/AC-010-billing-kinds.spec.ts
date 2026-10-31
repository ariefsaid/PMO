// @e2e-isolation: self-isolated - owns its project/invoices/refs and cleans them up.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey, waitForFonts } from './helpers';

// AC-010 (billing kinds, #1471) - Finance corrects a paid, already-linked adopted invoice to Other billing.
//
// Journey: a project whose contract is 1000 carries two adopted invoices, 500 (the licence fee, paid) and 900, both left at
// the default Contract billing, so the project reads "Invoiced above contract by 400" with both invoices listed. Finance
// opens the paid invoice's attribution action, marks it Other billing and saves (no project change, so no confirm step).
// Remaining to invoice then reads 100 and the excess is gone, while the project's invoiced and billed-work revenue are
// exactly what they were before: the kind changes only the contract comparison. It survives a reload; the kind-only
// correction wrote one history event and enqueued no ERP command (the dispatch endpoint is spied and never called).
//
// ISOLATION: unique project, invoices and refs per run, deleted in reverse-FK order in afterEach even on failure.

test.setTimeout(180_000);

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

const svcKey = requireServiceRoleKey();
if (!svcKey) {
  throw new Error('AC-010: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey (local fixture dependency) - it must not silently skip.');
}
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

let PROJECT_ID: string;
let PROJECT_NAME: string;
let PAID_ID: string;
let OPEN_ID: string;
let PAID_NO: string;
let OPEN_NO: string;

async function seedFixtures(): Promise<void> {
  const { error: projectError } = await admin.from('projects').insert({
    id: PROJECT_ID, org_id: ORG_ID, name: PROJECT_NAME, status: 'Ongoing Project',
    currency: 'USD', contract_value: 1000, tax_treatment: 'exclusive', tax_amount: 0,
  });
  if (projectError) throw new Error(`AC-010 seed project failed: ${projectError.message}`);
  const invoice = (id: string, number: string, amount: number, outstanding: number, status: 'Paid' | 'Unpaid') => ({
    id, org_id: ORG_ID, project_id: PROJECT_ID, si_number: number, invoice_date: '2026-01-01', amount,
    erp_outstanding_amount: outstanding, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    status, erp_docstatus: 1, pmo_native: false, author_user_id: null,
  });
  const { error: invoiceError } = await admin.from('sales_invoices').insert([
    invoice(PAID_ID, PAID_NO, 500, 0, 'Paid'), invoice(OPEN_ID, OPEN_NO, 900, 900, 'Unpaid'),
  ]);
  if (invoiceError) throw new Error(`AC-010 seed invoices failed: ${invoiceError.message}`);
  const { error: refError } = await admin.from('external_refs').insert([
    { org_id: ORG_ID, domain: 'revenue', pmo_record_id: PAID_ID, external_tier: 'erpnext', external_record_id: PAID_NO },
    { org_id: ORG_ID, domain: 'revenue', pmo_record_id: OPEN_ID, external_tier: 'erpnext', external_record_id: OPEN_NO },
  ]);
  if (refError) throw new Error(`AC-010 seed external refs failed: ${refError.message}`);
}

async function cleanup(): Promise<void> {
  await admin.from('record_changes').delete().in('entity_id', [PAID_ID, OPEN_ID, PROJECT_ID]);
  await admin.from('external_refs').delete().in('pmo_record_id', [PAID_ID, OPEN_ID]);
  await admin.from('sales_invoices').delete().in('id', [PAID_ID, OPEN_ID]);
  await admin.from('projects').delete().eq('id', PROJECT_ID);
}

test.beforeEach(async () => {
  const runId = crypto.randomUUID();
  PROJECT_ID = crypto.randomUUID();
  PAID_ID = crypto.randomUUID();
  OPEN_ID = crypto.randomUUID();
  PROJECT_NAME = `BKIND 1471 Overrun ${runId}`;
  PAID_NO = `SI-BKIND-PAID-${runId}`;
  OPEN_NO = `SI-BKIND-OPEN-${runId}`;
  await seedFixtures();
});

test.afterEach(async () => {
  await cleanup();
});

async function openFinances(page: import('@playwright/test').Page) {
  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole('region', { name: 'Money position' }).getByRole('button', { name: 'Details', exact: true }).click();
  const section = page.getByTestId('project-finances');
  await expect(section).toBeVisible({ timeout: 20_000 });
  const usd = page.getByTestId('project-finances-USD');
  await expect(usd).toBeVisible({ timeout: 20_000 });
  return { section, usd };
}

const field = (scope: import('@playwright/test').Locator, label: string) =>
  scope.locator('dl > div').filter({ hasText: label }).locator('dd').first();

test('AC-010: Finance marks a paid linked invoice as Other billing - the excess resolves, remaining reflects only contract billing, and revenue is unchanged', async ({ page }) => {
  const adapterCommands: string[] = [];
  await page.route('**/functions/v1/adapter-dispatch*', (route) => {
    adapterCommands.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await signIn(page, 'finance@acme.test');

  // 1-2. Contract billing 1400 against a contract of 1000: the section says by how much and lists both invoices.
  const before = await openFinances(page);
  await waitForFonts(page);
  const excess = page.getByTestId('contract-excess');
  await expect(excess.getByText('Invoiced above contract by 400')).toBeVisible({ timeout: 20_000 });
  await expect(excess.getByRole('link', { name: PAID_NO })).toBeVisible();
  await expect(excess.getByRole('link', { name: OPEN_NO })).toBeVisible();
  await expect(page.getByText('Remaining to invoice')).toHaveCount(0);
  const invoicedBefore = await field(before.usd, 'Invoiced').textContent();
  const workBefore = await field(before.usd, 'Billed-work revenue').textContent();
  expect(invoicedBefore).toBe('1,400');

  // 3. The paid invoice's attribution action: same project, kind only, so there is no project-change confirmation.
  await page.goto(`/sales-invoices?q=${PAID_NO}`);
  const row = page.locator('tbody tr', { hasText: PAID_NO });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: 'Change project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change project' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('combobox', { name: 'Billing kind' })).toHaveValue('contract');
  await dialog.getByRole('combobox', { name: 'Billing kind' }).selectOption('other');
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });

  // 4. The goal: remaining reflects only contract billing, the excess is gone, revenue figures are exactly as before.
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    const after = await openFinances(page);
    await expect(field(after.section, 'Remaining to invoice')).toHaveText('100', { timeout: 20_000 });
    await expect(page.getByTestId('contract-excess')).toHaveCount(0);
    await expect(page.getByText(/Invoiced above contract/)).toHaveCount(0);
    await expect(field(after.usd, 'Invoiced')).toHaveText(invoicedBefore ?? '');
    await expect(field(after.usd, 'Billed-work revenue')).toHaveText(workBefore ?? '');
  }

  // 5. Persisted as a PMO-only change: one history event, no ERP command, no dispatch call.
  const { data: saved } = await admin.from('sales_invoices').select('billing_kind').eq('id', PAID_ID).single();
  expect(saved?.billing_kind).toBe('other');
  const { data: untouched } = await admin.from('sales_invoices').select('billing_kind').eq('id', OPEN_ID).single();
  expect(untouched?.billing_kind).toBe('contract');
  const { data: history } = await admin.from('record_changes').select('changes').eq('entity_id', PAID_ID).eq('entity_type', 'sales_invoice');
  expect(history?.filter((h) => (h.changes as Record<string, unknown>).billing_kind)).toHaveLength(1);
  const { data: outbox } = await admin.from('external_command_outbox').select('id').eq('pmo_record_id', PAID_ID);
  expect(outbox ?? []).toHaveLength(0);
  expect(adapterCommands).toEqual([]);
});
