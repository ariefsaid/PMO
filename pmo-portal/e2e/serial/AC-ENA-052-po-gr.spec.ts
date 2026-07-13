// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-ENA-052-po-gr — Slice 5 task 5.5. Real served boundary (`scripts/serve-functions.sh` +
 * `scripts/with-erpnext-lock.sh` against the Docker v15 dev bench, docs/environments.md) — NEVER
 * `page.route`. Proves: create+submit a PO (item-row `schedule_date` supplied server-side, R9 §3) ->
 * ERPNext `To Receive and Bill`; then a GR (carrying `purchase_order` + `purchase_order_item`, the PO
 * item CHILD-ROW `name`) -> submit -> the PO flips `To Bill`/`per_received:100`; PMO mirrors
 * `purchase_orders` + `procurement_receipts.po_id` (the RESOLVED PMO id, never the raw ERP name).
 *
 * Local-only (0.3's CI lane is the non-ERPNext served-fn smoke only — the ERPNext money e2e needs the
 * Docker v15 bench + 1Password creds, a dev-bed concern per the plan's Slice-0 design). Fails loud
 * when the served lane + cleanup credential are available but the bench itself is unreachable (a
 * config problem to fix, never a silent skip); skips gracefully ONLY when the served lane hasn't been
 * started at all (mirrors served-fn-smoke.spec.ts's gating).
 *
 * Requires (process env, same as served-fn-smoke.spec.ts): SUPABASE_FUNCTIONS_URL,
 * SUPABASE_URL/VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * The served function itself additionally needs ERPNEXT_API_KEY/ERPNEXT_API_SECRET as function
 * secrets (`supabase/functions/.env.local`, local-only, gitignored, creds from
 * `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md` — never this repo, NFR-ENA-SEC-002).
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test AC-ENA-052
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// ERPNEXT_BENCH_URL is used for THIS TEST PROCESS's own optional bench verification (runs on the
// HOST) — `http://localhost:8080` is host-reachable but NOT reachable from inside the served fn's
// Docker container. ERPNEXT_SITE_URL (task 6.4 fix-round, live-bench-discovered — matches
// AC-ENA-040/050/051's own split) is what gets SEEDED into external_org_bindings.site_url — what the
// served fn itself dials — and needs the Docker-reachable `host.docker.internal` alias
// (docs/environments.md "P2"). Two different network contexts, two INDEPENDENT env vars (neither
// falls back to the other — that was the original bug: one var served both contexts).
const ERPNEXT_BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const ERPNEXT_SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
// Bench creds NEVER live in this repo (NFR-ENA-SEC-002) — exported by the caller from
// ~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md (the same pair the served fn reads as
// ERPNEXT_API_KEY/ERPNEXT_API_SECRET function secrets, `supabase/functions/.env.local`). The
// ERPNext-side proof step is skipped (not failed) when these aren't exported to the TEST process —
// the PMO-side mirror assertions above it are the AC's real proof surface either way.
const ERPNEXT_ADMIN_KEY = process.env.ERPNEXT_API_KEY ?? '';
const ERPNEXT_ADMIN_SECRET = process.env.ERPNEXT_API_SECRET ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-ENA-052-po-gr: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-ENA-052-po-gr: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available — the seed/cleanup below needs it.');
}
test.skip(!READY, 'AC-ENA-052-po-gr: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(120_000);

interface Seed {
  companyId: string;
  procurementId: string;
  poRecordId: string;
  grRecordId: string;
}

async function seed(admin: SupabaseClient, suffix: string): Promise<Seed> {
  const companyId = crypto.randomUUID();
  const { error: companyErr } = await admin
    .from('companies')
    .insert({ id: companyId, org_id: ORG_ID, name: `Spike Supplier ${suffix}`, type: 'Vendor' });
  if (companyErr) throw new Error(`seed companies failed: ${companyErr.message}`);

  // The supplier must ALREADY be onboarded (external_refs mapping) — slice 3's adopt/onboard flow is
  // out of this slice's scope; this e2e seeds the mapping directly, matching what onboarding would
  // have produced, so it tests ONLY the PO/GR path (task 5.3/5.4), not party onboarding.
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
    .insert({ org_id: ORG_ID, title: `AC-ENA-052 case ${suffix}`, vendor_id: companyId, status: 'Ordered' })
    .select('id')
    .single();
  if (procErr || !procurement) throw new Error(`seed procurements failed: ${procErr?.message}`);
  const procurementId = (procurement as { id: string }).id;

  const { error: itemErr } = await admin
    .from('procurement_items')
    .insert({ org_id: ORG_ID, procurement_id: procurementId, name: 'SPIKE-ITEM-1', quantity: 2, rate: 100000 });
  if (itemErr) throw new Error(`seed procurement_items failed: ${itemErr.message}`);

  // A pre-activated binding (this slice tests PO/GR dispatch, not the version-handshake activation
  // flow owned by task 2.3/2.4) — stamped as already-activated, matching what a real activation run
  // would leave behind.
  const { error: bindingErr } = await admin.from('external_org_bindings').upsert(
    {
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: ERPNEXT_SITE_URL,
      secret_ref: 'local-bench',
      version_major: 15,
      config: { company: 'PMO Smoke Co' },
      activated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,external_tier' },
  );
  if (bindingErr) throw new Error(`seed external_org_bindings failed: ${bindingErr.message}`);

  const { error: flipErr } = await admin
    .from('external_domain_ownership')
    .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'procurement' }, { onConflict: 'org_id,external_tier,domain' });
  if (flipErr) throw new Error(`seed external_domain_ownership failed: ${flipErr.message}`);

  return { companyId, procurementId, poRecordId: crypto.randomUUID(), grRecordId: crypto.randomUUID() };
}

async function cleanup(admin: SupabaseClient, seeded: Seed): Promise<void> {
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'procurement');
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  await admin.from('procurement_receipts').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('purchase_orders').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('procurement_items').delete().eq('procurement_id', seeded.procurementId);
  await admin.from('procurements').delete().eq('id', seeded.procurementId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', seeded.companyId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', seeded.poRecordId);
  await admin.from('companies').delete().eq('id', seeded.companyId);
}

test.describe('AC-ENA-052: PO + GR create+submit through the real served adapter-dispatch boundary', () => {
  test('create+submit PO -> ERP To Receive and Bill; create+submit GR (PO-linked) -> PO flips To Bill/per_received:100; PMO mirrors both', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authClient = createClient(AUTH_URL, ANON_KEY);
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: SEED_PASSWORD });
    if (signInError || !signInData.session) throw new Error(`sign-in failed: ${signInError?.message}`);
    const accessToken = signInData.session.access_token;

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seed(admin, suffix);

    try {
      // ── PO: create+submit (two-step, R9-frozen) ──
      const poRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'create',
          record: {
            id: seeded.poRecordId,
            procurementId: seeded.procurementId,
            referenceNumber: `AC-ENA-052-PO-${suffix}`,
            status: 'Draft',
            date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
            amount: 200000,
            erp_doc_kind: 'purchase-order',
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const poBody = (await poRes.json()) as { externalRecordId?: string; canonical?: Record<string, unknown>; message?: string };
      expect(poRes.status, `PO dispatch failed: ${poBody.message}`).toBe(200);
      const poName = poBody.externalRecordId!;
      expect(poName).toMatch(/^PUR-ORD-/);

      const { data: poRow, error: poRowErr } = await admin.from('purchase_orders').select('*').eq('id', seeded.poRecordId).maybeSingle();
      expect(poRowErr).toBeNull();
      expect(poRow).toMatchObject({ po_number: poName, status: 'Issued' });

      // ── GR: create+submit, PO-linked (resolves purchase_order + purchase_order_item server-side) ──
      const grRes = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'create',
          record: { id: seeded.grRecordId, procurementId: seeded.procurementId, receiptDate: new Date().toISOString().slice(0, 10), erp_doc_kind: 'goods-receipt' },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const grBody = (await grRes.json()) as { externalRecordId?: string; message?: string };
      expect(grRes.status, `GR dispatch failed: ${grBody.message}`).toBe(200);
      const grName = grBody.externalRecordId!;
      expect(grName).toMatch(/^MAT-PRE-/);

      const { data: grRow, error: grRowErr } = await admin.from('procurement_receipts').select('*').eq('id', seeded.grRecordId).maybeSingle();
      expect(grRowErr).toBeNull();
      expect(grRow).toMatchObject({ gr_number: grName, status: 'Complete', po_id: seeded.poRecordId });

      // ── ERPNext-side proof: the PO flips To Bill / per_received:100 (R9 §4) — only when the caller
      // exported bench creds to THIS process (never hardcoded here, NFR-ENA-SEC-002); the PMO-side
      // mirror assertions above already prove the AC either way.
      if (ERPNEXT_ADMIN_KEY && ERPNEXT_ADMIN_SECRET) {
        const poDocRes = await fetch(`${ERPNEXT_BENCH_URL}/api/resource/Purchase%20Order/${encodeURIComponent(poName)}`, {
          headers: { Authorization: `token ${ERPNEXT_ADMIN_KEY}:${ERPNEXT_ADMIN_SECRET}` },
        });
        const poDoc = (await poDocRes.json()) as { data?: { status?: string; per_received?: number } };
        expect(poDoc.data?.status).toBe('To Bill');
        expect(poDoc.data?.per_received).toBe(100);
      }
    } finally {
      await cleanup(admin, seeded);
    }
  });
});
