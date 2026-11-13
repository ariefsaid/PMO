import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import Procurement from './Procurement';

const rows = [
  { id: 'req', code: 'PR-REQ', title: 'Request case', status: 'Requested', total_value: 100, currency: 'USD', project_id: 'p1', requested_by_id: 'u1', vendor_id: 'v1', budget_category: 'Materials', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', project: { id: 'p1', name: 'Bridge project', code: 'P1', project_manager_id: 'u1' }, vendor: { name: 'Alpha Supply' }, requested_by: { full_name: 'Alice Requester' }, purchase_requests: [], purchase_orders: [], receipts: [], procurement_invoices: [], payments: [], status_events: [] },
  { id: 'ord', code: 'PR-ORD', title: 'Order case', status: 'Ordered', total_value: 200, currency: 'USD', project_id: 'p2', requested_by_id: 'u2', vendor_id: 'v2', budget_category: 'Services', created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', project: { id: 'p2', name: 'Plant project', code: 'P2', project_manager_id: 'u2' }, vendor: { name: 'Beta Supply' }, requested_by: { full_name: 'Bob Requester' }, purchase_requests: [], purchase_orders: [], receipts: [], procurement_invoices: [], payments: [], status_events: [] },
  { id: 'rec', code: 'PR-REC', title: 'Receipt case', status: 'Received', total_value: 300, currency: 'USD', project_id: 'p1', requested_by_id: 'u1', vendor_id: 'v1', budget_category: 'Materials', created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z', project: { id: 'p1', name: 'Bridge project', code: 'P1', project_manager_id: 'u1' }, vendor: { name: 'Alpha Supply' }, requested_by: { full_name: 'Alice Requester' }, purchase_requests: [], purchase_orders: [], receipts: [], procurement_invoices: [], payments: [], status_events: [] },
  { id: 'pay', code: 'PR-PAY', title: 'Pay case', status: 'Vendor Invoiced', total_value: 400, currency: 'USD', project_id: 'p2', requested_by_id: 'u2', vendor_id: 'v2', budget_category: 'Services', created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z', project: { id: 'p2', name: 'Plant project', code: 'P2', project_manager_id: 'u2' }, vendor: { name: 'Beta Supply' }, requested_by: { full_name: 'Bob Requester' }, purchase_requests: [], purchase_orders: [], receipts: [], procurement_invoices: [], payments: [], status_events: [] },
];

const procState = { data: rows as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const orphanState = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const projectState = { data: [{ id: 'p1', name: 'Bridge project' }, { id: 'p2', name: 'Plant project' }], isPending: false, isError: false, refetch: vi.fn() };
const linkMutation = vi.hoisted(() => vi.fn());
const optionState = vi.hoisted(() => ({ project: { data: [], isPending: false, isError: false, refetch: vi.fn() }, vendor: { data: [], isPending: false, isError: false, refetch: vi.fn() } }));

vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useErpOrphans: () => orphanState,
}));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: linkMutation, isPending: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => projectState, useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useProjectOptions: () => optionState.project, useVendorOptions: () => optionState.vendor }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-finance', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance' }) }));

const RouteProbe = () => {
  const location = useLocation();
  return <output data-testid="route-path">{location.pathname + location.search}</output>;
};

const renderPage = (path = '/procurement?tab=all&view=table') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[path]}><RouteProbe /><Procurement /></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
);

const renderedTitles = () => ['Request case', 'Order case', 'Receipt case', 'Pay case'].filter((title) => screen.queryByText(title));

beforeEach(() => {
  procState.data = rows;
  procState.isPending = false;
  procState.isError = false;
  procState.refetch.mockReset();
  orphanState.data = [];
  orphanState.isPending = false;
  orphanState.isError = false;
  orphanState.refetch.mockReset();
  projectState.isPending = false;
  projectState.isError = false;
  projectState.refetch.mockReset();
  linkMutation.mockReset();
  sessionStorage.clear();
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

describe('Procurement list floors', () => {
  it('floor: Not in a procurement loads orphan rows and their count', async () => {
    orphanState.data = [{ id: 'orphan-1', name: 'PINV-77', doctype: 'Purchase Invoice', supplier: 'Alpha Supply', currency: 'USD', grandTotal: 50, docDate: '2026-10-11', projectIds: [] }];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Not in a procurement/i }));
    expect(await screen.findByText('PINV-77')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Not in a procurement\s*1/ })).toBeInTheDocument();
  });

  it('floor: Grouped view replaces the procurement table with grouped sections', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Grouped' }));
    expect(screen.getByLabelText('Procurements grouped by next step')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Procurement' })).not.toBeInTheDocument();
  });

  it('floor: Table view restores procurement rows after Grouped view', async () => {
    renderPage('/procurement?tab=all&view=grouped');
    await userEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(screen.getByRole('button', { name: 'Open Request case' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Pay case' })).toBeInTheDocument();
  });

  it('floor: Clear stage filter restores every procurement row', async () => {
    renderPage();
    await userEvent.click(within(screen.getByRole('group', { name: 'Procurement stages' })).getByRole('button', { name: /^Request/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear stage filter' }));
    expect(renderedTitles()).toHaveLength(4);
  });

  it('floor: phone Filters disclosure opens and dismisses the stacked controls', async () => {
    renderPage();
    const filters = screen.getByRole('button', { name: 'Filters' });
    expect(filters).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(filters);
    expect(filters).toHaveAttribute('aria-expanded', 'true');
    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Services');
    expect(screen.getByText('Order case')).toBeInTheDocument();
    expect(screen.queryByText('Request case')).not.toBeInTheDocument();
    await userEvent.click(filters);
    expect(filters).toHaveAttribute('aria-expanded', 'false');
  });

  it('floor: Project filter leaves only procurements for the selected project and writes the URL', async () => {
    renderPage('/procurement?tab=all&view=grouped');
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'p1');
    expect(screen.getByText('Request case')).toBeInTheDocument();
    expect(screen.getByText('Receipt case')).toBeInTheDocument();
    expect(screen.queryByText('Order case')).not.toBeInTheDocument();
    expect(screen.getByTestId('route-path')).toHaveTextContent('project=p1');
  });

  it('floor: Supplier filter leaves only procurements for the selected supplier and writes the URL', async () => {
    renderPage('/procurement?tab=all&view=grouped');
    await userEvent.selectOptions(screen.getByLabelText('Supplier'), 'v2');
    expect(screen.getByText('Order case')).toBeInTheDocument();
    expect(screen.getByText('Pay case')).toBeInTheDocument();
    expect(screen.queryByText('Request case')).not.toBeInTheDocument();
    expect(screen.getByTestId('route-path')).toHaveTextContent('supplier=v2');
  });

  it('floor: Raised by filter leaves only procurements for the selected requester', async () => {
    renderPage('/procurement?tab=all&view=grouped');
    await userEvent.selectOptions(screen.getByLabelText('Raised by'), 'u1');
    expect(screen.getByText('Request case')).toBeInTheDocument();
    expect(screen.getByText('Receipt case')).toBeInTheDocument();
    expect(screen.queryByText('Order case')).not.toBeInTheDocument();
  });

  it('floor: Category filter leaves only matching procurement rows', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Services');
    expect(screen.getByText('Order case')).toBeInTheDocument();
    expect(screen.getByText('Pay case')).toBeInTheDocument();
    expect(screen.queryByText('Request case')).not.toBeInTheDocument();
  });

  it('floor: Owner filter leaves only matching procurement rows', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText('Filter by owner'), 'u2');
    expect(screen.getByText('Order case')).toBeInTheDocument();
    expect(screen.getByText('Pay case')).toBeInTheDocument();
    expect(screen.queryByText('Request case')).not.toBeInTheDocument();
  });

  it('floor: list Retry refetches procurements after a read error', async () => {
    procState.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(procState.refetch).toHaveBeenCalledTimes(1);
  });

  it('floor: orphan Retry refetches documents after an orphan read error', async () => {
    orphanState.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Not in a procurement/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Retry/i }));
    expect(orphanState.refetch).toHaveBeenCalledTimes(1);
  });
});
