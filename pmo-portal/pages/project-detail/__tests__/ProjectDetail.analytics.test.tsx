import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

// project_tab_viewed (2026-07-13 wiring plan) — ProjectDetail's `setTab` is the single
// boundary for every tab switch (URL-param deep-links AND clicks land on the same fn).

const analytics = vi.hoisted(() => ({ trackProjectTabViewed: vi.fn() }));
vi.mock('@/src/lib/analytics', () => ({ trackProjectTabViewed: analytics.trackProjectTabViewed }));

const projData = [
  {
    id: 'p1',
    name: 'Innovate HQ',
    status: 'Ongoing Project',
    budget: 100000,
    spent: 0,
    archived_at: null,
    created_at: '',
    last_update: '',
    org_id: 'o1',
    contract_value: 200000,
    win_probability: 1,
    stage_id: null,
    code: null,
    customer_contract_ref: null,
    client: null,
    client_id: null,
    project_manager_id: null,
    pm: null,
  },
];

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: projData, isPending: false }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isError: false,
    error: null,
    isPending: false,
  }),
}));
vi.mock('../tabs/OverviewTab', () => ({ default: () => <div data-testid="tab-overview">Overview</div> }));
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div data-testid="tab-budget">Budget</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div data-testid="tab-procurement">Procurement</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div data-testid="tab-tasks">Tasks</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div data-testid="tab-documents">Documents</div> }));
vi.mock('../PipelineLens', () => ({ default: () => <div>Pipeline</div> }));
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('../ProjectDetailHeader', () => ({
  default: () => <div>Header</div>,
  hasFinanceView: (role: string | null): boolean => {
    if (!role) return false;
    return ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(role);
  },
}));

import ProjectDetail from '../ProjectDetail';

const renderAt = (path: string) =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/projects/:projectId/:tab?" element={<ProjectDetail />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  analytics.trackProjectTabViewed.mockClear();
});

describe('ProjectDetail: project_tab_viewed fires when a tab is switched (2026-07-13 wiring plan)', () => {
  it('AC: clicking the Budget tab fires trackProjectTabViewed("budget") via the facade', () => {
    renderAt('/projects/p1');
    fireEvent.click(screen.getByRole('tab', { name: 'Budget' }));
    expect(analytics.trackProjectTabViewed).toHaveBeenCalledWith('budget');
  });

  it('AC: clicking the Documents tab fires trackProjectTabViewed("documents")', () => {
    renderAt('/projects/p1');
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(analytics.trackProjectTabViewed).toHaveBeenCalledWith('documents');
  });

  it('does not fire on initial mount — only on an actual tab switch', () => {
    renderAt('/projects/p1/budget');
    expect(analytics.trackProjectTabViewed).not.toHaveBeenCalled();
  });
});
