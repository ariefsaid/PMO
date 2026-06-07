# ADR-0018 — Soft-archive + delete policy (app-wide)

Status: Accepted
Date: 2026-06-07
Owner-decision basis: `docs/plans/2026-06-07-crud-rbac-program.md` (§Owner decisions, §RBAC matrix).
Companion docs: `docs/design/crud-components.md` (§5.3, §6 archived-record state), `docs/design/rbac-visibility.md` (§B, §D, §K).

## Context

The CRUD+RBAC program adds real create/edit/delete to every entity. "Delete" in a contract- and
project-based PMO is almost never a true erase: a deal, a company, or a procurement carries audit
weight and is referenced by money, schedule, and approval trails. A bare `DELETE` would orphan
budgets/procurements/timesheets and destroy history. We need a removal policy that is (a) reversible
by default, (b) honest about the few cases where a hard erase is acceptable, and (c) uniform enough to
express in one FE policy gate (`can('archive'|'delete', entity)`, ADR-0016) without special-casing each page.

The owner locked the shape of that policy this session (plan §Owner decisions):

> Soft-archive app-wide (an additive `archived_at`); list queries hide archived by default; hard-delete
> = Admin only; companies block-delete-if-referenced; procurement keeps Cancel (no hard delete, audit trail).

## Decision

**1. Soft-archive is the default removal verb, implemented as an additive nullable `archived_at timestamptz`.**
A row with `archived_at IS NULL` is live; a non-null value records *when* it was archived (and is the
audit timestamp). Archiving is an `UPDATE archived_at = now()`; restoring is `UPDATE archived_at = NULL`.
No new status enum value, no row movement, no cascade — purely additive, so it is forward-only and
reversible (`supabase db reset`, ADR-0006). This migration adds the column to **`projects` and
`companies`** (the two entities whose CRUD slices land first); entity-specific tables gain the column
with their own slice if/when they need archive (procurement does **not** — see #4).

**2. Default list queries hide archived rows; a partial index makes that the fast path.**
Every default index/list query filters `WHERE archived_at IS NULL`. A **partial index**
`... WHERE archived_at IS NULL` on each table keeps the common (live-only) listing scan cheap and small
regardless of how many rows are later archived. A "Show archived" toggle (design `crud-components §6`)
opts into the full set; archived rows render dimmed with an "Archived" pill + Restore.

**3. Hard-delete is Admin-only.** A true `DELETE` is reserved for the Admin break-glass role
(`can('delete', entity)` = Admin only; `docs/design/rbac-visibility.md §K`). It is the rare,
irreversible escape hatch (e.g. a row created in error with no real history), routed through a
`destructive` `ConfirmDialog`. All non-Admin removal is soft-archive only. RLS remains the enforcement
authority; the FE gate is a clarity projection (ADR-0016).

**4. Companies block-delete-if-referenced; procurement keeps Cancel (no delete).**
- A **company** is master data referenced by profiles/projects/procurements/quotations. A hard delete of
  a referenced company must be **blocked** (the user is steered to Archive instead — design §5.3
  GateNotice + Archive fallback). The block is owned by the **companies CRUD slice** (a referential
  guard — either an RPC that pre-checks the FK fan-in and raises, or a `RESTRICT`/`NO ACTION` FK posture
  surfaced as a classified error). It is **not** in this cross-cutting migration because it is
  company-specific behavior, not a shared archive primitive.
- **Procurement** has no archive and no hard delete: its removal verb is **Cancel** (status
  `Cancelled`), preserving the full procure-to-pay audit trail. So `procurements` deliberately does
  **not** get an `archived_at` column.

**5. RLS is unchanged by this migration.** The existing `projects_write` / `companies_write` policies
are `FOR ALL` permissive gates (`org_id = auth_org_id() AND auth_role() IN (4 write-roles)`) and already
authorize an `UPDATE` of any non-revoked column — including the new `archived_at` — for the write-roles,
scoped to the caller's org. No policy is added, dropped, or altered. The `org_id` seam is intact: the
column carries no org data and archiving an out-of-org row is already denied by the row policy.

**6. One column-grant addition (NOT an RLS change).** Migration `0008_project_revenue.sql` revoked the
table-wide `UPDATE` on `projects` from `authenticated` and re-granted it on an *explicit column list*
(to make the win-capture columns RPC-only, MED-PR-1). A column added *after* that grant is **not**
writable by `authenticated` until it is added to the grant. Therefore this migration must
`GRANT UPDATE (archived_at) ON projects TO authenticated` so the write-roles can actually archive. This
is a column privilege, not a row-security policy — it does not widen *who* may write (the row policy
still gates org + role) and it does not touch the four RPC-only columns. `companies` was never
column-revoked, so its table-wide `UPDATE` grant already covers `archived_at`; no grant needed there.

## Scope of THIS migration (`0012_soft_archive.sql`)

- `ALTER TABLE projects  ADD COLUMN archived_at timestamptz;` (nullable, no default)
- `ALTER TABLE companies ADD COLUMN archived_at timestamptz;` (nullable, no default)
- `CREATE INDEX projects_live_idx  ON projects  (org_id) WHERE archived_at IS NULL;`
- `CREATE INDEX companies_live_idx ON companies (org_id) WHERE archived_at IS NULL;`
- `GRANT UPDATE (archived_at) ON projects TO authenticated;` (re-enables write of the new column after the 0008 revoke)
- Explicit rollback comment (forward-only per ADR-0006; manual `down` documented in-file).

## What is explicitly NOT in this migration (lands with later slices, per the task)

- The companies **block-delete-if-referenced** guard (companies CRUD slice).
- The `contract_value` **SoD edit RPC** (ADR-0019, projects slice).
- The Engineer **own-task-status** RLS widening (tasks slice).
- Any `archived_at` on entity tables other than projects/companies.

## Consequences

- **Positive:** removal is reversible by default; history is preserved; the live-list scan stays cheap via
  the partial index; the policy is uniform enough for one `can()` gate; RLS is untouched so no
  re-audit of the row policies is forced by this change.
- **Cost:** every default list query must remember the `archived_at IS NULL` filter (enforced by the
  partial index being the natural plan + a repository-layer default in ADR-0017). Reporting/aggregate
  queries that should *include* archived rows must opt in explicitly.
- **Reversibility:** pre-production (ADR-0006) → `supabase db reset`. Post-deploy manual rollback is the
  documented `DROP INDEX` / `REVOKE` / `DROP COLUMN` block in the migration header.

## Alternatives considered

- **A status enum value `'Archived'`** — rejected: conflates archive (a removal lifecycle) with the
  business status (Leads/Ongoing/…); would need a parallel "real status" field and breaks every existing
  status filter and the project state machine (ADR-0012).
- **A separate `*_archive` table (move-on-archive)** — rejected: heavier (triggers/cascades), loses FK
  integrity for references, and a soft `archived_at` is sufficient for single-tenant MVP.
- **Hard-delete with `ON DELETE CASCADE` everywhere** — rejected: destroys audit/financial history; the
  owner explicitly chose soft-archive + Admin-only hard-delete + the companies referential block.

## Verification

`supabase db reset` then `supabase test db` green. The pgTAP `supabase/tests/0012_soft_archive.test.sql`
proves: the column exists and is nullable on both tables; a write-role can set `archived_at` on its own
org row (and the grant from #6 makes that possible on `projects`); the partial index exists with the
`archived_at IS NULL` predicate on each table; and the existing suite shows no regression.
