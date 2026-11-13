import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';

const { linkMock } = vi.hoisted(() => ({ linkMock: vi.fn() }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: linkMock, isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ isPending: false, isError: false, refetch: vi.fn(), data: [
  { id: 'pur-1', title: 'Steel procurement', status: 'Ordered', project_id: 'p1', currency: 'IDR', vendor: { name: 'Supplier One' } },
] }) }));

import { ErpOrphansSection } from './ErpOrphansSection';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';

const row = (name: string, over: Partial<ErpPurchaseRow> = {}): ErpPurchaseRow => ({
  id: name, doctype: 'Purchase Invoice', name, supplier: 'Supplier One', docDate: '2026-10-01', dueDate: null, billNo: null,
  currency: 'IDR', grandTotal: 1_110, netTotal: 1_000, outstanding: 1_110, erpStatus: 'Unpaid', isReturn: false,
  projectIds: ['p1'], procurementId: null, linkId: null, ...over,
});

const renderAt = (ui: React.ReactElement) => render(
  <MemoryRouter initialEntries={['/here']}><ToastProvider><Routes>
    <Route path="/here" element={ui} />
    <Route path="/procurement/:id" element={<p>purchase page</p>} />
  </Routes></ToastProvider></MemoryRouter>,
);
const bulkBar = () => screen.getByRole('group', { name: 'Selected documents' });
const openMenu = async (name: string) => userEvent.click(screen.getByRole('button', { name: `Link ${name}` }));

beforeEach(() => linkMock.mockReset());

describe('ERP orphan floor controls', () => {
  it('floor: orphan row selection checks the named document and updates the selected count', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2')]} canLink projectNames={new Map([['p1', 'Project One']])} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-2' }));
    expect(screen.getByRole('checkbox', { name: 'Select PINV-2' })).toBeChecked();
    expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument();
    expect(within(bulkBar()).getByRole('button', { name: 'Link 1 to purchase' })).toBeInTheDocument();
  });

  it('floor: orphan row Link menu opens the link dialog for that document', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1')]} canLink projectNames={new Map([['p1', 'Project One']])} />);
    await openMenu('PINV-1');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Link to purchase' }));
    expect(screen.getByRole('dialog', { name: 'Link PINV-1 to a purchase' })).toBeInTheDocument();
  });

  it('floor: Select all checks every visible orphan document', async () => {
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2'), row('PINV-3')]} canLink projectNames={new Map([['p1', 'Project One']])} />);
    await userEvent.click(within(bulkBar()).getByRole('checkbox', { name: 'Select all 3 documents' }));
    expect(screen.getByRole('checkbox', { name: 'Select PINV-1' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select PINV-2' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select PINV-3' })).toBeChecked();
    expect(within(bulkBar()).getByText('3 selected')).toBeInTheDocument();
  });

  it('floor: Bulk Link confirms every selected document against the chosen procurement', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 2, skip: 0, refused: 0 }, results: [
      { row: 1, erp_name: 'PINV-1', outcome: 'link', procurement_id: 'pur-1' },
      { row: 2, erp_name: 'PINV-2', outcome: 'link', procurement_id: 'pur-1' },
    ] });
    renderAt(<ErpOrphansSection rows={[row('PINV-1'), row('PINV-2')]} canLink projectNames={new Map([['p1', 'Project One']])} />);
    await userEvent.click(within(bulkBar()).getByRole('checkbox', { name: 'Select all 2 documents' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link 2 to purchase' }));
    expect(screen.getByRole('dialog', { name: 'Link 2 documents to a purchase' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: /Steel procurement/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(linkMock).toHaveBeenCalledWith({ rows: [
      { erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', procurement_id: 'pur-1' },
      { erp_doctype: 'Purchase Invoice', erp_name: 'PINV-2', procurement_id: 'pur-1' },
    ] });
  });
});
