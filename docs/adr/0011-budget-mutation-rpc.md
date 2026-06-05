# ADR-0011: Budget lifecycle writes via `security definer` RPCs + a not-Draft trigger

**Status:** Accepted — 2026-06-04
**Deciders:** Director, eng-planner
**Issue:** build-wave #1 — Budget-versioning module
**Spec:** `docs/specs/budget-versioning.spec.md` (OQ-2)
**Decisions:** `docs/decisions.md` OD-BUDGET-1/3/5

---

## Context

OD-BUDGET-1 makes the Active `budget_version` the authoritative budget, so the module must let an
authorized user activate exactly one version per project. Activation is **two writes** — archive the
project's currently-Active version, then set the chosen Draft to Active — and the spec requires it to be
**atomic and concurrency-safe** (NFR-BV-ATOM-001, AC-727), with at most one Active version per project
(backstopped by the existing partial unique index `budget_versions_one_active_idx`).

Cloning an Active/Archived version into a new Draft is likewise multi-statement (insert a new version at
the next number, copy its line-items resetting `actual_amount`). And FR-BV-006/009/011 require that
line-items mutate **only while their owning version is Draft**, enforced at the DB contract (AC-731).

The base tables, enums, the partial unique index, and the coarse 4-role RLS write gate
(`budget_versions_write` / `budget_line_items_write`, both `org_id = auth_org_id()` + 4-role, the child
also carrying a parent-org guard) already exist (0001/0002/0004) and are reused as-is. The open question
(OQ-2) is **how** to deliver atomic activation and the not-Draft guard.

ADR-0009 set the precedent: a `security invoker` RPC for read aggregation, with anon execute revoked.

---

## Decision

Add migration `0005_budget_mutation_rpc.sql` with:

1. **`activate_budget_version(version_id uuid)` — `security definer`.** One server-side transaction:
   archive the project's current Active version, set the target Draft to Active. Because `security definer`
   bypasses RLS, the function **re-asserts authorization internally** before mutating:
   - the target version's `org_id = auth_org_id()` (tenant isolation), and
   - `auth_role() in ('Admin','Executive','Project Manager','Finance')` (the OD-BUDGET-3 gate),
   raising `42501` otherwise; and it rejects activating a non-Draft version (`P0001`).

2. **`clone_budget_version(version_id uuid)` — `security definer`.** Same internal authz re-assertion;
   inserts a new Draft at `max(version)+1` and copies the source line-items with `actual_amount = 0`.

3. **`enforce_draft_line_item()` + `before insert or update or delete` trigger** on `budget_line_items`:
   raises `P0001` unless the owning version's status is `Draft` (FR-BV-011). This enforces the
   read-only-Active / terminal-Archived invariants at the DB contract for all three verbs uniformly.

4. **`get_project_budget(p_project_id uuid)` — `security invoker`** (default): a single indexed SQL
   aggregate (Σ Active-version line-items) so the derivation stays in SQL, org-scoped by the caller's RLS
   (mirrors ADR-0009). Listed here for completeness; it is a read, not a lifecycle write.

All four functions `revoke all from public` + `grant execute to authenticated` + `revoke execute from anon`
(ADR-0009 anon-revoke discipline). The `security definer` functions pin `search_path = public`
(consistent with `auth_org_id` / `auth_role` in 0002). The migration is forward-only; reversibility is
`supabase db reset` (ADR-0006, pre-production).

Simple state changes that are **single writes** stay as ordinary RLS-gated DAL operations (no RPC):
archive-Active (`update status='Archived'`), create-Draft, delete-Draft, and line-item create/update/delete
on a Draft. Their authorization is the existing `*_write` RLS policies; the not-Draft trigger guards the
line-item ones.

### Alternatives considered

**(b) Two client statements in a transaction relying on the partial unique index** (OQ-2 option b):
rejected. PostgREST does not give the client an atomic multi-statement transaction boundary, so a failure
between "archive prior" and "set new Active" can leave a project with **zero** Active versions
(budget silently → 0, dropping it off KPIs per OD-BUDGET-1). The unique index protects the *single-Active*
invariant but not *atomicity*. It would also duplicate the authz + next-version logic across client and DB.

**Not-Draft guard as an RLS predicate instead of a trigger:** rejected as the primary mechanism. An RLS
`using`/`with check` referencing the parent version's status is expressible but would have to be added to
`UPDATE` and `DELETE` paths separately and yields a generic `42501` with no actionable message; a single
`before` trigger covers insert/update/delete uniformly, raises a clear `P0001` the DAL surfaces, and guards
any future write path (including the RPCs) without touching the existing policies.

---

## Consequences

**Positive:**
- Activation is atomic and race-safe: no observable partial state; the unique index remains the backstop.
- One authorization choke point for budget lifecycle writes (the OD-PROC-6 seam) — swappable later for
  config-driven authz without touching callers or RLS policies.
- The not-Draft invariant is enforced at the DB for all verbs and all paths (defense in depth on top of RLS).
- Budget derivation stays in SQL (NFR-BV-PERF-001), scaling like ADR-0009.

**Negative / risks:**
- New `security definer` surface: the security-auditor must verify the internal `auth_org_id()` +
  `auth_role()` re-assertion, the pinned `search_path`, and the anon-execute revoke before ship. The
  migration carries inline comments stating that the definer functions MUST keep their internal authz
  (removing it would bypass RLS and leak/permit cross-org writes).
- `database.types.ts` gains no auto-generated `Functions` entries until the local stack is regenerated;
  the DAL uses the contained `// @ts-expect-error` + `as unknown as <T>` cast established in `dashboard.ts`.
- A small amount of lifecycle logic lives in SQL rather than TypeScript; this is intentional (atomicity +
  single authz point) and mirrors the procurement-transition direction (OD-PROC-4).

**Pattern:** future multi-statement, atomicity- or authorization-critical writes (e.g. the procurement
state machine `transition_procurement`, OD-PROC-4) follow this same `security definer` + internal-authz +
anon-revoke shape; single-write state changes stay ordinary RLS-gated DAL calls.
