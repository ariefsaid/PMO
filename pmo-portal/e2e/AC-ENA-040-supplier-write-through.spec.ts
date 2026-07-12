/**
 * AC-ENA-040 -- Supplier create/write-through succeeds through ERP truth (the REAL served
 * `adapter-dispatch` boundary through Kong -- no `page.route`, per the plan's binding rule for every
 * money-command e2e: FR-ENA-001/003, plan §2 decision 5). No browser page is needed (a plain Node
 * `fetch`, matching `served-fn-smoke.spec.ts`'s established pattern for this served-fn lane).
 *
 * Given an org whose `companies` domain is employed by ERPNext (an activated `external_org_bindings`
 * row), when a PMO Vendor company is created, then: the write POSTs the real `adapter-dispatch`
 * function -> the real ERPNext v15 dev-bed bench creates a `Supplier` doc (body `{supplier_name}`,
 * R9 §0) -> the `companies` read-model mirrors `name`/`type='Vendor'`/`erp_party_type`/
 * `erp_supplier_name` -> `external_refs` records the `Supplier:<name>` mapping. Verified against the
 * REAL ERPNext REST API (`GET /api/resource/Supplier/<name>`), not a mock.
 *
 * Requires (bench + served-fn lane, local-only -- plan Slice 0 task 0.3/0.4): the Docker v15 bench
 * (`docs/environments.md` "ERPNext v15 dev bed") reachable at ERPNEXT_BENCH_URL (default
 * http://localhost:8080) with ERPNEXT_BENCH_API_KEY/ERPNEXT_BENCH_API_SECRET (creds live ONLY in
 * `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md`, NFR-ENA-SEC-002 -- NEVER in this repo), the served
 * lane (SUPABASE_FUNCTIONS_URL, via `scripts/serve-functions.sh` -- which must ALSO be launched with
 * ERPNEXT_API_KEY/ERPNEXT_API_SECRET set for the function process, e.g. `supabase/functions/.env.local`),
 * and SUPABASE_URL/VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY +
 * SUPABASE_SERVICE_ROLE_KEY (the local ephemeral demo key). Fails loudly in CI (never a silent skip);
 * skips gracefully only when the served-fn lane itself hasn't been started locally -- exactly
 * `served-fn-smoke.spec.ts`'s discipline. The full ERPNext money e2e suite (slices 3-7) is
 * local-only (bench-dependent) -- never CI-gated (plan Slice 0 task 0.3).
 *
 * SHARED-STACK HYGIENE: flips the SEED org's `companies` domain for the duration of this one test
 * only (mirrors `AC-CUA-090-clickup-task-writethrough.spec.ts`'s tasks-domain flip discipline) --
 * `afterEach` deletes every row this spec seeded/wrote (binding, ownership flip, the minted companies
 * row, its external_refs mapping) AND best-effort deletes the created Supplier from the bench, so the
 * shared local DB + shared bench are byte-for-byte for the next spec/agent.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// BENCH_URL is used for THIS TEST PROCESS's own direct bench verification (runs on the HOST) --
// `http://localhost:8080` is host-reachable but NOT reachable from inside the served fn's Docker
// container. SITE_URL (task 6.4 fix-round, live-bench-discovered, matching AC-ENA-050/051's own
// ERPNEXT_SITE_URL naming) is what gets SEEDED into external_org_bindings.site_url -- what the served
// fn itself dials -- and needs the Docker-reachable `host.docker.internal` alias
// (docs/environments.md "P2"). Two different network contexts, two different env vars; SITE_URL falls
// back to BENCH_URL only when a caller hasn't set it (preserving any environment where the two
// happen to coincide).
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const SITE_URL = process.env.ERPNEXT_SITE_URL ?? BENCH_URL;
const BENCH_API_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_API_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_API_KEY && BENCH_API_SECRET);
if (!READY && process.env.CI) {
  throw new Error(
    'AC-ENA-040: this served-fn+bench e2e is local-only (plan Slice 0 task 0.3) and must never run in CI -- ' +
      'if CI is attempting it, the workflow is misconfigured.',
  );
}
test.skip(
  !READY,
  'AC-ENA-040: SUPABASE_FUNCTIONS_URL / ERPNEXT_BENCH_API_KEY / ERPNEXT_BENCH_API_SECRET not set -- ' +
    'run via scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx playwright test AC-ENA-040',
);

test.setTimeout(60_000);

const admin = READY ? createClient(AUTH_URL, SERVICE_KEY) : null;

/** Best-effort DELETE against the real bench -- never throws (cleanup must not mask a test failure). */
async function deleteSupplierFromBench(name: string): Promise<void> {
  try {
    await fetch(`${BENCH_URL}/api/resource/Supplier/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { Authorization: `token ${BENCH_API_KEY}:${BENCH_API_SECRET}` },
    });
  } catch {
    // best-effort; a stray bench-side row does not corrupt PMO's own state.
  }
}

test.beforeEach(async () => {
  if (!admin) return;
  // Activated binding (skips the version-handshake -- that's unit-proved by binding.test.ts;
  // this e2e proves the COMMAND boundary). Minimal config: Supplier's R9 §0 body needs none of the
  // account defaults.
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  const { error: bindErr } = await admin.from('external_org_bindings').insert({
    org_id: ORG_ID,
    external_tier: 'erpnext',
    site_url: SITE_URL,
    secret_ref: 'e2e-inline', // real creds are resolved from ERPNEXT_API_KEY/SECRET at the served fn (never stored here)
    version_major: 15,
    activated_at: new Date().toISOString(),
    config: { company: 'PMO Smoke Co' },
  });
  if (bindErr) throw new Error(`AC-ENA-040: failed to seed external_org_bindings: ${bindErr.message}`);

  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'companies');
  const { error: flipErr } = await admin
    .from('external_domain_ownership')
    .insert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'companies' });
  if (flipErr) throw new Error(`AC-ENA-040: failed to flip org companies->erpnext: ${flipErr.message}`);
});

test.afterEach(async () => {
  if (!admin) return;
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'companies');
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
});

test.describe('AC-ENA-040: Supplier create write-through through the real served adapter-dispatch boundary', () => {
  test('creating a Vendor company on a companies->erpnext org creates a real ERPNext Supplier, mirrors the companies row, and records external_refs', async () => {
    if (!admin) throw new Error('unreachable -- guarded by test.skip above');
    const authClient = createClient(AUTH_URL, ANON_KEY);
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: SEED_PASSWORD,
    });
    if (signInError || !signInData.session) {
      throw new Error(`AC-ENA-040: sign-in failed: ${signInError?.message}`);
    }
    const accessToken = signInData.session.access_token;

    const pmoRecordId = crypto.randomUUID();
    const vendorName = `AC-ENA-040 Vendor ${Date.now()}`;

    try {
      const res = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'companies',
          operation: 'create',
          record: { id: pmoRecordId, name: vendorName, type: 'Vendor', erp_doc_kind: 'supplier' },
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { externalRecordId?: string; canonical?: { id?: string; erp_supplier_name?: string } };
      expect(body.externalRecordId).toBe(vendorName); // ERPNext Supplier autonames by field:supplier_name (probed live)
      expect(body.canonical?.erp_supplier_name).toBe(vendorName);

      // -- Then 1: the real ERPNext bench holds the Supplier doc (proof this hit the real boundary). --
      const erpRes = await fetch(`${BENCH_URL}/api/resource/Supplier/${encodeURIComponent(vendorName)}`, {
        headers: { Authorization: `token ${BENCH_API_KEY}:${BENCH_API_SECRET}` },
      });
      expect(erpRes.status).toBe(200);
      const erpBody = (await erpRes.json()) as { data?: { supplier_name?: string } };
      expect(erpBody.data?.supplier_name).toBe(vendorName);

      // -- Then 2: the companies read-model mirrors the party (task 3.6's real writer). --
      const { data: companyRow } = await admin
        .from('companies')
        .select('name, type, erp_party_type, erp_supplier_name')
        .eq('id', pmoRecordId)
        .maybeSingle();
      expect(companyRow).toMatchObject({ name: vendorName, type: 'Vendor', erp_party_type: 'Vendor', erp_supplier_name: vendorName });

      // -- Then 3: external_refs records the doctype-encoded mapping (task 3.2). --
      const { data: refRow } = await admin
        .from('external_refs')
        .select('external_record_id, external_tier')
        .eq('org_id', ORG_ID)
        .eq('domain', 'companies')
        .eq('pmo_record_id', pmoRecordId)
        .maybeSingle();
      expect(refRow).toMatchObject({ external_record_id: `Supplier:${vendorName}`, external_tier: 'erpnext' });
    } finally {
      // Shared-stack hygiene: delete every row this test wrote + the bench-side Supplier doc.
      await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', pmoRecordId);
      await admin.from('companies').delete().eq('id', pmoRecordId);
      await deleteSupplierFromBench(vendorName);
    }
  });
});
