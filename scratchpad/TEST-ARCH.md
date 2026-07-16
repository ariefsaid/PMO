# Edge Function Test Architecture — bind tests to the shipped handler

## Decision

Replace the current copy-tested edge-function suites with **handler-level Deno tests that import the shipped handler and mock `globalThis.fetch`**.

**Target files**
- `supabase/functions/external-connect/index.ts`
- `supabase/functions/external-companies/index.ts`
- `supabase/functions/external-set-company/index.ts`
- `supabase/functions/external-link/index.ts`
- `supabase/functions/external-lists/index.ts`
- `supabase/functions/external-unlink/index.ts`

**Test files**
- `supabase/functions/external-connect/connect.test.ts`
- `supabase/functions/external-companies/companies.test.ts`
- `supabase/functions/external-set-company/set-company.test.ts`
- `supabase/functions/external-link/link.test.ts`
- `supabase/functions/external-lists/lists.test.ts`
- `supabase/functions/external-unlink/unlink.test.ts`

This binds tests to what ships:
1. real request parsing
2. real JWT verification via `verifyCallerJwt`
3. real Supabase client HTTP calls
4. real external API HTTP calls
5. real response mapping/status codes

No injectable-deps params.

---

## One shared helper

### New file
`supabase/functions/_shared/testing/edgeTestKit.ts`

### Responsibilities

1. **`withFetchMock(routes, run)`**
   - stubs `globalThis.fetch` with `@std/testing/mock`
   - routes by **method + full URL parts**
   - records every call
   - fails fast on unexpected fetches
   - supports:
     - Supabase REST: `/rest/v1/<table>?...`
     - Supabase RPC: `/rest/v1/rpc/<fn>`
     - JWKS: `/auth/v1/.well-known/jwks.json`
     - external APIs: `api.clickup.com`, ERPNext site URL

2. **ES256 JWT authority**
   - generate ephemeral ES256 keypair with `jose`
   - export public JWK as JWKS
   - mint caller JWTs with chosen `sub`/claims
   - serve JWKS through the fetch mock so the real `createRemoteJWKSet` path runs

3. **env setup/teardown**
   - sets/restores:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
   - uses one stable `SUPABASE_URL` + keypair per test module so each function’s memoized `_jwks` stays valid

4. **request helpers**
   - build authenticated `Request`s with minted JWTs
   - JSON response/body helpers
   - REST/RPC matchers so tests assert intent, not raw query strings everywhere

### Sketch

```ts
// supabase/functions/_shared/testing/edgeTestKit.ts
import { stub } from '@std/testing/mock';
import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';

export interface FetchCall {
  method: string;
  url: URL;
  headers: Headers;
  bodyText?: string;
  bodyJson?: unknown;
}

export interface RouteMatch {
  method?: string;
  host?: string;
  pathname?: string | RegExp;
  searchParams?: Record<string, string | RegExp>;
  match?: (call: FetchCall) => boolean;
}

export interface MockRoute extends RouteMatch {
  label: string;
  response:
    | Response
    | ((call: FetchCall) => Response | Promise<Response>);
}

export async function createJwtAuthority(supabaseUrl: string) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(publicKey) as JWK;
  const kid = 'edge-test-key';
  publicJwk.use = 'sig';
  publicJwk.alg = 'ES256';
  publicJwk.kid = kid;

  return {
    jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    jwksBody: { keys: [publicJwk] },
    async mintJwt(claims: { sub: string; role?: string; aud?: string; expSeconds?: number }) {
      const now = Math.floor(Date.now() / 1000);
      return await new SignJWT({ role: claims.role ?? 'authenticated' })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer(`${supabaseUrl}/auth/v1`)
        .setAudience(claims.aud ?? 'authenticated')
        .setSubject(claims.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + (claims.expSeconds ?? 3600))
        .sign(privateKey);
    },
  };
}

export async function withFetchMock<T>(routes: MockRoute[], run: (ctx: { calls: FetchCall[] }) => Promise<T>) {
  const calls: FetchCall[] = [];

  const fetchStub = stub(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const bodyText = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.clone().text();

    const call: FetchCall = {
      method: request.method.toUpperCase(),
      url,
      headers: request.headers,
      bodyText,
      bodyJson: bodyText ? safeJson(bodyText) : undefined,
    };
    calls.push(call);

    const route = routes.find((r) => matches(r, call));
    if (!route) throw new Error(`Unexpected fetch: ${call.method} ${url}`);

    return typeof route.response === 'function' ? await route.response(call) : route.response;
  });

  try {
    return await run({ calls });
  } finally {
    fetchStub.restore();
  }
}

export function installEdgeEnv(overrides?: Partial<Record<'SUPABASE_URL'|'SUPABASE_SERVICE_ROLE_KEY', string>>) {
  const previous = {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  };
  const next = {
    SUPABASE_URL: overrides?.SUPABASE_URL ?? 'https://edge-test.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: overrides?.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key',
  };
  Deno.env.set('SUPABASE_URL', next.SUPABASE_URL);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', next.SUPABASE_SERVICE_ROLE_KEY);
  return {
    ...next,
    restore() {
      restoreEnv('SUPABASE_URL', previous.SUPABASE_URL);
      restoreEnv('SUPABASE_SERVICE_ROLE_KEY', previous.SUPABASE_SERVICE_ROLE_KEY);
    },
  };
}

export function rpcCall(calls: FetchCall[], fn: string) {
  return calls.filter((c) => c.url.pathname === `/rest/v1/rpc/${fn}`);
}

export function restCall(calls: FetchCall[], table: string, method?: string) {
  return calls.filter((c) => c.url.pathname === `/rest/v1/${table}` && (!method || c.method === method));
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

export function countResponse(count: number, init: ResponseInit = {}) {
  return new Response(null, {
    status: init.status ?? 200,
    headers: {
      'content-range': `0-0/${count}`,
      ...(init.headers ?? {}),
    },
  });
}
```

### Route helpers the kit should expose

```ts
export function jwksRoute(authority) {
  return {
    label: 'jwks',
    method: 'GET',
    pathname: '/auth/v1/.well-known/jwks.json',
    response: jsonResponse(authority.jwksBody),
  };
}

export function supabaseSelect(table: string, responder) { /* pathname /rest/v1/<table> */ }
export function supabaseRpc(fn: string, responder) { /* pathname /rest/v1/rpc/<fn> */ }
export function clickup(pathname: string | RegExp, responder) { /* host api.clickup.com */ }
export function erp(siteHost: string, pathname: string | RegExp, responder) { /* ERP host */ }
```

### Important nuance: `_jwks` memoization

Each function caches its JWKS resolver in a module-level `_jwks`. Therefore:
- **do not** rotate `SUPABASE_URL`/keypair per test case inside one imported module
- **do** create one stable authority/env per `.test.ts` file and reuse it across its cases

---

## Handler import rule

### Five functions already fit
These already export the shipped handler and have `import.meta.main` guard:
- `external-unlink/index.ts` → `handleUnlinkRequest`
- `external-companies/index.ts` → `handleCompaniesRequest`
- `external-set-company/index.ts` → `handleSetCompanyRequest`
- `external-link/index.ts` → `handleLinkRequest`
- `external-lists/index.ts` → `handleListsRequest`

### One function needs the same shape
`supabase/functions/external-connect/index.ts` is the outlier. It should be normalized to:

```ts
export async function handleConnectRequest(req: Request): Promise<Response> {
  // existing shipped logic, unchanged
}

if (import.meta.main) {
  Deno.serve(handleConnectRequest);
}
```

That is **not** dependency injection. It is a named export of the shipped handler so the test can import exactly what deploy runs.

---

## End-to-end test shape — external-unlink

### File
`supabase/functions/external-unlink/unlink.test.ts`

### Imports

```ts
import { describe, it, beforeAll, afterAll } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleUnlinkRequest } from './index.ts';
import {
  createJwtAuthority,
  installEdgeEnv,
  withFetchMock,
  jwksRoute,
  supabaseRpc,
  supabaseSelect,
  restCall,
  rpcCall,
  jsonResponse,
} from '../_shared/testing/edgeTestKit.ts';
```

### Suite setup

```ts
const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);

afterAll(() => env.restore());

async function authed(body: unknown, sub = 'user-1') {
  const jwt = await auth.mintJwt({ sub });
  return new Request('http://edge.test/unlink', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
```

### Admin OK

```ts
it('Admin OK — clickup unlink soft-archives binding and audits', async () => {
  await withFetchMock([
    jwksRoute(auth),

    supabaseSelect('profiles', () =>
      jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
      })),

    supabaseSelect('platform_operators', () => new Response('null', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),

    supabaseSelect('projects', (call) => {
      assertEquals(call.url.searchParams.get('id'), 'eq.proj-1');
      assertEquals(call.url.searchParams.get('org_id'), 'eq.org-1');
      return jsonResponse({ id: 'proj-1', project_manager_id: 'pm-9', org_id: 'org-1' }, {
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
      });
    }),

    supabaseSelect('external_project_bindings', () =>
      jsonResponse({ id: 'binding-1', external_container_id: 'list-1' }, {
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
      })),

    {
      label: 'soft-archive binding',
      method: 'PATCH',
      pathname: '/rest/v1/external_project_bindings',
      response: (call) => {
        assertEquals(call.bodyJson && typeof call.bodyJson === 'object', true);
        const body = call.bodyJson as Record<string, unknown>;
        if (typeof body.disconnected_at !== 'string') throw new Error('missing disconnected_at');
        return jsonResponse([]);
      },
    },

    supabaseRpc('log_audit', (call) => {
      const body = call.bodyJson as Record<string, unknown>;
      assertEquals(body.p_action, 'integration.unlink');
      assertEquals((body.p_detail as Record<string, unknown>).tier, 'clickup');
      assertEquals((body.p_detail as Record<string, unknown>).project_id, 'proj-1');
      return jsonResponse(null);
    }),
  ], async ({ calls }) => {
    const res = await handleUnlinkRequest(await authed({ tier: 'clickup', projectId: 'proj-1' }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
    assertEquals(restCall(calls, 'external_project_bindings', 'PATCH').length, 1);
    assertEquals(rpcCall(calls, 'log_audit').length, 1);
  });
});
```

### PM of project OK
- profile = `Project Manager`, active
- project `project_manager_id === userId`
- expect `200`

### PM of other project 403
- profile = `Project Manager`, active
- project `project_manager_id !== userId`
- expect `403`
- assert **no** PATCH to `external_project_bindings`
- assert **no** `log_audit`

### inactive PM 403
- profile role PM, status inactive
- project manager matches user
- expect `403`
- assert no PATCH / no audit

### Engineer 403
- profile role Engineer
- no operator row
- expect `403`
- assert no PATCH / no audit

### missing binding 404
- binding select returns `null`
- expect `404`
- assert no PATCH / no audit

### ERPNext branch
- binding select from `external_org_bindings`
- PATCH body sets `config.company = null`
- assert `log_audit` detail contains prior company

This single suite proves the real handler’s auth, body parsing, Supabase reads, mutation, and audit behavior.

---

## How each function is tested

## 1) `supabase/functions/external-connect/connect.test.ts`
Import **`handleConnectRequest`**.

Cases:
- Admin + valid ClickUp token → `200`, RPC `create_vault_secret_for_org`, RPC `admin_change_domain_ownership`
- Operator + valid ClickUp token → `200`
- non-Admin/non-Operator → `403`, **no Vault RPC**, **no ownership RPC**
- invalid ClickUp token (`api.clickup.com/api/v2/user` 401) → `422`, no Vault write
- Admin + valid ERPNext creds → `200`, Vault RPC only
- SSRF-rejected ERP URL → `422`, no ERP fetch beyond validation rejection, no Vault write
- invalid JWT → `401`

Assertions from recorded calls:
- `rpcCall(calls, 'create_vault_secret_for_org').length === 1` on success
- `=== 0` on validation/auth failures
- for ClickUp success: `rpcCall(calls, 'admin_change_domain_ownership').length === 1`

## 2) `supabase/functions/external-companies/companies.test.ts`
Import **`handleCompaniesRequest`**.

Cases:
- Admin OK → `200 { companies }`
- Operator OK → `200`
- Engineer 403
- missing org binding 404
- inactive binding 422
- Vault secret missing 422
- ERP 404 → edge fn 404
- ERP network/non-404 failure → `502`
- SSRF-rejected binding `site_url` → `422`
- audit asserted on success only

Assertions:
- `rpc read_vault_secret` called once on happy path
- `rpc log_audit` called once on happy path
- returned list comes from ERP fetch body, not copied validator

## 3) `supabase/functions/external-set-company/set-company.test.ts`
Import **`handleSetCompanyRequest`**.

Cases:
- Admin OK sets `config.company`
- Operator OK sets `config.company`
- Engineer 403
- missing binding 404
- inactive binding 422
- Vault secret missing 422
- company not found in ERP 404
- upstream ERP failure 502
- invalid/missing `companyId` 400
- audit asserted on success only

Assertions:
- PATCH to `/rest/v1/external_org_bindings`
- request body `config.company === '<chosen company>'`
- no PATCH on 4xx/5xx preconditions

## 4) `supabase/functions/external-link/link.test.ts`
Import **`handleLinkRequest`**.

ClickUp branch:
- Admin OK push-seed with empty List + empty PMO project → `200`, POST `external_project_bindings`, audit
- PM-of-project active OK
- PM-of-other-project 403
- inactive PM 403
- Engineer 403
- List missing 404
- mixed content (`listCount > 0 && pmoCount > 0`) → `409`
- push-seed with non-empty List only → `409`
- pull-adopt with non-empty PMO project only → `409`
- list already actively bound → `409`
- project already linked (`23505`) → `409`

ERPNext branch:
- Admin/Operator OK company set → `200`
- PM forbidden → `403`
- invalid company → `404`

Important real-handler proof:
- for `getPmoTaskCount`, mock the **HEAD** count response via `content-range`; this catches the previously shipped count-path bug because the real Supabase client path is exercised.

## 5) `supabase/functions/external-lists/lists.test.ts`
Import **`handleListsRequest`**.

Cases:
- Admin OK
- PM OK
- Operator OK
- Engineer 403
- missing binding 404
- inactive binding 422
- Vault secret missing 422
- ClickUp team fetch failure → `502`
- flattened response shape from teams → spaces → folders → lists

Assertions:
- sequence of ClickUp fetches recorded
- final response flattened from real handler path

## 6) `supabase/functions/external-unlink/unlink.test.ts`
Import **`handleUnlinkRequest`**.

Cases:
- ClickUp: Admin OK
- ClickUp: PM-of-project active OK
- ClickUp: PM-of-other-project 403
- ClickUp: inactive PM 403
- ClickUp: Engineer 403
- ClickUp: missing binding 404
- ERPNext: Admin OK
- ERPNext: Operator OK
- ERPNext: PM 403
- ERPNext: no company linked 404
- audit asserted
- soft-archive asserted

---

## Migration plan (keeps suite green)

### Step 0 — add the shared kit
Create:
- `supabase/functions/_shared/testing/edgeTestKit.ts`

No test replacement yet.

### Step 1 — normalize `external-connect/index.ts`
Make the shipped handler a named export:
- `export async function handleConnectRequest(req: Request): Promise<Response>`
- `if (import.meta.main) Deno.serve(handleConnectRequest)`

No DI params. No logic rewrite.

### Step 2 — replace `external-unlink/unlink.test.ts` first
Why first:
- already exports handler
- no external API fetches beyond JWKS + Supabase
- proves the core harness (JWT + REST + RPC + env)

### Step 3 — replace `external-lists/lists.test.ts`
Why second:
- exported handler
- exercises ClickUp external fetch graph
- simpler than link/connect

### Step 4 — replace `external-companies/companies.test.ts`
### Step 5 — replace `external-set-company/set-company.test.ts`
Why middle:
- same ERP credential/Vault pattern
- same SSRF behavior
- easy to share route fixtures

### Step 6 — replace `external-link/link.test.ts`
Why late:
- most complex suite
- includes HEAD count semantics and both ClickUp + ERPNext branches
- benefits from already-proven helpers

### Step 7 — replace `external-connect/connect.test.ts` last
Why last:
- after handler export normalization
- after all route helpers exist
- shares patterns from lists/companies/link

### Step 8 — remove copy-test code
Delete from tests:
- local `handle*WithDeps`
- copied validator functions
- copied SSRF helpers
- comments claiming “full integration is tested elsewhere” for handler behavior

The copied pure-function tests may survive **only** if they import the real pure helper from `index.ts` or a shared module. They must not remain the only proof.

---

## Guardrail so this cannot regress

## Concrete gate
Add:
- `scripts/check-edge-fn-test-binding.mjs`

Run it in CI and locally from the existing verify lane.

### Script contract
For each target test file, require a direct import of the shipped handler symbol from `./index.ts`.

Manifest:

```js
const required = {
  'supabase/functions/external-connect/connect.test.ts': 'handleConnectRequest',
  'supabase/functions/external-companies/companies.test.ts': 'handleCompaniesRequest',
  'supabase/functions/external-set-company/set-company.test.ts': 'handleSetCompanyRequest',
  'supabase/functions/external-link/link.test.ts': 'handleLinkRequest',
  'supabase/functions/external-lists/lists.test.ts': 'handleListsRequest',
  'supabase/functions/external-unlink/unlink.test.ts': 'handleUnlinkRequest',
};
```

### Check logic
Pass if file contains either:
- `import { <symbol> } from './index.ts'`
- or `const { <symbol> } = await import('./index.ts')`

Fail if not.

Optional second check: fail on obvious copy anti-patterns:
- `/handle\w+WithDeps\s*\(/`
- `/async function validateClickUpToken\s*\(/`
- `/async function validateErpNextCredentials\s*\(/`
- `/async function validateErpNextCompany\s*\(/`
- `/function isPrivateOrReservedHost\s*\(/`

### Sketch

```js
// scripts/check-edge-fn-test-binding.mjs
import { readFileSync } from 'node:fs';

const required = {
  'supabase/functions/external-connect/connect.test.ts': 'handleConnectRequest',
  'supabase/functions/external-companies/companies.test.ts': 'handleCompaniesRequest',
  'supabase/functions/external-set-company/set-company.test.ts': 'handleSetCompanyRequest',
  'supabase/functions/external-link/link.test.ts': 'handleLinkRequest',
  'supabase/functions/external-lists/lists.test.ts': 'handleListsRequest',
  'supabase/functions/external-unlink/unlink.test.ts': 'handleUnlinkRequest',
};

const badPatterns = [
  /handle\w+WithDeps\s*\(/,
  /async function validateClickUpToken\s*\(/,
  /async function validateErpNextCredentials\s*\(/,
  /async function validateErpNextCompany\s*\(/,
  /function isPrivateOrReservedHost\s*\(/,
];

let failed = false;
for (const [file, symbol] of Object.entries(required)) {
  const src = readFileSync(file, 'utf8');
  const importsHandler = new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*['\"]\\./index\\.ts['\"]`).test(src)
    || new RegExp(`const\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*=\\s*await\\s*import\\(\\s*['\"]\\./index\\.ts['\"]\\s*\\)`).test(src);
  if (!importsHandler) {
    console.error(`${file}: must import ${symbol} from ./index.ts`);
    failed = true;
  }
  for (const pattern of badPatterns) {
    if (pattern.test(src)) {
      console.error(`${file}: contains copied test-only logic matching ${pattern}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
```

### CI hook
Add a new step in `.github/workflows/ci.yml` verify job:

```yaml
- name: Guard edge-function tests bind to shipped handlers
  run: node scripts/check-edge-fn-test-binding.mjs
```

This is the regression stop: green tests are impossible unless the test file imports the real handler.

---

## Trade-offs / rejected approaches

## Reject: injectable deps params in production handlers
Rejected because it created the current failure mode: tests exercise a second handler shape, not the shipped one.

## Reject: copied validator/helper logic inside tests
Rejected because drift is guaranteed; current green suite already proved that.

## Reject: mocking Supabase client objects
Rejected for these six handlers because the production behavior is HTTP-shaped. Mocking the client recreates PostgREST semantics badly and misses request-shape bugs.

## Keep: fetch-mock at the network boundary
Accepted because it exercises:
- real `verifyCallerJwt`
- real `createRemoteJWKSet`
- real `@supabase/supabase-js` request construction
- real external API URL/header/body construction

## Limitation: this does not replace pgTAP/integration
Fetch-mocked handler tests do **not** prove:
- real RLS
- real SQL/RPC behavior
- real PostgREST encoding edge cases beyond what we assert
- live third-party API contracts

That is fine. These tests own the **handler contract**; pgTAP and integration continue owning DB policy/contract and end-to-end behavior.

## Is fetch-mocking insufficient for any of these six?
**No.** For these six, all meaningful side effects are HTTP via:
- Supabase REST/RPC
- JWKS HTTP fetch
- ClickUp HTTP
- ERPNext HTTP

So fetch-mocking is sufficient for handler-level unit tests here.

---

## Final architecture summary

Write:
- `supabase/functions/_shared/testing/edgeTestKit.ts`
- replace the six existing `*.test.ts` files to import the real handlers
- add `scripts/check-edge-fn-test-binding.mjs`
- add CI step in `.github/workflows/ci.yml`
- normalize `supabase/functions/external-connect/index.ts` to export `handleConnectRequest`

Result:
- tests call the same handler deploy runs
- JWT auth path is real
- Supabase request construction is real
- external API request construction is real
- “green but not shipped” cannot recur silently

TEST-ARCH-DONE
