import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const projectRows = [
  {
    id: 'p1', name: 'Innovate HQ', status: 'Ongoing Project', budget: 100_000, spent: 0,
    archived_at: null, created_at: '', last_update: '', org_id: 'o1', contract_value: 200_000,
    win_probability: 1, stage_id: null, code: null, customer_contract_ref: null, client: null,
    client_id: null, project_manager_id: null, pm: null, currency: 'USD',
  },
] as unknown as ProjectWithRefs[];

vi.mock('@/src/hooks/useProjects', () => ({
  useProject: (id: string) => ({
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    data: projectRows.find((project) => project.id === id) ?? null,
  }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/lib/db/opportunity', () => ({ useOpportunity: () => ({ data: undefined, isPending: false }) }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, commitmentSource: 'not-tracked' }),
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: { remaining_to_invoice: 100_000 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
const { invoiceState } = vi.hoisted(() => ({ invoiceState: { data: [] as Array<Record<string, unknown>> } }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ ...invoiceState, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProgressBilling', () => ({ useProjectBilling: () => ({ data: { contractLines: [] }, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAssignableProfiles: () => ({ data: [], isPending: false }),
  useTaskMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false }, removeDependency: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false }, setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('../tabs/BudgetTab', () => ({ default: () => <div>Budget surface</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div>Procurement surface</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div>Tasks surface</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div>Documents surface</div> }));
vi.mock('../tabs/WorkOrdersTab', () => ({
  default: ({ focusWorkOrderId }: { focusWorkOrderId?: string | null }) => (
    <div data-testid="tab-work-orders">focus:{focusWorkOrderId ?? 'none'}</div>
  ),
}));
vi.mock('../tabs/BillingTab', () => ({ default: () => <div>Billing surface</div> }));
vi.mock('../ContractCascade', () => ({
  ContractCascade: ({ children }: { children: React.ReactNode }) => <div data-testid="contract-cascade">{children}</div>,
}));
vi.mock('../ProjectDetailHeader', () => ({ default: ({ primaryAction }: { primaryAction?: React.ReactNode }) => <div>Header{primaryAction}</div>, hasFinanceView: () => true }));
vi.mock('../ProjectDetailRail', () => ({ default: () => <aside data-testid="project-detail-rail" /> }));
vi.mock('../PipelineLens', () => ({ default: () => <div data-testid="pipeline-lens" /> }));
vi.mock('../ProjectDrawdown', () => ({ default: () => null }));
vi.mock('../ProjectSCurve', () => ({ default: () => null }));
vi.mock('../ProjectAttention', () => ({ ProjectAttention: () => null }));
vi.mock('../ProjectBlocks', () => ({ CostBlock: () => null, DeliveryBlock: () => null, MoneyBlock: () => null }));
vi.mock('../ProjectActivity', () => ({ ActivityFooter: () => null, MyOpenTasks: () => null, ProjectActivity: () => null }));
vi.mock('../useProjectPosition', () => ({
  useProjectAttention: () => ({ items: [], isPending: false }),
  useOverdueReceivables: () => ({
    data: invoiceState.data.length > 0 ? { to: '/sales-invoices?project=p1&overdue=true' } : null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

import ProjectDetail from '../ProjectDetail';

const renderAt = async (path: string, role = 'Project Manager') => {
  // AreaContent reads `window.location.search` for the work-order focus. Keep the browser URL and
  // MemoryRouter entry aligned so the test exercises the browser's real query-string behavior.
  window.history.replaceState({}, '', path);
  const view = render(
    <ImpersonationProvider realRole={role as never}>
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

const selectedTabName = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;

beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(() => window.history.replaceState({}, '', '/'));

describe('ProjectDetail — section deep links (AC-W2-IA-004)', () => {
  it.each([
    ['/projects/p1', 'Overview'],
    ['/projects/p1/overview', 'Overview'],
    ['/projects/p1/budget', 'Budget'],
    ['/projects/p1/procurement', 'Procurement'],
    ['/projects/p1/tasks', 'Tasks'],
    ['/projects/p1/contract', 'Contract & billing'],
    ['/projects/p1/documents', 'Documents'],
  ])('AC-W2-IA-004: %s selects the %s section', async (path, label) => {
    await renderAt(path);
    expect(selectedTabName()).toBe(label);
    expect(screen.getByRole('tab', { name: label, selected: true })).toBeInTheDocument();
  });

  it.each(['/projects/p1/work-orders', '/projects/p1/billing'])(
    'AC-UNB-005: legacy route %s selects Contract & billing',
    async (path) => {
      await renderAt(path);
      expect(screen.getByRole('tab', { name: 'Contract & billing', selected: true })).toBeInTheDocument();
    },
  );

  it('AC-UNB-005: the legacy work-orders route still passes ?wo= through to the focused order', async () => {
    await renderAt('/projects/p1/work-orders?wo=wo-2');
    expect(screen.getByRole('tab', { name: 'Contract & billing', selected: true })).toBeInTheDocument();
    expect(screen.getByTestId('tab-work-orders')).toHaveTextContent('focus:wo-2');
  });

  it('AC-UNB-005: without ?wo= the work-orders area focuses nothing', async () => {
    await renderAt('/projects/p1/work-orders');
    expect(screen.getByRole('tab', { name: 'Contract & billing', selected: true })).toBeInTheDocument();
    expect(screen.getByTestId('tab-work-orders')).toHaveTextContent('focus:none');
  });

  it('AC-W2-IA-004: an unknown tab falls back to Overview without a crash', async () => {
    await renderAt('/projects/p1/unknown-tab');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  });

  it('scrolls the selected project tab into view on mount and after a tab change', async () => {
    // jsdom has no layout: place every tab past the strip's right edge so the selected one must be scrolled to.
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isTab = this.getAttribute('role') === 'tab';
      return { left: isTab ? 400 : 0, right: isTab ? 480 : 300, top: 0, bottom: 32, width: isTab ? 80 : 300, height: 32, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    const scrollBySpy = vi.fn();
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: scrollBySpy });
    try {
      await renderAt('/projects/p1/tasks');
      await waitFor(() => expect(scrollBySpy).toHaveBeenCalledWith(expect.objectContaining({ left: 180 })));

      scrollBySpy.mockClear();
      fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Documents' })).toHaveAttribute('aria-selected', 'true'));
      await waitFor(() => expect(scrollBySpy).toHaveBeenCalledWith(expect.objectContaining({ left: 180 })));
      // Only the strip scrolls horizontally; the page never scrolls.
      expect(scrollBySpy.mock.calls.every(([arg]) => !('top' in arg))).toBe(true);
      expect(pageScroll).not.toHaveBeenCalled();
    } finally {
      rectSpy.mockRestore();
      pageScroll.mockRestore();
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollBy;
    }
  });

  it.each(['/projects/p1/budget', '/projects/p1/contract', '/projects/p1/billing'])(
    'AC-PB-008: an Engineer deep-link to %s falls back to Overview',
    async (path) => {
      await renderAt(path, 'Engineer');
      expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Budget' })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Contract & billing' })).not.toBeInTheDocument();
    },
  );
});

describe('ProjectDetail — primary action scope', () => {
  it.each(['/projects/p1/budget', '/projects/p1/procurement', '/projects/p1/tasks', '/projects/p1/documents'])(
    'does not pin the invoice action to %s', async (path) => {
      await renderAt(path, 'Finance');
      expect(screen.queryByRole('button', { name: 'Raise invoice' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Chase payment' })).not.toBeInTheDocument();
    },
  );

  it('keeps the primary action on Overview and limits Contract & billing to Chase payment', async () => {
    invoiceState.data = [{
      id: 'inv-1', status: 'Submitted', invoice_date: '2026-10-01', erp_due_date: '2026-10-20',
      erp_payment_terms_days: 30, erp_outstanding_amount: '500',
    }];
    const overview = await renderAt('/projects/p1', 'Finance');
    const overviewActions = screen.getAllByRole('button', { name: 'Chase payment' });
    expect(overviewActions).toHaveLength(2);
    expect(overviewActions.some((button) => button.closest('[data-mobile-action-bar]'))).toBe(true);
    expect(overviewActions.some((button) => button.closest('span.hidden.md\\:inline-flex'))).toBe(true);
    overview.unmount();

    await renderAt('/projects/p1/contract', 'Finance');
    expect(screen.getAllByRole('button', { name: 'Chase payment' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).not.toBeInTheDocument();
  });
});
