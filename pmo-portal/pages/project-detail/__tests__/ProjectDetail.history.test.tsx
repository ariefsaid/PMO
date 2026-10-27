import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const project = {
  id: 'p1', name: 'Innovate HQ', status: 'Ongoing Project', currency: 'USD', contract_value: 200_000,
  client_id: null, project_manager_id: null, client: null, pm: null, code: 'P-1',
} as never;

vi.mock('@/src/hooks/useProjects', () => ({
  useProject: (id: string) => ({ data: id === 'p1' ? project : null, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/lib/db/opportunity', () => ({ useOpportunity: () => ({ data: undefined, isPending: false }) }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: undefined, isPending: false, isError: false, commitmentSource: 'unavailable' }),
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAssignableProfiles: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useComments', () => ({
  useComments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('../ProjectDetailHeader', () => ({ default: () => <div>Header</div>, hasFinanceView: () => true }));
vi.mock('../ProjectDetailRail', () => ({ default: () => <aside data-testid="project-detail-rail" /> }));
vi.mock('../ProjectAttention', () => ({ ProjectAttention: () => null }));
vi.mock('../ProjectBlocks', () => ({ CostBlock: () => null, DeliveryBlock: () => null, MoneyBlock: () => null }));
vi.mock('../ProjectDrawdown', () => ({ default: () => null }));
vi.mock('../ProjectSCurve', () => ({ default: () => null }));
vi.mock('../useProjectPosition', () => ({
  useProjectAttention: () => ({ items: [], isPending: false }),
  useOverdueReceivables: () => null,
}));
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div>Budget surface</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div>Procurement surface</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div>Tasks surface</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div>Documents surface</div> }));
vi.mock('../tabs/WorkOrdersTab', () => ({ default: () => <div>Work orders</div> }));
vi.mock('../tabs/BillingTab', () => ({ default: () => <div>Billing surface</div> }));
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => <div>Change history</div> }));
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

import ProjectDetail from '../ProjectDetail';

const renderAt = async (path: string) => {
  window.history.replaceState({}, '', path);
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
  await waitFor(() => expect(screen.getByRole('tablist', { name: /project sections/i })).toBeInTheDocument());
  return view;
};

beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(() => window.history.replaceState({}, '', '/'));

describe('ProjectDetail Activity drawer (AC-CHG-018)', () => {
  it('AC-CHG-018: the legacy /history route opens Overview with the Activity drawer open', async () => {
    await renderAt('/projects/p1/history');

    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Activity' })).toBeInTheDocument();
  });

  it('AC-CHG-018: Activity is available from Overview only and closing its drawer restores focus', async () => {
    const overviewPage = await renderAt('/projects/p1');
    const activityLine = screen.getByRole('button', { name: /Activity · 0 comments/i });
    expect(activityLine).toBeInTheDocument();

    await userEvent.click(activityLine);
    expect(screen.getByRole('dialog', { name: 'Activity' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Activity' })).not.toBeInTheDocument());
    expect(activityLine).toHaveFocus();
    overviewPage.unmount();

    const tasksPage = await renderAt('/projects/p1/tasks');
    expect(screen.getByRole('tab', { name: 'Tasks', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Activity · 0 comments/i })).not.toBeInTheDocument();
    tasksPage.unmount();
  });
});
