# Spec: Sales-pipeline + Dashboard margin re-formula (build-wave issue #5, capstone)

**Status:** Draft — pending owner sign-off
**Feature slug:** `sales-pipeline-dashboard`
**Issue:** #5 — Sales pipeline + dual-lens dashboard margin re-formula (the capstone; consumes #1–#4).
**AC range:** AC-1100..AC-1117 (grep-confirmed unused; AC-1000..AC-1011 belong to issue #4).
**FR prefix:** `FR-SPD-###`. Observed-legacy: `OBS-SPD-###`. Non-functional: `NFR-SPD-###`.

Cites owner decisions (source of truth `docs/decisions.md`): **OD-MARGIN-1/2**, **OD-SP-1/2/3**,
**OD-BUDGET-1/2**. Consumes the merged foundations: `0003_dashboard_views.sql`
(`get_executive_dashboard`, ADR-0009), `0005_budget_mutation_rpc.sql` (`get_project_budget`),
`0006_procurement_lifecycle.sql` (committed-procurement basis), `0008_project_revenue.sql`
(`projects.contract_value`/`decided_at`/`contract_date`/`customer_contract_ref`,
`pipeline_stage_config`).

---

## 1. Background & problem

Today's Executive Dashboard ships a metric labeled `avg_gross_margin` computed as
`avg((budget - spent)/budget)` over `Ongoing Project` rows (`0003_dashboard_views.sql:29-30`). Per
**OD-MARGIN-1** this is **budget-burn headroom, not gross margin** (budget is *cost*, not *revenue*),
and it is an unweighted average-of-ratios rather than a value-weighted portfolio figure. It is being
**replaced**.

The prototype `pages/SalesPipeline.tsx` (OBS-SPD-001) computes pipeline value, weighted forecast and
win-rate from `data/mockData` with **hard-coded stage probabilities** (Tender 0.6, Negotiation 0.8 —
contradicting the locked OD-SP-2 ramp) and an all-time, count-only win-rate over the full mock array.
It predates OD-MARGIN/OD-SP and is **superseded, not polish-away-from-merge** (per the PR #12
re-evaluation note in `docs/decisions.md`). It is rebuilt on real data here.

This issue delivers the dual-lens margin model (OD-MARGIN-1), the dual win-rate with a `decided_at`
time-frame filter (OD-SP-3), and the real-data SalesPipeline screen reading `pipeline_stage_config`
(OD-SP-2). No new business rules are introduced — every formula is a locked owner decision.

### 1.1 Observed legacy (to be replaced/removed)

- **OBS-SPD-001** — `pages/SalesPipeline.tsx` computes pipeline value/forecast/win-rate from
  `data/mockData` with hard-coded stage probabilities and a count-only all-time win-rate. Mislabels
  forecast probability ramp (Tender 0.6 / Negotiation 0.8) vs OD-SP-2 (Tender 0.50 / Negotiation 0.75).
- **OBS-SPD-002** — `get_executive_dashboard()` returns `avg_gross_margin = avg((budget-spent)/budget)`
  over Ongoing projects: mislabeled (cost not revenue) and unweighted. Replaced by OD-MARGIN-1 lenses.
- **OBS-SPD-003** — `pages/ExecutiveDashboard.tsx` `kpi-avg-gross-margin` tile renders OBS-SPD-002 with
  description "Budget vs spent". Replaced by the on-hand actual weighted margin tile.

---

## 2. Scope

### IN
- Replace the mislabeled `avg_gross_margin` with the OD-MARGIN-1 dual-lens metrics inside
  `get_executive_dashboard()` (keep ADR-0009 discipline: `security invoker`, no `org_id` arg).
- A companion `get_win_rate(p_from, p_to)` RPC returning dual (count + value) win-rate over a
  `decided_at` date range (OD-SP-3). Decision rationale in §6 / ADR-0014.
- A `get_sales_pipeline()` RPC returning pipeline projects grouped by stage with per-stage weighted
  value (reads `pipeline_stage_config`), for the rebuilt SalesPipeline screen.
- Exec Dashboard UI: on-hand actual weighted margin tile, pipeline weighted value + projected margin
  tiles, and a win-rate tile with a count/value toggle + a time-frame selector.
- SalesPipeline screen rebuilt on real data (stages from `get_sales_pipeline`, weighted value per stage).
- DAL + hooks + types for all three RPCs.

### OUT (deferred — do not build)
- Proposed-vs-final value variance / value-change history (OD-MARGIN-2 deferred seam).
- Per-role sub-dashboards (PM/Finance/Engineer views stay on mockData; separate issue).
- ProjectDetails decomposition.
- Admin config UI for `pipeline_stage_config` win-probabilities (OD-PROC-6 config bridge).
- Per-category procurement→budget spend roll-up (OD-BUDGET-2 deferred portion).

---

## 3. The math (precise; the test oracle)

All margins are **value-weighted portfolio ratios** (Σ-of-numerators / Σ-of-denominators), NOT
average-of-ratios (OD-MARGIN-1). Membership sets are OD-SP-1.

### 3.1 Status sets (OD-SP-1)
- **Pipeline** = `{Leads, PQ Submitted, Quotation Submitted, Tender Submitted, Negotiation}`.
- **On hand** = `{Won, Pending KoM, Ongoing Project, On Hold, Close Out}`.
- **Win-set** (win-rate numerator) = the On-hand set above.
- **Loss-set** (win-rate denominator only) = `{Loss Tender}`.
- **Excluded entirely** = `Internal Project` (non-revenue), and in-pipeline (undecided) deals are
  excluded from win-rate.

Exact enum spelling note: `'Won, Pending KoM'` contains a comma (see `0008_project_revenue.sql`).

### 3.2 `spent` (OD-BUDGET-2, committed basis)
For a project: `spent = Σ procurements.total_value WHERE project_id = p.id AND status IN
('Ordered','Received','Vendor Invoiced','Paid')`. Excludes Draft/Requested/Approved/Vendor
Quoted/Quote Selected/Rejected/Cancelled. Labor excluded (no timesheet cost).

### 3.3 Active-version budget (OD-BUDGET-1)
For a project: `budget = Σ budget_line_items.budgeted_amount` of its Active `budget_versions` row.
No Active version ⇒ budget = 0. (Same SQL as `get_project_budget`, inlined as a join so the dashboard
RPC stays one round-trip.)

### 3.4 On-hand actual weighted margin (`on_hand_margin`)
```
on_hand_margin = Σ(contract_value − spent) / Σ(contract_value)   over On-hand projects
on_hand_value  = Σ(contract_value)                                over On-hand projects
```
If `Σ(contract_value) = 0` over the on-hand set ⇒ `on_hand_margin = 0` (guard, no div-by-zero).

### 3.5 Pipeline weighted value (`pipeline_weighted_value`)
```
pipeline_weighted_value = Σ(contract_value × win_probability(status))   over Pipeline projects
```
`win_probability(status)` is read from `pipeline_stage_config` (org-scoped; OD-SP-2 defaults
Leads 0.100 / PQ 0.250 / Quotation 0.400 / Tender 0.500 / Negotiation 0.750). A pipeline project whose
status has no config row contributes 0 (LEFT JOIN, coalesce 0).

### 3.6 Pipeline projected margin (`pipeline_projected_margin`)
```
pipeline_projected_margin = Σ(contract_value − Active-version-budget) / Σ(contract_value)
                            over Pipeline projects
pipeline_total_value      = Σ(contract_value)   over Pipeline projects   (unweighted)
```
If `Σ(contract_value) = 0` over the pipeline set ⇒ `pipeline_projected_margin = 0` (guard).

### 3.7 Dual win-rate over a `decided_at` range (OD-SP-3)
Given an inclusive date range `[p_from, p_to]` matched against `decided_at` (null `decided_at` =
undecided = excluded). Let W = projects with `status ∈ Win-set AND decided_at` in range; L = projects
with `status ∈ Loss-set AND decided_at` in range.
```
win_rate_count = count(W) / (count(W) + count(L))
win_rate_value = Σ(W.contract_value) / (Σ(W.contract_value) + Σ(L.contract_value))
```
If `count(W)+count(L) = 0` ⇒ both = 0 (guard). If the value denominator = 0 ⇒ `win_rate_value = 0`.
Null `p_from` ⇒ no lower bound; null `p_to` ⇒ no upper bound (all-time when both null).
Range is **inclusive** on both ends (`decided_at >= p_from AND decided_at <= p_to`); callers pass a
`p_to` of the last instant of the day (the DAL passes the date's end-of-day; see FR-SPD-009).

### 3.8 Worked example — the seed oracle (default org, `supabase/seed.sql`)

Seed projects (default org `…0001`):

| Project | Status | contract_value | Active budget Σ | committed spent |
|---|---|---|---:|---:|
| P001 Innovate HQ Fit-Out | Ongoing Project (on-hand) | 5,000,000 | 4,700,000 | 405,000 (PO 85,000 + Paid 320,000) |
| P003 Acme Internal Platform | Ongoing Project (on-hand) | 3,000,000 | 2,000,000 | 0 |
| P002 Northwind ERP Rollout | Tender Submitted (pipeline) | 1,200,000 | 1,000,000 | 0 |
| P011 Highfield Bridge Survey | Tender Submitted (pipeline) | 950,000 | 950,000 | 0 |
| P010 Regional Services | PQ Submitted (pipeline) | 800,000 | 600,000 | 0 |
| P004 Coastal Depot Bid | Loss Tender (loss) | 650,000 | 5,000 | 0 |

> P011 "Highfield Bridge Survey" was added to the seed in **PR #27** (a dedicated second Tender deal so
> the AC-SP e2e drilldown can win/lose a row without colliding with P002). It makes the pipeline set
> **3 deals**; its Active budget equals its contract value (contributes 0 to the projected-margin
> numerator). P002/P010 carry the SPD-S1 reduced budgets (1,000,000 / 600,000).

Committed-spent derivation: only `Ordered` (PROC 002, 85,000) and `Paid` (PROC 005, 320,000) count,
both on P001 ⇒ P001 spent = 405,000. PROC 001 (Vendor Quoted), 003 (Requested), 004 (Draft) excluded.

**Oracle values (encode these in pgTAP):**

- `on_hand_value` = 5,000,000 + 3,000,000 = **8,000,000**
- `on_hand_margin` = ((5,000,000−405,000) + (3,000,000−0)) / 8,000,000 = 7,595,000 / 8,000,000
  = **0.949375** (UI: **94.9%**)
- `pipeline_total_value` = 1,200,000 + 950,000 + 800,000 = **2,950,000**
- `pipeline_weighted_value` = (1,200,000 + 950,000)×0.500 + 800,000×0.250 = 1,075,000 + 200,000
  = **1,275,000** (Tender deals P002+P011 at 0.500, PQ deal P010 at 0.250).
- `pipeline_projected_margin` = Σ(contract_value − Active-version-budget) / Σ(contract_value) over the
  pipeline set. With the SPD-S1 budgets (P002 → 1,000,000; P010 → 600,000) and P011's budget == its
  contract_value (950,000): `((1,200,000−1,000,000) + (950,000−950,000) + (800,000−600,000)) /
  2,950,000` = (200,000 + 0 + 200,000) / 2,950,000 = 400,000 / 2,950,000 = **0.135593…** (UI: **13.6%**).
  `pipeline_weighted_value` is unaffected by budgets.

**Win-rate oracles** (all-time, `p_from`/`p_to` null): W = {P001, P003}, L = {P004}.
- `win_rate_count` = 2 / (2+1) = **0.666667** (UI: **66.7%**)
- `win_rate_value` = (5,000,000+3,000,000) / (5,000,000+3,000,000+650,000) = 8,000,000 / 8,650,000
  = **0.924855** (UI: **92.5%**)

**Win-rate oracles — time-filtered** (proves the filter works; decided_at: P001=2026-01-06,
P003=2026-02-01, P004=2026-02-20):
- Range `[2026-01-01, 2026-01-31]` ⇒ W={P001}, L={} ⇒ count = 1/1 = **1.000** (100%);
  value = 5,000,000/5,000,000 = **1.000** (100%).
- Range `[2026-02-01, 2026-02-28]` ⇒ W={P003}, L={P004} ⇒ count = 1/2 = **0.500** (50%);
  value = 3,000,000/(3,000,000+650,000) = 3,000,000/3,650,000 = **0.821918** (UI: **82.2%**).

These five distinct, hand-computed numbers are the pgTAP oracle (`AC-1100`, `AC-1101`, `AC-1102`,
`AC-1106`, `AC-1107`).

---

## 4. Functional requirements (EARS)

### Dashboard margin RPC (5a)
- **FR-SPD-001** — The system shall compute, over On-hand projects (OD-SP-1), `on_hand_margin =
  Σ(contract_value − committed_spent)/Σ(contract_value)` and `on_hand_value = Σ(contract_value)`,
  guarding `Σ(contract_value)=0 ⇒ on_hand_margin=0`, where `committed_spent` is the OD-BUDGET-2
  committed basis (§3.2).
- **FR-SPD-002** — The system shall compute, over Pipeline projects (OD-SP-1), `pipeline_weighted_value
  = Σ(contract_value × win_probability(status))` reading `win_probability` from `pipeline_stage_config`
  (org-scoped); a status with no config row contributes 0.
- **FR-SPD-003** — The system shall compute, over Pipeline projects, `pipeline_projected_margin =
  Σ(contract_value − active_budget)/Σ(contract_value)` and `pipeline_total_value = Σ(contract_value)`,
  guarding `Σ(contract_value)=0 ⇒ pipeline_projected_margin=0`, where `active_budget` is the
  OD-BUDGET-1 Active-version sum (§3.3).
- **FR-SPD-004** — `get_executive_dashboard()` shall return the new fields `on_hand_margin`,
  `on_hand_value`, `pipeline_weighted_value`, `pipeline_projected_margin`, `pipeline_total_value` in its
  JSON payload, and shall **remove** `avg_gross_margin` (OBS-SPD-002). Existing fields
  (`active_projects`, `total_contract_value`, `projects_at_risk`, `projects_by_status`,
  `procurements_by_status`, `top_projects`) shall be retained unchanged.
- **FR-SPD-005** — `get_executive_dashboard()` shall remain `security invoker` with no `org_id`
  argument (ADR-0009): every base-table read is org-scoped by the caller's RLS. (NFR-SPD-SEC-001.)

### Win-rate RPC (5a)
- **FR-SPD-006** — The system shall provide `get_win_rate(p_from date, p_to date)` returning
  `win_rate_count`, `win_rate_value`, `wins_count`, `losses_count`, `wins_value`, `losses_value` over
  the `decided_at` range (§3.7), `security invoker`, granted only to `authenticated`, anon revoked.
- **FR-SPD-007** — When `p_from`/`p_to` are null, `get_win_rate` shall apply no lower/upper bound
  respectively (both null = all-time).
- **FR-SPD-008** — `get_win_rate` shall guard `wins_count + losses_count = 0 ⇒ both rates = 0` and a
  zero value-denominator ⇒ `win_rate_value = 0`.

### Sales-pipeline RPC (5b)
- **FR-SPD-010** — The system shall provide `get_sales_pipeline()` returning, for each Pipeline status
  (OD-SP-1), the project count, `Σ contract_value`, `win_probability`, and weighted value
  (`Σ contract_value × win_probability`), plus a flat list of pipeline projects (id, name, client_name,
  status, contract_value, win_probability) for the board, `security invoker`, no `org_id` arg.

### DAL / hooks (5a + 5b)
- **FR-SPD-009** — `src/lib/db/dashboard.ts` shall expose typed `getExecutiveDashboard()` (extended
  payload), `getWinRate(from?: Date, to?: Date)`, and `getSalesPipeline()`; on RPC error each throws.
  `getWinRate` shall send the range as `p_from`/`p_to` ISO dates (end-of-day for `p_to` per §3.7).
- **FR-SPD-011** — `src/hooks/useDashboard.ts` shall keep the org-scoped `useDashboard()` and add
  `useWinRate(range)` (queryKey includes org_id + range) and `useSalesPipeline()` (queryKey includes
  org_id), each enabled only when `org_id` is present (FR-QRY-DASH parity).

### Exec Dashboard UI (5a)
- **FR-SPD-012** — `pages/ExecutiveDashboard.tsx` executive view shall render an on-hand actual
  weighted margin tile (`kpi-on-hand-margin`, value `on_hand_margin × 100` to 1 dp), a pipeline
  weighted value tile (`kpi-pipeline-weighted-value`, `formatCurrency(pipeline_weighted_value)`), and a
  pipeline projected margin tile (`kpi-pipeline-projected-margin`, `pipeline_projected_margin × 100` to
  1 dp), replacing the removed `kpi-avg-gross-margin` tile (OBS-SPD-003).
- **FR-SPD-013** — The executive view shall render a win-rate tile (`kpi-win-rate`) with a count/value
  toggle (`win-rate-toggle`, default count) and a time-frame selector (`win-rate-period`, options:
  All time / YTD / Last quarter / Trailing 12 months), driving `useWinRate(range)`; the displayed value
  is `win_rate_count × 100` or `win_rate_value × 100` to 1 dp per the toggle.

### SalesPipeline UI (5b)
- **FR-SPD-014** — `pages/SalesPipeline.tsx` shall be rebuilt to consume `useSalesPipeline()` (no
  `data/mockData`, no hard-coded probabilities), rendering pipeline projects grouped by the five
  OD-SP-1 pipeline stages with each stage's count, total value, win-probability and weighted value, and
  a total weighted pipeline value KPI = `pipeline_weighted_value` (parity with the dashboard tile).
- **FR-SPD-015** — The SalesPipeline screen shall render loading, error (with retry) and empty
  (no pipeline projects) states.

### Non-functional
- **NFR-SPD-SEC-001** — All three RPCs are `security invoker`, take no `org_id` argument, are granted
  only to `authenticated`, and revoke `anon` (ADR-0009 discipline). Switching any to `security definer`
  is forbidden without re-adding explicit `org_id = auth_org_id()` filters (inline migration guard).
- **NFR-SPD-PERF-001** — Each RPC returns aggregates (per-status rows + scalars + a bounded pipeline
  list), not full tables, in one round trip; status grouping is covered by existing
  `projects_org_status_idx`; the win-rate filter is covered by `projects_org_decided_idx`
  (`0008_project_revenue.sql:25`).
- **NFR-SPD-TENANCY-001** — Every aggregate is scoped to the caller's org by the existing
  `projects_select` / `procurements_select` / `companies_select` / `budget_versions_select` /
  `budget_line_items_select` / `pipeline_stage_config_select` RLS policies; no cross-org figure is
  observable. Proven by pgTAP with a second-org fixture.

---

## 5. Acceptance criteria (Given/When/Then)

Each AC owned by exactly **one** layer (ADR-0010). Owning layer in the traceability table (§7).

### Margin RPC — pgTAP (aggregate correctness + tenancy)
- **AC-1100** — *on-hand actual weighted margin.* **Given** the seed projects of §3.8, **When**
  `get_executive_dashboard()` is called as an authenticated default-org user, **Then**
  `on_hand_margin = 0.949375` (±1e-6) and `on_hand_value = 8000000`. (FR-SPD-001)
- **AC-1101** — *pipeline weighted value.* **Given** the seed pipeline projects + OD-SP-2 config,
  **When** `get_executive_dashboard()` is called, **Then** `pipeline_weighted_value = 1275000`
  ((1.2M+0.95M)×0.5 + 0.8M×0.25). (FR-SPD-002)
- **AC-1102** — *pipeline projected margin.* **Given** the seed pipeline projects (P002/P011 Tender +
  P010 PQ) with the SPD-S1 budgets (P002 1,000,000; P010 600,000; P011 950,000==contract), **When**
  `get_executive_dashboard()` is called, **Then** `pipeline_projected_margin = 400000/2950000 ≈ 0.135593`
  (±1e-6) and `pipeline_total_value = 2950000`. (FR-SPD-003)
- **AC-1103** — *avg_gross_margin removed.* **Given** the deployed schema, **When**
  `get_executive_dashboard()` returns, **Then** the JSON payload has **no** `avg_gross_margin` key and
  **has** keys `on_hand_margin`, `on_hand_value`, `pipeline_weighted_value`,
  `pipeline_projected_margin`, `pipeline_total_value`. (FR-SPD-004)
- **AC-1104** — *margin div-by-zero guards.* **Given** an org with no on-hand and no pipeline projects,
  **When** `get_executive_dashboard()` is called, **Then** `on_hand_margin = 0`,
  `pipeline_projected_margin = 0`, `pipeline_weighted_value = 0` (no error raised). (FR-SPD-001/003)
- **AC-1105** — *margin tenancy isolation.* **Given** a second org B with its own projects, **When** a
  default-org user calls `get_executive_dashboard()`, **Then** none of org B's contract values appear
  in any margin/value figure (figures equal the default-org-only oracle). (NFR-SPD-TENANCY-001)

### Win-rate RPC — pgTAP
- **AC-1106** — *all-time dual win-rate.* **Given** the seed (W={P001,P003}, L={P004}), **When**
  `get_win_rate(null,null)` is called, **Then** `win_rate_count = 0.666667` (±1e-6) and
  `win_rate_value = 0.924855` (±1e-6). (FR-SPD-006/007)
- **AC-1107** — *time-frame filter.* **Given** the seed `decided_at` dates, **When**
  `get_win_rate('2026-02-01','2026-02-28')` is called, **Then** `win_rate_count = 0.5` and
  `win_rate_value = 0.821918` (±1e-6); **and When** `get_win_rate('2026-01-01','2026-01-31')` is
  called, **Then** `win_rate_count = 1.0` and `win_rate_value = 1.0`. (FR-SPD-006)
- **AC-1108** — *win-rate empty guard.* **Given** a range with no decided deals (e.g.
  `get_win_rate('2030-01-01','2030-12-31')`), **When** called, **Then** `win_rate_count = 0` and
  `win_rate_value = 0` (no division error). (FR-SPD-008)
- **AC-1109** — *win-rate tenancy + anon.* **Given** a second org B and an anon role, **When**
  `get_win_rate` is called as a default-org user it returns only default-org figures, **and** the anon
  role has no EXECUTE grant on `get_win_rate`. (NFR-SPD-SEC-001/TENANCY-001)

### Sales-pipeline RPC — pgTAP
- **AC-1110** — *pipeline stages weighted.* **Given** the seed pipeline projects, **When**
  `get_sales_pipeline()` is called, **Then** it returns a `Tender Submitted` stage with count 2 (P002 +
  P011), total 2,150,000, win_probability 0.500, weighted 1,075,000, and a `PQ Submitted` stage with
  count 1, total 800,000, win_probability 0.250, weighted 200,000; on-hand/loss/internal statuses are
  absent. (FR-SPD-010)

### DAL / hooks / formatting / toggle / empty — Unit (Vitest/RTL)
- **AC-1111** — *DAL extended dashboard.* **Given** a mocked `supabase.rpc('get_executive_dashboard')`
  returning the extended payload, **When** `getExecutiveDashboard()` resolves, **Then** it returns the
  typed object including the five new fields; on RPC error it throws. (FR-SPD-009)
- **AC-1112** — *DAL win-rate range marshaling.* **Given** a mocked `supabase.rpc('get_win_rate')`,
  **When** `getWinRate(new Date('2026-02-01'), new Date('2026-02-28'))` is called, **Then** it invokes
  the RPC with `p_from='2026-02-01'` and `p_to` = the end-of-day of 2026-02-28 (per §3.7); with no args
  it sends `p_from=null,p_to=null`; on error it throws. (FR-SPD-009)
- **AC-1113** — *DAL sales-pipeline.* **Given** a mocked `supabase.rpc('get_sales_pipeline')`, **When**
  `getSalesPipeline()` resolves, **Then** it returns the typed stages + projects; on error it throws.
  (FR-SPD-009)
- **AC-1114** — *dashboard tiles render new metrics.* **Given** a mocked `useDashboard` returning the
  oracle payload, **When** the executive view renders, **Then** `kpi-on-hand-margin` shows "94.9%",
  `kpi-pipeline-weighted-value` shows `formatCurrency(800000)`, `kpi-pipeline-projected-margin` shows
  "20.0%", and no `kpi-avg-gross-margin` element exists. (FR-SPD-012)
- **AC-1115** — *win-rate toggle + period selector.* **Given** mocked `useWinRate` returning the §3.8
  all-time oracle, **When** the executive view renders, **Then** `kpi-win-rate` shows "66.7%" with the
  toggle on count; **When** the user switches the toggle to value, **Then** it shows "92.5%"; **and**
  changing `win-rate-period` re-queries `useWinRate` with the matching range. (FR-SPD-013)
- **AC-1116** — *SalesPipeline render + states.* **Given** a mocked `useSalesPipeline`, **When** it is
  pending it shows a loading state; **When** it errors it shows an error state with retry; **When** it
  returns empty (no pipeline projects) it shows an empty state; **When** it returns the seed stages it
  renders the five stage columns with per-stage count/value/weighted and a total weighted value =
  `formatCurrency(800000)`. (FR-SPD-014/015)

### Cross-stack journey — E2E (Playwright, one curated)
- **AC-1117** — *capstone journey.* **Given** a signed-in Executive against the seeded local stack,
  **When** they open the Executive Dashboard, **Then** the on-hand margin, pipeline weighted value and
  projected margin tiles and the win-rate tile render with non-empty values; **When** they navigate to
  Sales Pipeline, **Then** the pipeline stages render with weighted values from real data (no mock).
  (FR-SPD-012/013/014)

---

## 6. Design decisions requiring resolution

- **DD-1 (resolved → ADR-0014):** win-rate is a **companion RPC** `get_win_rate(p_from,p_to)`, not extra
  args on `get_executive_dashboard()`. Rationale: the dashboard payload is cached once per org and
  shared across the page; the win-rate is re-queried on every period-selector change, so coupling them
  would invalidate the whole dashboard cache on a period toggle and force the heavy aggregate to
  recompute. Separate RPC = independent TanStack cache key (`['win-rate', orgId, from, to]`). Keeps
  ADR-0009's no-arg invariant on the dashboard RPC intact.
- **DD-2 (resolved):** `get_sales_pipeline()` is a third RPC rather than overloading the dashboard
  payload — the pipeline board needs a per-project list (not just aggregates) and is a different screen
  with its own cache lifecycle.

---

## 7. Traceability (AC → FR → owning test layer)

| AC | FR | Owning layer | Test artifact |
|---|---|---|---|
| AC-1100 | FR-SPD-001 | pgTAP | `supabase/tests/0034_dashboard_on_hand_margin.test.sql` |
| AC-1101 | FR-SPD-002 | pgTAP | `supabase/tests/0035_dashboard_pipeline_weighted.test.sql` |
| AC-1102 | FR-SPD-003 | pgTAP | `supabase/tests/0036_dashboard_pipeline_projected.test.sql` |
| AC-1103 | FR-SPD-004 | pgTAP | `supabase/tests/0037_dashboard_payload_shape.test.sql` |
| AC-1104 | FR-SPD-001/003 | pgTAP | `supabase/tests/0038_dashboard_margin_guards.test.sql` |
| AC-1105 | NFR-SPD-TENANCY-001 | pgTAP | `supabase/tests/0039_dashboard_margin_tenancy.test.sql` |
| AC-1106 | FR-SPD-006/007 | pgTAP | `supabase/tests/0040_win_rate_all_time.test.sql` |
| AC-1107 | FR-SPD-006 | pgTAP | `supabase/tests/0041_win_rate_timeframe.test.sql` |
| AC-1108 | FR-SPD-008 | pgTAP | `supabase/tests/0042_win_rate_empty_guard.test.sql` |
| AC-1109 | NFR-SPD-SEC/TENANCY | pgTAP | `supabase/tests/0043_win_rate_tenancy_anon.test.sql` |
| AC-1110 | FR-SPD-010 | pgTAP | `supabase/tests/0044_sales_pipeline_stages.test.sql` |
| AC-1111 | FR-SPD-009 | Unit | `pmo-portal/src/lib/db/dashboard.test.ts` |
| AC-1112 | FR-SPD-009 | Unit | `pmo-portal/src/lib/db/dashboard.test.ts` |
| AC-1113 | FR-SPD-009 | Unit | `pmo-portal/src/lib/db/dashboard.test.ts` |
| AC-1114 | FR-SPD-012 | Unit | `pmo-portal/pages/ExecutiveDashboard.test.tsx` |
| AC-1115 | FR-SPD-013 | Unit | `pmo-portal/pages/ExecutiveDashboard.test.tsx` |
| AC-1116 | FR-SPD-014/015 | Unit | `pmo-portal/pages/SalesPipeline.test.tsx` |
| AC-1117 | FR-SPD-012/013/014 | E2E | `pmo-portal/e2e/AC-1117-sales-pipeline-dashboard.spec.ts` |

---

## 8. Seed gap (RISK-SPD-1 → seed task SPD-S1)

As originally seeded, both pipeline projects had Active budget == contract_value
(P002 1,200,000==1,200,000; P010 800,000==800,000), so `pipeline_projected_margin` was trivially 0 — a
degenerate, non-verifiable oracle. **Seed task SPD-S1** reduces the pipeline budgets so the projected
margin is non-trivial and the pgTAP oracle (AC-1102) is meaningful:
- P002 ERP Rollout Active budget → 1,000,000 (Labor 700,000 + Materials 300,000).
- P010 Regional Services Active budget → 600,000 (Labor 250,000 + Subcontractors 350,000).
A later change (**PR #27**) added a third pipeline deal, **P011 Highfield Bridge Survey** (Tender
Submitted, contract 950,000, Active budget 950,000), as an isolated row for the AC-SP e2e drilldown.
With all three pipeline deals this yields `pipeline_projected_margin = 400,000/2,950,000 ≈ 0.135593`
and `pipeline_total_value = 2,950,000` (§3.8); P011's budget==contract adds 0 to the numerator but
raises the denominator. The change is seed-only (dev fixtures), does not touch any on-hand/won project,
and keeps every project with exactly one Active budget version (AC-733 invariant). On-hand margin and
the win-rates are unchanged by P011 (it is undecided — no `decided_at`).

---

## 9. Risks & owner flags

- **RISK-SPD-1** — seed projected-margin degeneracy (above). Mitigated by seed task SPD-S1. **Not an
  owner decision** — pure fixture tuning; flagged for visibility only.
- **RISK-SPD-2** — `database.types.ts` lacks `Functions` entries for the three RPCs until the local
  stack is regenerated (same posture as ADR-0009 R3). DAL types the payloads locally; the single
  `data as unknown as <T>` cast is the only escape hatch.
- **OWNER-FLAG-1** — the win-rate period-selector option set (All time / YTD / Last quarter / Trailing
  12 months) is a **UI affordance choice within** OD-SP-3's "user-selectable period" mandate; a custom
  date-range picker is deferred. If the owner wants a custom range in MVP, flag at sign-off — the RPC
  already accepts arbitrary `p_from`/`p_to` so it is a UI-only addition (no schema/RPC change).
- **No new business rules invented** — every formula and membership set traces to a locked OD item.
