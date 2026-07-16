# TEST-DEBUG.md — Supabase Edge Function Test Import Diagnosis

**Date:** 2026-07-17  
**Branch:** `feat/external-admin-connect`  
**Worktree:** `/Users/ariefsaid/Coding/PMO/.claude/worktrees/admin-connect`

---

## Executive Summary

**The fetch-mock pattern IS VIABLE for all 6 functions.** The test suites re-implement handlers locally not because of a technical blocker, but because **the original author took a shortcut** — they duplicated logic instead of investing in proper test infrastructure (mock `globalThis.fetch`, mint ES256 JWTs, mock `Deno.env.get`).

There is **one real bug**: `external-connect/index.ts` lacks the `if (import.meta.main)` guard around `Deno.serve`, causing the HTTP server to start during `deno test` imports.

---

## Per-Function Viability

| Function | Import Works? | Handler Exported? | `import.meta.main` Guard? | Fetch-Mockable? | JWT-Mintable? | Verdict |
|----------|---------------|-------------------|---------------------------|-----------------|---------------|---------|
| `external-unlink` | ✅ Yes | ✅ `handleUnlinkRequest` | ✅ Yes | ✅ Yes | ✅ Yes | **READY** |
| `external-connect` | ✅ Yes | ❌ No (inline) | ❌ **NO — BUG** | ✅ Yes | ✅ Yes | **NEEDS FIX** |
| `external-companies` | ✅ Yes | ✅ `handleCompaniesRequest` | ✅ Yes | ✅ Yes | ✅ Yes | **READY** |
| `external-set-company` | ✅ Yes | ✅ `handleSetCompanyRequest` | ✅ Yes | ✅ Yes | ✅ Yes | **READY** |

---

## Blocker Analysis (Evidence from Probe Tests)

### 1. Module-Load Side Effects?

**Finding: NO.** Importing `index.ts` does **not** throw or execute handler logic at module load time.

**Evidence (external-unlink probe6):**
```typescript
import { handleUnlinkRequest } from './index.ts';  // ← Succeeds silently
const res = await handleUnlinkRequest(req);       // ← Runs, returns 500 MISCONFIGURED (env not set)
```

The handler reads `Deno.env.get()` **at runtime**, not module scope. No top-level `Deno.env.get`, no client construction, no JWKS fetch on import.

**File:Line** — `external-unlink/index.ts`:1–280 — all executable code is inside `handleUnlinkRequest` or the `if (import.meta.main)` block.

### 2. Does `import.meta.main` Prevent `Deno.serve` Under `deno test`?

**Finding: YES — but only where present.**

**external-unlink, external-companies, external-set-company:**
```typescript
if (import.meta.main) {
  Deno.serve(handleUnlinkRequest);
}
```
**Probe7 test confirms:** `Deno.serve` is **NOT** called during `deno test` import.

**external-connect (BUG):**
```typescript
// Line 196: NO GUARD
Deno.serve(async (req: Request): Promise<Response> => { ... });
```
**Probe5 test output:**
```
Listening on http://0.0.0.0:8000/   ← SERVER STARTED DURING IMPORT
```

**Fix required:** Wrap `external-connect/index.ts:196` in `if (import.meta.main)`.

### 3. Runtime Dependencies (What Tests Must Supply)

| Dependency | Source | Mockable? | How |
|------------|--------|-----------|-----|
| `SUPABASE_URL` | `Deno.env.get` | ✅ Yes | `Deno.env.get = (k) => k === 'SUPABASE_URL' ? 'https://test.co' : ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | `Deno.env.get` | ✅ Yes | Same as above |
| **JWKS fetch** | `jose.createRemoteJWKSet` → `globalThis.fetch` | ✅ Yes | Mock `globalThis.fetch` to return `{ keys: [publicJwk] }` |
| **Supabase REST** (`/rest/v1/...`) | `supabase-js` client → `globalThis.fetch` | ✅ Yes | Mock `globalThis.fetch` to intercept REST URLs |
| **Supabase RPC** (`/rest/v1/rpc/...`) | `supabase-js` client → `globalThis.fetch` | ✅ Yes | Same as REST |
| **External APIs** (ClickUp, ERPNext) | Direct `fetch` in validators | ✅ Yes | Mock `globalThis.fetch` to match URL patterns |

**All network calls go through `globalThis.fetch`** — confirmed by probe tests showing every outgoing request intercepted.

### 4. `verifyCallerJwt` JWKS Fetch & JWT Minting

**Finding: JWKS fetch IS fetch-mockable; ES256 JWTs CAN be minted with `jose`.**

**verifyCallerJwt mechanism** (`pmo-portal/src/lib/auth/verifyCallerJwt.ts`):
```typescript
export function jwksFromUrl(jwksUrl: string): JwksResolver {
  return createRemoteJWKSet(new URL(jwksUrl));  // Uses globalThis.fetch internally
}

export async function verifyCallerJwt(token, jwks, opts) {
  const { payload } = await jwtVerify(token, jwks, { ... });
  return { sub: payload.sub, claims: payload };
}
```

**Probe5 confirms:**
1. `createRemoteJWKSet` calls `globalThis.fetch(jwksUrl)`
2. Mocking `globalThis.fetch` to return `{ keys: [publicJwk] }` works
3. `jose.SignJWT` + `generateKeyPair('ES256')` produces valid tokens accepted by `verifyCallerJwt`

```typescript
// Minting a valid ES256 JWT (from probe4)
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'test-key-1';
publicJwk.alg = 'ES256';

const jwt = await new SignJWT({ sub: 'user-1' })
  .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
  .setIssuedAt()
  .setIssuer('https://test.supabase.co/auth/v1')
  .setAudience('authenticated')
  .setExpirationTime('1h')
  .sign(privateKey);
```

### 5. Fetch-Mocking Feasibility

**Finding: NO genuine infeasibility for any of the 4 functions.**

Every network call observed in probe tests:
- JWKS: `GET /auth/v1/.well-known/jwks.json`
- Profiles: `GET /rest/v1/profiles?select=...`
- Platform operators: `GET /rest/v1/platform_operators?select=...`
- Projects/Bindings: `GET /rest/v1/...`
- Mutations: `PATCH /rest/v1/...`
- RPC: `POST /rest/v1/rpc/log_audit`, `POST /rest/v1/rpc/read_vault_secret`, etc.
- ClickUp: `GET https://api.clickup.com/api/v2/user`
- ERPNext: `GET https://erp.example.com/api/resource/...`

All intercepted by single `globalThis.fetch` mock. No `WebSocket`, no `Deno.connect`, no `net` bypass.

### 6. Root Cause of Drift

**Verdict: SHORTCUT, not blocker.**

The test files (`unlink.test.ts`, `connect.test.ts`, `companies.test.ts`, `set-company.test.ts`) all:
- Copy-paste validator functions (`validateClickUpToken`, `isPrivateOrReservedHost`, etc.) instead of importing
- Re-implement entire handler logic as `handleUnlinkRequestWithDeps` with manual dependency injection
- Use hand-rolled Supabase mock chains instead of mocking `globalThis.fetch`
- Use trivial `verifyJwt: async () => ({ sub: 'user-1' })` instead of minting real JWTs

**Why this happened:**
1. Author didn't know `globalThis.fetch` mocking works for `supabase-js` + `jose`
2. Author didn't invest in JWT minting infrastructure (`jose` key gen + JWKS mock)
3. `external-connect` never exported its handler — so test *had* to duplicate

**Cost of drift:**
- Test logic diverges from production (validators copied in 3 test files)
- Bug fixes to handler don't propagate to tests
- SSRF guard logic duplicated in 4 test files (maintenance burden)
- No confidence tests exercise real code paths

---

## Minimal Fixes Required

### 1. Fix `external-connect/index.ts` — Add `import.meta.main` Guard
```typescript
// Line 196: CHANGE FROM
Deno.serve(async (req: Request): Promise<Response> => { ... });

// TO
if (import.meta.main) {
  Deno.serve(async (req: Request): Promise<Response> => { ... });
}
```

### 2. Export Validators from `external-connect/index.ts`
```typescript
// Add exports for testability
export { validateClickUpToken, validateErpNextCredentials, isPrivateOrReservedHost };
export type { ValidatorDeps };
```

### 3. Create Shared Test Harness (Recommended)
Create `supabase/functions/_test/harness.ts`:
```typescript
export function mockFetch(routes: Map<string, Response>) { ... }
export function mockEnv(env: Record<string, string>) { ... }
export async function mintEs256Jwt(claims: JWTPayload, kid = 'test-1'): Promise<{ jwt: string; publicJwk: JWK }> { ... }
export function createJwksMock(publicJwk: JWK) { ... }
```

### 4. Refactor Tests to Import Real Handlers
Replace `handleUnlinkRequestWithDeps` with:
```typescript
import { handleUnlinkRequest } from './index.ts';
import { mockFetch, mockEnv, mintEs256Jwt, createJwksMock } from '../_test/harness.ts';

Deno.test('ClickUp unlink soft-archives binding', async () => {
  const { jwt, publicJwk } = await mintEs256Jwt({ sub: 'user-1' });
  mockFetch.set('/auth/v1/.well-known/jwks.json', new Response(JSON.stringify({ keys: [publicJwk] })));
  mockFetch.set('/rest/v1/profiles...', new Response(JSON.stringify({ data: { org_id: 'org-1', role: 'Admin' } })));
  // ... other routes
  mockEnv({ SUPABASE_URL: 'https://test.co', SUPABASE_SERVICE_ROLE_KEY: 'key' });
  
  const res = await handleUnlinkRequest(new Request('...', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }) }));
  assertEquals(res.status, 200);
});
```

---

## Verdict Per Function

| Function | Fetch-Mock Pattern Viable? | Blocker |
|----------|----------------------------|---------|
| `external-unlink` | ✅ **YES** | None (already exports handler, has guard) |
| `external-connect` | ✅ **YES** | Missing `import.meta.main` guard + no exports |
| `external-companies` | ✅ **YES** | None (already exports handler, has guard) |
| `external-set-company` | ✅ **YES** | None (already exports handler, has guard) |

---

## Clean-Up

All probe test files (`probe*.test.ts`) have been deleted from the worktree.

---

**TEST-DEBUG-DONE**