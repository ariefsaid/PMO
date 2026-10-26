import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
vi.mock('@/pages/project-detail/ProjectFinancesSection', () => ({ ProjectFinancesSection: () => null }));
// ProjectErpLink reads the org's ERP binding through react-query; it has its own test (AC-SETUP-001).
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

// Minimal mocks — this suite proves URL section selection and navigation context.
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
// Stub the section content components so this suite stays focused on route behavior.
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

const RouteLocation = () => {
  const { pathname, search, hash, state } = useLocation();
  return <output data-testid="route-location" data-state={JSON.stringify(state)}>{`${pathname}${search}${hash}`}</output>;
};

const renderAt = async (path: string | { pathname: string; search?: string; hash?: string; state?: unknown }) => {
  const view = render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/projects/:projectId/:tab?" element={<ProjectDetail />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
          </Routes>
          <RouteLocation />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );
  await waitFor(() => expect(screen.queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument());
  return view;
};

describe('ProjectDetail — section deep-link behavior (B-9, AC-W2-IA-004)', () => {
  it('AC-W2-IA-004: /projects/:id (no section) defaults to Overview', async () => {
    await renderAt('/projects/p1');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('AC-009 support: Overview mounts project totals once', async () => {
    await renderAt('/projects/p1/overview');
    const totals = screen.getByTestId('project-profit-loss');
    expect(totals).toHaveTextContent('Project totals p1');
    expect(screen.getAllByTestId('project-profit-loss')).toHaveLength(1);
  });

  it('AC-009 support: other tabs and an unavailable project do not mount project totals', async () => {
    const { unmount } = await renderAt('/projects/p1/budget');
    expect(screen.queryByTestId('project-profit-loss')).not.toBeInTheDocument();
    unmount();
    await renderAt('/projects/missing/overview');
    expect(screen.queryByTestId('project-profit-loss')).not.toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/budget selects Budget (backward-compatible URL)', async () => {
    await renderAt('/projects/p1/budget');
    expect(screen.getByTestId('tab-budget')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page');
  });

  it('AC-W2-IA-004: /projects/:id/procurement selects Procurement', async () => {
    await renderAt('/projects/p1/procurement');
    expect(screen.getByTestId('tab-procurement')).toBeInTheDocument();
  });

  it('AC-W2-IA-004: /projects/:id/tasks selects Tasks', async () => {
    await renderAt('/projects/p1/tasks');
    expect(screen.getByTestId('tab-tasks')).toBeInTheDocument();
  });

  it('AC-PD-NAV-01: named project sections expose the target groups and navigate without dropping URL state', async () => {
    await renderAt('/projects/p1/tasks?view=timeline&sort=due#task-7');

    const navigation = screen.getByRole('navigation', { name: 'Project sections' });
    expect(screen.getByRole('complementary', { name: 'Project sections' })).toContainElement(navigation);
    const groups = within(navigation).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Overview',
      'Delivery',
      'Money',
      'Evidence',
    ]);
    expect(within(groups[1]).getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(within(groups[2]).getByRole('link', { name: 'Budget' }));

    expect(await screen.findByTestId('tab-budget')).toBeInTheDocument();
    expect(screen.getByTestId('route-location')).toHaveTextContent(
      '/projects/p1/budget?view=timeline&sort=due#task-7',
    );
  });

  it('AC-PD-NAV-02: the phone section sheet closes on Escape and restores focus to its trigger', async () => {
    await renderAt('/projects/p1/overview');
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Project sections' });

    await user.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Project sections' });
    expect(sheet).toBeVisible();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Project sections' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('AC-W2-IA-004: /projects/:id/documents selects Documents', async () => {
    await renderAt('/projects/p1/documents');
    expect(screen.getByTestId('tab-documents')).toBeInTheDocument();
  });

  it('AC-PB-008: /projects/:id/billing selects Billing for an eligible reader', async () => {
    await renderAt('/projects/p1/billing');
    expect(screen.getByTestId('tab-billing')).toBeInTheDocument();
  });

  it('AC-PB-008: an Engineer deep link returns to Tasks and exposes no Billing link', async () => {
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
    expect(screen.getByTestId('tab-tasks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
  });

  it('AC-W2-IA-004: an unknown section falls back to Overview (no crash)', async () => {
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

  it('AC-LRC-003: a section change preserves list-return state, query, and hash', async () => {
    const capturedState = { pmoListReturn: { list: 'projects' as const, path: '/projects?filter=Ongoing' } };
    await renderAt({
      pathname: '/projects/p1/overview',
      search: '?view=table',
      hash: '#position',
      state: capturedState,
    });
    fireEvent.click(screen.getByRole('link', { name: 'Procurement' }));

    expect(await screen.findByTestId('tab-procurement')).toBeInTheDocument();
    expect(screen.getByTestId('route-location')).toHaveTextContent('/projects/p1/procurement?view=table#position');
    expect(screen.getByTestId('route-location').getAttribute('data-state')).toContain('"pmoListReturn"');
    expect(screen.getByTestId('route-location').getAttribute('data-state')).toContain('"pmoTabSwitch":true');
  });
});
