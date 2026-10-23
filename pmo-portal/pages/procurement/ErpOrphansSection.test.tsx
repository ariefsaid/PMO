/** FR-PFE-041 / AC-PFE-006 — ERPNext documents not in a purchase: single and bulk link / new purchase. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const linkMock = vi.fn();
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: linkMock, isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [{ id: 'pur-1', title: 'Steel', status: 'Ordered', project_id: 'p1', vendor: null }] }) }));

import { ErpOrphansSection } from './ErpOrphansSection';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';

const row = (n: string, over: Partial<ErpPurchaseRow> = {}): ErpPurchaseRow => ({
  id: n, doctype: 'Purchase Invoice', name: n, supplier: 'Supplier One', docDate: '2026-02-01', dueDate: null,
  billNo: null, currency: 'IDR', grandTotal: 1000, netTotal: 900, outstanding: 0, erpStatus: 'Paid', isReturn: false,
  projectIds: ['p1'], procurementId: null, linkId: null, ...over,
});

const renderAt = (ui: React.ReactElement) => render(
  <MemoryRouter initialEntries={['/here']}>
    <Routes>
      <Route path="/here" element={ui} />
      <Route path="/procurement/:id" element={<p>purchase page</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => linkMock.mockReset());

describe('ErpOrphansSection', () => {
  it('AC-PFE-006: each orphan offers Link to purchase and New purchase from this; selecting two offers bulk actions', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2'), row('PINV-3')]} projectId="p1" canLink />);
    expect(screen.getAllByRole('button', { name: /^Link to purchase/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^New purchase from this/ })).toHaveLength(3);
    expect(screen.queryByRole('group', { name: 'Selected documents' })).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-2' }));
    const bar = screen.getByRole('group', { name: 'Selected documents' });
    expect(within(bar).getByRole('button', { name: 'Link 2 to purchase' })).toBeVisible();
    expect(within(bar).getByRole('button', { name: 'New purchase from 2' })).toBeVisible();
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('group', { name: 'Selected documents' })).toBeNull();
  });

  it('select all picks every listed document and a second press clears them', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2'), row('PINV-3')]} projectId="p1" canLink />);
    const all = screen.getByRole('checkbox', { name: 'Select all 3 documents' });
    await userEvent.click(all);
    expect(screen.getByRole('button', { name: 'Link 3 to purchase' })).toBeVisible();
    expect(all).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(all);
    expect(screen.queryByRole('group', { name: 'Selected documents' })).toBeNull();
  });

  it('AC-PFE-006: New purchase from this links the document into a new purchase on the project and opens it', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 0 },
      results: [{ row: 1, outcome: 'link', reason: null, procurement_id: 'new-1', new_purchase: true }] });
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink />);
    await userEvent.click(screen.getByRole('button', { name: /^New purchase from this/ }));
    expect(linkMock).toHaveBeenCalledWith({ rows: [{ erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', project_id: 'p1' }] });
    expect(await screen.findByText('purchase page')).toBeInTheDocument();
  });

  it('bulk New purchase groups the selected documents into one purchase', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 2, skip: 0, refused: 0 }, results: [
      { row: 1, outcome: 'link', reason: null, procurement_id: 'new-1', new_purchase: true },
      { row: 2, outcome: 'link', reason: null, procurement_id: 'new-1', new_purchase: false }] });
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2')]} projectId="p1" canLink />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-2' }));
    await userEvent.click(screen.getByRole('button', { name: 'New purchase from 2' }));
    expect(linkMock).toHaveBeenCalledWith({ rows: [
      { erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', project_id: 'p1', group: 'bulk-PINV-1' },
      { erp_doctype: 'Purchase Invoice', erp_name: 'PINV-2', project_id: 'p1', group: 'bulk-PINV-1' }] });
    expect(await screen.findByText('purchase page')).toBeInTheDocument();
  });

  it('org-wide: a document attributed to one project lands on that project; an unattributed one on none', async () => {
    linkMock.mockResolvedValue({ dry_run: false, counts: { link: 1, skip: 0, refused: 0 },
      results: [{ row: 1, outcome: 'link', reason: null, procurement_id: 'new-1', new_purchase: true }] });
    renderAt(<ErpOrphansSection rows={[row('PINV-1', { projectIds: ['p9'] }), row('PINV-2', { projectIds: [] })]} canLink />);
    const [first, second] = screen.getAllByRole('button', { name: /^New purchase from this/ });
    await userEvent.click(second);
    expect(linkMock).toHaveBeenLastCalledWith({ rows: [{ erp_doctype: 'Purchase Invoice', erp_name: 'PINV-2', project_id: null }] });
    expect(first).toBeDefined();
  });

  it('a refused row shows its reason in plain words and nothing navigates', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 0, skip: 0, refused: 1 },
      results: [{ row: 1, erp_name: 'PINV-1', outcome: 'refused', reason: 'supplier_mismatch', procurement_id: null, new_purchase: false }] });
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink />);
    await userEvent.click(screen.getByRole('button', { name: /^New purchase from this/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PINV-1: The supplier differs');
    expect(screen.queryByText('purchase page')).toBeNull();
  });

  it('a rejected call is shown as a classified message, not thrown', async () => {
    linkMock.mockRejectedValueOnce(Object.assign(new Error('permission denied for function link_erp_purchase_documents'), { code: '42501' }));
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink />);
    await userEvent.click(screen.getByRole('button', { name: /^New purchase from this/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('link_erp_purchase_documents');
    expect(alert.textContent?.length).toBeGreaterThan(0);
  });

  it('shows document number, type, supplier, date and amount for receipts and payments too', () => {
    renderAt(<ErpOrphansSection rows={[row('MAT-PRE-1', { doctype: 'Purchase Receipt' }), row('ACC-PAY-1', { doctype: 'Payment Entry', grandTotal: null })]} projectId="p1" canLink={false} />);
    const receipt = screen.getByRole('row', { name: /MAT-PRE-1/ });
    expect(receipt).toHaveTextContent('Goods receipt');
    expect(receipt).toHaveTextContent('Supplier One');
    expect(receipt).toHaveTextContent(/1[.,]000/);
    expect(screen.getByRole('row', { name: /ACC-PAY-1/ })).toHaveTextContent('Supplier payment');
  });

  it('without link rights the rows are read-only', () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink={false} />);
    expect(screen.queryByRole('button', { name: /Link to purchase/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('a partly successful bulk link closes the dialog, keeps the user here and lists what was not linked', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 1 }, results: [
      { row: 1, erp_name: 'PINV-1', outcome: 'link', procurement_id: 'pur-1' },
      { row: 2, erp_name: 'PINV-2', outcome: 'refused', reason: 'currency_mismatch', procurement_id: null }] });
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2')]} projectId="p1" canLink />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all 2 documents' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link 2 to purchase' }));
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: /Steel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PINV-2: The document’s currency differs');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('purchase page')).toBeNull();
  });

  it('Link to purchase opens the link dialog for that document', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink />);
    await userEvent.click(screen.getByRole('button', { name: /^Link to purchase/ }));
    expect(screen.getByRole('dialog', { name: 'Link PINV-1 to a purchase' })).toBeVisible();
  });
});
