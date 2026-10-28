/** FR-PFE-020/023 — pick an open purchase and link the documents to it; refusals are prevented where the client can tell. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const linkMock = vi.fn();
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: linkMock, isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [
  { id: 'pur-1', title: 'Steel', status: 'Ordered', project_id: 'p1', currency: 'IDR', vendor: { name: 'Supplier One' } },
  { id: 'pur-2', title: 'Other', status: 'Ordered', project_id: 'p2', currency: 'IDR', vendor: null },
  { id: 'pur-3', title: 'Old', status: 'Cancelled', project_id: 'p1', currency: 'IDR', vendor: null },
  { id: 'pur-4', title: 'Unscoped', status: 'Draft', project_id: null, currency: 'IDR', vendor: null },
  { id: 'pur-5', title: 'Pending', status: 'Requested', project_id: 'p1', currency: 'IDR', vendor: null },
  { id: 'pur-6', title: 'Settled', status: 'Paid', project_id: 'p1', currency: 'IDR', vendor: { name: 'Supplier One' } },
  { id: 'pur-7', title: 'Cables', status: 'Received', project_id: 'p1', currency: 'IDR', vendor: { name: 'Another Vendor' } },
  { id: 'pur-8', title: 'Imported', status: 'Ordered', project_id: 'p1', currency: 'USD', vendor: { name: 'supplier one ' } }] }) }));

import { LinkErpDocumentsDialog } from './LinkErpDocumentsDialog';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';

const doc = (name: string, over: Partial<ErpPurchaseRow> = {}): ErpPurchaseRow => ({
  id: name, doctype: 'Purchase Invoice', name, supplier: 'Supplier One', docDate: null, dueDate: null, billNo: null, currency: 'IDR',
  grandTotal: 1110, netTotal: 1000, outstanding: 0, erpStatus: null, isReturn: false, projectIds: ['p1'], procurementId: null, linkId: null, ...over,
});

const optionTexts = async () => {
  await userEvent.click(screen.getByRole('combobox'));
  return (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
};
const choose = async (name: RegExp) => {
  await optionTexts();
  await userEvent.click(screen.getByRole('option', { name }));
};

beforeEach(() => linkMock.mockReset());

describe('LinkErpDocumentsDialog', () => {
  it('AC-PFE-004: links the chosen documents to the chosen open purchase of the project', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 0 },
      results: [{ row: 1, outcome: 'link', procurement_id: 'pur-1' }] });
    const onLinked = vi.fn();
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={() => {}} onLinked={onLinked} />);
    expect(screen.getByRole('dialog', { name: 'Link PINV-1 to a purchase' })).toBeVisible();
    await choose(/Steel/);
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(linkMock).toHaveBeenCalledWith({ rows: [{ erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', procurement_id: 'pur-1' }] });
    expect(onLinked).toHaveBeenCalledWith('pur-1');
  });

  it('review 2b: matching purchases come first; others are marked; Paid, closed and other projects are never offered', async () => {
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={() => {}} onLinked={() => {}} />);
    const texts = await optionTexts();
    expect(texts[0]).toContain('Steel');
    expect(texts.find((t) => t.includes('Cables'))).toContain('different supplier');
    expect(texts.find((t) => t.includes('Imported'))).toContain('different currency');
    expect(texts.find((t) => t.includes('Imported'))).not.toContain('different supplier');
    expect(texts.find((t) => t.includes('Steel'))).not.toMatch(/different/);
    // Warning marks are separate badges; the secondary detail line remains available for supplier and stage.
    const cablesSub = screen.getAllByRole('option').find((o) => o.textContent?.includes('Cables'))!.querySelector('[title]');
    expect(screen.getByText('different supplier')).toHaveClass('shrink-0', 'whitespace-nowrap');
    expect(cablesSub?.textContent).not.toContain('different supplier');
    expect(screen.getByText('different currency')).toHaveClass('shrink-0', 'whitespace-nowrap');
    for (const hidden of ['Settled', 'Old', 'Other', 'Unscoped', 'Pending']) expect(texts.some((t) => t.includes(hidden))).toBe(false);
  });

  it('review 9: options show the same stage labels as the purchase list', async () => {
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={() => {}} onLinked={() => {}} />);
    const texts = await optionTexts();
    expect(texts.find((t) => t.includes('Steel'))).toContain('Purchase Order');
    expect(texts.find((t) => t.includes('Cables'))).toContain('Goods Receipt');
  });

  it('review 11: a one-line summary names the count, the supplier and the pre-tax amount', () => {
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1'), doc('PINV-2', { netTotal: 500 })]} projectId="p1" onClose={() => {}} onLinked={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Link 2 documents to a purchase' })).toHaveTextContent(/2 documents · Supplier One · IDR\s?1[.,]500/);
  });

  it('review 11: documents from several suppliers or currencies say so instead of one supplier', () => {
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1'), doc('PINV-2', { supplier: 'Other Co', currency: 'USD', netTotal: 5 })]}
      onClose={() => {}} onLinked={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveTextContent(/2 documents · 2 suppliers · .*IDR\s?1[.,]000.*(USD|US\$|\$)\s?5/);
  });

  it('org-wide: a document with no project may join any open purchase on any project', async () => {
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1', { projectIds: [] })]} onClose={() => {}} onLinked={() => {}} />);
    const texts = await optionTexts();
    expect(texts.some((t) => t.includes('Other'))).toBe(true);
    expect(texts.some((t) => t.includes('Unscoped'))).toBe(true);
  });

  it('a purchase waiting for approval is not offered, and the dialog says why instead of letting the link fail', async () => {
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={() => {}} onLinked={() => {}} />);
    expect(screen.getByText(/1 purchases? on this project (is|are) waiting for approval/)).toBeVisible();
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
    await choose(/Steel/);
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nothing was linked.');
    expect(alert).toHaveTextContent('PINV-1: The supplier differs');
    expect(alert).toHaveTextContent('PINV-2: The document’s currency differs from this purchase.');
    expect(alert.querySelector('p ul, p li')).toBeNull();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('FR-PFE-023: when some link, the dialog hands back what was linked where and what was refused', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 1 }, results: [
      { row: 1, erp_name: 'PINV-1', outcome: 'link', procurement_id: 'pur-1' },
      { row: 2, erp_name: 'PINV-2', outcome: 'refused', reason: 'currency_mismatch', procurement_id: null }] });
    const onLinked = vi.fn();
    const onPartiallyLinked = vi.fn();
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1'), doc('PINV-2')]} projectId="p1" onClose={() => {}} onLinked={onLinked}
      onPartiallyLinked={onPartiallyLinked} />);
    await choose(/Steel/);
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(onPartiallyLinked).toHaveBeenCalledWith({ procurementId: 'pur-1', linked: 1,
      refused: ['PINV-2: The document’s currency differs from this purchase.'] });
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('a rejected call is shown in the dialog in plain words', async () => {
    linkMock.mockRejectedValueOnce(Object.assign(new Error('separation of duties: approver cannot pay own procurement'), { code: 'P0001' }));
    render(<LinkErpDocumentsDialog docs={[doc('PINV-1')]} projectId="p1" onClose={() => {}} onLinked={() => {}} />);
    await choose(/Steel/);
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
