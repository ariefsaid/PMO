// @e2e-isolation: serial — connects a disposable org's ERP binding; uses a disposable ERPNext company pre-loaded with overlapping records.
/**
 * AC-ECA-051 — S-D: a live PMO org connects to an ERPNext company that already holds some of the same records.
 *
 * Given a PMO org (3 vendors, a client, 2 projects, one native invoice) and an ERPNext company holding 2 of the 3 vendors
 * (one only by tax id, under a different name), 1 of the 2 projects (same code), the client, and a Sales Invoice for the same sale,
 * When the Admin opens Integrations > Match records and accepts all, then counts the paired invoices once on Finance,
 * Then every overlapping vendor and project has exactly one PMO row and one ERP document (no duplicate Supplier or Project on the
 * bench), and the project's billed figure in PMO equals the ERP invoice total, counted once.
 *
 * The paired PMO invoice has no PMO receipt (PD-ECA-11). Real boundaries only; gated on the dependency, never process.env.CI.
 * Run: scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- scripts/e2e-local.sh --project=serial --workers=1 e2e/serial/AC-ECA-051
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  ANON_KEY, AUTH_URL, SERVICE_KEY, FUNCTIONS_URL, READY, activateBinding, benchCount, benchCreate, benchDoc, benchList,
  createBenchCompany, createOrg, dropOrg, loginAs, openMatchRecords, untilWithSweep,
} from './_ecaHelpers';

if (FUNCTIONS_URL && !READY) throw new Error('AC-ECA-051: the served lane is up but its disposable ERP fixture env is incomplete: never a silent skip.');
test.skip(!READY, 'AC-ECA-051 requires the served lane and the prepared ERPNext bed.');
test.setTimeout(420_000);

const AMOUNT = 5_000_000;

test('AC-ECA-051 an Admin connects a live PMO org to an ERP that holds some of the same records: each is linked once, no duplicates, revenue counted once', async ({ page }) => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const org = await createOrg(admin, suffix);
  try {
    const company = await createBenchCompany(suffix);
    const must = async (q: PromiseLike<{ error: { message: string } | null }>, what: string) => {
      const { error } = await q; if (error) throw new Error(`seed ${what} failed: ${error.message}`);
    };
    const taxId = `01.${suffix.replace(/\D/g, '').slice(-9).padStart(9, '7')}`;
    const v = [1, 2, 3].map((n) => ({ id: crypto.randomUUID(), name: `ECA051 Vendor ${n} ${suffix}` }));
    const client = { id: crypto.randomUUID(), name: `ECA051 Client ${suffix}` };
    const p = [1, 2].map((n) => ({ id: crypto.randomUUID(), name: `ECA051 Project ${n} ${suffix}` }));

    // -- Given the ERP side -----------------------------------------------------------------------------------------------
    await benchCreate('Supplier', { supplier_name: v[0].name, supplier_group: 'All Supplier Groups' });
    await benchCreate('Supplier', { supplier_name: `ECA051 Renamed Supplier ${suffix}`, supplier_group: 'All Supplier Groups', tax_id: taxId });
    await benchCreate('Customer', { customer_name: client.name, customer_group: 'All Customer Groups', territory: 'All Territories' });
    const erpProject1 = String((await benchCreate('Project', { project_name: p[0].name, company, is_active: 'Yes' })).name);
    const serviceItem = `ECA051 Service ${suffix}`;
    await benchCreate('Item', { item_code: serviceItem, item_name: serviceItem, item_group: 'Services', stock_uom: 'Nos', is_stock_item: 0 });
    const today = new Date().toISOString().slice(0, 10);
    const reference = `ECA051-PO-${suffix}`;
    const erpInvoice = await benchCreate('Sales Invoice', {
      company, customer: client.name, posting_date: today, due_date: today, po_no: reference, project: erpProject1, currency: 'IDR',
      items: [{ item_code: serviceItem, qty: 1, rate: AMOUNT }], docstatus: 1,
    });
    const erpTotal = Number((await benchDoc('Sales Invoice', String(erpInvoice.name))).grand_total);
    expect(erpTotal).toBe(AMOUNT);

    // -- Given the PMO side -----------------------------------------------------------------------------------------------
    await must(admin.from('companies').insert([
      ...v.map((x, i) => ({ id: x.id, org_id: org.orgId, name: x.name, type: 'Vendor', erp_tax_id: i === 1 ? taxId : null })),
      { id: client.id, org_id: org.orgId, name: client.name, type: 'Client' },
    ]), 'companies');
    await must(admin.from('projects').insert([
      { id: p[0].id, org_id: org.orgId, name: p[0].name, code: erpProject1, status: 'Ongoing Project', client_id: client.id },
      { id: p[1].id, org_id: org.orgId, name: p[1].name, status: 'Ongoing Project', client_id: client.id },
    ]), 'projects');
    const pmoInvoice = crypto.randomUUID();
    await must(admin.from('sales_invoices').insert({
      id: pmoInvoice, org_id: org.orgId, project_id: p[0].id, customer_id: client.id, invoice_date: today, amount: AMOUNT,
      erp_outstanding_amount: AMOUNT, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR', status: 'Unpaid',
      reference_number: reference, native_lines: [{ description: 'ECA051' }], pmo_native: true, author_user_id: org.adminId,
      pmo_number: `PMO-ECA051-${suffix}`,
    }), 'sales_invoices');
    await activateBinding(admin, org.orgId, company, ['revenue']);

    // -- When: Match records -> Accept all ----------------------------------------------------------------------------------
    await loginAs(page, org.adminEmail);
    await openMatchRecords(page, org);
    const review = page.getByTestId('connect-proposal-review');
    const partyCard = review.getByTestId('connect-kind-party');
    await untilWithSweep(org.orgId, async () => {
      await expect(partyCard).toContainText('4 in PMO, 3 in the connected system', { timeout: 3_000 }); // 3 vendors + 1 client; 2 suppliers + 1 customer
    }, 120_000);
    await review.getByRole('button', { name: 'Accept all' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Accept all' }).click();
    await untilWithSweep(org.orgId, async () => {
      await expect(partyCard).toContainText('4 vendors in PMO, 4 in the connected system, 4 are the same', { timeout: 3_000 });
    }, 90_000);

    // -- When: both sides hold the invoice, Finance counts each once ----------------------------------------------------------
    await page.goto('/finance');
    const pairs = page.getByRole('region', { name: 'Invoices on both sides' });
    await untilWithSweep(org.orgId, async () => {
      await page.reload();
      await expect(pairs.getByRole('button', { name: 'Count each once' })).toBeVisible({ timeout: 5_000 });
    }, 120_000);
    await pairs.getByRole('button', { name: 'Count each once' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Count once' }).click();
    await expect(pairs.getByText('1 invoice already counts once')).toBeVisible({ timeout: 30_000 });

    // -- Then: no duplicates on either side ---------------------------------------------------------------------------------
    for (const x of [v[0], v[1], v[2], client]) {
      const { count } = await admin.from('companies').select('id', { count: 'exact', head: true }).eq('org_id', org.orgId).eq('name', x.name);
      expect(count, `PMO holds exactly one ${x.name}`).toBe(1);
    }
    expect(await benchCount('Supplier', [['supplier_name', 'like', `%${suffix}%`]]), '3 vendors -> 3 Suppliers (one pre-existing by name, one by tax id, one sent)').toBe(3);
    expect(await benchCount('Supplier', [['tax_id', '=', taxId]]), 'the tax-id match is the one Supplier with that tax id').toBe(1);
    expect(await benchCount('Customer', [['customer_name', '=', client.name]])).toBe(1);
    expect(await benchCount('Project', [['company', '=', company]]), '2 projects -> 2 ERP Projects (one pre-existing by code, one sent)').toBe(2);
    expect(await benchList('Project', [['company', '=', company], ['project_name', '=', p[0].name]], ['name'])).toHaveLength(1);
    const { count: projectRows } = await admin.from('projects').select('id', { count: 'exact', head: true }).eq('org_id', org.orgId);
    expect(projectRows).toBe(2);

    // -- Then: the project's billed figure is the ERP figure, once ------------------------------------------------------------
    const user = createClient(AUTH_URL, ANON_KEY);
    const { error: signInErr } = await user.auth.signInWithPassword({ email: org.adminEmail, password: 'Passw0rd!dev' });
    expect(signInErr).toBeNull();
    const { data: finances, error: finErr } = await user.rpc('get_project_finances', { p_project_id: p[0].id });
    expect(finErr).toBeNull();
    const rows = (finances as { invoices: Array<{ invoice_count: number; invoiced: string }> }).invoices;
    expect(rows.reduce((n, r) => n + r.invoice_count, 0), 'one invoice counts').toBe(1);
    expect(rows.reduce((n, r) => n + Number(r.invoiced), 0)).toBe(erpTotal);
  } finally {
    await dropOrg(admin, org);
  }
});
