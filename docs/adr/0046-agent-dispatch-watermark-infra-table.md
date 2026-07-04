# ADR-0046 — Dispatch watermark infra table

- **Status:** Accepted (owner-directed 2026-07-03)
- **Date:** 2026-07-03
- **Deciders:** Owner, Director
- **Related:** ADR-0044 (agent automations + notifications — the feature this table supports),
  ADR-0001 (org_id seam), ADR-0018 (soft-archive).
- **Scope:** the storage shape for the agent-dispatch edge function's per-source poll watermark
  (ADR-0044 §2, FR-AAN-013). This is the one net-new architectural decision ADR-0044 leaves to the
  implementing plan — everything else (minting, `service_role` quarantine, poll-since-watermark,
  NL-condition fail-quiet, the notifications channel seam, credits metering) is already decided in
  ADR-0044.

## Context

The dispatcher (ADR-0044 §2) needs a monotonic per-source cursor — the id/`created_at` of the most
recently processed status-event row — so a retried or overlapping tick does not re-fire an
automation for an already-processed event (FR-AAN-013). This is dispatcher **bookkeeping**, not
tenant business data: it tracks how far the dispatcher has read into an append-only log
(`procurement_status_events` today; other sources later), not anything owned by a specific user or
organization.

The codebase's standing invariant, enforced on every business table since ADR-0001, is "every table
has RLS + an `org_id` column." A watermark table is the first table in this codebase that
legitimately has neither — it needs a decision recorded, not a silent exception, so a future auditor
grep-ing for a missing `org_id` finds documented intent instead of a suspected bug.

## Decision

A new, dedicated, small table:

```sql
create table agent_dispatch_watermarks (
  source        text primary key,
  last_seen_id  uuid,
  last_seen_at  timestamptz,
  updated_at    timestamptz not null default now()
);
```

- **One row per event source** (`source` is the primary key, e.g. `'procurement_status_events'`).
  Adding a second event source later (a future `kind='trigger'` automation hooking a different
  append-only log) is an additional row, not a schema change.
- **`enable` + `force` row level security, with NO policy defined.** Postgres RLS with no policy is
  default-deny to every role that is subject to RLS — every ordinary JWT role (`authenticated`,
  `anon`) is denied all access. Only `service_role` (which bypasses RLS entirely, by Postgres/Supabase
  design) can read or write this table. This is deliberately more restrictive than an owner-scoped
  policy: there is no owner, so there is nothing to scope to.
- **No `org_id` / `owner_id` column.** The watermark is not tenant data — it is a global cursor over
  a single dispatcher's read progress through an append-only log that is itself already tenant-scoped
  and RLS-protected at its source. Adding an `org_id` here would imply a per-org watermark, which is
  not the model (the dispatcher polls one source table across all tenants each tick and filters
  matches to each automation's own tenant via the automation row's `org_id`, not via the watermark).

## Consequences

**Positive**
- Minimal, indexed (by primary key), and trivially extensible — a second source is a new row, not a
  migration.
- The watermark advance is a single-row `upsert` keyed on `source`, with no risk of scoping it to the
  wrong tenant (there is no tenant to get wrong). **⚠ Amended 2026-07-04 (gpt-5.5 cross-family audit):**
  the shipped discipline is **advance-per-attempted-event, not advance-only-after-successful-fire.** The
  cursor advances over every matched event the dispatcher *attempted*, so a single automation that throws
  mid-fire neither rewinds the cursor nor blocks siblings, and the cursor is a true `(created_at, id)`
  compound so same-timestamp events are neither missed nor re-fired. This is the correct posture and
  supersedes the earlier "advance-after-success" phrasing, which would have re-scanned already-fired events
  forever on any mid-batch failure. Known Low follow-up: events matching *no* automation never advance the
  per-source cursor, so unmatched history is re-scanned each tick (efficiency, not correctness — ticketed).

**Negative / costs**
- A table with **no `org_id`** in an `org_id`-seam codebase is, on its face, a divergence from the
  standing invariant. Mitigated two ways: (1) this ADR, so the divergence is documented decision, not
  an oversight; (2) the migration's own header comment restates the rationale inline; (3) a test
  (`AC-AAN-018`, the dispatcher's `service_role` table-set assertion) proves the *only* code path that
  ever touches this table is the dispatcher's `service_role` client — no interactive, caller-JWT-scoped
  code path ever queries it, so the missing RLS policy is never a reachable gap from the browser/API
  surface a tenant boundary actually needs to defend.

## Alternatives considered

- **A column on an existing singleton config row.** Rejected: couples watermark bookkeeping to an
  unrelated table, and a singleton row has no natural per-source key — a second event source would
  need ad hoc column sprawl (`procurement_last_seen_id`, `next_source_last_seen_id`, ...) instead of a
  new row in a properly keyed table.
- **An owner-scoped table (with `org_id`/`owner_id`).** Rejected: there is no natural owner for
  "how far has the dispatcher read into this log" — it is not addressed to any single user, and giving
  it a synthetic owner would misrepresent what the column means without adding any real access-control
  value (the table is never reached by a caller-JWT-scoped client in the first place).

## Verification

- The migration (`0048_agent_automations_notifications.sql`) creates this table with `enable`+`force`
  RLS and no policy.
- `AC-AAN-018` (`pmo-portal/src/lib/agent/dispatch/dispatcher.deputy-invariant.test.ts`) asserts the
  set of tables touched under the dispatcher's `service_role` client is exactly
  `{agent_automations, agent_dispatch_watermarks, procurement_status_events}` — proving no other code
  path ever needs to reach this table, so its default-deny RLS posture is sufficient in practice as
  well as in principle.
