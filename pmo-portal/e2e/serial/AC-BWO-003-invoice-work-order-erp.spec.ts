// @e2e-isolation: serial — flips the shared org's revenue ownership + binding (org-global state).
/**
 * AC-BWO-003-invoice-work-order-erp — OD-BILL-1 through the REAL served adapter-dispatch and the local ERPNext bench
 * (never page.route; never a client's ERP). The goal: the client's PO is invoiced up to its value and never past it.
 * Finance invoices part of a 300,000 PO; an invoice that would pass the PO is refused BEFORE ERPNext is written; the
 * rest invoices exactly. Author admin@acme.test raises; the approver submits — the invoice SoD.
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test AC-BWO-003
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

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-BWO-003: SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY + ERPNEXT_BENCH_API_KEY/SECRET are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
test.skip(!READY, 'AC-BWO-003: needs the served functions lane and the ERPNext bench API key — run via scripts/serve-functions.sh against the bench');
test.setTimeout(180_000);

const benchHeaders = { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' };

async function erpInvoicesWithPo(po: string): Promise<Array<{ name: string; docstatus: number }>> {
  const params = new URLSearchParams({ filters: JSON.stringify([['po_no', '=', po]]), fields: JSON.stringify(['name', 'docstatus']) });
  const res = await fetch(`${BENCH_URL}/api/resource/Sales%20Invoice?${params}`, { headers: benchHeaders });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Array<{ name: string; docstatus: number }> }).data;
}

/** One user intent = one idempotency key; a 502 is retried with the SAME key (ADR-0058). */
async function createWithRetry(record: Record<string, unknown>, token: string): Promise<Response> {
  const key = crypto.randomUUID();
  let res = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, token, record, 'sales-invoice', key);
  for (let attempt = 0; res.status === 502 && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    res = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, token, record, 'sales-invoice', key);
  }
  return res;
}

test.describe('AC-BWO-003: a work order is invoiced up to its value and no further', () => {
  test('AC-BWO-003 Finance invoices a client PO in parts, is refused past it before ERPNext, and invoices exactly the rest', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authorToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const approverToken = await signInApprover(AUTH_URL, ANON_KEY);
    const author = createClient(AUTH_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${authorToken}` } } });
    const suffix = `bwo003-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);
    const po = `PO-${suffix}`;
    const workOrderId = crypto.randomUUID();
    const [firstId, overId, restId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const invoice = (id: string, rate: number) => ({
      id, customerId: seeded.companyId, projectId: seeded.projectId, workOrderId,
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate }],
    });
    const billing = async () => {
      const { data, error } = await author.from('work_order_billing').select('invoiced,pending,remaining').eq('work_order_id', workOrderId).single();
      expect(error).toBeNull();
      return { invoiced: Number(data!.invoiced), pending: Number(data!.pending), remaining: Number(data!.remaining) };
    };

    try {
      expect((await admin.from('projects').update({ client_id: seeded.companyId, contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false })
        .eq('id', seeded.projectId)).error).toBeNull();
      expect((await admin.from('work_orders').insert({
        id: workOrderId, org_id: ORG_ID, project_id: seeded.projectId, title: `Route survey ${suffix}`, client_po_number: po,
        status: 'Issued', wo_number: `WO-${suffix}`, issued_at: new Date().toISOString(),
        order_value: 300_000, tax_treatment: 'exclusive', tax_amount: 0,
      })).error).toBeNull();

      // 1. Finance invoices 200,000 of the 300,000 PO: one ERP draft that carries the client's PO.
      const first = await createWithRetry(invoice(firstId, 200_000), authorToken);
      const firstBody = (await first.json()) as { externalRecordId?: string };
      expect(first.status, `first invoice failed: ${JSON.stringify(firstBody)}`).toBe(200);
      expect((await erpInvoicesWithPo(po)).map((si) => [si.name, si.docstatus])).toEqual([[firstBody.externalRecordId, 0]]);
      expect(await billing()).toEqual({ invoiced: 0, pending: 200_000, remaining: 100_000 });

      // 2. 150,000 would pass the PO: refused before any ERP write — ERPNext still holds one invoice for this PO.
      const over = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, authorToken, invoice(overId, 150_000), 'sales-invoice', crypto.randomUUID());
      const overBody = (await over.json()) as { error?: string; message?: string };
      expect(over.status, JSON.stringify(overBody)).toBe(422);
      expect(overBody.error).toBe('BW001');
      expect(overBody.message).toContain('only 100000.00 is still to invoice');
      expect(await erpInvoicesWithPo(po)).toHaveLength(1);

      // 3. A second user submits the first; Finance invoices exactly what is left.
      const submit = await dispatchTransitionRevenue(FUNCTIONS_URL, ANON_KEY, approverToken,
        { ...invoice(firstId, 200_000), externalRecordId: firstBody.externalRecordId, verb: 'submit' }, 'sales-invoice', 'submit', crypto.randomUUID());
      const submitBody = await submit.json();
      expect(submit.status, `submit failed: ${JSON.stringify(submitBody)}`).toBe(200);
      const rest = await createWithRetry(invoice(restId, 100_000), authorToken);
      const restBody = await rest.json();
      expect(rest.status, `rest failed: ${JSON.stringify(restBody)}`).toBe(200);
      expect(await billing()).toEqual({ invoiced: 200_000, pending: 100_000, remaining: 0 });
    } finally {
      const ids = [firstId, overId, restId];
      await admin.from('sales_invoice_authors').delete().in('sales_invoice_id', ids);
      await admin.from('sales_invoices').delete().in('id', ids);
      await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', ids);
      await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', ids);
      await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', ids);
      await admin.from('work_orders').delete().eq('id', workOrderId);
      await cleanupSAR(admin, seeded);
    }
  });
});
