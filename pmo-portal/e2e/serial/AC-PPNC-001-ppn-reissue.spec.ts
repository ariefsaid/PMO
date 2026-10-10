// @e2e-isolation: serial — creates ERP money documents and mutates the shared organization ERP binding.
/** AC-PPNC-001: Finance cancels in PMO, raises a fresh work-order invoice, and a non-author submits it. */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { dispatchCreateRevenue, dispatchTransitionRevenue, SAR_CURRENCY, seedSAR, signInAdmin, signInApprover } from './_sarHelpers';
import { pickComboboxOption, signIn, waitForFonts } from '../helpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) throw new Error('AC-PPNC-001: served lane is configured incompletely; required dependencies are unavailable.');
test.skip(!READY, 'AC-PPNC-001: needs the served functions lane and ERPNext bench; run with the local served bench.');
test.setTimeout(300_000);
test.use({ actionTimeout: 30_000 });

const authHeaders = { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' };
type Tax = { charge_type: string; account_head: string; rate: number; tax_amount: number; tax_amount_after_discount_amount: number; total: number; included_in_print_rate: number };
type ErpInvoice = { name: string; docstatus: number; net_total: number; grand_total: number; total_taxes_and_charges: number; outstanding_amount: number; currency: string; amended_from: string | null; taxes: Tax[]; items: Array<{ net_amount: number }> };
async function bench(path: string, method = 'GET', body?: unknown) {
  return fetch(`${BENCH_URL}/api/${path}`, { method, headers: authHeaders, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function readErpInvoice(name: string): Promise<ErpInvoice> {
  const response = await bench(`resource/Sales%20Invoice/${encodeURIComponent(name)}`);
  expect(response.status, 'full ERP invoice read').toBe(200);
  return ((await response.json()) as { data: ErpInvoice }).data;
}
function taxFacts(doc: ErpInvoice) {
  return doc.taxes.map(({ charge_type, account_head, rate, tax_amount, tax_amount_after_discount_amount, total, included_in_print_rate }) =>
    ({ charge_type, account_head, rate, tax_amount, tax_amount_after_discount_amount, total, included_in_print_rate }));
}
function assertErp(doc: ErpInvoice, docstatus: number, net: number, tax: number, gross: number) {
  expect(doc).toMatchObject({ docstatus, net_total: net, total_taxes_and_charges: tax, grand_total: gross, currency: 'IDR' });
  expect(doc.items.reduce((sum, item) => sum + item.net_amount, 0)).toBe(net);
  expect(doc.taxes).toHaveLength(1);
  expect(doc.taxes[0]).toMatchObject({ charge_type: 'On Net Total', rate: 11, tax_amount: tax, tax_amount_after_discount_amount: tax, total: gross, included_in_print_rate: 0 });
  expect(doc.taxes[0].account_head).toBeTruthy();
}
async function sendWithRetry(create: (key: string) => Promise<Response>, key: string): Promise<Response> {
  let response = await create(key);
  for (let attempt = 0; response.status === 502 && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    response = await create(key);
  }
  return response;
}
const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'IDR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
async function openInvoices(page: Page, customerName: string) {
  await page.goto('/sales-invoices');
  await page.getByRole('searchbox', { name: 'Search sales invoices' }).fill(customerName);
}
async function invoiceAction(page: Page, invoiceName: string, action: 'Cancel' | 'Submit') {
  const row = page.getByRole('row').filter({ hasText: invoiceName });
  await row.getByRole('button', { name: 'Row actions', exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
  const dialog = page.getByRole(action === 'Cancel' ? 'alertdialog' : 'dialog');
  await dialog.getByRole('button', { name: `${action} invoice`, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

// Cleanup is deliberately strict, unlike legacy best-effort bench cleanup: no live ERP document may remain.
async function cleanupErpInvoice(name: string): Promise<'deleted' | 'cancelled-retained'> {
  const path = `resource/Sales%20Invoice/${encodeURIComponent(name)}`;
  let doc = await readErpInvoice(name);
  // Submitted invoices must be cancelled first. Re-read after each attempt so an uncertain REST
  // response cannot make cleanup assume success or leave a live ERP invoice behind.
  for (let attempt = 0; doc.docstatus === 1 && attempt < 2; attempt++) {
    await bench(path, 'PUT', { docstatus: 2 });
    doc = await readErpInvoice(name);
  }
  if (doc.docstatus === 0) {
    const deletedDraft = await bench(path, 'DELETE');
    if (deletedDraft.ok) {
      expect((await bench(path)).status, 'ERP draft deletion readback').toBe(404);
      return 'deleted';
    }
    throw new Error('ERP cleanup could not remove a created draft invoice');
  }
  expect(doc.docstatus, 'ERP cleanup confirmed cancellation before deletion').toBe(2);
  const deleted = await bench(path, 'DELETE');
  if (deleted.ok) {
    expect((await bench(path)).status, 'ERP cleanup deletion readback').toBe(404);
    return 'deleted';
  }
  // A bench that forbids deletion may retain CANCELLED history, never a live ERP invoice.
  expect([403, 417], 'only explicit bench deletion refusals permit cancelled history').toContain(deleted.status);
  expect((await readErpInvoice(name)).docstatus).toBe(2);
  return 'cancelled-retained';
}

test('AC-PPNC-001 Finance cancels and re-issues with fresh PPN and independent approval', async ({ page, browser }) => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  // seedSAR references this fixed synthetic ERP Customer and may best-effort create it. Require the
  // shared fixture to exist first, so this journey never leaves an untracked bench Customer behind.
  const customerQuery = new URLSearchParams({ filters: JSON.stringify([['customer_name', '=', 'Spike Customer']]), fields: JSON.stringify(['name']), limit_page_length: '2' });
  const customerFixture = await bench(`resource/Customer?${customerQuery}`);
  expect(customerFixture.status, 'pre-existing synthetic ERP customer fixture').toBe(200);
  const customerRows = (await customerFixture.json()) as { data: Array<{ name: string }> };
  expect(customerRows.data.some((row) => row.name === 'Spike Customer'), 'the test must not create a shared ERP customer').toBe(true);
  const financeToken = await signInApprover(AUTH_URL, ANON_KEY); // Finance A authors; Admin B independently approves.
  const approverToken = await signInAdmin(AUTH_URL, ANON_KEY);
  const snapshot = async (table: string, column?: string, value?: string) => {
    let query = admin.from(table).select('*').eq('org_id', ORG_ID);
    if (column) query = query.eq(column, value);
    const result = await query;
    expect(result.error).toBeNull();
    return result.data!;
  };
  const oldBindings = await snapshot('external_org_bindings', 'external_tier', 'erpnext');
  const oldOwnership = await snapshot('external_domain_ownership', 'domain', 'revenue');
  const oldCustomerRefs = await snapshot('external_refs', 'external_record_id', 'Customer:Spike Customer');
  const suffix = `ppnc001-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const seeded = await seedSAR(admin, suffix);
  const workOrderId = crypto.randomUUID();
  const originalId = seeded.siRecordId;
  const ids = new Set([originalId]);
  const names = new Set<string>();
  const createKeys = new Set<string>();
  let createdTaxTemplate: string | undefined;
  const originalCreateKey = crypto.randomUUID();
  createKeys.add(originalCreateKey);
  // Track the UI-created identity BEFORE the request completes, including uncertain results, for cleanup.
  page.on('request', (request) => {
    if (!request.url().endsWith('/functions/v1/adapter-dispatch') || request.method() !== 'POST') return;
    const body = request.postDataJSON();
    if (body.domain === 'revenue' && body.operation === 'create') {
      ids.add(body.record.id);
      createKeys.add(body.idempotencyKey);
    }
  });
  const approverContext = await browser.newContext({ baseURL: 'http://localhost:3000', locale: 'en-US', timezoneId: 'UTC' });
  const approverPage = await approverContext.newPage();
  const record = { id: originalId, customerId: seeded.companyId, projectId: seeded.projectId, workOrderId, items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1_200_000 }] };
  const customerName = `Spike Customer ${suffix}`;
  const projectName = `SPIKE-PROJ-${suffix}`;
  const cleanupFailures: string[] = [];
  async function renderedStage(revenue: number, ar: number, invoiced: number, pending: number, remaining: number) {
    await page.goto('/revenue-by-project');
    await waitForFonts(page);
    await expect(page.getByRole('heading', { name: 'Revenue by Project', exact: true })).toBeVisible();
    await expect(page.getByText("Couldn't load revenue data", { exact: true })).toHaveCount(0);
    const revenueRow = page.getByRole('row').filter({ hasText: projectName });
    if (revenue === 0 && ar === 0) {
      // No submitted invoices means the project has no active revenue row, not a fabricated zero row.
      await expect(page.getByTestId('dt-table-branch').or(page.getByText('No revenue data yet', { exact: true }))).toBeVisible();
      await expect(revenueRow).toHaveCount(0);
    } else {
      await expect(revenueRow).toBeVisible();
      await expect(revenueRow.getByRole('cell').nth(2)).toHaveText(money(revenue));
      await expect(revenueRow.getByRole('cell').nth(3)).toHaveText(money(ar));
      await expect(revenueRow.getByRole('cell').nth(4)).toHaveText('1');
    }
    await page.goto(`/projects/${seeded.projectId}/work-orders`);
    await waitForFonts(page);
    const billing = page.getByTestId(`wo-billing-${workOrderId}`);
    await expect(billing).toContainText(`Still to invoice ${money(remaining)}`);
    await expect(billing).toContainText(`Invoiced ${money(invoiced)} · paid ${money(0)}`);
    if (pending) await expect(billing).toContainText(`Not yet submitted ${money(pending)}`);
    else await expect(billing).not.toContainText('Not yet submitted');
  }
  try {
    const versions = await bench('method/frappe.utils.change_log.get_versions');
    expect(versions.status).toBe(200);
    const versionBody = await versions.json();
    console.log('ERP versions', JSON.stringify(Object.fromEntries(Object.entries(versionBody.message as Record<string, { version: string }>).map(([app, value]) => [app, value.version]))));
    // Disposable bench setup per the rehearsal repair map; never edit taxes on an issued document.
    const taxTemplatesQuery = new URLSearchParams({ filters: JSON.stringify([['company', '=', 'PMO Smoke Co'], ['is_default', '=', 1], ['disabled', '=', 0]]), fields: JSON.stringify(['name']) });
    const templates = await bench(`resource/Sales%20Taxes%20and%20Charges%20Template?${taxTemplatesQuery}`);
    expect(templates.status).toBe(200);
    const defaults = (await templates.json()) as { data: Array<{ name: string }> };
    expect(defaults.data.length).toBeLessThanOrEqual(1);
    if (!defaults.data.length) {
      const template = await bench('resource/Sales%20Taxes%20and%20Charges%20Template', 'POST', {
        title: `PPNC ${suffix}`, company: 'PMO Smoke Co', is_default: 1,
        taxes: [{ charge_type: 'On Net Total', account_head: 'Progress Billing VAT - PSC', description: 'PPN 12%', rate: 12 }],
      });
      expect(template.status, 'local disposable sales-tax setup').toBe(200);
      createdTaxTemplate = ((await template.json()) as { data: { name: string } }).data.name;
    }
    const setup = await admin.from('projects').update({ client_id: seeded.companyId, currency: SAR_CURRENCY, subject_to_vat: true, tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12 }).eq('id', seeded.projectId);
    expect(setup.error).toBeNull();
    const wo = await admin.from('work_orders').insert({ id: workOrderId, org_id: ORG_ID, project_id: seeded.projectId, title: `PPN correction ${suffix}`, status: 'Issued', wo_number: `WO-${suffix}`, issued_at: new Date().toISOString(), order_value: 5_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12, currency: SAR_CURRENCY });
    expect(wo.error).toBeNull();

    // GIVEN: setup may use the served API; the correction below is exclusively the human UI journey.
    const first = await sendWithRetry((key) => dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, financeToken, record, 'sales-invoice', key), originalCreateKey);
    const firstBody = await first.json() as { externalRecordId?: string; code?: string; message?: string };
    if (firstBody.externalRecordId) names.add(firstBody.externalRecordId);
    expect(first.status, `original setup create: ${firstBody.code ?? ''} ${firstBody.message ?? ''}`).toBe(200);
    const originalName = firstBody.externalRecordId!;
    expect(originalName).toBeTruthy();
    const approveOriginal = await dispatchTransitionRevenue(FUNCTIONS_URL, ANON_KEY, approverToken, { ...record, externalRecordId: originalName }, 'sales-invoice', 'submit', crypto.randomUUID());
    expect(approveOriginal.status, 'original setup submit').toBe(200);
    const originalBefore = await readErpInvoice(originalName);
    assertErp(originalBefore, 1, 1_200_000, 132_000, 1_332_000);
    expect(originalBefore.outstanding_amount).toBe(1_332_000);
    await signIn(page, 'finance@acme.test');
    await signIn(approverPage, 'admin@acme.test');
    await openInvoices(page, customerName);
    const originalRow = page.getByRole('row').filter({ hasText: originalName });
    await expect(originalRow).toContainText('Unpaid');
    await expect(originalRow).toContainText(money(1_332_000));
    await renderedStage(1_200_000, 1_332_000, 1_200_000, 0, 3_800_000);
    console.log('S1 PASS: ERP 1; net 1200000; tax 132000; gross/AR 1332000; rendered Unpaid row; revenue/WO invoiced 1200000; remaining 3800000');

    // WHEN: A opens the project's invoices and cancels, then waits for confirmed cancellation.
    await openInvoices(page, customerName);
    await invoiceAction(page, originalName, 'Cancel');
    await expect(page.getByRole('row').filter({ hasText: originalName })).toContainText('Cancelled');
    await expect.poll(async () => {
      const result = await admin.from('external_command_outbox').select('state').eq('pmo_record_id', originalId).eq('operation', 'transition');
      expect(result.error).toBeNull();
      return result.data!.length >= 2 && result.data!.every((command) => command.state === 'confirmed');
    }, { timeout: 30_000 }).toBe(true);
    assertErp(await readErpInvoice(originalName), 2, 1_200_000, 132_000, 1_332_000);
    await renderedStage(0, 0, 0, 0, 5_000_000);

    // Normal new-invoice entry for a work order preserves customer/project/WO, rather than cloning history.
    // The generic Sales Invoices form has no WO selector; the plan's normal "Invoice this work order" form does.
    const itemParams = new URLSearchParams({
      fields: JSON.stringify(['name', 'item_name', 'disabled', 'is_sales_item', 'is_purchase_item']),
      filters: JSON.stringify([['disabled', '=', 0], ['is_sales_item', '=', 1]]),
      order_by: 'name asc', limit_start: '0', limit_page_length: '200',
    });
    const itemResponse = await bench(`resource/Item?${itemParams}`);
    expect(itemResponse.status, 'direct read-only ERP sales-item lookup').toBe(200);
    const itemRows = (await itemResponse.json()) as { data: Array<{ name: string; item_name?: string; disabled: number; is_sales_item: number }> };
    const items = itemRows.data.filter((item) => item.name && item.disabled === 0 && item.is_sales_item === 1)
      .map((item) => ({ code: item.name, name: item.item_name || item.name }));
    expect(items.some((item) => item.code === 'SPIKE-ITEM-1'), 'bench catalog contains the fixture sales item').toBe(true);
    // Local bench is not HTTPS-public; the external-items lookup guard is intentional, so stub only this read.
    await page.route('**/functions/v1/external-items', async (route) => {
      expect(route.request().method()).toBe('POST');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) });
    });
    const workOrderRow = page.getByRole('row').filter({ hasText: `WO-${suffix}` });
    await workOrderRow.getByRole('button', { name: 'Invoice', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Invoice this work order', exact: true });
    await pickComboboxOption(form, page, /ERP item/i, /SPIKE-ITEM-1/);
    await form.getByRole('textbox', { name: /Amount \(excl\. PPN\)/ }).fill('2400000');
    await form.getByRole('button', { name: 'Create draft invoice', exact: true }).click();
    await expect(form).toBeHidden({ timeout: 60_000 });
    const replacements = await admin.from('sales_invoices').select('id,si_number,status,erp_docstatus,work_order_id').eq('project_id', seeded.projectId).neq('id', originalId);
    expect(replacements.error).toBeNull();
    expect(replacements.data).toHaveLength(1);
    const replacement = replacements.data![0];
    ids.add(replacement.id);
    names.add(replacement.si_number!);
    expect(replacement.id).not.toBe(originalId);
    expect(replacement.si_number).not.toBe(originalName);
    expect(replacement).toMatchObject({ status: 'Draft', erp_docstatus: 0, work_order_id: workOrderId });
    expect(createKeys.size, 'separate original/new create intents').toBe(2);
    const draft = await readErpInvoice(replacement.si_number!);
    assertErp(draft, 0, 2_400_000, 264_000, 2_664_000);
    expect(draft.amended_from || null).toBeNull();
    expect(taxFacts(await readErpInvoice(originalName))).toEqual(taxFacts(originalBefore));
    await openInvoices(page, customerName);
    await expect(page.getByRole('row').filter({ hasText: originalName })).toContainText('Cancelled');
    await expect(page.getByRole('row').filter({ hasText: replacement.si_number! })).toContainText('Draft');
    await renderedStage(0, 0, 0, 2_400_000, 2_600_000);
    console.log('S2 PASS: original ERP 2 retains tax 132000/gross 1332000; distinct new ERP 0; net 2400000; fresh tax 264000; gross 2664000; rendered AR/revenue/invoiced 0; pending 2400000; remaining 2600000');

    // B, in a separate signed-in browser context, uses the normal independent Submit action.
    await openInvoices(approverPage, customerName);
    await invoiceAction(approverPage, replacement.si_number!, 'Submit');
    await expect(approverPage.getByRole('row').filter({ hasText: replacement.si_number! })).toContainText('Unpaid');
    const submitted = await readErpInvoice(replacement.si_number!);
    assertErp(submitted, 1, 2_400_000, 264_000, 2_664_000);
    expect(submitted.outstanding_amount).toBe(2_664_000);
    const originalAfter = await readErpInvoice(originalName);
    assertErp(originalAfter, 2, 1_200_000, 132_000, 1_332_000);
    expect(taxFacts(originalAfter)).toEqual(taxFacts(originalBefore));
    await openInvoices(page, customerName);
    const historicalRow = page.getByRole('row').filter({ hasText: originalName });
    const currentRow = page.getByRole('row').filter({ hasText: replacement.si_number! });
    await expect(historicalRow).toContainText('Cancelled');
    await expect(historicalRow).toContainText(money(1_332_000));
    await expect(currentRow).toContainText('Unpaid');
    await expect(currentRow).toContainText(money(2_664_000));
    await expect(page.getByRole('row').filter({ hasText: customerName })).toHaveCount(2);
    await renderedStage(2_400_000, 2_664_000, 2_400_000, 0, 2_600_000);
    console.log('S3 PASS: original ERP 2/new ERP 1; taxes [{charge_type:On Net Total,rate:11,tax_amount:264000,total:2664000,included_in_print_rate:0}]; separate Cancelled/Unpaid rows; rendered revenue 2400000; AR 2664000; count 1; WO invoiced 2400000/pending 0/remaining 2600000');
  } finally {
    const cleanupAttempt = async (label: string, operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch {
        cleanupFailures.push(label);
      }
    };
    // Recover names even if a UI response/mirror assertion failed. Exact create anchors never touch siblings.
    for (const key of createKeys) {
      await cleanupAttempt('ERP document discovery', async () => {
        const query = new URLSearchParams({ filters: JSON.stringify([['remarks', '=', key]]), fields: JSON.stringify(['name']), limit_page_length: '100' });
        const response = await bench(`resource/Sales%20Invoice?${query}`);
        expect(response.status, 'ERP cleanup anchor discovery').toBe(200);
        const found = (await response.json()) as { data: Array<{ name: string }> };
        expect(found.data.length).toBeLessThan(100);
        found.data.forEach((doc) => names.add(doc.name));
      });
    }
    await cleanupAttempt('PMO invoice discovery', async () => {
      const rows = await admin.from('sales_invoices').select('id,si_number').eq('project_id', seeded.projectId);
      expect(rows.error).toBeNull();
      rows.data!.forEach((row) => { ids.add(row.id); if (row.si_number) names.add(row.si_number); });
    });
    const outcomes: Array<'deleted' | 'cancelled-retained'> = [];
    for (const name of names) {
      await cleanupAttempt('ERP invoice cancellation/deletion', async () => outcomes.push(await cleanupErpInvoice(name)));
    }
    console.log(`ERP cleanup attempted: ${names.size} created documents; ${outcomes.filter((v) => v === 'deleted').length} deleted; ${outcomes.filter((v) => v === 'cancelled-retained').length} cancelled retained`);
    if (createdTaxTemplate) {
      await cleanupAttempt('disposable tax-template cleanup', async () => {
        const path = `resource/Sales%20Taxes%20and%20Charges%20Template/${encodeURIComponent(createdTaxTemplate!)}`;
        const deleted = await bench(path, 'DELETE');
        expect(deleted.status).toBe(202);
        expect((await bench(path)).status).toBe(404);
      });
      if (!cleanupFailures.includes('disposable tax-template cleanup')) console.log('ERP setup cleanup confirmed: disposable default tax template deleted');
    }
    const checked = async (label: string, result: PromiseLike<{ error: unknown }>) => {
      await cleanupAttempt(label, async () => expect((await result).error).toBeNull());
    };
    const invoiceIds = [...ids];
    await checked('outbox cleanup', admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', invoiceIds));
    await checked('lineage cleanup', admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', invoiceIds));
    await checked('revenue reference cleanup', admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', invoiceIds));
    await checked('invoice author cleanup', admin.from('sales_invoice_authors').delete().in('sales_invoice_id', invoiceIds));
    await checked('invoice mirror cleanup', admin.from('sales_invoices').delete().in('id', invoiceIds));
    await checked('work-order cleanup', admin.from('work_orders').delete().eq('id', workOrderId));
    await checked('company reference cleanup', admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', seeded.companyId));
    await checked('project cleanup', admin.from('projects').delete().eq('id', seeded.projectId));
    await checked('company cleanup', admin.from('companies').delete().eq('id', seeded.companyId));
    await checked('revenue ownership cleanup', admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'revenue'));
    await checked('ERP binding cleanup', admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext'));
    if (oldBindings.length) await checked('ERP binding restoration', admin.from('external_org_bindings').upsert(oldBindings));
    if (oldOwnership.length) await checked('revenue ownership restoration', admin.from('external_domain_ownership').upsert(oldOwnership));
    if (oldCustomerRefs.length) await checked('customer reference restoration', admin.from('external_refs').upsert(oldCustomerRefs));
    await cleanupAttempt('ERP binding snapshot verification', async () => expect(await snapshot('external_org_bindings', 'external_tier', 'erpnext')).toEqual(oldBindings));
    await cleanupAttempt('revenue ownership snapshot verification', async () => expect(await snapshot('external_domain_ownership', 'domain', 'revenue')).toEqual(oldOwnership));
    await cleanupAttempt('customer reference snapshot verification', async () => expect(await snapshot('external_refs', 'external_record_id', 'Customer:Spike Customer')).toEqual(oldCustomerRefs));
    await approverContext.close().catch(() => undefined);
    if (cleanupFailures.length) console.log(`ERP/fixture cleanup incomplete: ${cleanupFailures.length} action(s) require recovery`);
  }
  if (cleanupFailures.length) throw new Error('AC-PPNC-001 cleanup was incomplete; inspect sanitized cleanup outcomes before another run');
  console.log('ERP and PMO fixture cleanup confirmed; no live created ERP invoice remains');
});
