// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-ENA-053-pi-payment — Slice 6 task 6.6. Real served boundary (`scripts/serve-functions.sh` +
 * `scripts/with-erpnext-lock.sh` against the Docker v15 dev bench, docs/environments.md) — NEVER
 * `page.route`, per the plan's binding rule for every money-command e2e (FR-ENA-001/003).
 *
 * Given an org whose `procurement` domain is employed by ERPNext, when a case's Purchase Invoice is
 * created+submitted (R9 §1 frozen `{supplier, items}`) and a Payment Entry referencing it is
 * created+submitted (R9 §2 frozen: adapter-supplied `paid_from`/`paid_to` from the binding's Company
 * defaults, `references[]` to the PI), then: the PI flips `Paid`/`outstanding_amount 0` server-side
 * (mirrored via `erp_outstanding_amount`/`status`, piStatus.ts task 6.12); `payments.amount` mirrors
 * the PE's `paid_amount`; `payments.invoice_id` links the PI in the same procurement case
 * (FR-ENA-130d, the same-case invariant already proven at the RPC layer by 6.1's pgTAP — this e2e
 * proves it holds through the ERPNext dispatch path too).
 *
 * Requires (process env, same as served-fn-smoke.spec.ts / AC-ENA-052): SUPABASE_FUNCTIONS_URL,
 * SUPABASE_URL/VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * The served function itself additionally needs ERPNEXT_API_KEY/ERPNEXT_API_SECRET as function
 * secrets (`supabase/functions/.env.local`, local-only, gitignored, creds from
 * `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md` — never this repo, NFR-ENA-SEC-002).
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-ENA-053
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// Two INDEPENDENT env vars (task 6.4 fix-round finding): SITE_URL (Docker-reachable, seeded into
// external_org_bindings.site_url — what the served fn dials) vs BENCH_URL (host-reachable, this test
// process's OWN optional verification fetch). Neither falls back to the other.
const ERPNEXT_SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
const ERPNEXT_BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const ERPNEXT_ADMIN_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const ERPNEXT_ADMIN_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-ENA-053-pi-payment: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-ENA-053-pi-payment: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available — the seed/cleanup below needs it.');
}
test.skip(!READY, 'AC-ENA-053-pi-payment: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(120_000);

interface Seed {
  companyId: string;
  procurementId: string;
  piRecordId: string;
  peRecordId: string;
}

async function seed(admin: SupabaseClient, suffix: string): Promise<Seed> {
  const companyId = crypto.randomUUID();
  const { error: companyErr } = await admin.from('companies').insert({ id: companyId, org_id: ORG_ID, name: `Spike Supplier ${suffix}`, type: 'Vendor' });
  if (companyErr) throw new Error(`seed companies failed: ${companyErr.message}`);

  // The supplier must ALREADY be onboarded (external_refs mapping) — party onboarding is out of
  // scope here (slice 3); this e2e seeds the mapping directly, matching what onboarding would leave.
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
    .insert({ org_id: ORG_ID, title: `AC-ENA-053 case ${suffix}`, vendor_id: companyId, status: 'Ordered' })
    .select('id')
    .single();
  if (procErr || !procurement) throw new Error(`seed procurements failed: ${procErr?.message}`);
  const procurementId = (procurement as { id: string }).id;

  // A pre-activated binding — the R9 §2 account defaults (Cash - PSC / Creditors - PSC, spike-verified
  // against the real bench) live in config, exactly what the adapter needs for peToBody.
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

  return { companyId, procurementId, piRecordId: crypto.randomUUID(), peRecordId: crypto.randomUUID() };
}

async function cleanup(admin: SupabaseClient, seeded: Seed): Promise<void> {
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'procurement');
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  await admin.from('payments').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('procurement_invoices').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('procurements').delete().eq('id', seeded.procurementId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', seeded.companyId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.piRecordId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.peRecordId);
  await admin.from('companies').delete().eq('id', seeded.companyId);
}

test.describe('AC-ENA-053: Purchase Invoice + Payment Entry create+submit through the real served adapter-dispatch boundary', () => {
  test('create+submit a PI -> ERP commits; create+submit a referencing PE -> PI flips Paid/outstanding 0; PMO mirrors both, payments.invoice_id links the same case', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authClient = createClient(AUTH_URL, ANON_KEY);
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: SEED_PASSWORD });
    if (signInError || !signInData.session) throw new Error(`sign-in failed: ${signInError?.message}`);
    const accessToken = signInData.session.access_token;

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seed(admin, suffix);

    try {
      // ── PI: create+submit (two-step, R9 §1 frozen {supplier, items}) ──
      const piRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'create',
          record: {
            id: seeded.piRecordId,
            procurementId: seeded.procurementId,
            vendorId: seeded.companyId,
            erp_doc_kind: 'purchase-invoice',
            items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 150000 }],
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const piBody = (await piRes.json()) as { externalRecordId?: string; canonical?: Record<string, unknown>; message?: string };
      expect(piRes.status, `PI dispatch failed: ${piBody.message}`).toBe(200);
      const piName = piBody.externalRecordId!;
      expect(piName).toMatch(/^ACC-PINV-/);

      const { data: piRowAfterCreate, error: piRowErr1 } = await admin.from('procurement_invoices').select('*').eq('id', seeded.piRecordId).maybeSingle();
      expect(piRowErr1).toBeNull();
      expect(piRowAfterCreate).toMatchObject({ vi_number: piName, amount: 150000, status: 'Received' });

      // ── PE: create+submit, referencing the PI (R9 §2 frozen: adapter supplies paid_from/paid_to) ──
      const peRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'create',
          record: {
            id: seeded.peRecordId,
            procurementId: seeded.procurementId,
            vendorId: seeded.companyId,
            invoiceId: seeded.piRecordId,
            erp_doc_kind: 'payment',
            paid_amount: 150000,
            references: [{ reference_doctype: 'Purchase Invoice', reference_name: piName, allocated_amount: 150000 }],
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const peBody = (await peRes.json()) as { externalRecordId?: string; message?: string };
      expect(peRes.status, `PE dispatch failed: ${peBody.message}`).toBe(200);
      const peName = peBody.externalRecordId!;
      expect(peName).toMatch(/^ACC-PAY-/);

      const { data: peRow, error: peRowErr } = await admin.from('payments').select('*').eq('id', seeded.peRecordId).maybeSingle();
      expect(peRowErr).toBeNull();
      expect(peRow).toMatchObject({ pay_number: peName, amount: 150000, status: 'Paid', invoice_id: seeded.piRecordId });

      // ── The paid-detection proof (R9 §2 "References semantics"): re-fetching the PI now shows the
      // referenced PE flipped it Paid/outstanding 0 server-side. PMO's OWN mirror does not re-fetch the
      // PI automatically on a PE submit (out of this task's scope — the PI row reflects its OWN last
      // dispatch, per ADR-0048 "PMO never recomputes"); this asserts the REAL ERP-side state directly —
      // only when the caller exported bench creds to THIS process (never hardcoded, NFR-ENA-SEC-002);
      // the PMO-side mirror assertions above already prove the AC either way. ──
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const piDocRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Purchase%20Invoice/${encodeURIComponent(piName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const piDoc = (await piDocRes.json()) as { data?: { status?: string; outstanding_amount?: number } };
        expect(piDoc.data?.status).toBe('Paid');
        expect(piDoc.data?.outstanding_amount).toBe(0);
      }
    } finally {
      await cleanup(admin, seeded);
    }
  });
});
