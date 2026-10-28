import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

/**
 * SEC-RS-3 — a project's month-end percent complete is recorded from its Contract & billing tab
 * (it was reachable only from the Finance management pack). Gated by `projectProgress.edit`
 * on the real role: Finance rank on any project, or the project's own PM.
 */
const h = vi.hoisted(() => ({
  role: 'Project Manager' as string,
  userId: 'u-pm',
  boq: [] as unknown[],
  recordProgress: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1', role: h.role } }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: true, loadOptions: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({ useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useRevenueRouteReady: () => true }));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useProjectBilling: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useBoqItems: () => ({ data: h.boq, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectClaims: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProgressBillingMutations: () => ({}),
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectDrawdown: () => ({ data: { committed: 0, draft: 0, ceiling: 1_000_000, currency: 'IDR', basis: 'net' }, isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderMutations: () => ({}),
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({
  useWorkOrderLines: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectWorkOrderLines: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderAcceptances: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderAcceptanceMutations: () => ({}),
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useRecordProjectProgress: () => ({ mutateAsync: h.recordProgress, isPending: false }),
}));
import WorkOrdersTab from '../tabs/WorkOrdersTab';

function renderTab(over: { projectManagerId?: string | null; projectStatus?: string | null } = {}) {
  render(
    <MemoryRouter>
      <ToastProvider>
        <WorkOrdersTab projectId="p1" currency="IDR" clientId="c1" projectName="Harbour survey"
          projectManagerId={over.projectManagerId === undefined ? 'u-pm' : over.projectManagerId}
          projectStatus={over.projectStatus === undefined ? 'Ongoing Project' : over.projectStatus} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  h.role = 'Project Manager';
  h.userId = 'u-pm';
  h.boq = [];
  h.recordProgress = vi.fn().mockResolvedValue(undefined);
});

describe('SEC-RS-3: Record progress (month-end percent complete) on the Contract & billing tab', () => {
  it('SEC-RS-3: the project\'s own PM records this month\'s percent complete', async () => {
    const user = renderTab();

    await user.click(screen.getByRole('button', { name: 'Record progress' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Harbour survey')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Percent complete to date/), '42.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save progress' }));

    await waitFor(() => expect(h.recordProgress).toHaveBeenCalledTimes(1));
    expect(h.recordProgress).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', pctComplete: 42.5 }));
  });

  it('SEC-RS-3: an Engineer is not offered Record progress', () => {
    h.role = 'Engineer'; h.userId = 'u-eng';
    renderTab();
    expect(screen.queryByRole('button', { name: 'Record progress' })).toBeNull();
  });

  it('SEC-RS-3: a PM who does not manage the project is not offered Record progress', () => {
    h.userId = 'u-other-pm';
    renderTab();
    expect(screen.queryByRole('button', { name: 'Record progress' })).toBeNull();
  });

  it('SEC-RS-3: Finance may record progress on any project', () => {
    h.role = 'Finance'; h.userId = 'u-fin';
    renderTab({ projectManagerId: 'u-pm' });
    expect(screen.getByRole('button', { name: 'Record progress' })).toBeInTheDocument();
  });

  it('SEC-RS-3: progress is not offered on a closed project', () => {
    renderTab({ projectStatus: 'Completed' });
    expect(screen.queryByRole('button', { name: 'Record progress' })).toBeNull();
  });
});
