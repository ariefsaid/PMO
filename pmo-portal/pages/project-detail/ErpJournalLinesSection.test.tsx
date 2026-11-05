/** AC-JEC-014 / AC-JEC-016 / FR-JEC-001/003/004/006 — the project's journal cost lines, attachable to a purchase. */
import { MemoryRouter } from 'react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  query: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  may: vi.fn((_action: string, _entity: string) => true),
}));
vi.mock('@/src/hooks/useErpJournalLines', () => ({ useProjectJournalLines: () => h.query }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));
vi.mock('./AttachJournalLineDialog', () => ({
  AttachJournalLineDialog: ({ line, onClose }: { line: { voucherNo: string }; onClose: () => void }) => (
    <div role="dialog" aria-label="attach dialog">{line.voucherNo}<button onClick={onClose}>close</button></div>
  ),
}));

import { ErpJournalLinesSection } from './ErpJournalLinesSection';

const line = (over: Record<string, unknown> = {}) => ({
  erpDoctype: 'Journal Entry', voucherNo: 'ACC-JV-0001', projectId: 'p1', account: 'Project Subcontractors - X', category: 'Subcontractors',
  postingDate: '2026-03-01', amount: 60000, currency: 'IDR', remarks: 'Vendor Lab inv 7', party: null, isCancelled: false,
  erpUrl: 'https://erp.example.test/app/journal-entry/ACC-JV-0001', linkId: null, procurementId: null, procurementTitle: null, possiblyReversed: false, ...over,
});
const renderIt = () => render(<MemoryRouter><ErpJournalLinesSection projectId="p1" /></MemoryRouter>);

beforeEach(() => {
  h.query = { data: [line()], isPending: false, isError: false, refetch: vi.fn() };
  h.may.mockImplementation(() => true);
});

describe('ErpJournalLinesSection', () => {
  it('AC-JEC-001: an unattached line shows number, date, account, category, amount and remark, and the no-purchase note', () => {
    renderIt();
    const row = screen.getByRole('row', { name: /ACC-JV-0001/ });
    expect(row).toHaveTextContent('Project Subcontractors - X');
    expect(row).toHaveTextContent('Subcontractors');
    expect(row).toHaveTextContent(/60[.,]000/);
    expect(row).toHaveTextContent('Vendor Lab inv 7');
    expect(row).toHaveTextContent(/2026|Mar/);
    expect(screen.getByText(/no purchase was raised in PMO/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'ACC-JV-0001' })).toHaveAttribute('href', 'https://erp.example.test/app/journal-entry/ACC-JV-0001');
  });

  it('FR-JEC-001: with no site address the number is plain text', () => {
    h.query = { ...h.query, data: [line({ erpUrl: null })] };
    renderIt();
    expect(screen.queryByRole('link', { name: 'ACC-JV-0001' })).toBeNull();
    expect(screen.getByRole('row', { name: /ACC-JV-0001/ })).toBeVisible();
  });

  it('FR-JEC-004: no total is rendered and the section says the lines are already in spending', () => {
    h.query = { ...h.query, data: [line(), line({ voucherNo: 'ACC-JV-0002', amount: 40000 })] };
    renderIt();
    expect(screen.queryByText(/100[.,]000/)).toBeNull();
    expect(screen.getByText('Already in spending')).toBeVisible();
  });

  it('AC-JEC-014: a permitted member attaches an unattached line from its row', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Attach ACC-JV-0001 to a purchase' }));
    expect(screen.getByRole('dialog', { name: 'attach dialog' })).toHaveTextContent('ACC-JV-0001');
  });

  it('AC-JEC-014: an attached line shows its purchase as a link and no Attach button', () => {
    h.query = { ...h.query, data: [line({ linkId: 'l1', procurementId: 'pr1', procurementTitle: 'Lab works' })] };
    renderIt();
    const row = screen.getByRole('row', { name: /ACC-JV-0001/ });
    expect(within(row).getByRole('link', { name: 'Lab works' })).toHaveAttribute('href', '/procurement/pr1');
    expect(screen.queryByRole('button', { name: /Attach/ })).toBeNull();
    expect(screen.queryByText(/no purchase was raised/)).toBeNull();
  });

  it('a role that cannot link sees the lines without an Attach button', () => {
    h.may.mockImplementation((action: string, entity: string) => !(action === 'create' && entity === 'erpPurchaseLink'));
    renderIt();
    expect(screen.getByRole('row', { name: /ACC-JV-0001/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Attach/ })).toBeNull();
  });

  it('FR-JEC-022: a cancelled line that is still attached keeps its purchase link next to the cancelled note', () => {
    h.query = { ...h.query, data: [line({ isCancelled: true, amount: 0, linkId: 'l1', procurementId: 'pr1', procurementTitle: 'Lab works' })] };
    renderIt();
    const row = screen.getByRole('row', { name: /ACC-JV-0001/ });
    expect(within(row).getByRole('link', { name: 'Lab works' })).toHaveAttribute('href', '/procurement/pr1');
    expect(row).toHaveTextContent('Cancelled in the accounting system');
  });

  it('FR-JEC-042: an attached line that may have been reversed says so', () => {
    h.query = { ...h.query, data: [line({ linkId: 'l1', procurementId: 'pr1', procurementTitle: 'Lab works', possiblyReversed: true })] };
    renderIt();
    expect(screen.getByRole('row', { name: /ACC-JV-0001/ })).toHaveTextContent('Possibly reversed');
  });

  it('FR-JEC-022: a line the accounting system cancelled says so and cannot be attached', () => {
    h.query = { ...h.query, data: [line({ isCancelled: true, amount: 0 })] };
    renderIt();
    expect(screen.getByRole('row', { name: /ACC-JV-0001/ })).toHaveTextContent('Cancelled in the accounting system');
    expect(screen.queryByRole('button', { name: /Attach/ })).toBeNull();
  });

  it('AC-JEC-016: no lines → nothing is rendered (an org reading no ledger gets none)', () => {
    h.query = { ...h.query, data: [] };
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-JEC-016: a member who cannot view procurement sees nothing', () => {
    h.may.mockImplementation((action: string, entity: string) => !(action === 'view' && entity === 'procurement'));
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });

  it('a failed read offers a retry', async () => {
    h.query = { ...h.query, data: undefined, isError: true };
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.query.refetch).toHaveBeenCalled();
  });
});
