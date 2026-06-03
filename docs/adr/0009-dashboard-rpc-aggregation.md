# ADR-0009: Dashboard KPI aggregation via a Postgres RPC (`get_executive_dashboard`)

**Status:** Accepted — 2026-06-04
**Deciders:** Director, implementer
**Issue:** #7 — Executive Dashboard real data (read path)

---

## Context

The baseline `ExecutiveDashboard.tsx` computes all KPIs and chart aggregates on the client from
full `mockData` arrays (`OBS-DASH-001`): `projects.filter(…).reduce(…)`, `companies.find(…)` per
row, and a hard-coded fake YTD series (`F-11`). Target architecture §8.4 and `FR-API-003` mandate
that aggregates be computed in SQL (views / RPCs), with only the payload crossing the wire.

The Dashboard page is also the **last consumer of `mockUserForRole`** — the role-dispatch bridge
left over from the prototype. Removing it here is a requirement (`FR-DASH-009`, `AC-711`).

---

## Decision

Compute all Executive KPIs and chart aggregates in a single Postgres RPC
`get_executive_dashboard()` that returns one JSON payload. The function is:

- **`security invoker`** (the default — not `security definer`): every base-table read inside the
  function runs under the **caller's** RLS policies (`projects_select`, `procurements_select`,
  `companies_select`), all of which enforce `org_id = auth_org_id()`. The aggregates are
  therefore scoped to the caller's org automatically.
- **No `org_id` argument**: the org seam is provided by `auth_org_id()` inside the existing RLS
  policies; the client never sends an org identifier that could be spoofed.
- **Granted only to `authenticated`**: anonymous access is revoked.
- **Inline migration comment** forbids a future switch to `security definer` without re-adding an
  explicit `org_id = auth_org_id()` filter on every table read (cross-org leak risk, audit R1).

The payload is consumed via:
- `src/lib/db/dashboard.ts` — typed `getExecutiveDashboard(): Promise<ExecutiveDashboard>`; calls
  `supabase.rpc('get_executive_dashboard')`, sends no `org_id`, throws on error.
- `src/hooks/useDashboard.ts` — TanStack Query hook; queryKey `['dashboard', orgId]` (tenant-scoped
  cache); `enabled` only when `orgId` is present.

The page (`pages/ExecutiveDashboard.tsx`) consumes the `ExecutiveDashboard` interface directly
(snake_case fields from the RPC, no `as unknown as <prototype>` casts beyond the single DAL cast
on the `json` return type).

### Alternatives considered

**Client-side aggregation from fetched rows** (Option B in the spec): rejected — violates §8.4 /
`FR-API-003` (aggregates in SQL), causes O(n) browser work and N full rows over the wire, and
reintroduces the render-time `.find()` join anti-pattern (`OBS-DASH-002`).

**Multiple targeted queries** (one per KPI/chart): rejected — more round trips, more caching
complexity; the aggregates are simple enough that one SQL `json_build_object` covers all of them.

---

## Consequences

**Positive:**
- Scales to millions of rows: only aggregates cross the wire (bytes ∝ number of distinct statuses
  + top-5 rows, not total project/procurement count).
- Existing `projects_org_status_idx` / `procurements_org_status_idx` cover the `GROUP BY status`
  scans.
- Eliminates render-time `.find()` joins (`OBS-DASH-002`) and in-memory array aggregation
  (`OBS-DASH-001`).
- RLS-scoped by construction: no client-supplied org filter needed.

**Negative / risks:**
- New SQL surface — security-auditor must verify the invoker + no-arg + RLS model before shipping
  (R1 in the spec).
- The `security invoker` model must be preserved; the migration carries an explicit inline guard
  forbidding a `security definer` switch without an org filter.
- `database.types.ts` should gain a `Functions.get_executive_dashboard` entry when the local stack
  is regenerated (`R3`). Until then, the DAL types the payload locally with the `ExecutiveDashboard`
  interface, and the single `data as unknown as ExecutiveDashboard` cast is the only escape hatch.

**Pattern:** future per-role dashboard views (`v_pm_dashboard`, `v_finance_dashboard`,
`v_engineer_workload` — §8.4) follow the same RPC/hook pattern as established here.
