import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

const { purchasesMock, projectsMock, mayMock } = vi.hoisted(() => ({ purchasesMock: vi.fn(), projectsMock: vi.fn(), mayMock: vi.fn() }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpOrphans: purchasesMock }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: projectsMock }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => mayMock }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [] }) }));

import ErpPurchasesPage from './ErpPurchases';

const renderPage = () => render(<MemoryRouter><ErpPurchasesPage /></MemoryRouter>);
const row = { id: 'r1', doctype: 'Purchase Order', name: 'PUR-ORD-9', supplier: 'Acme', docDate: '2026-01-05', dueDate: null, billNo: null,
  currency: 'IDR', grandTotal: 900, netTotal: 800, outstanding: null, erpStatus: 'To Bill', isReturn: false, projectIds: ['p1'],
  procurementId: null as string | null, linkId: null as string | null };

beforeEach(() => {
  mayMock.mockReset().mockReturnValue(true);
  projectsMock.mockReset().mockReturnValue({ data: [{ id: 'p1', name: 'Tower Retrofit' }] });
  purchasesMock.mockReset();
});

describe('ErpPurchases page', () => {
  it('FR-PFE-041 lists the org\'s ERP documents not in a purchase, with their project, and offers linking', () => {
    purchasesMock.mockReturnValue({ data: [row, { ...row, id: 'r2', name: 'PUR-ORD-10', projectIds: [] }] });
    renderPage();
    expect(screen.getByRole('heading', { name: 'ERPNext documents not in a purchase' })).toBeInTheDocument();
    expect(screen.getAllByText('Tower Retrofit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No project').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Link PUR-ORD-/ })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Procurement' })).toHaveAttribute('href', '/procurement');
  });

  it('reads the default orphan list (set-aside documents are not in it), so its count matches the rows shown', () => {
    purchasesMock.mockReturnValue({ data: [row, { ...row, id: 'r2', name: 'PUR-ORD-10' }] });
    renderPage();
    expect(purchasesMock).toHaveBeenCalledWith(undefined, { enabled: true });
    expect(screen.getAllByRole('button', { name: /^Link PUR-ORD-/ })).toHaveLength(2);
    expect(screen.getByText('2')).toBeInTheDocument();
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
    expect(screen.queryByRole('link', { name: 'Procurement' })).toBeNull();
    expect(purchasesMock).toHaveBeenLastCalledWith(undefined, { enabled: false });
  });
});
