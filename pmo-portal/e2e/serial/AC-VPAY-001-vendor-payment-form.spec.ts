// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state, the AC-ENA-053/AC-VWH-005 class); both rows are deleted in cleanup.
/**
 * AC-VPAY-001 — pay a vendor bill from PMO (#910) THROUGH THE FORM: the one curated cross-stack
 * journey of docs/specs/vendor-payment-from-pmo.spec.md. The #876 e2e paid through the dispatch
 * directly — exactly the bypass this issue closes — so the payment here enters via the procurement
 * ledger's capture form on a flipped org, and the served gates/body/resolution are the SHIPPED code,
 * never a hand-built payload. The real served `adapter-dispatch` commits (NEVER `page.route` — the
 * money-command rule).
 *
 * Stated money facts (AC-VWH-005's figures, so the oracle is not an accident of fixtures):
 *   net 1,000,000 · PPN 11% (110,000) · PPh 23 2% (20,000) → ERPNext outstanding 1,090,000.
 *   The case sits at `Vendor Invoiced` approved by ADMIN (user A); FINANCE (user B ≠ A) pays — the
 *   server-side SoD gate (approver ≠ payer, the #910 paymentGate) must pass for B.
 *
 * Journey: sign in as finance@acme.test → open the case → the ledger capture offers Payment →
 * select the bill (amount prefills 1,090,000 — DD-VPAY-10) → Save → the real served dispatch
 * commits a Payment Entry against the bill → PMO's payments row mirrors pay_number ACC-PAY-*,
 * amount 1,090,000, status 'Paid', invoice_id, recorded_by_id = the finance user (DD-VPAY-9) →
 * the sweep runs → the bill shows Paid / outstanding 0 → the ledger renders the Payment row.
 * The ERP PE's paid_amount is asserted when bench creds are exported (the AC-ENA-053
 * optional-verification pattern — never hardcoded, NFR-ENA-SEC-002).
 *
 * Run (docs/environments.md "Running the served ERPNext lane"):
 *   scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *     scripts/e2e-local.sh --reset --project=serial --workers=1 e2e/serial/AC-VPAY-001-vendor-payment-form.spec.ts
 * Env: the same served-lane + bench set as AC-VWH-005 (exported in the shell; never committed).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { login } from '../helpers';
import { SAR_CURRENCY } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// Two INDEPENDENT env vars (the AC-ENA-053 discipline): SITE_URL (Docker-reachable, seeded into
// external_org_bindings.site_url — what the served fn dials) vs BENCH_URL (host-reachable, this test
// process's OWN optional verification fetch). Neither falls back to the other.
const SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const SWEEP_SECRET = process.env.ERPNEXT_SWEEP_SECRET ?? 'e2e-erpnext-sweep-secret';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const ADMIN_EMAIL = 'admin@acme.test';
const FINANCE_EMAIL = 'finance@acme.test';
const COMPANY = 'PMO Smoke Co';
const TAX_PARENT = 'Duties and Taxes - PSC';
const VAT_ACCOUNT = 'Spike PPN Masukan - PSC';
const PPH_ACCOUNT = 'Spike PPh 23 Payable - PSC';
const TEMPLATE = 'Spike PPN11 PPh23 - PSC';
const TEMPLATE_ROWS = [
  { charge_type: 'On Net Total', account_head: VAT_ACCOUNT, description: 'PPN 11%', rate: 11, category: 'Total', add_deduct_tax: 'Add' },
  { charge_type: 'On Net Total', account_head: PPH_ACCOUNT, description: 'PPh 23 2%', rate: 2, category: 'Total', add_deduct_tax: 'Deduct' },
];

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY);
if (FUNCTIONS_URL && !READY) throw new Error('AC-VPAY-001: the served lane is up but its Supabase dependencies are incomplete — never a silent skip.');
test.skip(!READY, 'AC-VPAY-001 requires the local served-functions lane (SUPABASE_FUNCTIONS_URL) and the ERPNext bench.');
test.setTimeout(240_000);

type Doc = Record<string, unknown>;

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

/** Bench fixtures are created once and reused across runs (the AC-VWH-005 tax template). */
async function ensureDoc(doctype: string, name: string, body: Doc): Promise<Doc> {
  const existing = await erp('GET', resource(doctype, name));
  if (existing.status === 200) return existing.data as Doc;
  const created = await erp('POST', resource(doctype), body);
  expect(created.status, `${doctype} ${name} must be creatable on the bench`).toBe(200);
  return created.data as Doc;
}

async function profileId(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.from('profiles').select('id').eq('email', email).single();
  if (error || !data) throw new Error(`profile for ${email} not found: ${error?.message}`);
  return (data as { id: string }).id;
}

async function adminToken(): Promise<string> {
  const authClient = createClient(AUTH_URL, ANON_KEY);
  const { data, error } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: 'Passw0rd!dev' });
  if (error || !data.session) throw new Error(`admin sign-in failed: ${error?.message}`);
  return data.session.access_token;
}

interface Seed {
  companyId: string;
  procurementId: string;
  piRecordId: string;
}
/** Seeds the seed org exactly like AC-ENA-053 (company + Supplier mapping + binding + flip) plus the
 *  SoD shape the #910 gate reads: the case sits at `Vendor Invoiced` approved by the ADMIN profile. */
async function seed(admin: SupabaseClient, s: Seed): Promise<void> {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const approverId = await profileId(admin, ADMIN_EMAIL);
  const { error: companyErr } = await admin.from('companies').insert({ id: s.companyId, org_id: ORG_ID, name: `Spike Supplier ${suffix}`, type: 'Vendor' });
  if (companyErr) throw new Error(`seed companies failed: ${companyErr.message}`);
  const { error: refErr } = await admin.from('external_refs').insert({
    org_id: ORG_ID, domain: 'companies', pmo_record_id: s.companyId, external_tier: 'erpnext', external_record_id: 'Supplier:Spike Supplier',
  });
  if (refErr) throw new Error(`seed supplier ref failed: ${refErr.message}`);
  // The case id is minted HERE and carried on the seed — the bill dispatch and the UI journey both
  // key on it (an id captured late is exactly the empty-string dispatch this spec once made).
  s.procurementId = crypto.randomUUID();
  const { error: procErr } = await admin.from('procurements')
    .insert({
      id: s.procurementId,
      org_id: ORG_ID, title: `AC-VPAY-001 case ${suffix}`, vendor_id: s.companyId,
      status: 'Vendor Invoiced', currency: SAR_CURRENCY, approved_by_id: approverId,
    })
    .select('id').single();
  if (procErr) throw new Error(`seed procurement failed: ${procErr.message}`);
  const { error: bindingErr } = await admin.from('external_org_bindings').upsert({
    org_id: ORG_ID, external_tier: 'erpnext', site_url: SITE_URL, secret_ref: 'local-bench',
    webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET', version_major: 15,
    config: { company: COMPANY, default_cash_account: 'Cash - PSC', default_payable_account: 'Creditors - PSC' },
    activated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,external_tier' });
  if (bindingErr) throw new Error(`seed binding failed: ${bindingErr.message}`);
  const { error: flipErr } = await admin.from('external_domain_ownership')
    .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'procurement' }, { onConflict: 'org_id,external_tier,domain' });
  if (flipErr) throw new Error(`seed flip failed: ${flipErr.message}`);
}

async function cleanup(admin: SupabaseClient, s: Seed): Promise<void> {
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'procurement');
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  await admin.from('payments').delete().eq('procurement_id', s.procurementId);
  await admin.from('procurement_invoices').delete().eq('procurement_id', s.procurementId);
  await admin.from('procurements').delete().eq('id', s.procurementId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', s.piRecordId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', s.companyId);
  await admin.from('companies').delete().eq('id', s.companyId);
}

test('AC-VPAY-001 finance pays an ERP-owned bill through the ledger form: PE lands in ERPNext, the mirror names the payer, the sweep closes the bill', async ({ page }) => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const financeId = await profileId(admin, FINANCE_EMAIL);
  const s: Seed = { companyId: crypto.randomUUID(), procurementId: '', piRecordId: crypto.randomUUID() };

  // ── Bench facts this journey states rather than assumes (the AC-VWH-005 tax template) ──
  if (BENCH_KEY && BENCH_SECRET) {
    expect((await readDoc('Company', COMPANY)).default_currency, 'the bench company bills in IDR').toBe(SAR_CURRENCY);
    await ensureDoc('Account', TAX_PARENT, { account_name: 'Duties and Taxes', parent_account: 'Current Liabilities', company: COMPANY, is_group: 1 });
    await ensureDoc('Account', VAT_ACCOUNT, { account_name: 'Spike PPN Masukan', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });
    await ensureDoc('Account', PPH_ACCOUNT, { account_name: 'Spike PPh 23 Payable', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });
    await ensureDoc('Purchase Taxes and Charges Template', TEMPLATE, { title: 'Spike PPN11 PPh23', company: COMPANY, taxes: TEMPLATE_ROWS });
  }

  try {
    await seed(admin, s);

    // ── The ERP-owned bill: recorded by dispatch (the AC-VWH-005 shape) — net 1,000,000, PPN 11%,
    //    PPh 23 2% → ERPNext outstanding 1,090,000. The APPROVER records it; the SoD question is
    //    only about who PAYS. ──
    const token = await adminToken();
    const piRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'procurement', operation: 'create', idempotencyKey: crypto.randomUUID(),
        record: {
          id: s.piRecordId, procurementId: s.procurementId, vendorId: s.companyId, erp_doc_kind: 'purchase-invoice',
          items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1000000 }], taxTemplate: TEMPLATE,
        },
      }),
    });
    const piBody = (await piRes.json()) as { externalRecordId?: string; message?: string };
    expect(piRes.status, `PI dispatch failed: ${piBody.message}`).toBe(200);
    const piName = piBody.externalRecordId!;
    if (BENCH_KEY && BENCH_SECRET) {
      expect(await readDoc('Purchase Invoice', piName)).toMatchObject({
        docstatus: 1, currency: SAR_CURRENCY, net_total: 1000000, grand_total: 1090000, outstanding_amount: 1090000,
      });
    }
    const bill = () => admin.from('procurement_invoices')
      .select('vi_number,amount,erp_outstanding_amount,status,currency')
      .eq('id', s.piRecordId).single();
    await expect.poll(async () => (await bill()).data?.erp_outstanding_amount, { timeout: 20_000 })
      .toBe(1090000);

    // ── THE JOURNEY: finance user B pays through the FORM (never a hand-built payload) ──
    await login(page, FINANCE_EMAIL);
    await page.goto(`/procurement/${s.procurementId}`);
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: /Documents/i }).click();

    // The ledger capture offers Payment at Vendor Invoiced (ledgerCapture.ts) — the dashed
    // prompt's "Capture Payment" affordance (ledger-capture-open; the LedgerCaptureRow one).
    const trigger = page.getByTestId('ledger-capture-open');
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await expect(trigger).toHaveText(/Capture Payment/);
    await trigger.click();

    // The form asks only what PMO owns: NO status select (DD-VPAY-8), the bill REQUIRED (DD-VPAY-3).
    await expect(page.getByTestId('form-capture-payment')).toBeVisible();
    await expect(page.getByTestId('payment-status-select')).toHaveCount(0);
    await page.getByTestId('payment-invoice-select').selectOption(s.piRecordId);
    // DD-VPAY-10: the amount prefills the bill's ERP outstanding — accepted as-is.
    await expect(page.getByTestId('payment-amount-input')).toHaveValue('1090000');
    await page.getByTestId('payment-save-btn').click();

    // The real served dispatch commits (no page.route). PMO's payments row mirrors the PE —
    // stamped with the PAYER (DD-VPAY-9: recorded_by_id = the finance user, the verified caller).
    const payment = () => admin.from('payments')
      .select('pay_number,amount,status,invoice_id,procurement_id,recorded_by_id')
      .eq('procurement_id', s.procurementId)
      .maybeSingle();
    await expect.poll(async () => (await payment()).data, { timeout: 60_000 }).not.toBeNull();
    const { data: payRow } = await payment();
    expect(payRow).toMatchObject({
      amount: 1090000,
      status: 'Paid', // the submitted (docstatus 1) PE derives Paid — the only status truth
      invoice_id: s.piRecordId,
      procurement_id: s.procurementId,
      recorded_by_id: financeId,
    });
    expect(String((payRow as Doc).pay_number)).toMatch(/^ACC-PAY-/);

    // ── Optional bench verification (only when creds are exported — never hardcoded) ──
    if (BENCH_KEY && BENCH_SECRET) {
      const pe = await readDoc('Payment Entry', String((payRow as Doc).pay_number));
      expect(pe).toMatchObject({ docstatus: 1, payment_type: 'Pay', party_type: 'Supplier', party: 'Spike Supplier', paid_amount: 1090000 });
      const refs = (pe.references as Doc[]) ?? [];
      expect(refs.map((r) => [r.reference_doctype, r.reference_name, Number(r.allocated_amount)])).toEqual([
        ['Purchase Invoice', piName, 1090000], // the SERVER-resolved allocation (DD-VPAY-2)
      ]);
    }

    // ── The sweep brings the settlement back: the bill shows Paid / outstanding 0 (FR-VPAY-008) ──
    const sweep = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SWEEP_SECRET}` },
      body: JSON.stringify({ org_id: ORG_ID }),
    });
    expect([200, 202]).toContain(sweep.status);
    await sweep.arrayBuffer();
    await expect.poll(async () => (await bill()).data?.status, { timeout: 30_000 }).toBe('Paid');
    const { data: settled } = await bill();
    expect(settled).toMatchObject({ status: 'Paid', erp_outstanding_amount: 0, amount: 1110000, currency: SAR_CURRENCY });

    // ── The ledger renders the Payment row (and the bill's Paid state) ──
    await page.reload();
    await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: /Documents/i }).click();
    const ledger = page.getByTestId('procurement-ledger');
    await expect(ledger.getByText(String((payRow as Doc).pay_number), { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(ledger.getByText('Paid', { exact: true }).first()).toBeVisible();
  } finally {
    await cleanup(admin, s);
  }
});
