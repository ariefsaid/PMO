// @e2e-isolation: serial — creates ERP money documents and mutates the shared organization ERP binding.
/**
 * AC-PPNC-001: normal create → independent submit → confirmed cancel → fresh create → independent submit.
 * This served-lane proof intentionally reads the complete ERP Sales Invoice documents, including child tax rows.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { cleanupSAR, dispatchCreateRevenue, dispatchTransitionRevenue, SAR_CURRENCY, seedSAR, signInAdmin, signInApprover } from './_sarHelpers';

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
test.setTimeout(240_000);

const authHeaders = { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' };
type ErpInvoice = { name: string; docstatus: number; grand_total: number; total: number; taxes: Array<{ rate: number; tax_amount: number; total: number; charge_type: string }> };
async function readErpInvoice(name: string): Promise<ErpInvoice> {
  const response = await fetch(`${BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(name)}`, { headers: authHeaders });
  expect(response.status, `full ERP invoice read failed for ${name}`).toBe(200);
  return ((await response.json()) as { data: ErpInvoice }).data;
}

async function sendWithRetry(create: (key: string) => Promise<Response>): Promise<Response> {
  const key = crypto.randomUUID();
  let response = await create(key);
  for (let attempt = 0; response.status === 502 && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    response = await create(key);
  }
  return response;
}

test('AC-PPNC-001 Finance cancels and re-issues with fresh PPN and independent approval', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const financeToken = await signInAdmin(AUTH_URL, ANON_KEY);
  const approverToken = await signInApprover(AUTH_URL, ANON_KEY);
  const suffix = `ppnc001-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const seeded = await seedSAR(admin, suffix);
  const workOrderId = crypto.randomUUID();
  const originalId = crypto.randomUUID();
  const replacementId = crypto.randomUUID();
  const record = (id: string, rate: number) => ({ id, customerId: seeded.companyId, projectId: seeded.projectId, workOrderId, items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate }] });
  const dispatchCreate = (id: string, rate: number, key: string) => dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, financeToken, record(id, rate), 'sales-invoice', key);
  try {
    const setup = await admin.from('projects').update({ client_id: seeded.companyId, currency: SAR_CURRENCY, subject_to_vat: true, tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12 }).eq('id', seeded.projectId);
    expect(setup.error).toBeNull();
    const wo = await admin.from('work_orders').insert({ id: workOrderId, org_id: ORG_ID, project_id: seeded.projectId, title: `PPN correction ${suffix}`, status: 'Issued', wo_number: `WO-${suffix}`, issued_at: new Date().toISOString(), order_value: 5_000_000, tax_treatment: 'exclusive', tax_amount: 0, currency: SAR_CURRENCY });
    expect(wo.error).toBeNull();

    const first = await sendWithRetry((key) => dispatchCreate(originalId, 1_200_000, key));
    const firstBody = await first.json() as { externalRecordId?: string };
    expect(first.status, JSON.stringify(firstBody)).toBe(200);
    const originalName = firstBody.externalRecordId;
    expect(originalName).toBeTruthy();
    const approveOriginal = await dispatchTransitionRevenue(FUNCTIONS_URL, ANON_KEY, approverToken,
      { ...record(originalId, 1_200_000), externalRecordId: originalName }, 'sales-invoice', 'submit', crypto.randomUUID());
    expect(approveOriginal.status, await approveOriginal.text()).toBe(200);
    const originalBefore = await readErpInvoice(originalName!);
    expect(originalBefore).toMatchObject({ docstatus: 1, total: 1_200_000, grand_total: 1_332_000 });
    expect(originalBefore.taxes).toEqual(expect.arrayContaining([expect.objectContaining({ rate: 12, tax_amount: 132_000, charge_type: 'On Net Total' })]));

    const cancel = await dispatchTransitionRevenue(FUNCTIONS_URL, ANON_KEY, financeToken,
      { ...record(originalId, 1_200_000), externalRecordId: originalName }, 'sales-invoice', 'cancel', crypto.randomUUID());
    expect(cancel.status, await cancel.text()).toBe(200);
    await expect.poll(async () => (await readErpInvoice(originalName!)).docstatus, { timeout: 30_000 }).toBe(2);

    const replacement = await sendWithRetry((key) => dispatchCreate(replacementId, 2_400_000, key));
    const replacementBody = await replacement.json() as { externalRecordId?: string };
    expect(replacement.status, JSON.stringify(replacementBody)).toBe(200);
    const replacementName = replacementBody.externalRecordId;
    expect(replacementName).toBeTruthy();
    expect(replacementName).not.toBe(originalName);
    const draft = await readErpInvoice(replacementName!);
    expect(draft).toMatchObject({ docstatus: 0, total: 2_400_000, grand_total: 2_664_000 });
    expect(draft.taxes).toEqual(expect.arrayContaining([expect.objectContaining({ rate: 12, tax_amount: 264_000, charge_type: 'On Net Total' })]));
    const approveReplacement = await dispatchTransitionRevenue(FUNCTIONS_URL, ANON_KEY, approverToken,
      { ...record(replacementId, 2_400_000), externalRecordId: replacementName }, 'sales-invoice', 'submit', crypto.randomUUID());
    expect(approveReplacement.status, await approveReplacement.text()).toBe(200);
    expect((await readErpInvoice(replacementName!)).docstatus).toBe(1);
    expect((await readErpInvoice(originalName!)).docstatus).toBe(2);

    const ids = [originalId, replacementId];
    const mirrors = await admin.from('sales_invoices').select('id,status,amount,erp_docstatus').in('id', ids).order('id');
    expect(mirrors.error).toBeNull();
    expect(mirrors.data).toHaveLength(2);
    expect(mirrors.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: originalId, status: 'Cancelled', erp_docstatus: 2 }),
      expect.objectContaining({ id: replacementId, erp_docstatus: 1 }),
    ]));
    const billing = await admin.from('work_order_billing').select('invoiced,pending,remaining').eq('work_order_id', workOrderId).single();
    expect(billing.error).toBeNull();
    expect(Number(billing.data!.invoiced)).toBe(2_400_000);
    expect(Number(billing.data!.pending)).toBe(0);
  } finally {
    const ids = [originalId, replacementId];
    await admin.from('sales_invoice_authors').delete().in('sales_invoice_id', ids);
    await admin.from('sales_invoices').delete().in('id', ids);
    await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', ids);
    await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', ids);
    await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', ids);
    await admin.from('work_orders').delete().eq('id', workOrderId);
    await cleanupSAR(admin, seeded);
  }
});
