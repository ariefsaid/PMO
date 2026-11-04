// @e2e-isolation: dedicated-row — owns a fresh tenant and uniquely stamped Odoo documents; PMO rows are removed in finally.
import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { bindCall, type OdooCall } from '../src/lib/adapterSeam/odoo/client';
import { discoverCapabilities, type CapabilitySnapshot } from '../src/lib/adapterSeam/odoo/discovery';
import { requireServiceRoleKey } from './helpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const BED_URL = process.env.ODOO_BED_URL ?? '';
const BED_DB = process.env.ODOO_BED_DB ?? '';
const BED_KEY = process.env.ODOO_BED_KEY ?? '';
const SERVICE_KEY = FUNCTIONS_URL && BED_URL ? (requireServiceRoleKey() ?? '') : '';
const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BED_URL && BED_DB && BED_KEY);
const directBedUrl = () => {
  const url = new URL(BED_URL);
  url.hostname = '127.0.0.1';
  return url.origin;
};

if ((FUNCTIONS_URL || BED_URL) && !READY) {
  throw new Error('AC-OPP-090: the served functions lane, local Odoo bed, and local Supabase test credentials must be available together.');
}
test.skip(!READY, 'AC-OPP-090 requires the served functions lane and the local Odoo bed.');
test.setTimeout(300_000);

const AMOUNT = 1_000_000;
const VAT = 110_000;
const WITHHELD = 20_000;
const NET = 1_090_000;
const PASSWORD = `${crypto.randomUUID()}-Aa1!`;

interface Tenant {
  orgId: string;
  adminId: string | null;
  authorId: string | null;
  payerId: string | null;
  projectId: string;
  vendorId: string;
  procurementId: string;
  itemName: string;
  emails: string[];
  secretRef: string | null;
}

interface OdooFixture {
  call: OdooCall;
  companyId: number;
  companyName: string;
  partnerId: number;
  productId: number;
  planId: number;
  planName: string;
  planWriteDate: string;
  costAccountId: number;
  costAccountName: string;
  costAccountWriteDate: string;
  vatId: number;
  vatName: string;
  withholdingId: number;
  withholdingName: string;
  journalId: number;
  journalName: string;
  companyWriteDate: string;
  productWriteDate: string;
  vatWriteDate: string;
  withholdingWriteDate: string;
  journalWriteDate: string;
  capabilities: CapabilitySnapshot;
}

const must = <T>(label: string, result: { data: T | null; error: { message: string } | null }): NonNullable<T> => {
  if (result.error || result.data == null) throw new Error(`${label}: ${result.error?.message ?? 'no result'}`);
  return result.data as NonNullable<T>;
};

const ensure = (label: string, result: { error: { message: string } | null }): void => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
};

const digits = (value: string) => value.replace(/\D/g, '');

async function readOdooFixture(stamp: string): Promise<OdooFixture> {
  const raw = bindCall({ baseUrl: directBedUrl(), apiKey: BED_KEY, database: BED_DB, fetchImpl: fetch });
  const companies = await raw<Array<{ id: number; name: string; currency_id: [number, string]; write_date: string }>>(
    'res.company', 'search_read', { domain: [], fields: ['id', 'name', 'currency_id', 'write_date'], order: 'id asc' },
  );
  let picked: { id: number; name: string; write_date: string; currency_id: [number, string]; vat: { id: number; name: string; write_date: string } } | null = null;

  for (const company of companies) {
    if (company.currency_id?.[1] !== 'IDR') continue;
    const scoped = (async <T>(model: string, method: string, body: Record<string, unknown> = {}) => raw<T>(model, method, {
      ...body,
      context: { allowed_company_ids: [company.id], ...((body.context as object) ?? {}) },
    })) as OdooCall;
    const [vat] = await scoped<Array<{ id: number; name: string; write_date: string }>>('account.tax', 'search_read', {
      domain: [['type_tax_use', '=', 'purchase'], ['amount', '=', 11], ['price_include', '=', false], ['company_id', '=', company.id]],
      fields: ['id', 'name', 'write_date'], limit: 1,
    });
    if (vat) { picked = { ...company, vat }; break; }
  }
  if (!picked) throw new Error('AC-OPP-090: the Odoo bed needs an IDR company with a non-inclusive purchase VAT of 11%.');

  const call = (async <T>(model: string, method: string, body: Record<string, unknown> = {}) => raw<T>(model, method, {
    ...body,
    context: { allowed_company_ids: [picked!.id], ...((body.context as object) ?? {}) },
  })) as OdooCall;
  const make = async (model: string, vals: Record<string, unknown>): Promise<number> =>
    (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];

  const [liability] = await call<Array<{ id: number }>>('account.account', 'search_read', {
    domain: [['account_type', '=', 'liability_current'], ['company_ids', 'in', [picked.id]]], fields: ['id'], limit: 1,
  });
  if (!liability) throw new Error('AC-OPP-090: the Odoo company needs a current liability account for the withholding tax.');

  const stampWriteDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const withholdingName = `${stamp} synthetic withholding`;
  const withholdingId = await make('account.tax', {
    name: withholdingName, company_id: picked.id, type_tax_use: 'purchase', amount_type: 'percent', amount: -2,
  });
  const [withholding] = await call<Array<{ invoice_repartition_line_ids: number[]; write_date: string }>>('account.tax', 'read', {
    ids: [withholdingId], fields: ['invoice_repartition_line_ids', 'write_date'],
  });
  const repartition = await call<Array<{ id: number; repartition_type: string }>>('account.tax.repartition.line', 'read', {
    ids: withholding.invoice_repartition_line_ids, fields: ['id', 'repartition_type'],
  });
  const taxLines = repartition.filter((line) => line.repartition_type === 'tax').map((line) => line.id);
  if (taxLines.length === 0) throw new Error('AC-OPP-090: the synthetic withholding tax has no tax repartition line.');
  await call('account.tax.repartition.line', 'write', { ids: taxLines, vals: { account_id: liability.id } });

  const journals = await call<Array<{ id: number; name: string; type: string; outbound_payment_method_line_ids: number[]; write_date: string }>>(
    'account.journal', 'search_read', {
      domain: [['type', 'in', ['bank', 'cash']], ['company_id', '=', picked.id]],
      fields: ['id', 'name', 'type', 'outbound_payment_method_line_ids', 'write_date'], limit: 30,
    },
  );
  const journal = journals.find((row) => row.outbound_payment_method_line_ids.length > 0);
  if (!journal) throw new Error('AC-OPP-090: the Odoo company needs a bank or cash journal with an outbound payment method.');

  const partnerId = await make('res.partner', { name: `${stamp} synthetic supplier`, supplier_rank: 1 });
  const productId = await make('product.product', {
    name: `${stamp} synthetic stock item`, purchase_ok: true, is_storable: true, standard_price: 1,
  });
  const [plan] = await call<Array<{ id: number; name: string; write_date: string }>>('account.analytic.plan', 'search_read', {
    domain: [], fields: ['id', 'name', 'write_date'], limit: 1,
  });
  if (!plan) throw new Error('AC-OPP-090: the Odoo bed needs an analytic plan for the project cost account.');
  const costAccountName = `${stamp} synthetic project cost account`;
  const costAccountId = await make('account.analytic.account', { name: costAccountName, code: stamp, plan_id: plan.id });
  const [costAccount] = await call<Array<{ write_date: string }>>('account.analytic.account', 'read', {
    ids: [costAccountId], fields: ['write_date'],
  });
  const [product] = await call<Array<{ write_date: string }>>('product.product', 'read', { ids: [productId], fields: ['write_date'] });

  const [vat] = await call<Array<{ id: number; name: string; amount: number; type_tax_use: string; price_include: boolean; write_date: string }>>(
    'account.tax', 'read', { ids: [picked.vat.id], fields: ['id', 'name', 'amount', 'type_tax_use', 'price_include', 'write_date'] },
  );
  if (!vat || vat.amount !== 11 || vat.type_tax_use !== 'purchase' || vat.price_include) {
    throw new Error('AC-OPP-090: the selected purchase tax no longer matches the expected VAT.');
  }
  const [journalRead] = await call<Array<{ write_date: string }>>('account.journal', 'read', { ids: [journal.id], fields: ['write_date'] });
  const capabilities = await discoverCapabilities(call, { versionMajor: 20, now: new Date() });
  const companyFresh = await call<Array<{ id: number; name: string; write_date: string }>>('res.company', 'read', {
    ids: [picked.id], fields: ['id', 'name', 'write_date'],
  });

  return {
    call, companyId: picked.id, companyName: companyFresh[0].name, partnerId, productId,
    planId: plan.id, planName: plan.name, planWriteDate: plan.write_date,
    costAccountId, costAccountName, costAccountWriteDate: costAccount.write_date,
    vatId: vat.id, vatName: vat.name, withholdingId, withholdingName, journalId: journal.id, journalName: journal.name,
    companyWriteDate: companyFresh[0].write_date, productWriteDate: product.write_date,
    vatWriteDate: vat.write_date, withholdingWriteDate: withholding.write_date ?? stampWriteDate,
    journalWriteDate: journalRead.write_date, capabilities,
  };
}

async function makeTenant(admin: SupabaseClient, fixture: OdooFixture, suffix: string): Promise<Tenant> {
  const orgId = crypto.randomUUID();
  const emails = ['admin', 'bill-author', 'payer'].map((role) => `p9-${suffix}-${role}@example.test`);
  const tenant: Tenant = {
    orgId, adminId: null, authorId: null, payerId: null, projectId: crypto.randomUUID(),
    vendorId: crypto.randomUUID(), procurementId: crypto.randomUUID(),
    itemName: `${suffix} stock item`, emails, secretRef: null,
  };

  try {
  must('create organization', await admin.from('organizations').insert({
    id: orgId, name: `AC-OPP-090 synthetic ${suffix}`, default_currency: 'IDR', default_locale: 'en',
    default_number_locale: 'en-US', default_timezone: 'UTC', lifecycle_state: 'test',
  }).select('id').single());

  const users = [] as Array<{ id: string; email: string }>;
  for (let i = 0; i < emails.length; i += 1) {
    const created = await admin.auth.admin.createUser({ email: emails[i], password: PASSWORD, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`create synthetic ${i === 0 ? 'admin' : 'finance'} user: ${created.error?.message ?? 'no user'}`);
    users.push({ id: created.data.user.id, email: emails[i] });
    if (i === 0) tenant.adminId = created.data.user.id;
    if (i === 1) tenant.authorId = created.data.user.id;
    if (i === 2) tenant.payerId = created.data.user.id;
  }
  for (let i = 0; i < users.length; i += 1) {
    const role = i === 0 ? 'Admin' : 'Finance';
    must(`create ${role} profile`, await admin.from('profiles').upsert({
      id: users[i].id, org_id: orgId, email: users[i].email,
      full_name: `AC-OPP-090 synthetic ${role}`, role, status: 'active', locale: 'en', timezone: 'UTC',
    }, { onConflict: 'id' }).select('id').single());
  }

  must('create synthetic supplier', await admin.from('companies').insert({
    id: tenant.vendorId, org_id: orgId, name: `AC-OPP-090 supplier ${suffix}`, type: 'Vendor',
  }).select('id').single());
  must('create synthetic project', await admin.from('projects').insert({
    id: tenant.projectId, org_id: orgId, code: `P9-${suffix}`, name: `AC-OPP-090 project ${suffix}`,
  }).select('id').single());
  must('map synthetic supplier', await admin.from('external_refs').insert({
    org_id: orgId, domain: 'companies', pmo_record_id: tenant.vendorId, external_tier: 'odoo',
    external_record_id: `Vendor:${fixture.partnerId}`,
  }).select('id').single());
  must('create approved procurement', await admin.from('procurements').insert({
    id: tenant.procurementId, org_id: orgId, code: `P9-${suffix}`, title: `AC-OPP-090 ${suffix}`,
    project_id: tenant.projectId,
    requested_by_id: tenant.authorId, approved_by_id: tenant.adminId, approved_total_value: AMOUNT + VAT,
    total_value: AMOUNT, vendor_id: tenant.vendorId, currency: 'IDR', status: 'Approved',
  }).select('id').single());
  must('create purchase line', await admin.from('procurement_items').insert({
    org_id: orgId, procurement_id: tenant.procurementId, name: tenant.itemName,
    description: 'Synthetic stock item for purchase-to-payment acceptance.', quantity: 1, rate: AMOUNT,
  }).select('id').single());

  const secretRef = `pmo-opp-p9-${orgId}`;
  must('stage Odoo credential', await admin.rpc('stage_vault_secret_for_org', {
    p_org_id: orgId, p_external_tier: 'odoo', p_secret_value: BED_KEY, p_secret_name: secretRef, p_actor_id: tenant.adminId,
  }));
  tenant.secretRef = secretRef;
  must('finalize Odoo connection', await admin.rpc('finalize_odoo_connect', {
    p_org_id: orgId, p_secret_ref: secretRef, p_site_url: new URL(BED_URL).origin, p_database: BED_DB,
    p_key_expires_on: new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10),
    p_discard: false, p_kill_switch_enabled: true, p_actor_id: tenant.adminId,
  }));
  must('activate Odoo connection', await admin.rpc('activate_odoo_binding', {
    p_org_id: orgId, p_version_major: 20, p_company_id: fixture.companyId, p_company_name: fixture.companyName,
    p_config_patch: { capabilities: fixture.capabilities, item_map: { [tenant.itemName]: String(fixture.productId) } }, p_actor_id: tenant.adminId,
  }));

  const now = new Date().toISOString();
  const masters = [
    { kind: 'company', external_id: String(fixture.companyId), name: fixture.companyName, attrs: {}, source_write_date: fixture.companyWriteDate },
    { kind: 'analytic_plan', external_id: String(fixture.planId), name: fixture.planName, attrs: {}, source_write_date: fixture.planWriteDate },
    { kind: 'analytic_account', external_id: String(fixture.costAccountId), name: fixture.costAccountName,
      attrs: {}, parent_external_id: String(fixture.planId), source_write_date: fixture.costAccountWriteDate },
    { kind: 'product', external_id: String(fixture.productId), name: tenant.itemName, attrs: { purchasable: true, storable: true }, source_write_date: fixture.productWriteDate },
    { kind: 'tax', external_id: String(fixture.vatId), name: fixture.vatName, attrs: { amount: 11, use: 'purchase', purchasable: true }, source_write_date: fixture.vatWriteDate },
    { kind: 'tax', external_id: String(fixture.withholdingId), name: fixture.withholdingName, attrs: { amount: -2, use: 'purchase', purchasable: true }, source_write_date: fixture.withholdingWriteDate },
    { kind: 'journal', external_id: String(fixture.journalId), name: fixture.journalName, attrs: { type: 'bank' }, source_write_date: fixture.journalWriteDate },
  ].map((row) => ({
    org_id: orgId, external_tier: 'odoo', code: null, parent_external_id: null, active: true,
    tombstoned_at: null, as_of: now, ...row,
  }));
  must('seed Odoo directory rows', await admin.from('external_master_records').upsert(masters as never, {
    onConflict: 'org_id,external_tier,kind,external_id',
  }).select('id'));
  ensure('set default payment journal', await admin.rpc('set_odoo_payment_journal_default', {
    p_org_id: orgId, p_actor_id: tenant.adminId, p_journal_id: String(fixture.journalId),
  }));
  ensure('set Odoo analytic plan', await admin.rpc('set_odoo_analytic_plan', {
    p_org_id: orgId, p_actor_id: tenant.adminId, p_plan_id: String(fixture.planId),
  }));
  must('link project cost account', await admin.rpc('link_odoo_cost_account', {
    p_org_id: orgId, p_actor_id: tenant.adminId, p_project_id: tenant.projectId, p_account_id: String(fixture.costAccountId),
  }));
  ensure('employ Odoo for procurement', await admin.rpc('admin_change_domain_ownership', {
    p_org_id: orgId, p_external_tier: 'odoo', p_domain: 'procurement', p_action: 'employ', p_actor_id: tenant.adminId,
  }));
  return tenant;
  } catch (error) {
    await cleanupTenant(admin, tenant);
    throw error;
  }
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openCapture(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Record another document' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: label, exact: true }).click();
}

async function confirm(page: Page, label: string): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
}

async function cleanupTenant(admin: SupabaseClient, tenant: Tenant | null): Promise<void> {
  if (!tenant) return;
  const failures: string[] = [];
  for (const table of [
    'external_domain_ownership', 'external_sync_watermarks', 'external_master_records', 'external_command_outbox',
    'external_ref_lineage', 'external_refs', 'external_project_bindings',
  ]) {
    const { error } = await admin.from(table).delete().eq('org_id', tenant.orgId);
    if (error) failures.push(`delete ${table}: ${error.message}`);
  }
  if (tenant.secretRef && tenant.adminId) {
    const { error } = await admin.rpc('disconnect_external_integration', {
      p_org_id: tenant.orgId, p_external_tier: 'odoo', p_actor_id: tenant.adminId,
    });
    if (error) failures.push(`disconnect Odoo: ${error.message}`);
  }
  for (const table of ['external_org_bindings', 'procurements', 'projects', 'companies']) {
    const { error } = await admin.from(table).delete().eq('org_id', tenant.orgId);
    if (error) failures.push(`delete ${table}: ${error.message}`);
  }
  for (const id of [tenant.adminId, tenant.authorId, tenant.payerId].filter((value): value is string => !!value)) {
    const profile = await admin.from('profiles').delete().eq('id', id);
    if (profile.error) failures.push(`delete synthetic profile: ${profile.error.message}`);
    const authUser = await admin.auth.admin.deleteUser(id);
    if (authUser.error) failures.push(`delete synthetic auth user: ${authUser.error.message}`);
  }
  const organization = await admin.from('organizations').delete().eq('id', tenant.orgId);
  if (organization.error) failures.push(`delete synthetic organization: ${organization.error.message}`);
  if (failures.length) throw new Error(`AC-OPP-090 cleanup did not finish: ${failures.join('; ')}`);
}

test('AC-OPP-090: an approved purchase reaches Paid through Odoo with VAT, withholding, and same-intent recovery', async ({ page, browser }) => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const stamp = `AC-OPP-090-${suffix}`;
  const fixture = await readOdooFixture(stamp);
  let tenant: Tenant | null = null;
  let payerPage: Page | null = null;

  try {
    const activeTenant = await makeTenant(admin, fixture, suffix);
    tenant = activeTenant;
    await signIn(page, activeTenant.emails[1]);
    await page.goto(`/procurement/${activeTenant.procurementId}/files`);
    await expect(page.getByRole('heading', { name: `AC-OPP-090 ${suffix}` })).toBeVisible();

    // The Finance user records the approved order and the receipt from the case's document menu.
    await openCapture(page, 'Purchase order');
    const poForm = page.getByTestId('form-capture-purchase_order');
    await expect(poForm).toBeVisible();
    await poForm.getByTestId('purchase_order-ref-input').fill(`${stamp}-PO`);
    await poForm.getByTestId('purchase_order-amount-input').fill(String(AMOUNT));
    await poForm.getByTestId('purchase_order-save-btn').click();
    await expect.poll(async () => {
      const { data } = await admin.from('procurements').select('status').eq('id', activeTenant.procurementId).single();
      return data?.status;
    }, { timeout: 30_000 }).toBe('Ordered');
    const purchaseOrders = must('read captured purchase order', await admin.from('purchase_orders').select('id,po_number,status').eq('procurement_id', activeTenant.procurementId));
    expect(purchaseOrders).toHaveLength(1);
    const orderReference = must<{ external_record_id: string }>('read Odoo purchase order reference', await admin.from('external_refs').select('external_record_id')
      .eq('org_id', activeTenant.orgId).eq('domain', 'procurement').eq('pmo_record_id', purchaseOrders[0].id).single()).external_record_id;
    const orderId = Number(/^purchase\.order:(\d+)$/.exec(orderReference)?.[1]);
    expect(Number.isInteger(orderId) && orderId > 0).toBe(true);
    const [order] = await fixture.call<Array<{ state: string; amount_total: number }>>('purchase.order', 'read', {
      ids: [orderId], fields: ['state', 'amount_total'],
    });
    expect(order).toMatchObject({ state: 'purchase', amount_total: AMOUNT });
    const orderLines = await fixture.call<Array<{ analytic_distribution: Record<string, number> | false }>>('purchase.order.line', 'search_read', {
      domain: [['order_id', '=', orderId]], fields: ['analytic_distribution'],
    });
    expect(orderLines).toHaveLength(1);
    expect(orderLines[0].analytic_distribution).toEqual({ [String(fixture.costAccountId)]: 100 });

    await openCapture(page, 'Receipt');
    const receiptForm = page.getByTestId('form-create-gr');
    await expect(receiptForm).toBeVisible();
    await receiptForm.getByTestId('btn-save-gr').click();
    await confirm(page, 'Save GR');
    await expect.poll(async () => {
      const { data } = await admin.from('procurements').select('status').eq('id', activeTenant.procurementId).single();
      return data?.status;
    }, { timeout: 30_000 }).toBe('Received');
    const receipts = must('read captured receipt', await admin.from('procurement_receipts').select('id,status').eq('procurement_id', activeTenant.procurementId));
    expect(receipts).toHaveLength(1);
    const receiptReference = must<{ external_record_id: string }>('read Odoo receipt reference', await admin.from('external_refs').select('external_record_id')
      .eq('org_id', activeTenant.orgId).eq('domain', 'procurement').eq('pmo_record_id', receipts[0].id).single()).external_record_id;
    const receiptId = Number(/^stock\.picking:(\d+)$/.exec(receiptReference)?.[1]);
    expect(Number.isInteger(receiptId) && receiptId > 0).toBe(true);
    const [receipt] = await fixture.call<Array<{ state: string }>>('stock.picking', 'read', { ids: [receiptId], fields: ['state'] });
    expect(receipt.state).toBe('done');

    await openCapture(page, 'Supplier invoice');
    const billForm = page.getByTestId('form-create-vi');
    await expect(billForm).toBeVisible();
    await billForm.getByTestId('vi-ref-input').fill(`${stamp}-BILL`);
    await expect(billForm.getByRole('checkbox', { name: fixture.vatName })).toBeEnabled();
    await billForm.getByRole('checkbox', { name: fixture.vatName }).check();
    await billForm.getByRole('checkbox', { name: fixture.withholdingName }).check();
    await expect(billForm.getByTestId('vi-amount-input')).toHaveCount(0);

    const billCommands: Array<Record<string, unknown>> = [];
    let cutResponseStatus: number | null = null;
    let cutFirstBillResponse = true;
    const billRoute = async (route: import('@playwright/test').Route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.url().endsWith('/functions/v1/adapter-dispatch')) {
        const body = request.postDataJSON() as { record?: { erp_doc_kind?: unknown } };
        if (body.record?.erp_doc_kind === 'purchase-invoice') {
          billCommands.push(body as Record<string, unknown>);
          if (cutFirstBillResponse) {
            cutFirstBillResponse = false;
            const response = await route.fetch();
            cutResponseStatus = response.status();
            await route.abort('failed');
            return;
          }
        }
      }
      await route.continue();
    };
    await page.route('**/functions/v1/adapter-dispatch', billRoute);
    await billForm.getByTestId('btn-save-vi').click();
    await confirm(page, 'Save supplier invoice');
    await expect.poll(() => cutResponseStatus, { timeout: 30_000 }).toBe(200);
    await expect(billForm).toBeVisible();
    await expect.poll(() => billCommands.length).toBe(1);
    await expect(billForm.getByTestId('btn-save-vi')).toBeEnabled();

    // Odoo committed the bill before the response was cut; the user retries the same capture intent.
    await billForm.getByTestId('btn-save-vi').click();
    await confirm(page, 'Save supplier invoice');
    await expect.poll(() => billCommands.length).toBe(2);
    await page.unroute('**/functions/v1/adapter-dispatch', billRoute);
    expect(billCommands[0].idempotencyKey).toEqual(billCommands[1].idempotencyKey);
    await expect.poll(async () => {
      const { data } = await admin.from('procurements').select('status').eq('id', activeTenant.procurementId).single();
      return data?.status;
    }, { timeout: 30_000 }).toBe('Vendor Invoiced');

    const invoices = must('read captured bill', await admin.from('procurement_invoices')
      .select('id,amount,tax_amount,withheld_amount,erp_outstanding_amount,status')
      .eq('procurement_id', activeTenant.procurementId));
    expect(invoices).toHaveLength(1);
    const invoice = invoices[0];
    expect(Number(invoice.amount)).toBe(AMOUNT + VAT);
    expect(Number(invoice.tax_amount)).toBe(VAT);
    expect(Number(invoice.withheld_amount)).toBe(WITHHELD);
    expect(Number(invoice.erp_outstanding_amount)).toBe(NET);
    const billOutbox = must('read bill outbox', await admin.from('external_command_outbox')
      .select('actor_user_id,idempotency_key,state').eq('org_id', activeTenant.orgId).eq('domain', 'procurement')
      .eq('pmo_record_id', invoice.id));
    expect(billOutbox).toHaveLength(1);
    expect(billOutbox[0]).toMatchObject({ actor_user_id: activeTenant.authorId, state: 'confirmed' });
    expect(billOutbox[0].idempotency_key).toBe(billCommands[0].idempotencyKey);
    const billReference = must<{ external_record_id: string }>('read Odoo bill reference', await admin.from('external_refs').select('external_record_id')
      .eq('org_id', activeTenant.orgId).eq('domain', 'procurement').eq('pmo_record_id', invoice.id).single()).external_record_id;
    const billId = Number(/^account\.move:(\d+)$/.exec(billReference)?.[1]);
    expect(Number.isInteger(billId) && billId > 0).toBe(true);
    const [bill] = await fixture.call<Array<{ state: string; move_type: string; amount_untaxed: number; amount_tax: number; amount_total: number; amount_residual: number }>>(
      'account.move', 'read', { ids: [billId], fields: ['state', 'move_type', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual'] },
    );
    expect(bill).toMatchObject({ state: 'posted', move_type: 'in_invoice', amount_untaxed: AMOUNT, amount_tax: VAT - WITHHELD, amount_total: NET, amount_residual: NET });
    const billLines = await fixture.call<Array<{ analytic_distribution: Record<string, number> | false }>>('account.move.line', 'search_read', {
      domain: [['move_id', '=', billId], ['display_type', '=', 'product']], fields: ['analytic_distribution'],
    });
    expect(billLines).toHaveLength(1);
    expect(billLines[0].analytic_distribution).toEqual({ [String(fixture.costAccountId)]: 100 });

    const vatShown = page.getByTestId('vi-withholding-vat');
    const withheldShown = page.getByTestId('vi-withholding-withheld');
    const netShown = page.getByTestId('vi-withholding-net');
    await expect(vatShown).toBeVisible();
    await expect(withheldShown).toBeVisible();
    await expect(netShown).toBeVisible();
    expect(digits(await vatShown.innerText())).toBe(String(VAT));
    expect(digits(await withheldShown.innerText())).toBe(String(WITHHELD));
    expect(digits(await netShown.innerText())).toBe(String(NET));

    // A second Finance member signs in and pays the bill; the bill author cannot pay it.
    payerPage = await browser.newPage();
    await signIn(payerPage, activeTenant.emails[2]);
    await payerPage.goto(`/procurement/${activeTenant.procurementId}/files`);
    await expect(payerPage.getByRole('heading', { name: `AC-OPP-090 ${suffix}` })).toBeVisible();
    await openCapture(payerPage, 'Payment');
    const paymentForm = payerPage.getByTestId('form-capture-payment');
    await expect(paymentForm).toBeVisible();
    await paymentForm.getByTestId('payment-invoice-select').selectOption(invoice.id);
    await expect.poll(async () => digits(await paymentForm.getByTestId('payment-amount-input').inputValue())).toBe(String(NET));
    await paymentForm.getByLabel('Pay from').selectOption(String(fixture.journalId));
    await paymentForm.getByTestId('payment-save-btn').click();

    await expect.poll(async () => {
      const { data } = await admin.from('procurements').select('status').eq('id', activeTenant.procurementId).single();
      return data?.status;
    }, { timeout: 30_000 }).toBe('Paid');
    const payments = must('read captured payment', await admin.from('payments').select('id,status,amount,invoice_id').eq('procurement_id', activeTenant.procurementId));
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: 'Paid', invoice_id: invoice.id });
    expect(Number(payments[0].amount)).toBe(NET);
    const [paymentOutbox] = must('read payment outbox', await admin.from('external_command_outbox')
      .select('actor_user_id,state').eq('org_id', activeTenant.orgId).eq('domain', 'procurement').eq('pmo_record_id', payments[0].id));
    expect(paymentOutbox).toMatchObject({ actor_user_id: activeTenant.payerId, state: 'confirmed' });
    const paidBill = await fixture.call<Array<{ amount_residual: number }>>('account.move', 'read', { ids: [billId], fields: ['amount_residual'] });
    expect(paidBill[0].amount_residual).toBe(0);

    await expect(payerPage.getByText('Paid', { exact: true }).first()).toBeVisible();
    await expect(payerPage.getByTestId('vi-withholding-vat')).toContainText(/110[,.]000/);
    await expect(payerPage.getByTestId('vi-withholding-withheld')).toContainText(/20[,.]000/);
    await expect(payerPage.getByTestId('vi-withholding-net')).toContainText(/1[,.]090[,.]000/);
    await expect(payerPage.getByTestId('procurement-tabpanel-files')).toBeVisible();
  } finally {
    if (payerPage) await payerPage.close().catch(() => undefined);
    await cleanupTenant(admin, tenant);
  }
});
