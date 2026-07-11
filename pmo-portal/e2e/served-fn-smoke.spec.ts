/**
 * served-fn-smoke — Slice 0 task 0.8 (ERPNext adapter P2 plan §"Slice 0"). Proves the served
 * `adapter-dispatch` money boundary LANE end to end through the real Kong-fronted local edge
 * function (never `page.route`): a POST with no Authorization header gets a real typed 401; a POST
 * with a valid caller JWT commits a `reference`-domain record (P0, ADR-0055 §"out of scope" — zero
 * ERPNext/Docker-bench dependency) and gets a real typed 200 back. This is the CI-gated reproducible
 * proof (`.github/workflows/ci.yml` "Serve adapter-dispatch" step) that the serve/health-gate recipe
 * (`scripts/serve-functions.sh`) holds on both a local dev machine and an ephemeral CI runner. The
 * money-specific named fault seams (`supabase/functions/adapter-dispatch/faultSeams.ts`) get their
 * own e2e proof in the slice that owns the money AC they back (slice 6+, FR-ENA-003) — this smoke
 * only proves the LANE itself is reachable and returns real, typed responses (not a mock).
 *
 * Plain Node `fetch` (not `page.route`/`page.evaluate`) — no browser page is needed, so CORS is a
 * non-issue and no `page` fixture is requested.
 *
 * Requires (process env): SUPABASE_FUNCTIONS_URL (set by `scripts/serve-functions.sh` locally, or
 * inline by the CI step) + SUPABASE_URL/VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY
 * (the local-stack ephemeral demo key, never a production secret — same convention as
 * AC-AAN-036/AC-AGP-023) + SUPABASE_SERVICE_ROLE_KEY (REQUIRED whenever the served lane is
 * available — Slice-0 fix-round finding 7: the 200 test commits a row via the real adapter; without
 * the service-role key its `finally` cleanup can't run, and a committed `external_reference_items`/
 * `external_refs` row would be silently stranded in the shared local DB on every run). Fails loudly
 * — never a silent skip or a silent no-cleanup — both in CI when the lane vars are missing AND
 * locally whenever serving is possible but the cleanup credential is absent; skips gracefully ONLY
 * when the served-fn lane itself hasn't been started (`scripts/serve-functions.sh` not running).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error(
    'served-fn-smoke: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip',
  );
}
// Slice-0 fix-round finding 7: whenever serving is POSSIBLE (READY), the cleanup credential is no
// longer optional — the 200 test's `finally` block deletes the row it committed, and without
// SUPABASE_SERVICE_ROLE_KEY that delete can't run, stranding a row in the shared local DB on every
// run. Fail loud with a clear, actionable message rather than silently degrading to "no cleanup".
if (READY && !SERVICE_KEY) {
  throw new Error(
    'served-fn-smoke: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available — ' +
      "without it the 200 test's committed external_reference_items/external_refs row can never be " +
      'cleaned up. Export it (e.g. from `supabase status -o env`) alongside SUPABASE_FUNCTIONS_URL.',
  );
}
test.skip(
  !READY,
  'served-fn-smoke: SUPABASE_FUNCTIONS_URL/SUPABASE_URL/VITE_SUPABASE_ANON_KEY not set — run via scripts/serve-functions.sh',
);

test.setTimeout(60_000);

test.describe('served-fn-smoke: adapter-dispatch through the real served lane (reference domain)', () => {
  test('a POST with no Authorization header gets a real typed 401 through the served lane', async () => {
    const res = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'reference', operation: 'create', record: { id: 'served-fn-smoke-401' } }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.message).toMatch(/authorization/i);
  });

  test('a POST with a valid caller JWT commits a reference-domain record and returns the real typed 200', async () => {
    const authClient = createClient(AUTH_URL, ANON_KEY);
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: SEED_PASSWORD,
    });
    if (signInError || !signInData.session) {
      throw new Error(`served-fn-smoke: sign-in failed: ${signInError?.message}`);
    }
    const accessToken = signInData.session.access_token;

    // Unique per run so a repeated local run against the shared DB never collides on the
    // external_refs (org_id, domain, pmo_record_id) unique key.
    const pmoRecordId = `served-fn-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          domain: 'reference',
          operation: 'create',
          record: { id: pmoRecordId, name: 'served-fn smoke' },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { externalRecordId?: string; canonical?: { id?: string } };
      // The real reference adapter's commit() shape (referenceAdapter.ts) — a mock could return
      // anything, so pinning the exact derived id proves this hit the real adapter, not a stub.
      expect(body.externalRecordId).toBe(`ext-${pmoRecordId}`);
      expect(body.canonical?.id).toBe(pmoRecordId);
    } finally {
      // Shared-stack hygiene: delete the rows this commit wrote (external_reference_items +
      // external_refs) so a repeated local run against the same shared DB stays byte-for-byte.
      // Unconditional (finding 7): SERVICE_KEY is guaranteed non-empty here — the module-load guard
      // above already threw if serving was possible but the cleanup credential was absent, so this
      // commit test could never even start without it.
      const admin = createClient(AUTH_URL, SERVICE_KEY);
      await admin.from('external_reference_items').delete().eq('org_id', ORG_ID).eq('pmo_record_id', pmoRecordId);
      await admin
        .from('external_refs')
        .delete()
        .eq('org_id', ORG_ID)
        .eq('domain', 'reference')
        .eq('pmo_record_id', pmoRecordId);
    }
  });
});
