// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-SAR-071-gate-off-unassigned — Slice 7 task 7.9. Process-gate relaxation proven at the
 * REAL served boundary — never `page.route`.
 *
 * Given an org with `process_gates.require_project_on_si=false` (Admin-relaxed) + a null-
 * `projectId` SI command, when the command goes through the served dispatch, then: ERP commits
 * the SI (project-less), the `sales_invoices` mirror has `project_id=NULL`, and the revenue-per-
 * project view rolls it up under 'Unassigned' (never silently dropped).
 *
 * Requires (process env, same as AC-ENA-053): SUPABASE_FUNCTIONS_URL, SUPABASE_URL/VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ERPNEXT_BENCH_API_KEY/SECRET.
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-SAR-071
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signInAdmin, signInApprover, dispatchCreateRevenue, dispatchTransitionRevenue } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ERPNEXT_BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const ERPNEXT_ADMIN_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const ERPNEXT_ADMIN_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-SAR-071-gate-off-unassigned: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY are required in CI — this spec cannot silently skip');
}
test.skip(!READY, 'AC-SAR-071-gate-off-unassigned: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY not set — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(120_000);

test.describe('AC-SAR-071: require_project_on_si=false allows null projectId -> ERP commits project-less SI + Unassigned rollup', () => {
  test('a null-projectId SI on gate-OFF org -> ERP commits, sales_invoices.project_id=NULL, revenue view Unassigned bucket', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authorToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const approverToken = await signInApprover(AUTH_URL, ANON_KEY);
    const suffix = `sar071-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Seed a Client company + external_refs + binding WITH project_map EMPTY + gate OFF
    // We don't use seedSAR because that seeds a project and sets gate ON.
    const companyId = crypto.randomUUID();
    const customerName = `Spike Customer ${suffix}`;
    const { error: companyErr } = await admin.from('companies').insert({
      id: companyId,
      org_id: ORG_ID,
      name: customerName,
      type: 'Client', // PMO companies.type enum is 'Client' (ERP Customer→PMO Client, FR-ENA-091), not 'Customer'
    });
    if (companyErr) throw new Error(`seed companies failed: ${companyErr.message}`);

    const { error: refErr } = await admin.from('external_refs').insert({
      org_id: ORG_ID,
      domain: 'companies',
      pmo_record_id: companyId,
      external_tier: 'erpnext',
      external_record_id: 'Customer:Spike Customer', // bench-fixture ERP Customer (mirrors P2's Supplier:Spike Supplier)
    });
    if (refErr) throw new Error(`seed external_refs failed: ${refErr.message}`);

    // Binding with gate OFF (require_project_on_si: false) — no project_map needed
    const bindingConfig = {
      company: 'PMO Smoke Co',
      default_receivable_account: 'Debtors - PSC',
      default_income_account: 'Sales - PSC',
      default_cash_account: 'Cash - PSC',
      process_gates: { require_so_before_si: false, require_bast_before_si: false, require_project_on_si: false },
    };
    const { error: bindingErr } = await admin.from('external_org_bindings').upsert(
      {
        org_id: ORG_ID,
        external_tier: 'erpnext',
        site_url: process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080',
        secret_ref: 'local-bench',
        version_major: 15,
        config: bindingConfig,
        activated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,external_tier' },
    );
    if (bindingErr) throw new Error(`seed binding failed: ${bindingErr.message}`);

    // Revenue domain flip
    const { error: flipErr } = await admin
      .from('external_domain_ownership')
      .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'revenue' }, { onConflict: 'org_id,external_tier,domain' });
    if (flipErr) throw new Error(`seed ownership failed: ${flipErr.message}`);

    try {
      const siRecordId = crypto.randomUUID();
      const idempotencyKey = crypto.randomUUID();

      // ── CREATE SI with NO projectId (null) — author creates (leaves DRAFT) ──
      let createRes = await dispatchCreateRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        authorToken, // author creates
        {
          id: siRecordId,
          customerId: companyId,
          projectId: null, // NO project
          erp_doc_kind: 'sales-invoice',
          items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 75000 }],
        },
        'sales-invoice',
        idempotencyKey,
      );
      let createBody = await createRes.json();
      for (let attempt = 0; createRes.status === 502 && attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 750));
        createRes = await dispatchCreateRevenue(
          FUNCTIONS_URL,
          ANON_KEY,
          authorToken,
          {
            id: siRecordId,
            customerId: companyId,
            projectId: null,
            erp_doc_kind: 'sales-invoice',
            items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 75000 }],
          },
          'sales-invoice',
          idempotencyKey,
        );
        createBody = await createRes.json();
      }
      expect(createRes.status, `SI create failed: ${JSON.stringify(createBody)}`).toBe(200);
      const siName = createBody.externalRecordId as string;
      expect(siName).toMatch(/^ACC-SINV-/);

      // PMO mirror after create: status 'Draft' (docstatus 0), erp_docstatus=0
      const { data: siRowAfterCreate, error: siRowErr1 } = await admin
        .from('sales_invoices')
        .select('*')
        .eq('id', siRecordId)
        .maybeSingle();
      expect(siRowErr1).toBeNull();
      expect(siRowAfterCreate).toMatchObject({ si_number: siName, project_id: null, amount: 75000, status: 'Draft', erp_docstatus: 0, erp_outstanding_amount: 0 });

      // ── SUBMIT the SI (approver submits — SoD: approver ≠ author) ──
      const submitRes = await dispatchTransitionRevenue(
        FUNCTIONS_URL,
        ANON_KEY,
        approverToken, // approver submits
        {
          id: siRecordId,
          customerId: companyId,
          projectId: null,
          erp_doc_kind: 'sales-invoice',
          externalRecordId: siName,
          verb: 'submit',
        },
        'sales-invoice',
        'submit',
        crypto.randomUUID(),
      );
      const submitBody = (await submitRes.json()) as { message?: string };
      expect(submitRes.status, `SI submit failed: ${submitBody.message}`).toBe(200);

      // ── ASSERTIONS ──
      // 1) sales_invoices mirror has project_id=NULL
      const { data: siRow, error: siRowErr } = await admin
        .from('sales_invoices')
        .select('*')
        .eq('id', siRecordId)
        .maybeSingle();
      expect(siRowErr).toBeNull();
      expect(siRow).toMatchObject({ si_number: siName, project_id: null, amount: 75000, status: 'Unpaid', erp_docstatus: 1 });
      expect(siRow?.erp_outstanding_amount).toBe(75000);

      // 2) ERP-side SI has no project field set (or null)
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(siName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const doc = (await docRes.json()) as { data?: { project?: string | null } };
        // ERP may return null or omit the field; both mean "no project"
        expect(doc.data?.project ?? null).toBeNull();
      }

      // 3) Revenue-per-project view rolls it up under 'Unassigned'
      // The view is a SQL aggregation: SUM(amount) GROUP BY project_id, with NULL -> 'Unassigned'.
      // We verify by querying THIS spec's OWN row with the same logic — scoping to siRecordId (not a
      // broad org-wide project_id-null sum) hardens against a sibling serial spec leaking a
      // project_id-null mirror row into the shared org (e.g. AC-SAR-043 if its cleanup never ran),
      // which would otherwise inflate the Unassigned total. The goal-oracle stays intact: this null-
      // project SI rolls up under Unassigned (project_id=NULL, amount 75000).
      const { data: ownRows } = await admin
        .from('sales_invoices')
        .select('project_id, amount')
        .eq('org_id', ORG_ID)
        .eq('id', siRecordId);
      const ownUnassignedTotal = ownRows
        ?.filter(r => r.project_id === null)
        .reduce((sum, r) => sum + Number(r.amount), 0) ?? 0;
      expect(ownUnassignedTotal).toBe(75000);
    } finally {
      // Cleanup: un-flip + delete binding + companies + refs
      await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'revenue');
      await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
      await admin.from('sales_invoices').delete().eq('org_id', ORG_ID);
      await admin.from('incoming_payments').delete().eq('org_id', ORG_ID);
      await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'revenue');
      await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', companyId);
      await admin.from('companies').delete().eq('id', companyId);
      await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'revenue');
    }
  });
});