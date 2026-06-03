# ADR-0001: Single-tenant MVP with a forward-compatible `org_id` seam

- **Status:** Accepted
- **Date:** 2026-06-03
- **Relates to:** `docs/specs/target-architecture.spec.md` §6; baseline `NFR-003`, `F-2`.

## Context
The prototype has no tenancy concept at all (`baseline.spec.md NFR-003`): no `org_id`, no user→tenant
scoping. The charter (`CLAUDE.md`) requires a **single-tenant MVP** that can flip to **B2B
multi-tenant without a rewrite**. We must serve one client now cheaply, but not paint ourselves into a
corner that forces a data-model migration later.

## Decision
Add a non-null **`org_id uuid` column to every business table**, referencing a new `organizations`
table. In the MVP:
- Seed exactly **one** organization row.
- `org_id` carries a **column default** of that single org's id, so the client never sends it and cannot
  spoof it.
- RLS on every table includes the predicate `org_id = auth_org_id()`, where `auth_org_id()` reads the
  caller's `profiles.org_id`. Today this is effectively a no-op (one org) but is **structurally enforced**.

To go multi-tenant later (additive, no schema rewrite):
1. Stop defaulting `org_id`; assign it at signup from the org the user joins.
2. Mirror `org_id` into the JWT `app_metadata.org_id`; switch `auth_org_id()` to read the claim. Every
   existing `org_id = auth_org_id()` policy keeps working unchanged.
3. Add org provisioning/onboarding UI and (if needed) a membership table.
Org-scoped unique constraints (`unique (org_id, code)`) are already in the schema.

## Consequences
- **Positive:** Tenant isolation is enforced from day one; the multi-tenant flip touches auth wiring and
  one SQL helper, not the data model. No quadratic risk added.
- **Negative / cost:** Every table carries an extra column and index; every RLS policy carries the org
  predicate (minor overhead, large future payoff). Developers must remember the seam lives in the
  data-access layer (`src/lib/db/_tenant.ts`) and never hand-set `org_id` on the client.
- **Risk if skipped:** retrofitting tenancy onto a live single-tenant schema is a high-risk migration —
  exactly what this seam prevents.
