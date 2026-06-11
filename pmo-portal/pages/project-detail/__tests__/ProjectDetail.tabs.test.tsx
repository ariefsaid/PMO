import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * B-9 (AC-W2-IA-004): /projects/:id/:tab? symmetric deep-link.
 * The Budget tab was the only URL-addressable tab (/projects/:id/budget); the other
 * four had no URL — an asymmetric half-applied deep-link (OUTSTANDING E2).
 *
 * Fix: generalize to /projects/:id/:tab? so all five tabs are deep-linkable
 * symmetrically. An unknown :tab defaults to overview; /budget keeps working
 * (backward-compat).
 *
 * Owning layer: component (RTL) — AC-W2-IA-004.
 */

// Minimal mocks — we only need the tab-selection logic, not the real data.
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
// Stub the tab content components so we only test tab selection, not data.
vi.mock('../tabs/OverviewTab', () => ({ default: () => <div data-testid="tab-overview">Overview</div> }));
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div data-testid="tab-budget">Budget</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div data-testid="tab-procurement">Procurement</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div data-testid="tab-tasks">Tasks</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div data-testid="tab-documents">Documents</div> }));
vi.mock('../PipelineLens', () => ({ default: () => <div>Pipeline</div> }));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('../ProjectDetailHeader', () => ({
  default: () => <div>Header</div>,
  // Re-export the predicate so ProjectDetail.tsx's import of hasFinanceView resolves.
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

describe('ProjectDetail — tab deep-link symmetry (B-9, AC-W2-IA-004)', () => {
  it('AC-W2-IA-004: /projects/:id (no tab) defaults to the Overview tab', () => {
    renderAt('/projects/p1');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/budget pre-selects the Budget tab (backward-compat)', () => {
    renderAt('/projects/p1/budget');
    expect(screen.getByTestId('tab-budget')).toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/procurement pre-selects the Procurement tab', () => {
    renderAt('/projects/p1/procurement');
    expect(screen.getByTestId('tab-procurement')).toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/tasks pre-selects the Tasks tab', () => {
    renderAt('/projects/p1/tasks');
    expect(screen.getByTestId('tab-tasks')).toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/documents pre-selects the Documents tab', () => {
    renderAt('/projects/p1/documents');
    expect(screen.getByTestId('tab-documents')).toBeInTheDocument();
  });

  it('AC-W2-IA-004: an unknown tab falls back to Overview (no crash)', () => {
    renderAt('/projects/p1/unknown-tab');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
  });
});
