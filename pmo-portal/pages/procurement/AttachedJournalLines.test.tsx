/** FR-JEC-014/016 / AC-JEC-014 — the journal lines attached to a purchase, and detaching one. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  query: { data: [] as unknown[] | undefined, isError: false, refetch: vi.fn() },
  detach: vi.fn(),
  may: vi.fn((action: string, entity: string) => action === 'delete' && entity === 'erpPurchaseLink'),
}));
vi.mock('@/src/hooks/useErpJournalLines', () => ({
  usePurchaseJournalLines: () => h.query,
  useDetachJournalLine: () => ({ mutateAsync: h.detach, isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));

import { AttachedJournalLines } from './AttachedJournalLines';

const line = {
  erpDoctype: 'Journal Entry', voucherNo: 'ACC-JV-0001', projectId: 'p1', account: 'Sub - X', category: 'Subcontractors', postingDate: '2026-03-01',
  amount: 60000, currency: 'IDR', remarks: 'Vendor Lab inv 7', party: null, isCancelled: false, erpUrl: null, linkId: 'l1', procurementId: 'pr1', procurementTitle: 'Lab works', possiblyReversed: false,
};
const renderIt = () => render(<MemoryRouter><AttachedJournalLines procurementId="pr1" projectId="p1" /></MemoryRouter>);

beforeEach(() => {
  h.query = { data: [line], isError: false, refetch: vi.fn() };
  h.detach.mockReset();
  h.may.mockImplementation((action: string, entity: string) => action === 'delete' && entity === 'erpPurchaseLink');
});

describe('AttachedJournalLines', () => {
  it('FR-JEC-042: a possibly reversed line is flagged on the purchase', () => {
    h.query = { ...h.query, data: [{ ...line, possiblyReversed: true }] };
    renderIt();
    expect(screen.getByRole('row', { name: /ACC-JV-0001/ })).toHaveTextContent('Possibly reversed');
  });

  it('FR-JEC-016: lists number, date, account and amount', () => {
    renderIt();
    const row = screen.getByRole('row', { name: /ACC-JV-0001/ });
    expect(row).toHaveTextContent('Sub - X');
    expect(row).toHaveTextContent(/60[.,]000/);
    expect(row).toHaveTextContent(/2026|Mar/);
  });

  it('FR-JEC-014: Detach asks first, then detaches that line', async () => {
    h.detach.mockResolvedValueOnce(undefined);
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Detach ACC-JV-0001' }));
    expect(h.detach).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('ACC-JV-0001');
    await userEvent.click(screen.getByRole('button', { name: 'Detach' }));
    expect(h.detach).toHaveBeenCalledWith('l1');
  });

  it('AC-JEC-014: a role that cannot detach sees the line with no Detach button', () => {
    h.may.mockImplementation(() => false);
    renderIt();
    expect(screen.getByRole('row', { name: /ACC-JV-0001/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Detach/ })).toBeNull();
  });

  it('a refused detach shows the reason and keeps the dialog', async () => {
    h.detach.mockRejectedValueOnce(Object.assign(new Error('Only an Admin or Finance member can detach a journal line.'), { code: '42501' }));
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Detach ACC-JV-0001' }));
    await userEvent.click(screen.getByRole('button', { name: 'Detach' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeVisible();
  });

  it('renders nothing when no line is attached', () => {
    h.query = { ...h.query, data: [] };
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });
});
