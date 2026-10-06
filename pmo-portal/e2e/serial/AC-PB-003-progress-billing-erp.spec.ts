// @e2e-isolation: serial — flips the shared org's revenue ownership + binding and sets its down payment item (org-global state).
/**
 * AC-PB-003-progress-billing-erp — #766 / ADR-0077 through the REAL served adapter-dispatch boundary and the local
 * ERPNext bench (never page.route; never a client's ERP). The goal oracle is the ERP LEDGER: the down payment
 * credits the customer-advance account, and the billing claim's recovery line debits it back while revenue is
 * credited with the full claimed value. Author (admin@acme.test) creates, evidences and raises; the approver
 * (finance@acme.test) submits — the SoD every claim invoice is under.
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test AC-PB-003
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { seedSAR, cleanupSAR, signInAdmin, signInApprover, dispatchCreateRevenue, dispatchTransitionRevenue } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const DP_ITEM = 'PB-DOWN-PAYMENT';
const ADVANCE_ACCOUNT = 'Customer Advances - PSC';
const TAX_ACCOUNT = 'Progress Billing VAT - PSC';
const TAX_TEMPLATE = 'Progress Billing VAT 10%';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-PB-003: SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY + ERPNEXT_BENCH_API_KEY/SECRET are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
test.skip(!READY, 'AC-PB-003: needs the served functions lane and the ERPNext bench API key — run via scripts/serve-functions.sh against the bench');
test.setTimeout(180_000);

const benchHeaders = { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' };

/** Idempotent bench fixture: a duplicate-name refusal means Task 0 (or a previous run) already created it. */
async function benchEnsure(doctype: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`${BENCH_URL}/api/resource/${encodeURIComponent(doctype)}`, { method: 'POST', headers: benchHeaders, body: JSON.stringify(body) });
}

/** Selling Settings is site-wide; the recovery line (negative rate) is refused at submit unless this is on (DD-PBL-12a). */
async function benchAllowNegativeRates(): Promise<void> {
  const res = await fetch(`${BENCH_URL}/api/resource/Selling%20Settings/Selling%20Settings`, { method: 'PUT', headers: benchHeaders, body: JSON.stringify({ allow_negative_rates_for_items: 1 }) });
  expect(res.status, 'the bench must allow enabling Selling Settings → Allow Negative rates for Items').toBe(200);
}

async function glEntries(voucher: string): Promise<Array<{ account: string; debit: number; credit: number }>> {
  const params = new URLSearchParams({
    filters: JSON.stringify([['voucher_no', '=', voucher], ['is_cancelled', '=', 0]]),
    fields: JSON.stringify(['account', 'debit', 'credit']),
  });
  const res = await fetch(`${BENCH_URL}/api/resource/GL%20Entry?${params}`, { headers: benchHeaders });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Array<{ account: string; debit: number; credit: number }> }).data;
}

/** Raise a claim's invoice (author) then submit it (approver), retrying a 502 with the SAME key (ADR-0058). */
async function raiseAndSubmit(claimId: string, customerId: string, projectId: string, authorToken: string, approverToken: string): Promise<string> {
  const record = { id: claimId, customerId, projectId, erp_doc_kind: 'sales-invoice' };
  const key = crypto.randomUUID();
  let res = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, authorToken, record, 'sales-invoice', key);
  for (let attempt = 0; res.status === 502 && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    res = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, authorToken, record, 'sales-invoice', key);
  }
  const body = (await res.json()) as { externalRecordId?: string };
  expect(res.status, `raise failed: ${JSON.stringify(body)}`).toBe(200);
  const name = body.externalRecordId as string;
  const submit = await dispatchTransitionRevenue(FUNCTIONS_URL, ANON_KEY, approverToken,
    { ...record, externalRecordId: name, verb: 'submit' }, 'sales-invoice', 'submit', crypto.randomUUID());
  const submitBody = await submit.json();
  expect(submit.status, `submit failed: ${JSON.stringify(submitBody)}`).toBe(200);
  return name;
}

test.describe('AC-PB-003: a down payment and a billing claim post through the customer-advance account', () => {
  test('AC-PB-003 the down payment credits the advance account and the claim recovers 40,000 from it', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authorToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const approverToken = await signInApprover(AUTH_URL, ANON_KEY);
    const author = createClient(AUTH_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${authorToken}` } } });
    const suffix = `pb003-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);
    const previousItem = (await admin.from('organizations').select('down_payment_item').eq('id', ORG_ID).single()).data?.down_payment_item ?? null;
    const claimIds: string[] = [];
    let boqId: string | null = null;
    let documentId: string | null = null;

    let createdTemplate = false;
    try {
      await benchAllowNegativeRates();
      await benchEnsure('Account', { account_name: 'Progress Billing VAT', parent_account: 'Duties and Taxes - PSC', company: 'PMO Smoke Co', is_group: 0, account_type: 'Tax' });
      const existingDefault = (await (await fetch(`${BENCH_URL}/api/resource/Sales%20Taxes%20and%20Charges%20Template?${new URLSearchParams({
        filters: JSON.stringify([['company', '=', 'PMO Smoke Co'], ['is_default', '=', 1]]), fields: JSON.stringify(['name']) })}`, { headers: benchHeaders })).json()) as { data: unknown[] };
      if (existingDefault.data.length === 0) {
        await benchEnsure('Sales Taxes and Charges Template', { title: TAX_TEMPLATE, company: 'PMO Smoke Co', is_default: 1,
          taxes: [{ charge_type: 'On Net Total', account_head: TAX_ACCOUNT, description: 'VAT 10%', rate: 10 }] });
        createdTemplate = true;
      }
      await benchEnsure('Account', { account_name: 'Customer Advances', parent_account: 'Current Liabilities - PSC', company: 'PMO Smoke Co', is_group: 0 });
      await benchEnsure('Item', { item_code: DP_ITEM, item_name: 'Down payment', item_group: 'Services', stock_uom: 'Nos', is_stock_item: 0, is_sales_item: 1,
        item_defaults: [{ company: 'PMO Smoke Co', income_account: ADVANCE_ACCOUNT }] });
      expect((await admin.from('organizations').update({ down_payment_item: DP_ITEM }).eq('id', ORG_ID)).error).toBeNull();
      expect((await admin.from('projects').update({ client_id: seeded.companyId, contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0 })
        .eq('id', seeded.projectId)).error).toBeNull();
      const boq = await admin.from('boq_items').insert({ org_id: ORG_ID, project_id: seeded.projectId, item_code: 'SPIKE-ITEM-1',
        description: 'Route survey', unit: 'km', quantity: 10, rate: 50000 }).select('id').single();
      expect(boq.error).toBeNull();
      boqId = boq.data!.id as string;
      const evidence = await admin.from('project_documents').insert({ org_id: ORG_ID, project_id: seeded.projectId, category: 'Report',
        title: `Progress report ${suffix}`, status: 'Issued', revision: 'A', file_path: `e2e/${suffix}.pdf` }).select('id').single();
      expect(evidence.error).toBeNull();
      documentId = evidence.data!.id as string;

      // 1. The down payment: 200,000 recovered at 20%, evidenced, raised by the author, submitted by the approver.
      const dp = await author.rpc('create_progress_claim', { p_project_id: seeded.projectId, p_kind: 'down_payment', p_down_payment_amount: 200000, p_recovery_pct: 20 });
      expect(dp.error).toBeNull();
      claimIds.push(dp.data as string);
      expect((await author.rpc('attach_claim_evidence', { p_claim_id: dp.data, p_document_id: documentId })).error).toBeNull();
      const dpInvoice = await raiseAndSubmit(dp.data as string, seeded.companyId, seeded.projectId, authorToken, approverToken);

      // 2. A billing claim for 4 km at 50,000: gross 200,000, recovery 20% = 40,000.
      const pc = await author.rpc('create_progress_claim', { p_project_id: seeded.projectId, p_kind: 'progress', p_lines: [{ boq_item_id: boqId, quantity: 4 }] });
      expect(pc.error).toBeNull();
      claimIds.push(pc.data as string);
      expect((await author.rpc('attach_claim_evidence', { p_claim_id: pc.data, p_document_id: documentId })).error).toBeNull();
      const claimInvoice = await raiseAndSubmit(pc.data as string, seeded.companyId, seeded.projectId, authorToken, approverToken);

      // 3. The goal: the ledger.
      const dpGl = await glEntries(dpInvoice);
      expect(dpGl.filter((e) => e.account === ADVANCE_ACCOUNT).reduce((sum, e) => sum + e.credit - e.debit, 0)).toBe(200000);
      expect(dpGl.filter((e) => e.account === TAX_ACCOUNT).reduce((sum, e) => sum + e.credit - e.debit, 0), 'the down payment is taxed 10% on its net').toBe(20000);
      const si = (await (await fetch(`${BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(claimInvoice)}`, { headers: benchHeaders })).json()) as
        { data: { grand_total: number; net_total: number; taxes: Array<{ account_head: string; rate: number; tax_amount: number }>; items: Array<{ item_code: string; qty: number; rate: number }> } };
      expect(si.data.net_total).toBe(160000);
      expect(si.data.taxes.map((t) => [t.account_head, t.rate, t.tax_amount])).toEqual([[TAX_ACCOUNT, 10, 16000]]);
      expect(si.data.grand_total).toBe(176000);
      expect(si.data.items.map((i) => [i.item_code, i.qty, i.rate])).toEqual([['SPIKE-ITEM-1', 4, 50000], [DP_ITEM, 1, -40000]]);
      const claimGl = await glEntries(claimInvoice);
      const netDebit = (match: (account: string) => boolean) => claimGl.filter((e) => match(e.account)).reduce((sum, e) => sum + e.debit - e.credit, 0);
      expect(netDebit((account) => account === ADVANCE_ACCOUNT)).toBe(40000);
      expect(netDebit((account) => account.startsWith('Debtors'))).toBe(176000);
      expect(netDebit((account) => account === TAX_ACCOUNT)).toBe(-16000); // tax on the REDUCED base (net of the recovery)
      expect(claimGl.filter((e) => e.account !== ADVANCE_ACCOUNT && e.account !== TAX_ACCOUNT).reduce((sum, e) => sum + e.credit, 0)).toBe(200000);

      // 4. PMO's own figures agree.
      const summary = await author.rpc('get_project_billing', { p_project_id: seeded.projectId });
      expect(summary.error).toBeNull();
      expect(summary.data).toMatchObject({ work_billed: 200000, dp_billed: 200000, dp_recovered: 40000 });
    } finally {
      if (claimIds.length > 0) {
        await admin.from('sales_invoice_authors').delete().in('sales_invoice_id', claimIds);
        await admin.from('sales_invoices').delete().in('id', claimIds);
        await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', claimIds);
        await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', claimIds);
        await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', claimIds);
        await admin.from('progress_claim_evidence').delete().in('claim_id', claimIds);
        await admin.from('progress_claim_lines').delete().in('claim_id', claimIds);
        await admin.from('progress_claims').delete().in('id', claimIds);
      }
      if (createdTemplate) await fetch(`${BENCH_URL}/api/resource/Sales%20Taxes%20and%20Charges%20Template/${encodeURIComponent(TAX_TEMPLATE)}`, { method: 'DELETE', headers: benchHeaders });
      if (documentId) await admin.from('project_documents').delete().eq('id', documentId);
      if (boqId) await admin.from('boq_items').delete().eq('id', boqId);
      await admin.from('organizations').update({ down_payment_item: previousItem }).eq('id', ORG_ID);
      await cleanupSAR(admin, seeded);
    }
  });
});
