# ADR-0074 — The OAuth API-client guard gains an active-Admin tier for loading a client's starting data

- **Status:** Proposed (Design+Plan, issue #796, 2026-10-06)
- **Deciders:** Director, under the owner's OD-SEED-5 (2026-10-05)
- **Related:** DD-API-1/2/3 (`docs/decisions.md`), migration `0222` (the guard), ADR-0016 (RLS is the
  authority), ADR-0019 (privileged writes via security-definer RPC), ADR-0070 (money SoD as rank),
  ADR-0058 (outbox). **Spec:** [`docs/specs/client-starting-data-cli.spec.md`](../specs/client-starting-data-cli.spec.md).
  **Plan:** [`docs/plans/2026-10-06-client-starting-data-cli.md`](../plans/2026-10-06-client-starting-data-cli.md).

## Context

DD-API-3 kept contract values, project transitions and budget writes closed to OAuth API clients, and
migration `0222` enforces that as a PostgREST pre-request guard: one fixed list per method, the same for
every user. OD-SEED-5 then let the owner load a client's won projects at their real stage, with contract
value and draft budgets, and asked for the CLI to do it without the Director (#796).

Every write that load needs already exists and is already enforced in the database: plain RLS inserts
for companies, projects and budget rows (Draft-only by the 0176 trigger, keyed by the 0195 index), and
the definer RPCs `set_project_contract_value` and `transition_project` with their org, role, SoD and
audit rules. What blocks the CLI is only the guard's endpoint list. Opening those endpoints to **every**
OAuth client would hand the same surface to any future non-owner client or MCP client.

## Decision

1. **The guard gets a second tier, keyed on the caller's live standing.** For a token with `client_id`,
   `POST /rpc/set_project_contract_value`, `POST /rpc/transition_project` and `GET`/`POST` on
   `budget_versions` / `budget_line_items` pass only when `public.auth_role() = 'Admin'` and
   `public.is_active_member()`. The check runs only for those endpoints, inside the existing pre-request
   function (migration `0239`). No new RPC, no new table, no new write path.
2. **`external_domain_ownership` becomes a read-only endpoint for every client**, so a load can tell
   whether ERPNext owns companies before it plans.
3. **Everything else stays closed**, including for the Admin: PATCH/DELETE on budget tables,
   `activate_budget_version`, work-order and money RPCs, edge functions by intent (the CLI does not call
   them), the ERPNext project map.
4. **The CLI mirrors the tier** (`LOAD_TABLES`, `LOAD_RPCS`) and uses it only from `pmo load`; a drift
   test compares the lists with the latest migration, as `0222`'s already does.

## Consequences

**Good.** The owner can load a client without the Director or a service-role key, and every row passes
the same RLS, triggers, SoD and audit as the app. A demoted or offboarded owner loses the tier at the
next request. Other clients see no change.

**Costs and risks accepted.**
- Two profile lookups (`auth_role`, `is_active_member`) on the tier's requests only — a few per project.
- An Admin's OAuth token can now set a contract value or move a stage outside `pmo load` by hand-crafted
  HTTP. That is exactly what the same Admin can do in the browser; the database rules are identical.
- The guard still covers the REST API only. Edge functions and Storage accept a client token with the
  user's normal permissions (as documented for `0222`); closing that remains a precondition for any
  non-owner or MCP client.
- The audit trail of a loaded won project shows its stage walk on the load date (the true record of a
  load), while `decided_at` carries the real contract date.

**Reversibility (ADR-0006).** `supabase/migrations/rollback/0239_api_client_seed_surface_down.sql`
restores `0222`'s function body. No table, column or data changes.
