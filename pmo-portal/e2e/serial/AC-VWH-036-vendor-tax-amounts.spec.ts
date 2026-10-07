// @e2e-isolation: serial — creates and removes its OWN organization (member, vendor, binding, procurement flip) against the shared bench; the seed organization is never written.
/**
 * AC-VWH-036 — a vendor bill with VAT and PPh ENTERED in PMO (#876 slice 2, OD-VWH-1, DD-VWH-13) through the REAL
 * served `adapter-dispatch` against the local ERPNext bench. Never `page.route` (money-command rule).
 *
 * Stated money facts, so the oracle is not an accident of fixtures:
 *  - currency: a throwaway organization is created with default currency SAR_CURRENCY (IDR, the shared bench helper);
 *    the bench company "PMO Smoke Co" bills in IDR (asserted), so the mirrored bill is IDR without touching the seed org;
 *  - lines: one SPIKE-ITEM-1 at 1,000,000 (the net); VAT entered 110,000; PPh 23 entered 20,000;
 *  - accounts: the organization's Input VAT and PPh 23 payable settings name the bench's slice-1 fixture accounts.
 *
 * Goal: ERPNext holds exactly the entered amounts as fixed rows with no template — net 1,000,000, net payable
 * 1,090,000, the PPh credited to its payable account — and PMO mirrors gross 1,110,000 / VAT 110,000 / withheld 20,000 /
 * outstanding 1,090,000 in IDR with the PPh type (OQ-VWH-6); the seed organization's currency and tax settings are
 * unchanged.
 *
 * Run (docs/environments.md "Running the served ERPNext lane"): scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        scripts/e2e-local.sh --project=serial --workers=1 e2e/serial/AC-VWH-036
 * Env: the same served-lane + bench set as AC-VWH-005 (exported in the shell; never committed).
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
const SEED_ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PASSWORD = 'Passw0rd!dev';

const COMPANY = 'PMO Smoke Co';
const TAX_PARENT = 'Duties and Taxes - PSC';
const VAT_ACCOUNT = 'Spike PPN Masukan - PSC';
const PPH_ACCOUNT = 'Spike PPh 23 Payable - PSC';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) throw new Error('AC-VWH-036: the served lane is up but its bench dependencies are incomplete — never a silent skip.');
test.skip(!READY, 'AC-VWH-036 requires the local served-functions lane and the throwaway ERPNext bench.');
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

/** Bench fixtures are created once and reused across runs (slice 1's accounts). */
async function ensureDoc(doctype: string, name: string, body: Doc): Promise<Doc> {
  const existing = await erp('GET', resource(doctype, name));
  if (existing.status === 200) return existing.data as Doc;
  const created = await erp('POST', resource(doctype), body);
  expect(created.status, `${doctype} ${name} must be creatable on the bench`).toBe(200);
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

interface Tenant { orgId: string; userId: string; email: string; companyId: string; procurementId: string; piRecordId: string }

/** A genuinely separate organization in IDR with its own Finance member, vendor, procurement, binding and flip.
 *  A setup failure cleans up after itself: the partial org is removed before the throw, so a red run never
 *  leaves throwaway rows in the shared bench database. */
async function createTenant(admin: SupabaseClient, suffix: string): Promise<Tenant> {
  const t: Tenant = {
    orgId: crypto.randomUUID(), userId: '', email: `vwh036-${suffix}@acme.test`,
    companyId: crypto.randomUUID(), procurementId: '', piRecordId: crypto.randomUUID(),
  };
  try {
    const { error: orgErr } = await admin.from('organizations').insert({
      id: t.orgId, name: `VWH-036 Org ${suffix}`, default_currency: SAR_CURRENCY,
      input_vat_account: VAT_ACCOUNT, pph23_payable_account: PPH_ACCOUNT,
    });
    if (orgErr) throw new Error(`seed organization failed: ${orgErr.message}`);
    const { data: created, error: userErr } = await admin.auth.admin.createUser({ email: t.email, password: PASSWORD, email_confirm: true });
    if (userErr || !created.user) throw new Error(`create member failed: ${userErr?.message}`);
    t.userId = created.user.id;
    const { error: profileErr } = await admin.from('profiles')
      .upsert({ id: t.userId, org_id: t.orgId, email: t.email, full_name: 'VWH-036 Finance', role: 'Finance', status: 'active' }, { onConflict: 'id' });
    if (profileErr) throw new Error(`seed profile failed: ${profileErr.message}`);
    const { error: companyErr } = await admin.from('companies').insert({ id: t.companyId, org_id: t.orgId, name: `Spike Supplier ${suffix}`, type: 'Vendor' });
    if (companyErr) throw new Error(`seed vendor failed: ${companyErr.message}`);
    const { error: refErr } = await admin.from('external_refs').insert({
      org_id: t.orgId, domain: 'companies', pmo_record_id: t.companyId, external_tier: 'erpnext', external_record_id: 'Supplier:Spike Supplier',
    });
    if (refErr) throw new Error(`seed supplier ref failed: ${refErr.message}`);
    const { data: proc, error: procErr } = await admin.from('procurements')
      .insert({ org_id: t.orgId, title: `AC-VWH-036 case ${suffix}`, vendor_id: t.companyId, status: 'Ordered', currency: SAR_CURRENCY })
      .select('id').single();
    if (procErr || !proc) throw new Error(`seed procurement failed: ${procErr?.message}`);
    t.procurementId = (proc as { id: string }).id;
    const { error: bindingErr } = await admin.from('external_org_bindings').insert({
      org_id: t.orgId, external_tier: 'erpnext', site_url: SITE_URL, secret_ref: 'local-bench',
      webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET', version_major: 15,
      config: { company: COMPANY, default_cash_account: 'Cash - PSC', default_payable_account: 'Creditors - PSC' },
      activated_at: new Date().toISOString(),
    });
    if (bindingErr) throw new Error(`seed binding failed: ${bindingErr.message}`);
    const { error: flipErr } = await admin.from('external_domain_ownership').insert({ org_id: t.orgId, external_tier: 'erpnext', domain: 'procurement' });
    if (flipErr) throw new Error(`seed ownership failed: ${flipErr.message}`);
    return t;
  } catch (err) {
    await removeTenant(admin, t);
    throw err;
  }
}

/** Best effort, as AC-TSP-031: append-only history (audit events) may keep the organization row referenced locally. */
async function removeTenant(admin: SupabaseClient, t: Tenant): Promise<void> {
  for (const table of ['procurement_invoices', 'external_command_outbox', 'external_ref_lineage', 'external_refs',
    'procurements', 'companies', 'external_domain_ownership', 'external_org_bindings']) {
    await admin.from(table).delete().eq('org_id', t.orgId);
  }
  await admin.from('profiles').delete().eq('id', t.userId);
  await admin.auth.admin.deleteUser(t.userId).catch(() => undefined);
  await admin.from('organizations').delete().eq('id', t.orgId);
}

async function seedOrgFacts(admin: SupabaseClient) {
  const { data, error } = await admin.from('organizations')
    .select('default_currency,input_vat_account,pph23_payable_account,pph4_2_payable_account').eq('id', SEED_ORG_ID).single();
  if (error) throw new Error(`read seed org failed: ${error.message}`);
  return data;
}

test('AC-VWH-036 a bill with VAT and PPh entered in PMO lands in ERPNext as fixed rows and mirrors back gross, VAT and withheld exactly', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);

  // Bench facts this journey states rather than assumes.
  expect((await readDoc('Company', COMPANY)).default_currency, 'the bench company bills in IDR').toBe(SAR_CURRENCY);
  expect(await readDoc('Account', TAX_PARENT)).toMatchObject({ is_group: 1, root_type: 'Liability' });
  await ensureDoc('Account', VAT_ACCOUNT, { account_name: 'Spike PPN Masukan', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });
  await ensureDoc('Account', PPH_ACCOUNT, { account_name: 'Spike PPh 23 Payable', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });

  const seedBefore = await seedOrgFacts(admin);
  const t = await createTenant(admin, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  try {
    const authClient = createClient(AUTH_URL, ANON_KEY);
    const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({ email: t.email, password: PASSWORD });
    if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`);

    // 1. Record the bill with the amounts the vendor's invoice states.
    const res = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${signIn.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'procurement', operation: 'create', idempotencyKey: crypto.randomUUID(),
        record: {
          id: t.piRecordId, procurementId: t.procurementId, vendorId: t.companyId, erp_doc_kind: 'purchase-invoice',
          items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1000000 }],
          vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23',
        },
      }),
    });
    const body = (await res.json()) as { externalRecordId?: string; message?: string };
    expect(res.status, `PI dispatch failed: ${body.message}`).toBe(200);
    const piName = body.externalRecordId!;

    // 2. ERPNext holds exactly the entered amounts as fixed rows, no template.
    const doc = await readDoc('Purchase Invoice', piName);
    expect(doc).toMatchObject({
      docstatus: 1, currency: SAR_CURRENCY, net_total: 1000000, taxes_and_charges_added: 110000,
      taxes_and_charges_deducted: 20000, grand_total: 1090000, outstanding_amount: 1090000,
    });
    expect(doc.taxes_and_charges ?? '').toBe('');
    expect((doc.taxes as Doc[]).map((r) => [r.charge_type, r.account_head, r.add_deduct_tax, Number(r.tax_amount)])).toEqual([
      ['Actual', VAT_ACCOUNT, 'Add', 110000],
      ['Actual', PPH_ACCOUNT, 'Deduct', 20000],
    ]);

    // 3. The ledger: VAT debited, PPh credited to its payable account, the vendor owed the net payable.
    const gl = await glFor(piName);
    expect(total(gl.filter((r) => r.account === VAT_ACCOUNT), 'debit'), 'input VAT').toBe(110000);
    expect(total(gl.filter((r) => r.account === PPH_ACCOUNT), 'credit'), 'PPh withheld is a liability credit').toBe(20000);
    expect(total(gl.filter((r) => r.account === 'Creditors - PSC'), 'credit'), 'the vendor is owed the net').toBe(1090000);

    // 4. PMO's mirror: gross, VAT, withheld (and its PPh type) and outstanding — in IDR — with no template.
    const { data: bill, error: billErr } = await admin.from('procurement_invoices')
      .select('amount,tax_amount,withheld_amount,withheld_pph_type,erp_outstanding_amount,status,currency,tax_template')
      .eq('id', t.piRecordId).single();
    expect(billErr).toBeNull();
    expect(bill).toMatchObject({
      amount: 1110000, tax_amount: 110000, withheld_amount: 20000, withheld_pph_type: 'pph23', erp_outstanding_amount: 1090000,
      status: 'Received', currency: SAR_CURRENCY, tax_template: null,
    });
  } finally {
    await removeTenant(admin, t);
  }

  // 5. The seed organization was never written.
  expect(await seedOrgFacts(admin)).toEqual(seedBefore);
});
