import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
// ProjectErpLink reads the org's ERP binding through react-query; it has its own test (AC-SETUP-001).
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

/**
 * AC-CHG-018 — History tab. (Derived from the B-9 deep-link harness, AC-W2-IA-004): /projects/:id/:tab? symmetric deep-link.
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
  // #840: the detail route reads ONE project by id (any stage), never the whole list.
  useProject: (id: string) => {
    const l = (({ data: projData, isPending: false })) as { data?: { id: string }[] | null; isPending?: boolean; isError?: boolean; refetch?: () => void };
    return { isPending: false, isError: false, refetch: vi.fn(), ...l, data: (l.data ?? []).find((p) => p.id === id) ?? null };
  },
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
// Stub the tab content components so we only test tab selection, not data.
vi.mock('../tabs/OverviewTab', () => ({ default: () => <div data-testid="tab-overview">Overview</div> }));
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div data-testid="tab-budget">Budget</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div data-testid="tab-procurement">Procurement</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div data-testid="tab-tasks">Tasks</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div data-testid="tab-documents">Documents</div> }));
vi.mock('../tabs/BillingTab', () => ({ default: () => <div data-testid="tab-billing">Billing</div> }));
vi.mock('../PipelineLens', () => ({ default: () => <div>Pipeline</div> }));
// ProjectSCurve reads useTasks (ADR-0032) and renders inside ProjectDetail → mock it.
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
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('../ProjectDetailHeader', () => ({
  default: () => <div>Header</div>,
  // Re-export the predicate so ProjectDetail.tsx's import of hasFinanceView resolves.
  hasFinanceView: (role: string | null): boolean => {
    if (!role) return false;
    return ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(role);
  },
}));

vi.mock('@/src/components/history/RecordHistory', () => ({
  RecordHistory: (p: { entityType: string; entityId: string; includeChildren?: boolean; kindFilters?: boolean }) => (
    <div data-testid="tab-history">{`${p.entityType}:${p.entityId}:${String(p.includeChildren)}:${String(p.kindFilters)}`}</div>
  ),
}));

import ProjectDetail from '../ProjectDetail';

vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));

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

describe('ProjectDetail — History tab (AC-CHG-018)', () => {
  it('AC-CHG-018: /projects/:id/history deep-links to the History tab with child roll-up and kind filters', () => {
    renderAt('/projects/p1/history');
    expect(screen.getByTestId('tab-history')).toHaveTextContent('project:p1:true:true');
  });

  it('AC-CHG-018: the History tab is keyboard-operable and selects via the tab bar', async () => {
    renderAt('/projects/p1');
    const tab = screen.getByRole('tab', { name: 'History' });
    tab.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('tab-history')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  });
});
