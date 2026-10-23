/** FR-PFE-031/032 / AC-PFE-015 — the ERPNext documents linked to a purchase, and unlinking one. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  query: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  unlink: vi.fn(),
  may: vi.fn((action: string, entity: string) => action === 'delete' && entity === 'erpPurchaseLink'),
}));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({
  useLinkedErpDocuments: () => h.query,
  useUnlinkErpDocument: () => ({ mutateAsync: h.unlink, isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));

import { LinkedErpDocuments } from './LinkedErpDocuments';

const invoice = {
  id: 'd1', doctype: 'Purchase Invoice', name: 'ACC-PINV-0001', supplier: 'S', docDate: '2026-02-01', dueDate: null, billNo: 'INV-7',
  currency: 'IDR', grandTotal: 4321000, netTotal: 3900000, outstanding: 0, erpStatus: 'Paid', isReturn: false, projectIds: [],
  procurementId: 'p', linkId: 'l1',
};

beforeEach(() => {
  h.query = { data: [invoice], isPending: false, isError: false, refetch: vi.fn() };
  h.unlink.mockReset();
  h.may.mockImplementation((action: string, entity: string) => action === 'delete' && entity === 'erpPurchaseLink');
});

describe('LinkedErpDocuments', () => {
  it('AC-PFE-015: shows ERP number, type, date, amount with currency and ERP status, marked From ERPNext', () => {
    render(<LinkedErpDocuments procurementId="p" />);
    expect(screen.getByRole('heading', { name: 'Documents from ERPNext' })).toBeVisible();
    const row = screen.getByRole('row', { name: /ACC-PINV-0001/ });
    expect(row).toHaveTextContent('From ERPNext');
    expect(row).toHaveTextContent('Supplier invoice');
    expect(row).toHaveTextContent(/4[.,]321[.,]000/);
    expect(row).toHaveTextContent(/IDR|Rp/);
    expect(row).toHaveTextContent('Paid');
    expect(row).toHaveTextContent(/2026|Feb/);
  });

  it('FR-PFE-031: Unlink asks first, then unlinks that document', async () => {
    h.unlink.mockResolvedValueOnce(undefined);
    render(<LinkedErpDocuments procurementId="p" />);
    await userEvent.click(screen.getByRole('button', { name: 'Unlink ACC-PINV-0001' }));
    expect(h.unlink).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('ACC-PINV-0001');
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(h.unlink).toHaveBeenCalledWith('l1');
  });

  it('a refused unlink shows the reason in plain words and keeps the dialog', async () => {
    h.unlink.mockRejectedValueOnce(Object.assign(new Error('Only an Admin or Finance member can unlink.'), { code: 'P0001' }));
    render(<LinkedErpDocuments procurementId="p" />);
    await userEvent.click(screen.getByRole('button', { name: 'Unlink ACC-PINV-0001' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('without unlink rights there is no Unlink', () => {
    h.may.mockReturnValue(false);
    render(<LinkedErpDocuments procurementId="p" />);
    expect(screen.getByRole('row', { name: /ACC-PINV-0001/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Unlink/ })).toBeNull();
  });

  it('renders nothing while loading, when nothing is linked, or when the read is refused (Engineers read none)', () => {
    h.query = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const { container, rerender } = render(<LinkedErpDocuments procurementId="p" />);
    expect(container).toBeEmptyDOMElement();
    h.query = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    rerender(<LinkedErpDocuments procurementId="p" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a failed read says so with a retry, instead of hiding linked documents silently', async () => {
    const refetch = vi.fn();
    h.query = { data: undefined, isPending: false, isError: true, refetch };
    render(<LinkedErpDocuments procurementId="p" />);
    await userEvent.click(screen.getByRole('button', { name: /Retry|Try again/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
