/** FR-PFE-041 / AC-PFE-006 — ERPNext documents not in a purchase: one "Link…" action per row, bulk link / new purchase. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { linkMock, exportXlsxMock } = vi.hoisted(() => ({ linkMock: vi.fn(), exportXlsxMock: vi.fn() }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: linkMock, isPending: false }) }));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: exportXlsxMock, busy: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [
  { id: 'pur-1', title: 'Steel', status: 'Ordered', project_id: 'p1', currency: 'IDR', vendor: { name: 'Supplier One' } }] }) }));

import { ErpOrphansSection } from './ErpOrphansSection';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { buildExportRows } from '@/src/lib/export';

const row = (n: string, over: Partial<ErpPurchaseRow> = {}): ErpPurchaseRow => ({
  id: n, doctype: 'Purchase Invoice', name: n, supplier: 'Supplier One', docDate: '2026-02-01', dueDate: null,
  billNo: null, currency: 'IDR', grandTotal: 1110, netTotal: 1000, outstanding: 0, erpStatus: 'Paid', isReturn: false,
  projectIds: ['p1'], procurementId: null, linkId: null, ...over,
});

const renderAt = (ui: React.ReactElement) => render(
  <MemoryRouter initialEntries={['/here']}>
    <Routes>
      <Route path="/here" element={ui} />
      <Route path="/procurement/:id" element={<p>purchase page</p>} />
      <Route path="/projects/:id/procurement" element={<p>project page</p>} />
    </Routes>
  </MemoryRouter>,
);

const openMenu = async (name: string) => userEvent.click(screen.getByRole('button', { name: `Link ${name}` }));
const bulkBar = () => screen.getByRole('group', { name: 'Selected documents' });

beforeEach(() => {
  linkMock.mockReset();
  exportXlsxMock.mockReset();
});

describe('ErpOrphansSection', () => {
  it('distinguishes unavailable project references from an untagged document', () => {
    renderAt(<ErpOrphansSection rows={[row('MIXED', { projectIds: ['p1', 'missing-1', 'missing-2'] }), row('NONE', { projectIds: [] })]} canLink={false} projectNames={new Map([['p1', 'Tower']])} />);
    expect(screen.getByRole('row', { name: /MIXED/ })).toHaveTextContent('Tower, Project unavailable (missing-1), Project unavailable (missing-2)');
    expect(screen.getByRole('row', { name: /NONE/ })).toHaveTextContent('No project');
  });
  it('exports every unavailable project ID in mixed rows and keeps genuinely untagged rows distinct', async () => {
    const rows = [
      row('MIXED', { projectIds: ['p1', 'missing-1', 'missing-2'] }),
      row('NONE', { projectIds: [] }),
    ];
    renderAt(<ErpOrphansSection rows={rows} canLink={false} projectNames={new Map([['p1', 'Tower']])} />);

    await userEvent.click(screen.getByRole('button', { name: 'Export list' }));

    expect(exportXlsxMock).toHaveBeenCalledTimes(1);
    const [exportRows, columns] = exportXlsxMock.mock.calls[0] as [ErpPurchaseRow[], Parameters<typeof buildExportRows<ErpPurchaseRow>>[1], string];
    const exported = buildExportRows(exportRows, columns);
    const projectColumn = exported.header.indexOf('Project');
    expect(exported.body.map((values) => values[projectColumn])).toEqual([
      'Tower (p1), Project unavailable (missing-1), Project unavailable (missing-2)',
      'No project',
    ]);
  });
  it('AC-PFE-006: each orphan has one "Link…" action offering Link to purchase and New purchase from this', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2'), row('PINV-3')]} projectId="p1" canLink />);
    const triggers = screen.getAllByRole('button', { name: /^Link PINV-/ });
    expect(triggers).toHaveLength(3);
    expect(triggers[0]).toHaveTextContent('Link…');
    await openMenu('PINV-1');
    expect(screen.getByRole('menuitem', { name: 'Link to purchase' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'New purchase from this' })).toBeVisible();
  });

  it('AC-PFE-006: selecting two offers the bulk actions and hides the per-row actions; Clear restores them', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2'), row('PINV-3')]} projectId="p1" canLink />);
    expect(within(bulkBar()).queryByRole('button', { name: /to purchase/ })).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-2' }));
    expect(within(bulkBar()).getByRole('button', { name: 'Link 2 to purchase' })).toBeVisible();
    expect(within(bulkBar()).getByRole('button', { name: 'New purchase from 2' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Link PINV-/ })).toBeNull();
    await userEvent.click(within(bulkBar()).getByRole('button', { name: 'Clear' }));
    expect(screen.getAllByRole('button', { name: /^Link PINV-/ })).toHaveLength(3);
  });

  it('the bulk bar stays mounted (no list shift) and carries select all, so it also works on phone cards', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2'), row('PINV-3')]} projectId="p1" canLink />);
    const all = within(bulkBar()).getByRole('checkbox', { name: 'Select all 3 documents' });
    await userEvent.click(all);
    expect(all).toHaveAttribute('aria-checked', 'true');
    expect(within(bulkBar()).getByRole('button', { name: 'Link 3 to purchase' })).toBeVisible();
    await userEvent.click(all);
    expect(bulkBar()).toBeInTheDocument();
    expect(all).toHaveAttribute('aria-checked', 'false');
  });

  it('row checkboxes keep a 24px touch target on phones', () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink />);
    expect(screen.getByRole('checkbox', { name: 'Select PINV-1' }).className).toMatch(/max-\[767px\]:!size-6/);
  });

  it('decision 3: the amount shown is the pre-tax total, under "Amount (pre-tax)"; a payment shows its paid amount', () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('ACC-PAY-1', { doctype: 'Payment Entry', grandTotal: 777, netTotal: null })]}
      projectId="p1" canLink={false} />);
    expect(screen.getByRole('columnheader', { name: /Amount \(pre-tax\)/ })).toBeInTheDocument();
    const invoice = screen.getByRole('row', { name: /PINV-1/ });
    expect(invoice).toHaveTextContent(/1[.,]000/);
    expect(invoice).not.toHaveTextContent(/1[.,]110/);
    expect(screen.getByRole('row', { name: /ACC-PAY-1/ })).toHaveTextContent('777');
  });

  it('AC-PFE-006: New purchase from this links the document into a new purchase on the project and opens it', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 0 },
      results: [{ row: 1, outcome: 'link', reason: null, procurement_id: 'new-1', new_purchase: true }] });
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink />);
    await openMenu('PINV-1');
    await userEvent.click(screen.getByRole('menuitem', { name: 'New purchase from this' }));
    expect(linkMock).toHaveBeenCalledWith({ rows: [{ erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', project_id: 'p1' }] });
    expect(await screen.findByText('purchase page')).toBeInTheDocument();
  });

  it('bulk New purchase groups the selected documents into one purchase and opens it', async () => {
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

  it('review 1: a mixed bulk result says what was made (with a link to it) and what was not, and stays here', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 1 }, results: [
      { row: 1, erp_name: 'PINV-1', outcome: 'link', reason: null, procurement_id: 'new-1', new_purchase: true },
      { row: 2, erp_name: 'PINV-2', outcome: 'refused', reason: 'currency_mismatch', procurement_id: null, new_purchase: false }] });
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2')]} projectId="p1" canLink />);
    await userEvent.click(within(bulkBar()).getByRole('checkbox', { name: 'Select all 2 documents' }));
    await userEvent.click(screen.getByRole('button', { name: 'New purchase from 2' }));
    const result = await screen.findByRole('alert');
    expect(result).toHaveTextContent('1 added to');
    expect(within(result).getByRole('link', { name: 'a new purchase' })).toHaveAttribute('href', '/procurement/new-1');
    expect(result).toHaveTextContent('1 not added');
    expect(result).toHaveTextContent('PINV-2: The document’s currency differs from this purchase.');
    expect(screen.queryByText('purchase page')).toBeNull();
  });

  it('review 2a: org-wide, an order split across projects offers its projects instead of a one-click new purchase', async () => {
    const names = new Map([['p1', 'Tower'], ['p2', 'Plant']]);
    renderAt(<ErpOrphansSection rows={[row('PUR-ORD-1', { doctype: 'Purchase Order', projectIds: ['p1', 'p2'] })]} canLink projectNames={names} />);
    await openMenu('PUR-ORD-1');
    expect(screen.queryByRole('menuitem', { name: 'New purchase from this' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open Plant to add it' }));
    expect(await screen.findByText('project page')).toBeInTheDocument();
    expect(linkMock).not.toHaveBeenCalled();
  });

  it.each([
    ['org-wide', {}],
    ['on a project tab', { projectId: 'p1' }],
  ])('an invoice split across projects cannot be linked %s; the menu says how to add it instead', async (_where, scope) => {
    const names = new Map([['p1', 'Tower'], ['p2', 'Plant']]);
    renderAt(<ErpOrphansSection rows={[row('PINV-1', { projectIds: ['p1', 'p2'] })]} canLink projectNames={names} {...scope} />);
    await openMenu('PINV-1');
    expect(screen.queryByRole('menuitem', { name: 'Link to purchase' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'New purchase from this' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Open .* to add it$/ })).toBeNull();
    const blocked = screen.getByRole('menuitem', { name: 'Split across projects: link it per project in ERPNext, or record it in PMO' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(blocked);
    expect(linkMock).not.toHaveBeenCalled();
  });

  it('org-wide, an untagged document can start an explicit no-project purchase', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 0 }, results: [
      { row: 1, erp_name: 'PUR-ORD-1', outcome: 'link', reason: null, procurement_id: 'new-1', new_purchase: true }] });
    renderAt(<ErpOrphansSection rows={[row('PUR-ORD-1', { projectIds: [] })]} canLink projectNames={new Map()} />);
    await openMenu('PUR-ORD-1');
    expect(screen.queryByRole('menuitem', { name: 'New purchase from this' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'New purchase with no project' }));
    expect(linkMock).toHaveBeenCalledWith({ rows: [{ erp_doctype: 'Purchase Invoice', erp_name: 'PUR-ORD-1', project_id: null }] });
    expect(await screen.findByText('purchase page')).toBeInTheDocument();
  });

  it('org-wide bulk New purchase works for untagged documents, and stays blocked only while one is split across projects', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1', { projectIds: ['p1'] }), row('PINV-2', { projectIds: [] }), row('PINV-3', { projectIds: ['p1', 'p2'] })]}
      canLink projectNames={new Map()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-2' }));
    expect(screen.getByRole('button', { name: 'New purchase from 2' })).toBeEnabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-3' }));
    expect(screen.getByRole('button', { name: 'New purchase from 3' })).toBeDisabled();
    expect(bulkBar()).toHaveTextContent('Open the project to add documents split across several projects.');
  });

  it('a rejected call is shown as a classified message, not thrown', async () => {
    linkMock.mockRejectedValueOnce(Object.assign(new Error('permission denied for function link_erp_purchase_documents'), { code: '42501' }));
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink />);
    await openMenu('PINV-1');
    await userEvent.click(screen.getByRole('menuitem', { name: 'New purchase from this' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('link_erp_purchase_documents');
    expect(alert.textContent?.length).toBeGreaterThan(0);
  });

  it('shows document number, type, supplier and date for receipts and payments too', () => {
    renderAt(<ErpOrphansSection rows={[row('MAT-PRE-1', { doctype: 'Purchase Receipt' }), row('ACC-PAY-1', { doctype: 'Payment Entry', grandTotal: null, netTotal: null })]} projectId="p1" canLink={false} />);
    const receipt = screen.getByRole('row', { name: /MAT-PRE-1/ });
    expect(receipt).toHaveTextContent('Goods receipt');
    expect(receipt).toHaveTextContent('Supplier One');
    expect(screen.getByRole('row', { name: /ACC-PAY-1/ })).toHaveTextContent('Supplier payment');
  });

  it('without link rights the rows are read-only', () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink={false} />);
    expect(screen.queryByRole('button', { name: /Link/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Selected documents' })).toBeNull();
  });

  it('Link to purchase opens the link dialog for that document', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink />);
    await openMenu('PINV-1');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Link to purchase' }));
    expect(screen.getByRole('dialog', { name: 'Link PINV-1 to a purchase' })).toBeVisible();
  });

  it('a partly successful bulk link closes the dialog, stays here and says what was linked and what was not', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 1 }, results: [
      { row: 1, erp_name: 'PINV-1', outcome: 'link', procurement_id: 'pur-1' },
      { row: 2, erp_name: 'PINV-2', outcome: 'refused', reason: 'currency_mismatch', procurement_id: null }] });
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2')]} projectId="p1" canLink />);
    await userEvent.click(within(bulkBar()).getByRole('checkbox', { name: 'Select all 2 documents' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link 2 to purchase' }));
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: /Steel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    const result = await screen.findByRole('alert');
    expect(result).toHaveTextContent('1 linked to');
    expect(within(result).getByRole('link', { name: 'the purchase' })).toHaveAttribute('href', '/procurement/pur-1');
    expect(result).toHaveTextContent('PINV-2: The document’s currency differs');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('purchase page')).toBeNull();
  });
});
