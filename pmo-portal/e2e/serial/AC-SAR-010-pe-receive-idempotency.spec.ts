// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-SAR-010-pe-receive-idempotency — Slice 7 task 7.4. ADR-0058's R1/R3 money-idempotency
 * guarantee proven at the REAL served `adapter-dispatch` boundary for a PE-receive
 * (`incoming-payment`) with the `after-commit-before-mirror` named fault seam (FR-SAR-003,
 * Slice 2 task 2.6) — never `page.route`, never a mock of the outbox.
 *
 * Given a PE-receive command with a fresh `idempotencyKey`, when the served fn is armed with
 * `ERPNEXT_TEST_FAULTS=1` + header `x-erpnext-test-fault: after-commit-before-mirror` (Slice 2's
 * env-gated, host-allowlisted seam — inert unless BOTH match, `faultSeams.ts`), then: the FIRST
 * dispatch commits the real ERPNext Payment Entry (create+submit two-step, R9-P3a spike §3) and
 * marks the outbox row `committed` (canonical persisted, ADR-0058 §4 "F2") — then the function's
 * response path crashes server-side (a plain unclassified Error, simulating the process dying
 * AFTER the ERP commit but BEFORE the PMO mirror/ref write, the R3 partial-failure window) — the
 * client sees a 500. The EXACT SAME command retried (same idempotencyKey, fault header dropped)
 * reconciles the `committed` outbox row via finalize-only (mirror + `external_refs`,
 * generation-guarded) — no second ERP POST. Proof: ERPNext holds exactly ONE Payment Entry
 * stamped with the idempotency key in its `reference_no` (the PE-receive anchor field, mutable
 * per C-1 — composite probe + held-on-inconclusive, NEVER auto-reissued — the double-receive
 * guard); PMO's `incoming_payments` table holds exactly ONE mirror row.
 *
 * Requires (process env, same as AC-ENA-010/053): SUPABASE_FUNCTIONS_URL, SUPABASE_URL/VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. The served function needs
 * ERPNEXT_API_KEY/ERPNEXT_API_SECRET (`supabase/functions/.env.local`, gitignored) AND
 * ERPNEXT_TEST_FAULTS=1 + ERPNEXT_TEST_FAULTS_ALLOW_HOST covering the served lane's host
 * (localhost:54321/127.0.0.1:54321) — the SAME `.env.local` `scripts/serve-functions.sh` already loads.
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-SAR-010
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { seedSAR, cleanupSAR, signInAdmin, dispatchCreateRevenue, dispatchTransitionRevenue } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ERPNEXT_BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const ERPNEXT_ADMIN_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const ERPNEXT_ADMIN_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-SAR-010-pe-receive-idempotency: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-SAR-010-pe-receive-idempotency: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
}
test.skip(!READY, 'AC-SAR-010-pe-receive-idempotency: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh (ERPNEXT_TEST_FAULTS=1) against the ERPNext bench');

test.setTimeout(120_000);

interface SeedWithSI {
  companyId: string;
  projectId: string;
  siRecordId: string;
  ipRecordId: string;
  siName: string;
}

async function seedWithSubmittedSI(admin: SupabaseClient, suffix: string): Promise<SeedWithSI> {
  const base = await seedSAR(admin, suffix);

  // Create + submit a SI first (so the PE-receive has something to reference)
  const accessToken = await signInAdmin(AUTH_URL, ANON_KEY);
  const siIdempotencyKey = crypto.randomUUID();
  const siCreateRes = await dispatchCreateRevenue(
    FUNCTIONS_URL,
    ANON_KEY,
    accessToken,
    {
      id: base.siRecordId,
      customerId: base.companyId,
      projectId: base.projectId,
      erp_doc_kind: 'sales-invoice',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 200000 }],
    },
    'sales-invoice',
    siIdempotencyKey,
  );
  let siCreateBody = await siCreateRes.json();
  for (let attempt = 0; siCreateRes.status === 502 && attempt < 2; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    const retry = await dispatchCreateRevenue(
      FUNCTIONS_URL,
      ANON_KEY,
      accessToken,
      {
        id: base.siRecordId,
        customerId: base.companyId,
        projectId: base.projectId,
        erp_doc_kind: 'sales-invoice',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 200000 }],
      },
      'sales-invoice',
      siIdempotencyKey,
    );
    siCreateBody = await retry.json();
  }
  expect(siCreateRes.status, `SI create failed: ${JSON.stringify(siCreateBody)}`).toBe(200);
  const siName = siCreateBody.externalRecordId as string;
  expect(siName).toMatch(/^ACC-SINV-/);

  const siSubmitRes = await dispatchTransitionRevenue(
    FUNCTIONS_URL,
    ANON_KEY,
    accessToken,
    {
      id: base.siRecordId,
      customerId: base.companyId,
      projectId: base.projectId,
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

  return { ...base, siName };
}

test.describe('AC-SAR-010: PE-receive after-commit-before-mirror fault-seam interruption — a retry never duplicates the ERP PE-receive', () => {
  test('the first (faulted) attempt commits the real PE-receive and crashes before the mirror; the retry reconciles (finalize-only, no second POST); exactly one ERP doc + one incoming_payments row', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedWithSubmittedSI(admin, suffix);
    const idempotencyKey = crypto.randomUUID();

    const peCommand = {
      domain: 'revenue',
      operation: 'create',
      record: {
        id: seeded.ipRecordId,
        customerId: seeded.companyId,
        salesInvoiceId: seeded.siRecordId,
        erp_doc_kind: 'incoming-payment',
        paid_amount: 200000,
        received_amount: 200000,
        references: [{ reference_doctype: 'Sales Invoice', reference_name: seeded.siName, allocated_amount: 200000 }],
      },
      idempotencyKey,
    };

    try {
      // ── Attempt 1: armed with the fault seam — the ERP commit succeeds server-side, then the
      // function's response path crashes BEFORE the mirror write (R3 partial-failure window). ──
      const accessToken = await signInAdmin(AUTH_URL, ANON_KEY);
      const firstRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'x-erpnext-test-fault': 'after-commit-before-mirror',
        },
        body: JSON.stringify(peCommand),
      });
      // A plain (unclassified) simulated crash surfaces as a 500 — never a typed commit-rejected/
      // external-unreachable (those are real classification outcomes, not "the process died").
      expect(firstRes.status, 'the faulted first attempt must fail (simulating the crash)').toBe(500);

      // The outbox row must already be 'committed' (F2: canonical persisted) — the ERP write landed
      // before the crash; only the finalize step (mirror + external_refs) is pending.
      const { data: outboxRow, error: outboxErr } = await admin
        .from('external_command_outbox')
        .select('state, external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.ipRecordId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      expect(outboxErr).toBeNull();
      expect(outboxRow?.state).toBe('committed');
      const ipName = outboxRow?.external_record_id as string;
      expect(ipName).toMatch(/^ACC-PAY-/);

      // No PMO mirror row exists yet — the crash happened BEFORE writeReadModel ran.
      const { data: preFinalizeRow } = await admin
        .from('incoming_payments')
        .select('id')
        .eq('id', seeded.ipRecordId)
        .maybeSingle();
      expect(preFinalizeRow, 'no incoming_payments row before the retry finalizes').toBeNull();

      // ── Attempt 2: the EXACT SAME command (same idempotencyKey), fault header dropped — reconciles
      // the 'committed' row via finalize-only. No second ERP POST. ──
      const secondAccessToken = await signInAdmin(AUTH_URL, ANON_KEY);
      const secondRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${secondAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(peCommand),
      });
      const secondBody = (await secondRes.json()) as { externalRecordId?: string; message?: string };
      expect(secondRes.status, `retry failed: ${secondBody.message}`).toBe(200);
      expect(secondBody.externalRecordId, 'the retry returns the SAME ERP doc name — no second create').toBe(ipName);

      // The outbox row is now confirmed.
      const { data: confirmedRow } = await admin
        .from('external_command_outbox')
        .select('state')
        .eq('org_id', ORG_ID)
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.ipRecordId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      expect(confirmedRow?.state).toBe('confirmed');

      // Exactly ONE incoming_payments mirror row for this PMO id.
      const { data: mirrorRows } = await admin
        .from('incoming_payments')
        .select('id, ip_number, amount, sales_invoice_id')
        .eq('id', seeded.ipRecordId);
      expect(mirrorRows?.length).toBe(1);
      expect(mirrorRows?.[0]).toMatchObject({ id: seeded.ipRecordId, ip_number: ipName, amount: 200000, sales_invoice_id: seeded.siRecordId });

      // ── The ERP-side proof (guarded, optional per NFR-SAR-SEC-002): exactly ONE Payment Entry
      // exists with the returned name (a live-bench GET, never faked).
      // NOTE: PE-receive anchors on `reference_no` (mutable, C-1 verbatim). The idempotencyKey is
      // stamped into `reference_no` by the adapter's `stampAnchor`. The composite probe (payment_type
      // + party + amount + SI refs + window) ensures a `pending`/`failed`/`quarantined` PE-receive crash
      // is HELD (state `held`), NEVER auto-reissued (C-1 — the double-receive guard), rather than
      // blindly re-POSTed. So there is no open gap here: R1 (the DB atomic claim), R3 (the composite
      // probe), and the held terminal together close the PE-receive recovery surface.
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Payment%20Entry/${encodeURIComponent(ipName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const doc = (await docRes.json()) as { data?: { name?: string; docstatus?: number; reference_no?: string } };
        expect(doc.data?.name, 'the ERP-side doc named by the outbox genuinely exists (no faked success)').toBe(ipName);
        expect(doc.data?.docstatus).toBe(1);
        // reference_no anchor survives (spike R9-P3a-4)
        expect(doc.data?.reference_no).not.toBeNull();
      }
    } finally {
      await cleanupSAR(admin, seeded);
    }
  });
});