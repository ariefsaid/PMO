/**
 * AC-ENA-050 — Material Request (Purchase Request) at the real served `adapter-dispatch` boundary
 * (FR-ENA-110, FR-ENA-044; plan design decision 5 — never `page.route`). Creates+submits a PR ->
 * ERPNext `Material Request` (`material_request_type='Purchase'`) via the R9 two-step (insert->submit
 * ->re-fetch); asserts `purchase_requests` mirrors (`pr_number`, `erp_docstatus`) + an `external_refs`
 * row is recorded.
 *
 * LOCAL-ONLY (plan Slice 0 §0.3): needs the Docker v15 ERPNext dev bench (`docs/environments.md`
 * "ERPNext v15 dev bed") reachable at the site the local `external_org_bindings` row's `site_url`
 * points to, PLUS the served `adapter-dispatch` function running with `ERPNEXT_API_KEY`/
 * `ERPNEXT_API_SECRET` resolvable (`scripts/serve-functions.sh`). Never run in CI (the CI served-fn
 * lane only smokes the non-ERPNext `reference` domain, Slice 0 task 0.3). Skips gracefully when the
 * served-fn lane itself is not up; fails loud (never silently skips) once the lane IS reachable but a
 * required credential/config is missing, mirroring `served-fn-smoke.spec.ts`'s discipline.
 *
 * Requires (process env, same lane vars as served-fn-smoke): SUPABASE_FUNCTIONS_URL, SUPABASE_URL/
 * VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (seed +
 * cleanup — this spec seeds its own `external_org_bindings`/`procurements`/`companies` rows via the
 * service-role client, since no Operator UI wires an ERPNext binding yet in P2). Additionally requires
 * ERPNEXT_SITE_URL (the bench's site URL, e.g. http://localhost:8080) to seed the binding row — skips
 * (not fails) when absent, since that is the local-bench-specific piece no other served-fn spec needs.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ERPNEXT_SITE_URL = process.env.ERPNEXT_SITE_URL ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const LANE_READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!LANE_READY && process.env.CI) {
  throw new Error('AC-ENA-050: the served-fn lane vars are required whenever CI runs this spec — this spec cannot silently skip in CI');
}
if (LANE_READY && !SERVICE_KEY) {
  throw new Error('AC-ENA-050: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available — this spec seeds/cleans up via the service-role client');
}
test.skip(!LANE_READY, 'AC-ENA-050: served-fn lane not up — run via scripts/with-db-lock.sh scripts/serve-functions.sh');
test.skip(!ERPNEXT_SITE_URL, 'AC-ENA-050: ERPNEXT_SITE_URL not set — this spec needs the local ERPNext v15 dev bench (docs/environments.md)');

test.setTimeout(60_000);

test.describe('AC-ENA-050: Material Request (Purchase Request) — served adapter-dispatch boundary', () => {
  test('creates+submits a PR -> ERPNext Material Request; mirrors purchase_requests + external_refs', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authClient = createClient(AUTH_URL, ANON_KEY);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const procurementId = crypto.randomUUID();
    const pmoRecordId = crypto.randomUUID();

    // Seed: an ACTIVATED erpnext binding for this org (no Operator UI wires this yet in P2) + a
    // parent `procurements` case row (purchase_requests.procurement_id FK target).
    await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    const { error: bindingError } = await admin.from('external_org_bindings').insert({
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: ERPNEXT_SITE_URL,
      secret_ref: 'ac-ena-050-test-only',
      version_major: 15,
      config: { company: 'PMO Smoke Co' },
      activated_at: new Date().toISOString(),
    });
    expect(bindingError).toBeNull();

    const { error: procError } = await admin
      .from('procurements')
      .insert({ id: procurementId, org_id: ORG_ID, code: `ENA050-${suffix}`, title: 'AC-ENA-050 PR case', status: 'Draft' });
    expect(procError).toBeNull();

    try {
      const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: SEED_PASSWORD });
      if (signInError || !signInData.session) throw new Error(`AC-ENA-050: sign-in failed: ${signInError?.message}`);
      const accessToken = signInData.session.access_token;

      const res = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'procurement',
          operation: 'create',
          record: {
            id: pmoRecordId,
            procurementId,
            erp_doc_kind: 'purchase-request',
            items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 50000, schedule_date: '2026-08-01' }],
          },
          idempotencyKey: `ac-ena-050-${suffix}`,
        }),
      });
      const body = (await res.json()) as { externalRecordId?: string; canonical?: { pr_number?: string; erp_docstatus?: number }; message?: string };
      expect(res.status, `expected 200, got ${res.status}: ${body.message ?? ''}`).toBe(200);
      expect(body.externalRecordId).toMatch(/^Material Request$|.+/); // real ERP name, e.g. "MAT-REQ-2026-00042"
      expect(body.canonical?.erp_docstatus).toBe(1); // R9 two-step: submitted (never the stale POST-body "Draft")

      // The read-model mirror (task 4.5, readModelWriters.ts) upserted purchase_requests directly.
      const { data: mirrorRow } = await admin
        .from('purchase_requests')
        .select('pr_number, erp_docstatus, status')
        .eq('id', pmoRecordId)
        .maybeSingle();
      expect(mirrorRow?.pr_number).toBe(body.externalRecordId);
      expect(mirrorRow?.erp_docstatus).toBe(1);
      expect(mirrorRow?.status).toBe('Submitted');

      const { data: refRow } = await admin
        .from('external_refs')
        .select('external_record_id')
        .eq('org_id', ORG_ID)
        .eq('domain', 'procurement')
        .eq('pmo_record_id', pmoRecordId)
        .maybeSingle();
      expect(refRow?.external_record_id).toBe(body.externalRecordId);
    } finally {
      await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').eq('pmo_record_id', pmoRecordId);
      await admin.from('purchase_requests').delete().eq('id', pmoRecordId);
      await admin.from('procurements').delete().eq('id', procurementId);
      await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    }
  });
});
