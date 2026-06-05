# ADR-0014: Dashboard margin re-formula + companion win-rate RPC

**Status:** Accepted — 2026-06-05
**Deciders:** Director, implementer
**Issue:** #5 — Sales pipeline + dual-lens dashboard margin re-formula (capstone)

---

## Context

The Executive Dashboard ships a metric labeled `avg_gross_margin` computed as
`avg((budget − spent)/budget)` over `Ongoing Project` rows (`0003_dashboard_views.sql:29-30`).
Per **OD-MARGIN-1** this is **budget-burn headroom, NOT gross margin** — `budget` is *cost*, not
*revenue* — and it is an unweighted average-of-ratios rather than a value-weighted portfolio figure
(`OBS-SPD-002`). The owner explicitly flagged this metric as mislabeled. It is being **replaced** by
the OD-MARGIN-1 dual-lens model.

OD-MARGIN-1 carries two value-weighted lenses by project stage:

| Lens | Statuses (OD-SP-1) | Value basis | Margin formula |
|---|---|---|---|
| **On hand** (won/active) | Won, Pending KoM · Ongoing Project · On Hold · Close Out | actual `contract_value` | Σ(`contract_value` − `spent`) / Σ(`contract_value`) |
| **Pipeline** (pre-win) | Leads · PQ Submitted · Quotation Submitted · Tender Submitted · Negotiation | weighted = Σ(`contract_value` × stage win-prob) | *projected*: Σ(`contract_value` − Active-version budget) / Σ(`contract_value`) |
| **Excluded** | Loss Tender (→ win-rate denom) · Internal Project (non-revenue) | — | — |

`spent` is the OD-BUDGET-2 **committed** basis (`Σ procurements.total_value WHERE status IN
('Ordered','Received','Vendor Invoiced','Paid')`); Active-version budget is the OD-BUDGET-1
Σ-of-Active-line-items (the same SQL as `get_project_budget`, `0005_budget_mutation_rpc.sql`).

OD-SP-3 additionally mandates a **dual win-rate** (count-weighted + value-weighted) over a
user-selectable **`decided_at`** time-frame. Wins = the On-hand set; losses = `{Loss Tender}`;
undecided (`decided_at` null) deals are excluded.

---

## Decision

### (a) Re-formula `get_executive_dashboard()` in place
Replace the mislabeled `avg_gross_margin` key with the five OD-MARGIN-1 fields, **keeping ADR-0009's
invariants**: `language sql stable security invoker`, **no `org_id` argument** (org seam comes from
`auth_org_id()` inside the RLS policies, never from the client), granted only to `authenticated`,
`anon` revoked. New payload keys:

- `on_hand_value` = Σ(`contract_value`) over On-hand projects.
- `on_hand_margin` = Σ(`contract_value` − `spent`) / Σ(`contract_value`) over On-hand, where `spent`
  is the OD-BUDGET-2 committed sum; guarded `Σ(contract_value)=0 ⇒ 0`.
- `pipeline_total_value` = Σ(`contract_value`) over Pipeline projects.
- `pipeline_weighted_value` = Σ(`contract_value` × `win_probability`) joining `pipeline_stage_config`
  on status (LEFT JOIN, coalesce 0 for an unconfigured status).
- `pipeline_projected_margin` = Σ(`contract_value` − Active-version budget) / Σ(`contract_value`) over
  Pipeline; guarded `Σ(contract_value)=0 ⇒ 0`.

The retained KPIs (`active_projects`, `total_contract_value`, `projects_at_risk`,
`projects_by_status`, `procurements_by_status`, `top_projects`) are unchanged.

### (b) Win-rate is a SEPARATE companion RPC — `get_win_rate(p_from, p_to)` (DD-1)
Win-rate is **not** added as arguments on `get_executive_dashboard()`. The dashboard payload is the
heavy aggregate, cached once per org and shared across the page; the win-rate is re-queried on every
period-selector change. Coupling them would invalidate the whole dashboard cache on a period toggle
and force the heavy aggregate to recompute. A separate RPC gives an **independent TanStack cache key**
(`['win-rate', orgId, from, to]`), keeping ADR-0009's no-arg invariant on the dashboard RPC intact.

`get_win_rate(p_from date default null, p_to date default null)` returns `wins_count`,
`losses_count`, `wins_value`, `losses_value`, `win_rate_count` (count `#won/#(won+lost)`), and
`win_rate_value` (value `Σ won contract_value/Σ(won+lost) contract_value`) over projects whose
`decided_at` falls in `[p_from, p_to]` (null = unbounded; both null = all-time). Wins = On-hand set;
losses = `{Loss Tender}`; undecided excluded. Both rates guard a zero denominator → 0. Same security
posture: `security invoker`, no `org_id` arg, `authenticated`-only, `anon` revoked.

`get_sales_pipeline()` (the per-project board RPC, DD-2) is a third RPC in this issue's later phase;
it shares the same posture but is out of scope for this ADR's Phase A migration.

---

## Consequences

**Positive:**
- The dashboard now reports a correct, value-weighted, owner-sanctioned margin model instead of the
  mislabeled budget-burn ratio.
- Decoupled win-rate cache: a period toggle re-queries only the lightweight win-rate aggregate, never
  busting the heavy dashboard cache.
- All three RPCs stay RLS-scoped by construction (security invoker, no client org filter), inheriting
  the ADR-0009 audit posture — no `security definer` cross-org leak surface.

**Negative / risks:**
- Removing the `avg_gross_margin` key is a **breaking** change to the DAL payload + `ExecutiveDashboard`
  type and the `kpi-avg-gross-margin` tile; handled in the same PR (DAL/UI follow-on phases).
- `database.types.ts` lacks `Functions` entries for `get_win_rate` until the local stack is
  regenerated (ADR-0009 R3 posture); the DAL types the payloads locally with a single
  `data as unknown as <T>` cast.
- The migration carries the ADR-0009 inline guard forbidding a `security definer` switch without
  re-adding explicit `org_id = auth_org_id()` filters on every table read.

**Pattern:** mirrors ADR-0009 (`get_executive_dashboard`) and `0005_budget_mutation_rpc.sql`
(`get_project_budget`) for the security-invoker org-scoped read RPC.
