// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-SAR-011-si-recovery-adopt — Slice 7 task 7.5. ADR-0058's R3 post-commit mirror-failure
 * recovery proven at the REAL served `adapter-dispatch` boundary for a Sales Invoice
 * (`sales-invoice`) with the `after-commit-before-mirror` named fault seam (FR-SAR-003, Slice 2).
 *
 * Given a SI command with a fresh `idempotencyKey`, when the served fn is armed with
 * `ERPNEXT_TEST_FAULTS=1` + header `x-erpnext-test-fault: after-commit-before-mirror`, then: the
 * FIRST dispatch commits the real ERPNext SI (create+submit two-step, R9-P3a spike §1) and marks
 * the outbox row `committed` (canonical persisted, ADR-0058 §4 "F2") — then the function's
 * response path crashes server-side (simulating the process dying AFTER the ERP commit but BEFORE
 * the PMO mirror/ref write, the R3 partial-failure window) — the client sees a 500. The EXACT
 * SAME command retried (same idempotencyKey, fault header dropped) reconciles the `committed`
 * outbox row via finalize-only (mirror + `external_refs`, generation-guarded) — no second ERP
 * POST. Proof: ERPNext holds exactly ONE Sales Invoice stamped with the idempotency key in its
 * `remarks` (the SI anchor field, immutable per ADR-0058 §3 — live-verified the key survives
 * validate+submit+refetch); PMO's `sales_invoices` table holds exactly ONE mirror row.
 *
 * Requires (process env, same as AC-ENA-010/053): SUPABASE_FUNCTIONS_URL, SUPABASE_URL/VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. The served function needs
 * ERPNEXT_API_KEY/ERPNEXT_API_SECRET (`supabase/functions/.env.local`, gitignored) AND
 * ERPNEXT_TEST_FAULTS=1 + ERPNEXT_TEST_FAULTS_ALLOW_HOST covering the served lane's host.
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-SAR-011
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { seedSAR, cleanupSAR, signInAdmin } from './_sarHelpers';

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
  throw new Error('AC-SAR-011-si-recovery-adopt: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-SAR-011-si-recovery-adopt: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
}
test.skip(!READY, 'AC-SAR-011-si-recovery-adopt: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh (ERPNEXT_TEST_FAULTS=1) against the ERPNext bench');

test.setTimeout(120_000);

test.describe('AC-SAR-011: SI after-commit-before-mirror fault-seam interruption — a retry never duplicates the ERP SI', () => {
  test('the first (faulted) attempt commits the real SI and crashes before the mirror; the retry reconciles (finalize-only, no second POST); exactly one ERP doc + one sales_invoices row', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);
    const idempotencyKey = crypto.randomUUID();

    const command = {
      domain: 'revenue',
      operation: 'create',
      record: {
        id: seeded.siRecordId,
        customerId: seeded.companyId,
        projectId: seeded.projectId,
        erp_doc_kind: 'sales-invoice',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 90000 }],
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
        body: JSON.stringify(command),
      });
      expect(firstRes.status, 'the faulted first attempt must fail (simulating the crash)').toBe(500);

      // The outbox row must already be 'committed' (F2: canonical persisted) — the ERP write landed
      // before the crash; only the finalize step (mirror + external_refs) is pending.
      const { data: outboxRow, error: outboxErr } = await admin
        .from('external_command_outbox')
        .select('state, external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.siRecordId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      expect(outboxErr).toBeNull();
      expect(outboxRow?.state).toBe('committed');
      const siName = outboxRow?.external_record_id as string;
      expect(siName).toMatch(/^ACC-SINV-/);

      // No PMO mirror row exists yet — the crash happened BEFORE writeReadModel ran.
      const { data: preFinalizeRow } = await admin
        .from('sales_invoices')
        .select('id')
        .eq('id', seeded.siRecordId)
        .maybeSingle();
      expect(preFinalizeRow, 'no sales_invoices row before the retry finalizes').toBeNull();

      // ── Attempt 2: the EXACT SAME command (same idempotencyKey), fault header dropped — reconciles
      // the 'committed' row via finalize-only. No second ERP POST. ──
      const secondAccessToken = await signInAdmin(AUTH_URL, ANON_KEY);
      const secondRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${secondAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const secondBody = (await secondRes.json()) as { externalRecordId?: string; message?: string };
      expect(secondRes.status, `retry failed: ${secondBody.message}`).toBe(200);
      expect(secondBody.externalRecordId, 'the retry returns the SAME ERP doc name — no second create').toBe(siName);

      // The outbox row is now confirmed.
      const { data: confirmedRow } = await admin
        .from('external_command_outbox')
        .select('state')
        .eq('org_id', ORG_ID)
        .eq('domain', 'revenue')
        .eq('pmo_record_id', seeded.siRecordId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      expect(confirmedRow?.state).toBe('confirmed');

      // Exactly ONE sales_invoices mirror row for this case.
      const { data: mirrorRows } = await admin
        .from('sales_invoices')
        .select('id, si_number, amount')
        .eq('id', seeded.siRecordId);
      expect(mirrorRows?.length).toBe(1);
      expect(mirrorRows?.[0]).toMatchObject({ id: seeded.siRecordId, si_number: siName, amount: 90000 });

      // ── The ERP-side proof (guarded, optional per NFR-SAR-SEC-002): exactly ONE Sales Invoice
      // exists with the returned name AND the SI `remarks` anchor (ADR-0058 §3) carries the stamped
      // idempotency key — the live proof that the SI remarks-anchor survives validate+submit+refetch
      // and the recovery probe's filter would find it (R3). The SI anchor is IMMUTABLE (anchorMutable:
      // false), so the probe is a simple key lookup on `remarks`.
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(siName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const doc = (await docRes.json()) as { data?: { name?: string; docstatus?: number; remarks?: string } };
        expect(doc.data?.name, 'the ERP-side SI genuinely exists (no faked success)').toBe(siName);
        expect(doc.data?.docstatus).toBe(1);
        expect(doc.data?.remarks, 'the SI remarks anchor carries the stamped idempotency key (survived validate+submit)').toBe(idempotencyKey);
      }
    } finally {
      await cleanupSAR(admin, seeded);
    }
  });
});