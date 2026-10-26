import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
vi.mock('@/pages/project-detail/ProjectFinancesSection', () => ({ ProjectFinancesSection: () => null }));
// ProjectErpLink reads the org's ERP binding through react-query; it has its own test (AC-SETUP-001).
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

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
vi.mock('../ProjectProfitLossSection', () => ({ default: ({ projectId }: { projectId: string }) => <div data-testid="project-profit-loss">Project totals {projectId}</div> }));
vi.mock('../ProjectSCurve', () => ({ default: () => <div data-testid="project-s-curve">S-curve</div> }));
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div data-testid="tab-budget">Budget</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div data-testid="tab-procurement">Procurement</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div data-testid="tab-tasks">Tasks</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div data-testid="tab-documents">Documents</div> }));
vi.mock('../tabs/BillingTab', () => ({ default: () => <div data-testid="tab-billing">Billing</div> }));
vi.mock('../tabs/WorkOrdersTab', () => ({
  default: ({ focusWorkOrderId }: { focusWorkOrderId?: string | null }) => (
    <div data-testid="tab-work-orders">{`focus:${focusWorkOrderId ?? 'none'}`}</div>
  ),
}));
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

import ProjectDetail from '../ProjectDetail';

vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => <div data-testid="project-comments" /> }));

const renderAt = async (path: string) => {
  const view = render(
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
  await waitFor(() => expect(screen.queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument());
  return view;
};

describe('ProjectDetail — tab deep-link symmetry (B-9, AC-W2-IA-004)', () => {
  it('AC-W2-IA-004: /projects/:id (no tab) defaults to the Overview tab', async () => {
    await renderAt('/projects/p1');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
  });

  it('AC-009 support: Overview mounts project totals once after OverviewTab and before S-curve/comments', async () => {
    await renderAt('/projects/p1/overview');
    const overview = screen.getByTestId('tab-overview');
    const totals = screen.getByTestId('project-profit-loss');
    const curve = screen.getByTestId('project-s-curve');
    const comments = screen.getByTestId('project-comments');
    expect(totals).toHaveTextContent('Project totals p1');
    expect(overview.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(totals.compareDocumentPosition(curve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(curve.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-009 support: other tabs and an unavailable project do not mount project totals', async () => {
    const { unmount } = await renderAt('/projects/p1/budget');
    expect(screen.queryByTestId('project-profit-loss')).not.toBeInTheDocument();
    unmount();
    await renderAt('/projects/missing/overview');
    expect(screen.queryByTestId('project-profit-loss')).not.toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/budget pre-selects the Budget tab (backward-compat)', async () => {
    await renderAt('/projects/p1/budget');
    expect(screen.getByTestId('tab-budget')).toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/procurement pre-selects the Procurement tab', async () => {
    await renderAt('/projects/p1/procurement');
    expect(screen.getByTestId('tab-procurement')).toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/tasks pre-selects the Tasks tab', async () => {
    await renderAt('/projects/p1/tasks');
    expect(screen.getByTestId('tab-tasks')).toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/documents pre-selects the Documents tab', async () => {
    await renderAt('/projects/p1/documents');
    expect(screen.getByTestId('tab-documents')).toBeInTheDocument();
  });

  it('AC-PB-008: /projects/:id/billing pre-selects the Billing tab', async () => {
    await renderAt('/projects/p1/billing');
    expect(screen.getByTestId('tab-billing')).toBeInTheDocument();
  });

  it('AC-PB-008: an Engineer has no Billing tab, even by deep link', async () => {
    render(
      <ImpersonationProvider realRole="Engineer">
        <MemoryRouter initialEntries={['/projects/p1/billing']}>
          <ToastProvider>
            <Routes>
              <Route path="/projects/:projectId/:tab?" element={<ProjectDetail />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>,
    );
    expect(screen.queryByTestId('tab-billing')).toBeNull();
  });

  it('AC-W2-IA-004: an unknown tab falls back to Overview (no crash)', async () => {
    await renderAt('/projects/p1/unknown-tab');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
  });

  it('AC-UNB-005: /projects/:id/work-orders?wo=<id> opens the Work orders tab and hands it the work order to bring into view', async () => {
    await renderAt('/projects/p1/work-orders?wo=wo-2');
    expect(screen.getByTestId('tab-work-orders')).toHaveTextContent('focus:wo-2');
  });

  it('AC-UNB-005: without ?wo= the Work orders tab focuses nothing', async () => {
    await renderAt('/projects/p1/work-orders');
    expect(screen.getByTestId('tab-work-orders')).toHaveTextContent('focus:none');
  });
});
