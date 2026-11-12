// @e2e-isolation: dedicated-row
// Uses only unique PMO rows and Odoo records; no shared fixture row or company setting is mutated.
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SEED_PASSWORD } from './helpers';
import { bindCall, createPacer, OdooError } from '../src/lib/adapterSeam/odoo/client';
import { externalIdentifier } from '../src/lib/adapterSeam/odoo/revenue/anchors';
import { paymentStatus } from '../src/lib/adapterSeam/odoo/revenue/status';
import { parseOdooExternalRef } from '../src/lib/adapterSeam/odoo/purchase/anchors';
import type { Database, Json } from '../src/lib/supabase/database.types';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BED_URL = process.env.ODOO_BED_URL ?? '';
const BED_DB = process.env.ODOO_BED_DB ?? '';
const BED_KEY = process.env.ODOO_BED_KEY ?? '';
const ODOO_DEPENDENCIES = [BED_URL, BED_DB, BED_KEY];
const ODOO_PARTIAL = ODOO_DEPENDENCIES.some(Boolean) && !ODOO_DEPENDENCIES.every(Boolean);
const SERVED_READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY);
const READY = SERVED_READY && ODOO_DEPENDENCIES.every(Boolean);

if (ODOO_PARTIAL) {
  throw new Error('AC-OCI-100 requires the Odoo bed and the served Supabase lane with its local test credentials.');
}
test.skip(!READY, 'AC-OCI-100 requires the Odoo bed and the served Supabase lane.');
test.setTimeout(240_000);

type CreatedUser = { id: string; email: string; password: string };
type AdminClient = SupabaseClient<Database>;
type BedCompany = { id: number; name: string; currency_id: [number, string] };
type OdooJournal = { id: number; name: string; type: string; inbound_payment_method_line_ids: number[] };
type OdooAccount = { id: number; name: string; code: string; account_type: string; company_ids: number[]; currency_id: false | [number, string] };

async function enableRevenueForTestOrg(orgId: string) {
  const operator = createClient<Database>(AUTH_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await operator.auth.signInWithPassword({ email: 'operator@pmo.test', password: SEED_PASSWORD });
  if (error || !data.session) throw new Error('AC-OCI-100 could not authenticate the local Operator fixture.');
  const { error: toggleError } = await operator.rpc('operator_toggle_feature', {
    p_org_id: orgId, p_key: 'revenue', p_enabled: true,
  });
  if (toggleError) throw new Error('AC-OCI-100 could not enable Revenue for its isolated test organization.');
}

const must = async <T>(result: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> => {
  const { data, error } = await result;
  if (error) throw new Error(`AC-OCI-100 fixture failed: ${error.message}`);
  return data;
};

const serviceRpc = (client: AdminClient, name: string, args: Record<string, unknown>) =>
  (client.rpc as unknown as (fn: string, values: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(name, args);

async function signIn(page: Page, user: CreatedUser) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

function localBedUrl(): string {
  const url = new URL(BED_URL);
  if (url.protocol === 'http:') url.hostname = '127.0.0.1';
  return url.toString().replace(/\/$/, '');
}

async function waitForOdooBed<T>(read: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof OdooError) || !['unreachable', 'timeout'].includes(error.errorClass) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  const search = page.getByRole('searchbox').last();
  await search.fill(option);
  await page.getByRole('option', { name: new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
}

async function provision(admin: AdminClient, stamp: string) {
  const orgId = crypto.randomUUID();
  const author: CreatedUser = { id: '', email: `oci100-author-${crypto.randomUUID()}@example.test`, password: `${crypto.randomUUID()}Aa1!` };
  const approver: CreatedUser = { id: '', email: `oci100-approver-${crypto.randomUUID()}@example.test`, password: `${crypto.randomUUID()}Aa1!` };
  const users: CreatedUser[] = [];
  let connected = false;
  const externalIds: Array<{ kind: string; id: string }> = [];
  let companyId = '';
  let projectId = '';
  const clientName = `${stamp} Client`;
  const raw = bindCall({ baseUrl: localBedUrl(), apiKey: BED_KEY, database: BED_DB, fetchImpl: fetch, pace: createPacer(5) });
  let odooCompany: BedCompany | undefined;
  let partnerId: number;
  let productId: number;
  let analyticPlanId: number;
  let analyticAccountId: number;
  let itemCode: string;
  let incomeAccount: OdooAccount | undefined;
  let prepaidAccount: OdooAccount | undefined;
  let journal: OdooJournal | undefined;
  const call = (async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
    const companyContext = odooCompany ? { allowed_company_ids: [odooCompany.id], company_id: odooCompany.id } : {};
    return raw<T>(model, method, { ...body, context: { ...companyContext, ...((body.context as object) ?? {}) } });
  });
  const addDirectoryRow = async (kind: string, id: number, name: string, attrs: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    externalIds.push({ kind, id: String(id) });
    await must(admin.from('external_master_records').insert({
      org_id: orgId, external_tier: 'odoo', kind, external_id: String(id), name, active: true,
      source_write_date: new Date().toISOString().slice(0, 19).replace('T', ' '), attrs: attrs as Json, ...extra,
    }).select());
  };

  try {
    const companies = await waitForOdooBed(() => call<BedCompany[]>('res.company', 'search_read', { domain: [], fields: ['id', 'name', 'currency_id'], limit: 20 }));
    odooCompany = companies.find((row) => Array.isArray(row.currency_id) && row.currency_id[1] === 'IDR') ?? companies[0];
    if (!odooCompany) throw new Error('AC-OCI-100 requires a company in the Odoo bed.');
    await must(admin.from('organizations').insert({
      id: orgId, name: `${stamp} organization`, default_currency: odooCompany.currency_id[1],
    }).select());
    for (const [user, role, name] of [[author, 'Finance', `${stamp} author`], [approver, 'Admin', `${stamp} approver`]] as const) {
      const created = await admin.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error('AC-OCI-100 could not provision its isolated actor.');
      user.id = created.data.user.id;
      users.push(user);
      await must(admin.from('profiles').insert({ id: user.id, org_id: orgId, full_name: name, email: user.email, role, status: 'active' }).select());
    }

    const [plan] = await call<Array<{ id: number; name: string }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id', 'name'], limit: 1 });
    if (!plan) throw new Error('AC-OCI-100 requires an analytic plan in the Odoo bed.');
    analyticPlanId = plan.id;
    const accounts = await call<OdooAccount[]>('account.account', 'search_read', {
      domain: [['company_ids', 'in', [odooCompany.id]]], fields: ['id', 'name', 'code', 'account_type', 'company_ids', 'currency_id'], limit: 500,
    });
    incomeAccount = accounts.find((row) => row.account_type === 'income');
    prepaidAccount = accounts.find((row) => ['asset_current', 'asset_prepayments'].includes(row.account_type)
      && (!row.currency_id || row.currency_id[0] === odooCompany!.currency_id[0]));
    if (!incomeAccount || !prepaidAccount) throw new Error('AC-OCI-100 requires an income and a same-currency tax-prepaid account.');
    const journals = await call<OdooJournal[]>('account.journal', 'search_read', {
      domain: [['company_id', '=', odooCompany.id], ['type', 'in', ['bank', 'cash']]],
      fields: ['id', 'name', 'type', 'inbound_payment_method_line_ids'], limit: 40,
    });
    journal = journals.find((row) => row.inbound_payment_method_line_ids.length > 0);
    if (!journal) throw new Error('AC-OCI-100 requires a bank or cash journal with an inbound payment method.');

    // The project is subject to VAT (so the e-Faktur step is reachable): the push needs the org's PPN output tax, mirrored and chosen.
    const [saleTax] = await call<Array<{ id: number; name: string; tax_group_id: [number, string] | false }>>('account.tax', 'search_read', {
      domain: [['type_tax_use', '=', 'sale'], ['amount', '=', 11], ['price_include', '=', false], ['company_id', '=', odooCompany.id]],
      fields: ['id', 'name', 'tax_group_id'], limit: 1,
    });
    if (!saleTax || !saleTax.tax_group_id) throw new Error('AC-OCI-100 requires an 11% sale tax with a tax group in the Odoo bed (load the Indonesian chart).');

    partnerId = (await call<number[]>('res.partner', 'create', { vals_list: [{ name: clientName, customer_rank: 1, is_company: true }] }))[0];
    itemCode = `OCI100-${crypto.randomUUID().slice(0, 8)}`;
    productId = (await call<number[]>('product.product', 'create', { vals_list: [{
      name: `${stamp} service`, default_code: itemCode, type: 'service', sale_ok: true,
      property_account_income_id: incomeAccount.id,
    }] }))[0];
    analyticAccountId = (await call<number[]>('account.analytic.account', 'create', { vals_list: [{
      name: `${stamp} project`, code: `OCI-${crypto.randomUUID().slice(0, 8)}`, plan_id: analyticPlanId,
    }] }))[0];
    if (!partnerId || !productId || !analyticAccountId) throw new Error('AC-OCI-100 could not create its Odoo test records.');

    const staged = await must(serviceRpc(admin, 'stage_vault_secret_for_org', {
      p_org_id: orgId, p_external_tier: 'odoo', p_secret_value: BED_KEY,
      p_secret_name: `${stamp}-${crypto.randomUUID()}`, p_actor_id: approver.id,
    })) as string;
    await must(serviceRpc(admin, 'finalize_odoo_connect', {
      p_org_id: orgId, p_secret_ref: staged, p_site_url: BED_URL, p_database: BED_DB,
      p_key_expires_on: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      p_discard: false, p_kill_switch_enabled: true, p_actor_id: approver.id,
    }));
    connected = true;
    const directoryModels = ['res.company', 'account.analytic.plan', 'account.analytic.account', 'account.account', 'account.tax', 'account.journal', 'uom.uom', 'product.product', 'stock.warehouse', 'stock.location', 'res.partner'];
    const models = Object.fromEntries(directoryModels.map((model) => [model, {
      exists: true, read: ['account.account', 'account.tax', 'account.journal'].includes(model),
      create: false, write: false, unlink: false, fields_missing: [],
    }]));
    await must(serviceRpc(admin, 'activate_odoo_binding', {
      p_org_id: orgId, p_version_major: 20, p_company_id: odooCompany.id, p_company_name: odooCompany.name,
      p_config_patch: { sale_tax_id: saleTax.id, capabilities: { observed_at: new Date().toISOString(), version_major: 20, untested_version: false, companies: [], missing: [], models, later: { 'account.move': true, 'account.move.line': true, 'account.payment': true } }, item_map: { [itemCode]: String(productId) } },
      p_actor_id: approver.id,
    }));

    await addDirectoryRow('company', odooCompany.id, odooCompany.name, { currency: odooCompany.currency_id[1] });
    await addDirectoryRow('partner', partnerId, clientName, { is_company: true, customer_rank: 1 });
    await addDirectoryRow('product', productId, `${stamp} service`, { income_account_id: String(incomeAccount.id), purchasable: false, sellable: true, storable: false }, { code: itemCode });
    await addDirectoryRow('analytic_plan', analyticPlanId, plan.name, {});
    await addDirectoryRow('analytic_account', analyticAccountId, `${stamp} project`, { company_id: String(odooCompany.id) }, { code: `OCI-${stamp}`, parent_external_id: String(analyticPlanId) });
    await addDirectoryRow('tax', saleTax.id, saleTax.name, { amount: 11, use: 'sale', tax_group: saleTax.tax_group_id[1], price_include: false });
    await addDirectoryRow('account', incomeAccount.id, incomeAccount.name, { account_type: incomeAccount.account_type, company_ids: [String(odooCompany.id)] }, { code: incomeAccount.code });
    await addDirectoryRow('account', prepaidAccount.id, prepaidAccount.name, { account_type: prepaidAccount.account_type, company_ids: [String(odooCompany.id)] }, { code: prepaidAccount.code });
    await addDirectoryRow('journal', journal.id, journal.name, { type: journal.type, company_id: String(odooCompany.id) });

    await must(serviceRpc(admin, 'set_odoo_analytic_plan', { p_org_id: orgId, p_actor_id: approver.id, p_plan_id: String(analyticPlanId) }));
    await must(serviceRpc(admin, 'set_odoo_payment_journal_default', { p_org_id: orgId, p_actor_id: approver.id, p_journal_id: String(journal.id) }));
    await must(serviceRpc(admin, 'set_odoo_tax_prepaid_account', { p_org_id: orgId, p_actor_id: approver.id, p_account_id: String(prepaidAccount.id) }));

    companyId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    await must(admin.from('companies').insert({ id: companyId, org_id: orgId, name: clientName, type: 'Client' }).select());
    await must(admin.from('projects').insert({
      id: projectId, org_id: orgId, name: `${stamp} project`, status: 'Ongoing Project', client_id: companyId,
      currency: odooCompany.currency_id[1], contract_value: 500000, subject_to_vat: true,
      tax_rate: 11, tax_treatment: 'exclusive', tax_amount: 55000,
    }).select());
    await must(admin.from('external_refs').insert({
      org_id: orgId, domain: 'companies', pmo_record_id: companyId, external_tier: 'odoo', external_record_id: `Client:${partnerId}`,
    }).select());
    await must(serviceRpc(admin, 'link_odoo_cost_account', { p_org_id: orgId, p_actor_id: approver.id, p_project_id: projectId, p_account_id: String(analyticAccountId) }));
    await must(serviceRpc(admin, 'admin_change_domain_ownership', {
      p_org_id: orgId, p_external_tier: 'odoo', p_domain: 'revenue', p_action: 'employ', p_actor_id: approver.id,
    }));
    return { orgId, author, approver, companyId, projectId, clientName, itemCode, partnerId, productId, analyticAccountId, externalIds, raw };
  } catch (error) {
    await cleanup(admin, { orgId, author, approver, users, connected, externalIds, companyId, projectId }).catch(() => {});
    throw error;
  }
}

async function cleanup(admin: AdminClient, fixture: {
  orgId: string; author: CreatedUser; approver: CreatedUser; users?: CreatedUser[]; connected: boolean;
  externalIds: Array<{ kind: string; id: string }>; companyId: string; projectId: string;
}) {
  if (fixture.connected && fixture.approver.id) {
    await serviceRpc(admin, 'disconnect_external_integration', { p_org_id: fixture.orgId, p_external_tier: 'odoo', p_actor_id: fixture.approver.id });
  }
  await admin.from('external_domain_ownership').delete().eq('org_id', fixture.orgId);
  await admin.from('external_project_bindings').delete().eq('org_id', fixture.orgId).eq('external_tier', 'odoo');
  await admin.from('external_command_outbox').delete().eq('org_id', fixture.orgId);
  await admin.from('external_refs').delete().eq('org_id', fixture.orgId);
  await admin.from('incoming_payments').delete().eq('org_id', fixture.orgId);
  await admin.from('sales_invoice_authors').delete().eq('org_id', fixture.orgId);
  await admin.from('sales_invoices').delete().eq('org_id', fixture.orgId);
  await admin.from('external_org_bindings').delete().eq('org_id', fixture.orgId);
  await admin.from('external_master_records').delete().eq('org_id', fixture.orgId);
  if (fixture.projectId) await admin.from('projects').delete().eq('org_id', fixture.orgId).eq('id', fixture.projectId);
  if (fixture.companyId) await admin.from('companies').delete().eq('org_id', fixture.orgId).eq('id', fixture.companyId);
  for (const user of fixture.users ?? [fixture.author, fixture.approver]) if (user.id) await admin.auth.admin.deleteUser(user.id);
  await admin.from('organizations').delete().eq('id', fixture.orgId);
}

test('AC-OCI-100: one user raises project invoices, another approves them, and receipts preserve cash and withholding in Odoo and PMO', async ({ page, browser }) => {
  const admin = createClient<Database>(AUTH_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const stamp = `OCI100-${Date.now()}`;
  const fixture = await provision(admin, stamp);
  let approverContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let approverPage: Page;
  const invoices: Array<{ id: string; si_number: string | null }> = [];
  try {
    await enableRevenueForTestOrg(fixture.orgId);
    await signIn(page, fixture.author);
    await page.goto('/finance/receivables?view=invoices');
    const createInvoice = async (index: number) => {
      await page.getByRole('button', { name: /new invoice/i }).click();
      await choose(page, 'Customer', fixture.clientName);
      await choose(page, 'Project', `${stamp} project`);
      await page.getByLabel('Description').fill(`${stamp} progress claim ${index + 1}`);
      await choose(page, 'ERP item', fixture.itemCode);
      await page.getByLabel('Qty').fill('1');
      await page.getByLabel('Rate').fill('100000');
      await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      const { data: draft } = await admin.from('sales_invoices').select('id,si_number').eq('org_id', fixture.orgId)
        .eq('customer_id', fixture.companyId).eq('project_id', fixture.projectId).eq('status', 'Draft').single();
      expect(draft).toBeTruthy();
      return draft as { id: string; si_number: string | null };
    };
    const approveInvoice = async (invoice: { id: string; si_number: string | null }) => {
      const row = approverPage.getByRole('row').filter({ hasText: fixture.clientName }).filter({ hasText: 'Draft' }).first();
      await row.getByRole('button', { name: /row actions/i }).click();
      await approverPage.getByRole('menuitem', { name: 'Submit', exact: true }).click();
      const submitConfirmation = approverPage.getByRole('dialog', { name: /^Submit .*\?$/ });
      await expect(submitConfirmation).toBeVisible();
      await submitConfirmation.getByRole('button', { name: 'Submit invoice', exact: true }).click();
      await expect(submitConfirmation).toBeHidden({ timeout: 60_000 });
      const { data } = await admin.from('sales_invoices').select('si_number,status,erp_docstatus,amount,erp_outstanding_amount,project_id')
        .eq('org_id', fixture.orgId).eq('id', invoice.id).single();
      // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
      expect(data).toMatchObject({ status: 'Unpaid', erp_docstatus: 1, amount: 111000, erp_outstanding_amount: 111000, project_id: fixture.projectId });
      invoice.si_number = data?.si_number ?? null;
      const submittedRow = approverPage.getByRole('row').filter({ hasText: invoice.si_number ?? '' }).first();
      await expect(submittedRow).toContainText('Unpaid');
      await expect(submittedRow).toContainText(`${stamp} project`);
    };

    const firstInvoice = await createInvoice(1);
    invoices.push(firstInvoice);
    approverContext = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC' });
    approverPage = await approverContext.newPage();
    await signIn(approverPage, fixture.approver);
    await approverPage.goto('/finance/receivables?view=invoices');
    await approveInvoice(firstInvoice);

    const secondInvoice = await createInvoice(2);
    invoices.push(secondInvoice);
    await approverPage.reload();
    await approveInvoice(secondInvoice);

    const firstRow = approverPage.getByRole('row').filter({ hasText: fixture.clientName }).filter({ hasText: invoices[0].si_number ?? '' }).first();
    await firstRow.getByRole('button', { name: /row actions/i }).click();
    await approverPage.getByRole('menuitem', { name: 'Record e-Faktur', exact: true }).click();
    const efakturNumber = `010.000-26.${String(Date.now()).slice(-8)}`;
    await approverPage.getByLabel('e-Faktur number').fill(efakturNumber);
    await approverPage.getByLabel('e-Faktur date').fill(new Date().toISOString().slice(0, 10));
    await approverPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(approverPage.getByText('e-Faktur details saved', { exact: true })).toBeVisible();
    await approverPage.goto(`/sales-invoices/${invoices[0].id}`);
    const efakturDefinition = approverPage.getByText('e-Faktur', { exact: true }).locator('xpath=following-sibling::dd[1]');
    await expect(efakturDefinition).toContainText(efakturNumber);

    await approverPage.goto('/incoming-payments');
    for (let index = 0; index < 2; index++) {
      await approverPage.getByRole('button', { name: 'Receive Payment', exact: true }).click();
      await choose(approverPage, 'Customer', fixture.clientName);
      await choose(approverPage, 'Sales Invoice', invoices[index].si_number ?? '');
      // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
      await approverPage.getByLabel('Amount settled').fill('111000');
      if (index === 1) {
        await approverPage.getByRole('button', { name: 'Tax withheld', exact: true }).click();
        await approverPage.getByLabel('Withheld tax amount').fill('2000');
        await approverPage.getByLabel('Withholding-slip number').fill(`${stamp}-SLIP`);
        // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
        await approverPage.getByLabel('Cash received').fill('109000');
      }
      await approverPage.getByRole('button', { name: 'Record payment', exact: true }).first().click();
      const receiptConfirmation = approverPage.getByRole('dialog', { name: 'Record this receipt in Odoo?' });
      await expect(receiptConfirmation).toBeVisible();
      await receiptConfirmation.getByRole('button', { name: 'Record payment', exact: true }).click();
      await expect(receiptConfirmation).toBeHidden({ timeout: 60_000 });
      await expect(approverPage.getByRole('dialog', { name: 'Receive Payment' })).toBeHidden({ timeout: 60_000 });
    }

    const { data: finalInvoices } = await admin.from('sales_invoices').select('id,si_number,project_id,amount,status,erp_docstatus,erp_outstanding_amount,efaktur_number,efaktur_date').eq('org_id', fixture.orgId).order('created_at');
    expect(finalInvoices).toHaveLength(2);
    // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
    expect(finalInvoices?.[0]).toMatchObject({ id: invoices[0].id, project_id: fixture.projectId, amount: 111000, erp_docstatus: 1 });
    expect(['Unpaid', 'Paid']).toContain(finalInvoices?.[0]?.status);
    // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
    expect(finalInvoices?.[0]?.erp_outstanding_amount).toBe(finalInvoices?.[0]?.status === 'Paid' ? 0 : 111000);
    expect(finalInvoices?.[0]?.efaktur_number).toMatch(/^010\.000-26\./);
    expect(finalInvoices?.[0]?.efaktur_date).toBe(new Date().toISOString().slice(0, 10));
    // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
    expect(finalInvoices?.[1]).toMatchObject({ id: invoices[1].id, project_id: fixture.projectId, amount: 111000, erp_docstatus: 1 });
    expect(['Unpaid', 'Paid']).toContain(finalInvoices?.[1]?.status);
    // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
    expect(finalInvoices?.[1]?.erp_outstanding_amount).toBe(finalInvoices?.[1]?.status === 'Paid' ? 0 : 111000);

    for (const invoice of finalInvoices ?? []) {
      await approverPage.goto(`/sales-invoices/${invoice.id}`);
      const collection = approverPage.getByRole('region', { name: 'Invoice collection details' });
      await expect(collection).toContainText(invoice.status === 'Paid' ? 'Paid' : 'Receipt sent, awaiting Odoo');
      // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
      if (invoice.status !== 'Paid') await expect(collection).toContainText(/111[,.]000/);
    }

    const { data: receipts } = await admin.from('incoming_payments').select('id,amount,received_amount,withheld_amount,withholding_slip_number,status,sales_invoice_id').eq('org_id', fixture.orgId).order('created_at');
    expect(receipts).toHaveLength(2);
    // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
    expect(receipts?.[0]).toMatchObject({ amount: 111000, received_amount: 111000, withheld_amount: 0, status: 'Paid', sales_invoice_id: invoices[0].id });
    // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
    expect(receipts?.[1]).toMatchObject({ amount: 111000, received_amount: 109000, withheld_amount: 2000, withholding_slip_number: `${stamp}-SLIP`, status: 'Paid', sales_invoice_id: invoices[1].id });

    await approverPage.goto('/incoming-payments');
    const plainReceiptRow = approverPage.getByRole('row').filter({ hasText: invoices[0].si_number ?? '' }).first();
    await expect(plainReceiptRow).toContainText('Paid');
    // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
    await expect(plainReceiptRow).toContainText(/111[,.]000/);
    const withheldReceiptRow = approverPage.getByRole('row').filter({ hasText: invoices[1].si_number ?? '' }).first();
    await expect(withheldReceiptRow).toContainText('Paid');
    // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
    await expect(withheldReceiptRow).toContainText(/111[,.]000/);
    await withheldReceiptRow.click();
    const paymentDrawer = approverPage.getByRole('dialog');
    // Odoo rows: 100,000 net + 11,000 VAT = 111,000 gross; withholding leaves 109,000 cash.
    await expect(paymentDrawer).toContainText(/109[,.]000/);
    await expect(paymentDrawer).toContainText('Tax withheld');
    await expect(paymentDrawer).toContainText(/2[,.]000/);
    await expect(paymentDrawer).toContainText(`${stamp}-SLIP`);

    const invoiceRefs = await must(admin.from('external_refs').select('pmo_record_id,external_record_id').eq('org_id', fixture.orgId)
      .eq('domain', 'revenue').in('pmo_record_id', invoices.map(({ id }) => id)));
    expect(invoiceRefs).toHaveLength(2);
    const invoiceMoveIds = new Map<string, number>();
    for (const ref of invoiceRefs as Array<{ pmo_record_id: string; external_record_id: string }>) {
      const moveId = parseOdooExternalRef('account.move', ref.external_record_id);
      expect(moveId).toBeTruthy();
      if (moveId !== null) invoiceMoveIds.set(ref.pmo_record_id, moveId);
      const key = externalIdentifier(`si:${ref.pmo_record_id}`);
      const anchors = await fixture.raw<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
        domain: [['module', '=', key.module], ['name', '=', key.name], ['model', '=', 'account.move']], fields: ['res_id'],
      });
      expect(anchors.map(({ res_id }) => res_id)).toEqual([moveId]);
    }
    const receiptRefs = await must(admin.from('external_refs').select('pmo_record_id,external_record_id').eq('org_id', fixture.orgId)
      .eq('domain', 'revenue').in('pmo_record_id', (receipts as Array<{ id: string }>).map(({ id }) => id)));
    expect(receiptRefs).toHaveLength(2);
    const receiptRefById = new Map((receiptRefs as Array<{ pmo_record_id: string; external_record_id: string }>).map((ref) => [ref.pmo_record_id, ref.external_record_id]));
    for (const receipt of receipts as Array<{ id: string; sales_invoice_id: string }>) {
      const paymentId = parseOdooExternalRef('account.payment', receiptRefById.get(receipt.id) ?? '');
      expect(paymentId).toBeTruthy();
      if (paymentId === null) throw new Error('AC-OCI-100 receipt reference is not an Odoo payment.');
      const key = externalIdentifier(`ip:${receipt.id}`);
      const anchors = await fixture.raw<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
        domain: [['module', '=', key.module], ['name', '=', key.name], ['model', '=', 'account.payment']], fields: ['res_id'],
      });
      expect(anchors.map(({ res_id }) => res_id)).toEqual([paymentId]);
      const [payment] = await fixture.raw<Array<{ state: string; reconciled_invoice_ids: number[] }>>('account.payment', 'read', {
        ids: [paymentId], fields: ['state', 'reconciled_invoice_ids'],
      });
      expect(['paid', 'reconciled']).toContain(payment.state);
      expect(paymentStatus(payment.state)).toMatchObject({ mirrored: true, status: 'Paid', cancelled: false });
      const linkedInvoiceId = invoiceMoveIds.get(receipt.sales_invoice_id);
      expect(linkedInvoiceId).toBeDefined();
      expect(payment.reconciled_invoice_ids).toContain(linkedInvoiceId);
    }
  } finally {
    await approverContext?.close();
    await cleanup(admin, { orgId: fixture.orgId, author: fixture.author, approver: fixture.approver, users: [fixture.author, fixture.approver], connected: true, externalIds: fixture.externalIds, companyId: fixture.companyId, projectId: fixture.projectId });
  }
});
