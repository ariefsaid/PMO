/**
 * AC-JWT-005 — compose-view local JWKS auth gate (ADR-0057 Task 2 pilot).
 *
 * Proves the pilot's local caller-JWT verification (verifyCallerJwt against the project JWKS,
 * ES256 — no auth.getUser round-trip) is byte-for-byte contract-compatible with the old
 * getUser gate at the boundary that matters: WHO gets past it.
 *
 *   1. Absent Authorization header  → typed 401 UNAUTHORIZED (missing header).
 *   2. Garbage bearer (bad sig)     → typed 401 UNAUTHORIZED (invalid JWT) — the local ES256
 *                                     signature check rejecting an unverifiable token.
 *   3. Valid ES256 caller token     → PAST the auth gate (never 401) — issuer/audience/alg all
 *                                     pinned and satisfied by a real GoTrue-issued session token.
 *
 * This is an API-level test (no browser): it isolates the gate — the only thing Task 2 changed.
 * The valid-token path may return a later non-401 (e.g. 502 when the local stack has no OpenRouter
 * model-key secret set); that is expected and still proves auth passed. We assert `not 401`, not 200.
 *
 * Env convention mirrors AC-AGP-023 / AC-VR-020: the URL + the (non-secret, RLS-scoped, publicly
 * embedded) anon key come from the same vars the app build uses. Throws in CI (must not silently
 * skip); skips locally when the stack env isn't exported (helpers.requireServiceRoleKey pattern).
 *
 * Runs in: CI `integration` job (PR->main). Locally: export the local stack env
 * (`supabase status -o env`) then `scripts/with-db-lock.sh npx playwright test e2e/AC-JWT-005-*`.
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { SEED_PASSWORD } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SEED_EMAIL = 'admin@acme.test';

const missing = !SUPABASE_URL || !ANON_KEY;
if (missing && process.env.CI) {
  throw new Error('SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required for AC-JWT-005 e2e in CI');
}
test.skip(missing, 'local stack env (SUPABASE_URL / VITE_SUPABASE_ANON_KEY) not exported — skipping');

const FN_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/compose-view`;

/** Mint a real ES256 session token from the local GoTrue via the password grant. */
async function seedAccessToken(): Promise<string> {
  const api = await pwRequest.newContext();
  const res = await api.post(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: SEED_EMAIL, password: SEED_PASSWORD },
  });
  expect(res.ok(), `GoTrue sign-in for ${SEED_EMAIL} failed (${res.status()})`).toBeTruthy();
  const token = ((await res.json()) as { access_token?: string }).access_token;
  await api.dispose();
  if (!token) throw new Error('GoTrue returned no access_token');
  return token;
}

test('AC-JWT-005 compose-view rejects absent bearer with typed 401', async ({ request }) => {
  const res = await request.post(FN_URL, {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    data: {},
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ status: 401, error: 'UNAUTHORIZED' });
});

test('AC-JWT-005 compose-view rejects a bad-signature bearer with typed 401', async ({ request }) => {
  const res = await request.post(FN_URL, {
    headers: {
      apikey: ANON_KEY,
      Authorization: 'Bearer not.a.real.jwt',
      'Content-Type': 'application/json',
    },
    data: {},
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ status: 401, error: 'UNAUTHORIZED', detail: 'invalid JWT' });
});

test('AC-JWT-005 compose-view accepts a valid ES256 caller token past the auth gate', async ({ request }) => {
  const token = await seedAccessToken();
  const res = await request.post(FN_URL, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {},
  });
  // The local ES256 verify accepted the token — the request is PAST the gate (never a 401).
  // A later status (e.g. 502 when the local stack has no OpenRouter model-key secret) is fine.
  expect(res.status()).not.toBe(401);
});
