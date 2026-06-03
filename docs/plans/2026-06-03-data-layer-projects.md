# Plan: Data-access layer + Projects list on real Supabase data (Issue #4)

- **Spec:** `docs/specs/data-layer-projects.spec.md`
- **Grounds:** target-arch §3/§4/§8/§9; ADR-0003, ADR-0005.
- **Working dir for all commands:** `pmo-portal/` (`cd pmo-portal` first; commands assume that cwd).
- **Alias:** `@` → repo `pmo-portal/`. So `@/src/...` = `pmo-portal/src/...`, `@/types` = `pmo-portal/types.ts`.
- **TDD:** every behavior task writes the failing test first, then the minimum code to green it.
- **Constraint:** READ path only. No project writes. `New Project` button stays inert.

## Conventions used by every task
- Row type helper: `import type { Tables } from '@/src/lib/supabase/database.types'`.
- Supabase client: `import { supabase } from '@/src/lib/supabase/client'`.
- Test files co-locate next to source (`*.test.ts(x)`), per existing repo pattern (`src/auth/*.test.*`).
- Run a single test file with: `npm test -- <path>`. Full suite: `npm test`. Types: `npm run typecheck`.

---

## Task 0 — Install TanStack Query  *(setup, no AC)*
**File:** `pmo-portal/package.json` (dependency add only).
**Do:** run, from `pmo-portal/`:
```
npm install @tanstack/react-query@^5.59.0
```
**Verify:**
```
npm ls @tanstack/react-query
```
Expect it to print `@tanstack/react-query@5.x`. (No source edit; the implementer runs the install.)

---

## Task 1 — `src/lib/format.ts`: centralized currency formatter  *(AC-410, FR-FMT-001, F-6)*
**Test first** — create `pmo-portal/src/lib/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatCurrency } from './format';

describe('formatCurrency', () => {
  it('formats USD with no fraction digits (AC-410)', () => {
    expect(formatCurrency(5000000)).toBe('$5,000,000');
  });
  it('rounds to whole dollars', () => {
    expect(formatCurrency(1234.56)).toBe('$1,235');
  });
});
```
**Run (red):** `npm test -- src/lib/format.test.ts` → fails (module missing).
**Then create** `pmo-portal/src/lib/format.ts`:
```ts
// Single source of truth for currency formatting (F-6). USD, no fraction digits —
// preserves the prototype's prior output. Multi-currency deferred (NFR-I18N-001, OD-1).
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}
```
**Verify (green):** `npm test -- src/lib/format.test.ts` passes; `npm run typecheck` clean.

---

## Task 2 — `src/lib/db/projects.ts`: typed `listProjects()` with SQL joins  *(AC-409, FR-DAL-001/003/004/005, F-7)*
**Test first** — create `pmo-portal/src/lib/db/projects.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const select = vi.fn();
const from = vi.fn(() => ({ select }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));

import { listProjects } from './projects';

beforeEach(() => { from.mockClear(); select.mockReset(); });

describe('listProjects', () => {
  it('selects projects joining client name + PM name; returns rows (AC-409, FR-DAL-001)', async () => {
    const rows = [{
      id: '40000000-0000-0000-0000-000000000001', name: 'Innovate Corp HQ Fit-Out',
      status: 'Ongoing Project', client_id: 'c…2', project_manager_id: '…a2',
      contract_value: 5000000, budget: 4700000, spent: 2100000,
      start_date: '2026-01-06', end_date: '2026-12-18',
      client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    }];
    select.mockResolvedValue({ data: rows, error: null });
    const result = await listProjects();
    expect(from).toHaveBeenCalledWith('projects');
    expect(select).toHaveBeenCalledWith('*, client:companies(name), pm:profiles(full_name)');
    expect(result[0].client?.name).toBe('Innovate Corp');
    expect(result[0].pm?.full_name).toBe('Alice Manager');
  });

  it('sends no org_id (RLS scopes it) (FR-DAL-004)', async () => {
    select.mockResolvedValue({ data: [], error: null });
    await listProjects();
    expect(JSON.stringify(select.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error (AC-409, FR-DAL-003)', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(listProjects()).rejects.toThrow('boom');
  });
});
```
**Run (red):** `npm test -- src/lib/db/projects.test.ts` → fails (module missing).
**Then create** `pmo-portal/src/lib/db/projects.ts`:
```ts
import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type ProjectRow = Tables<'projects'>;

/** A project row with client + PM names resolved in SQL (kills render-time .find(), F-7). */
export type ProjectWithRefs = ProjectRow & {
  client: { name: string } | null;
  pm: { full_name: string } | null;
};

const SELECT = '*, client:companies(name), pm:profiles(full_name)';

/**
 * List projects for the caller's org. org_id is NEVER sent — RLS (org_id = auth_org_id())
 * scopes rows (FR-DAL-004). Optional params support later server-side filtering (OD-3); the
 * Projects page filters the cached list client-side for this issue.
 */
export async function listProjects(
  params?: { status?: ProjectRow['status']; pmId?: string },
): Promise<ProjectWithRefs[]> {
  let q = supabase.from('projects').select(SELECT);
  if (params?.status) q = q.eq('status', params.status);
  if (params?.pmId) q = q.eq('project_manager_id', params.pmId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProjectWithRefs[];
}
```
> NOTE for implementer: the test mocks `from().select()` returning a thenable; when `params` are passed,
> chain `.eq()` — keep the test's no-param path returning from `select()` directly. If the real builder
> requires `.eq` to be chainable in tests, extend the mock to return `{ eq: () => ({ ... }) }`; the
> no-param assertions above stay valid.
**Verify (green):** `npm test -- src/lib/db/projects.test.ts` passes; `npm run typecheck` clean.

---

## Task 3 — `src/lib/db/companies.ts`: `listClientCompanies()`  *(FR-DAL-005)*
**Test first** — create `pmo-portal/src/lib/db/companies.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const eq = vi.fn();
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));
import { listClientCompanies } from './companies';
beforeEach(() => { from.mockClear(); select.mockClear(); eq.mockReset(); });

describe('listClientCompanies', () => {
  it("selects companies where type = 'Client' (FR-DAL-005)", async () => {
    eq.mockResolvedValue({ data: [{ id: 'c…2', name: 'Innovate Corp', type: 'Client' }], error: null });
    const result = await listClientCompanies();
    expect(from).toHaveBeenCalledWith('companies');
    expect(eq).toHaveBeenCalledWith('type', 'Client');
    expect(result[0].name).toBe('Innovate Corp');
  });
  it('throws on error', async () => {
    eq.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(listClientCompanies()).rejects.toThrow('boom');
  });
});
```
**Run (red):** `npm test -- src/lib/db/companies.test.ts` → fails.
**Then create** `pmo-portal/src/lib/db/companies.ts`:
```ts
import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type CompanyRow = Tables<'companies'>;

/** Client companies in the caller's org (for the client filter dropdown). RLS scopes org. */
export async function listClientCompanies(): Promise<CompanyRow[]> {
  const { data, error } = await supabase.from('companies').select('*').eq('type', 'Client');
  if (error) throw new Error(error.message);
  return data ?? [];
}
```
**Verify (green):** `npm test -- src/lib/db/companies.test.ts` passes; `npm run typecheck` clean.

---

## Task 4 — `src/lib/db/profiles.ts`: `listProjectManagers()`  *(FR-DAL-005, OD-2)*
**Test first** — create `pmo-portal/src/lib/db/profiles.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const eq = vi.fn();
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));
import { listProjectManagers } from './profiles';
beforeEach(() => { from.mockClear(); select.mockClear(); eq.mockReset(); });

describe('listProjectManagers', () => {
  it("selects profiles where role = 'Project Manager' (FR-DAL-005, OD-2)", async () => {
    eq.mockResolvedValue({ data: [{ id: '…a2', full_name: 'Alice Manager', role: 'Project Manager' }], error: null });
    const result = await listProjectManagers();
    expect(from).toHaveBeenCalledWith('profiles');
    expect(eq).toHaveBeenCalledWith('role', 'Project Manager');
    expect(result[0].full_name).toBe('Alice Manager');
  });
  it('throws on error', async () => {
    eq.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(listProjectManagers()).rejects.toThrow('boom');
  });
});
```
**Run (red):** `npm test -- src/lib/db/profiles.test.ts` → fails.
**Then create** `pmo-portal/src/lib/db/profiles.ts`:
```ts
import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type ProfileRow = Tables<'profiles'>;

/** Profiles eligible for the PM filter (role = 'Project Manager'; OD-2). RLS scopes org. */
export async function listProjectManagers(): Promise<ProfileRow[]> {
  const { data, error } = await supabase.from('profiles').select('*').eq('role', 'Project Manager');
  if (error) throw new Error(error.message);
  return data ?? [];
}
```
**Verify (green):** `npm test -- src/lib/db/profiles.test.ts` passes; `npm run typecheck` clean.

---

## Task 5 — `QueryClient` + provider at app root  *(FR-QRY-001, ADR-0005)*
**File (create):** `pmo-portal/src/lib/queryClient.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';

// Shared singleton (ADR-0005, target-arch §9): lists are fresh ~30s, kept 5m, retry once.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 300_000, retry: 1, refetchOnWindowFocus: false },
  },
});
```
**File (edit):** `pmo-portal/App.tsx`. Add import at top (after line 1):
```ts
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/src/lib/queryClient';
```
Wrap the existing `<AuthProvider>` tree in `App` (the `return (` block, lines 58–68) so the outermost
element becomes `QueryClientProvider`:
```tsx
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/*" element={<Shell />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
```
**Verify:** `npm run typecheck` clean; `npm run build` succeeds (provider resolves). No new test (wiring
is exercised by Task 7's component test, which mounts its own `QueryClientProvider`).

---

## Task 6 — `useProjects()` + filter-source hooks  *(FR-QRY-002, FR-PROJ-001)*
**Test first** — create `pmo-portal/src/hooks/useProjects.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/projects', () => ({
  listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'X', client: null, pm: null }]),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProjects } from './useProjects';
import { listProjects } from '@/src/lib/db/projects';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useProjects', () => {
  it("keys by ['projects', orgId] and returns rows (FR-QRY-002, FR-PROJ-001)", async () => {
    const { result } = renderHook(() => useProjects(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('X');
    expect(listProjects).toHaveBeenCalled();
  });
});
```
**Run (red):** `npm test -- src/hooks/useProjects.test.tsx` → fails.
**Then create** `pmo-portal/src/hooks/useProjects.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { listProjects, type ProjectWithRefs } from '@/src/lib/db/projects';
import { listClientCompanies, type CompanyRow } from '@/src/lib/db/companies';
import { listProjectManagers, type ProfileRow } from '@/src/lib/db/profiles';
import { useAuth } from '@/src/auth/useAuth';

/** Org-scoped project list. queryKey includes org_id so cache is tenant-scoped (FR-QRY-002). */
export function useProjects() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProjectWithRefs[]>({
    queryKey: ['projects', orgId],
    queryFn: () => listProjects(),
    enabled: Boolean(orgId),
  });
}

export function useClientCompanies() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CompanyRow[]>({
    queryKey: ['companies', 'client', orgId],
    queryFn: () => listClientCompanies(),
    enabled: Boolean(orgId),
  });
}

export function useProjectManagers() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProfileRow[]>({
    queryKey: ['profiles', 'pm', orgId],
    queryFn: () => listProjectManagers(),
    enabled: Boolean(orgId),
  });
}
```
**Verify (green):** `npm test -- src/hooks/useProjects.test.tsx` passes; `npm run typecheck` clean.

---

## Task 7 — Swap `pages/Projects.tsx` to real data; loading/empty/error; real "My Projects"  *(AC-401..AC-406, AC-408; FR-PROJ-001..007, FR-FMT-001)*
This is the largest slice. The implementer rewrites `pages/Projects.tsx` to source rows from
`useProjects()` and remove `mockData`/`mockUserForRole`. Component tests are written first.

**Test first** — create `pmo-portal/pages/Projects.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import Projects from './Projects';

const seed = [
  { id: 'p1', name: 'Innovate Corp HQ Fit-Out', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, budget: 4700000,
    spent: 2100000, end_date: '2026-12-18', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' } },
  { id: 'p2', name: 'Northwind ERP Rollout', status: 'Tender Submitted',
    client_id: 'c3', project_manager_id: 'u-alice', contract_value: 1200000, budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Northwind Manufacturing' }, pm: { full_name: 'Alice Manager' } },
  { id: 'p3', name: 'Regional Services Program', status: 'PQ Submitted',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 800000, budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' } },
];

const projectsState = { data: seed, isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager' }) }));

const renderPage = () => render(<MemoryRouter><Projects /></MemoryRouter>);

describe('Projects (real data)', () => {
  it('renders seeded projects with joined client + PM names (AC-401)', () => {
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getAllByText('Innovate Corp').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Alice Manager').length).toBeGreaterThan(0);
  });

  it('filters to Leads tab (AC-403)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Leads/ }));
    expect(screen.getByText('Regional Services Program')).toBeInTheDocument();
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
  });

  it('filters by search (AC-404)', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Search projects/i), 'Northwind');
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
  });

  it('"My Projects" uses the real profile id (AC-402)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /My Projects/ }));
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument(); // u-alice manages all
  });
});

describe('Projects states', () => {
  it('shows loading state while pending (AC-405)', () => {
    projectsState.isPending = true; projectsState.isError = false;
    renderPage();
    expect(screen.getByTestId('projects-loading')).toBeInTheDocument();
    projectsState.isPending = false;
  });
  it('shows error state with retry on failure (AC-408)', () => {
    projectsState.isError = true; projectsState.isPending = false;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    projectsState.isError = false;
  });
  it('shows empty state when zero rows (AC-406)', () => {
    projectsState.data = [];
    renderPage();
    expect(screen.getByText(/No projects found/i)).toBeInTheDocument();
    projectsState.data = seed;
  });
});
```
**Run (red):** `npm test -- pages/Projects.test.tsx` → fails (page still on mockData; no states/testids).

**Then rewrite** `pmo-portal/pages/Projects.tsx` with these exact changes (full rewrite; preserves all
existing JSX/markup except the data source and the new state branches):
1. **Remove** imports: `import { projects, companies, users } from '../data/mockData';` and
   `import { mockUserForRole } from '@/src/auth/mockUserForRole';`. **Keep** `ProjectStatus` from
   `'../types'` (status strings match the DB enum) and the badge/kanban imports.
2. **Add** imports:
   ```ts
   import { useProjects, useClientCompanies, useProjectManagers } from '@/src/hooks/useProjects';
   import { useAuth } from '@/src/auth/useAuth';
   import { formatCurrency } from '@/src/lib/format';
   import type { ProjectWithRefs } from '@/src/lib/db/projects';
   ```
3. **Replace** the identity lines (`useEffectiveRole` + `mockUserForRole`) with:
   ```ts
   const { currentUser } = useAuth();
   const { data: projectsData, isPending, isError, refetch } = useProjects();
   const { data: clientCompanies = [] } = useClientCompanies();
   const { data: projectManagers = [] } = useProjectManagers();
   const allProjects = projectsData ?? [];
   ```
4. **Delete** the local `const formatCurrency = ...` line (now imported; FR-FMT-001).
5. **Rewrite filtering** to operate on `allProjects: ProjectWithRefs[]` using string ids:
   - `My Projects`: `p.project_manager_id === currentUser?.id` (FR-PROJ-005).
   - Status tabs: compare `p.status` against the same `ProjectStatus` groups (values match enum strings).
   - Client filter: `p.client_id === filterClient` (filterClient is a uuid string; default `'All'`).
   - PM filter: `p.project_manager_id === filterPM` (uuid string; default `'All'`).
   - Search: `p.name`/`p.code` (use `(p.code ?? '').toLowerCase()` since `id` is now a uuid, not `P001`).
6. **Joined names** (FR-PROJ-007, F-7): render `project.client?.name ?? 'Unknown Client'` and
   `project.pm?.full_name ?? 'Unassigned'` — delete both `.find()` lookups in Grid and List views.
7. **Money/date fields:** use snake_case row fields — `project.contract_value`, `project.budget`,
   `project.spent`, `project.end_date` (guard `end_date` may be null: `project.end_date ? new
   Date(project.end_date).toLocaleDateString() : '—'`).
8. **Tab counts / dropdowns:** counts computed from `allProjects`; client `<select>` options from
   `clientCompanies` (`value={c.id}`), PM `<select>` options from `projectManagers`
   (`value={u.id}`, label `u.full_name`).
9. **State branches** — at the top of the returned JSX body (before the header or wrapping
   `renderContent()`), add, in order:
   ```tsx
   if (isPending) {
     return <div data-testid="projects-loading" className="animate-pulse space-y-4">
       <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {[0,1,2].map(i => <div key={i} className="h-48 bg-gray-200 dark:bg-gray-700 rounded-xl" />)}
       </div>
     </div>;
   }
   if (isError) {
     return <div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
       <h3 className="text-lg font-medium text-gray-900 dark:text-white">Couldn't load projects</h3>
       <p className="mt-1 text-gray-500 dark:text-gray-400">Something went wrong fetching your projects.</p>
       <button onClick={() => refetch()} className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm">Retry</button>
     </div>;
   }
   ```
   The existing empty-state block (`sortedProjects.length === 0`) stays and now satisfies AC-406/FR-PROJ-004.
10. **Kanban/badge adapter:** `ProjectKanbanBoard` expects the prototype `Project[]` (numeric ids). For
    this issue pass `projects={filteredProjects as unknown as Project[]}` — kanban only reads
    `status`/`name`/`id` for display and `id` is used as a React key + nav target; navigation by uuid
    still routes to `/projects/:projectId` (ProjectDetails stays on mock data this issue, so the detail
    page is unaffected). Keep `import { Project } from '../types'` for this cast. `ProjectStatusBadge`
    takes `status={project.status}` directly (string matches enum).

**Verify (green):**
```
npm test -- pages/Projects.test.tsx
npm run typecheck
```
Both clean. Then run the full suite + lint:
```
npm test
npm run lint
```

---

## Task 8 — Delete the `mockUserForRole` bridge for Projects  *(cleanup, FR-PROJ-005)*
The bridge is now unused by Projects. Confirm no other importers remain before removing.
**Do:** search for remaining importers:
```
npx grep -rn "mockUserForRole" pmo-portal/pages pmo-portal/components || true
```
(Use the repo search tool.) If **only** `Procurement`/`Timesheets`/`Dashboard`/`SalesPipeline` still
import it (expected — they stay on mock data this issue), **leave the file in place** and do nothing
further. If **no** importers remain, delete `pmo-portal/src/auth/mockUserForRole.ts` and
`pmo-portal/src/auth/mockUserForRole.test.ts`.
**Verify:** `npm run typecheck` clean; `npm test` green either way.
> NOTE: Director expects other pages still use the bridge, so the likely outcome is "leave in place".
> This task only guarantees Projects no longer references it (asserted by Task 7's rewrite removing the import).

---

## Task 9 — e2e: real login → projects flow  *(AC-401, AC-402, AC-403, AC-404, AC-407)*
Requires the local Supabase stack (`supabase start` + `supabase db reset` to apply migrations+seed) and
`npm run dev` (or `npm run preview`) running. CI e2e remains deferred (OD-4).

**Pre-req file (create if absent):** `pmo-portal/playwright.config.ts` — minimal config:
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../e2e',
  use: { baseURL: 'http://localhost:3000' },
});
```
**Create** `e2e/AC-401-projects-real-data.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

async function login(page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill('Passw0rd!dev');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/');
}

test('AC-401 PM sees real seeded projects with client+PM names', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
  await expect(page.getByText('Northwind ERP Rollout')).toBeVisible();
  await expect(page.getByText('Regional Services Program')).toBeVisible();
  await expect(page.getByText('Innovate Corp').first()).toBeVisible();
  await expect(page.getByText('Alice Manager').first()).toBeVisible();
});

test('AC-403 Leads tab filters to PQ/Tender pipeline rows', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await page.getByRole('button', { name: /Leads/ }).click();
  await expect(page.getByText('Regional Services Program')).toBeVisible();
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toHaveCount(0);
});

test('AC-404 search filters real rows', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await page.getByPlaceholder(/Search projects/i).fill('Northwind');
  await expect(page.getByText('Northwind ERP Rollout')).toBeVisible();
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toHaveCount(0);
});
```
**Create** `e2e/AC-402-my-projects-real-id.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { login } from './_helpers'; // OR inline the login helper as above

test('AC-402 My Projects shows PM-owned for Alice, empty for Dave', async ({ page }) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');
  await page.getByRole('button', { name: /My Projects/ }).click();
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();

  await page.goto('/login'); // sign out path or reuse login as engineer
  await login(page, 'engineer@acme.test');
  await page.goto('/projects');
  await page.getByRole('button', { name: /My Projects/ }).click();
  await expect(page.getByText(/No projects found/i)).toBeVisible();
});
```
**Create** `e2e/AC-407-engineer-rls-read.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('AC-407 Engineer reads all org projects (RLS read path)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('engineer@acme.test');
  await page.getByLabel(/password/i).fill('Passw0rd!dev');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/');
  await page.goto('/projects');
  await expect(page.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
  await expect(page.getByText('Northwind ERP Rollout')).toBeVisible();
  await expect(page.getByText('Regional Services Program')).toBeVisible();
});
```
> NOTE for implementer: factor the `login` helper into `e2e/_helpers.ts` and import it (the AC-402 file
> assumes it). Adjust the `getByLabel`/`getByRole` selectors to match `src/auth/LoginPage.tsx`'s actual
> labels/button text — read that file and align selectors before running.
**Verify (local stack up):**
```
cd pmo-portal && npx playwright test
```
Expect AC-401/402/403/404/407 specs green. (AC-405/406/408 are covered by Task 7 component tests — they
need no stack and stay in Vitest.)

---

## Task 10 — Full-suite gate  *(all ACs)*
**Do:** from `pmo-portal/`:
```
npm run typecheck && npm run lint && npm test
```
**Verify:** typecheck 0 errors, lint clean, all Vitest specs green (format, projects db, companies,
profiles, useProjects, Projects page + states). e2e (Task 9) runs separately against the local stack.

---

## AC → Task coverage map
| AC | Covered by |
|---|---|
| AC-401 | Task 7 (component) + Task 9 (e2e) |
| AC-402 | Task 7 (component) + Task 9 (e2e) |
| AC-403 | Task 7 (component) + Task 9 (e2e) |
| AC-404 | Task 7 (component) + Task 9 (e2e) |
| AC-405 | Task 7 (component, `projects-loading`) |
| AC-406 | Task 7 (component, empty state) |
| AC-407 | Task 9 (e2e, Engineer RLS read) |
| AC-408 | Task 7 (component, error+Retry) |
| AC-409 | Task 2 (`listProjects` unit) |
| AC-410 | Task 1 (`formatCurrency` unit) |

## Build order / dependencies
0 → 1 → 2 → 3 → 4 (db + format, independent of UI) → 5 (provider) → 6 (hooks, needs 2/3/4) →
7 (page, needs 1/6) → 8 (cleanup) → 9 (e2e, needs 7) → 10 (gate).
Tasks 1–4 are parallelizable; everything else is sequential.
