import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';

const { purchasesMock, projectsMock, mayMock } = vi.hoisted(() => ({ purchasesMock: vi.fn(), projectsMock: vi.fn(), mayMock: vi.fn() }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpOrphans: purchasesMock }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: projectsMock }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => mayMock }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [] }) }));

import ErpPurchasesPage from './ErpPurchases';

const RouteProbe = () => {
  const location = useLocation();
  return <output data-testid="route-query" data-path={location.pathname} data-state={JSON.stringify(location.state ?? {})}>{location.search}</output>;
};
const renderPage = (path = '/erp-purchases') => render(<MemoryRouter initialEntries={[path]}><RouteProbe /><ErpPurchasesPage /></MemoryRouter>);
const row = { id: 'r1', doctype: 'Purchase Order', name: 'PUR-ORD-9', supplier: 'Acme', docDate: '2026-01-05', dueDate: null, billNo: null,
  currency: 'IDR', grandTotal: 900, netTotal: 800, outstanding: null, erpStatus: 'To Bill', isReturn: false, projectIds: ['p1'],
  procurementId: null as string | null, linkId: null as string | null };

beforeEach(() => {
  mayMock.mockReset().mockReturnValue(true);
  projectsMock.mockReset().mockReturnValue({ data: [{ id: 'p1', name: 'Tower Retrofit' }] });
  purchasesMock.mockReset().mockReturnValue({ data: [] });
});

describe('ErpPurchases page', () => {
  it('FR-PFE-041 lists the org\'s ERP documents not in a purchase, with their project, and offers linking', () => {
    purchasesMock.mockReturnValue({ data: [row, { ...row, id: 'r2', name: 'PUR-ORD-10', projectIds: [] }] });
    renderPage();
    expect(screen.getByRole('heading', { name: 'ERPNext documents not in a purchase' })).toBeInTheDocument();
    expect(screen.getAllByText('Tower Retrofit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No project').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Link PUR-ORD-/ })).toHaveLength(2);
  });

  it('reads the default orphan list (set-aside documents are not in it), so its count matches the rows shown', () => {
    purchasesMock.mockReturnValue({ data: [row, { ...row, id: 'r2', name: 'PUR-ORD-10' }] });
    renderPage();
    expect(purchasesMock).toHaveBeenCalledWith(undefined, { enabled: true });
    expect(screen.getAllByRole('button', { name: /^Link PUR-ORD-/ })).toHaveLength(2);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('orders controls as search, project/type filters, visible date sort, then row selection', () => {
    purchasesMock.mockReturnValue({ data: [row, { ...row, id: 'r2', name: 'PUR-ORD-10', docDate: '2026-02-05' }] });
    renderPage();
    const follows = (first: HTMLElement, second: HTMLElement) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    const search = screen.getByRole('searchbox', { name: 'Search ERP documents' });
    const toolbar = within(screen.getByTestId('money-out-toolbar'));
    const project = toolbar.getByLabelText('Project');
    const type = toolbar.getByLabelText('Document type');
    const sort = screen.getByRole('button', { name: /Sort by document date:/i });
    const selection = screen.getByRole('group', { name: 'Selected documents' });
    expect(follows(search, project)).toBe(true);
    expect(follows(project, type)).toBe(true);
    expect(follows(type, sort)).toBe(true);
    expect(follows(sort, selection)).toBe(true);
    expect(screen.getAllByRole('button', { name: /^Link PUR-ORD-/ })).toHaveLength(2);
  });

  it('filters the complete orphan list by project, type and supplier search, preserving URL state', async () => {
    purchasesMock.mockReturnValue({ data: [
      row,
      { ...row, id: 'r2', name: 'ACC-PAY-1', supplier: 'North Freight', doctype: 'Payment Entry', projectIds: [], docDate: '2026-02-05' },
    ] });
    renderPage();
    const toolbar = within(screen.getByTestId('money-out-toolbar'));
    await userEvent.selectOptions(toolbar.getByLabelText('Project'), 'p1');
    expect(screen.getByTestId('route-query')).toHaveTextContent('project=p1');
    expect(screen.getAllByRole('button', { name: /^Link/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Link PUR-ORD-9$/ })).toBeInTheDocument();

    await userEvent.selectOptions(toolbar.getByLabelText('Document type'), 'Purchase Order');
    expect(screen.getByTestId('route-query')).toHaveTextContent('type=Purchase+Order');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search ERP documents' }), 'Acme');
    expect(await screen.findByRole('button', { name: /^Link PUR-ORD-9$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Link ACC-PAY-1$/ })).toBeNull();
  });

  it('shows and reverses Latest document date sorting in the URL', async () => {
    purchasesMock.mockReturnValue({ data: [row, { ...row, id: 'r2', name: 'PUR-ORD-10', docDate: '2026-02-05' }] });
    renderPage();
    let rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('PUR-ORD-10');
    const sort = screen.getByRole('button', { name: /Sort by document date:/i });
    expect(sort).toHaveTextContent('Latest document date');
    await userEvent.click(sort);
    expect(screen.getByTestId('route-query')).toHaveTextContent('sort=reverse');
    rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('PUR-ORD-9');
    expect(screen.getByRole('button', { name: /Sort by document date: Oldest document date/i })).toBeInTheDocument();
  });

  it('returns to the originating procurement working set from the ERP evidence child view', async () => {
    const listPath = '/procurement?status=Needs+approval&project=p1&sort=reverse&view=board';
    render(
      <MemoryRouter initialEntries={[
        '/procurement',
        { pathname: '/erp-purchases', state: { pmoListReturn: { list: 'procurement', path: listPath } } },
      ]} initialIndex={1}>
        <RouteProbe />
        <ErpPurchasesPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /procurement requests/i }));
    expect(screen.getByTestId('route-query')).toHaveAttribute('data-path', listPath.split('?')[0]);
    expect(screen.getByTestId('route-query')).toHaveTextContent(listPath.split('?')[1]);
    expect(screen.getByTestId('route-query')).toHaveAttribute('data-state', '{}');
  });

  it('when nothing is waiting, says so instead of an empty table', () => {
    purchasesMock.mockReturnValue({ data: [], isPending: false });
    renderPage();
    expect(screen.getByText('Every ERPNext document is in a purchase')).toBeInTheDocument();
  });

  it('shows error and no-access states instead of a table', () => {
    purchasesMock.mockReturnValue({ isError: true, refetch: vi.fn() });
    const errored = renderPage();
    expect(screen.getByText("Couldn't load the ERPNext documents not in a purchase")).toBeInTheDocument();
    expect(screen.queryByText(/ERP purchases/)).toBeNull();
    errored.unmount();

    mayMock.mockReturnValue(false);
    purchasesMock.mockReturnValue({ data: undefined });
    renderPage();
    expect(screen.getByText("You don't have access to the organization's purchases")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Procurement requests' })).toBeNull();
    expect(purchasesMock).toHaveBeenLastCalledWith(undefined, { enabled: false });
  });
});
