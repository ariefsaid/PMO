import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

/**
 * The stage-entries read the sales-history disclosure serves. AC-PERF-002 (plan 1b) asserts the
 * read fires on the disclosure OPENING — so this suite needs a supabase stub that can serve the
 * rows AND report when the read fired. Everything else on the page is disabled/mocked, so the
 * stub only ever sees the stage read.
 */
const stageStub = vi.hoisted(() => {
  const STAGE_ROWS = [
    {
      id: 'e2', project_id: 'p1', stage: 'Quotation Submitted', entered_on: '2026-10-12',
      position: 2, source: 'transition', recorded_at: '2026-10-12T03:00:00Z', redated_at: null,
      recorder: { full_name: 'Pat Manager' },
    },
    {
      id: 'e1', project_id: 'p1', stage: 'Leads', entered_on: '2026-08-01',
      position: 1, source: 'origination', recorded_at: '2026-08-01T03:00:00Z', redated_at: null,
      recorder: null,
    },
  ];
  let stageReads = 0;
  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, neq: () => b, is: () => b, in: () => b,
      order: () => b, range: () => b, limit: () => b, single: () => b, maybeSingle: () => b,
      abortSignal: () => b, throwOnError: () => b,
      then: (
        onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => {
        if (table === 'project_stage_entries') stageReads++;
        return Promise.resolve({ data: table === 'project_stage_entries' ? STAGE_ROWS : [], error: null }).then(onFulfilled, onRejected);
      },
      catch: (onRejected?: ((reason: unknown) => unknown) | null) =>
        Promise.resolve({ data: [], error: null }).catch(onRejected),
      finally: (onFinally?: (() => void) | null) => Promise.resolve({ data: [], error: null }).finally(onFinally),
    };
    return b;
  }
  const client = {
    from: (table: string) => builder(table),
    rpc: () => builder('__rpc__'),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    channel: () => ({ on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) }),
    removeChannel: () => {},
  };
  return { client, reads: () => stageReads, reset: () => { stageReads = 0; } };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: stageStub.client }));

const project = {
  id: 'p1', name: 'Innovate HQ', status: 'Ongoing Project', currency: 'USD', contract_value: 200_000,
  client_id: null, project_manager_id: null, client: null, pm: null, code: 'P-1',
} as never;

vi.mock('@/src/hooks/useProjectOverviewRead', () => ({ useProjectOverviewRead: () => ({ isLoading: false }) }));
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
vi.mock('../BillingMilestonesBlock', () => ({ BillingMilestonesBlock: () => null }));
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
vi.mock('@/src/components/history/RecordHistory', () => ({
  RecordHistory: (p: { entityType: string; entityId: string; includeChildren?: boolean; kindFilters?: boolean }) => (
    <div data-testid="record-history">{`Change history ${p.entityType}:${p.entityId}:${String(p.includeChildren)}:${String(p.kindFilters)}`}</div>
  ),
}));
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

const signedIn = {
  session: null,
  currentUser: { id: 'user-1', org_id: 'org-1', role: 'Project Manager', full_name: 'Pat Manager', manager_id: null, email: 'pm@acme.test' },
  role: 'Project Manager',
  loading: false,
  profileError: null,
  profileErrorKind: null,
  signInWithPassword: async () => ({ error: null }),
  signInWithMagicLink: async () => ({ error: null }),
  signInWithMicrosoft: async () => ({ error: null }),
  requestPasswordReset: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
  resendEmailConfirmation: async () => ({ error: null }),
  signOut: async () => undefined,
  refreshCurrentUser: async () => ({ error: null }),
} as unknown as AuthContextValue;

describe('Sales-history disclosure defers its read to opening (AC-PERF-002, plan 1b)', () => {
  it('no stage-entries read on mount; opening the disclosure loads and shows the history', async () => {
    stageStub.reset();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <AuthContext.Provider value={signedIn}>
        <ImpersonationProvider realRole="Project Manager">
          <QueryClientProvider client={client}>
            <ToastProvider>
              <MemoryRouter initialEntries={['/projects/p1']}>
                <Routes>
                  <Route path="/projects/:projectId/:tab?" element={<ProjectDetail />} />
                </Routes>
              </MemoryRouter>
            </ToastProvider>
          </QueryClientProvider>
        </ImpersonationProvider>
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(screen.getByRole('tablist', { name: /project sections/i })).toBeInTheDocument());

    // Closed disclosure: the page is mounted and settled, yet NO stage-entries read has fired.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stageStub.reads()).toBe(0);
    expect(screen.queryByRole('list', { name: /stage history/i })).not.toBeInTheDocument();

    // The user opens the disclosure: the read fires and the history renders.
    await userEvent.click(screen.getByText('Sales history'));
    const history = await screen.findByRole('list', { name: /stage history/i });
    expect(within(history).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(within(history).getAllByRole('listitem')[0]).toHaveTextContent(/Quoted/i);
    expect(stageStub.reads()).toBe(1);
  });
});

describe('ProjectDetail Activity drawer (AC-CHG-018)', () => {
  it('AC-CHG-018: the legacy /history route opens Overview with the Activity drawer open', async () => {
    await renderAt('/projects/p1/history');

    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Activity' })).toBeInTheDocument();
  });

  it('AC-CHG-018: /projects/:id/history shows the project history with child roll-up and kind filters', async () => {
    await renderAt('/projects/p1/history');
    const drawer = screen.getByRole('dialog', { name: 'Activity' });
    expect(within(drawer).getByTestId('record-history')).toHaveTextContent('project:p1:true:true');
  });

  it('AC-CHG-018: the Activity entry is keyboard-operable', async () => {
    await renderAt('/projects/p1');
    const activityLine = screen.getByRole('button', { name: /Activity · 0 comments/i });
    activityLine.focus();
    await userEvent.keyboard('{Enter}');
    const drawer = await screen.findByRole('dialog', { name: 'Activity' });
    expect(within(drawer).getByTestId('record-history')).toHaveTextContent('project:p1:true:true');
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
