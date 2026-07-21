# ADR-0059 — External-system admin-connect layer

- **Status:** Proposed (eng-planner, Design+Plan phase 2026-07-14)
- **Date:** 2026-07-14
- **Deciders:** Director (eng-planner); **owner sign-off already given via locked decisions OD-INT-1..5**
  (`docs/decisions.md`)
- **Related:** ADR-0055 (external adapters / SoT), ADR-0016 (`can()` UX-only + RLS authority),
  ADR-0019 (server-enforced privileged writes via security-definer RPC), ADR-0017 (repository seam),
  ADR-0018 (soft-archive), ADR-0057 (`verifyCallerJwt` local JWKS verification). Vault pattern precedent:
  mig `0082` (automation dispatch), `0094` (ClickUp sweep).
- **Spec:** `docs/specs/external-admin-connect.spec.md`. **Plan:**
  `docs/plans/2026-07-14-external-admin-connect.md`.

## Context

The external adapter SoT (ADR-0055) ships a working sync engine — `adapter-dispatch` /
`clickup-webhook` / `clickup-sweep` / `erpnext-onboard` / `erpnext-sweep` — plus a per-org data model.
But the **connection layer** on top of it is operator-CLI-only: an org **admin cannot** connect
ClickUp or ERPNext from the app, and ClickUp P1 still uses a single global `CLICKUP_API_TOKEN`
function secret rather than a per-org credential. #315 (ERPNext P2) merged `external_org_bindings`
(`org_id, external_tier, site_url, secret_ref, webhook_secret_ref, status`) + a clean credential-resolution
seam (`erpnext/credentials.ts`), but resolves `secret_ref` to **per-org function secrets** read from
`Deno.env` — operator-provisioned, not admin-self-serve. The Integrations panel (`IntegrationsView`)
is read-only.

Two tiers share the same connect problem; the locked owner decisions (OD-INT-1..5) ask for **one**
tier-generic Connect layer, admin self-serve, secrets in Supabase Vault, role-gated on the verified
caller JWT — built on the merged `external_org_bindings` foundation.

## Decision

Encode OD-INT-1..5 as architecture:

1. **One tier-generic Connect layer** on the shared `external_org_bindings` table (OD-INT-4) + Vault
   `secret_ref` backend (OD-INT-3) + one Connect endpoint + one admin UI card. Tier-specific is thin:
   credential shape (ClickUp personal token · ERPNext `apiKey:apiSecret`), the validation call, and link
   granularity (ClickUp → List per project · ERPNext → Company/module per org).
2. **Admin self-serve under the caller JWT** (OD-INT-1): the connect/disconnect/reconnect/link/unlink
   endpoints run under the caller's JWT, verified locally via `verifyCallerJwt` (ADR-0057), then
   re-enforce **Admin** of the token's org **or** platform **Operator** (`is_operator()`, mig `0064`)
   before any Vault write or binding insert (ADR-0019). NOT service-role-from-the-UI; the operator CLI
   path (`clickup-onboard` / `erpnext-onboard` service-role) is retained as the bulk/fallback path.
3. **Vault-backed `secret_ref`** for BOTH tiers (OD-INT-3): `vault.create_secret(value, name)` is the
   only ingress; the DB stores only the Vault name (`secret_ref`); the value is **write-only, never
   returned, never in an RLS-readable column**. Edge fns resolve the per-org credential from Vault via a
   locked-down security-definer reader keyed by `secret_ref` (precedent mig `0082`/`0094`), failing closed.
4. **`can('manage','integration')` is UX-only** (ADR-0016): a new `Entity='integration'` + `Action
   ='manage'` in `policy.ts`, scoped to `Admin`, gates the UI affordances; RLS + the role-gated edge fn
   / security-definer RPC are the enforcement authority, with pgTAP proofs.
5. **Additive, not a rewrite** (OD-INT-5 alignment): the Vault resolver is added **alongside** the env
   resolver (`erpnext/credentials.ts` kept as fallback); the global `CLICKUP_API_TOKEN` is kept as a
   fallback for ClickUp orgs not yet migrated onto a per-org Vault `secret_ref`. ClickUp **adopts**
   `external_org_bindings` for the org connection while preserving the global fallback. The merged
   `external_org_bindings` foundation is unchanged (additive columns/RPCs only).

## Consequences

- **Self-serve is now possible** because Vault can be written from a role-gated app endpoint (function
  secrets could not). An org Admin connects a tier without operator involvement; the operator retains
  the CLI bulk path.
- **No plaintext credential in any DB column or API response.** Only the Vault `secret_ref` (a name)
  is stored; reads go through a security-definer reader. The FE repository layer never sees a secret value.
- **Per-org credential isolation**: `adapter-dispatch`/`clickup-sweep`/`clickup-webhook` resolve the
  caller-org's Vault token, never a shared global; fail-closed for disconnected orgs (NFR-EAC-SEC-003).
- **Migration-safe**: the env/global-token fallback means zero behavior change for orgs not yet on a per-org
  binding; the layer is inert until an admin connects. `supabase db reset` reverts; disconnect is a soft-archive.
- **Costs:** one new edge fn cluster (`external-connect` / `external-lists` / `external-link` / `external-unlink`,
  tier-generic with a tier dispatcher), 2–3 migrations (0104–0106), a Vault security-definer reader RPC +
  writer RPC, an `integrations` repository + UI card extension on `IntegrationsView`, and pgTAP proofs for
  every role/tenancy gate. Mandatory `security-auditor` pass on the token path before merge.
- **Out of scope (deferred):** ClickUp OAuth app (later UX upgrade), multi-List-per-project, custom-field
  mapping beyond status/member, automatic ClickUp webhook registration (operator out-of-band).

## Alternatives rejected

- **Per-tier forks** (a `clickup-connect` *and* an `erpnext-connect` with nothing shared). REJECTED by
  OD-INT-4 — both tiers share `external_org_bindings`, the Vault model, and the Connect endpoint; only
  credential shape + validation call + link granularity differ. Forking duplicates the role gate, the
  Vault write path, and the UI card.
- **Credential in a DB column** (encrypted or otherwise). REJECTED — anything in an RLS-readable column
  is a leak surface; Vault's write-only model (mig `0082` precedent) is the standard and removes the secret
  from the DB entirely (NFR-EAC-SEC-001).
- **Service-role-from-the-UI.** REJECTED by OD-INT-1/ADR-0019 — the service-role key never lives in the
  browser; privileged writes run under the caller's verified JWT + a server role re-enforcement
  (security-definer RPC or role-gated edge fn).
- **OAuth-now.** REJECTED by OD-INT-2 — ClickUp OAuth (registering a ClickUp app + redirect) is a later
  UX upgrade; v1 ships the paste-a-personal-token flow (and ERPNext `apiKey:apiSecret`).
- **Delete the env resolver / hard-cut the global ClickUp token.** REJECTED — additive, migration-safe:
  the env/global fallback preserves the pre-change system byte-for-byte for un-migrated orgs and lets the
  cutover be per-org, not big-bang.
- **ClickUp keeps `external_domain_ownership` for the connection** (not adopting `external_org_bindings`).
  REJECTED by OD-INT-4 — one shared per-org connection table; `external_domain_ownership` stays the
  flip/ownership table (which domains a tier owns), `external_org_bindings` is the connection table
  (site + secret), the same split #315 established for ERPNext.

## References

- ADR-0055 (external adapters / SoT), ADR-0016 (`can()` + RLS authority), ADR-0019 (server-enforced
  privileged writes), ADR-0017 (repository seam), ADR-0018 (soft-archive), ADR-0057 (`verifyCallerJwt`).
- Precedent migrations: `0082_automation_dispatch_vault.sql`, `0094_clickup_sweep_cron.sql`
  (Vault `create_secret` / `decrypted_secrets` + locked-down security-definer reader).
- Merged foundation: `0096_erpnext_seam_tables.sql` (`external_org_bindings`, `external_command_outbox`,
  `external_ref_lineage`). Credential seam: `pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts`.
