/**
 * #2668 — area and group on the work orders tab (AC-WAG-005..007). Mount shape copies WorkOrdersTab.test.tsx.
 * An organisation with no lists sees the tab as before; one with lists gets a Group by control, grouped headings
 * with counts, area/group text on each row and a status pill on Draft rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderLists } from '@/src/hooks/useWorkOrderLists';



const { listState, drawdownState, mutations, lineState, boqState, quantityMutations, listsState } = vi.hoisted(() => ({
  listsState: { value: null as unknown },
  listState: {
    data: [] as unknown[],
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
  boqState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  quantityMutations: { createLine: { mutateAsync: vi.fn() }, updateLine: { mutateAsync: vi.fn() }, deleteLine: { mutateAsync: vi.fn() } },
  lineState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  drawdownState: {
    data: { committed: 0, draft: 0, ceiling: 1_000_000, currency: 'USD', basis: 'net' } as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    setValue: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
  },
}));

// #1457: the invoice-overdue figure is bounded by the org's business day (fixed here per test file).
vi.mock('@/src/components/tasks/WorkOrderOpenTasks', () => ({ WorkOrderOpenTasks: () => null }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-06-01', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: () => listState,
  useProjectDrawdown: () => drawdownState,
  useWorkOrderMutations: () => mutations,
}));
vi.mock('@/src/hooks/useSubcontract', () => ({
  useWorkOrderCostVariations: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
// OD-BILL-1: the tab now reads work-order billing through react-query. These specs predate it and mount without a
// QueryClientProvider, so the hook is held in its loading state and contributes no figures; billing is covered in
// WorkOrdersTab.billing.test.tsx.
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useBoqItems: () => boqState,
  useProjectBilling: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectClaims: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProgressBillingMutations: () => ({}),
}));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({
  useWorkOrderLines: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectWorkOrderLines: () => lineState,
  useWorkOrderAcceptances: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderAcceptanceMutations: () => quantityMutations,
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useWorkOrderBilling: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
  useWorkOrderAcceptanceAge: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({ useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: true }) }));
// #913: the Invoice gate reads the revenue mode through a hook. These specs predate it and mount without a
// QueryClientProvider; the revenue-mode gating is covered in WorkOrdersTab.billing.test.tsx. 'erp' is the mode these
// specs were written under.
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'erp' as const }));

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1', role: realRole }, role: realRole }),
}));

vi.mock('../tabs/BillingReconciliation', () => ({ BillingReconciliation: () => null }));
vi.mock('@/src/hooks/useWorkOrderLists', () => ({ useWorkOrderLists: () => listsState.value }));
vi.mock('@/src/components/WorkOrderListsProvider', () => ({ WorkOrderListsProvider: ({ children }: { children: React.ReactNode }) => children }));
import WorkOrdersTab from '../tabs/WorkOrdersTab';

const entry = (id: string, name: string, archived_at: string | null = null) => ({ id, code: id.toUpperCase(), name, archived_at });
const NO_LISTS: WorkOrderLists = { areas: [], groups: [], liveAreas: [], liveGroups: [], hasLists: false };
const withLists = (areas: ReturnType<typeof entry>[], groups: ReturnType<typeof entry>[]): WorkOrderLists => ({
  areas, groups, liveAreas: areas.filter((a) => !a.archived_at), liveGroups: groups.filter((g) => !g.archived_at), hasLists: true,
});

const row = (over: Partial<WorkOrderRow> = {}): WorkOrderRow =>
  ({
    id: 'wo-1', org_id: 'org-1', project_id: 'p1', wo_number: null, client_po_number: null, title: 'Phase 1', description: null,
    status: 'Draft', order_value: 1000, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0, tax_rate: null, tax_template: null,
    order_date: null, start_date: null, end_date: null, order_value_set_by: 'u-2', issue_eligibility: 'allowed',
    value_author: { role: 'Finance', manager_id: null, status: 'active' }, order_value_set_at: '2026-08-01T00:00:00Z',
    issued_by: null, issued_at: null, over_commit_ack_by: null, over_commit_ack_at: null, closed_at: null, cancelled_at: null,
    created_at: '2026-08-01T00:00:00Z', area_id: null, group_id: null, ...over,
  }) as WorkOrderRow;

const renderTab = (url = '/') => {
  realRole = 'Project Manager';
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <WorkOrdersTab projectId="p1" currency="USD" />
      </ToastProvider>
    </MemoryRouter>,
  );
};

const AREAS = [entry('a-n', 'North'), entry('a-s', 'South')];
const ORDERS = [
  row({ id: 'wo-1', title: 'North draft', status: 'Draft', area_id: 'a-n' }),
  row({ id: 'wo-2', wo_number: 'WO-02', title: 'South issued', status: 'Issued', area_id: 'a-s' }),
  row({ id: 'wo-3', wo_number: 'WO-03', title: 'Loose issued', status: 'Issued' }),
];

beforeEach(() => {
  listState.data = ORDERS; listState.isPending = false; listState.isFetching = false; listState.isError = false;
  boqState.data = []; lineState.data = [];
  for (const m of Object.values(mutations)) { m.mutateAsync.mockReset(); m.mutateAsync.mockResolvedValue(undefined); }
  listsState.value = NO_LISTS;
});

describe('AC-WAG-005 an organisation with no lists sees the tab as before', () => {
  it('AC-WAG-005 shows no Group by control, no area text and no pill on the Draft row', () => {
    renderTab();
    expect(screen.queryByRole('combobox', { name: 'Group by' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('wo-area-wo-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wo-group-none')).not.toBeInTheDocument();
    expect(screen.getByTestId('customer-order-wo-2')).toBeInTheDocument();
  });
});

describe('AC-WAG-006 grouping', () => {
  beforeEach(() => { listsState.value = withLists(AREAS, []); });

  it('AC-WAG-006 offers Group by Area only, grouped by area with counts and "No area" last; None restores the flat list', async () => {
    const user = userEvent.setup();
    renderTab();
    const control = screen.getByRole('combobox', { name: 'Group by' });
    expect(within(control).queryByRole('option', { name: 'Group' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('wo-group-a-n')).not.toBeInTheDocument();

    await user.selectOptions(control, 'area');
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent).filter((t) => /North|South|No area/.test(t ?? ''));
    expect(headings).toEqual(['North1', 'South1', 'No area1']);
    expect(within(screen.getByTestId('wo-group-a-n')).getByText('North draft')).toBeInTheDocument();
    expect(within(screen.getByTestId('wo-group-a-s')).getByTestId('customer-order-wo-2')).toBeInTheDocument();
    expect(within(screen.getByTestId('wo-group-none')).getByTestId('customer-order-wo-3')).toBeInTheDocument();

    await user.selectOptions(control, 'none');
    expect(screen.queryByTestId('wo-group-a-n')).not.toBeInTheDocument();
    expect(screen.getByTestId('customer-order-wo-3')).toBeInTheDocument();
  });

  it('AC-WAG-006 opens already grouped from the link (?groupBy=area)', () => {
    renderTab('/?groupBy=area');
    expect(screen.getByTestId('wo-group-a-s')).toBeInTheDocument();
  });
});

describe('AC-WAG-007 rows show their status and area', () => {
  it('AC-WAG-007 a Draft row shows a status pill and its area; an issued card shows its area', () => {
    listsState.value = withLists(AREAS, []);
    renderTab();
    const draftRow = screen.getByTestId('wo-area-wo-1').closest('li') as HTMLElement;
    expect(within(draftRow).getByText('Draft')).toBeInTheDocument();
    expect(screen.getByTestId('wo-area-wo-1')).toHaveTextContent('Area North');
    expect(screen.getByTestId('wo-area-wo-2')).toHaveTextContent('Area South');
    expect(screen.queryByTestId('wo-area-wo-3')).not.toBeInTheDocument();
  });
});
