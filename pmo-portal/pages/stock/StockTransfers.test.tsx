import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ navigate: vi.fn(), twoStep: true, rows: [] as unknown[] }));
vi.mock('react-router', async (orig) => ({ ...(await orig<typeof import('react-router')>()), useNavigate: () => h.navigate }));
vi.mock('@/src/hooks/useStockTransfers', () => ({
  useIsTwoStep: () => h.twoStep,
  useStockTransfers: () => ({ isPending: false, isError: false, data: h.rows, refetch: vi.fn() }),
  useProofStatus: () => ({ data: [{ movementId: 't3', proofStatus: 'outstanding' }] }),
}));
vi.mock('@/src/hooks/useStock', () => ({ useStockWarehouses: () => ({ data: [{ id: 'w1', name: 'Central store' }, { id: 'w2', name: 'Site A store' }] }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));
vi.mock('@/src/components/stock/StockTabs', () => ({ StockTabs: () => null }));

import StockTransfers from './StockTransfers';

const line = (extra: Record<string, unknown> = {}) => ({ id: 'l', lineNo: 1, itemId: 'i1', qtySent: '10', qtyCounted: null, qtyAccepted: null, qtyRejected: null, rejectReason: null, qualityResult: null, shortResolution: null, shortReason: null, ...extra });
const transfer = (id: string, number: string, status: string, lines = [line()]) => ({ id, number, status, fromWarehouseId: 'w1', toWarehouseId: 'w2', sentAt: '2026-11-20T08:00:00Z', lines });

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  h.navigate.mockReset(); h.twoStep = true;
  h.rows = [
    transfer('t1', 'TST-1', 'Sent'),
    transfer('t2', 'TST-2', 'Closed'),
    transfer('t3', 'TST-3', 'Received', [line({ qtyCounted: '7', qtyAccepted: '7' })]),
  ];
});
const renderPage = () => render(<MemoryRouter><StockTransfers /></MemoryRouter>);

describe('stock transfers list', () => {
  it('lists a shortfall waiting for a decision first, then what is in transit, then what is closed', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Two-step transfers' });
    const text = table.textContent ?? '';
    expect(text.indexOf('Short, waiting for a decision (1)')).toBeLessThan(text.indexOf('In transit (1)'));
    expect(text.indexOf('In transit (1)')).toBeLessThan(text.indexOf('Closed (1)'));
  });

  it('a row opens its transfer, and the open shortfall and missing proof are read in the row link', async () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'TST-3' });
    expect(link).toHaveAttribute('href', '/stock/transfers/t3');
    expect(within(link).getByText('1 shortfall open · Proof outstanding')).toBeInTheDocument();
    await userEvent.click(link);
    expect(h.navigate).toHaveBeenCalledWith('/stock/transfers/t3');
  });

  it('says two-step transfers are off when the organisation has not turned them on', () => {
    h.twoStep = false;
    renderPage();
    expect(screen.getByText('Two-step stock transfers are off')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Send stock transfer' })).not.toBeInTheDocument();
  });
});
