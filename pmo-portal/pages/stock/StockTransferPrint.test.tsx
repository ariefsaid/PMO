import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import i18next from 'i18next';
import { setOrgTerms } from '@/src/lib/i18n/orgTerms';
import { setOrgRoleNames } from '@/src/hooks/useOrgRoleNames';
import stockEn from '@/public/locales/en/stock.json';

import i18nextRuntime from 'i18next';
import { orgTermsPlugin } from '@/src/lib/i18n';
const h = vi.hoisted(() => ({ enabled: true, blocks: ['Dispatched by', 'Received by'] }));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useDeliveryNoteSettings: () => ({ isPending: false, data: { enabled: h.enabled, signatureBlocks: h.blocks } }) }));
vi.mock('@/src/hooks/useOrgName', () => ({ useOrgName: () => 'Acme' }));
vi.mock('@/src/hooks/useStockTransfers', () => ({ useStockTransfer: () => ({ isPending: false, isError: false, data: { id: 't1', number: 'TST-1', fromWarehouseId: 'w1', toWarehouseId: 'w2', note: null, sentAt: '2026-11-20T08:00:00Z', lines: [{ id: 'l1', lineNo: 1, itemId: 'i1', qtySent: '10' }] }, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: () => ({ data: [{ id: 'i1', code: 'PIPE', name: 'Pipe', unit_id: 'u1' }] }), useStockUnits: () => ({ data: [{ id: 'u1', code: 'm' }] }),
  useStockWarehouses: () => ({ data: [{ id: 'w1', code: 'CEN', name: 'Central store' }, { id: 'w2', code: 'S1', name: 'Site one' }] }),
}));
import StockTransferPrint from './StockTransferPrint';

// The shipped runtime registers this plugin at boot; the test instance does not, so attach it here.
orgTermsPlugin.init(i18nextRuntime);

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
const renderPage = () => render(<MemoryRouter initialEntries={['/stock/transfers/t1/print']}><Routes><Route path="/stock/transfers/:transferId/print" element={<StockTransferPrint />} /></Routes></MemoryRouter>);

describe('StockTransferPrint (#1122 item 7)', () => {
  it('JOB-1122-7 prints the lines with where they go and the organisation signature blocks', () => {
    h.enabled = true;
    renderPage();
    expect(screen.getAllByText('TST-1').length).toBeGreaterThan(0);
    expect(screen.getByText('PIPE')).toBeInTheDocument();
    expect(screen.getByText('CEN · Central store')).toBeInTheDocument();
    expect(screen.getByText('Received by')).toBeInTheDocument();
  });
  it('AC-TR-010 shows a renamed term in the title and a renamed role on the signature line', () => {
    h.enabled = true;
    setOrgTerms({ en: { deliveryNote: { singular: 'dispatch docket', plural: 'dispatch dockets' } } });
    setOrgRoleNames({ en: { storekeeper: 'Yard keeper' } });
    h.blocks = ['Storekeeper', 'Received by'];
    renderPage();
    expect(screen.getAllByText(/Dispatch docket/).length).toBeGreaterThan(0);
    expect(screen.getByText('Yard keeper')).toBeInTheDocument();
    expect(screen.queryByText('Storekeeper')).not.toBeInTheDocument();
    setOrgTerms({});
    setOrgRoleNames({});
    h.blocks = ['Dispatched by', 'Received by'];
  });
  it('says why when delivery notes are off', () => {
    h.enabled = false;
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(/switched off/);
  });
});
