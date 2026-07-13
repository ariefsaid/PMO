// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-ENA-010-payment-idempotency — Slice 6 task 6.7. ADR-0058's R1/R3 money-idempotency guarantee
 * proven at the REAL served `adapter-dispatch` boundary with the `after-commit-before-mirror` named
 * fault seam (FR-ENA-003, Slice 0 task 0.7) — never `page.route`, never a mock of the outbox.
 *
 * Given a Payment Entry command with a fresh `idempotencyKey`, when the served fn is armed with
 * `ERPNEXT_TEST_FAULTS=1` + header `x-erpnext-test-fault: after-commit-before-mirror` (Slice 0's
 * env-gated, host-allowlisted seam — inert unless BOTH match, faultSeams.ts), then: the FIRST dispatch
 * commits the real ERPNext Payment Entry (create+submit two-step, R9 §2) and marks the outbox row
 * `committed` (canonical persisted, ADR-0058 §4 "F2") — then the function's response path crashes
 * server-side (a plain unclassified Error, simulating the process dying AFTER the ERP commit but
 * BEFORE the PMO mirror/ref write, the R3 partial-failure window) — the client sees a 500. The EXACT
 * SAME command retried (same idempotencyKey, fault header dropped) reconciles the `committed` outbox
 * row via finalize-only (mirror + `external_refs`, generation-guarded) — no second ERP POST. Proof:
 * ERPNext holds exactly ONE Payment Entry stamped with the idempotency key (the `remarks`-key probe
 * anchor, live-queried directly); PMO's `payments` table holds exactly ONE mirror row.
 *
 * Requires (process env, same as AC-ENA-053): SUPABASE_FUNCTIONS_URL, SUPABASE_URL/VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. The served function needs
 * ERPNEXT_API_KEY/ERPNEXT_API_SECRET (`supabase/functions/.env.local`, gitignored) AND
 * ERPNEXT_TEST_FAULTS=1 + ERPNEXT_TEST_FAULTS_ALLOW_HOST covering the served lane's host (localhost:
 * 54321/127.0.0.1:54321) — the SAME `.env.local` `scripts/serve-functions.sh` already loads.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-ENA-010
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ERPNEXT_SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
const ERPNEXT_BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const ERPNEXT_ADMIN_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const ERPNEXT_ADMIN_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-ENA-010-payment-idempotency: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-ENA-010-payment-idempotency: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
}
test.skip(!READY, 'AC-ENA-010-payment-idempotency: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh (ERPNEXT_TEST_FAULTS=1) against the ERPNext bench');

test.setTimeout(120_000);

interface Seed {
  companyId: string;
  procurementId: string;
  peRecordId: string;
}

async function seed(admin: SupabaseClient, suffix: string): Promise<Seed> {
  const companyId = crypto.randomUUID();
  const { error: companyErr } = await admin.from('companies').insert({ id: companyId, org_id: ORG_ID, name: `Spike Supplier ${suffix}`, type: 'Vendor' });
  if (companyErr) throw new Error(`seed companies failed: ${companyErr.message}`);

  const { error: refErr } = await admin.from('external_refs').insert({
    org_id: ORG_ID,
    domain: 'companies',
    pmo_record_id: companyId,
    external_tier: 'erpnext',
    external_record_id: 'Supplier:Spike Supplier',
  });
  if (refErr) throw new Error(`seed external_refs (companies) failed: ${refErr.message}`);

  const { data: procurement, error: procErr } = await admin
    .from('procurements')
    .insert({ org_id: ORG_ID, title: `AC-ENA-010 case ${suffix}`, vendor_id: companyId, status: 'Ordered' })
    .select('id')
    .single();
  if (procErr || !procurement) throw new Error(`seed procurements failed: ${procErr?.message}`);
  const procurementId = (procurement as { id: string }).id;

  const { error: bindingErr } = await admin.from('external_org_bindings').upsert(
    {
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: ERPNEXT_SITE_URL,
      secret_ref: 'local-bench',
      version_major: 15,
      config: { company: 'PMO Smoke Co', default_cash_account: 'Cash - PSC', default_payable_account: 'Creditors - PSC' },
      activated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,external_tier' },
  );
  if (bindingErr) throw new Error(`seed external_org_bindings failed: ${bindingErr.message}`);

  const { error: flipErr } = await admin
    .from('external_domain_ownership')
    .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'procurement' }, { onConflict: 'org_id,external_tier,domain' });
  if (flipErr) throw new Error(`seed external_domain_ownership failed: ${flipErr.message}`);

  return { companyId, procurementId, peRecordId: crypto.randomUUID() };
}

async function cleanup(admin: SupabaseClient, seeded: Seed): Promise<void> {
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'procurement');
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  await admin.from('payments').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('procurements').delete().eq('id', seeded.procurementId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', seeded.companyId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.peRecordId);
  await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('pmo_record_id', seeded.peRecordId);
  await admin.from('companies').delete().eq('id', seeded.companyId);
}

test.describe('AC-ENA-010: after-commit-before-mirror fault-seam interruption — a retry never duplicates the ERP money doc', () => {
  test('the first (faulted) attempt commits the real PE and crashes before the mirror; the retry reconciles (finalize-only, no second POST); exactly one ERP doc + one payments row', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authClient = createClient(AUTH_URL, ANON_KEY);
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: SEED_PASSWORD });
    if (signInError || !signInData.session) throw new Error(`sign-in failed: ${signInError?.message}`);
    const accessToken = signInData.session.access_token;

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seed(admin, suffix);
    const idempotencyKey = crypto.randomUUID();

    const command = {
      domain: 'procurement',
      operation: 'create',
      record: {
        id: seeded.peRecordId,
        procurementId: seeded.procurementId,
        vendorId: seeded.companyId,
        erp_doc_kind: 'payment',
        paid_amount: 75000,
        references: [],
      },
      idempotencyKey,
    };

    try {
      // ── Attempt 1: armed with the fault seam — the ERP commit succeeds server-side, then the
      // function's response path crashes BEFORE the mirror write (R3 partial-failure window). ──
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
      // A plain (unclassified) simulated crash surfaces as a 500 — never a typed commit-rejected/
      // external-unreachable (those are real classification outcomes, not "the process died").
      expect(firstRes.status, 'the faulted first attempt must fail (simulating the crash)').toBe(500);

      // The outbox row must already be 'committed' (F2: canonical persisted) — the ERP write landed
      // before the crash; only the finalize step (mirror + external_refs) is pending.
      const { data: outboxRow, error: outboxErr } = await admin
        .from('external_command_outbox')
        .select('state, external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', seeded.peRecordId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      expect(outboxErr).toBeNull();
      expect(outboxRow?.state).toBe('committed');
      const peName = outboxRow?.external_record_id as string;
      expect(peName).toMatch(/^ACC-PAY-/);

      // No PMO mirror row exists yet — the crash happened BEFORE writeReadModel ran.
      const { data: preFinalizeRow } = await admin.from('payments').select('id').eq('id', seeded.peRecordId).maybeSingle();
      expect(preFinalizeRow, 'no payments row before the retry finalizes').toBeNull();

      // ── Attempt 2: the EXACT SAME command (same idempotencyKey), fault header dropped — reconciles
      // the 'committed' row via finalize-only. No second ERP POST. ──
      const secondRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const secondBody = (await secondRes.json()) as { externalRecordId?: string; message?: string };
      expect(secondRes.status, `retry failed: ${secondBody.message}`).toBe(200);
      expect(secondBody.externalRecordId, 'the retry returns the SAME ERP doc name — no second create').toBe(peName);

      // The outbox row is now confirmed.
      const { data: confirmedRow } = await admin
        .from('external_command_outbox')
        .select('state')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', seeded.peRecordId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      expect(confirmedRow?.state).toBe('confirmed');

      // Exactly ONE payments mirror row for this PMO id.
      const { data: mirrorRows } = await admin.from('payments').select('id, pay_number, amount').eq('procurement_id', seeded.procurementId);
      expect(mirrorRows?.length).toBe(1);
      expect(mirrorRows?.[0]).toMatchObject({ id: seeded.peRecordId, pay_number: peName, amount: 75000 });

      // ── The ERP-side proof (guarded, optional per NFR-ENA-SEC-002): exactly ONE Payment Entry
      // exists with the returned name (a live-bench GET, never faked). NOTE (the anchor decision has
      // LANDED — ADR-0058 §3 amended, live-bench-verified 2026-07-12/13): Payment Entry's `remarks` field
      // is SERVER-SIDE OVERWRITTEN by ERPNext's own `validate` hook on every save, so PE does NOT anchor
      // on `remarks`. Per the DIRECTOR RULING it anchors on `reference_no` (a native field PMO owns for
      // PMO-originated PEs, which SURVIVES validate+submit+refetch verbatim), and R3 orphan recovery for a
      // `pending`/`failed`/`quarantined` PE crash is a COMPOSITE DETERMINISTIC probe (`reference_no` OR the
      // party_type+party+paid_amount+PI-reference+creation-window conjunction, read from the outbox
      // payload). Because `reference_no` is ERP-side MUTABLE, an inconclusive post-window recovery is
      // HELD (state `held`), NEVER auto-reissued (C-1 — the double-pay guard), rather than blindly
      // re-POSTed. So there is no open gap here: R1 (the DB atomic claim), R3 (the composite probe), and
      // the held terminal together close the PE recovery surface. ──
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Payment%20Entry/${encodeURIComponent(peName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const doc = (await docRes.json()) as { data?: { name?: string; docstatus?: number } };
        expect(doc.data?.name, 'the ERP-side doc named by the outbox genuinely exists (no faked success)').toBe(peName);
        expect(doc.data?.docstatus).toBe(1);
      }
    } finally {
      await cleanup(admin, seeded);
    }
  });
});
