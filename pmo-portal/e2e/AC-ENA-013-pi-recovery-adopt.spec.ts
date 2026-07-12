/**
 * AC-ENA-013-pi-recovery-adopt — Slice 6 task 6.8. ADR-0057's R3 post-commit mirror-failure recovery
 * proven at the REAL served `adapter-dispatch` boundary for a Purchase Invoice (the PI counterpart of
 * AC-ENA-010's PE proof) with the `after-commit-before-mirror` named fault seam (FR-ENA-003).
 *
 * Given a PI command with a fresh `idempotencyKey`, when the served fn is armed with
 * `ERPNEXT_TEST_FAULTS=1` + header `x-erpnext-test-fault: after-commit-before-mirror`, then: the FIRST
 * dispatch commits the real ERPNext PI (create+submit two-step, R9 §1) and marks the outbox row
 * `committed` (canonical persisted, ADR-0057 §4 "F2") — then the function's response path crashes
 * server-side (simulating the process dying AFTER the ERP commit but BEFORE the PMO mirror/ref write,
 * the R3 partial-failure window) — the client sees a 500. The EXACT SAME command retried (same
 * idempotencyKey, fault header dropped) reconciles the `committed` outbox row via finalize-only
 * (mirror + `external_refs`, generation-guarded) — no second ERP POST. Proof: ERPNext holds exactly
 * ONE Purchase Invoice stamped with the idempotency key in its `remarks` (the PI anchor field, ADR-0057
 * §3 — live-verified the key survives); PMO's `procurement_invoices` table holds exactly ONE mirror row.
 *
 * Requires (process env, same as AC-ENA-010/053): SUPABASE_FUNCTIONS_URL, SUPABASE_URL/VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. The served function needs
 * ERPNEXT_API_KEY/ERPNEXT_API_SECRET (`supabase/functions/.env.local`, gitignored) AND
 * ERPNEXT_TEST_FAULTS=1 + ERPNEXT_TEST_FAULTS_ALLOW_HOST covering the served lane's host.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-ENA-013
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
  throw new Error('AC-ENA-013-pi-recovery-adopt: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-ENA-013-pi-recovery-adopt: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
}
test.skip(!READY, 'AC-ENA-013-pi-recovery-adopt: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh (ERPNEXT_TEST_FAULTS=1) against the ERPNext bench');

test.setTimeout(120_000);

interface Seed {
  companyId: string;
  procurementId: string;
  piRecordId: string;
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
    .insert({ org_id: ORG_ID, title: `AC-ENA-013 case ${suffix}`, vendor_id: companyId, status: 'Ordered' })
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

  return { companyId, procurementId, piRecordId: crypto.randomUUID() };
}

async function cleanup(admin: SupabaseClient, seeded: Seed): Promise<void> {
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'procurement');
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.piRecordId);
  await admin.from('procurement_invoices').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('procurements').delete().eq('id', seeded.procurementId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', seeded.companyId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.piRecordId);
  await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('pmo_record_id', seeded.piRecordId);
  await admin.from('companies').delete().eq('id', seeded.companyId);
}

test.describe('AC-ENA-013: PI after-commit-before-mirror fault-seam interruption — a retry never duplicates the ERP PI', () => {
  test('the first (faulted) attempt commits the real PI and crashes before the mirror; the retry reconciles (finalize-only, no second POST); exactly one ERP doc + one procurement_invoices row', async () => {
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
        id: seeded.piRecordId,
        procurementId: seeded.procurementId,
        vendorId: seeded.companyId,
        erp_doc_kind: 'purchase-invoice',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 90000 }],
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
      expect(firstRes.status, 'the faulted first attempt must fail (simulating the crash)').toBe(500);

      // The outbox row must already be 'committed' (F2: canonical persisted) — the ERP write landed
      // before the crash; only the finalize step (mirror + external_refs) is pending.
      const { data: outboxRow, error: outboxErr } = await admin
        .from('external_command_outbox')
        .select('state, external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', seeded.piRecordId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      expect(outboxErr).toBeNull();
      expect(outboxRow?.state).toBe('committed');
      const piName = outboxRow?.external_record_id as string;
      expect(piName).toMatch(/^ACC-PINV-/);

      // No PMO mirror row exists yet — the crash happened BEFORE writeReadModel ran.
      const { data: preFinalizeRow } = await admin.from('procurement_invoices').select('id').eq('id', seeded.piRecordId).maybeSingle();
      expect(preFinalizeRow, 'no procurement_invoices row before the retry finalizes').toBeNull();

      // ── Attempt 2: the EXACT SAME command (same idempotencyKey), fault header dropped — reconciles
      // the 'committed' row via finalize-only. No second ERP POST. ──
      const secondRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const secondBody = (await secondRes.json()) as { externalRecordId?: string; message?: string };
      expect(secondRes.status, `retry failed: ${secondBody.message}`).toBe(200);
      expect(secondBody.externalRecordId, 'the retry returns the SAME ERP doc name — no second create').toBe(piName);

      // The outbox row is now confirmed.
      const { data: confirmedRow } = await admin
        .from('external_command_outbox')
        .select('state')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', seeded.piRecordId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      expect(confirmedRow?.state).toBe('confirmed');

      // Exactly ONE procurement_invoices mirror row for this case.
      const { data: mirrorRows } = await admin.from('procurement_invoices').select('id, vi_number, amount').eq('procurement_id', seeded.procurementId);
      expect(mirrorRows?.length).toBe(1);
      expect(mirrorRows?.[0]).toMatchObject({ id: seeded.piRecordId, vi_number: piName, amount: 90000 });

      // ── The ERP-side proof (guarded, optional per NFR-ENA-SEC-002): exactly ONE Purchase Invoice
      // exists with the returned name AND the PI `remarks` anchor (ADR-0057 §3) carries the stamped
      // idempotency key — the live proof that the PI remarks-anchor survives validate+submit+refetch
      // and the recovery probe's filter would find it (R3). ──
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const docRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const doc = (await docRes.json()) as { data?: { name?: string; docstatus?: number; remarks?: string } };
        expect(doc.data?.name, 'the ERP-side PI genuinely exists (no faked success)').toBe(piName);
        expect(doc.data?.docstatus).toBe(1);
        expect(doc.data?.remarks, 'the PI remarks anchor carries the stamped idempotency key (survived validate+submit)').toBe(idempotencyKey);
      }
    } finally {
      await cleanup(admin, seeded);
    }
  });
});
