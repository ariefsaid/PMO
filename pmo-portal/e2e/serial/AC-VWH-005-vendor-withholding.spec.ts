// @e2e-isolation: serial — flips the shared org's procurement ownership and its ERPNext binding (org-global state).
/**
 * AC-VWH-005 — vendor withholding (#876, ADR-0082) through the REAL served `adapter-dispatch` and `erpnext-sweep`
 * against the local ERPNext bench. Never `page.route` (money-command rule).
 *
 * Stated money facts, so the oracle is not an accident of fixtures:
 *  - currency IDR (SAR_CURRENCY): the bench company "PMO Smoke Co" bills in IDR (asserted) and the procurement states
 *    IDR; the mirrored bill carries the ERP doc's own currency, so the org's default (USD in the seed) never decides it
 *    and this test never touches `organizations`;
 *  - VAT flag: the bill's VAT is the chosen template's PPN 11% Add row and nothing else. The project VAT flag
 *    (`projects.subject_to_vat`, OD-TAX-4) gates SALES invoices only, and this procurement has no project, so no
 *    flag is consulted (stated here so the oracle is not an accident of a project default);
 *  - withholding: the template's PPh 23 2% Deduct row, posted to a liability account.
 *
 * Goal: the bill is recorded with withholding; PMO shows gross / VAT / withheld / outstanding; the vendor is paid the
 * NET; the bill ends Paid in PMO with gross, VAT and withheld intact; and the cost ERPNext posts is gross of the PPh.
 *
 * Run (docs/environments.md "Running the served ERPNext lane"): scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        scripts/e2e-local.sh --project=serial --workers=1 e2e/serial/AC-VWH-005
 * Env: the same served-lane + bench set as AC-WHT-002 (exported in the shell; never committed).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SAR_CURRENCY } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const SWEEP_SECRET = process.env.ERPNEXT_SWEEP_SECRET ?? 'e2e-erpnext-sweep-secret';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';

const COMPANY = 'PMO Smoke Co';
const TAX_PARENT = 'Duties and Taxes - PSC';
const VAT_ACCOUNT = 'Spike PPN Masukan - PSC';
const PPH_ACCOUNT = 'Spike PPh 23 Payable - PSC';
const TEMPLATE = 'Spike PPN11 PPh23 - PSC';
const TEMPLATE_ROWS = [
  { charge_type: 'On Net Total', account_head: VAT_ACCOUNT, description: 'PPN 11%', rate: 11, category: 'Total', add_deduct_tax: 'Add' },
  { charge_type: 'On Net Total', account_head: PPH_ACCOUNT, description: 'PPh 23 2%', rate: 2, category: 'Total', add_deduct_tax: 'Deduct' },
];

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) throw new Error('AC-VWH-005: the served lane is up but its bench dependencies are incomplete — never a silent skip.');
test.skip(!READY, 'AC-VWH-005 requires the local served-functions lane and the throwaway ERPNext bench.');
test.setTimeout(180_000);

type Doc = Record<string, unknown>;
type GlRow = { account: string; debit: number; credit: number };

const resource = (doctype: string, name?: string) =>
  `/api/resource/${encodeURIComponent(doctype)}${name === undefined ? '' : `/${encodeURIComponent(name)}`}`;

async function erp(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BENCH_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: unknown };
  return { status: res.status, data: json.data };
}

async function readDoc(doctype: string, name: string): Promise<Doc> {
  const res = await erp('GET', resource(doctype, name));
  expect(res.status, `${doctype} ${name} read-back`).toBe(200);
  return res.data as Doc;
}

/** Bench fixtures are created once and reused across runs. */
async function ensureDoc(doctype: string, name: string, body: Doc): Promise<Doc> {
  const existing = await erp('GET', resource(doctype, name));
  if (existing.status === 200) return existing.data as Doc;
  const created = await erp('POST', resource(doctype), body);
  expect(created.status, `${doctype} ${name} must be creatable on the bench`).toBe(200);
  expect((created.data as Doc).name).toBe(name);
  return created.data as Doc;
}

async function glFor(voucher: string): Promise<GlRow[]> {
  const params = new URLSearchParams({
    filters: JSON.stringify([['voucher_no', '=', voucher], ['is_cancelled', '=', 0]]),
    fields: JSON.stringify(['account', 'debit', 'credit']),
    limit_page_length: '100',
  });
  const res = await erp('GET', `${resource('GL Entry')}?${params}`);
  expect(res.status).toBe(200);
  return res.data as GlRow[];
}

const total = (rows: GlRow[], side: 'debit' | 'credit') => rows.reduce((sum, r) => sum + Number(r[side]), 0);

async function dispatch(token: string, record: Doc): Promise<{ status: number; body: { externalRecordId?: string; message?: string } }> {
  const res = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'procurement', operation: 'create', record, idempotencyKey: crypto.randomUUID() }),
  });
  return { status: res.status, body: (await res.json()) as { externalRecordId?: string; message?: string } };
}

interface Seed { companyId: string; procurementId: string | null; piRecordId: string; peRecordId: string }

/** Seeds into `s` as it goes, so cleanup removes whatever was created even when a later step throws. */
async function seed(admin: SupabaseClient, s: Seed): Promise<void> {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const companyId = s.companyId;
  const { error: companyErr } = await admin.from('companies').insert({ id: companyId, org_id: ORG_ID, name: `Spike Supplier ${suffix}`, type: 'Vendor' });
  if (companyErr) throw new Error(`seed companies failed: ${companyErr.message}`);
  const { error: refErr } = await admin.from('external_refs').upsert(
    { org_id: ORG_ID, domain: 'companies', pmo_record_id: companyId, external_tier: 'erpnext', external_record_id: 'Supplier:Spike Supplier' },
    { onConflict: 'org_id,domain,external_record_id' },
  );
  if (refErr) throw new Error(`seed external_refs failed: ${refErr.message}`);
  const { data: proc, error: procErr } = await admin.from('procurements')
    .insert({ org_id: ORG_ID, title: `AC-VWH-005 case ${suffix}`, vendor_id: companyId, status: 'Ordered', currency: SAR_CURRENCY })
    .select('id').single();
  if (procErr || !proc) throw new Error(`seed procurements failed: ${procErr?.message}`);
  s.procurementId = (proc as { id: string }).id;
  const { error: bindingErr } = await admin.from('external_org_bindings').upsert({
    org_id: ORG_ID, external_tier: 'erpnext', site_url: SITE_URL, secret_ref: 'local-bench',
    webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET', version_major: 15,
    config: { company: COMPANY, default_cash_account: 'Cash - PSC', default_payable_account: 'Creditors - PSC' },
    activated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,external_tier' });
  if (bindingErr) throw new Error(`seed binding failed: ${bindingErr.message}`);
  const { error: flipErr } = await admin.from('external_domain_ownership')
    .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'procurement' }, { onConflict: 'org_id,external_tier,domain' });
  if (flipErr) throw new Error(`seed ownership failed: ${flipErr.message}`);
}

async function cleanup(admin: SupabaseClient, s: Seed): Promise<void> {
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'procurement');
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  if (s.procurementId) {
    await admin.from('payments').delete().eq('procurement_id', s.procurementId);
    await admin.from('procurement_invoices').delete().eq('procurement_id', s.procurementId);
    await admin.from('procurements').delete().eq('id', s.procurementId);
  }
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').in('pmo_record_id', [s.piRecordId, s.peRecordId]);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', s.companyId);
  await admin.from('companies').delete().eq('id', s.companyId);
}

test('AC-VWH-005 a bill with PPh withheld is recorded gross with VAT and withholding, paid at the net, and ends Paid in PMO with its cost gross of the withholding', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const authClient = createClient(AUTH_URL, ANON_KEY);
  const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: SEED_PASSWORD });
  if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`);
  const token = signIn.session.access_token;

  // Bench facts this journey states rather than assumes.
  expect((await readDoc('Company', COMPANY)).default_currency, 'the bench company bills in IDR').toBe(SAR_CURRENCY);
  expect(await readDoc('Account', TAX_PARENT)).toMatchObject({ is_group: 1, root_type: 'Liability' });
  await ensureDoc('Account', VAT_ACCOUNT, { account_name: 'Spike PPN Masukan', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });
  await ensureDoc('Account', PPH_ACCOUNT, { account_name: 'Spike PPh 23 Payable', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });
  const template = await ensureDoc('Purchase Taxes and Charges Template', TEMPLATE, { title: 'Spike PPN11 PPh23', company: COMPANY, taxes: TEMPLATE_ROWS });
  expect((template.taxes as Doc[]).map((r) => [r.account_head, r.rate, r.add_deduct_tax, r.category]))
    .toEqual(TEMPLATE_ROWS.map((r) => [r.account_head, r.rate, r.add_deduct_tax, r.category]));

  const s: Seed = { companyId: crypto.randomUUID(), procurementId: null, piRecordId: crypto.randomUUID(), peRecordId: crypto.randomUUID() };
  try {
    await seed(admin, s);
    // 1. Record the bill with the withholding template (IDR 1,000,000 net).
    const pi = await dispatch(token, {
      id: s.piRecordId, procurementId: s.procurementId, vendorId: s.companyId, erp_doc_kind: 'purchase-invoice',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1000000 }], taxTemplate: TEMPLATE,
    });
    expect(pi.status, `PI dispatch failed: ${pi.body.message}`).toBe(200);
    const piName = pi.body.externalRecordId!;
    expect(await readDoc('Purchase Invoice', piName)).toMatchObject({
      docstatus: 1, currency: SAR_CURRENCY, net_total: 1000000, taxes_and_charges_added: 110000,
      taxes_and_charges_deducted: 20000, grand_total: 1090000, outstanding_amount: 1090000,
    });

    // 2. Cost stays gross (FR-VWH-006): the item is debited at the net total; the PPh is a liability credit.
    const gl = await glFor(piName);
    expect(total(gl.filter((r) => r.account === PPH_ACCOUNT), 'credit'), 'PPh withheld is a liability credit').toBe(20000);
    expect(total(gl.filter((r) => r.account === 'Creditors - PSC'), 'credit'), 'the vendor is owed the net').toBe(1090000);
    expect(total(gl.filter((r) => r.account === VAT_ACCOUNT), 'debit'), 'input VAT').toBe(110000);
    expect(total(gl.filter((r) => r.account !== VAT_ACCOUNT), 'debit'), 'the cost is posted gross of withholding').toBe(1000000);

    // 3. PMO's bill: gross, VAT, withheld, outstanding — in IDR.
    const bill = () => admin.from('procurement_invoices')
      .select('amount,tax_amount,withheld_amount,erp_outstanding_amount,status,currency,tax_template')
      .eq('id', s.piRecordId).single();
    const { data: recorded, error: recordedErr } = await bill();
    expect(recordedErr).toBeNull();
    expect(recorded).toMatchObject({
      amount: 1110000, tax_amount: 110000, withheld_amount: 20000, erp_outstanding_amount: 1090000,
      status: 'Received', currency: SAR_CURRENCY, tax_template: TEMPLATE,
    });

    // 4. Pay the vendor the NET.
    const pe = await dispatch(token, {
      id: s.peRecordId, procurementId: s.procurementId, vendorId: s.companyId, invoiceId: s.piRecordId,
      erp_doc_kind: 'payment', paid_amount: 1090000,
      references: [{ reference_doctype: 'Purchase Invoice', reference_name: piName, allocated_amount: 1090000 }],
    });
    expect(pe.status, `PE dispatch failed: ${pe.body.message}`).toBe(200);
    expect(await readDoc('Purchase Invoice', piName)).toMatchObject({ status: 'Paid', outstanding_amount: 0 });

    // 5. The feed brings the settlement back: Paid in PMO, gross / VAT / withheld unchanged.
    const sweep = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SWEEP_SECRET}` },
      body: JSON.stringify({ org_id: ORG_ID }),
    });
    expect([200, 202]).toContain(sweep.status);
    await sweep.arrayBuffer();
    await expect.poll(async () => (await bill()).data?.status, { timeout: 15_000 }).toBe('Paid');
    const { data: settled } = await bill();
    expect(settled).toMatchObject({ status: 'Paid', erp_outstanding_amount: 0, amount: 1110000, tax_amount: 110000, withheld_amount: 20000 });
  } finally {
    await cleanup(admin, s);
  }
});
