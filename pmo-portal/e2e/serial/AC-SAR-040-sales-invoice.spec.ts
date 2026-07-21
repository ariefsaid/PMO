// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-SAR-040-sales-invoice — Slice 7 task 7.2. Real served boundary
 * (`scripts/serve-functions.sh` against the Docker v15 dev bench, docs/environments.md) — NEVER
 * `page.route`, per the plan's binding rule for every money-command e2e (FR-SAR-001/003).
 *
 * Given an org whose `revenue` domain is employed by ERPNext, when a Sales Invoice is
 * created+submitted (R9-P3a spike §1 frozen `{customer, items:[{item_code,qty,rate}], project?}`),
 * then: the ERP commits the real Sales Invoice (two-step insert→submit); `sales_invoices` mirrors
 * (`si_number`←ERP name, `customer_id`, `amount`←`grand_total`, `erp_outstanding_amount`←
 * `outstanding_amount`, `project_id`←the PMO project), `external_refs` (`'revenue'`) recorded,
 * the ERP-side `project` dimension stamped (verify via optional ERP GET).
 *
 * Requires (process env, same as served-fn-smoke.spec.ts / AC-ENA-053): SUPABASE_FUNCTIONS_URL,
 * SUPABASE_URL/VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * The served function additionally needs ERPNEXT_API_KEY/ERPNEXT_API_SECRET as function secrets
 * (`supabase/functions/.env.local`, local-only, gitignored, creds from
 * `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md` — never this repo, NFR-SAR-SEC-002).
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-SAR-040
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

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-SAR-040-sales-invoice: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY are required in CI — this spec cannot silently skip');
}
test.skip(!READY, 'AC-SAR-040-sales-invoice: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY not set — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(120_000);

test.describe('AC-SAR-040: Sales Invoice create+submit through the real served adapter-dispatch boundary', () => {
  test('create+submit a Sales Invoice -> ERP commits; sales_invoices mirrors (si_number, customer_id, amount, erp_outstanding_amount, project_id); external_refs recorded; ERP project dimension stamped', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authorToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const approverToken = await signInApprover(AUTH_URL, ANON_KEY);

    const suffix = `sar040-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);

    try {
      const idempotencyKey = crypto.randomUUID();

      // ── 1. CREATE the Sales Invoice (author token) — now leaves an ERP DRAFT (docstatus 0) ──
      let createRes = await dispatchCreateRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        authorToken, // author/creator token
        {
          id: seeded.siRecordId,
          customerId: seeded.companyId,
          projectId: seeded.projectId,
          erp_doc_kind: 'sales-invoice',
          items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 75000 }],
        },
        'sales-invoice',
        idempotencyKey,
      );
      let createBody = await createRes.json();
      // Retry on 502 with SAME idempotencyKey (ADR-0058 client contract)
      for (let attempt = 0; createRes.status === 502 && attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 750));
        createRes = await dispatchCreateRevenue(
          FUNCTIONS_URL,
          ANON_KEY,
          authorToken, // same author token on retry
          {
            id: seeded.siRecordId,
            customerId: seeded.companyId,
            projectId: seeded.projectId,
            erp_doc_kind: 'sales-invoice',
            items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 75000 }],
          },
          'sales-invoice',
          idempotencyKey,
        );
        createBody = await createRes.json();
      }
      expect(createRes.status, `SI create failed: ${JSON.stringify(createBody)}`).toBe(200);
      const siName = createBody.externalRecordId as string;
      expect(siName).toMatch(/^ACC-SINV-/);

      // PMO mirror after create: status 'Draft' (docstatus 0), erp_docstatus=0, outstanding=0
      const { data: siRowAfterCreate, error: siRowErr1 } = await admin
        .from('sales_invoices')
        .select('*')
        .eq('id', seeded.siRecordId)
        .maybeSingle();
      expect(siRowErr1).toBeNull();
      expect(siRowAfterCreate).toMatchObject({
        si_number: siName,
        customer_id: seeded.companyId,
        project_id: seeded.projectId,
        amount: 150000, // 2 * 75000
        status: 'Draft', // create leaves ERP DRAFT (docstatus 0) → mirror status 'Draft', NOT 'Unpaid'
        // erp_outstanding_amount not asserted on a DRAFT (version-dependent: this bench returns the
        // grand_total, not 0) — it becomes a meaningful receivable only after the approver submit.
        erp_docstatus: 0,
      });

      // external_refs recorded
      const { data: refRow } = await admin
        .from('external_refs')
        .select('external_record_id, external_tier')
        .eq('org_id', '00000000-0000-0000-0000-000000000001')
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.siRecordId)
        .maybeSingle();
      expect(refRow).toMatchObject({ external_record_id: siName, external_tier: 'erpnext' });

      // ── 2. SUBMIT the Sales Invoice (approver token — SoD: approver ≠ author) ──
      const submitRes = await dispatchTransitionRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        approverToken, // approver token (finance@acme.test ≠ admin@acme.test)
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
        crypto.randomUUID(), // new idempotencyKey for the transition
      );
      const submitBody = (await submitRes.json()) as { canonical?: Record<string, unknown>; message?: string };
      expect(submitRes.status, `SI submit failed: ${submitBody.message}`).toBe(200);

      // PMO mirror after submit: status Unpaid (docstatus 1, outstanding > 0), erp_docstatus=1
      const { data: siRowAfterSubmit, error: siRowErr2 } = await admin
        .from('sales_invoices')
        .select('*')
        .eq('id', seeded.siRecordId)
        .maybeSingle();
      expect(siRowErr2).toBeNull();
      expect(siRowAfterSubmit).toMatchObject({
        si_number: siName,
        customer_id: seeded.companyId,
        project_id: seeded.projectId,
        amount: 150000,
        erp_outstanding_amount: 150000,
        status: 'Unpaid',
        erp_docstatus: 1,
      });
      expect(siRowAfterSubmit?.erp_modified).not.toBeNull();
      expect(siRowAfterSubmit?.erp_cancelled_at).toBeNull();

      // ── 3. ERP-side proof: GET the Sales Invoice, verify project dimension ──
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(siName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        expect(docRes.status).toBe(200);
        const doc = (await docRes.json()) as {
          data?: {
            name?: string;
            docstatus?: number;
            status?: string;
            outstanding_amount?: number;
            project?: string;
            grand_total?: number;
          };
        };
        expect(doc.data?.name).toBe(siName);
        expect(doc.data?.docstatus).toBe(1);
        expect(doc.data?.status).toBe('Unpaid');
        expect(doc.data?.outstanding_amount).toBe(150000);
        expect(doc.data?.grand_total).toBe(150000);
        // Project dimension propagated to both GL legs (spike R9-P3a-5 verified header project
        // lands on both legs). Here we just verify the header project field.
        expect(doc.data?.project).toBe('PROJ-0001');
      }
    } finally {
      await cleanupSAR(admin, seeded);
    }
  });
});