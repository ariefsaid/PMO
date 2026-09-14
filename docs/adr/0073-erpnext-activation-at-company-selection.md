# ADR-0073 — ERPNext activation happens at Company selection, in one guarded statement, and `activated_at` is set-once

- **Status:** Proposed (Design+Plan, issue #650, 2026-09-14)
- **Date:** 2026-09-14
- **Deciders:** Director (owner ruled the sequence 2026-09-14; `OD-INT-6` is the standing owner decision)
- **Related:** [ADR-0055](0055-external-system-adapters-sot-enhancement.md) (external SoT / adapter seam),
  [ADR-0058](0058-erpnext-money-idempotency-outbox.md) (the outbox this activation gates),
  [ADR-0059](0059-pmo-sot-with-external-side-mirror.md) (Posture B — budget/timesheet employment is the
  BINDING, not a domain-ownership flip), [ADR-0061](0061-integration-enablement-model.md) (atomic connect,
  kill switch), [ADR-0065](0065-external-admin-connect.md) (the admin self-serve connect layer),
  ADR-0019 (server-enforced privileged writes via security-definer RPC), ADR-0010 (test pyramid),
  ADR-0006 (reversibility). **Decisions:** `OD-INT-6`, `DD-OPS-10`, `DD-XING-2`, `DD-ORG-1`.
  **Spec:** [`docs/specs/external-admin-connect.spec.md`](../specs/external-admin-connect.spec.md) §7.
  **Plan:** [`docs/plans/2026-09-14-erpnext-activation.md`](../plans/2026-09-14-erpnext-activation.md).
- **Scope:** WHERE the ERPNext version handshake runs, WHAT one activation writes, and WHO may write the
  three fields that decide whether money flows. NOT credential resolution on the write paths (#651), NOT
  the crossing dry-run (#481), NOT the Integrations UI beyond error copy.

## Context

`OD-INT-6` (owner-approved 2026-07-16) rules that the ERPNext **Company** is chosen at the org level and
that a binding is *connected but not activated* until a Company is chosen — "a **runtime** gate, NOT a
schema constraint". Three shipped predicates implement the runtime half and all three read the same
column:

- `resolveErpDispatchAdapter` refuses `config-rejected` when `activated_at` is null;
- `erpnext-sweep`'s `listEmployingOrgsLive` enumerates only bindings with a non-null `activated_at`;
- `org_has_active_erpnext_binding` (mig `0160`) — the Posture-B budget employ predicate the dispatch
  authGuard and the push banner both call — tests `activated_at is not null`.

**Nothing in shipped code wrote that column at ADR time.** The writer-shaped `activateBinding`
(`pmo-portal/src/lib/adapterSeam/erpnext/binding.ts`) was the version handshake and had **no production
call site** — only its own Vitest. Every binding that carries `activated_at` outside this layer was
written by `supabase/seed.sql`, an e2e helper (`upsertTspBinding`), or operator SQL. *(Review follow-up,
#650: that dead twin was then deleted outright — `activate_external_binding` (mig `0216`), invoked by
`external-set-company`, is the one writer.)*

The connect path has the same shape one level down. `external-connect` validates the admin's `siteUrl`
against an SSRF/HTTPS guard, then calls `create_vault_secret_for_org` (mig `0180`), whose `insert`
supplies a literal `site_url = ''` and discards it. `external-set-company` and `external-companies` both
read `binding.site_url` to talk to the site — so on a real self-serve connect the Company **picker** and
the Company **validation** both target an empty string. The suites are green because every fixture and
seed row supplies a `site_url` the product never wrote.

So: the whole ERPNext self-serve path is reachable in the UI, passes its tests, and cannot produce a
working integration. That is the defect #650 names, verified against the code on 2026-09-14.

## Decision

**1. Connect persists `site_url`; a repoint un-activates.** `external-connect`'s ERPNext branch calls a
new service-role-only RPC `set_external_binding_site_url` immediately after the Vault/binding RPC. The
RPC re-checks non-empty + `https://` (the edge fn's SSRF guard stays where it is). If the stored URL was
non-empty and differs, the same statement clears `activated_at`, `version_major` and `config.company`.

*Why not add a parameter to `create_vault_secret_for_org`?* Because that function is on production. Adding
a 6th parameter to a `create or replace` makes a second overload (an ambiguity trap), and dropping the
5-arg form creates a deploy-ordering window in which the still-deployed edge function calls a signature
that no longer exists — `PGRST202`, on the connect path, on production. A second RPC has neither problem.

*Why does a repoint clear the stamps?* Name what breaks otherwise: an admin reconnects against a fresh
ERPNext host; `activated_at`, `version_major` and `config.company` still describe the OLD site; the very
next sweep tick pushes money documents at the new host under a company name that may not exist there. The
clear forces a re-handshake, which is exactly the check that would catch it.

**2. Company selection IS activation, and it is one statement.** After `external-set-company` validates
the Company, it runs the version handshake against `binding.site_url` with the Vault credential and then
calls a new service-role-only RPC `activate_external_binding`, which in **one** UPDATE sets
`version_major`, merges `config.company` plus the Company account defaults, and stamps `activated_at`.
The direct `PATCH .update({config})` is removed.

*Why one statement?* The current shape can leave `config.company` written with no `version_major` and no
stamp. Half-written activation state on the money path is the class ADR-0058 exists to eliminate; there
is no reason to introduce a new instance of it here.

**3. The supported major set is `{15, 16}`, and the database is the authority.** `DD-OPS-10` rules RIS
targets v16.33 while the local bench is v15.94.3, so both must pass. The edge function checks the major
(fast, legible 422); the RPC checks it again and raises `P0001`. The duplication is deliberate: the edge
function is the UX gate, the database is the enforcement gate, and each is mutation-tested separately.
`SUPPORTED_VERSION_MAJOR = 15` in `binding.ts` becomes `SUPPORTED_VERSION_MAJORS = [15, 16]`.

**4. `activated_at` is SET-ONCE for the lifetime of a connection.** The RPC writes
`activated_at = coalesce(activated_at, now())`. It is cleared by exactly two events: disconnect, and a
site-URL repoint.

*Why set-once?* `activated_at` is `DD-XING-2`'s epoch and the sweep's floor — the timesheet backstop
enumerates candidates with `approved_at >= activated_at`, deliberately scoping recovery to the binding's
own lifetime. If re-selecting a Company moved the stamp forward, every week approved between the first
activation and the re-select would silently fall out of recovery scope: hours the client's ERP never
hears about, with nothing on any screen saying so.

**5. Disconnect un-activates, in the same statement.** A new `deactivate_external_binding` RPC replaces
`external-disconnect`'s direct PATCH and sets `status`, `disconnected_at`, and clears `activated_at`,
`version_major`, `config.company` together. Today the sweep's employ predicates read `activated_at` and
never read `status`, so a disconnected ERPNext org still satisfies them and only fails later, noisily,
when the deleted Vault secret cannot resolve. Fail-closed by accident is not a control.

**6. No RESTRICTIVE policy and no trigger on `external_org_bindings`.** `authenticated` and `anon` hold
**SELECT only** on that table (mig `0096`; no later migration widens it), so any write policy there would
be a dead layer that reads like a live control — the exact failure `0180` §3 annotates and the `0203`
audit re-learned. The live layer is the grant surface, and it is proved by a **catalog-derived** pgTAP
assertion over `information_schema.role_table_grants` that fails if a future migration re-grants a write.
The three new RPCs are `service_role`-only EXECUTE, asserted **on the applying database** (the `0210`
idiom, because hosted Supabase's default privileges differ from local Docker).

**7. The handshake has one derivation, and it is imported, not copied.** `binding.ts` gains
`fetchErpVersionMajor` and `companyDefaultsFromDoc`; `external-set-company` imports them across the
established `../../../pmo-portal/src/lib/adapterSeam/...` seam that `erpnext-sweep` already uses.
*(Review follow-up, #650: the `activateBinding` refactor this decision originally described was superseded
by deletion — the RPC owns activation, so the FE twin had no reason to exist.)*

## Consequences

**Good.**
- The ERPNext self-serve path becomes capable of producing a working integration for the first time; #481's
  dry-run and RIS go-live stop being blocked on operator SQL.
- Activation state can no longer be half-written, and the stamp the sweep floors on can no longer move
  under it.
- Disconnect now makes the employ predicates false at the moment of disconnect, rather than relying on a
  downstream credential failure.
- One version-handshake derivation instead of a dormant one plus a future copy.

**Costs and risks accepted.**
- **Two round trips at connect instead of one.** A failure of the second leaves an active binding with
  `site_url=''`. That state is refused by both `external-set-company` (FR-EAC-103) and the activation RPC's
  own `site_url <> ''` guard, so it is inert rather than dangerous; the admin retries Connect, which
  rotates. Deliberately no compensating delete on the ERPNext branch — the ClickUp branch's
  `cleanup_external_connect_attempt` DELETEs the org's one live binding on a failed rotate, which is worse
  than the state it cleans up. That asymmetry is recorded as an open question, not copied.
- **Two homes for the supported-major set** (TS constant, SQL allowlist). Drift is possible; each has a
  test and each names the other in a comment.
- **Two shipped test expectations invert** — `binding.test.ts`'s "v16 leaves the binding un-activated"
  (superseded by `DD-OPS-10`) and four `set-company.test.ts` PATCH-count assertions (the write moved into
  the RPC). Both are deliberate behaviour changes with the goal-oracle preserved; neither is an assertion
  bent to match the app.
- **`external-disconnect` must export its handler and get a real test suite.** Its current suite asserts
  re-implemented local booleans and would stay green with the shipped handler broken. Fixing that is in
  scope because this change makes disconnect a money-adjacent write.
- **The v16 Company field names are unverified.** `companyDefaultsFromDoc` reads the five v15 names and
  writes `null` when absent, so a v16 rename degrades to "no default" rather than a wrong account — a
  silent degradation the #481 dry-run must check against the live v16 bench.

**Reversibility (ADR-0006).** `supabase db reset`. Manual: `drop function` the three new RPCs in reverse
order. No column is added, dropped or retyped, so there is no data migration to reverse.
