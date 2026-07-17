// @e2e-isolation: read-only — rejection-path assertions only (401s at the served trust boundaries); no DB writes.
/**
 * erpnext-feed-served-smoke — Slice 8 task 8.9 (ERPNext adapter P2 plan §"Slice 8"). Proves the served
 * change-feed LANE end to end through the real Kong-fronted local edge functions (never `page.route`):
 * the erpnext-webhook HMAC trust boundary (absent X-Frappe-Webhook-Signature ⇒ a real typed 401, no
 * side effect — FR-ENA-082) + the erpnext-sweep dedicated-secret trust boundary (absent/bad bearer ⇒ a
 * real typed 401 — least-privilege, mirroring clickup-sweep). This is the CI-reproducible, bench-FREE
 * proof of the two new public surfaces; the money/apply semantics (the happy-path apply, outbox
 * recovery, ledger feed) are owned by the Vitest/Deno unit tests (8.1–8.6b) and the full ERPNext money
 * e2e (slices 3–7, Docker v15 bench, local-only).
 *
 * Plain Node `fetch` (not `page.route`) — no browser page is needed, so CORS is a non-issue and no
 * `page` fixture is requested. Mirrors served-fn-smoke.spec.ts's stance (the slice-0 lane proof).
 *
 * Requires (process env): SUPABASE_FUNCTIONS_URL (set by `scripts/serve-functions.sh`). Skips
 * gracefully when the served-fn lane has not been started; fails loudly in CI when the lane vars are
 * missing (never a silent skip).
 */
import { test, expect } from '@playwright/test';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const READY = Boolean(FUNCTIONS_URL);
if (!READY && process.env.CI) {
  throw new Error(
    'erpnext-feed-served-smoke: SUPABASE_FUNCTIONS_URL is required in CI — this spec cannot silently skip',
  );
}
test.skip(!READY, 'erpnext-feed-served-smoke: SUPABASE_FUNCTIONS_URL not set — run via scripts/serve-functions.sh');

test.setTimeout(30_000);

test.describe('erpnext-feed-served-smoke: the change-feed trust boundaries through the real served lane', () => {
  test('erpnext-webhook: an absent X-Frappe-Webhook-Signature ⇒ a real typed 401 with no side effect (FR-ENA-082)', async () => {
    const res = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No X-Frappe-Webhook-Signature header — the HMAC is the sole trust boundary.
      body: JSON.stringify({ doctype: 'Purchase Invoice', name: 'ACC-PINV-2026-00001', docstatus: 1, modified: '2026-07-12 12:00:00.000000', doc: {} }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('UNAUTHORIZED');
  });

  test('erpnext-webhook: an INVALID signature ⇒ a real typed 401 (tampering rejected at the boundary)', async () => {
    const res = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Frappe-Webhook-Signature': 'bm90LWEtdmFsaWQtc2lnbmF0dXJl' },
      body: JSON.stringify({ doctype: 'Purchase Invoice', name: 'ACC-PINV-2026-00001', docstatus: 1, modified: '2026-07-12 12:00:00.000000', doc: {} }),
    });
    expect(res.status).toBe(401);
  });

  test('erpnext-sweep: an absent Authorization bearer ⇒ a real typed 401 (the dedicated-secret gate)', async () => {
    const res = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No Authorization header — the dedicated ERPNEXT_SWEEP_SECRET bearer is the sole trust boundary.
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('UNAUTHORIZED');
  });

  test('erpnext-sweep: an INVALID bearer ⇒ a real typed 401 (a leaked-wrong secret cannot trigger a tick)', async () => {
    const res = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer definitely-not-the-sweep-secret' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});
