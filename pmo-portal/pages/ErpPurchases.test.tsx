import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

const { purchasesMock, projectsMock, mayMock } = vi.hoisted(() => ({ purchasesMock: vi.fn(), projectsMock: vi.fn(), mayMock: vi.fn() }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: purchasesMock }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: projectsMock }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => mayMock }));

import ErpPurchasesPage from './ErpPurchases';

const renderPage = () => render(<MemoryRouter><ErpPurchasesPage /></MemoryRouter>);
const row = { id: 'r1', doctype: 'Purchase Order', name: 'PUR-ORD-9', supplier: 'Acme', docDate: '2026-01-05', dueDate: null, billNo: null,
  currency: 'IDR', grandTotal: 900, outstanding: null, erpStatus: 'To Bill', isReturn: false, projectIds: ['p1'] };

beforeEach(() => {
  mayMock.mockReset().mockReturnValue(true);
  projectsMock.mockReset().mockReturnValue({ data: [{ id: 'p1', name: 'Tower Retrofit' }] });
  purchasesMock.mockReset();
});

describe('ErpPurchases page', () => {
  it('FR-EPR-007 lists org purchases with their project and the ERP status of an order', () => {
    purchasesMock.mockReturnValue({ data: [row, { ...row, id: 'r2', name: 'PUR-ORD-10', projectIds: [] }] });
    renderPage();
    expect(screen.getAllByText('Tower Retrofit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No project').length).toBeGreaterThan(0);
    expect(screen.getAllByText('To Bill').length).toBeGreaterThan(0);
  });

  it('shows empty, error and no-access states instead of a table', () => {
    purchasesMock.mockReturnValue({ data: [], isPending: false });
    const { unmount } = renderPage();
    expect(screen.getByText('No purchases from ERPNext yet')).toBeInTheDocument();
    unmount();

    purchasesMock.mockReturnValue({ isError: true, refetch: vi.fn() });
    renderPage().unmount();

    mayMock.mockReturnValue(false);
    purchasesMock.mockReturnValue({ data: undefined });
    renderPage();
    expect(screen.getByText("You don't have access to the organization's purchases")).toBeInTheDocument();
    expect(purchasesMock).toHaveBeenLastCalledWith(undefined, { enabled: false });
  });
});
