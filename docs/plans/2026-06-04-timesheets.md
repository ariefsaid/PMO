# Plan: Timesheets page on real Supabase data — READ path (Issue #6)

- **Spec:** `docs/specs/timesheets.spec.md`
- **Mirror of:** Issue #5 (`docs/plans/2026-06-04-procurement-list.md`). DAL + Query infra already
  exist (`QueryClient` provider in `App.tsx`, `formatCurrency`, `e2e/helpers.ts` `login`).
- **Working dir for all commands:** `pmo-portal/` (`cd pmo-portal` first), except Task 0 (seed) which
  is `supabase/`.
- **Alias:** `@` → repo `pmo-portal/`. `@/src/...` = `pmo-portal/src/...`.
- **TDD:** every behavior task writes the failing test first, then minimum code to green it.
- **Constraint:** READ path only. No timesheet writes. Submit button + Approvals tab go inert (OD-T1);
  hours/notes inputs become read-only displays (OD-T2).
- **Field-name reality (verified):** entry date column is **`entry_date`** (NOT `date`); week column
  is `week_start_date`; owner is `user_id`. Consume snake_case rows directly — NO `as unknown as
  Timesheet/TimesheetEntry` cast (Issue #5 lesson).

## Conventions used by every task
- Row helper: `import type { Tables } from '@/src/lib/supabase/database.types'`.
- Client: `import { supabase } from '@/src/lib/supabase/client'`.
- Tests co-locate next to source (`*.test.ts(x)`). Single file: `npm test -- <path>`. Types:
  `npm run typecheck`.

---

## Task 0 — Enrich `supabase/seed.sql`: add a PM timesheet for the current week  *(AC-601, AC-602, AC-603, AC-604)*
Seed has only the Engineer's timesheet (16h). The PM (protagonist of AC-601/602) has none, and AC-603
needs two distinct users with distinct totals in one week. Finance must stay empty (AC-604).

**Do** — in `supabase/seed.sql`, replace the timesheet block (current lines 115-120, the
`-- timesheet (Monday week_start) + entries` section) with:
```sql
-- timesheets (Monday week_start). Engineer = 16h (own rows); PM = 10h (own rows). Finance: none (empty-state AC-604).
insert into timesheets (id, user_id, week_start_date, status) values
  ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a4','2026-06-01','Draft'),  -- Engineer; 2026-06-01 is a Monday
  ('70000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2','2026-06-01','Draft');  -- PM
insert into timesheet_entries (timesheet_id, project_id, entry_date, hours, notes) values
  ('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','2026-06-01',8,'Site coordination'),
  ('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','2026-06-02',8,'Drawings review'),
  ('70000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','2026-06-01',6,'Client workshop'),
  ('70000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','2026-06-02',4,'Status report');
```
(Column is `entry_date`, matching schema; respects `unique(user_id, week_start_date)` and
`week_is_monday`. Engineer total 16.0, PM total 10.0.)
**Verify:** `cd supabase && supabase db reset` runs clean (no CHECK/unique/FK error); then
`supabase db reset` is the reversibility contract (no down-migration; pre-production, ADR-0006).

---

## Task 1 — `src/lib/db/timesheets.ts`: typed `listTimesheets(userId)` with nested entries+project  *(AC-608, FR-DAL-TS-001)*
**Test first** — create `pmo-portal/src/lib/db/timesheets.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));

import { listTimesheets } from './timesheets';

beforeEach(() => { from.mockClear(); select.mockClear(); eq.mockClear(); order.mockReset(); });

describe('listTimesheets', () => {
  it('selects timesheets with nested entries+project, filtered by user_id, ordered by week desc (AC-608, FR-DAL-TS-001)', async () => {
    const rows = [{
      id: '70000000-0000-0000-0000-000000000002',
      user_id: '00000000-0000-0000-0000-0000000000a2',
      week_start_date: '2026-06-01', status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null,
      org_id: '00000000-0000-0000-0000-000000000001',
      entries: [
        { id: 'e1', timesheet_id: '70000000-0000-0000-0000-000000000002',
          project_id: '40000000-0000-0000-0000-000000000001', entry_date: '2026-06-01',
          hours: 6, notes: 'Client workshop',
          project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
      ],
    }];
    order.mockResolvedValue({ data: rows, error: null });
    const result = await listTimesheets('00000000-0000-0000-0000-0000000000a2');
    expect(from).toHaveBeenCalledWith('timesheets');
    expect(select).toHaveBeenCalledWith('*, entries:timesheet_entries(*, project:projects(name,code))');
    expect(eq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-0000000000a2');
    expect(order).toHaveBeenCalledWith('week_start_date', { ascending: false });
    expect(result[0].entries[0].project?.name).toBe('Innovate Corp HQ Fit-Out');
    expect(result[0].entries[0].entry_date).toBe('2026-06-01');
  });

  it('sends no org_id (RLS scopes it) (FR-DAL-TS-001)', async () => {
    order.mockResolvedValue({ data: [], error: null });
    await listTimesheets('u1');
    expect(JSON.stringify(select.mock.calls)).not.toContain('org_id');
    expect(JSON.stringify(eq.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error (AC-608)', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(listTimesheets('u1')).rejects.toThrow('boom');
  });
});
```
**Run (red):** `npm test -- src/lib/db/timesheets.test.ts` → fails (module missing).
**Then create** `pmo-portal/src/lib/db/timesheets.ts`:
```ts
import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type TimesheetRow = Tables<'timesheets'>;
export type TimesheetEntryRow = Tables<'timesheet_entries'>;

/** An entry row with its project name/code resolved in SQL (kills render-time .find()). */
export type TimesheetEntryWithProject = TimesheetEntryRow & {
  project: { name: string; code: string | null } | null;
};

/** A timesheet header with its entries (each carrying the joined project) resolved in one query. */
export type TimesheetWithEntries = TimesheetRow & {
  entries: TimesheetEntryWithProject[];
};

const SELECT = '*, entries:timesheet_entries(*, project:projects(name,code))';

/**
 * List the given user's timesheets + entries for the caller's org. org_id is NEVER sent — RLS
 * (timesheets_select) scopes rows; passing the signed-in user's own id keeps it to own rows even
 * for manager roles (FR-DAL-TS-001). On error it throws.
 */
export async function listTimesheets(userId: string): Promise<TimesheetWithEntries[]> {
  const { data, error } = await supabase
    .from('timesheets')
    .select(SELECT)
    .eq('user_id', userId)
    .order('week_start_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TimesheetWithEntries[];
}
```
**Verify (green):** `npm test -- src/lib/db/timesheets.test.ts` passes; `npm run typecheck` clean.

---

## Task 2 — `src/hooks/useTimesheets.ts`: org+user-scoped hook  *(AC-601, FR-QRY-TS-001)*
**Test first** — create `pmo-portal/src/hooks/useTimesheets.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/timesheets', () => ({
  listTimesheets: vi.fn().mockResolvedValue([
    { id: 'ts1', user_id: 'u1', week_start_date: '2026-06-01', status: 'Draft', entries: [] },
  ]),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useTimesheets } from './useTimesheets';
import { listTimesheets } from '@/src/lib/db/timesheets';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useTimesheets', () => {
  it("keys by ['timesheets', orgId, userId], calls listTimesheets(userId) (AC-601, FR-QRY-TS-001)", async () => {
    const { result } = renderHook(() => useTimesheets(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].week_start_date).toBe('2026-06-01');
    expect(listTimesheets).toHaveBeenCalledWith('u1');
  });
});
```
**Run (red):** `npm test -- src/hooks/useTimesheets.test.tsx` → fails.
**Then create** `pmo-portal/src/hooks/useTimesheets.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { listTimesheets, type TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { useAuth } from '@/src/auth/useAuth';

/** Org+user-scoped timesheet list. queryKey includes org_id + user id so cache is tenant- and
 * user-scoped (FR-QRY-TS-001). Fetches only the signed-in user's own rows. */
export function useTimesheets() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  return useQuery<TimesheetWithEntries[]>({
    queryKey: ['timesheets', orgId, userId],
    queryFn: () => listTimesheets(userId as string),
    enabled: Boolean(orgId && userId),
  });
}
```
**Verify (green):** `npm test -- src/hooks/useTimesheets.test.tsx` passes; `npm run typecheck` clean.

---

## Task 3 — Swap `pages/Timesheets.tsx` to real data; loading/empty/error; memoized totals  *(AC-601..607; FR-TS-001..008)*
Largest slice. Component tests first; then rewrite the data source + state branches + memoized
selectors. Preserve the existing summary-header + matrix-table JSX shell; replace only the data source,
the totals computation (now memoized), and add the state branches. Submit button + Approvals tab go
inert (OD-T1); hours/notes inputs become read-only spans (OD-T2).

**Test first** — create `pmo-portal/pages/Timesheets.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import Timesheets from './Timesheets';

// Seeded PM week (2026-06-01): 6 + 4 = 10.0 hours, one project.
const pmSheet = [{
  id: 'ts-pm', user_id: 'u-alice', week_start_date: '2026-06-01', status: 'Draft',
  submitted_at: null, approved_by: null, approved_at: null, org_id: 'org-1',
  entries: [
    { id: 'e1', timesheet_id: 'ts-pm', project_id: 'pr1', entry_date: '2026-06-01', hours: 6,
      notes: 'Client workshop', project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
    { id: 'e2', timesheet_id: 'ts-pm', project_id: 'pr1', entry_date: '2026-06-02', hours: 4,
      notes: 'Status report', project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
  ],
}];

const tsState: any = { data: pmSheet, isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));

const renderPage = () => render(<MemoryRouter><Timesheets /></MemoryRouter>);

describe('Timesheets (real data)', () => {
  it('renders the signed-in user entry with joined project name for the current week (AC-601)', () => {
    renderPage();
    expect(screen.getAllByText('Innovate Corp HQ Fit-Out').length).toBeGreaterThan(0);
  });

  it('renders the correct memoized weekly total 10.0 (AC-602, AC-607)', () => {
    renderPage();
    // weekly-total cell renders toFixed(1); a rendered computed value, not mere presence.
    expect(screen.getByTestId('timesheets-weekly-total')).toHaveTextContent('10.0');
  });
});

describe('Timesheets states', () => {
  it('loading skeleton while pending (AC-605)', () => {
    tsState.isPending = true; tsState.isError = false;
    renderPage();
    expect(screen.getByTestId('timesheets-loading')).toBeInTheDocument();
    tsState.isPending = false;
  });
  it('error state with retry (AC-606)', () => {
    tsState.isError = true; tsState.isPending = false;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    tsState.isError = false;
  });
  it('empty state when the current week has no entries (AC-604)', () => {
    tsState.data = [];
    renderPage();
    expect(screen.getByTestId('timesheets-empty')).toBeInTheDocument();
    tsState.data = pmSheet;
  });
});
```
**Run (red):** `npm test -- pages/Timesheets.test.tsx` → fails (page on mockData; no testids/states).

**Then rewrite** `pmo-portal/pages/Timesheets.tsx` with these exact changes:
1. **Remove** imports: `import { timesheets as mockTimesheets, timesheetEntries as
   mockTimesheetEntries, users, projects } from '../data/mockData';` and the `Timesheet,
   TimesheetEntry, TimesheetStatus, User, ProjectStatus` type imports from `'../types'` (the page no
   longer uses prototype shapes). **Keep** `Card`, `TimesheetStatusBadge`, the icon imports.
2. **Add** imports:
   ```ts
   import { useTimesheets } from '@/src/hooks/useTimesheets';
   import { useAuth } from '@/src/auth/useAuth';
   import type { TimesheetWithEntries, TimesheetEntryWithProject } from '@/src/lib/db/timesheets';
   ```
3. **Delete** `const CURRENT_USER_ID = 1;` and the `users.find(...)` / `isManager` / mock-derived
   identity lines (current lines 19-34). **Replace** with:
   ```ts
   const { currentUser } = useAuth();
   const { data: sheets, isPending, isError, refetch } = useTimesheets();
   const allSheets: TimesheetWithEntries[] = sheets ?? [];
   ```
4. **Keep** the local `getWeekStartDate`/`formatDate` date helpers and the `currentDate`/`weekDates`
   state + memo (date math, not data). **Delete** the `activeTab`/Approvals state, the `uiRows`
   `useState` + the `useEffect` that seeds `uiRows`, and every `set*` mutation handler
   (`handleAddRow`, `handleRowNotesChange`, `handleDeleteRow`, `handleHoursChange`,
   `handleSubmitForApproval`, `handleApprovalAction`, `pendingApprovals`) — all are writes (OUT).
5. **Replace** `currentTimesheet`/`currentWeekEntries` memos to read real data (FR-TS-001/006):
   ```ts
   const weekStartString = formatDate(getWeekStartDate(new Date(currentDate)));
   const currentTimesheet = useMemo(
     () => allSheets.find(t => t.week_start_date === weekStartString) ?? null,
     [allSheets, weekStartString],
   );
   const currentWeekEntries = useMemo<TimesheetEntryWithProject[]>(
     () => currentTimesheet?.entries ?? [],
     [currentTimesheet],
   );
   ```
6. **Memoized grid rows** (OD-T4 grouping by `project_id + notes`) (FR-TS-007):
   ```ts
   const rows = useMemo(() => {
     const map = new Map<string, { id: string; projectId: string; projectName: string; notes: string }>();
     for (const e of currentWeekEntries) {
       const key = `${e.project_id}::${e.notes ?? ''}`;
       if (!map.has(key)) map.set(key, {
         id: key, projectId: e.project_id,
         projectName: e.project?.name ?? 'Unknown Project', notes: e.notes ?? '',
       });
     }
     return Array.from(map.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
   }, [currentWeekEntries]);
   ```
7. **Memoized totals** (FR-TS-007/008) — replace the inline `weeklyTotal`/daily/row `.reduce` calls:
   ```ts
   const weeklyTotal = useMemo(
     () => currentWeekEntries.reduce((sum, e) => sum + Number(e.hours), 0),
     [currentWeekEntries],
   );
   const dailyTotals = useMemo(() => weekDates.map(d => {
     const ds = formatDate(d);
     return currentWeekEntries.filter(e => e.entry_date === ds).reduce((s, e) => s + Number(e.hours), 0);
   }), [currentWeekEntries, weekDates]);
   ```
   In the grid body, derive each `rowTotal`/cell `entry` against `e.entry_date` (snake_case) and the
   memoized `rows`; render `weeklyTotal.toFixed(1)` in the summary circle and the weekly-total cell.
8. **Grid cells read-only (OD-T2):** replace each `<input>` (notes + hours) with a `<span>` rendering
   `row.notes || '-'` and `entry ? Number(entry.hours).toFixed(2) : '-'`. Remove the "+ Add Line
   Item" select row and the per-row delete button.
9. **Inert Submit (OD-T1):** keep the Submit button markup but set `disabled` always and add a
   `title="Submitting is coming soon"`; remove its `onClick`. Remove the `isManager` Tabs nav and the
   entire `ApprovalsView` (deferred).
10. **Test ids + weekly-total cell:** give the summary weekly-total element
    `data-testid="timesheets-weekly-total"` rendering `weeklyTotal.toFixed(1)`.
11. **State branches** — at the top of the returned JSX body (before the summary header), add in order:
    ```tsx
    if (isPending) {
      return <Card><div data-testid="timesheets-loading" className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-xl" />
      </div></Card>;
    }
    if (isError) {
      return <Card><div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Couldn't load timesheets</h3>
        <p className="mt-1 text-gray-500 dark:text-gray-400">Something went wrong fetching your hours.</p>
        <button onClick={() => refetch()} className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm">Retry</button>
      </div></Card>;
    }
    ```
12. **Empty state (FR-TS-005):** when `currentWeekEntries.length === 0`, render (in place of the table
    body, or below the header) a block with `data-testid="timesheets-empty"` and copy "No hours logged
    for this week." The summary header + week nav still render.

**Verify (green):**
```
npm test -- pages/Timesheets.test.tsx
npm run typecheck
```
Both clean.

---

## Task 4 — `mockUserForRole` / mock-import cleanup check  *(cleanup, FR-TS-006)*
Timesheets no longer imports `mockData` or any mock identity bridge. Confirm whether other pages still
do before any removal.
**Do (repo search tool):** search `mockUserForRole` and `from '../data/mockData'` under
`pmo-portal/pages` + `pmo-portal/components`. If Dashboard/SalesPipeline still import them (expected),
**leave the files in place**. If NO importers remain for `mockUserForRole.ts`, delete it + its test.
**Verify:** `npm run typecheck` clean; `npm test` green either way.

---

## Task 5 — e2e: real login → timesheets flow  *(AC-601, AC-602, AC-603, AC-604)*
Requires local Supabase stack (`supabase start` + `supabase db reset` for migrations + enriched seed)
and `npm run dev`. Reuse `e2e/helpers.ts` `login` (do NOT redefine).

> SEED REALITY (after Task 0): current week `2026-06-01`. PM (`pm@acme.test`) = 6 + 4 = **10.0h** on
> "Innovate Corp HQ Fit-Out". Engineer (`engineer@acme.test`) = 8 + 8 = **16.0h**. Finance
> (`finance@acme.test`) = **no** timesheet. Tests assume "today" is in the week of 2026-06-01; if the
> suite runs on a later real date, navigate back via the prev-week control until the week label reads
> "Jun 1 - Jun 7, 2026" before asserting (helper note below).

**Create** `pmo-portal/e2e/AC-601-timesheets-real-data.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-601/602 PM sees own seeded entries with project name and weekly total 10.0', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/timesheets');
  await expect(page.getByText('Innovate Corp HQ Fit-Out').first()).toBeVisible();
  await expect(page.getByTestId('timesheets-weekly-total')).toHaveText(/10\.0/);
});
```
**Create** `pmo-portal/e2e/AC-603-timesheets-own-rows.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-603 Engineer sees only own rows (16.0), not the PM total (10.0)', async ({ page }) => {
  await login(page, 'engineer@acme.test');
  await page.goto('/timesheets');
  await expect(page.getByTestId('timesheets-weekly-total')).toHaveText(/16\.0/);
  await expect(page.getByTestId('timesheets-weekly-total')).not.toHaveText(/10\.0/);
});
```
**Create** `pmo-portal/e2e/AC-604-timesheets-empty.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-604 Finance (no timesheet) sees the empty state, no crash', async ({ page }) => {
  await login(page, 'finance@acme.test');
  await page.goto('/timesheets');
  await expect(page.getByTestId('timesheets-empty')).toBeVisible();
});
```
**Verify (local stack up):**
```
cd pmo-portal && npx playwright test e2e/AC-601-timesheets-real-data.spec.ts e2e/AC-603-timesheets-own-rows.spec.ts e2e/AC-604-timesheets-empty.spec.ts
```
Expect green. (AC-605/606/607 covered by Task 3 component tests — no stack needed.)

---

## Task 6 — Full-suite gate  *(all ACs)*
**Do:** from `pmo-portal/`:
```
npm run typecheck && npm run lint && npm test
```
**Verify:** typecheck 0 errors, lint clean, all Vitest specs green (timesheets db, useTimesheets,
Timesheets page + states). e2e (Task 5) runs separately against the local stack.

---

## AC → Task coverage map
| AC | Covered by |
|---|---|
| AC-601 | Task 3 (component) + Task 5 (e2e) |
| AC-602 | Task 3 (component, weekly-total 10.0) + Task 5 (e2e) |
| AC-603 | Task 5 (e2e, Engineer own-rows 16.0) + Task 0 (seed) |
| AC-604 | Task 3 (component, empty) + Task 5 (e2e, Finance) + Task 0 (seed) |
| AC-605 | Task 3 (component, `timesheets-loading`) |
| AC-606 | Task 3 (component, error+Retry) |
| AC-607 | Task 3 (component, memoized weekly total) |
| AC-608 | Task 1 (`listTimesheets` unit) |

## Build order / dependencies
0 (seed; independent, needed by e2e) → 1 (db) → 2 (hook, needs 1) → 3 (page, needs 2) →
4 (cleanup) → 5 (e2e, needs 0 + 3 + local stack) → 6 (gate). Task 1 can start in parallel with Task 0.

## No ADR required
Pure mirror of decisions in ADR-0003 (DAL) + ADR-0005 (TanStack Query). No new architectural decision.
