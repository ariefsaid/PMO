import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p-1', code: 'PR-1', title: 'Inverters', status: 'Vendor Invoiced', total_value: 62_000, approved_total_value: null, currency: 'USD',
  project_id: 'proj-1', budget_category: 'Materials', requested_by_id: 'u-requester', approved_by_id: 'u-approver', vendor_id: 'v-1',
  created_at: '2026-10-27T00:00:00.000Z', updated_at: '2026-10-27T00:00:00.000Z', status_events: [],
  project: { name: 'Site', code: 'P1' }, vendor: { name: 'Acme Supply' }, requested_by: { full_name: 'Rina Requester' },
  purchase_requests: [], purchase_orders: [], receipts: [],
  procurement_invoices: [{ amount: 62_000, erp_outstanding_amount: 62_000, invoice_date: '2026-10-20' }],
  payments: [],
  ...over,
});

const detailFor = (r: ReturnType<typeof row>) => ({
  ...r,
  items: [{ id: 'i-1', name: 'Inverter', description: null, quantity: 2 }],
  quotations: [],
  invoices: r.procurement_invoices,
});

const procState = { data: [row()] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const authState = { userId: 'u-finance', role: 'Finance' };
const budgetState = { rows: [] as unknown[], hasBudget: false, isPending: false, actualsPending: false };

const transitionSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { ...actual.repositories, procurement: { ...actual.repositories.procurement, transition: transitionSpy } } };
});
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: { id: 'proj-1', currency: 'USD' } }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: (id?: string) => {
    const found = (procState.data as Array<ReturnType<typeof row>>).find((candidate) => candidate.id === id);
    return { data: found ? detailFor(found) : undefined, isPending: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock('@/pages/project-detail/useProjectPosition', () => ({ useBudgetPosition: () => budgetState }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: authState.role, effectiveRole: authState.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: authState.userId, org_id: 'org-1' }, role: authState.role }) }));

const RouteProbe = () => {
  const location = useLocation();
  return <output data-testid="route-probe" data-state={JSON.stringify(location.state ?? null)}>{location.pathname}</output>;
};

const renderBlock = (path = '/procurement?open=p-1') => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/procurement" element={<ProcurementBlock />} />
          <Route path="/procurement/:procurementId" element={<RouteProbe />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

describe('Procurement drawer header (B4)', () => {
  beforeEach(() => {
    procState.data = [row()];
    authState.userId = 'u-finance';
    authState.role = 'Finance';
    budgetState.rows = [];
    budgetState.hasBudget = false;
  });

  it('carries the state main action, Open full page and a more-actions menu', async () => {
    renderBlock();
    const drawer = screen.getByRole('dialog');

    const main = within(drawer).getByRole('button', { name: 'Record payment' });
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/procurement/p-1');
    expect(within(drawer).getByRole('button', { name: 'More procurement actions' })).toBeInTheDocument();

    await userEvent.click(main);
    const probe = screen.getByTestId('route-probe');
    expect(probe).toHaveTextContent('/procurement/p-1');
    expect(JSON.parse(probe.getAttribute('data-state') ?? 'null')).toMatchObject({ runMainAction: 'Paid' });
  });

  it('QM-9 removes the duplicate Next action row-menu item', async () => {
    renderBlock('/procurement');
    await userEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]!);
    expect(screen.getByRole('menuitem', { name: 'Open procurement' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Next action' })).not.toBeInTheDocument();
  });

  it('offers Approve to a viewer who may decide a waiting procurement', () => {
    procState.data = [row({ status: 'Requested', procurement_invoices: [], approved_by_id: null })];
    renderBlock();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('QM-1 keeps the drawer next step specific to the routed approver', () => {
    procState.data = [row({ status: 'Requested', procurement_invoices: [], approved_by_id: null, approvalRoute: { route: 'assigned', approvers: [{ id: 'u-other' }] } })];
    renderBlock();
    const drawer = screen.getByRole('dialog', { name: /Inverters/ });
    expect(within(drawer).getByText('Waiting on approver')).toBeInTheDocument();
    expect(within(drawer).queryByText('Approve or return')).not.toBeInTheDocument();
  });

  it('OD-UX-1: Approve from the drawer confirms against the amount before anything is written', async () => {
    transitionSpy.mockClear();
    procState.data = [row({ status: 'Requested', procurement_invoices: [], approved_by_id: null })];
    renderBlock();
    fireEvent.click(within(screen.getByRole('dialog', { name: /Inverters/ })).getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this procurement?' });
    expect(confirm).toHaveTextContent('Approve this procurement?');
    expect(confirm).toHaveTextContent('$62,000');
    expect(transitionSpy).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(transitionSpy).toHaveBeenCalledWith('p-1', 'Approved'));
  });

  it('shows no main action when the viewer has no step to take', () => {
    authState.role = 'Engineer';
    authState.userId = 'u-engineer';
    procState.data = [row({ requested_by_id: 'u-engineer' })];
    renderBlock();
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toBeInTheDocument();
  });
});

describe('Procurement drawer body', () => {
  beforeEach(() => {
    procState.data = [row()];
    authState.userId = 'u-finance';
    authState.role = 'Finance';
    budgetState.rows = [];
    budgetState.hasBudget = false;
  });

  it('L12: dates the Request step from the purchase request document, as the record page does', () => {
    renderBlock();
    const timeline = screen.getByRole('region', { name: 'Step timeline' });
    const request = within(timeline).getByText('Request').closest('li')!;
    expect(request).toHaveTextContent('Not recorded');
    expect(request).not.toHaveTextContent('Oct 27, 2026');
  });

  it('QM-2 treats a scheduled payment as invoiced until it is paid', () => {
    procState.data = [row({ payments: [{ amount: 5_000, status: 'Scheduled', date: '2026-10-22' }] })];
    renderBlock();
    const timeline = screen.getByRole('region', { name: 'Step timeline' });
    const pay = within(timeline).getByText('Invoiced').closest('li')!;
    expect(pay).toHaveTextContent('Oct 20, 2026');
    expect(pay).not.toHaveTextContent('Oct 22, 2026');
    expect(within(timeline).queryByText('Paid')).not.toBeInTheDocument();
  });

  it('C4: leaves out the category budget figure when it is unknown, never "Not available"', () => {
    renderBlock();
    const drawer = screen.getByRole('dialog');
    expect(drawer).not.toHaveTextContent('Not available');
    expect(within(drawer).queryByText('Budget left in category')).not.toBeInTheDocument();
  });

  it('C4: shows the category budget left when it is known', () => {
    budgetState.hasBudget = true;
    budgetState.rows = [{ category: 'Materials', budget: 100_000, actual: 10_000 }];
    renderBlock();
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Budget left in category')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('$28,000');
  });

  it('shows the unpaid balance once, without repeating the same figure', () => {
    renderBlock();
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getAllByText('$62,000')).toHaveLength(1);
    expect(within(drawer).getByText('Unpaid in full')).toBeInTheDocument();
  });
});

describe('Procurement list rows', () => {
  beforeEach(() => {
    procState.data = [row()];
    authState.userId = 'u-finance';
    authState.role = 'Finance';
  });

  it('B7: stage band and stage pill read Request · Order · Receive · Pay', () => {
    procState.data = [row({ id: 'o', status: 'Ordered', procurement_invoices: [] }), row({ id: 'r', status: 'Received', procurement_invoices: [] })];
    renderBlock('/procurement');
    const band = screen.getByRole('region', { name: 'Procurement stages' });
    const labels = within(band).getAllByRole('button').map((button) => button.textContent ?? '');
    expect(labels[1]).toMatch(/^Order/);
    expect(labels[2]).toMatch(/^Receive/);
    expect(band).not.toHaveTextContent(/Ordered|Received/);
  });

  it('B7: each row shows one amount; the unpaid balance moves to its tooltip', () => {
    renderBlock('/procurement');
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('$62,000')).toHaveLength(1);
    expect(table).not.toHaveTextContent(/Unpaid/);
  });
});

describe('Procurement list rows on a phone (L3)', () => {
  const original = window.matchMedia;
  beforeEach(() => {
    procState.data = [row()];
    authState.userId = 'u-finance';
    authState.role = 'Finance';
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { window.matchMedia = original; });

  it('shows title, stage pill, one amount and a next-step link instead of label/value pairs', () => {
    renderBlock('/procurement');
    const card = screen.getByRole('button', { name: 'Open Inverters' }).closest('li')!;
    expect(within(card).getByText('Invoiced, not paid')).toBeInTheDocument();
    expect(within(card).getAllByText('$62,000')).toHaveLength(1);
    expect(within(card).getByRole('link', { name: 'Pay' })).toHaveAttribute('href', '/procurement/p-1');
    expect(card.querySelector('dl')).toBeNull();
    expect(card).not.toHaveTextContent(/Category|Materials|Paid \/ invoiced/);
    expect(within(card).getByText('Rina Requester')).toBeInTheDocument();
  });
});
