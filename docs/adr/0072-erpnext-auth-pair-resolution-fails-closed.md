# ADR-0072 — One ERPNext auth-pair resolver, Vault-first, failing closed on an unreadable store

- **Status:** Proposed (2026-09-14) — pending the #651 build + owner sign-off of the spec addendum.
- **Issue:** #651 · **Spec:** `docs/specs/erpnext-adapter-auth-pair-resolution.spec.md` (Addendum A to
  `docs/specs/erpnext-adapter.spec.md`)
- **Supersedes nothing.** Sharpens FR-ENA-011 / NFR-ENA-SEC-002 and narrows the fallback that
  ADR-0065 / FR-EAC-015 deliberately retained.
- **Relates to:** ADR-0061 (per-org secret resolution is Vault-first, kill-switch semantics), ADR-0055
  (adapter architecture), ADR-0058 (money outbox), `docs/decisions.md` OD-ENA-VAULT-SEAM.
- **Out of scope:** #650 (binding activation / `site_url` / `version_major`).

## Context

The ERPNext adapter resolves a per-org api key/secret pair from `external_org_bindings.secret_ref`. Two
stores can answer that ref: **Vault** (via the `read_vault_secret` security-definer reader — what the
shipped connect flow writes) and the **environment** (`<PREFIX>_KEY`/`<PREFIX>_SECRET`, where `<PREFIX>` is
derived from the ref string — what the local Docker bench and the serial e2e lane use, `secret_ref =
'local-bench'`).

Two facts about the shipped code created the problem this ADR settles.

1. **The two directions resolve differently.** The sweep's inbound poll goes Vault-first; every outbound
   write path resolves from the environment only. A binding whose pair lives only in Vault can therefore
   read and cannot write — the org is connected, the feed works, and every money push refuses. Three
   `adapter-dispatch` call sites and two `erpnext-sweep` call sites are on the env-only route.
2. **The Vault seam cannot tell "no secret" from "could not look".** Both are reported as `null`, and
   `null` licenses the env fallback. A store outage, a revoked grant, a stale PostgREST schema cache — each
   presents as "this binding has no Vault secret", and the resolver then reaches for a value selected by an
   unauthenticated string rather than by a tenancy check.

Fixing (1) without (2) would move the second behaviour from the inbound feed onto the money path, which is
precisely where the house rule is strictest (`docs/money-path-primer.md`: *a guard that cannot evaluate
must refuse*).

## Decision

1. **One resolver.** A single shared module — `supabase/functions/_shared/erpAuthPair.ts` — owns ERPNext
   auth-pair resolution for **every** direction: poll, feeds, synchronous dispatch, money-outbox
   dependencies and recovery probe, sweep reconcile, both fiscal-calendar reads, operator onboarding. No
   call site resolves a pair any other way. It lives in `_shared/` (not inside a function) because
   `adapter-dispatch/index.ts` cannot be imported by a test — its serve call is unguarded — so a resolver
   embedded there is untestable by construction. *(Annotated 2026-09-14: “operator onboarding” is
   **carved out** of this decision in #651 — see decision 4's annotation.)*
2. **Vault first, env second, refuse third.** Vault answer ⇒ use it (parsed `apiKey:apiSecret`, refused
   whole if malformed). Clean "no Vault secret for this binding" ⇒ the env pair named by the org's own
   `secret_ref`. Neither ⇒ `config-rejected`.
3. **An unreadable store fails closed.** A binding-lookup error or a Vault-read error refuses with
   `config-rejected` and never consults the environment. This is implemented by recording the failure in
   the resolver's own scope (a flag set by the seam closure, checked after the call) rather than by
   throwing from inside the seam — so the refusal does not depend on whether `perOrgSecret.ts` propagates a
   thrown seam error. An unrecognised result kind is treated the same way.
4. **The kill-switch is checked once, in the resolver.** `EXTERNAL_CONNECT_ENABLED` disabled ⇒
   `config-rejected` before any store read, for every direction of the shared resolver. *(This decision
   originally claimed a behaviour change for `erpnext-onboard` only. **Annotated 2026-09-14 — Director
   ruling:** onboarding keeps its current resolution path and is carved out of FR-ENA-015 in #651; the
   switch does NOT start applying to it in this change, and a follow-up issue is to be filed to migrate it
   onto the shared resolver. Prior text retained: “this is a behaviour change for `erpnext-onboard` only,
   which previously kept using env credentials while the switch was off.”)*
5. **One resolution per org per unit of work.** An explicit cache object, created per request and per sweep
   tick and passed in, memoises the pair by `org_id`. There is no module-level cache: a long-lived isolate
   must not hold another tenant's credential between requests, and a rotated credential must not survive a
   request boundary.

## Consequences

**Good**

- A Vault-connected org can push money. That is the shipped-product gap #651 names.
- One resolution rule, one place to audit — instead of two rules that had already drifted.
- A tenancy-relevant refusal is now impossible to reach by accident: the only route to the env pair is a
  *successful* negative answer from the authoritative store.
- Fewer secret reads per unit of work than a naive Vault-first swap: a sweep tick currently calls the
  resolver four times per org (plus reconcile and the fiscal read); memoising makes that one.

**Costs, accepted**

- **Availability is traded for tenancy safety.** Today a broken Vault reader is invisible — every path
  silently falls to env. After this, a broken reader stops every ERPNext direction for every org whose
  binding it cannot answer for. This is the intended direction of failure, and the refusal is classified
  (`config-rejected`), logged by error code, and contained per org by the sweep's existing per-org
  try/catch. It is also the sharpest operational risk in the change: **before merging, confirm on the local
  stack that `read_vault_secret` answers a clean `NULL` (not an error) for the seeded `local-bench` ref** —
  if it errored, the whole local money lane would go red on the fail-closed branch, and that red would be
  correct.
- **~~`erpnext-onboard` behaviour changes~~ — deferred (annotated 2026-09-14).** This cost did NOT land in
  #651: per the Director ruling, onboarding keeps its current resolution path (a follow-up issue is to be
  filed), so the switch does not start applying to it here. For the record, the deferred cost was: while
  the kill-switch is off `erpnext-onboard` keeps using env credentials instead of refusing — named in the
  spec addendum §A.6; reversible by dropping one task.
- **Five call sites and four function signatures change** in two money-path files. Mitigated by keeping the
  cache parameter optional (existing tests compile unchanged) and by landing correctness before
  memoisation, so the risky-diff half is separable.

**Reversal**

Delete `_shared/erpAuthPair.ts` and restore each call site's previous expression — three
`resolveErpCredentials(binding.secret_ref, Deno.env.get)` lines in `adapter-dispatch`, two in
`erpnext-sweep`, and the inline Vault-first block in `erpClientForOrg`/`erpnext-onboard`. No DB object,
migration, grant or RLS policy is touched, so reversal is code-only and complete.

## Alternatives considered

- **Change `perOrgSecret.ts` to return a fourth `store-error` kind.** Cleanest in the abstract, but it is
  shared by six functions (ClickUp sweep + webhook worker, ERPNext webhook, external-connect, onboard,
  dispatch) and changing its contract puts three unrelated tiers in the blast radius of a money fix. The
  caller-side flag gets the same guarantee with a blast radius of one module. Worth revisiting as
  follow-up hygiene once this is green.
- **Fail closed on `binding-vault-miss` too** (what ClickUp's dispatch already does). Rejected: for ClickUp
  the fallback is a *global* token, genuinely cross-tenant; for ERPNext the fallback is keyed by the org's
  own `secret_ref`. Failing closed there would delete the local bench and the entire serial money e2e lane
  for no tenancy gain.
- **Module-level credential cache.** Rejected — see decision 5.
- **Vault-only, no env fallback** (the strict reading of ADR-0061). Rejected for now: it deletes the local
  dev bed and ten-plus e2e specs' credential source in the same change as a money-path fix. If the house
  wants Vault-only everywhere, it is its own issue, with a seeding story for `local-bench` first.
