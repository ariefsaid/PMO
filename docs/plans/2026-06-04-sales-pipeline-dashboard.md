# Plan: Sales-pipeline + Dashboard margin re-formula (issue #5, capstone)

**Spec:** `docs/specs/sales-pipeline-dashboard.spec.md` (FR-SPD-001..015, AC-1100..AC-1117).
**ADR:** ADR-0014 (new — dashboard margin re-formula + companion win-rate / sales-pipeline RPC contract).
**Split recommendation:** ship as **two independently-shippable phase-groups, 5a then 5b**, on one
branch/PR is acceptable, but they MAY be split into two PRs. **5a** = dashboard margin RPC re-formula +
win-rate RPC + dashboard UI (Phases A1–A2, B1, C1, D1, E1, plus the gate). **5b** = SalesPipeline RPC +
screen rebuild (Phases A3, B2, C2, D2, E2). 5a is the higher-value, lower-risk slice (replaces the
mislabeled metric the owner explicitly flagged); 5b depends only on `get_sales_pipeline` + the DAL/hook,
which 5a's DAL file already touches. Build 5a fully (red→green→gate) before starting 5b.

**TDD discipline:** every behavior task writes the failing test FIRST (RED), then the implementation
(GREEN). pgTAP tests run via `supabase test db`; unit via `npm test`; e2e via `npx playwright test`
(all from `pmo-portal/` unless noted). Plan writes ONLY under `docs/`; the task bodies below are the
exact artifacts the implementer creates.

**Migration:** all SQL goes in a single new forward-only migration `supabase/migrations/0009_dashboard_margin_reformula.sql`
(reversibility = `supabase db reset`, ADR-0006). pgTAP files start at `0034` (highest existing is `0033`).

---

## Phase 0 — ADR

### Task 0.1 — Write ADR-0014
**File:** `docs/adr/0014-dashboard-margin-reformula-and-companion-rpcs.md` (new).
**Content:** Context = OBS-SPD-002 mislabeled `avg_gross_margin`; OD-MARGIN-1 dual lens; OD-SP-3 dual
win-rate + time filter. Decision = (a) replace `avg_gross_margin` with the five OD-MARGIN-1 fields
inside `get_executive_dashboard()` keeping ADR-0009's `security invoker` + no-`org_id` invariant;
(b) win-rate is a **companion** `get_win_rate(p_from,p_to)` RPC (DD-1: independent TanStack cache key
`['win-rate',orgId,from,to]` so a period toggle does not invalidate the heavy dashboard cache);
(c) `get_sales_pipeline()` is a third RPC (DD-2: needs a per-project list, different screen lifecycle).
All three `security invoker`, no `org_id` arg, granted `authenticated`, anon revoked — same audit
posture as ADR-0009. Consequences: removed payload key is a breaking DAL/type change (handled in one
PR); `database.types.ts` Functions entries deferred (R3 posture); margin math is value-weighted
portfolio ratios with div-by-zero guards.
**Verify:** `test -f docs/adr/0014-dashboard-margin-reformula-and-companion-rpcs.md && grep -q 'security invoker' docs/adr/0014-dashboard-margin-reformula-and-companion-rpcs.md`

---

# PART 5a — Dashboard margin re-formula + win-rate

## Phase A1 — Margin re-formula in get_executive_dashboard (SQL)

### Task A1.1 (RED) — pgTAP: on-hand margin oracle
**File:** `supabase/tests/0034_dashboard_on_hand_margin.test.sql` (new).
**Content:** `begin; select plan(2);` Set role `authenticated` with the seed Executive JWT
(`sub` = `00000000-0000-0000-0000-0000000000a1`). Call `get_executive_dashboard()` once into a CTE/temp
via `select (get_executive_dashboard() ->> 'on_hand_margin')::numeric`. Two assertions, leading token
`AC-1100`:
- `select ok( abs( (get_executive_dashboard() ->> 'on_hand_margin')::numeric - 0.949375 ) < 1e-6, 'AC-1100: on-hand weighted margin = 0.949375 over seed on-hand projects (FR-SPD-001)');`
- `select is( (get_executive_dashboard() ->> 'on_hand_value')::numeric, 8000000, 'AC-1100: on_hand_value = 8000000');`
`reset role; select * from finish(); rollback;`
**Verify:** `supabase test db 2>&1 | grep -E '0034|AC-1100'` shows the new test FAILING (function lacks the key).

### Task A1.2 (GREEN) — migration: replace avg_gross_margin with the dual-lens fields
**File:** `supabase/migrations/0009_dashboard_margin_reformula.sql` (new).
**Content:** `create or replace function get_executive_dashboard()` — copy the body of
`0003_dashboard_views.sql` verbatim, keep `language sql stable security invoker`, then:
- Add CTEs:
  ```sql
  with active as (select * from projects where status = 'Ongoing Project'),
  on_hand as (
    select p.id, p.contract_value,
           coalesce((select sum(pr.total_value) from procurements pr
                     where pr.project_id = p.id
                       and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')), 0) as spent
    from projects p
    where p.status in ('Won, Pending KoM','Ongoing Project','On Hold','Close Out')
  ),
  pipeline as (
    select p.id, p.contract_value, p.status,
           coalesce((select sum(li.budgeted_amount)
                     from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                     where v.project_id = p.id and v.status = 'Active'), 0) as active_budget,
           coalesce((select c.win_probability from pipeline_stage_config c where c.status = p.status), 0) as win_prob
    from projects p
    where p.status in ('Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation')
  )
  ```
- In `json_build_object`, REMOVE the `avg_gross_margin` key/comment block; ADD:
  ```sql
  'on_hand_value', coalesce((select sum(contract_value) from on_hand), 0),
  'on_hand_margin', coalesce((select case when sum(contract_value) > 0
                       then sum(contract_value - spent) / sum(contract_value) else 0 end from on_hand), 0),
  'pipeline_total_value', coalesce((select sum(contract_value) from pipeline), 0),
  'pipeline_weighted_value', coalesce((select sum(contract_value * win_prob) from pipeline), 0),
  'pipeline_projected_margin', coalesce((select case when sum(contract_value) > 0
                       then sum(contract_value - active_budget) / sum(contract_value) else 0 end from pipeline), 0),
  ```
  Keep `active_projects`, `total_contract_value`, `projects_at_risk`, `projects_by_status`,
  `procurements_by_status`, `top_projects` unchanged. Carry the ADR-0009 inline security guard comment
  forbidding a `security definer` switch. Re-issue `revoke all … from public; grant execute … to
  authenticated; revoke execute … from anon;`.
**Verify:** `supabase test db 2>&1 | grep 'AC-1100'` now PASSES (2/2).
**(AC-1100, FR-SPD-001)**

### Task A1.3 (RED) — pgTAP: pipeline weighted value
**File:** `supabase/tests/0035_dashboard_pipeline_weighted.test.sql` (new).
**Content:** `plan(1)`, seed Executive JWT. Leading token `AC-1101`:
`select is( (get_executive_dashboard() ->> 'pipeline_weighted_value')::numeric, 800000, 'AC-1101: Σ(contract_value × win_prob) = 1.2M×0.5 + 0.8M×0.25 = 800000 (FR-SPD-002)');`
**Verify:** `supabase test db 2>&1 | grep 'AC-1101'` PASSES (already green from A1.2 since the field
exists; this test locks the OD-SP-2-config weighting).
**(AC-1101, FR-SPD-002)**

### Task A1.4 (RED→GREEN) — seed task SPD-S1 + pgTAP: pipeline projected margin
**File (seed):** `supabase/seed.sql` (edit the P002 and P010 budget_line_items, §8 of spec).
**Content (seed):** Change the two pipeline-project budget line-items so Active budget < contract_value:
- P002 (version `50000000-…0003`): `Labor 'ERP implementation team' 800000 → 700000`,
  `Materials 'Software licenses & infrastructure' 400000 → 300000` (Active Σ = 1,000,000).
- P010 (version `50000000-…0005`): `Labor 'Program management' 350000 → 250000`,
  `Subcontractors 'Field delivery partners' 450000 → 350000` (Active Σ = 600,000).
**File (test):** `supabase/tests/0036_dashboard_pipeline_projected.test.sql` (new).
**Content (test):** `plan(2)`, seed Executive JWT. Leading token `AC-1102`:
- `select ok( abs((get_executive_dashboard() ->> 'pipeline_projected_margin')::numeric - 0.200) < 1e-6, 'AC-1102: projected margin = (200000+200000)/2000000 = 0.200 (FR-SPD-003)');`
- `select is( (get_executive_dashboard() ->> 'pipeline_total_value')::numeric, 2000000, 'AC-1102: pipeline_total_value = 2000000');`
**Verify:** `supabase db reset >/dev/null 2>&1; supabase test db 2>&1 | grep -E 'AC-1101|AC-1102'`
PASSES. Confirm SPD-S1 did NOT change `pipeline_weighted_value` (AC-1101 still 800000) — budget does
not enter the weighting.
**(AC-1102, FR-SPD-003; seed task SPD-S1)**

### Task A1.5 (RED→GREEN) — pgTAP: payload shape (key removed + added)
**File:** `supabase/tests/0037_dashboard_payload_shape.test.sql` (new).
**Content:** `plan(6)`, seed Executive JWT. Leading token `AC-1103`:
- `select ok( not (get_executive_dashboard() ? 'avg_gross_margin'), 'AC-1103: avg_gross_margin removed (FR-SPD-004)');`
- five `select ok( get_executive_dashboard() ? '<key>', …)` for `on_hand_margin`, `on_hand_value`,
  `pipeline_weighted_value`, `pipeline_projected_margin`, `pipeline_total_value`.
**Verify:** `supabase test db 2>&1 | grep 'AC-1103'` PASSES (green after A1.2; this guards the contract).
**(AC-1103, FR-SPD-004)**

### Task A1.6 (RED) — pgTAP: margin div-by-zero guards (empty org)
**File:** `supabase/tests/0038_dashboard_margin_guards.test.sql` (new).
**Content:** `plan(3)`. Insert a fresh org `00380000-…0001` + a profile/user with `Executive` role but
**no projects**; set that user's JWT. Leading token `AC-1104`:
- `on_hand_margin` = 0, `pipeline_projected_margin` = 0, `pipeline_weighted_value` = 0 (each
  `select is(… ,0,…)`), and `lives_ok` wrapping the call (no division error). `rollback`.
**Verify:** `supabase test db 2>&1 | grep 'AC-1104'` PASSES (the `case when sum>0` guards from A1.2).
**(AC-1104, FR-SPD-001/003)**

### Task A1.7 (RED) — pgTAP: margin tenancy isolation
**File:** `supabase/tests/0039_dashboard_margin_tenancy.test.sql` (new).
**Content:** `plan(2)`. Insert org B `00390000-…0001` with one `Ongoing Project` of contract_value
99,000,000 + its Active budget, and a default-org Executive JWT. Leading token `AC-1105`:
- `select is( (get_executive_dashboard() ->> 'on_hand_value')::numeric, 8000000, 'AC-1105: on_hand_value excludes org B (NFR-SPD-TENANCY-001)');`
- `select ok( (get_executive_dashboard() ->> 'on_hand_margin')::numeric > 0.9, 'AC-1105: margin reflects default org only, not org B');`
**Verify:** `supabase test db 2>&1 | grep 'AC-1105'` PASSES (security-invoker RLS scoping; no code change
needed — this test PROVES the invariant survives the re-formula).
**(AC-1105, NFR-SPD-TENANCY-001)**

## Phase A2 — Win-rate RPC (SQL)

### Task A2.1 (RED) — pgTAP: all-time dual win-rate
**File:** `supabase/tests/0040_win_rate_all_time.test.sql` (new).
**Content:** `plan(2)`, seed Executive JWT. Leading token `AC-1106`:
- `select ok( abs((get_win_rate(null,null) ->> 'win_rate_count')::numeric - 0.666667) < 1e-6, 'AC-1106: count win-rate 2/3 (FR-SPD-006/007)');`
- `select ok( abs((get_win_rate(null,null) ->> 'win_rate_value')::numeric - 0.924855) < 1e-6, 'AC-1106: value win-rate 8M/8.65M');`
**Verify:** `supabase test db 2>&1 | grep 'AC-1106'` shows FAILING (function does not exist yet).

### Task A2.2 (GREEN) — migration: get_win_rate
**File:** `supabase/migrations/0009_dashboard_margin_reformula.sql` (append).
**Content:**
```sql
create or replace function get_win_rate(p_from date default null, p_to date default null)
  returns json language sql stable security invoker as $$
  with decided as (
    select status, contract_value from projects
    where decided_at is not null
      and (p_from is null or decided_at >= p_from)
      and (p_to   is null or decided_at <= (p_to + 1)::timestamptz)  -- inclusive end-of-day (spec §3.7)
  ),
  agg as (
    select
      count(*) filter (where status in ('Won, Pending KoM','Ongoing Project','On Hold','Close Out')) as wins_count,
      count(*) filter (where status = 'Loss Tender') as losses_count,
      coalesce(sum(contract_value) filter (where status in ('Won, Pending KoM','Ongoing Project','On Hold','Close Out')),0) as wins_value,
      coalesce(sum(contract_value) filter (where status = 'Loss Tender'),0) as losses_value
    from decided
  )
  select json_build_object(
    'wins_count', wins_count, 'losses_count', losses_count,
    'wins_value', wins_value, 'losses_value', losses_value,
    'win_rate_count', case when wins_count+losses_count > 0
        then wins_count::numeric/(wins_count+losses_count) else 0 end,
    'win_rate_value', case when wins_value+losses_value > 0
        then wins_value/(wins_value+losses_value) else 0 end
  ) from agg;
$$;
revoke all on function get_win_rate(date, date) from public;
grant execute on function get_win_rate(date, date) to authenticated;
revoke execute on function get_win_rate(date, date) from anon;
```
Note: the pgTAP `[p_from,p_to]` inclusive-on-`p_to`-date semantics here add 1 day and use `<` —
re-express as `decided_at < (p_to + 1)` so a `decided_at` anywhere on `p_to`'s day counts; this matches
the DAL passing the plain date (FR-SPD-009) and the §3.7 inclusive intent. (Seed `decided_at` are
midnights so `<= p_to::timestamptz` would also pass; the `+1` form is robust to intraday timestamps.)
**Verify:** `supabase test db 2>&1 | grep 'AC-1106'` PASSES.
**(AC-1106, FR-SPD-006/007)**

### Task A2.3 (RED→GREEN) — pgTAP: time-frame filter
**File:** `supabase/tests/0041_win_rate_timeframe.test.sql` (new).
**Content:** `plan(4)`, seed Executive JWT. Leading token `AC-1107`:
- Jan range: `get_win_rate('2026-01-01','2026-01-31')` → `win_rate_count = 1.0`, `win_rate_value = 1.0`.
- Feb range: `get_win_rate('2026-02-01','2026-02-28')` → `win_rate_count = 0.5`,
  `abs(win_rate_value − 0.821918) < 1e-6`.
**Verify:** `supabase test db 2>&1 | grep 'AC-1107'` PASSES.
**(AC-1107, FR-SPD-006)**

### Task A2.4 (RED→GREEN) — pgTAP: empty-range guard
**File:** `supabase/tests/0042_win_rate_empty_guard.test.sql` (new).
**Content:** `plan(2)`, seed Executive JWT. Leading token `AC-1108`:
`get_win_rate('2030-01-01','2030-12-31')` → `win_rate_count = 0` and `win_rate_value = 0`, wrapped so
no division error (`lives_ok` on the call).
**Verify:** `supabase test db 2>&1 | grep 'AC-1108'` PASSES.
**(AC-1108, FR-SPD-008)**

### Task A2.5 (RED→GREEN) — pgTAP: win-rate tenancy + anon revoke
**File:** `supabase/tests/0043_win_rate_tenancy_anon.test.sql` (new).
**Content:** `plan(2)`. Leading token `AC-1109`:
- Reuse/insert an org B win project; default-org Executive JWT → `wins_value` excludes org B
  (`select is((get_win_rate(null,null)->>'wins_value')::numeric, 8000000, …)`).
- `select ok( not has_function_privilege('anon','get_win_rate(date,date)','execute'), 'AC-1109: anon has no EXECUTE on get_win_rate (NFR-SPD-SEC-001)');`
**Verify:** `supabase test db 2>&1 | grep 'AC-1109'` PASSES.
**(AC-1109, NFR-SPD-SEC-001/TENANCY-001)**

## Phase B1 — DAL (extended dashboard + win-rate)

### Task B1.1 (RED) — extend dashboard.test.ts for the new payload + win-rate marshaling
**File:** `pmo-portal/src/lib/db/dashboard.test.ts` (edit).
**Content:** Update the existing payload object: replace `avg_gross_margin: 0.30162` with
`on_hand_margin: 0.949375, on_hand_value: 8000000, pipeline_weighted_value: 800000,
pipeline_projected_margin: 0.200, pipeline_total_value: 2000000`. Add three `it(...)`:
- `it('AC-1111: getExecutiveDashboard returns the extended dual-lens payload; throws on error (FR-SPD-009)', …)` — assert `result.on_hand_margin === 0.949375` and `result.pipeline_weighted_value === 800000`; error case throws.
- `it('AC-1112: getWinRate marshals a Date range to p_from/p_to and null when omitted (FR-SPD-009)', …)` —
  mock `rpc('get_win_rate', …)`; assert call `rpc('get_win_rate', { p_from: '2026-02-01', p_to: '2026-02-28' })`
  for the range call and `{ p_from: null, p_to: null }` for the no-arg call; error throws. (The DAL
  formats `Date` → `YYYY-MM-DD` via `toISOString().slice(0,10)`.)
- `it('AC-1113: getSalesPipeline returns typed stages + projects; throws on error (FR-SPD-009)', …)`.
**Verify:** `npm test -- dashboard.test.ts 2>&1 | grep -E 'AC-1111|AC-1112|AC-1113'` shows FAILING.

### Task B1.2 (GREEN) — extend dashboard.ts
**File:** `pmo-portal/src/lib/db/dashboard.ts` (edit).
**Content:** In `ExecutiveDashboard` interface remove `avg_gross_margin`; add
`on_hand_margin: number; on_hand_value: number; pipeline_weighted_value: number;
pipeline_projected_margin: number; pipeline_total_value: number;`. Add:
```ts
export interface WinRate {
  wins_count: number; losses_count: number; wins_value: number; losses_value: number;
  win_rate_count: number; win_rate_value: number;
}
export async function getWinRate(from?: Date, to?: Date): Promise<WinRate> {
  const p_from = from ? from.toISOString().slice(0, 10) : null;
  const p_to   = to   ? to.toISOString().slice(0, 10)   : null;
  const { data, error } = await supabase.rpc('get_win_rate', { p_from, p_to });
  if (error) throw new Error(error.message);
  return data as unknown as WinRate;
}
export interface PipelineStage {
  status: ProjectStatus; count: number; total_value: number;
  win_probability: number; weighted_value: number;
}
export interface PipelineProject {
  id: string; name: string; client_name: string | null;
  status: ProjectStatus; contract_value: number; win_probability: number;
}
export interface SalesPipeline { stages: PipelineStage[]; projects: PipelineProject[]; }
export async function getSalesPipeline(): Promise<SalesPipeline> {
  const { data, error } = await supabase.rpc('get_sales_pipeline');
  if (error) throw new Error(error.message);
  return data as unknown as SalesPipeline;
}
```
**Verify:** `npm test -- dashboard.test.ts 2>&1 | grep -E 'AC-1111|AC-1112|AC-1113'` PASSES; `npm run typecheck` zero errors.
**(AC-1111/1112/1113, FR-SPD-009)**

## Phase C1 — Hooks

### Task C1.1 (GREEN, no behavior test — thin wrapper covered by page tests) — add useWinRate / useSalesPipeline
**File:** `pmo-portal/src/hooks/useDashboard.ts` (edit).
**Content:** Keep `useDashboard()`. Add:
```ts
import { getWinRate, type WinRate, getSalesPipeline, type SalesPipeline } from '@/src/lib/db/dashboard';

export interface WinRateRange { from?: Date; to?: Date; key: string; }
export function useWinRate(range: WinRateRange) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<WinRate>({
    queryKey: ['win-rate', orgId, range.key],
    queryFn: () => getWinRate(range.from, range.to),
    enabled: Boolean(orgId),
  });
}
export function useSalesPipeline() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesPipeline>({
    queryKey: ['sales-pipeline', orgId],
    queryFn: () => getSalesPipeline(),
    enabled: Boolean(orgId),
  });
}
```
**Verify:** `npm run typecheck` zero errors. (Behavior asserted via page tests AC-1115/1116.)
**(FR-SPD-011)**

## Phase D1 — Exec Dashboard UI

### Task D1.1 (RED) — page test for new tiles + win-rate toggle/period
**File:** `pmo-portal/pages/ExecutiveDashboard.test.tsx` (new or edit if present).
**Content:** Mock `@/src/hooks/useDashboard` exporting `useDashboard` (oracle payload),
`useWinRate` (returns the §3.8 all-time oracle: `win_rate_count: 0.666667, win_rate_value: 0.924855`),
`useSalesPipeline`. Mock `useEffectiveRole` → `{ effectiveRole: 'Executive' }`. Two `it(...)`:
- `it('AC-1114: renders on-hand margin / pipeline weighted value / projected margin tiles, no avg_gross_margin (FR-SPD-012)', …)` —
  assert `getByTestId('kpi-on-hand-margin')` text contains `94.9%`,
  `kpi-pipeline-weighted-value` contains `formatCurrency(800000)`,
  `kpi-pipeline-projected-margin` contains `20.0%`, and `queryByTestId('kpi-avg-gross-margin')` is null.
- `it('AC-1115: win-rate tile toggles count↔value and period re-queries (FR-SPD-013)', …)` —
  assert `kpi-win-rate` shows `66.7%`; click the `value` option in `win-rate-toggle`; assert `92.5%`;
  change `win-rate-period` to "Last quarter" and assert `useWinRate` was called with a range whose
  `key` differs from the default.
**Verify:** `npm test -- ExecutiveDashboard.test.tsx 2>&1 | grep -E 'AC-1114|AC-1115'` shows FAILING.

### Task D1.2 (GREEN) — rebuild the executive KPI row + win-rate control
**File:** `pmo-portal/pages/ExecutiveDashboard.tsx` (edit `renderExecutiveView` + add a win-rate
subcomponent).
**Content:**
- Replace the `kpi-avg-gross-margin` `KpiCard` with `kpi-on-hand-margin`
  (`value={`${(data.on_hand_margin*100).toFixed(1)}%`}` description "On-hand actual margin (weighted)").
- Add `kpi-pipeline-weighted-value` (`formatCurrency(data.pipeline_weighted_value)`, desc "Pipeline
  weighted value") and `kpi-pipeline-projected-margin`
  (`${(data.pipeline_projected_margin*100).toFixed(1)}%`, desc "Pipeline projected margin"). Widen the
  KPI grid to fit (e.g. `lg:grid-cols-3` for the new margin row, keep the existing
  active/contract/at-risk row).
- Add a `WinRateCard` using local state `mode: 'count'|'value'` (default `'count'`) + `period` state
  mapping to a `WinRateRange` (`All time`→`{key:'all'}`; `YTD`→`{from: new Date(year,0,1), key:'ytd'}`;
  `Last quarter`→ trailing-3-month range, key `'q'`; `Trailing 12 months`→ from = now − 365d,
  key `'t12'`). Render `data-testid="kpi-win-rate"` value `${(rate*100).toFixed(1)}%` where `rate` =
  mode==='count' ? `wr.win_rate_count` : `wr.win_rate_value`; a `<select data-testid="win-rate-period">`
  and a toggle `data-testid="win-rate-toggle"` (two buttons or a segmented control with `count`/`value`
  options). Source `wr` from `useWinRate(range)`.
**Verify:** `npm test -- ExecutiveDashboard.test.tsx 2>&1 | grep -E 'AC-1114|AC-1115'` PASSES;
`npm run typecheck` + `npm run lint` zero errors.
**(AC-1114/1115, FR-SPD-012/013)**

---

# PART 5b — SalesPipeline RPC + screen

## Phase A3 — get_sales_pipeline (SQL)

### Task A3.1 (RED) — pgTAP: pipeline stages weighted
**File:** `supabase/tests/0044_sales_pipeline_stages.test.sql` (new).
**Content:** `plan(6)`, seed Executive JWT. Parse `get_sales_pipeline() -> 'stages'`. Leading token
`AC-1110`: assert a `Tender Submitted` stage object has `count=1, total_value=1200000,
win_probability=0.500, weighted_value=600000`, and a `PQ Submitted` stage has `count=1,
total_value=800000, win_probability=0.250, weighted_value=200000`. Use a lateral
`json_array_elements` filter on `->>'status'`. Also assert no `Ongoing Project`/`Loss Tender` stage
present.
**Verify:** `supabase test db 2>&1 | grep 'AC-1110'` shows FAILING (function missing).

### Task A3.2 (GREEN) — migration: get_sales_pipeline
**File:** `supabase/migrations/0009_dashboard_margin_reformula.sql` (append).
**Content:**
```sql
create or replace function get_sales_pipeline()
  returns json language sql stable security invoker as $$
  with pl as (
    select p.id, p.name, p.client_id, p.status, p.contract_value,
           coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status in ('Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation')
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(json_build_object(
        'status', status, 'count', cnt, 'total_value', total_value,
        'win_probability', win_prob, 'weighted_value', total_value * win_prob) order by status)
      from (
        select status, count(*) cnt, sum(contract_value) total_value, max(win_prob) win_prob
        from pl group by status) s), '[]'::json),
    'projects', coalesce((
      select json_agg(json_build_object(
        'id', pl.id, 'name', pl.name, 'client_name', co.name,
        'status', pl.status, 'contract_value', pl.contract_value, 'win_probability', pl.win_prob)
        order by pl.contract_value desc)
      from pl left join companies co on co.id = pl.client_id), '[]'::json)
  );
$$;
revoke all on function get_sales_pipeline() from public;
grant execute on function get_sales_pipeline() to authenticated;
revoke execute on function get_sales_pipeline() from anon;
```
**Verify:** `supabase test db 2>&1 | grep 'AC-1110'` PASSES.
**(AC-1110, FR-SPD-010)**

## Phase C2/D2 — SalesPipeline screen

### Task D2.1 (RED) — page test: render + states + weighted total
**File:** `pmo-portal/pages/SalesPipeline.test.tsx` (new).
**Content:** Mock `@/src/hooks/useDashboard` `useSalesPipeline`. One `it('AC-1116: …', …)` exercising
four mocked states (pending → loading testid; isError → error testid + retry button; empty stages →
empty testid; populated → five stage columns with per-stage count/value/weighted and a total weighted
value text = `formatCurrency(800000)`). Use the seed stages oracle (Tender 600000 + PQ 200000 = 800000;
other three stages count 0). Leading token `AC-1116`.
**Verify:** `npm test -- SalesPipeline.test.tsx 2>&1 | grep 'AC-1116'` shows FAILING.

### Task D2.2 (GREEN) — rebuild SalesPipeline.tsx on real data
**File:** `pmo-portal/pages/SalesPipeline.tsx` (overwrite).
**Content:** Remove all `data/mockData` + hard-coded probability imports. Use
`const { data, isPending, isError, refetch } = useSalesPipeline();`. Render:
- loading (`data-testid="pipeline-loading"`), error (`data-testid="pipeline-error"` + retry button
  calling `refetch()`), empty when `data.projects.length === 0` (`data-testid="pipeline-empty"`).
- A KPI showing total weighted value = `formatCurrency(data.stages.reduce((s,st)=>s+st.weighted_value,0))`
  (`data-testid="pipeline-weighted-total"`).
- For each of the five OD-SP-1 pipeline stages (fixed display order Leads→Negotiation), a column
  (`data-testid={`stage-${status}`}`) showing the stage's count, `formatCurrency(total_value)`,
  `(win_probability*100)`% and `formatCurrency(weighted_value)`; if a stage has no row, render it empty
  (count 0). Reuse `Card` and `formatCurrency` from `@/src/lib/format`. May reuse
  `components/SalesKanbanBoard.tsx` only if it can be fed real `PipelineProject[]` without mockData;
  otherwise render a simple stage-grouped list (do NOT reintroduce mock types).
**Verify:** `npm test -- SalesPipeline.test.tsx 2>&1 | grep 'AC-1116'` PASSES; `npm run typecheck` +
`npm run lint` zero errors.
**(AC-1116, FR-SPD-014/015)**

---

# Phase E — E2E (one curated journey)

### Task E.1 (RED→GREEN) — Playwright capstone journey
**File:** `pmo-portal/e2e/AC-1117-sales-pipeline-dashboard.spec.ts` (new).
**Content:** `test('AC-1117: dashboard shows dual-lens KPIs and Sales Pipeline renders weighted stages from real data (FR-SPD-012/013/014)', …)`.
Sign in as the seed Executive (`exec@acme.test` / `Passw0rd!dev`, per `seed.sql` NOTE). On the Executive
Dashboard assert `kpi-on-hand-margin`, `kpi-pipeline-weighted-value`, `kpi-pipeline-projected-margin`,
`kpi-win-rate` are visible with non-empty values (e.g. on-hand contains `%`, weighted value contains a
currency `$`). Navigate to Sales Pipeline (sidebar link); assert `pipeline-weighted-total` is visible
and at least the `stage-Tender Submitted` column renders with a non-zero weighted value. Keep the
journey to the two screens only (test-pyramid ADR-0010: curated cross-stack, not re-proving math).
**Verify (from `pmo-portal/`):** `npx playwright test AC-1117 2>&1 | tail -5` PASSES.
**(AC-1117, FR-SPD-012/013/014)**

---

# Phase G — Gate (whole issue, before PR)

### Task G.1 — full quality gate
**Verify (from `pmo-portal/`):**
- `npm run typecheck` → zero errors.
- `npm run lint` → zero errors (CI `--max-warnings=0`).
- `npm test` → all unit/RTL green, ≥80% lines on changed files (`dashboard.ts`, `useDashboard.ts`,
  `ExecutiveDashboard.tsx`, `SalesPipeline.tsx`).
- `supabase test db` → all pgTAP green incl. `AC-1100..AC-1110`.
- `npx playwright test AC-1117` → green.
- `grep -rn 'avg_gross_margin' pmo-portal/ supabase/migrations/0009_dashboard_margin_reformula.sql`
  → no references in the new migration / live UI / DAL (only allowed in `0003_dashboard_views.sql`
  history and the spec/ADR prose).
- `grep -rc 'AC-11' supabase/tests pmo-portal` → every AC-1100..AC-1117 owning artifact present.

---

## Task count & phase summary

| Phase | Tasks | Slice | AC covered |
|---|---|---|---|
| 0 | 0.1 | shared | (ADR-0014) |
| A1 | A1.1–A1.7 (7) | 5a | AC-1100,1101,1102,1103,1104,1105 |
| A2 | A2.1–A2.5 (5) | 5a | AC-1106,1107,1108,1109 |
| B1 | B1.1–B1.2 (2) | 5a | AC-1111,1112,1113 |
| C1 | C1.1 (1) | 5a | FR-SPD-011 (covered via D1) |
| D1 | D1.1–D1.2 (2) | 5a | AC-1114,1115 |
| A3 | A3.1–A3.2 (2) | 5b | AC-1110 |
| C2/D2 | D2.1–D2.2 (2) | 5b | AC-1116 |
| E | E.1 (1) | both | AC-1117 |
| G | G.1 (1) | both | gate |

**Total: 24 tasks** (18 for 5a incl. ADR + gate-shared; 5 for 5b; E + G shared). pgTAP files
`0034..0044` (11 new); migration `0009`; one seed edit (SPD-S1); one new e2e.
