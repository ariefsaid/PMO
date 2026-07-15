// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-SAR-041-pe-receive — Slice 7 task 7.3. Real served boundary
 * (`scripts/serve-functions.sh` against the Docker v15 dev bench, docs/environments.md) — NEVER
 * `page.route`, per the plan's binding rule for every money-command e2e (FR-SAR-001/003).
 *
 * Given a submitted Sales Invoice with non-zero `erp_outstanding_amount`, when a Payment Entry
 * (Receive) is created+submitted (R9-P3a spike §2 frozen: adapter supplies `paid_from`=receivable,
 * `paid_to`=cash, `received_amount` explicit, `references[]` to the SI), then: ERP commits the
 * Receive Payment Entry; `incoming_payments` mirrors (`amount`=`paid_amount`,
 * `sales_invoice_id`→the SI, `reference_number`=the anchor carrier `reference_no`). The SI's
 * `Paid`/`erp_outstanding_amount=0` flip happens SERVER-SIDE in ERP on the referenced PE submit —
 * PMO's OWN `sales_invoices` mirror does NOT re-fetch outstanding on an outbound payment
 * (ADR-0048 "PMO never recomputes"; it reaches the mirror only via the inbound feed/sweep, out of
 * this command's scope — mirrors AC-ENA-053's PI-flip note), so the flip is asserted by querying
 * the ERP Sales Invoice DOC DIRECTLY, not the PMO mirror.
 *
 * Requires (process env, same as AC-ENA-053/AC-SAR-043): SUPABASE_FUNCTIONS_URL,
 * SUPABASE_URL/VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * ERPNEXT_BENCH_API_KEY/SECRET (REQUIRED — the SI flip is the ERP-side oracle, verified directly).
 * The served function additionally needs ERPNEXT_API_KEY/ERPNEXT_API_SECRET as function secrets
 * (`supabase/functions/.env.local`, local-only, gitignored, creds from
 * `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md` — never this repo, NFR-SAR-SEC-002).
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-SAR-041
 *
 * Retry-on-502 with the SAME idempotencyKey (ADR-0058 client contract).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { seedSAR, cleanupSAR, signInAdmin, signInApprover, dispatchCreateRevenue, dispatchTransitionRevenue } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ERPNEXT_BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const ERPNEXT_ADMIN_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const ERPNEXT_ADMIN_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

// Bench creds (ERPNEXT_BENCH_API_KEY/SECRET) are REQUIRED here: the SI paid-detection flip is the
// ERP-SIDE oracle (PMO's own mirror does not re-fetch outstanding on an outbound payment — see B).
const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET);
if (!READY && process.env.CI) {
  throw new Error('AC-SAR-041-pe-receive: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY + ERPNEXT_BENCH_API_KEY/SECRET are required in CI — this spec cannot silently skip');
}
test.skip(!READY, 'AC-SAR-041-pe-receive: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY/ERPNEXT_BENCH_API_KEY/SECRET not set — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(120_000);

test.describe('AC-SAR-041: PE-receive create+submit through the real served adapter-dispatch boundary', () => {
  test('given a submitted SI with outstanding > 0, create+submit a PE-receive -> ERP commits; incoming_payments mirrors (amount, sales_invoice_id, reference_number); SI flips Paid/erp_outstanding_amount=0 server-side', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authorToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const approverToken = await signInApprover(AUTH_URL, ANON_KEY);

    const suffix = `sar041-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);

    try {
      const siIdempotencyKey = crypto.randomUUID();

      // ── 1. CREATE + SUBMIT a Sales Invoice (author creates, approver submits) ──
      let siCreateRes = await dispatchCreateRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        authorToken, // author creates the SI
        {
          id: seeded.siRecordId,
          customerId: seeded.companyId,
          projectId: seeded.projectId,
          erp_doc_kind: 'sales-invoice',
          items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 200000 }],
        },
        'sales-invoice',
        siIdempotencyKey,
      );
      let siCreateBody = await siCreateRes.json();
      for (let attempt = 0; siCreateRes.status === 502 && attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 750));
        siCreateRes = await dispatchCreateRevenue(
          FUNCTIONS_URL,
          ANON_KEY,
          authorToken, // same author token on retry
          {
            id: seeded.siRecordId,
            customerId: seeded.companyId,
            projectId: seeded.projectId,
            erp_doc_kind: 'sales-invoice',
            items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 200000 }],
          },
          'sales-invoice',
          siIdempotencyKey,
        );
        siCreateBody = await siCreateRes.json();
      }
      expect(siCreateRes.status, `SI create failed: ${JSON.stringify(siCreateBody)}`).toBe(200);
      const siName = siCreateBody.externalRecordId as string;

      const siSubmitRes = await dispatchTransitionRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        approverToken, // approver submits (SoD: approver ≠ author)
        {
          id: seeded.siRecordId,
          customerId: seeded.companyId,
          projectId: seeded.projectId,
          erp_doc_kind: 'sales-invoice',
          externalRecordId: siName,
          verb: 'submit',
        },
        'sales-invoice',
        'submit',
        crypto.randomUUID(),
      );
      const siSubmitBody = (await siSubmitRes.json()) as { message?: string };
      expect(siSubmitRes.status, `SI submit failed: ${siSubmitBody.message}`).toBe(200);

      // Verify SI is Unpaid with outstanding = 200000
      const { data: siRowAfterSubmit } = await admin
        .from('sales_invoices')
        .select('erp_outstanding_amount, status')
        .eq('id', seeded.siRecordId)
        .maybeSingle();
      expect(siRowAfterSubmit?.erp_outstanding_amount).toBe(200000);
      expect(siRowAfterSubmit?.status).toBe('Unpaid');

      // ── 2. CREATE + SUBMIT a PE-receive referencing the SI ──
      const ipIdempotencyKey = crypto.randomUUID();
      let ipCreateRes = await dispatchCreateRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        authorToken, // author creates the PE-receive
        {
          id: seeded.ipRecordId,
          customerId: seeded.companyId,
          salesInvoiceId: seeded.siRecordId,
          erp_doc_kind: 'incoming-payment',
          paid_amount: 200000,
          received_amount: 200000,
          references: [{ reference_doctype: 'Sales Invoice', reference_name: siName, allocated_amount: 200000 }],
        },
        'incoming-payment',
        ipIdempotencyKey,
      );
      let ipCreateBody = await ipCreateRes.json();
      for (let attempt = 0; ipCreateRes.status === 502 && attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 750));
        ipCreateRes = await dispatchCreateRevenue(
          FUNCTIONS_URL,
          ANON_KEY,
          authorToken, // same author token on retry
          {
            id: seeded.ipRecordId,
            customerId: seeded.companyId,
            salesInvoiceId: seeded.siRecordId,
            erp_doc_kind: 'incoming-payment',
            paid_amount: 200000,
            received_amount: 200000,
            references: [{ reference_doctype: 'Sales Invoice', reference_name: siName, allocated_amount: 200000 }],
          },
          'incoming-payment',
          ipIdempotencyKey,
        );
        ipCreateBody = await ipCreateRes.json();
      }
      expect(ipCreateRes.status, `PE-receive create failed: ${JSON.stringify(ipCreateBody)}`).toBe(200);
      const ipName = ipCreateBody.externalRecordId as string;
      expect(ipName).toMatch(/^ACC-PAY-/);

      // PMO mirror after PE-receive create (atomic create+submit)
      const { data: ipRowAfterCreate, error: ipRowErr1 } = await admin
        .from('incoming_payments')
        .select('*')
        .eq('id', seeded.ipRecordId)
        .maybeSingle();
      expect(ipRowErr1).toBeNull();
      expect(ipRowAfterCreate).toMatchObject({
        ip_number: ipName,
        customer_id: seeded.companyId,
        sales_invoice_id: seeded.siRecordId,
        amount: 200000,
        status: 'Paid', // create+submit is atomic (R9 money-doc) → docstatus 1 → Paid, not Scheduled
      });

      // external_refs recorded for the PE-receive
      const { data: ipRefRow } = await admin
        .from('external_refs')
        .select('external_record_id, external_tier')
        .eq('org_id', '00000000-0000-0000-0000-000000000001')
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.ipRecordId)
        .maybeSingle();
      expect(ipRefRow).toMatchObject({ external_record_id: ipName, external_tier: 'erpnext' });

      // ── 3. SUBMIT the PE-receive ──
      const ipSubmitRes = await dispatchTransitionRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        approverToken, // approver submits the PE-receive
        {
          id: seeded.ipRecordId,
          customerId: seeded.companyId,
          salesInvoiceId: seeded.siRecordId,
          erp_doc_kind: 'incoming-payment',
          externalRecordId: ipName,
          verb: 'submit',
        },
        'incoming-payment',
        'submit',
        crypto.randomUUID(),
      );
      const ipSubmitBody = (await ipSubmitRes.json()) as { message?: string };
      expect(ipSubmitRes.status, `PE-receive submit failed: ${ipSubmitBody.message}`).toBe(200);

      // ── 4. ASSERTIONS ──
      // A) incoming_payments mirror: status=Paid, erp_docstatus=1, reference_number (anchor carrier) present
      const { data: ipRowAfterSubmit, error: ipRowErr2 } = await admin
        .from('incoming_payments')
        .select('*')
        .eq('id', seeded.ipRecordId)
        .maybeSingle();
      expect(ipRowErr2).toBeNull();
      expect(ipRowAfterSubmit).toMatchObject({
        ip_number: ipName,
        customer_id: seeded.companyId,
        sales_invoice_id: seeded.siRecordId,
        amount: 200000,
        status: 'Paid',
        erp_docstatus: 1,
      });
      expect(ipRowAfterSubmit?.reference_number).not.toBeNull(); // reference_no anchor carrier
      expect(ipRowAfterSubmit?.erp_modified).not.toBeNull();
      expect(ipRowAfterSubmit?.erp_cancelled_at).toBeNull();

      // B) The SI paid-detection flip is the ERP-SIDE oracle (R9 §2 "References semantics"): the
      //    referenced PE-receive submit flips the SI's outstanding_amount to 0 + status 'Paid'
      //    SERVER-SIDE in ERP. PMO's OWN sales_invoices mirror does NOT re-fetch outstanding on an
      //    outbound payment (ADR-0048 "PMO never recomputes"; it reaches the mirror only via the
      //    inbound feed/sweep, out of this command's scope) — so the flip is verified the P2 way by
      //    querying the ERP Sales Invoice DOC DIRECTLY (mirrors AC-ENA-053's PI-flip proof). The bench
      //    creds are REQUIRED for this spec (READY), so this oracle runs unconditionally.
      const siFlipRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(siName)}`, {
        headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
      });
      expect(siFlipRes.status, 'the referenced SI must be readable from the bench').toBe(200);
      const siFlipDoc = (await siFlipRes.json()) as {
        data?: { name?: string; status?: string; outstanding_amount?: number };
      };
      expect(siFlipDoc.data?.name).toBe(siName);
      expect(siFlipDoc.data?.status).toBe('Paid');
      expect(siFlipDoc.data?.outstanding_amount).toBe(0);

      // ── ERP-side fidelity proof: the PE-receive doc ──
      // (bench creds are already required above; kept as a separate block for readability.)
      const peRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Payment%20Entry/${encodeURIComponent(ipName)}`, {
        headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
      });
      expect(peRes.status).toBe(200);
      const peDoc = (await peRes.json()) as {
        data?: {
          name?: string;
          docstatus?: number;
          payment_type?: string;
          party_type?: string;
          party?: string;
          paid_amount?: number;
          received_amount?: number;
          references?: Array<{ reference_doctype: string; reference_name: string; allocated_amount: number }>;
          reference_no?: string;
        };
      };
      expect(peDoc.data?.name).toBe(ipName);
      expect(peDoc.data?.docstatus).toBe(1);
      expect(peDoc.data?.payment_type).toBe('Receive');
      expect(peDoc.data?.party_type).toBe('Customer');
      expect(peDoc.data?.paid_amount).toBe(200000);
      expect(peDoc.data?.received_amount).toBe(200000);
      expect(peDoc.data?.references).toEqual(
        expect.arrayContaining([expect.objectContaining({ reference_doctype: 'Sales Invoice', reference_name: siName, allocated_amount: 200000 })]),
      );
      // reference_no anchor survives (spike R9-P3a-4)
      expect(peDoc.data?.reference_no).not.toBeNull();
    } finally {
      await cleanupSAR(admin, seeded);
    }
  });
});