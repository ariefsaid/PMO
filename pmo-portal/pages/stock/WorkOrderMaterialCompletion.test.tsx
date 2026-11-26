import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ withCost: false, empty: false }));
const completion = () => ({
  rows: h.empty ? [] : [{ itemId: 'i1', itemCode: 'PIPE', itemName: 'Steel pipe', unitCode: 'm', issued: '10', returned: '2', movedIn: '5', movedOut: '1', countedDifference: '-1', balance: '3',
    ...(h.withCost ? { issuedValue: '40.0000', returnedValue: '8', balanceValue: '12.0000' } : {}) }],
  totals: h.empty ? [] : [{ unitCode: 'm', issued: '10', returned: '2', movedIn: '5', movedOut: '1', countedDifference: '-1', balance: '3' }],
  valueTotals: h.withCost ? { issued: '40.0000', returned: '8', balance: '12.0000' } : null,
});
vi.mock('@/src/hooks/useOrgName', () => ({ useOrgName: () => 'Acme' }));
vi.mock('@/src/hooks/useWorkOrderRecord', () => ({ useWorkOrder: () => ({ isPending: false, isError: false, data: { id: 'wo1', wo_number: 'WO-7', title: 'Pump house', currency: 'IDR' }, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useStockSiteWork', () => ({ useWorkOrderMaterialCompletion: () => ({ isPending: false, isError: false, data: completion(), refetch: vi.fn() }) }));
import WorkOrderMaterialCompletion from './WorkOrderMaterialCompletion';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { h.withCost = false; h.empty = false; });
const renderPage = () => render(<MemoryRouter initialEntries={['/work-orders/wo1/material-completion']}><Routes><Route path="/work-orders/:id/material-completion" element={<WorkOrderMaterialCompletion />} /></Routes></MemoryRouter>);

describe('WorkOrderMaterialCompletion (1124d)', () => {
  it('AC-WMC-001 lists each material with its issued, returned, moved, counted and balance figures, and totals per unit', () => {
    renderPage();
    expect(screen.getAllByText('Material completion').length).toBeGreaterThan(0);
    expect(screen.getByText('PIPE')).toBeInTheDocument();
    for (const h2 of ['Issued', 'Returned', 'Moved in', 'Moved out', 'Counted difference', 'Balance']) expect(screen.getAllByText(h2).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('material-completion-total').length).toBeGreaterThan(0);
    expect(screen.getByRole('rowheader', { name: 'Totals' })).toBeInTheDocument();
  });
  it('AC-WMC-003 shows no cost figures when the database sent none', () => {
    renderPage();
    expect(screen.queryByText('Issued value')).not.toBeInTheDocument();
    expect(screen.queryByTestId('material-completion-value-totals')).not.toBeInTheDocument();
  });
  it('AC-WMC-003 shows cost columns and value totals only when the database sent them', () => {
    h.withCost = true;
    renderPage();
    expect(screen.getAllByText('Issued value').length).toBeGreaterThan(0);
    expect(screen.getByTestId('material-completion-value-totals')).toBeInTheDocument();
  });
  it('AC-WMC-001 a work order with no movements says so instead of printing a row of zeros', () => {
    h.empty = true;
    renderPage();
    expect(screen.getByText('No material has moved on this work order.')).toBeInTheDocument();
  });
});
