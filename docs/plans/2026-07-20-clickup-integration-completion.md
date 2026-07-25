# ClickUp integration — current state and remaining work

> **Cold-context entry point.** This document describes the state on `dev` at `7e135d47`.
> The integration-enablement authority is [`docs/adr/0061-integration-enablement-model.md`](../adr/0061-integration-enablement-model.md)
> and [`docs/specs/integration-enablement-model.spec.md`](../specs/integration-enablement-model.spec.md).
> They supersede the org-wide reading of ADR-0055 §7 for task ownership.

## Current truth

The ClickUp integration and integration-enablement model are merged to `dev` through PRs **#353–#358**.
The task slice is complete for every task column reachable from the UI without requiring ClickUp:

description and priority (#350), subtasks and parent-task sync, archive with delivery-rollup exclusion
(#352), project-aware ownership, safe unbound-List handling and active-binding-only sweep (#353–#354),
the uniform default-ON kill-switch (#355), the two-direction Admin binding map (#356), atomic connect and
operator-only trap-state recovery (#357), and project-aware client write routing (#358).

Ownership follows the **project binding** (`project_domain_externally_owned`, migration `0146`), not the
org. Mixed mode is supported: a project with an active ClickUp binding is ClickUp-owned; an unbound project
remains PMO-native. `domain_externally_owned` remains the org-level predicate for non-task domains.

An unbound ClickUp List cannot leak tasks into PMO: inbound resolution requires an active project binding,
and the sweep enumerates active bindings only. Zero active bindings is a valid healthy, inert employed state.
The Admin binding map shows both directions, including ClickUp Lists PMO does not track.

## Kill-switch semantics — operator break-glass, not rollout

`EXTERNAL_CONNECT_ENABLED` is **default-ON**. The shipped resolver in
`supabase/functions/_shared/externalConnectEnabled.ts` disables only for trimmed,
case-insensitive `false`, `0`, `off`, `no`, or `disabled`; unset, empty, and unrecognised values enable it.
The same decision is used across ClickUp and ERPNext, with the three hard-coded `connectEnabled: true`
bypasses removed.

Therefore production's unset variable means external execution is enabled **once the merged code is
deployed**. There is no flag-flip step. The per-org active binding and its Vault credential are the
binding enablement authority. A false kill-switch is an operator incident control; it does not create,
remove, or mutate ownership and restoration does not require reconnecting.

Connect is atomic at the readiness boundary: valid token and resolvable Vault secret precede ownership
employment; failures clean up orphaned secrets. Operator-only `recover_external_connect_trap` recovery is
documented in [`docs/runbooks/integration-trap-state-recovery.md`](../runbooks/integration-trap-state-recovery.md).
Client task writes are project-aware and fail closed consistently with the database gate.

## Verified evidence

Verified on `dev` at `7e135d47`:

| Gate | Result |
|---|---:|
| pgTAP | 213 files / 2,049 tests |
| `npm run verify` | 729 files / 6,022 tests |
| curated e2e `AC-EAC-018` | 12 passed |

These results prove the repository suites at that commit; they do not prove a production deployment or a
live ClickUp workspace beyond the evidence recorded in the live-smoke document.

## Still open — explicitly

1. **`dev` → `main` promotion (117 commits).** The PR→`main` integration job is the only job that runs
   pgTAP, full e2e, and visual gates. The work so far used the verify-only fast lane, so those full suites
   have not run in CI against this work.
2. **`main` → `production` deployment.** This remains owner-gated per instance. This is the deployment,
   not a flag flip.
3. **`AC-IEM-004` and `AC-IEM-007`** are specified as curated e2e but currently have lower-layer
   implementations; the test-layer ownership needs correction.
4. **Per-status mapping UI.** The Admin binding map is read-only. Operators cannot yet view or override
   per-status resolution, including `pmo-only` decisions under OD-INT-13. Auto-derivation is correct;
   this is a transparency gap, not a sync-correctness gap.
5. **Per-org webhook secret.** Deliberately deferred for the current single-org model (OD-INT-14 /
   ADR-0047). The existing global `CLICKUP_WEBHOOK_SECRET` remains correct until the multi-org boundary.

## Operational rules

- Treat ClickUp and local Supabase as shared test fixtures; prefer mocks and clean up live-created data.
- Never print credentials or workspace content. Do not read `.env` or `op.*.env` files.
- DB-driving commands use `scripts/with-db-lock.sh`; chain reset and pgTAP in one lock hold.
- Do not promote to production without the owner's explicit, per-instance authorization.
