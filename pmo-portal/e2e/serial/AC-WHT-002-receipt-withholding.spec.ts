// @e2e-isolation: serial — configures the shared org's accounting setting and revenue binding.
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
const SWEEP_SECRET = process.env.ERPNEXT_SWEEP_SECRET ?? 'e2e-erpnext-sweep-secret';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
// Synthetic bench fixture; this is configured explicitly, never a production default.
const PREPAID_ACCOUNT = 'Earnest Money - PSC';
const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) throw new Error('AC-WHT-002: the served receipt lane is available but its bench dependencies are incomplete.');
test.skip(!READY, 'AC-WHT-002 requires the local served-functions lane and throwaway ERPNext bench.');
test.setTimeout(120_000);

async function erpDoc(doctype: string, name: string) {
  const response = await fetch(`${BENCH_URL}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
    headers: { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}` },
  });
  expect(response.status, `${doctype} read-back must succeed`).toBe(200);
  return (await response.json()).data;
}

test('AC-WHT-002: cash plus withheld tax fully settles the invoice in ERP and survives sweep unchanged', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const author = await signInAdmin(AUTH_URL, ANON_KEY);
  const approver = await signInApprover(AUTH_URL, ANON_KEY);
  const { data: prior, error: priorError } = await admin.from('organizations').select('tax_prepaid_account').eq('id', ORG_ID).single();
  expect(priorError).toBeNull();
  const seeded = await seedSAR(admin, `wht-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const slip = `WHT-${crypto.randomUUID().slice(0, 8)}`;
  let priorBindingConfig: Record<string, unknown> | undefined;
  try {
    // The synthetic activated binding must carry the real Company defaults
    // consumed by the withholding mapper, just as connection activation does.
    const { data: binding, error: bindingError } = await admin.from('external_org_bindings')
      .select('config').eq('org_id', ORG_ID).eq('external_tier', 'erpnext').single();
    expect(bindingError).toBeNull();
    priorBindingConfig = binding!.config;
    const company = await erpDoc('Company', binding!.config.company);
    expect(company.cost_center).toBe('Main - PSC');
    const { error: defaultsError } = await admin.from('external_org_bindings')
      .update({ config: { ...binding!.config, cost_center: company.cost_center } })
      .eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    expect(defaultsError).toBeNull();
    const { error: settingError } = await admin.from('organizations').update({ tax_prepaid_account: PREPAID_ACCOUNT }).eq('id', ORG_ID);
    expect(settingError).toBeNull();
    async function create(record: Record<string, unknown>, kind: 'sales-invoice' | 'incoming-payment', key: string) {
      let response = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, author, record, kind, key);
      for (let attempt = 0; response.status === 502 && attempt < 2; attempt++) {
        await response.arrayBuffer();
        response = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, author, record, kind, key);
      }
      const result = await response.json();
      expect(response.status, `The ${kind} command must commit`).toBe(200);
      expect(result.externalRecordId).toEqual(expect.any(String));
      return result.externalRecordId as string;
    }
    const siName = await create({ id: seeded.siRecordId, customerId: seeded.companyId,
      projectId: seeded.projectId, erp_doc_kind: 'sales-invoice',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 200000 }] }, 'sales-invoice', crypto.randomUUID());
    const submit = await dispatchTransitionRevenue(FUNCTIONS_URL, ANON_KEY, approver,
      { id: seeded.siRecordId, customerId: seeded.companyId, projectId: seeded.projectId,
        erp_doc_kind: 'sales-invoice', externalRecordId: siName, verb: 'submit' },
      'sales-invoice', 'submit', crypto.randomUUID());
    expect(submit.status, 'A different approver must submit the fresh invoice').toBe(200);
    await submit.arrayBuffer();
    expect((await erpDoc('Sales Invoice', siName)).outstanding_amount).toBe(200000);
    const key = crypto.randomUUID();
    const peName = await create({ id: seeded.ipRecordId, customerId: seeded.companyId,
      salesInvoiceId: seeded.siRecordId, erp_doc_kind: 'incoming-payment',
      paid_amount: 200000, received_amount: 180000, withheld_amount: 20000,
      withholding_slip_number: slip }, 'incoming-payment', key);
    const pe = await erpDoc('Payment Entry', peName);
    // DD-RCPT-1: ERPNext forces received_amount = paid_amount (both the cash) for same-currency accounts.
    expect(pe).toMatchObject({ docstatus: 1, payment_type: 'Receive', paid_amount: 180000, received_amount: 180000 });
    expect(pe.deductions).toEqual(expect.arrayContaining([expect.objectContaining({
      account: PREPAID_ACCOUNT, cost_center: 'Main - PSC', amount: 20000, description: `Withholding slip: ${slip}`,
    })]));
    expect(pe.references).toEqual(expect.arrayContaining([expect.objectContaining({ reference_name: siName, allocated_amount: 200000 })]));
    expect(await erpDoc('Sales Invoice', siName)).toMatchObject({ status: 'Paid', outstanding_amount: 0 });
    const receipt = () => admin.from('incoming_payments').select('amount,received_amount,withheld_amount,withholding_slip_number,reference_number').eq('id', seeded.ipRecordId).single();
    const { data: before, error: beforeError } = await receipt();
    expect(beforeError).toBeNull();
    expect(before).toMatchObject({ amount: 200000, received_amount: 180000, withheld_amount: 20000, withholding_slip_number: slip });
    expect(before?.reference_number).toBeTruthy();
    const outbox = () => admin.from('external_command_outbox').select('payload_digest').eq('org_id', ORG_ID).eq('pmo_record_id', seeded.ipRecordId).eq('idempotency_key', key).single();
    const { data: beforeDigest, error: beforeDigestError } = await outbox();
    expect(beforeDigestError).toBeNull();
    expect(beforeDigest?.payload_digest).toMatch(/^[a-f0-9]{64}$/);
    const sweep = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-sweep`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SWEEP_SECRET}` },
      body: JSON.stringify({ scope: 'revenue', org_id: ORG_ID }),
    });
    expect([200, 202]).toContain(sweep.status);
    await sweep.arrayBuffer();
    const { data: after, error: afterError } = await receipt();
    expect(afterError).toBeNull();
    expect(after).toEqual(before);
    const { data: afterDigest, error: afterDigestError } = await outbox();
    expect(afterDigestError).toBeNull();
    expect(afterDigest).toEqual(beforeDigest);
    const { data: notices, error: noticesError } = await admin.from('notifications').select('metadata,body').eq('org_id', ORG_ID).eq('title', 'Action required');
    expect(noticesError).toBeNull();
    expect((notices ?? []).filter(notice => {
      const content = JSON.stringify(notice);
      return content.includes(peName) || content.includes(seeded.ipRecordId);
    })).toEqual([]);
  } finally {
    if (priorBindingConfig) {
      await admin.from('external_org_bindings').update({ config: priorBindingConfig })
        .eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    }
    await admin.from('organizations').update({ tax_prepaid_account: prior?.tax_prepaid_account ?? null }).eq('id', ORG_ID);
    await cleanupSAR(admin, seeded);
  }
});
