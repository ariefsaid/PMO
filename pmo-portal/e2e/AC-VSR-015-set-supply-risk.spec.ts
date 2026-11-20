// @e2e-isolation: self-isolated — creates its own vendor, project, work order, cases and order with unique names; removes only its own rows.
/**
 * AC-VSR-015 (#2583) — Finance opens a supplier whose unpaid invoice is over 60 days old, sees "Suggested: at risk",
 * presses "Set to suggested", gives a reason, and the supplier shows At risk with who and when, plus the work orders
 * exposed to it. Goal oracle: the stored status changed ONLY by that person's save, and the exposed work order's page
 * now carries a warning naming the supplier.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { login, requireServiceRoleKey } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const serviceKey = requireServiceRoleKey();
test.skip(!serviceKey, 'AC-VSR-015 requires service-role access for isolated fixture setup and cleanup.');
test.setTimeout(120_000);

const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const ids = {
  vendor: crypto.randomUUID(), project: crypto.randomUUID(), workOrder: crypto.randomUUID(),
  unpaidCase: crypto.randomUUID(), orderCase: crypto.randomUUID(), invoice: crypto.randomUUID(), order: crypto.randomUUID(),
};
const vendorName = `VSR vendor ${suffix}`;
const woTitle = `VSR work order ${suffix}`;

function adminClient() {
  return createClient<Database>(SUPABASE_URL, serviceKey as string, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function seed(admin: ReturnType<typeof adminClient>) {
  const check = (label: string, error: { message: string } | null) => { if (error) throw new Error(`${label} fixture failed: ${error.message}`); };
  const hundredDaysAgo = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
  check('vendor', (await admin.from('companies').insert({ id: ids.vendor, org_id: ORG_ID, name: vendorName, type: 'Vendor' })).error);
  check('project', (await admin.from('projects').insert({
    id: ids.project, org_id: ORG_ID, name: `VSR project ${suffix}`, status: 'Ongoing Project', contract_value: 1_000_000,
    tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
  })).error);
  check('work order', (await admin.from('work_orders').insert({
    id: ids.workOrder, org_id: ORG_ID, project_id: ids.project, title: woTitle, order_value: 100,
    tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR',
  })).error);
  check('cases', (await admin.from('procurements').insert([
    { id: ids.unpaidCase, org_id: ORG_ID, title: `VSR unpaid ${suffix}`, status: 'Vendor Invoiced', vendor_id: ids.vendor, currency: 'IDR', project_id: ids.project },
    { id: ids.orderCase, org_id: ORG_ID, title: `VSR order ${suffix}`, status: 'Ordered', vendor_id: ids.vendor, currency: 'IDR', project_id: ids.project },
  ])).error);
  check('invoice', (await admin.from('procurement_invoices').insert({
    id: ids.invoice, org_id: ORG_ID, procurement_id: ids.unpaidCase, invoice_date: hundredDaysAgo, status: 'Received',
    amount: 1_000_000, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0,
  })).error);
  check('order', (await admin.from('purchase_orders').insert({
    id: ids.order, org_id: ORG_ID, procurement_id: ids.orderCase, status: 'Issued', amount: 500, work_order_id: ids.workOrder,
  })).error);
}

async function cleanup(admin: ReturnType<typeof adminClient>) {
  const failures: string[] = [];
  const attempt = async (label: string, run: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run;
    if (error) failures.push(`${label}: ${error.message}`);
  };
  await attempt('purchase_orders', admin.from('purchase_orders').delete().eq('id', ids.order));
  await attempt('procurement_invoices', admin.from('procurement_invoices').delete().eq('id', ids.invoice));
  await attempt('procurements', admin.from('procurements').delete().in('id', [ids.unpaidCase, ids.orderCase]));
  await attempt('work_orders', admin.from('work_orders').delete().eq('id', ids.workOrder));
  await attempt('projects', admin.from('projects').delete().eq('id', ids.project));
  await attempt('audit', admin.from('audit_events').delete().eq('entity_id', ids.vendor));
  await attempt('record_changes', admin.from('record_changes').delete().eq('entity_id', ids.vendor));
  await attempt('notifications', admin.from('notifications').delete().contains('metadata', { entity: { id: ids.vendor } }));
  await attempt('companies', admin.from('companies').delete().eq('id', ids.vendor));
  if (failures.length > 0) throw new Error(`AC-VSR-015 cleanup failed: ${failures.join('; ')}`);
}

test('AC-VSR-015 Finance accepts the suggested at-risk status with a reason and sees the exposed work order', async ({ page }) => {
  const admin = adminClient();
  let journeyError: unknown;
  try {
    await seed(admin);
    await login(page, 'finance@acme.test');
    await page.goto(`/companies/${ids.vendor}`);

    // The suggestion reads the unpaid invoice's age; the stored status is still active (nothing set it).
    const suggestion = page.getByTestId('supply-risk-suggestion');
    await expect(suggestion).toContainText(/Suggested: at risk, 1 invoice over 60 days|Saran: berisiko, 1 faktur lebih dari 60 hari/);
    await expect(page.getByTestId('supply-risk-current')).toContainText(/Active|Aktif/);

    await page.getByTestId('supply-risk-set-suggested').click();
    await page.getByLabel(/Reason|Alasan/).fill('Invoices are 100 days unpaid and deliveries are slowing');
    await page.getByRole('button', { name: /Save status|Simpan status/ }).click();

    // The supplier now shows At risk, with who and when, and the reason.
    await expect(page.getByTestId('supply-risk-current')).toContainText(/At risk|Berisiko/);
    await expect(page.getByTestId('supply-risk-current')).toContainText(/Set by .* on|Ditetapkan oleh .* pada/);
    await expect(page.getByTestId('supply-risk-reason')).toContainText('Invoices are 100 days unpaid');

    // The work orders exposed to this supplier are listed.
    await expect(page.getByTestId('supply-risk-exposed-wo')).toContainText(woTitle);

    // And the exposed work order itself carries the warning, naming the supplier.
    await page.goto(`/work-orders/${ids.workOrder}`);
    await expect(page.getByTestId('supply-risk-warning')).toContainText(vendorName);
  } catch (error) {
    journeyError = error;
  }
  let cleanupError: unknown;
  try {
    await cleanup(admin);
  } catch (error) {
    cleanupError = error;
  }
  if (journeyError && cleanupError) {
    throw new Error(`AC-EH-006: journey failed (${String(journeyError)}) and cleanup failed (${String(cleanupError)})`);
  }
  if (journeyError) throw journeyError;
  if (cleanupError) throw cleanupError;
});
