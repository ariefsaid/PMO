# Plan: Executive Dashboard on real Supabase data — READ path (Issue #7)

- **Spec:** `docs/specs/dashboard.spec.md`
- **Decision:** KPI source = **(a) Postgres RPC `get_executive_dashboard()`** (`security invoker`, no
  args, returns `json`), consumed via `src/lib/db/dashboard.ts` + `src/hooks/useDashboard.ts`. Rationale
  + RLS shape in the spec. New ADR `docs/adr/0009-dashboard-rpc-aggregation.md` (architectural: SQL
  aggregation contract + invoker security model).
- **Mirror of:** Issue #5/#6 DAL+hook+page pattern. Query infra (`QueryClient` in `App.tsx`,
  `formatCurrency`, `e2e/helpers.ts` `login`) already exist — do NOT re-add.
- **Working dir for all commands:** `pmo-portal/` (`cd pmo-portal` first), except Task 0 (seed) +
  Task 1 (migration) which are `supabase/`.
- **Alias:** `@` → repo `pmo-portal/`. `@/src/...` = `pmo-portal/src/...`.
- **TDD:** every behavior task writes the failing test first, then minimum code to green it.
- **Constraint:** READ path only. No writes. Drop KPI delta arrows + YTD line chart (OD-D2); add
  procurement-by-status chart (OD-D4). Non-Exec sub-dashboards keep mockData for their own numbers but
  drop `mockUserForRole` (OD-D3).
- **Snake_case reality:** RPC payload keys are snake_case (`active_projects`, `projects_by_status`,
  `client_name`, …). The DAL types them in an `ExecutiveDashboard` interface; the page consumes that
  interface directly — NO `as unknown as <prototype Kpi/Project>` cast (Issue #5 lesson).

## Conventions used by every task
- Client: `import { supabase } from '@/src/lib/supabase/client'`.
- Tests co-locate next to source (`*.test.ts(x)`). Single file: `npm test -- <path>`. Types:
  `npm run typecheck`. Lint: `npm run lint`.

---

## Task 0 — Enrich `supabase/seed.sql`: add a 2nd Ongoing project (at-risk case)  *(AC-701, AC-702, AC-703)*
Seed has only ONE Ongoing project, so "Active Projects" = 1 and "at risk" has no case. Add a 2nd Ongoing
project whose `spent/budget = 0.95` proves the at-risk path.

**Do** — in `supabase/seed.sql`, in the `-- projects` block (current lines 85-88), append a 4th row to
the `insert into projects (...) values` list (add a comma after the P010 row, then):
```sql
  ,('40000000-0000-0000-0000-000000000004','P003','Acme Internal Platform','Ongoing Project','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',3000000,2000000,1900000,'2026-02-01','2026-11-30')
```
(Reuses Innovate Corp client + Alice PM; respects `unique(org_id, code)` — P003 is new. Result: 2 Ongoing
projects; Σ Ongoing contract_value = 8,000,000; margins 0.5532 & 0.05 ⇒ avg 0.30162 → 30.2%; at-risk = 1.)
**Verify:** `cd supabase && supabase db reset` runs clean (no unique/FK/CHECK error). `supabase db reset`
is the reversibility contract (no down-migration; pre-production, ADR-0006).

---

## Task 1 — Migration `supabase/migrations/0003_dashboard_views.sql`: `get_executive_dashboard()` RPC  *(AC-701..705, AC-709, FR-DASH-002, FR-API-003, NFR-DASH-SEC-001)*
`security invoker` (default), no args, returns `json`; base-table RLS scopes every read to the caller's
org. Grant execute to `authenticated`.

**Do** — create `supabase/migrations/0003_dashboard_views.sql`:
```sql
-- 0003_dashboard_views.sql — Executive Dashboard SQL aggregation (target-arch §8.4 / FR-API-003).
-- Replaces the prototype's in-memory KPI/chart aggregation (OBS-DASH-*). Forward-only, additive;
-- reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- SECURITY (NFR-DASH-SEC-001): this function is `security invoker` (the default — do NOT add
-- `security definer`). Invoker means every base-table read below runs under the CALLER'S RLS policies
-- (projects_select / procurements_select / companies_select = org_id = auth_org_id()), so the aggregates
-- are scoped to the caller's org automatically. It takes NO org_id argument — the org seam comes from
-- auth_org_id() inside those policies, never from the client.
-- DO NOT switch this to `security definer` without re-adding an explicit `org_id = auth_org_id()` filter
-- on every table read here; doing so would bypass RLS and leak cross-org aggregates (audit R1).
create or replace function get_executive_dashboard()
  returns json
  language sql
  stable
  security invoker
as $$
  with active as (
    select * from projects where status = 'Ongoing Project'
  )
  select json_build_object(
    'active_projects', (select count(*) from active),
    'total_contract_value', coalesce((select sum(contract_value) from active), 0),
    'avg_gross_margin', coalesce(
      (select avg((budget - spent) / budget) from active where budget > 0), 0),
    'projects_at_risk', (select count(*) from active where budget > 0 and spent / budget > 0.9),
    'projects_by_status', coalesce((
      select json_agg(json_build_object('status', status, 'count', c) order by status)
      from (select status, count(*) c from projects group by status) s), '[]'::json),
    'procurements_by_status', coalesce((
      select json_agg(json_build_object('status', status, 'count', c) order by status)
      from (select status, count(*) c from procurements group by status) s), '[]'::json),
    'top_projects', coalesce((
      select json_agg(t order by t.contract_value desc) from (
        select p.id, p.name, c.name as client_name, p.contract_value, p.budget, p.spent, p.status
        from projects p left join companies c on c.id = p.client_id
        order by p.contract_value desc limit 5
      ) t), '[]'::json)
  );
$$;

revoke all on function get_executive_dashboard() from public;
grant execute on function get_executive_dashboard() to authenticated;
```
**Verify:** `cd supabase && supabase db reset` applies 0001+0002+0003 + seed clean. Then sanity-check the
aggregate as the Executive seed user (psql against the local stack):
```
psql "$SUPABASE_DB_URL" -c "set local role authenticated; select get_executive_dashboard();"
```
Expect `active_projects = 2`, `total_contract_value = 8000000`, `projects_at_risk = 1`. (If `psql`/role
set is unavailable locally, the e2e in Task 6 is the authoritative check.)

---

## Task 2 — ADR `docs/adr/0009-dashboard-rpc-aggregation.md`  *(architectural decision record)*
**Do** — create `docs/adr/0009-dashboard-rpc-aggregation.md` with:
- **Context:** baseline aggregates KPIs/charts in render from mockData (OBS-DASH-*, F-7, F-11);
  target-arch §8.4/FR-API-003 mandate SQL-side aggregation; the Dashboard is the last `mockUserForRole`
  consumer.
- **Decision:** compute Executive KPIs + chart aggregates in a single Postgres RPC
  `get_executive_dashboard()` returning one JSON payload; `security invoker`, no `org_id` arg, granted to
  `authenticated`; consumed via a `dashboard.ts` DAL module + `useDashboard` TanStack hook keyed
  `['dashboard', orgId]`. Chosen over client-side compute (simple aggregates, one round trip, only
  aggregates cross the wire, RLS-scoped). Future role dashboards follow the same pattern as named views
  (`v_pm_dashboard`, etc., §8.4).
- **Consequences:** (+) scales to millions of rows (aggregate-only payload), kills render-time `.find()`
  joins, RLS-scoped by construction. (−) a new SQL surface needing a security-auditor pass; the invoker
  model must be preserved (definer switch without an org filter would leak — see migration comment);
  generated `database.types.ts` should gain the function entry when the local stack regenerates (R3).
**Verify:** file exists; no command.

---

## Task 3 — `src/lib/db/dashboard.ts`: typed `getExecutiveDashboard()` over the RPC  *(AC-710, FR-DAL-DASH-001)*
**Test first** — create `pmo-portal/src/lib/db/dashboard.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc } }));

import { getExecutiveDashboard } from './dashboard';

beforeEach(() => { rpc.mockReset(); });

describe('getExecutiveDashboard', () => {
  it('calls rpc("get_executive_dashboard") with no org_id arg, returns the payload (AC-710, FR-DAL-DASH-001)', async () => {
    const payload = {
      active_projects: 2, total_contract_value: 8000000, avg_gross_margin: 0.30162,
      projects_at_risk: 1,
      projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
      procurements_by_status: [{ status: 'Paid', count: 1 }],
      top_projects: [{ id: 'p1', name: 'Innovate Corp HQ Fit-Out', client_name: 'Innovate Corp',
        contract_value: 5000000, budget: 4700000, spent: 2100000, status: 'Ongoing Project' }],
    };
    rpc.mockResolvedValue({ data: payload, error: null });
    const result = await getExecutiveDashboard();
    expect(rpc).toHaveBeenCalledWith('get_executive_dashboard');
    expect(rpc.mock.calls[0].length).toBe(1); // no args object → no org_id
    expect(result.active_projects).toBe(2);
    expect(result.top_projects[0].client_name).toBe('Innovate Corp');
  });

  it('throws on RPC error (AC-710)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getExecutiveDashboard()).rejects.toThrow('boom');
  });
});
```
**Run (red):** `npm test -- src/lib/db/dashboard.test.ts` → fails (module missing).
**Then create** `pmo-portal/src/lib/db/dashboard.ts`:
```ts
import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

type ProjectStatus = Tables<'projects'>['status'];
type ProcurementStatus = Tables<'procurements'>['status'];

export interface StatusCount<S> {
  status: S;
  count: number;
}

export interface TopProject {
  id: string;
  name: string;
  client_name: string | null;
  contract_value: number;
  budget: number;
  spent: number;
  status: ProjectStatus;
}

/** Aggregates computed in SQL by get_executive_dashboard() (FR-API-003). snake_case mirrors the RPC. */
export interface ExecutiveDashboard {
  active_projects: number;
  total_contract_value: number;
  avg_gross_margin: number;
  projects_at_risk: number;
  projects_by_status: StatusCount<ProjectStatus>[];
  procurements_by_status: StatusCount<ProcurementStatus>[];
  top_projects: TopProject[];
}

/**
 * Executive dashboard aggregates for the caller's org. Calls the `get_executive_dashboard` RPC
 * (security invoker) — org_id is NEVER sent; base-table RLS scopes every read (FR-DAL-DASH-001,
 * NFR-DASH-SEC-001). On RPC error it throws.
 */
export async function getExecutiveDashboard(): Promise<ExecutiveDashboard> {
  const { data, error } = await supabase.rpc('get_executive_dashboard');
  if (error) throw new Error(error.message);
  return data as unknown as ExecutiveDashboard;
}
```
**Verify (green):** `npm test -- src/lib/db/dashboard.test.ts` passes; `npm run typecheck` clean.
> Note: `rpc('get_executive_dashboard')` may need `// @ts-expect-error` ONLY if `database.types.ts`
> lacks the function entry. Prefer regenerating types (R3) if the local stack is up; if not, the cast on
> `data` keeps the module typed without the generated entry.

---

## Task 4 — `src/hooks/useDashboard.ts`: org-scoped hook  *(AC-709, FR-QRY-DASH-001)*
**Test first** — create `pmo-portal/src/hooks/useDashboard.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/dashboard', () => ({
  getExecutiveDashboard: vi.fn().mockResolvedValue({
    active_projects: 2, total_contract_value: 8000000, avg_gross_margin: 0.30162,
    projects_at_risk: 1, projects_by_status: [], procurements_by_status: [], top_projects: [],
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

import { useDashboard } from './useDashboard';
import { getExecutiveDashboard } from '@/src/lib/db/dashboard';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useDashboard', () => {
  it("keys by ['dashboard', orgId], calls getExecutiveDashboard (AC-709, FR-QRY-DASH-001)", async () => {
    const { result } = renderHook(() => useDashboard(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.active_projects).toBe(2);
    expect(getExecutiveDashboard).toHaveBeenCalledTimes(1);
  });
});
```
**Run (red):** `npm test -- src/hooks/useDashboard.test.tsx` → fails.
**Then create** `pmo-portal/src/hooks/useDashboard.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { getExecutiveDashboard, type ExecutiveDashboard } from '@/src/lib/db/dashboard';
import { useAuth } from '@/src/auth/useAuth';

/** Org-scoped executive dashboard aggregates. queryKey includes org_id so cache is tenant-scoped
 * (FR-QRY-DASH-001). Aggregates are computed in SQL (RPC) and RLS-scoped to the caller's org. */
export function useDashboard() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ExecutiveDashboard>({
    queryKey: ['dashboard', orgId],
    queryFn: () => getExecutiveDashboard(),
    enabled: Boolean(orgId),
  });
}
```
**Verify (green):** `npm test -- src/hooks/useDashboard.test.tsx` passes; `npm run typecheck` clean.

---

## Task 5 — Swap the Executive view of `pages/ExecutiveDashboard.tsx` to real data; states; drop `mockUserForRole`  *(AC-701..708, FR-DASH-001/003..010, OD-D2, OD-D3, OD-D4)*
Largest slice. Component tests first; then rewrite the Executive view's data source + state branches +
drop `mockUserForRole`. Keep `EngineerDashboard`/`PMDashboard`/`FinanceDashboard` JSX unchanged (still
mockData per OD-D3) but stop deriving identity from `mockUserForRole`.

**Test first** — create `pmo-portal/pages/ExecutiveDashboard.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';

const populated = {
  active_projects: 2, total_contract_value: 8000000, avg_gross_margin: 0.30162, projects_at_risk: 1,
  projects_by_status: [
    { status: 'Ongoing Project', count: 2 }, { status: 'Tender Submitted', count: 1 },
    { status: 'PQ Submitted', count: 1 },
  ],
  procurements_by_status: [
    { status: 'Draft', count: 1 }, { status: 'Requested', count: 1 }, { status: 'Vendor Quoted', count: 1 },
    { status: 'Ordered', count: 1 }, { status: 'Paid', count: 1 },
  ],
  top_projects: [
    { id: 'p1', name: 'Innovate Corp HQ Fit-Out', client_name: 'Innovate Corp',
      contract_value: 5000000, budget: 4700000, spent: 2100000, status: 'Ongoing Project' },
    { id: 'p3', name: 'Acme Internal Platform', client_name: 'Innovate Corp',
      contract_value: 3000000, budget: 2000000, spent: 1900000, status: 'Ongoing Project' },
  ],
};
const dashState: any = { data: populated, isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useDashboard', () => ({ useDashboard: () => dashState }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive' }) }));

const renderPage = () => render(<MemoryRouter><ExecutiveDashboard /></MemoryRouter>);

describe('ExecutiveDashboard (real data)', () => {
  it('renders Active Projects = 2 and Total Contract Value $8,000,000 (AC-701)', () => {
    renderPage();
    expect(screen.getByTestId('kpi-active-projects')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-total-contract-value')).toHaveTextContent('$8,000,000');
  });
  it('renders Avg Gross Margin 30.2% and Projects at Risk 1 (AC-702)', () => {
    renderPage();
    expect(screen.getByTestId('kpi-avg-gross-margin')).toHaveTextContent('30.2%');
    expect(screen.getByTestId('kpi-projects-at-risk')).toHaveTextContent('1');
  });
  it('pipeline region shows the Ongoing count 2 (AC-703)', () => {
    renderPage();
    expect(screen.getByTestId('dashboard-pipeline')).toHaveTextContent('2');
  });
  it('procurement-by-status region shows 5 statuses (AC-704)', () => {
    renderPage();
    expect(screen.getByTestId('dashboard-proc-status')).toHaveTextContent('5');
  });
  it('top projects table shows joined client name (AC-705)', () => {
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getAllByText('Innovate Corp').length).toBeGreaterThan(0);
  });
});

describe('ExecutiveDashboard states', () => {
  it('loading skeleton while pending (AC-706)', () => {
    dashState.isPending = true; dashState.isError = false;
    renderPage();
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
    dashState.isPending = false;
  });
  it('error state with retry (AC-707)', () => {
    dashState.isError = true; dashState.isPending = false;
    renderPage();
    expect(screen.getByTestId('dashboard-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    dashState.isError = false;
  });
  it('empty state when org has no projects/procurements (AC-708)', () => {
    dashState.data = { active_projects: 0, total_contract_value: 0, avg_gross_margin: 0,
      projects_at_risk: 0, projects_by_status: [], procurements_by_status: [], top_projects: [] };
    renderPage();
    expect(screen.getByTestId('dashboard-empty')).toBeInTheDocument();
    dashState.data = populated;
  });
});
```
**Run (red):** `npm test -- pages/ExecutiveDashboard.test.tsx` → fails (page on mockData; no testids/states).

**Then rewrite** `pmo-portal/pages/ExecutiveDashboard.tsx` with these exact changes:
1. **Remove** imports: `mockUserForRole` (line 8) and, from the `mockData` import (line 4), `projects`,
   `companies`, `procurements` (KEEP `tasks` — `EngineerDashboard` still uses it; KEEP `projects` ONLY if
   `PMDashboard`/`EngineerDashboard` still reference it — verify: they do, so keep `projects`,
   `companies` stays removed only if Exec view was its sole user — `topProjects` joined client moves to
   RPC; `companies` is used ONLY in the Exec view ⇒ remove `companies`). Net: keep `projects, tasks,
   procurements` for the sub-dashboards; remove `companies`. Remove `Kpi` from the `types` import (KPI
   cards now use the RPC payload, not the `Kpi` shape).
2. **Add** imports:
   ```ts
   import { useDashboard } from '@/src/hooks/useDashboard';
   import { formatCurrency } from '@/src/lib/format';
   ```
   and **remove** the local `formatCurrency` const (line 25) — use the shared one (FR-DASH-010).
3. **Identity (OD-D3, FR-DASH-009):** delete `const currentUser = mockUserForRole(effectiveRole);`
   (line 271). The role switch (lines 384-395) now branches on `effectiveRole` directly:
   ```ts
   switch (effectiveRole) {
     case 'Engineer': return <EngineerDashboard userId={MOCK_ENGINEER_ID} />;
     case 'Project Manager': return <PMDashboard userId={MOCK_PM_ID} />;
     case 'Finance': return <FinanceDashboard />;
     default: return renderExecutiveView();
   }
   ```
   Add near the top of the file (OD-D3 interim — sub-dashboards still mockData until their own issue):
   ```ts
   // OD-D3: interim mock ids for the not-yet-migrated role sub-dashboards. These pick a representative
   // mockData user so the demo numbers render; removed when each sub-dashboard moves to real data.
   const MOCK_ENGINEER_ID = 4;
   const MOCK_PM_ID = 2;
   ```
   (Replace `UserRole.Engineer` etc. enum cases with the string-literal `Role` values; remove the
   `UserRole` import if now unused.)
4. **Executive view data (FR-DASH-001/002):** at the top of `renderExecutiveView` (replacing the
   in-memory `projects.filter`/`reduce` block, lines 275-305), read the RPC payload:
   ```ts
   const { data, isPending, isError, refetch } = useDashboard();
   ```
   > Hooks-order: `useDashboard()` must be called unconditionally. Since `renderExecutiveView` is only
   > invoked in the default branch, move the `useDashboard()` call up into the `ExecutiveDashboard`
   > component body (top level, before the switch) and pass `data/isPending/isError/refetch` into
   > `renderExecutiveView`, OR convert `renderExecutiveView` to read them from closure — keep ALL hooks
   > at the component top (avoids the F-1 hooks-order class of bug).
5. **State branches** in the Executive view, in order, before the KPI grid:
   ```tsx
   if (isPending) return (
     <div data-testid="dashboard-loading" className="animate-pulse grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
       {Array.from({ length: 4 }).map((_, i) => (
         <div key={i} className="h-28 bg-gray-200 dark:bg-gray-700 rounded-xl" />
       ))}
     </div>
   );
   if (isError || !data) return (
     <div data-testid="dashboard-error" className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
       <h3 className="text-lg font-medium text-gray-900 dark:text-white">Couldn't load the dashboard</h3>
       <button onClick={() => refetch()} className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm">Retry</button>
     </div>
   );
   const isEmpty = data.top_projects.length === 0 && data.procurements_by_status.length === 0;
   if (isEmpty) return (
     <div data-testid="dashboard-empty" className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
       <h3 className="text-lg font-medium text-gray-900 dark:text-white">No data yet</h3>
       <p className="mt-1 text-gray-500 dark:text-gray-400">Create your first project to see KPIs here.</p>
     </div>
   );
   ```
6. **KPI cards (FR-DASH-006, OD-D2 — no deltas):** replace the `kpis` array + `KpiCard` map with four
   cards reading `data`, each with a `data-testid`. Render value + description only (drop
   `change`/`changeType`). Simplify `KpiCard` to take `{ testId, title, value, description }` (no `Kpi`):
   ```tsx
   <KpiCard testId="kpi-active-projects" title="Active Projects" value={`${data.active_projects}`} description="Ongoing projects" />
   <KpiCard testId="kpi-total-contract-value" title="Total Contract Value" value={formatCurrency(data.total_contract_value)} description="Ongoing projects" />
   <KpiCard testId="kpi-avg-gross-margin" title="Average Gross Margin" value={`${(data.avg_gross_margin * 100).toFixed(1)}%`} description="Budget vs spent" />
   <KpiCard testId="kpi-projects-at-risk" title="Projects at Risk" value={`${data.projects_at_risk}`} description="Budget usage > 90%" />
   ```
   Update the `KpiCard` component definition (lines 10-23) to the new props (drop the change/`changeType`
   markup, add `data-testid={testId}` on the outer `Card`).
7. **Charts from RPC aggregates (FR-DASH-007, NFR-DASH-PERF-002):** replace `pipelineData`/
   `performanceData` with memoized maps off the payload:
   ```ts
   const pipelineData = useMemo(
     () => data.projects_by_status.map(s => ({ name: s.status, count: s.count })),
     [data.projects_by_status],
   );
   const procStatusData = useMemo(
     () => data.procurements_by_status.map(s => ({ name: s.status, count: s.count })),
     [data.procurements_by_status],
   );
   ```
   - Keep the Project Pipeline `<BarChart>` but feed `pipelineData`; wrap its `<Card>` with
     `data-testid="dashboard-pipeline"` and add a visually-hidden span so the test can assert the count:
     `<span className="sr-only">{`Ongoing Project ${data.active_projects}`}</span>`.
   - **Replace** the "Monthly Performance (YTD)" `<LineChart>` card (OD-D2 drop) with a Procurement by
     Status `<BarChart>` fed by `procStatusData`, wrapped in `<Card data-testid="dashboard-proc-status">`
     with `<span className="sr-only">{`${data.procurements_by_status.length} statuses`}</span>`.
   - Remove the now-unused `LineChart, Line` from the recharts import if no other chart uses them.
8. **Top Projects table (FR-DASH-008, OD/OBS-DASH-002):** replace `topProjects` (in-memory sort +
   `companies.find`) with `data.top_projects`. Each row: `p.name`, `p.client_name ?? '—'` (joined in
   SQL, NO `companies.find`), `formatCurrency(p.contract_value)`, `<ProjectStatusBadge status={p.status}
   />`, progress = `p.budget > 0 ? (p.spent / p.budget) * 100 : 0`. (`ProjectStatusBadge` accepts the
   `project_status` string — verify its prop type; if it expects the prototype `ProjectStatus` enum whose
   values equal the DB strings, pass `p.status` directly; no cast needed since enum values match.)
9. **Memoize** any other view-shaping; ensure no inline `.reduce`/`.filter` over fetched data in JSX
   (NFR-DASH-PERF-002).

**Verify (green):**
```
npm test -- pages/ExecutiveDashboard.test.tsx
npm run typecheck
```
Both clean.

---

## Task 6 — Delete `mockUserForRole` + its test (last consumer gone)  *(AC-711, FR-DASH-009)*
After Task 5, the Dashboard no longer imports `mockUserForRole`. Confirm no other importer, then delete.
**Do (repo search tool first):** search `mockUserForRole` under `pmo-portal/` (exclude the module + its
own test). Expect **zero** importers.
- If zero: delete `pmo-portal/src/auth/mockUserForRole.ts` and
  `pmo-portal/src/auth/mockUserForRole.test.ts`.
- If any importer remains (unexpected): STOP, leave the files, report the importer to the Director.
**Verify:** `npm run typecheck` clean (no dangling import); `npm test` green.

---

## Task 7 — e2e: real login → Executive Dashboard real KPIs + RLS  *(AC-701, AC-702, AC-705, AC-709)*
Requires local Supabase stack (`supabase start` + `supabase db reset` for migrations 0001-0003 + enriched
seed) and `npm run dev`. Reuse `e2e/helpers.ts` `login` (do NOT redefine).

> SEED REALITY (after Task 0): 2 Ongoing projects (P001 $5,000,000, P003 $3,000,000) ⇒ Active = 2,
> Total Contract Value $8,000,000, Avg Gross Margin 30.2%, Projects at Risk 1. Same org for all seeded
> users, so the Engineer (read-in-org) sees the same org-scoped aggregates (AC-709).

**Create** `pmo-portal/e2e/AC-701-dashboard-real-kpis.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-701/702 Executive sees real KPI values from seeded data', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');
  await expect(page.getByTestId('kpi-active-projects')).toHaveText(/2/);
  await expect(page.getByTestId('kpi-total-contract-value')).toHaveText(/\$8,000,000/);
  await expect(page.getByTestId('kpi-avg-gross-margin')).toHaveText(/30\.2%/);
  await expect(page.getByTestId('kpi-projects-at-risk')).toHaveText(/1/);
});
```
**Create** `pmo-portal/e2e/AC-705-dashboard-top-projects.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-705 Top Projects table shows SQL-joined client name', async ({ page }) => {
  await login(page, 'exec@acme.test');
  await page.goto('/');
  await expect(page.getByText('Innovate Corp HQ Fit-Out').first()).toBeVisible();
  await expect(page.getByText('Innovate Corp').first()).toBeVisible();
});
```
**Create** `pmo-portal/e2e/AC-709-dashboard-rls-scoped.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-709 Engineer (read-in-org) sees org-scoped KPIs via invoker RPC', async ({ page }) => {
  await login(page, 'engineer@acme.test');
  await page.goto('/');
  // Engineer's dashboard branch differs, but if/when the Exec KPIs render for in-org reads they are
  // org-scoped (not cross-org). Assert the org-scoped active-projects aggregate is present and = 2.
  await expect(page.getByTestId('kpi-active-projects')).toHaveText(/2/);
});
```
> If OD-D3 keeps the Engineer on the mockData sub-dashboard (no Exec KPI testids), instead sign in as
> `admin@acme.test` (Admin falls to the Executive default branch) for AC-709 and assert the same
> org-scoped `2`. Pick whichever matches the Task 5 role-switch outcome; the AC intent is "an in-org
> non-Exec-creator account sees org-scoped aggregates, not cross-org". Implementer: choose the account
> whose branch renders the Exec view, and keep one spec.
**Verify (local stack up):**
```
cd pmo-portal && npx playwright test e2e/AC-701-dashboard-real-kpis.spec.ts e2e/AC-705-dashboard-top-projects.spec.ts e2e/AC-709-dashboard-rls-scoped.spec.ts
```
Expect green. (AC-703/704/706/707/708 covered by Task 5 component tests — no stack needed.)

---

## Task 8 — Full-suite gate  *(all ACs)*
**Do:** from `pmo-portal/`:
```
npm run typecheck && npm run lint && npm test
```
**Verify:** typecheck 0 errors, lint clean (`--max-warnings=0`), all Vitest specs green (dashboard db,
useDashboard, ExecutiveDashboard page + states). e2e (Task 7) runs separately against the local stack.

---

## AC → Task coverage map
| AC | Covered by |
|---|---|
| AC-701 | Task 5 (component) + Task 7 (e2e) + Task 0 (seed) |
| AC-702 | Task 5 (component) + Task 7 (e2e) + Task 0 (seed) |
| AC-703 | Task 5 (component, pipeline region) |
| AC-704 | Task 5 (component, proc-status region) |
| AC-705 | Task 5 (component) + Task 7 (e2e) |
| AC-706 | Task 5 (component, `dashboard-loading`) |
| AC-707 | Task 5 (component, error + Retry) |
| AC-708 | Task 5 (component, empty payload) |
| AC-709 | Task 1 (invoker RPC) + Task 4 (org-keyed hook) + Task 7 (e2e) |
| AC-710 | Task 3 (`getExecutiveDashboard` unit) |
| AC-711 | Task 6 (delete + grep gate) |

## Build order / dependencies
0 (seed) + 1 (migration, needs 0 for sane verify) → 2 (ADR; independent) → 3 (db, needs 1's contract) →
4 (hook, needs 3) → 5 (page, needs 4) → 6 (cleanup, needs 5) → 7 (e2e, needs 0+1+5 + local stack) →
8 (gate). Tasks 2 and 3 can start in parallel once 1's contract is fixed.

## ADR
**Required** — `docs/adr/0009-dashboard-rpc-aggregation.md` (Task 2): SQL-aggregation contract + the
`security invoker`/no-`org_id`-arg RLS model are architectural and cross-cutting (a reusable pattern for
the future per-role dashboard views, §8.4).
