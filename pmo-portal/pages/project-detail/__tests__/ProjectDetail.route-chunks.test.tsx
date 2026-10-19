import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { describe, expect, it, vi } from 'vitest';

const routeChunkState = vi.hoisted(() => {
  let finishTasks: (() => void) | undefined;
  let tasksReady = false;
  let taskActionClicks = 0;
  const tasksContent = new Promise<void>((resolve) => {
    finishTasks = () => {
      tasksReady = true;
      resolve();
    };
  });
  return {
    loads: {
      overview: 0,
      budget: 0,
      procurement: 0,
      tasks: 0,
      workOrders: 0,
      billing: 0,
      documents: 0,
    },
    tasksContent,
    isTasksReady: () => tasksReady,
    finishTasks: () => finishTasks?.(),
    clickTaskAction: () => { taskActionClicks += 1; },
    taskActionClicks: () => taskActionClicks,
  };
});

vi.mock('../tabs/OverviewTab', () => {
  routeChunkState.loads.overview += 1;
  return { default: () => <div data-testid="tab-overview">Overview panel</div> };
});
vi.mock('../tabs/BudgetTab', () => {
  routeChunkState.loads.budget += 1;
  return { default: () => <div data-testid="tab-budget">Budget panel</div> };
});
vi.mock('../tabs/ProcurementTab', () => {
  routeChunkState.loads.procurement += 1;
  return { default: () => <div data-testid="tab-procurement">Procurement panel</div> };
});
vi.mock('../tabs/TasksTab', () => {
  routeChunkState.loads.tasks += 1;
  return {
    default: () => {
      if (!routeChunkState.isTasksReady()) throw routeChunkState.tasksContent;
      return (
        <button type="button" onClick={routeChunkState.clickTaskAction}>
          Link to ClickUp
        </button>
      );
    },
  };
});
vi.mock('../tabs/WorkOrdersTab', () => {
  routeChunkState.loads.workOrders += 1;
  return { default: () => <div data-testid="tab-work-orders">Work orders panel</div> };
});
vi.mock('../tabs/BillingTab', () => {
  routeChunkState.loads.billing += 1;
  return { default: () => <div data-testid="tab-billing">Billing panel</div> };
});
vi.mock('../tabs/DocumentsTab', () => {
  routeChunkState.loads.documents += 1;
  return { default: () => <div data-testid="tab-documents">Documents panel</div> };
});

vi.mock('@/src/hooks/useProjects', () => ({
  useProject: (id: string) => ({
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    data: id === 'p1' ? {
      id: 'p1',
      name: 'Task project',
      status: 'Ongoing Project',
      budget: 100_000,
      spent: 0,
      archived_at: null,
      created_at: '',
      last_update: '',
      org_id: 'o1',
      contract_value: 200_000,
      win_probability: 1,
      stage_id: null,
      code: null,
      customer_contract_ref: null,
      client: null,
      client_id: null,
      project_manager_id: null,
      pm: null,
      currency: 'EUR',
    } : null,
  }),
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
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
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));
vi.mock('../ProjectDetailHeader', () => ({
  default: ({ onEditProject }: { onEditProject: () => void }) => (
    <header data-testid="project-detail-header">
      <button type="button" onClick={onEditProject}>Edit project</button>
    </header>
  ),
  hasFinanceView: () => true,
}));
vi.mock('../ProjectDetailRail', () => ({
  default: () => <aside data-testid="project-detail-rail" />,
  ProjectClassificationSummary: () => null,
}));
vi.mock('../PipelineLens', () => ({ default: () => null }));
vi.mock('../ProjectErpLink', () => ({ ProjectErpLink: () => null }));
vi.mock('../ProjectProfitLossSection', () => ({ default: () => null }));
vi.mock('../ProjectSCurve', () => ({ default: () => null }));
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));
vi.mock('../../../components/ProjectFormModal', () => ({
  default: () => <div role="dialog" aria-label="Edit project form" />,
}));

describe('ProjectDetail route panel loading', () => {
  it('keeps the project header and task action usable while loading only the selected panel', async () => {
    const { default: ProjectDetail } = await import('../ProjectDetail');
    expect(routeChunkState.loads).toMatchObject({
      overview: 0,
      budget: 0,
      procurement: 0,
      tasks: 0,
      workOrders: 0,
      billing: 0,
      documents: 0,
    });

    render(
      <ImpersonationProvider realRole="Project Manager">
        <MemoryRouter initialEntries={['/projects/p1/tasks']}>
          <ToastProvider>
            <Routes>
              <Route
                path="/projects/:projectId/:tab?"
                element={
                  <React.Suspense fallback={<div data-testid="whole-route-loading">Loading project</div>}>
                    <ProjectDetail />
                  </React.Suspense>
                }
              />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>,
    );

    const header = await screen.findByTestId('project-detail-header');
    const tasksTab = screen.getByRole('tab', { name: 'Tasks' });
    const taskPanel = screen.getByRole('tabpanel');
    expect(tasksTab).toHaveAttribute('aria-selected', 'true');
    expect(taskPanel).toHaveAttribute('aria-labelledby', tasksTab.id);
    expect(routeChunkState.loads.tasks).toBe(1);
    expect(routeChunkState.loads).toMatchObject({
      overview: 0,
      budget: 0,
      procurement: 0,
      workOrders: 0,
      billing: 0,
      documents: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit project' }));
    expect(await screen.findByRole('dialog', { name: 'Edit project form' })).toBeInTheDocument();
    expect(header).toBeInTheDocument();
    expect(screen.queryByTestId('whole-route-loading')).not.toBeInTheDocument();

    routeChunkState.finishTasks();
    const linkAction = await screen.findByRole('button', { name: 'Link to ClickUp' });
    fireEvent.click(linkAction);
    expect(routeChunkState.taskActionClicks()).toBe(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Billing' }));
    const billingPanel = await screen.findByTestId('tab-billing');
    expect(billingPanel).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Billing' })).toHaveAttribute('aria-selected', 'true');
    expect(routeChunkState.loads.billing).toBe(1);
    expect(routeChunkState.loads.tasks).toBe(1);
    expect(header).toBeInTheDocument();
  });
});
