# Plan — ERPNext write paths resolve the org auth pair from Vault (#651)

- **Issue:** #651 · **Branch/worktree:** `fix/651-erpnext-vault-writers` @
  `.claude/worktrees/651-erpnext-vault-writers`
- **Spec:** `docs/specs/erpnext-adapter-auth-pair-resolution.spec.md` (Addendum A to
  `docs/specs/erpnext-adapter.spec.md`) — **unsigned**; FR-ENA-015..019, NFR-ENA-SEC-005,
  AC-ENA-080..086.
- **ADR:** `docs/adr/0072-erpnext-auth-pair-resolution-fails-closed.md`
- **Tier:** money path ⇒ Director-dispatched, not the ADW (`docs/factory-workflow.md` § Executor routing).
- **DB objects changed:** none. No migration, no RLS, no grant, **no pgTAP**.
- **Out of scope (#650, in parallel):** binding activation, `site_url`, `version_major`,
  `external-connect`, `external-set-company`, `binding.ts`. Do not touch those files. Also out: the #481
  dry-run.

---

## Premises I could not confirm

Stated plainly so nobody inherits them as facts. Each names what I looked at and what would settle it.

1. **`pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts` and
   `supabase/functions/_shared/perOrgSecret.ts` were both unreadable to me** — a path deny rule on this
   session ("File is in a directory that is denied", "Permission to read … has been denied"). Everything
   this plan says about them is reconstructed from **five shipped call sites** (`adapter-dispatch`
   :233/:274/:533, `erpnext-sweep` :660-716/:1857/:2012, `erpnext-onboard` :82-133), their doc comments,
   `docs/specs/external-admin-connect.spec.md` FR-EAC-014/015, and
   `supabase/functions/erpnext-sweep/companyScopedSweep.test.ts:36-42`. Specifically unconfirmed:
   - `resolveErpCredentials(secretRef, getEnv) => { apiKey, apiSecret }` derives
     `<PREFIX>_KEY`/`<PREFIX>_SECRET` from the normalised ref and **throws `AppError` with code
     `config-rejected`** when either is unset. (Call-site comments at `adapter-dispatch/index.ts:204` and
     `erpnext-onboard/index.ts:14` both assert the fail-closed behaviour; FR-EAC-015 asserts the derivation.)
   - `resolvePerOrgSecret({ connectEnabled, orgId, tier, lookupBinding, readVaultSecret })` returns a
     discriminated `{ kind: 'resolved', secret } | { kind: 'no-binding' } | { kind: 'binding-vault-miss' }`.
     Three shipped call sites handle exactly those three. **Whether it can return anything else, and
     whether it catches a throw from a seam closure, is unknown** — the design below is deliberately
     immune to both (flag-after-return, plus an exhaustive fail-closed default).
   - **Whether `resolvePerOrgSecret` calls `readVaultSecret` at all when `lookupBinding` returns `null`.**
     Task 2.1's test will settle it empirically; if it does not, the fixture in that task needs the binding
     row present, which it already has.
   → **Settle by:** the implementer (who is not deny-ruled) reading both files first and correcting any
   snippet below that disagrees. **If a snippet disagrees with the file, the file wins.**

2. **`public.read_vault_secret(text)` is created by no migration in this tree.** I searched
   `supabase/**` for `read_vault_secret` (only `0210` + two pgTAP files + the edge functions) and for
   `p_secret_ref` (only `0147` + the edge functions), and `supabase/migrations/*` case-insensitively for
   `vault` (13 files, none defining it). It nonetheless exists at head — `pmo-portal/src/lib/supabase/
   database.types.ts` lists it and `supabase/tests/external_admin_connect_rls.test.sql` tests 1–4 exercise
   it and pass. **The deciding artifact for its behaviour is that pgTAP file:** unknown ref → `NULL` (no
   error), `authenticated` → 42501, `service_role` → the value. I could not locate where it is defined, and
   I did not run anything. **Task 0.1 measures this on the live local DB before any code changes**, because
   the whole fail-closed branch rests on "missing secret ⇒ clean NULL, not an error".

3. **`external_org_bindings.status`** exists (`0147` filters `status='active'`). #650 owns activation
   semantics; this plan reads only `secret_ref` and does not filter on `status`, exactly as the shipped
   code does. If #650 changes what "the org's binding" means, the resolver's `lookupBinding` closure is
   the one place to follow it.

4. **`AC_ENA_050_TEST_ONLY_KEY` / `E2E_INLINE_KEY` env pairs** are forwarded by
   `scripts/serve-functions.sh:48`, so some e2e specs bind their own `secret_ref` beyond `local-bench`.
   I did not enumerate them all. They are all env-pair refs, so FR-ENA-017 covers them — but the e2e lane
   (Task 8.3) is the proof, not this sentence.

5. I ran **nothing** — no `supabase`, `docker`, `npm`, `deno`, `git`. Every "currently" below is read from
   source at `fix/651-erpnext-vault-writers` on 2026-09-14.

---

## Design

### The shape

One new module, `supabase/functions/_shared/erpAuthPair.ts`, owns ERPNext auth-pair resolution. Every
current resolution point calls it. It goes Vault-first through the **same** `resolvePerOrgSecret` the
inbound poll already uses, falls back to the env pair **only** on a clean "no Vault secret" answer, and
refuses when a store errors.

```
                       ┌─────────────────────────────────────────────┐
  adapter-dispatch     │  _shared/erpAuthPair.ts                     │
   :233 factory   ────▶│                                             │
   :274 outbox    ────▶│  kill-switch? ──no──▶ config-rejected       │
   :533 fiscal    ────▶│      │yes                                   │
                       │  resolvePerOrgSecret(binding, vault)        │
  erpnext-sweep        │      │                                      │
   erpClientForOrg ───▶│  store errored? ──yes─▶ config-rejected     │
   :1857 reconcile ───▶│      │no                                    │
   :2012 fiscal   ────▶│  resolved ──▶ split "key:secret"            │
                       │  no-binding | vault-miss ──▶ env pair       │
  erpnext-onboard ────▶│  anything else ──▶ config-rejected          │
                       └─────────────────────────────────────────────┘
```

### Three decisions worth naming

**1. Why a new `_shared` module rather than fixing each call site.** `adapter-dispatch/index.ts` has an
unguarded `serveWithErrorReporting(...)` at line 616 — importing it in a test starts an HTTP server, which
is why every existing `adapter-dispatch` suite tests a *sibling* module. Resolution logic left in
`index.ts` is untestable by construction, and `scripts/check-edge-fn-test-binding.mjs` exists precisely to
stop the "test a copy" workaround. A shared module is the only shape where the test binds the shipped code.

**2. Why the store-error flag lives in the caller, not the seam.** The obvious fix — `throw` inside the
`readVaultSecret` closure — only works if `resolvePerOrgSecret` propagates it, and I could not read
`perOrgSecret.ts` to check. Setting a flag in the resolver's own scope and checking it **after** the call
gives the guarantee regardless of the shared helper's internals, and keeps five other functions (ClickUp
sweep, ClickUp webhook worker, ERPNext webhook, external-connect, onboard) out of the blast radius of a
money fix. ADR-0072 records changing `perOrgSecret.ts`'s contract as follow-up hygiene, not this issue.

**3. Why `binding-vault-miss` still reaches the env pair.** ClickUp's dispatch fails closed on that kind —
because *its* fallback is one global token, genuinely cross-tenant. ERPNext's fallback is keyed by the
org's own `secret_ref`, and the seeded local bench (`secret_ref = 'local-bench'`, `supabase/seed.sql:456`)
has no Vault secret. Failing closed there deletes the whole serial money e2e lane for no tenancy gain.
The tenancy-relevant case is a store that **could not answer**, and that is what now refuses.

### Scaling note (why Phase 7 exists)

Vault-first turns a free `Deno.env.get` into a Postgres round-trip. Today one sweep tick calls
`erpClientForOrg` **four times per org** (`:740`, `:919`, `:959`, `:996`) plus reconcile (`:1857`) and the
fiscal read (`:2012`); a synchronous money write resolves **three times** (`:233`, `:274`, `:533`). Left
unmemoised that is 6× and 3× the secret reads, per org, per tick/request — at a thousand orgs on a
five-minute cron it is thousands of avoidable RPCs and thousands of avoidable Vault-read audit lines.
An explicit cache object, created per request and per tick and passed in, collapses each to one.
**Not a module-level cache:** a long-lived isolate must not hold one tenant's credential across requests,
and a rotated credential must not outlive a request.

### Test strategy (against `docs/reviews/2026-07-23-p3bc-audit-program.md`)

- **Assert the accepted result, not the request** (lesson 5): the oracle for AC-ENA-080/081 is the
  `Authorization` **header actually sent to the stubbed fetch**, not the resolver's return value.
- **Fakes must be able to express the failure** (lessons 3, 8, 9): the fake Supabase client below returns a
  *different* answer per table and lets each test choose `rpc` → value / clean-null / error. A fake whose
  `rpc` can only return `{data:null,error:null}` structurally cannot see AC-ENA-082.
- **Mutation-check the security branch** (house rule): Task 1.4 breaks the fail-closed branch and requires
  the suite to go red. A green suite over a broken guard is not a suite.
- **What is this guard structurally unable to see?** These tests cannot see the three `adapter-dispatch`
  call sites (unimportable entry file). That hole is covered by `npm run typecheck:edge` (compile-time) and
  AC-ENA-086 (the existing served money e2e, which runs the real function). Both are mandatory gates here,
  not optional.

---

## Tasks

Each is 2–5 minutes. **TDD: the test task before the implementation task, and it must fail for the stated
reason before you write the code.** Never weaken a test to get green.

### Phase 0 — measure before changing (no code)

**Task 0.1 — Prove the local Vault reader answers a clean NULL for the bench ref.**
The entire fail-closed branch assumes "missing Vault secret ⇒ `data: null, error: null`". If instead the
RPC errors (function absent, grant missing, stale schema cache), Phase 2 onward will correctly refuse and
the whole local money lane will go red — and it will be right to.
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/651-erpnext-vault-writers
scripts/with-db-lock.sh bash -c "supabase db reset && \
  psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  \"select to_regprocedure('public.read_vault_secret(text)') is not null as fn_exists,
           public.read_vault_secret('local-bench') is null           as clean_miss;\""
```
**Expected:** `fn_exists = t`, `clean_miss = t`. **If `fn_exists = f`: STOP and report** — the premise in
"Premises" #2 is wrong, the Vault path never works locally, and the plan needs a seeding task first.

**Task 0.2 — Read the two deny-ruled files and reconcile.** Open
`pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts` and
`supabase/functions/_shared/perOrgSecret.ts`. Confirm: `resolveErpCredentials`'s exact signature and its
throw code; `resolvePerOrgSecret`'s exact param + result union; whether it calls `readVaultSecret` when
`lookupBinding` returns `null`. **Write the corrections into this plan's "Premises" section** before
touching code; where the file disagrees with a snippet below, the file wins.
Verify: `git -C . diff --stat docs/plans/2026-09-14-erpnext-vault-writers.md` shows the edit.

### Phase 1 — the shared resolver (TDD)

**Task 1.1 (RED) — write `supabase/functions/_shared/erpAuthPair.test.ts`.** Owns **AC-ENA-083**.
```ts
// AC-ENA-083 (#651) [Deno unit] — the ONE ERPNext auth-pair resolver: Vault first, env pair only on a
// clean negative, refuse when a store cannot answer. Binds the SHIPPED module the edge functions import.
// Verify: cd supabase/functions/erpnext-sweep && deno test ../_shared --config deno.json --allow-env --allow-net --allow-read
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { resolveErpAuthPair, createErpAuthPairCache } from './erpAuthPair.ts';

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

/** A Supabase stand-in whose binding row and `rpc` answer are chosen per test. */
function fakeDb(opts: {
  binding?: { secret_ref: string } | null;
  bindingError?: { code: string } | null;
  vault?: string | null;
  vaultError?: { code: string } | null;
}) {
  let rpcCalls = 0;
  const client = {
    from() {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, eq: () => b,
        maybeSingle: () => Promise.resolve({ data: opts.binding ?? null, error: opts.bindingError ?? null }),
      };
      return b;
    },
    rpc: () => { rpcCalls += 1; return Promise.resolve({ data: opts.vault ?? null, error: opts.vaultError ?? null }); },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls: () => rpcCalls };
}

function stubEnv(values: Record<string, string>) {
  const original = Deno.env.get;
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k: string) => values[k];
  return { restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

const ORG = { orgId: '00000000-0000-4000-8000-0000000000aa', secretRef: 'local-bench' };

Deno.test('AC-ENA-083: no Vault secret and no env pair -> config-rejected', async () => {
  const db = fakeDb({ binding: { secret_ref: 'local-bench' }, vault: null });
  const env = stubEnv({});
  try {
    await resolveErpAuthPair(db.client, ORG);
    throw new Error('should have refused');
  } catch (e) {
    assert(e instanceof AppError, `expected AppError, got ${e}`);
    assert((e as AppError).code === 'config-rejected', `expected config-rejected, got ${(e as AppError).code}`);
  } finally { env.restore(); }
});

Deno.test('#651: a Vault hit is split into the api key/secret pair', async () => {
  const db = fakeDb({ binding: { secret_ref: 'org-a-erpnext' }, vault: 'vault-key:vault-secret' });
  const env = stubEnv({});
  try {
    const pair = await resolveErpAuthPair(db.client, { orgId: ORG.orgId, secretRef: 'org-a-erpnext' });
    assert(pair.apiKey === 'vault-key' && pair.apiSecret === 'vault-secret', `got ${JSON.stringify(pair)}`);
  } finally { env.restore(); }
});

Deno.test('#651: a malformed Vault value is refused whole, never partially used', async () => {
  const db = fakeDb({ binding: { secret_ref: 'org-a-erpnext' }, vault: 'no-colon-here' });
  const env = stubEnv({ LOCAL_BENCH_KEY: 'env-k', LOCAL_BENCH_SECRET: 'env-s' });
  try {
    await resolveErpAuthPair(db.client, { orgId: ORG.orgId, secretRef: 'org-a-erpnext' });
    throw new Error('should have refused');
  } catch (e) {
    assert(e instanceof AppError && (e as AppError).code === 'config-rejected', `got ${e}`);
  } finally { env.restore(); }
});

Deno.test('AC-ENA-082 (unit half): a binding-lookup ERROR refuses and never reads the env pair', async () => {
  const db = fakeDb({ bindingError: { code: '57P01' }, vault: null });
  const env = stubEnv({ LOCAL_BENCH_KEY: 'env-k', LOCAL_BENCH_SECRET: 'env-s' });
  try {
    await resolveErpAuthPair(db.client, ORG);
    throw new Error('should have refused — an unreadable store is not "no secret"');
  } catch (e) {
    assert(e instanceof AppError && (e as AppError).code === 'config-rejected', `got ${e}`);
  } finally { env.restore(); }
});

Deno.test('FR-ENA-019: the kill-switch refuses before any store read', async () => {
  const db = fakeDb({ binding: { secret_ref: 'local-bench' }, vault: 'k:s' });
  const env = stubEnv({ EXTERNAL_CONNECT_ENABLED: 'false' });
  try {
    await resolveErpAuthPair(db.client, ORG);
    throw new Error('should have refused');
  } catch (e) {
    assert(e instanceof AppError && (e as AppError).code === 'config-rejected', `got ${e}`);
    assert(db.rpcCalls() === 0, 'the kill-switch must refuse BEFORE reading the secret store');
  } finally { env.restore(); }
});

Deno.test('FR-ENA-019: a cache resolves once per org and re-resolves after a failure', async () => {
  const db = fakeDb({ binding: { secret_ref: 'org-a-erpnext' }, vault: 'k:s' });
  const env = stubEnv({});
  const cache = createErpAuthPairCache();
  try {
    await resolveErpAuthPair(db.client, { orgId: ORG.orgId, secretRef: 'org-a-erpnext' }, cache);
    await resolveErpAuthPair(db.client, { orgId: ORG.orgId, secretRef: 'org-a-erpnext' }, cache);
    assert(db.rpcCalls() === 1, `expected 1 vault read, got ${db.rpcCalls()}`);
  } finally { env.restore(); }
});
```
Verify (must FAIL with "Module not found … erpAuthPair.ts"):
`cd supabase/functions/erpnext-sweep && deno test ../_shared --config deno.json --allow-env --allow-net --allow-read`

**Task 1.2 (GREEN) — create `supabase/functions/_shared/erpAuthPair.ts`.**
```ts
/**
 * THE ERPNext auth-pair resolver (#651, FR-ENA-015..019, ADR-0072).
 *
 * ONE resolver for BOTH directions. Before this, the inbound poll resolved Vault-first while every
 * outbound write resolved from the environment only, so an org connected through the shipped connect
 * flow (credential in Vault) could read and could not push.
 *
 * Order: kill-switch → Vault (via the shared `resolvePerOrgSecret`) → env pair → refuse.
 *
 * ⚑ THE FAIL-CLOSED RULE (FR-ENA-018). `resolvePerOrgSecret`'s seams report BOTH "no such secret" and
 * "the store errored" as `null`, and only the FIRST may license the env fallback: an unreadable store is
 * not evidence that this org has no Vault credential, and the env pair is selected by a string, not by an
 * authenticated tenancy check. The failure is recorded in a flag HERE and checked AFTER the call — not
 * thrown from inside the seam — so the refusal does not depend on whether `perOrgSecret.ts` propagates a
 * thrown seam error.
 *
 * ⚑ NO MODULE-LEVEL CACHE. The cache is an explicit object created per request / per sweep tick and
 * passed in: a long-lived isolate must not hold one tenant's credential across requests, and a rotated
 * credential must not outlive a request.
 *
 * NFR-ENA-SEC-005: no credential value is logged, returned in an error body, or persisted. A store
 * failure is logged by its error CODE only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { resolveErpCredentials } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts';
import { resolvePerOrgSecret } from './perOrgSecret.ts';
import { externalConnectEnabled } from './externalConnectEnabled.ts';

export interface ErpAuthPair {
  apiKey: string;
  apiSecret: string;
}

/** Per-request / per-tick memo, keyed by org id. Create one, pass it to every call in that unit of work. */
export type ErpAuthPairCache = Map<string, Promise<ErpAuthPair>>;
export function createErpAuthPairCache(): ErpAuthPairCache {
  return new Map();
}

export interface ErpAuthPairOrg {
  orgId: string;
  /** The binding's `secret_ref` — names the env pair for the local/dev fallback (FR-ENA-017). */
  secretRef: string;
}

export async function resolveErpAuthPair(
  serviceClient: SupabaseClient,
  org: ErpAuthPairOrg,
  cache?: ErpAuthPairCache,
): Promise<ErpAuthPair> {
  if (!cache) return await resolveUncached(serviceClient, org);
  const hit = cache.get(org.orgId);
  if (hit) return await hit;
  const pending = resolveUncached(serviceClient, org);
  cache.set(org.orgId, pending);
  try {
    return await pending;
  } catch (err) {
    // Never cache a refusal: a store hiccup must not disable this org for the rest of the tick.
    cache.delete(org.orgId);
    throw err;
  }
}

async function resolveUncached(serviceClient: SupabaseClient, org: ErpAuthPairOrg): Promise<ErpAuthPair> {
  if (!externalConnectEnabled()) {
    throw new AppError('external integrations are disabled by the operator', 'config-rejected');
  }
  if (!org.orgId) {
    throw new AppError('ERPNext credentials unresolved: no org in scope', 'config-rejected');
  }

  let storeUnavailable = false;

  const result = await resolvePerOrgSecret({
    connectEnabled: true,
    orgId: org.orgId,
    tier: 'erpnext',
    lookupBinding: async (orgId: string, tier: string) => {
      const { data, error } = await serviceClient
        .from('external_org_bindings')
        .select('secret_ref')
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .maybeSingle();
      if (error) {
        storeUnavailable = true;
        console.error('external_org_bindings lookup failed', error.code ?? 'unknown');
        return null;
      }
      return data as { secret_ref?: string | null } | null;
    },
    readVaultSecret: async (ref: string) => {
      const { data, error } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
      if (error) {
        storeUnavailable = true;
        console.error('read_vault_secret failed', error.code ?? 'unknown');
        return null;
      }
      return (data as string | null) ?? null;
    },
  });

  if (storeUnavailable) {
    throw new AppError(
      "could not determine this org's ERPNext credentials (secret store unavailable)",
      'config-rejected',
    );
  }

  if (result.kind === 'resolved') return splitAuthPair(result.secret);

  if (result.kind === 'no-binding' || result.kind === 'binding-vault-miss') {
    // The store ANSWERED, and it holds no Vault secret for this binding. This — and only this — is the
    // local/dev fallback (FR-ENA-017): the `<PREFIX>_KEY`/`<PREFIX>_SECRET` pair named by the org's OWN
    // secret_ref. `local-bench` (supabase/seed.sql) and the serial money e2e lane live here.
    return resolveErpCredentials(org.secretRef, (key) => Deno.env.get(key));
  }

  // An unrecognised result kind is a store we do not understand — refuse, never guess.
  throw new AppError("could not determine this org's ERPNext credentials", 'config-rejected');
}

function splitAuthPair(secret: string): ErpAuthPair {
  const idx = secret.indexOf(':');
  if (idx <= 0 || idx >= secret.length - 1) {
    throw new AppError('ERPNext credential format invalid (expected apiKey:apiSecret)', 'config-rejected');
  }
  return { apiKey: secret.slice(0, idx), apiSecret: secret.slice(idx + 1) };
}
```
Verify (all 6 must pass):
`cd supabase/functions/erpnext-sweep && deno test ../_shared --config deno.json --allow-env --allow-net --allow-read`

**Task 1.3 — typecheck the new module in every consumer's config.**
Verify: `cd pmo-portal && npm run typecheck:edge`

**Task 1.4 (MUTATION) — prove the fail-closed branch is load-bearing.**
Temporarily change `if (storeUnavailable) {` to `if (false) {` in `erpAuthPair.ts`. Re-run Task 1.2's
verify command. The **"AC-ENA-082 (unit half)"** test MUST go red. Revert the mutation and re-run: green.
If it stayed green, the test is dead — fix the test, not the code.

### Phase 2 — the sweep's poll path uses the one resolver

**Task 2.1 (RED) — create `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts`.** Owns **AC-ENA-080,
AC-ENA-081, AC-ENA-082**. Drives the SHIPPED `sweepOrgDoctypesLive` and asserts the header actually sent.
```ts
/**
 * AC-ENA-080 / AC-ENA-081 / AC-ENA-082 (#651) [Deno unit] — the ERPNext auth pair the SHIPPED sweep
 * actually SENDS. The oracle is the outgoing `Authorization` header, not the resolver's return value:
 * asserting the return proves the resolver, not the wiring (p3bc audit lesson 5).
 *
 * Verify: cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepOrgDoctypesLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

const ORG = '00000000-0000-4000-8000-0000000000aa';

function orgBinding(secretRef: string) {
  return {
    orgId: ORG, siteUrl: 'https://erp.example.test', secretRef,
    company: 'PMO Smoke Co', config: {}, ownedDomains: ['revenue'], versionMajor: 15,
  };
}

/** Binding row + Vault answer are chosen per test; `rpc` can return a value, a clean null, or an ERROR. */
function fakeDb(opts: { secretRef: string; vault?: string | null; vaultError?: { code: string } | null }) {
  let rpcCalls = 0;
  const empty = { data: [] as unknown[], error: null };
  const client = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, eq: () => b, in: () => b, is: () => b, not: () => b,
        insert: () => b, update: () => b, upsert: () => b,
        limit: () => Promise.resolve(empty),
        maybeSingle: () => Promise.resolve(
          table === 'external_org_bindings'
            ? { data: { secret_ref: opts.secretRef }, error: null }
            : { data: null, error: null },
        ),
        then: (resolve: (v: unknown) => void) => resolve(empty),
      };
      return b;
    },
    rpc: () => {
      rpcCalls += 1;
      return Promise.resolve({ data: opts.vault ?? null, error: opts.vaultError ?? null });
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls: () => rpcCalls };
}

function stubEnv(values: Record<string, string>) {
  const original = Deno.env.get;
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k: string) => values[k];
  return { restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

/** Records every outgoing Authorization header; serves an empty list to each doctype poll. */
function stubErpFetch() {
  const original = globalThis.fetch;
  const auth: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    auth.push(h.get('Authorization') ?? '');
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }) as typeof fetch;
  return { auth, calls: () => auth.length, restore: () => { globalThis.fetch = original; } };
}

Deno.test('AC-ENA-080: a Vault-issued pair is the one SENT to ERPNext', async () => {
  const db = fakeDb({ secretRef: 'org-a-erpnext', vault: 'vault-key:vault-secret' });
  const env = stubEnv({});
  const erp = stubErpFetch();
  try {
    await sweepOrgDoctypesLive(db.client, orgBinding('org-a-erpnext'));
    assert(erp.calls() > 0, 'the poll must have issued at least one ERP request');
    assert(
      erp.auth.every((a) => a === 'token vault-key:vault-secret'),
      `every request must carry the Vault pair — got ${JSON.stringify(erp.auth)}`,
    );
  } finally { erp.restore(); env.restore(); }
});

Deno.test('AC-ENA-081: no Vault secret + env pair present -> the env pair is SENT (the local bench)', async () => {
  const db = fakeDb({ secretRef: 'local-bench', vault: null });
  const env = stubEnv({ LOCAL_BENCH_KEY: 'bench-k', LOCAL_BENCH_SECRET: 'bench-s' });
  const erp = stubErpFetch();
  try {
    await sweepOrgDoctypesLive(db.client, orgBinding('local-bench'));
    assert(erp.calls() > 0, 'the poll must have issued at least one ERP request');
    assert(
      erp.auth.every((a) => a === 'token bench-k:bench-s'),
      `every request must carry the env pair — got ${JSON.stringify(erp.auth)}`,
    );
  } finally { erp.restore(); env.restore(); }
});

Deno.test('AC-ENA-082: a Vault READ ERROR refuses — it never falls through to the env pair', async () => {
  const db = fakeDb({ secretRef: 'local-bench', vault: null, vaultError: { code: '57P01' } });
  const env = stubEnv({ LOCAL_BENCH_KEY: 'bench-k', LOCAL_BENCH_SECRET: 'bench-s' });
  const erp = stubErpFetch();
  try {
    await sweepOrgDoctypesLive(db.client, orgBinding('local-bench'));
    throw new Error('an unreadable secret store must refuse, not fall back to the environment');
  } catch (e) {
    assert(e instanceof AppError, `expected AppError, got ${e}`);
    assert((e as AppError).code === 'config-rejected', `expected config-rejected, got ${(e as AppError).code}`);
    assert(erp.calls() === 0, `no ERP request may be issued — got ${JSON.stringify(erp.auth)}`);
  } finally { erp.restore(); env.restore(); }
});
```
Verify (AC-ENA-080 and AC-ENA-082 must FAIL now — today the Vault hit is used but a read ERROR silently
falls back to env; AC-ENA-081 should already pass):
`cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read`

> If AC-ENA-080 already passes, that is expected — `erpClientForOrg` is already Vault-first. AC-ENA-082 is
> the one that must be red. If AC-ENA-082 is green before Task 2.2, stop: the fixture is not reaching the
> code path (check that `maybeSingle` is answering the binding lookup).

**Task 2.2 (GREEN) — replace `erpClientForOrg`'s body in `supabase/functions/erpnext-sweep/index.ts`.**
Replace the whole function (currently lines ~657–716, the comment block through the closing brace) with:
```ts
// #651 / ADR-0072: ONE resolver for both directions — `_shared/erpAuthPair.ts`. The inline Vault-first
// block that used to live here (and its env-fallback-on-vault-error) is gone: a store that cannot answer
// now refuses (FR-ENA-018). `cache` is optional so the per-pass unit tests keep their two-arg call.
async function erpClientForOrg(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  cache?: ErpAuthPairCache,
): Promise<ErpClientDeps> {
  const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, org, cache);
  return { fetchImpl: fetch, apiKey, apiSecret, baseUrl: org.siteUrl };
}
```
Add to the import block (next to the existing `import { resolvePerOrgSecret } from '../_shared/perOrgSecret.ts';`
at line ~95):
```ts
import { resolveErpAuthPair, createErpAuthPairCache, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
```
Do **not** remove the `resolveErpCredentials` / `resolvePerOrgSecret` / `externalConnectEnabled` imports
yet — later tasks still reference them; the last task of Phase 3 removes whatever `deno check` then reports
as unused.
Verify: `cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read`
— all three new tests green **and** every pre-existing sweep test still green (`companyScopedSweep`,
`sweepWedge`, `outboxRecovery`, `replayReauthorization`, `budgetBackstop`, `timesheetBackstop`).

### Phase 3 — the sweep's write paths

**Task 3.1 (RED) — add the AC-ENA-084 case to `vaultAuthPair.test.ts`.** A Vault-only org (no env pair at
all) can have its outbox candidate's dispatch deps built — today it cannot.
```ts
Deno.test('AC-ENA-084: a VAULT-ONLY org can build its outbox reconcile deps (the write path)', async () => {
  const { buildReconcileDepsLive } = await import('./index.ts');
  const outboxRow = {
    operation: 'create',
    payload: { id: 'pmo-1', erp_doc_kind: 'purchase-invoice' },
    actor_user_id: '00000000-0000-4000-8000-0000000000a1',
  };
  let rpcCalls = 0;
  const client = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, eq: () => b, in: () => b, is: () => b, not: () => b,
        insert: () => b, update: () => b, upsert: () => b,
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve(
          table === 'external_command_outbox' ? { data: outboxRow, error: null }
          : table === 'external_org_bindings' ? { data: { secret_ref: 'org-a-erpnext' }, error: null }
          : { data: null, error: null },
        ),
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return b;
    },
    rpc: () => { rpcCalls += 1; return Promise.resolve({ data: 'vault-key:vault-secret', error: null }); },
  } as unknown as SupabaseClient;
  const env = stubEnv({}); // NO env pair exists for this org — Vault is the only source
  const erp = stubErpFetch();
  try {
    const deps = await buildReconcileDepsLive(client, orgBinding('org-a-erpnext'), {
      id: 'outbox-1', domain: 'procurement', pmoRecordId: 'pmo-1', idempotencyKey: 'idem-1',
      state: 'pending', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null,
    } as unknown as Parameters<typeof buildReconcileDepsLive>[2]);
    assert(!!deps, 'a Vault-only org must be able to build its reconcile deps');
    assert(rpcCalls > 0, 'the pair must have come from the Vault reader');
  } finally { erp.restore(); env.restore(); }
});
```
Verify (must FAIL — today line 1857 reads the env only, so `resolveErpCredentials` throws
`config-rejected` with no env pair):
`cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read`

> The replay-authorization guard runs before line 1857; if this test fails on authorization rather than on
> credentials, mirror the fixture shape used by `replayReauthorization.test.ts` (same directory) — do not
> weaken the guard.

**Task 3.2 (GREEN) — `erpnext-sweep/index.ts` line ~1857, the outbox reconcile.**
Before: `const { apiKey, apiSecret } = resolveErpCredentials(org.secretRef, (key) => Deno.env.get(key));`
After: `const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, org, cache);`
and change the enclosing signature to
`export async function buildReconcileDepsLive(serviceClient: SupabaseClient, org: OrgBinding, row: OutboxRow, cache?: ErpAuthPairCache): Promise<DispatchMoneyWriteDeps>`.
Verify: `cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read`

**Task 3.3 — `erpnext-sweep/index.ts` line ~2010, the sweep's fiscal-calendar read.**
Change the signature and the first line:
```ts
/** The client's OWN fiscal calendar, read live (the same doctype read the foreground gate makes). */
async function readErpFiscalYearsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  cache?: ErpAuthPairCache,
): Promise<FiscalYearRow[]> {
  const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, org, cache);
```
and its only call site (line ~1992, inside `assertBudgetSweepGate`):
`readFiscalYears: () => readErpFiscalYearsLive(serviceClient, org, cache),`
Give `assertBudgetSweepGate` the same optional trailing `cache?: ErpAuthPairCache` parameter and pass
`cache` from `buildReconcileDepsLive`'s call to it (line ~1847: `await assertBudgetSweepGate(serviceClient, org, payload, cache);`).
Verify: `cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read`

**Task 3.4 — drop now-unused imports in `erpnext-sweep/index.ts`.**
`resolveErpCredentials` and `resolvePerOrgSecret` should have no remaining references in this file (the
`externalConnectEnabled` import may also be unused — the resolver owns the kill-switch now). Remove only
what has zero references; `deno check` is the arbiter, not this sentence.
Verify: `cd pmo-portal && npm run typecheck:edge` (zero errors) and
`grep -n 'resolveErpCredentials\|resolvePerOrgSecret' supabase/functions/erpnext-sweep/index.ts` prints
nothing.

### Phase 4 — `adapter-dispatch`'s three write-side call sites

**Task 4.1 — thread a per-request cache into `supabase/functions/adapter-dispatch/index.ts`.**
(a) Import, next to the existing `resolvePerOrgSecret` import at line ~54:
```ts
import { resolveErpAuthPair, createErpAuthPairCache, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
```
(b) Add to `interface AdapterSelectContext` (line ~113), after `faultGate`:
```ts
  /** #651: the per-REQUEST auth-pair memo. Not module-level — a shared isolate must never hold one
   *  tenant's credential across requests, and a rotated credential must not outlive a request. */
  erpAuth: ErpAuthPairCache;
```
(c) In the handler, immediately after `const serviceClient = createClient(supabaseUrl, serviceRoleKey, testSupabaseOptions);`
(line ~797): `const erpAuth = createErpAuthPairCache();`
(d) Add `erpAuth` to both `AdapterSelectContext` literals — line ~1188
`adapterFactory({ orgId, command, serviceClient, faultGate, userId, erpAuth })` and line ~1194
`resolveErpMoneyOutboxDeps({ orgId, command, serviceClient, faultGate, userId, erpAuth })`.
Verify: `cd pmo-portal && npm run typecheck:edge` (zero errors — the field is required, so the compiler
finds any literal missed).

**Task 4.2 — `adapter-dispatch/index.ts` line ~233, the adapter factory.**
Before: `const { apiKey, apiSecret } = resolveErpCredentials(binding.secret_ref, (key) => Deno.env.get(key));`
After: `const { apiKey, apiSecret } = await resolveErpAuthPair(ctx.serviceClient, { orgId: ctx.orgId, secretRef: binding.secret_ref }, ctx.erpAuth);`
Verify: `cd pmo-portal && npm run typecheck:edge`

**Task 4.3 — `adapter-dispatch/index.ts` line ~274, the money-outbox deps.**
Same substitution, same expression (the enclosing `resolveErpMoneyOutboxDeps` is already `async`).
Verify: `cd pmo-portal && npm run typecheck:edge`

**Task 4.4 — `adapter-dispatch/index.ts` line ~533, the budget gate's fiscal-calendar read.**
(a) `async function readErpFiscalYears(serviceClient: SupabaseClient, orgId: string, cache: ErpAuthPairCache): Promise<FiscalYearRow[]>`
and inside, after `const binding = await resolveErpBindingRow(serviceClient, orgId);`:
```ts
  const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, { orgId, secretRef: binding.secret_ref }, cache);
```
(b) `buildBudgetGateDeps(callerClient, serviceClient, orgId, versionId)` (line ~493) takes a fifth
parameter `erpAuth: ErpAuthPairCache`, and its `readFiscalYears` line (~514) becomes
`readFiscalYears: () => readErpFiscalYears(serviceClient, orgId, erpAuth),`.
(c) Its call site (line ~846) becomes
`const gate = await runBudgetGate(buildBudgetGateDeps(callerClient, serviceClient, orgId, versionId, erpAuth));`
Verify: `cd pmo-portal && npm run typecheck:edge`

**Task 4.5 — remove `adapter-dispatch`'s now-unused `resolveErpCredentials` import** (line ~46), only if
zero references remain (`resolvePerOrgSecret` stays — ClickUp still uses it).
Verify: `grep -n 'resolveErpCredentials' supabase/functions/adapter-dispatch/index.ts` prints nothing, and
`cd supabase/functions/adapter-dispatch && deno test . --config deno.json --allow-env --allow-net --allow-read`
is green.

### Phase 5 — `erpnext-onboard` (behaviour delta — see spec §A.6)

**Task 5.1 — collapse `erpnext-onboard/index.ts` lines ~80–133 to the shared resolver.**
Replace the whole `let apiKey / let apiSecret / const connectEnabled = …` block through the closing `}` of
the `else` branch with:
```ts
    // #651 / ADR-0072: the ONE resolver (Vault first, env pair only on a clean negative, refuse when the
    // store cannot answer). ⚑ Behaviour delta, deliberate: onboarding now honours the operator
    // kill-switch like every other ERPNext path (spec addendum §A.6).
    const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, { orgId, secretRef: binding.secret_ref });
```
Replace the three credential imports (lines 24–26) with:
```ts
import { resolveErpAuthPair } from '../_shared/erpAuthPair.ts';
```
and drop the `externalConnectEnabled` import (line 27) if it has no other reference.
Verify: `cd pmo-portal && npm run typecheck:edge` and
`cd supabase/functions/erpnext-onboard && deno test . --config deno.json --allow-env --allow-net --allow-read`

> **Director gate:** if the kill-switch delta is unwanted, skip this task entirely. Nothing else depends
> on it, and FR-ENA-015 then carries a named exception.

### Phase 6 — one resolution per tick (FR-ENA-019, AC-ENA-085)

**Task 6.1 (RED) — add the AC-ENA-085 case to `vaultAuthPair.test.ts`.**
```ts
Deno.test('AC-ENA-085: ONE secret resolution per org per sweep tick, not one per pass', async () => {
  const { runErpSweepCycle } = await import('./index.ts');
  const db = fakeDb({ secretRef: 'org-a-erpnext', vault: 'vault-key:vault-secret' });
  const env = stubEnv({});
  const erp = stubErpFetch();
  const cache = (await import('../_shared/erpAuthPair.ts')).createErpAuthPairCache();
  const org = orgBinding('org-a-erpnext');
  try {
    await runErpSweepCycle({
      listEmployingOrgs: () => Promise.resolve([org]),
      reconcileOrgOutbox: () => Promise.resolve({ driven: 0, errors: [] } as never),
      sweepOrgDoctypes: (o) => (sweepOrgDoctypesLive as unknown as
        (c: SupabaseClient, o: unknown, k: unknown) => Promise<{ applied: number }>)(db.client, o, cache),
      feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 }),
      refreshOrgAccounting: () => Promise.resolve({}),
    });
    assert(db.rpcCalls() === 1, `expected ONE vault read for the tick, got ${db.rpcCalls()}`);
  } finally { erp.restore(); env.restore(); }
});
```
Verify (must FAIL — `sweepOrgDoctypesLive` does not yet accept a cache):
`cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read`

**Task 6.2 (GREEN) — give the four `erpClientForOrg` callers an optional cache parameter.**
In `erpnext-sweep/index.ts`, add `cache?: ErpAuthPairCache` as the trailing parameter of
`sweepOrgDoctypesLive` (line ~739), `repairOrgLinksLive` (~918), `feedOrgLedgersLive` (~958) and
`refreshOrgAccountingLive` (~995), and pass it through at each `await erpClientForOrg(serviceClient, org)`
call (lines ~740, ~919, ~959, ~996 → `await erpClientForOrg(serviceClient, org, cache)`). Optional so
every existing two-argument call in the sibling test files still compiles.
Verify: `cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read`

**Task 6.3 — create the tick's cache in the serve handler and thread it.**
In `erpnext-sweep/index.ts` at line ~1770, add `const erpAuth = createErpAuthPairCache();` above
`const listCandidates = …`, then pass it in the `runErpSweepCycle({...})` literal (lines ~1771–1780):
```ts
    reconcileOrgOutbox: (org) => reconcileOrgOutbox(listCandidates, org, (row) => buildReconcileDepsLive(serviceClient, org, row, erpAuth)),
    sweepOrgDoctypes: (org) => sweepOrgDoctypesLive(serviceClient, org, erpAuth),
    repairOrgLinks: (org) => repairOrgLinksLive(serviceClient, org, erpAuth),
    feedOrgLedgers: (org) => feedOrgLedgersLive(serviceClient, org, erpAuth),
    refreshOrgAccounting: (org) => refreshOrgAccountingLive(serviceClient, org, erpAuth),
```
Leave `reconcileOrgBudgetPushes` / `reconcileOrgTimesheetPushes` untouched — they route through
`dispatchMoneyWrite`, not `erpClientForOrg`.
Verify: `cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read`
(AC-ENA-085 green) and `cd pmo-portal && npm run typecheck:edge`.

> **Cache scope check (do this by reading, not by grepping):** the cache is created inside the serve
> handler, so it lives for one tick and is never shared between ticks or between isolate invocations. If
> you find yourself hoisting it to module scope for convenience, stop — ADR-0072 decision 5 forbids it.

### Phase 7 — mutation re-check and the whole gate

**Task 7.1 (MUTATION, security-critical) — re-break the fail-closed branch with the full wiring in place.**
`if (storeUnavailable) {` → `if (false) {` in `_shared/erpAuthPair.ts`; run the **sweep** suite. AC-ENA-082
MUST go red. Revert; green. (Task 1.4 proved the unit; this proves the wired path — the p3bc lesson is that
a fix can disarm a neighbouring oracle.)
Verify: `cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read`

**Task 7.2 — the whole Deno inventory, exactly as CI runs it.**
Verify: `bash scripts/deno-test-edge-fns.sh`

**Task 7.3 — the full app gate.**
Verify: `cd pmo-portal && npm run verify:locked` (13+ gates — read `package.json`'s `verify`, don't trust
a count). Zero typecheck errors, zero lint errors, `check:edge-test-binding` green.

**Task 7.4 — the served money e2e lane against the bench (AC-ENA-086, the regression gate).**
This is the only proof that `adapter-dispatch`'s three rewritten call sites work in a real function.
```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/651-erpnext-vault-writers
scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
  npx playwright test e2e/serial/AC-ENA-053-pi-payment.spec.ts e2e/serial/AC-ENA-013-pi-recovery-adopt.spec.ts
```
Requires the Docker ERPNext v15 bed (`docs/environments.md` § ERPNext v15 dev bed) and
`LOCAL_BENCH_KEY`/`LOCAL_BENCH_SECRET` exported (forwarded by `scripts/serve-functions.sh:48`). **If the
bench is unavailable, say so explicitly in the handoff** — AC-ENA-086 is then unproven and the issue is
not done.

**Task 7.5 — pre-PR promotion gate.**
Verify: `scripts/verify-main-pr.sh` from the worktree root (its own copy — it roots itself by its path).

---

## Traceability

| AC | Owning layer | File | Task that writes it |
|---|---|---|---|
| AC-ENA-080 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` | 2.1 |
| AC-ENA-081 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` | 2.1 |
| AC-ENA-082 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` | 2.1 (mutation-checked 1.4 + 7.1) |
| AC-ENA-083 | Deno unit | `supabase/functions/_shared/erpAuthPair.test.ts` | 1.1 |
| AC-ENA-084 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` | 3.1 |
| AC-ENA-085 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` | 6.1 |
| AC-ENA-086 | Regression gate (existing e2e) | `pmo-portal/e2e/serial/AC-ENA-053-pi-payment.spec.ts` + siblings | 7.4 (runs it; writes nothing) |

**pgTAP: none.** No DB object is added, altered or dropped. `read_vault_secret`'s contract is unchanged and
already owned by `supabase/tests/external_admin_connect_rls.test.sql` tests 1–4.

## Files touched

| File | Change |
|---|---|
| `supabase/functions/_shared/erpAuthPair.ts` | **new** — the one resolver |
| `supabase/functions/_shared/erpAuthPair.test.ts` | **new** — AC-ENA-083 + kill-switch + malformed-value + cache |
| `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` | **new** — AC-ENA-080/081/082/084/085 |
| `supabase/functions/erpnext-sweep/index.ts` | `erpClientForOrg` body; `:1857`; `:2010`; 4 pass signatures; serve wiring; imports |
| `supabase/functions/adapter-dispatch/index.ts` | ctx field + per-request cache; `:233`; `:274`; `:533` + `buildBudgetGateDeps` + `:846`; imports |
| `supabase/functions/erpnext-onboard/index.ts` | `:80–133` collapsed to the resolver; imports *(skippable — Director gate)* |
| `docs/specs/erpnext-adapter-auth-pair-resolution.spec.md` | already written (this plan's spec) |
| `docs/adr/0072-erpnext-auth-pair-resolution-fails-closed.md` | already written |

**Do not touch:** `external-connect/`, `external-set-company/`, `binding.ts`, any migration, `adws/`.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | The local Vault reader **errors** instead of returning a clean NULL ⇒ fail-closed takes the whole local money lane red | Task 0.1 measures it **before** any code change; a red there stops the plan |
| 2 | An unreadable Vault in production now stops every ERPNext direction (today it silently falls back) | Deliberate, ADR-0072; refusal is classified + logged by code; the sweep's per-org try/catch contains it to one org |
| 3 | `resolvePerOrgSecret`'s real contract differs from the reconstruction (unreadable file) | Task 0.2 reads it first; the exhaustive-default + flag-after-return design survives most differences; Task 2.1's test is empirical |
| 4 | Five call sites and seven signatures across two money files — a missed one keeps the old path silently | The `AdapterSelectContext` field is **required** (compiler finds every literal); Task 3.4/4.5 grep-assert zero remaining `resolveErpCredentials` references |
| 5 | The new tests pass while the shipped path is untouched (the recurring "green but not shipped" failure) | Both suites import the SHIPPED module/function; the oracle is the `Authorization` header actually sent; two mutation checks (1.4, 7.1) |
| 6 | `erpnext-onboard`'s kill-switch delta surprises an operator | Named in spec §A.6 and ADR-0072; the task is skippable |

## Director rulings (2026-09-14, before build)

- **Premise 2 is wrong — corrected:** `public.read_vault_secret(text)` is created by
  `supabase/migrations/0118_vault_secret_admin_connect.sql:28` (security definer; `revoke all … from public`,
  `grant execute … to service_role` at `:39-40`); `0210` only re-pins its grants. The planner's grep missed it.
  Task 0.1 still runs — the live answer for an unknown ref is the fact, the file is the claim.
- **Q1 fold or link:** link. The sibling spec file stays; `docs/specs/<feature>.spec.md` is the convention anyway.
- **Q2 `erpnext-onboard` kill-switch (Task 5.1):** **out of this slice.** Onboard is operator-run; it may call the
  shared resolver only if its observable behaviour (incl. running with external integrations switched off) is
  unchanged — otherwise leave it on its current path and say so. No behaviour delta ships under a money fix.
- **Q3 `perOrgSecret.ts` fourth result kind:** follow-up hygiene, its own issue after this lands. Do not widen.
- **Q4 Vault-only everywhere:** not now. The env pair stays the explicit local fallback per FR-ENA-017.
- **Phase 6 (one resolution per tick/request) stays** — the 6×/3× read amplification is real and the fix is a
  request-scoped object, not a module cache. Phase 7's mutation re-check is mandatory, not optional.
- **The builder can read `credentials.ts` / `perOrgSecret.ts` / `vaultCredentials.ts`** (the deny rule is on the
  Director's session, not the repo). Task 0.2 is therefore first, and every snippet below yields to the file.

## Open questions for the Director

1. **Fold or link?** The spec addendum could not be appended to `erpnext-adapter.spec.md` (my Edit tool was
   disabled; rewriting 1110 partially-read lines was the only alternative). It is a linked sibling file. Fold
   it in, or leave it?
2. **`erpnext-onboard` and the kill-switch** (Task 5.1) — accept the alignment, or keep onboarding able to
   run on env credentials while external integrations are switched off?
3. **`perOrgSecret.ts`'s contract.** The clean fix is a fourth result kind, `store-error`, instead of a
   caller-side flag — but it is shared by six functions across three tiers. File as follow-up hygiene?
4. **Vault-only, eventually?** ADR-0061 pushed per-org secrets to Vault-only and this plan keeps a named env
   fallback for the local bench. If the house wants Vault-only everywhere, it needs a `local-bench` Vault
   seeding story first (the pattern exists — `supabase/seed.sql` already seeds `DEMO_ERP_WEBHOOK_SECRET`
   via `vault.create_secret`), and it is its own issue.
