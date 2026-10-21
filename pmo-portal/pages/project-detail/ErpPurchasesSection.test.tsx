import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';

const { purchasesMock, mayMock } = vi.hoisted(() => ({ purchasesMock: vi.fn(), mayMock: vi.fn() }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: purchasesMock }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => mayMock }));
vi.mock('@/src/lib/efaktur', () => ({ localToday: () => '2026-03-15' }));

import { ErpPurchasesSection } from './ErpPurchasesSection';

const row = (over: Partial<ErpPurchaseRow>): ErpPurchaseRow => ({
  id: over.name ?? 'x', doctype: 'Purchase Invoice', name: 'PINV', supplier: 'Acme', docDate: '2026-01-10', dueDate: '2026-04-01',
  billNo: null, currency: 'IDR', grandTotal: 1000, outstanding: 1000, erpStatus: 'Unpaid', isReturn: false, projectIds: ['p1'], ...over,
});
const renderSection = () => render(<MemoryRouter><ErpPurchasesSection projectId="p1" /></MemoryRouter>);

beforeEach(() => {
  mayMock.mockReset().mockReturnValue(true);
  purchasesMock.mockReset();
});

describe('ErpPurchasesSection', () => {
  it('AC-EPR-007 lists paid, overdue and shared ERP invoices, says they are already in Actuals, and ages only the unshared', () => {
    purchasesMock.mockReturnValue({ data: [
      row({ name: 'PINV-PAID', supplier: 'Paid Supplier', outstanding: 0, grandTotal: 400 }),
      row({ name: 'PINV-LATE', supplier: 'Late Supplier', outstanding: 250, grandTotal: 250, dueDate: '2026-03-01' }),
      row({ name: 'PINV-SHARED', supplier: 'Shared Supplier', outstanding: 900, projectIds: ['p1', 'p2'] }),
    ] });
    renderSection();

    expect(screen.getByRole('heading', { name: 'Purchases recorded in ERPNext' })).toBeInTheDocument();
    expect(screen.getByText(/Already counted in Actuals/)).toBeInTheDocument();
    for (const name of ['PINV-PAID', 'PINV-LATE', 'PINV-SHARED']) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Shared with other projects/).length).toBeGreaterThan(0);

    const aging = screen.getByLabelText(/Unpaid by age · IDR/);
    const total = within(aging).getByText('Unpaid total').nextElementSibling!;
    expect(total.textContent).toMatch(/250/);
    expect(total.textContent).not.toMatch(/1[.,]?150/);
    expect(screen.getByText(/1 unpaid invoices? shared with other projects/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All ERP purchases' })).toHaveAttribute('href', '/erp-purchases');
  });

  it('renders nothing for a project with no ERP purchases, or for a role without the procurement view', () => {
    purchasesMock.mockReturnValue({ data: [] });
    const { container, unmount } = renderSection();
    expect(container).toBeEmptyDOMElement();
    unmount();

    mayMock.mockReturnValue(false);
    purchasesMock.mockReturnValue({ data: [row({})] });
    expect(renderSection().container).toBeEmptyDOMElement();
    expect(purchasesMock).toHaveBeenLastCalledWith('p1', { enabled: false });
  });
});
