/** FR-PFE-020/023 — pick an open purchase and link the documents to it; refusals read as plain sentences. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const linkMock = vi.fn();
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: linkMock, isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [
  { id: 'pur-1', title: 'Steel', status: 'Ordered', project_id: 'p1', vendor: { name: 'Supplier One' } },
  { id: 'pur-2', title: 'Other', status: 'Ordered', project_id: 'p2', vendor: null },
  { id: 'pur-3', title: 'Old', status: 'Cancelled', project_id: 'p1', vendor: null },
  { id: 'pur-4', title: 'Unscoped', status: 'Draft', project_id: null, vendor: null },
  { id: 'pur-5', title: 'Pending', status: 'Requested', project_id: 'p1', vendor: null }] }) }));

import { LinkErpDocumentsDialog } from './LinkErpDocumentsDialog';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';

const doc = (name: string, over: Partial<ErpPurchaseRow> = {}): ErpPurchaseRow => ({
  id: name, doctype: 'Purchase Invoice', name, supplier: 'S', docDate: null, dueDate: null, billNo: null, currency: 'IDR',
  grandTotal: 1, netTotal: 1, outstanding: 0, erpStatus: null, isReturn: false, projectIds: ['p1'], procurementId: null, linkId: null, ...over,
});

const optionNames = async () => {
  await userEvent.click(screen.getByRole('combobox'));
  return (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
};

beforeEach(() => linkMock.mockReset());

describe('LinkErpDocumentsDialog', () => {
  it('AC-PFE-004: links the chosen documents to the chosen open purchase of the project', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 0 },
      results: [{ row: 1, outcome: 'link', procurement_id: 'pur-1' }] });
    const onLinked = vi.fn();
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={() => {}} onLinked={onLinked} />);
    expect(screen.getByRole('dialog', { name: 'Link PINV-1 to a purchase' })).toBeVisible();
    const names = await optionNames();
    expect(names.some((n) => n.includes('Steel'))).toBe(true);
    expect(names.some((n) => n.includes('Other') || n.includes('Old') || n.includes('Unscoped'))).toBe(false);
    await userEvent.click(screen.getByRole('option', { name: /Steel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(linkMock).toHaveBeenCalledWith({ rows: [{ erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', procurement_id: 'pur-1' }] });
    expect(onLinked).toHaveBeenCalledWith('pur-1');
  });

  it('org-wide: offers open purchases on the documents\' project; a document with no project may join any open purchase', async () => {
    const { unmount } = render(<LinkErpDocumentsDialog docs={[doc('PINV-1', { projectIds: ['p2'] })]} onClose={() => {}} onLinked={() => {}} />);
    const scoped = await optionNames();
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toContain('Other');
    unmount();
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1', { projectIds: [] }), doc('PINV-2', { projectIds: [] })]} onClose={() => {}} onLinked={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Link 2 documents to a purchase' })).toBeVisible();
    const names = await optionNames();
    expect(names.length).toBe(3);
    expect(names.some((n) => n.includes('Old'))).toBe(false);
  });

  it('a purchase waiting for approval is not offered, and the dialog says why instead of letting the link fail', async () => {
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={() => {}} onLinked={() => {}} />);
    expect(screen.getByText(/1 purchases? on this project (is|are) waiting for approval/)).toBeVisible();
    const names = await optionNames();
    expect(names.some((n) => n.includes('Pending'))).toBe(false);
  });

  it('no approval note when no purchase is waiting', () => {
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1', { projectIds: ['p2'] })]} onClose={() => {}} onLinked={() => {}} />);
    expect(screen.queryByText(/waiting for approval/)).toBeNull();
  });

  it('Link stays disabled until a purchase is chosen', () => {
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={() => {}} onLinked={() => {}} />);
    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled();
  });

  it('FR-PFE-023: when nothing links, each refusal is listed with its reason and the dialog stays open', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 0, skip: 0, refused: 2 }, results: [
      { row: 1, erp_name: 'PINV-1', outcome: 'refused', reason: 'supplier_mismatch', procurement_id: null },
      { row: 2, erp_name: 'PINV-2', outcome: 'refused', reason: 'currency_mismatch', procurement_id: null }] });
    const onLinked = vi.fn();
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1'), doc('PINV-2')]} projectId="p1" onClose={() => {}} onLinked={onLinked} />);
    await optionNames();
    await userEvent.click(screen.getByRole('option', { name: /Steel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nothing was linked.');
    expect(alert).toHaveTextContent('PINV-1: The supplier differs');
    expect(alert).toHaveTextContent('PINV-2: The document’s currency differs from this purchase.');
    expect(alert.querySelector('p ul, p li')).toBeNull();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('FR-PFE-023: when some link, the dialog closes and hands the refusals back (no "nothing was saved")', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 1 }, results: [
      { row: 1, erp_name: 'PINV-1', outcome: 'link', procurement_id: 'pur-1' },
      { row: 2, erp_name: 'PINV-2', outcome: 'refused', reason: 'currency_mismatch', procurement_id: null }] });
    const onLinked = vi.fn();
    const onPartiallyLinked = vi.fn();
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1'), doc('PINV-2')]} projectId="p1" onClose={() => {}} onLinked={onLinked}
      onPartiallyLinked={onPartiallyLinked} />);
    await optionNames();
    await userEvent.click(screen.getByRole('option', { name: /Steel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(onPartiallyLinked).toHaveBeenCalledWith('1 of 2 documents were linked. The rest were not:',
      ['PINV-2: The document’s currency differs from this purchase.']);
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('a rejected call is shown in the dialog in plain words', async () => {
    linkMock.mockRejectedValueOnce(Object.assign(new Error('separation of duties: approver cannot pay own procurement'), { code: 'P0001' }));
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={() => {}} onLinked={() => {}} />);
    await optionNames();
    await userEvent.click(screen.getByRole('option', { name: /Steel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('Cancel closes without linking', async () => {
    const onClose = vi.fn();
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={onClose} onLinked={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(linkMock).not.toHaveBeenCalled();
  });
});
