# Plan: Procurement list on real Supabase data (Issue #5)

- **Spec:** `docs/specs/procurement-list.spec.md`
- **Mirror of:** Issue #4 (`docs/plans/2026-06-03-data-layer-projects.md`). DAL + Query infra already
  exist (`QueryClient` provider wired in `App.tsx`, `formatCurrency`, `signIn`/`login` e2e helper).
- **Working dir for all commands:** `pmo-portal/` (`cd pmo-portal` first).
- **Alias:** `@` → repo `pmo-portal/`. `@/src/...` = `pmo-portal/src/...`.
- **TDD:** every behavior task writes the failing test first, then minimum code to green it.
- **Constraint:** READ path only. No procurement writes. `New Request` modal stays inert.
- **Enum parity (verified):** DB `status` strings == `ProcurementStatus` enum values, so the badge
  takes `status` directly — NO `as unknown as` double-cast (Issue #4 lesson).

## Conventions used by every task
- Row helper: `import type { Tables } from '@/src/lib/supabase/database.types'`.
- Client: `import { supabase } from '@/src/lib/supabase/client'`.
- Tests co-locate next to source (`*.test.ts(x)`). Single file: `npm test -- <path>`. Types:
  `npm run typecheck`.

---

## Task 1 — `src/lib/db/procurements.ts`: typed `listProcurements()` with SQL joins  *(AC-509, FR-DAL-PROC-001)*
**Test first** — create `pmo-portal/src/lib/db/procurements.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const select = vi.fn();
const from = vi.fn(() => ({ select }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));

import { listProcurements } from './procurements';

beforeEach(() => { from.mockClear(); select.mockReset(); });

describe('listProcurements', () => {
  it('selects procurements joining project/vendor/requester; returns rows (AC-509, FR-DAL-PROC-001)', async () => {
    const rows = [{
      id: '60000000-0000-0000-0000-000000000001', code: 'PROC-2026-004',
      title: 'Workstations & AV', status: 'Vendor Quoted', total_value: 150000,
      project_id: '40000000-0000-0000-0000-000000000001',
      requested_by_id: '00000000-0000-0000-0000-0000000000a2', vendor_id: null,
      created_at: '2026-02-05T00:00:00Z',
      project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001' },
      vendor: null, requested_by: { full_name: 'Alice Manager' },
    }];
    select.mockResolvedValue({ data: rows, error: null });
    const result = await listProcurements();
    expect(from).toHaveBeenCalledWith('procurements');
    expect(select).toHaveBeenCalledWith(
      '*, project:projects(name,code), vendor:companies(name), requested_by:profiles(full_name)',
    );
    expect(result[0].project?.name).toBe('Innovate Corp HQ Fit-Out');
    expect(result[0].requested_by?.full_name).toBe('Alice Manager');
    expect(result[0].vendor).toBeNull();
  });

  it('sends no org_id (RLS scopes it) (FR-DAL-PROC-001)', async () => {
    select.mockResolvedValue({ data: [], error: null });
    await listProcurements();
    expect(JSON.stringify(select.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error (AC-509)', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(listProcurements()).rejects.toThrow('boom');
  });
});
```
**Run (red):** `npm test -- src/lib/db/procurements.test.ts` → fails (module missing).
**Then create** `pmo-portal/src/lib/db/procurements.ts`:
```ts
import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type ProcurementRow = Tables<'procurements'>;

/** A procurement row with project/vendor/requester names resolved in SQL (kills render-time .find()). */
export type ProcurementWithRefs = ProcurementRow & {
  project: { name: string; code: string | null } | null;
  vendor: { name: string } | null;
  requested_by: { full_name: string } | null;
};

const SELECT =
  '*, project:projects(name,code), vendor:companies(name), requested_by:profiles(full_name)';

/**
 * List procurements for the caller's org. org_id is NEVER sent — RLS (org_id = auth_org_id())
 * scopes rows (FR-DAL-PROC-001). The page filters the cached list client-side this issue.
 */
export async function listProcurements(): Promise<ProcurementWithRefs[]> {
  const { data, error } = await supabase.from('procurements').select(SELECT);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProcurementWithRefs[];
}
```
**Verify (green):** `npm test -- src/lib/db/procurements.test.ts` passes; `npm run typecheck` clean.

---

## Task 2 — `src/hooks/useProcurements.ts`: org-scoped hook  *(AC-501, FR-QRY-PROC-001)*
**Test first** — create `pmo-portal/src/hooks/useProcurements.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/procurements', () => ({
  listProcurements: vi.fn().mockResolvedValue([
    { id: 'pc1', title: 'Workstations & AV', project: null, vendor: null, requested_by: null },
  ]),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProcurements } from './useProcurements';
import { listProcurements } from '@/src/lib/db/procurements';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useProcurements', () => {
  it("keys by ['procurements', orgId] and returns rows (AC-501, FR-QRY-PROC-001)", async () => {
    const { result } = renderHook(() => useProcurements(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].title).toBe('Workstations & AV');
    expect(listProcurements).toHaveBeenCalled();
  });
});
```
**Run (red):** `npm test -- src/hooks/useProcurements.test.tsx` → fails.
**Then create** `pmo-portal/src/hooks/useProcurements.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { listProcurements, type ProcurementWithRefs } from '@/src/lib/db/procurements';
import { useAuth } from '@/src/auth/useAuth';

/** Org-scoped procurement list. queryKey includes org_id so cache is tenant-scoped (FR-QRY-PROC-001). */
export function useProcurements() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProcurementWithRefs[]>({
    queryKey: ['procurements', orgId],
    queryFn: () => listProcurements(),
    enabled: Boolean(orgId),
  });
}
```
**Verify (green):** `npm test -- src/hooks/useProcurements.test.tsx` passes; `npm run typecheck` clean.

---

## Task 3 — Swap `pages/Procurement.tsx` to real data; loading/empty/error; real "My Requests"  *(AC-501..507; FR-PROC-001..008)*
Largest slice. Component tests first; then full rewrite of the data source + state branches. Preserve
ALL existing JSX/markup except the data source, the `formatCurrency` import, and the new state branches.

**Test first** — create `pmo-portal/pages/Procurement.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import Procurement from './Procurement';

const seed = [
  { id: 'pc1', code: 'PROC-2026-004', title: 'Workstations & AV', status: 'Vendor Quoted',
    total_value: 150000, project_id: 'pr1', requested_by_id: 'u-alice', vendor_id: null,
    created_at: '2026-02-05T00:00:00Z',
    project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001' }, vendor: null,
    requested_by: { full_name: 'Alice Manager' } },
];

const procState = { data: seed, isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager' }) }));

const renderPage = () => render(<MemoryRouter><Procurement /></MemoryRouter>);

describe('Procurement (real data)', () => {
  it('renders seeded procurement with joined project name (AC-501)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
  });

  it('"My Requests" uses the real profile id (AC-502)', () => {
    renderPage(); // default tab is My Requests; u-alice is the requester
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
  });

  it('Active Orders excludes the Vendor Quoted row (AC-503)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Active Orders/ }));
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
    expect(screen.getByText(/No requests found/i)).toBeInTheDocument();
  });

  it('search filters real rows (AC-504)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    await userEvent.type(screen.getByPlaceholderText(/Search procurements/i), 'zzz');
    expect(screen.getByText(/No requests found/i)).toBeInTheDocument();
  });
});

describe('Procurement states', () => {
  it('loading skeleton while pending (AC-505)', () => {
    procState.isPending = true; procState.isError = false;
    renderPage();
    expect(screen.getByTestId('procurement-loading')).toBeInTheDocument();
    procState.isPending = false;
  });
  it('error state with retry (AC-507)', () => {
    procState.isError = true; procState.isPending = false;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    procState.isError = false;
  });
  it('empty state when zero rows (AC-506)', async () => {
    procState.data = [];
    renderPage();
    expect(screen.getByText(/No requests found/i)).toBeInTheDocument();
    procState.data = seed;
  });
});
```
**Run (red):** `npm test -- pages/Procurement.test.tsx` → fails (page on mockData; no states/testids).

**Then rewrite** `pmo-portal/pages/Procurement.tsx` with these exact changes:
1. **Remove** imports: `import { procurements, projects, companies } from '../data/mockData';` and
   `import { mockUserForRole } from '@/src/auth/mockUserForRole';`. **Keep** `ProcurementStatus` from
   `'../types'` and `ProcurementStatusBadge`.
2. **Add** imports:
   ```ts
   import { useProcurements } from '@/src/hooks/useProcurements';
   import { useAuth } from '@/src/auth/useAuth';
   import { formatCurrency } from '@/src/lib/format';
   import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
   ```
3. **Delete** the local `const formatCurrency = ...` line (line 11; now imported, FR-PROC-008).
4. **Replace** the identity + data lines (current lines 18-20, the `useEffectiveRole`/`mockUserForRole`
   block) with:
   ```ts
   useEffectiveRole(); // still wires ImpersonationProvider in Shell
   const { currentUser } = useAuth();
   const { data: procData, isPending, isError, refetch } = useProcurements();
   const allProcurements = procData ?? [];
   ```
   Keep the existing `import { useEffectiveRole } from '@/src/auth/impersonation';`.
5. **Rewrite `getFilteredProcurements`** to operate on `allProcurements: ProcurementWithRefs[]`:
   - `My Requests`: `p.requested_by_id === currentUser?.id` (FR-PROC-006).
   - `To Approve`: `p.status === ProcurementStatus.Requested` (OD-5).
   - `Active Orders`: `[ProcurementStatus.Ordered, ProcurementStatus.Received,
     ProcurementStatus.VendorInvoiced].includes(p.status as ProcurementStatus)` (OD-5).
   - `All`: no pre-filter.
   - Search (OD-7): `p.title.toLowerCase().includes(q) || (p.code ?? '').toLowerCase().includes(q)`.
   - Sort: `new Date(b.created_at).getTime() - new Date(a.created_at).getTime()` (snake_case).
6. **Rewrite `counts`** off `allProcurements` with the same predicates (snake_case `requested_by_id`,
   `status`).
7. **Joined names** (FR-PROC-002) — delete both `projects.find(...)` / `companies.find(...)` lookups in
   Grid and List. Render:
   - project: `procurement.project?.name ?? 'Unknown Project'`
   - vendor: `procurement.vendor?.name ?? 'Vendor Pending'` (OD-6)
   - In Grid/List replace `procurement.id` reference chip with `procurement.code ?? procurement.id.slice(0, 8)`.
8. **Snake_case fields:** `procurement.total_value` (was `totalValue`), `procurement.created_at`
   (was `createdAt`) in both Grid date + List date cells.
9. **Status:** `<ProcurementStatusBadge status={procurement.status as ProcurementStatus} />` and
   `getProgressPercentage(procurement.status as ProcurementStatus)` /
   `getStatusColor(procurement.status as ProcurementStatus)` — the cast is a string→enum widening only
   (values are identical), NOT an `as unknown as` row-shape cast.
10. **State branches** — at the top of the returned JSX body (before the header), add in order:
    ```tsx
    if (isPending) {
      return <div data-testid="procurement-loading" className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[0,1,2].map(i => <div key={i} className="h-48 bg-gray-200 dark:bg-gray-700 rounded-xl" />)}
        </div>
      </div>;
    }
    if (isError) {
      return <div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Couldn't load procurements</h3>
        <p className="mt-1 text-gray-500 dark:text-gray-400">Something went wrong fetching your requests.</p>
        <button onClick={() => refetch()} className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm">Retry</button>
      </div>;
    }
    ```
    The existing empty-state block (`filteredProcurements.length === 0`) stays and satisfies
    AC-506/FR-PROC-005.
11. **`New Request` modal** stays exactly as-is (inert; no DB write).

**Verify (green):**
```
npm test -- pages/Procurement.test.tsx
npm run typecheck
```
Both clean.

---

## Task 4 — Confirm `mockUserForRole` still used elsewhere (no-op cleanup)  *(cleanup, FR-PROC-006)*
Procurement no longer references the bridge. Confirm other pages still do before any removal.
**Do (repo search tool):** search `mockUserForRole` under `pmo-portal/pages` + `pmo-portal/components`.
If Timesheets/Dashboard/SalesPipeline still import it (expected), **leave the file in place**. If NO
importers remain, delete `pmo-portal/src/auth/mockUserForRole.ts` + its test.
**Verify:** `npm run typecheck` clean; `npm test` green either way.

---

## Task 5 — e2e: real login → procurement flow  *(AC-501, AC-502, AC-503, AC-504, AC-508)*
Requires local Supabase stack (`supabase start` + `supabase db reset` for migrations+seed) and
`npm run dev`. Reuse the existing `e2e/helpers.ts` `login` helper (do NOT re-define).

> SEED REALITY (verified `supabase/seed.sql`): exactly ONE procurement — `PROC-2026-004`
> "Workstations & AV", status `Vendor Quoted`, `requested_by_id = …a2` (the PM, `pm@acme.test`),
> `vendor_id = null`, project = "Innovate Corp HQ Fit-Out". Assertions below are calibrated to that.

**Create** `pmo-portal/e2e/AC-501-procurement-real-data.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-501 PM sees real seeded procurement with joined project name', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /^All/ }).click();
  await expect(page.getByText('Workstations & AV')).toBeVisible();
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
});

test('AC-503 Active Orders excludes the Vendor Quoted row', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /Active Orders/ }).click();
  await expect(page.getByText('Workstations & AV')).toHaveCount(0);
  await expect(page.getByText(/No requests found/i)).toBeVisible();
});

test('AC-504 search filters real rows', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /^All/ }).click();
  await page.getByPlaceholder(/Search procurements/i).fill('Workstations');
  await expect(page.getByText('Workstations & AV')).toBeVisible();
  await page.getByPlaceholder(/Search procurements/i).fill('zzz');
  await expect(page.getByText(/No requests found/i)).toBeVisible();
});
```
**Create** `pmo-portal/e2e/AC-502-my-requests-real-id.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-502 My Requests shows PM-requested row, empty for Engineer', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /My Requests/ }).click();
  await expect(page.getByText('Workstations & AV')).toBeVisible();

  await login(page, 'engineer@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /My Requests/ }).click();
  await expect(page.getByText(/No requests found/i)).toBeVisible();
});
```
**Create** `pmo-portal/e2e/AC-508-engineer-rls-read.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('AC-508 Engineer reads org procurements (RLS read path)', async ({ page }) => {
  await login(page, 'engineer@acme.test');
  await page.goto('/procurement');
  await page.getByRole('button', { name: /^All/ }).click();
  await expect(page.getByText('Workstations & AV')).toBeVisible();
});
```
**Verify (local stack up):**
```
cd pmo-portal && npx playwright test e2e/AC-501-procurement-real-data.spec.ts e2e/AC-502-my-requests-real-id.spec.ts e2e/AC-508-engineer-rls-read.spec.ts
```
Expect green. (AC-505/506/507 are covered by Task 3 component tests — no stack needed.)

---

## Task 6 — Full-suite gate  *(all ACs)*
**Do:** from `pmo-portal/`:
```
npm run typecheck && npm run lint && npm test
```
**Verify:** typecheck 0 errors, lint clean, all Vitest specs green (procurements db, useProcurements,
Procurement page + states). e2e (Task 5) runs separately against the local stack.

---

## AC → Task coverage map
| AC | Covered by |
|---|---|
| AC-501 | Task 3 (component) + Task 5 (e2e) |
| AC-502 | Task 3 (component) + Task 5 (e2e) |
| AC-503 | Task 3 (component) + Task 5 (e2e) |
| AC-504 | Task 3 (component) + Task 5 (e2e) |
| AC-505 | Task 3 (component, `procurement-loading`) |
| AC-506 | Task 3 (component, empty state) |
| AC-507 | Task 3 (component, error+Retry) |
| AC-508 | Task 5 (e2e, Engineer RLS read) |
| AC-509 | Task 1 (`listProcurements` unit) |

## Build order / dependencies
1 (db) → 2 (hook, needs 1) → 3 (page, needs 2 + existing `formatCurrency`) → 4 (cleanup) →
5 (e2e, needs 3 + local stack) → 6 (gate). Tasks 1 is independent; rest sequential.

## No ADR required
Pure mirror of decisions in ADR-0003 (DAL) + ADR-0005 (TanStack Query). No new architectural decision.
