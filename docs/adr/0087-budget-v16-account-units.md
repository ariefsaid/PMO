# ADR-0087 — Account-qualified Budget units for ERPNext v16

- **Status:** Proposed for Director review; implements signed #1033 requirements.
- **Date:** 2026-10-15
- **Spec:** `docs/specs/budget-push-v16.spec.md`
- **Plan:** `docs/plans/2026-10-15-budget-push-v16.md`
- **Extends:** ADR-0059 Posture B, ADR-0058 outbox fencing, ADR-0073 binding-major authority.

## Context

ERPNext v15 accepts one Budget with account child rows; v16 requires one Budget per account. PMO must preserve v15 bodies, identities, and existing pinning tests while dispatching and reconciling v16 accounts independently. A revision can retain the same ERP document for an unchanged account, but external references are reverse-unique.

## Decision

1. Fan out v16 account units at the existing dispatch boundary, after the shared fiscal-year gate. Keep the same outbox algorithm and bare budget-version UUID. Derive all unit dimensions server-side.
2. Frame the existing encoded fiscal-year token by length, append reversible lowercase UTF-8 account hex, and discriminate account identities with `:a:`. Use a separate validated `bud16:` key and the existing shared timestamp-to-epoch normalization. Leave v15 bytes unchanged.
3. Add `budget_version_account_erp_mirror` with `(org_id,budget_version_id,fiscal_year,erp_account)` uniqueness and machine-only RLS. Preserve the original v15 mirror and its three-column conflict target. An invoker union view serves shared read RPCs without copying rows between mirrors.
4. Retain the reverse external-reference unique. A generation-fenced, v16-only finalization branch transfers a witnessed same-project/year/account document to the active successor version for unchanged or intentionally removed accounts. It never guesses ownership from ERP authorship or occupancy.
5. Model removed accounts as cancel-only intents, not zero-amount Budget creates. Keep account-aware feed tombstones, recovery gates, and operator status. Lifecycle flows back; amounts do not.
6. Rollback refuses while account-grained data or commands exist; it never collapses account pointers or deletes ERP records. The unused-state rollback is applied-helper tested.

## Consequences

- V15 behavior and pinning tests remain unchanged, including literal conflict-target assertions.
- V16 retries, revisions, cancellations, failures, and inbound events have independent account grain.
- Two physical mirrors require a shared read view and explicit account-aware routing; this is accepted instead of breaking the legacy writer contract or introducing partially inferred conflict targets.
- Same-document reference handoff needs additional transactional witness tests; reverse uniqueness and current generation remain authoritative.
- No production deployment or live-client test is authorized. Rehearsal HTTP-dispatch proof remains a Director gate.
