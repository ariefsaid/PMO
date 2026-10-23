import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';

const { purchasesMock, mayMock } = vi.hoisted(() => ({ purchasesMock: vi.fn(), mayMock: vi.fn() }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: purchasesMock }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => mayMock }));
vi.mock('@/src/lib/efaktur', () => ({ localToday: () => '2026-03-15' }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [] }) }));

import { ErpPurchasesSection } from './ErpPurchasesSection';

const row = (over: Partial<ErpPurchaseRow>): ErpPurchaseRow => ({
  id: over.name ?? 'x', doctype: 'Purchase Invoice', name: 'PINV', supplier: 'Acme', docDate: '2026-01-10', dueDate: '2026-04-01',
  billNo: null, currency: 'IDR', grandTotal: 1000, netTotal: null, outstanding: 1000, erpStatus: 'Unpaid', isReturn: false, projectIds: ['p1'],
  procurementId: null, linkId: null, ...over,
});
const renderSection = () => render(<MemoryRouter><ErpPurchasesSection projectId="p1" /></MemoryRouter>);

beforeEach(() => {
  mayMock.mockReset().mockReturnValue(true);
  purchasesMock.mockReset();
});

describe('ErpPurchasesSection', () => {
  it('AC-EPR-007 / FR-PFE-041 lists the ERP documents not in a purchase, says they are already in Actuals, and ages only the unshared', () => {
    purchasesMock.mockReturnValue({ data: [
      row({ name: 'PINV-PAID', supplier: 'Paid Supplier', outstanding: 0, grandTotal: 400 }),
      row({ name: 'PINV-LATE', supplier: 'Late Supplier', outstanding: 250, grandTotal: 250, dueDate: '2026-03-01' }),
      row({ name: 'PINV-SHARED', supplier: 'Shared Supplier', outstanding: 900, projectIds: ['p1', 'p2'] }),
    ] });
    renderSection();

    expect(screen.getByRole('heading', { name: 'ERPNext documents not in a purchase' })).toBeInTheDocument();
    expect(screen.getByText(/Already counted in Actuals/)).toBeInTheDocument();
    for (const name of ['PINV-PAID', 'PINV-LATE', 'PINV-SHARED']) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Link PINV-/ })).toHaveLength(3);
    expect(screen.queryByText(/Shown for reference, not added again/)).toBeNull();

    const aging = screen.getByLabelText(/Unpaid by age · IDR/);
    expect(screen.getByRole('heading', { name: 'Unpaid ERPNext invoices (incl. linked)' })).toBeInTheDocument();
    const total = within(aging).getByText('Unpaid total').nextElementSibling!;
    expect(total.textContent).toMatch(/250/);
    expect(total.textContent).not.toMatch(/1[.,]?150/);
    expect(screen.getByText(/1 unpaid invoices? shared with other projects/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All unlinked ERPNext documents' })).toHaveAttribute('href', '/erp-purchases');
  });

  it('FR-PFE-042: a linked invoice still counts in the aging but is not listed', () => {
    purchasesMock.mockReturnValue({ data: [
      row({ name: 'PINV-LINKED', outstanding: 300, grandTotal: 300, procurementId: 'x', linkId: 'l1' }),
      row({ name: 'PINV-ORPHAN', outstanding: 200, grandTotal: 200 }),
    ] });
    renderSection();
    expect(screen.queryByText('PINV-LINKED')).toBeNull();
    expect(screen.getAllByText('PINV-ORPHAN').length).toBeGreaterThan(0);
    const total = within(screen.getByLabelText(/Unpaid by age · IDR/)).getByText('Unpaid total').nextElementSibling!;
    expect(total.textContent).toMatch(/500/);
  });

  it('FR-PFE-042: with every unpaid invoice linked, the aging still shows and no list does', () => {
    purchasesMock.mockReturnValue({ data: [row({ name: 'PINV-LINKED', outstanding: 300, grandTotal: 300, procurementId: 'x', linkId: 'l1' })] });
    renderSection();
    expect(screen.getByLabelText(/Unpaid by age · IDR/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('without link rights the documents are listed read-only', () => {
    mayMock.mockImplementation((action: string) => action === 'view');
    purchasesMock.mockReturnValue({ data: [row({ name: 'PINV-ORPHAN' })] });
    renderSection();
    expect(screen.getAllByText('PINV-ORPHAN').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Link/ })).toBeNull();
  });

  it('review 4: the aging carries its own title, separate from the not-in-a-purchase list', () => {
    purchasesMock.mockReturnValue({ data: [row({ name: 'PINV-LINKED', outstanding: 300, grandTotal: 300, procurementId: 'x', linkId: 'l1' })] });
    renderSection();
    const heading = screen.getByRole('heading', { name: 'Unpaid ERPNext invoices (incl. linked)' });
    expect(heading.closest('section')).toContainElement(screen.getByLabelText(/Unpaid by age · IDR/));
  });

  it('review 6: a failed load shows an error with Retry, never a blank tab', async () => {
    const refetch = vi.fn();
    purchasesMock.mockReturnValue({ data: undefined, isError: true, refetch });
    renderSection();
    expect(screen.getByRole('heading', { name: 'ERPNext documents not in a purchase' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry|Try again/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders nothing for a project with no ERP purchases, only paid linked ones, or for a role without the procurement view', () => {
    purchasesMock.mockReturnValue({ data: [row({ outstanding: 0, procurementId: 'x', linkId: 'l1' })] });
    renderSection().unmount();
    expect(screen.queryByRole('heading')).toBeNull();
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
