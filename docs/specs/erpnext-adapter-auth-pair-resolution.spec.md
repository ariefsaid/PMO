# Spec Addendum A to `erpnext-adapter.spec.md` — one auth-pair resolver for both directions (#651)

> ⚑ **This is an ADDENDUM, not a standalone spec.** It amends
> [`docs/specs/erpnext-adapter.spec.md`](erpnext-adapter.spec.md) §5.3 (FR-ENA-011) and §6
> (NFR-ENA-SEC-002) and uses that spec's id space (`FR-ENA-`/`NFR-ENA-`/`AC-ENA-`). Read the parent
> first; nothing here re-litigates it.
>
> **Why it is a separate file:** the planning session that produced it could not append to the parent —
> its editing tool was disabled, and the only alternative was rewriting 1110 lines it had read only in
> part, which is how specs lose content. The Director should either fold §§A.1–A.6 into the parent as
> `## 14. Addendum A`, immediately before the `SPEC-DONE` marker, or leave this file and keep the link.
> Nothing downstream depends on which.

- **Status:** addendum, **unsigned** — owner sign-off pending.
- **Date:** 2026-09-14 · **Issue:** #651
- **Scope:** how the ERPNext api key/secret pair ("the auth pair") is resolved, and nothing else.
- **Authority / grounds:** FR-ENA-011 (per-org credential resolution) and NFR-ENA-SEC-002 (server-only
  secrets) are the requirements being sharpened; ADR-0061 (per-org secret resolution is Vault-first);
  ADR-0065 + `docs/specs/external-admin-connect.spec.md` FR-EAC-014/015 (the Vault reader RPC and the
  deliberately-retained env fallback); `docs/decisions.md` OD-ENA-VAULT-SEAM (secret_ref resolution stays
  confined to the `credentials.ts` seam); `docs/money-path-primer.md` ("fail closed: a guard that cannot
  evaluate must refuse"); ADR-0072 (the decision record for this addendum).
- **Out of scope — owned by #650:** binding activation, `site_url`, `version_major`, and the
  `external-connect` / `external-set-company` / `binding.ts` surfaces. Also out of scope: the #481
  crossing dry-run.
- **No DB object changes.** No migration, no RLS change, no new RPC, no grant change ⇒ **no pgTAP**.
  `read_vault_secret`'s own contract is unchanged and already owned by
  `supabase/tests/external_admin_connect_rls.test.sql` tests 1–4.

---

## A.1 The gap this closes

FR-ENA-011 says the adapter resolves its credentials per org from `external_org_bindings.secret_ref`. It
does not say **which store** answers — and the two directions grew apart:

- **Inbound (poll/feed).** `erpnext-sweep`'s `erpClientForOrg` resolves the pair **Vault-first** through
  the shared `_shared/perOrgSecret.ts` (→ the `read_vault_secret` security-definer reader), falling back
  to the env pair when there is no binding or no Vault secret.
- **Outbound (write).** `adapter-dispatch`'s adapter factory, its money-outbox dependency builder and its
  fiscal-calendar read, plus `erpnext-sweep`'s outbox-reconcile and its own fiscal-calendar read, resolve
  the pair from the **environment only** — `resolveErpCredentials(secret_ref, Deno.env.get)`, which
  derives `<PREFIX>_KEY`/`<PREFIX>_SECRET` from the normalised `secret_ref` string.

**What breaks, concretely:** an org connected through the shipped connect flow has its pair written to
Vault and its `secret_ref` pointing at that Vault entry. Such an org's inbound feed works and **every
outbound money write refuses** with a configuration error, because no `<PREFIX>_KEY` env pair exists for
that ref. That is the whole of #651's user-visible defect.

**The constraint the fix must respect:** the local bench binding
(`secret_ref = 'local-bench'`, seeded in `supabase/seed.sql` and re-asserted by
`pmo-portal/e2e/serial/_tspHelpers.ts`, `_sarHelpers.ts`, `_budHelpers.ts` and ten-plus `AC-ENA-*`/`AC-SAR-*`
serial specs) has **no** Vault secret and resolves from `LOCAL_BENCH_KEY`/`LOCAL_BENCH_SECRET`. The env
pair must keep working — as an explicit local/dev fallback rather than as an accident.

**The gap underneath the gap.** The Vault seam reports *absence* and *failure* with the same value
(`null`): the shipped reader closure logs a PostgREST error and returns `null`, which the resolver reads
as "this binding has no Vault secret", which today licenses the env fallback. So a store that **cannot
answer** is treated as a store that **answered no** — and the value it then reaches for is selected by an
unauthenticated string. Making the write paths Vault-first without also fixing this would widen that
behaviour from the inbound feed onto the money path.

---

## A.2 Requirements (EARS)

- **FR-ENA-015 (one resolver, both directions)** — The system shall resolve an org's ERPNext auth pair
  through **exactly one** shared resolver, used by every ERPNext direction: the inbound doctype poll, the
  link-repair, ledger-mirror and accounting-refresh passes, the synchronous `adapter-dispatch` write, the
  money-outbox dependency/recovery probe, the sweep's outbox reconcile, and both fiscal-calendar reads.
  No call site shall derive an auth pair by any other route. *(Ubiquitous.)*
  - **Operator onboarding is carved out.** `erpnext-onboard` **keeps its current resolution path**
    (`resolveErpCredentialsFromVault` + the `resolveErpCredentials` env fallback) — Director ruling
    2026-09-14; a follow-up issue is to be filed to migrate it onto the shared resolver. It is therefore
    deliberately excluded from this requirement and from §A.6 item 3's (deferred) onboard delta.

- **FR-ENA-016 (Vault first)** — When the resolver is asked for an org's pair, it shall first ask the
  per-org secret store keyed by that org's `external_org_bindings.secret_ref` (`_shared/perOrgSecret.ts`
  → the `read_vault_secret` reader), and shall use the stored pair — parsed as `apiKey:apiSecret` —
  whenever the store returns one. A stored value not in that form shall be refused as `config-rejected`
  and never partially used. *(Event-driven.)*

- **FR-ENA-017 (env pair = explicit local/dev fallback, on a clean negative only)** — Where the secret
  store **successfully answers that this binding has no Vault secret**, the resolver shall fall back to
  the `<PREFIX>_KEY`/`<PREFIX>_SECRET` env pair named by the org's own `secret_ref`
  (`erpnext/credentials.ts::resolveErpCredentials`, retained per FR-EAC-015); where neither store holds a
  pair, it shall refuse with `config-rejected`. *(State-driven.)*

- **FR-ENA-018 (a store that cannot answer fails closed)** — While the binding lookup **or** the Vault
  read reports an **error** — as distinct from a clean "no such secret" — the resolver shall refuse with
  `config-rejected` and shall **not** consult the env pair. An unreadable store is not evidence that this
  org has no Vault pair, and the env pair it would otherwise reach for is selected by a string, not by an
  authenticated tenancy check. *(State-driven.)*

- **FR-ENA-019 (kill-switch, and one resolution per unit of work)** — While the operator kill-switch
  `EXTERNAL_CONNECT_ENABLED` is disabled (ADR-0061), the resolver shall refuse with `config-rejected`
  before reading any store. Where one request or one sweep tick needs the pair more than once for the same
  org, the resolver shall resolve it **once per org per request/tick** and reuse that result, so a money
  write costs one secret read rather than one per pair-consuming step. *(While / where.)*

- **NFR-ENA-SEC-005 (extends NFR-ENA-SEC-002)** — No credential value shall appear in a log line, an error
  body, a DB row, a mirror, or the browser. A store failure shall be logged by its error **code**, never
  by echoing the store's payload; the refusal returned to the caller shall name the condition
  ("credentials unresolved for this org") without naming the env variable, the `secret_ref`, or any part
  of a value.

---

## A.3 Acceptance criteria (Given/When/Then)

- **AC-ENA-080** — A Vault-issued pair reaches ERPNext. **[Deno unit]**
  **Given** an org whose binding's `secret_ref` resolves in Vault to `vault-key:vault-secret`,
  **When** an ERPNext path that talks to the client's site runs,
  **Then** the outgoing request's `Authorization` header is `token vault-key:vault-secret` — the Vault
  pair is the one actually **sent**, not merely the one returned. (FR-ENA-015, FR-ENA-016)

- **AC-ENA-081** — The local/dev env pair still serves a binding with no Vault secret. **[Deno unit]**
  **Given** an org whose binding names `secret_ref = 'local-bench'`, the store answers cleanly that no
  Vault secret exists for it, and `LOCAL_BENCH_KEY`/`LOCAL_BENCH_SECRET` are set,
  **When** the same path runs,
  **Then** the outgoing `Authorization` header carries the env pair and the call proceeds. (FR-ENA-017)

- **AC-ENA-082** — A store that errors refuses the operation; it never falls through to the environment.
  **[Deno unit — the mutation-sensitive oracle]**
  **Given** the same org and env pair as AC-ENA-081, but the Vault read returns an **error** instead of a
  clean miss,
  **When** the path runs,
  **Then** it fails with `config-rejected`, **no** ERP request is issued, and the env pair is not used —
  and removing the fail-closed branch turns this test red. (FR-ENA-018)

- **AC-ENA-083** — Neither store holds a pair ⇒ refuse. **[Deno unit]**
  **Given** an org whose binding has no Vault secret and whose `<PREFIX>_KEY`/`<PREFIX>_SECRET` are unset,
  **When** the resolver runs,
  **Then** it raises the existing `config-rejected` class and nothing is sent to ERPNext. (FR-ENA-017)

- **AC-ENA-084** — A Vault-only org can complete a **write**. **[Deno unit]**
  **Given** an org whose pair exists only in Vault (no env pair at all) and a money command awaiting
  outbox reconciliation,
  **When** the sweep's reconcile pass builds that command's dispatch dependencies,
  **Then** they are built successfully and carry the Vault pair — the push is possible, which it is not
  today. (FR-ENA-015, FR-ENA-016)

- **AC-ENA-085** — One resolution per org per sweep tick. **[Deno unit]**
  **Given** one employing org and a sweep tick that runs its passes,
  **When** the tick completes,
  **Then** the secret store was asked for that org's pair **once**, not once per pass. (FR-ENA-019)

- **AC-ENA-086** — The synchronous served write path keeps working for a bench (env-pair) org.
  **[existing served-fn e2e — regression gate, no new test]**
  **Given** the seeded `local-bench` binding and the served `adapter-dispatch` + Docker ERPNext v15 bench,
  **When** the existing money journeys run unchanged (`pmo-portal/e2e/serial/AC-ENA-053-pi-payment.spec.ts`
  and its siblings),
  **Then** they still pass — the resolver swap is invisible to an env-pair org. (FR-ENA-015, FR-ENA-017)
  *(Meta-AC: the unchanged suite staying green IS the proof, exactly as AC-ENA-002.)*

---

## A.4 Traceability (ADR-0010 — one owning layer per AC)

| AC | Requirement(s) | Owning layer | Proof |
|---|---|---|---|
| AC-ENA-080 | FR-ENA-015, FR-ENA-016 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` (drives shipped `sweepOrgDoctypesLive`) |
| AC-ENA-081 | FR-ENA-017 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` |
| AC-ENA-082 | FR-ENA-018 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` |
| AC-ENA-083 | FR-ENA-017 | Deno unit | `supabase/functions/_shared/erpAuthPair.test.ts` |
| AC-ENA-084 | FR-ENA-015, FR-ENA-016 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` (drives shipped `buildReconcileDepsLive`) |
| AC-ENA-085 | FR-ENA-019 | Deno unit | `supabase/functions/erpnext-sweep/vaultAuthPair.test.ts` (drives shipped `sweepOrgDoctypesLive`) AND `supabase/functions/_shared/erpAuthPair.test.ts` (cache keyed by org — two orgs in one shared tick cache still resolve separately) |
| AC-ENA-086 | FR-ENA-015, FR-ENA-017 | Regression gate | the unchanged served-fn money e2e lane (no new test) |

> **Review-follow-up regression guards (this change, no new AC).** Two hardening tests were added during
the #651 review follow-up and are covered by §A.4's suites: (a) `vaultAuthPair.test.ts` drives the
shipped `runErpSweepCycle` to assert the per-tick credential cache is **cleared after each org's
iteration** — so a multi-org tick holds at most ONE org's plaintext pair resident (ADR-0072 decision 5,
per-org scoping) while still resolving each org once (AC-ENA-085); (b) `erpAuthPair.test.ts` asserts the
`key:secret` split takes the **first** colon (`'k:se:cret'` → `k` / `se:cret`), because a Frappe api
secret may legally contain `:`. Both bind shipped code (import from `index.ts`/`_shared/erpAuthPair.ts`)
by inspection — see the binding-guard note above.

> **Why no test binds `adapter-dispatch/index.ts`:** its `serveWithErrorReporting(...)` call is
> module-level and unguarded, so importing it in a test starts an HTTP server — which is why every
> existing `adapter-dispatch` suite tests a sibling module (`*Guard.ts`, `readModelWriters.ts`,
> `moneyOutboxDeps.ts`) rather than the entry file. Putting the resolver in a shared module is what makes
> the dispatch write path testable **at all**; its three call sites are then covered by that module's own
> tests + `npm run typecheck:edge` + AC-ENA-086.
>
> **⚠ The edge-fn test-binding guard does NOT cover these suites.** `scripts/check-edge-fn-test-binding.mjs`
> maps only the `external-*` functions (`external-connect`, `external-companies`, `external-set-company`,
> `external-link`, `external-lists`, `external-unlink`); `erpnext-sweep`/`_shared` are NOT in its map, so
> nothing mechanically forces these `.test.ts` files to import the shipped module. The suites here bind to
> the shipped code **by inspection** (they import `sweepOrgDoctypesLive`, `buildReconcileDepsLive`,
> `runErpSweepCycle`, `resolveErpAuthPair`, `createErpAuthPairCache` from `index.ts`/`_shared/erpAuthPair.ts`,
> never copied copies) — a reviewer change to that contract is caught by these tests, not by the guard. If
> these functions move, extend the guard's map rather than assuming it already covers them.

---

## A.5 Error handling

| Condition | Code | Message shape (no value, no ref, no env-var name) |
|---|---|---|
| Kill-switch disabled | `config-rejected` | "external integrations are disabled by the operator" (existing wording, unchanged) |
| Binding lookup errored | `config-rejected` | "could not determine this org's ERPNext credentials (secret store unavailable)" |
| Vault read errored | `config-rejected` | same as above — the caller learns the condition, not which store failed |
| Vault value not `apiKey:apiSecret` | `config-rejected` | "ERPNext credential format invalid (expected apiKey:apiSecret)" (existing wording) |
| No Vault secret **and** no env pair | `config-rejected` | whatever `resolveErpCredentials` already raises — unchanged, so no new surface |

Log lines carry the store error's **code** only: `console.error('read_vault_secret failed', error)` — which
serialises the whole PostgREST error object — becomes
`console.error('read_vault_secret failed', error.code ?? 'unknown')` (NFR-ENA-SEC-005).

---

## A.6 Deliberate behaviour deltas (each named, none incidental)

1. **A write path with a Vault-only binding starts working.** The point of the change.
2. **Any path whose secret store errors now refuses instead of trying the env pair.** Availability is
   deliberately traded for tenancy safety — recorded in ADR-0072. Today an unreachable or absent Vault
   reader is silently survivable on the inbound side; after this it is not, anywhere. The refusal is loud
   and classified, and the sweep's per-org containment means one org's refusal never stops another's tick.
3. **~~`erpnext-onboard` starts honouring the kill-switch~~ — DEFERRED, not shipped in #651.** (This delta was
   anticipated here, but per the Director ruling 2026-09-14 `erpnext-onboard` **keeps its current
   resolution path**, so it does NOT start honouring the switch in this change; a follow-up issue is to
   be filed to migrate it onto the shared resolver, after which this delta lands.) For the record, the
   deferred effect was: it is today the one ERPNext function that keeps using env credentials while
   `EXTERNAL_CONNECT_ENABLED` is off; the shared resolver would refuse. An operator running onboarding
   during a break-glass stop would then get `config-rejected` instead of silently reaching a client's
   ERP — which is what the switch is for.
