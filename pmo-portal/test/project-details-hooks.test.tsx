import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import React, { useEffect } from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectDetail from '../pages/project-detail/ProjectDetail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// F-1 (baseline §9): the legacy ProjectDetails ran useState AFTER an early
// `return <Navigate/>`, making a hook conditional — React surfaces this as a
// "Rendered more/fewer hooks" console.error. The decomposed ProjectDetail
// hoists every hook above the not-found guard, so navigating invalid→valid
// (fewer-hooks path → more-hooks path) on the SAME fiber must not error. AC-005.
afterEach(() => vi.restoreAllMocks());

const VALID_ID = 'p1';
const project = {
  id: VALID_ID, name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
  client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, budget: 4700000,
  spent: 2100000, start_date: '2026-01-01', end_date: '2026-12-18', contract_date: null,
  customer_contract_ref: null, client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [project], isPending: false, isError: false, refetch: vi.fn() }),
  // The detail header consumes these (Edit/Archive/contract_value SoD + the FK pickers).
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
// ADR-0016: ProjectBudget now gates write on the REAL role, so the mock supplies realRole.
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }) }));
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn() }, activate: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn() }, cloneVersion: { mutateAsync: vi.fn() },
    deleteDraft: { mutateAsync: vi.fn() }, createLineItem: { mutateAsync: vi.fn() },
    deleteLineItem: { mutateAsync: vi.fn() },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
// Model B: ProjectDetail falls back to a by-id opportunity fetch for records not in the active
// projects cache. The seed here is on-hand (cached), so it is disabled — stub it so the test
// needs no QueryClient (this test asserts hooks-order, not data fetching).
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    updateTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
// ProjectDetail + ProcurementTab no longer use the workspace tab API — they
// navigate via the real react-router (this test needs the real useNavigate for
// its NavDriver), so no shell mock is required.

function NavDriver({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(`/projects/${to}`, { replace: true });
  }, [navigate, to]);
  return null;
}

function renderAt(projectId: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/projects" element={<div>projects-list</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('ProjectDetail hooks order (F-1, AC-005)', () => {
  it('renders a valid project without a React hooks-order error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderAt(VALID_ID)).not.toThrow();
    const hooksOrderError = errorSpy.mock.calls.some((args) =>
      String(args[0]).match(/hook|order of Hooks|Rendered more|Rendered fewer/i),
    );
    expect(hooksOrderError).toBe(false);
  });

  it('does not trigger a hooks-order error when navigating from invalid to valid project id', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      render(
        <ToastProvider>
          <MemoryRouter initialEntries={['/projects/INVALID']}>
            <NavDriver to={VALID_ID} />
            <Routes>
              <Route path="/projects/:projectId" element={<ProjectDetail />} />
              <Route path="/projects" element={<div>projects-list</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>,
      );
    });
    const hooksOrderError = errorSpy.mock.calls.some((args) =>
      String(args[0]).match(/hook|order of Hooks|Rendered more|Rendered fewer/i),
    );
    expect(hooksOrderError).toBe(false);
  });
});
