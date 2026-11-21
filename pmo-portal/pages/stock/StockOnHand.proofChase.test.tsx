import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

const h = vi.hoisted(() => ({ timing: 'before_posting' as string, proof: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: {
  master: { listWarehouses: vi.fn().mockResolvedValue([]), listKeepers: vi.fn().mockResolvedValue([]) },
  reports: { onHand: vi.fn().mockResolvedValue([]) }, reorder: { worklist: vi.fn().mockResolvedValue([]) },
} } }));
vi.mock('@/src/lib/repositories/stockTransfers', () => ({ stockTransfersRepository: {
  settings: { get: () => Promise.resolve({ mode: 'one_step', proofTiming: h.timing }) },
  proofStatus: (...a: unknown[]) => h.proof(...a), list: vi.fn().mockResolvedValue([]),
} }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));

import StockOnHand from './StockOnHand';

const outstanding = { movementId: 'd1', number: 'TRF-001', mode: 'one_step', status: 'Posted', movementDate: '2026-11-10', fromWarehouseId: 'w1', fromWarehouseName: 'Central',
  toWarehouseId: 'w2', toWarehouseName: 'Site A', tagRules: ['paper'], requiredProof: 'paper', hasPaper: false, hasConfirmation: false, proofStatus: 'outstanding', missing: 'paper', proofCompletedAt: null };
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter><StockOnHand /></MemoryRouter></ToastProvider></QueryClientProvider>);

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => { h.proof.mockReset(); h.proof.mockResolvedValue([outstanding]); });

describe('StockOnHand proof chase card (#2689)', () => {
  it('AC-MAP-002 under before_posting the stock home shows no card and never reads the proof status', async () => {
    h.timing = 'before_posting';
    renderPage();
    await screen.findByText(/No stock|empty|On hand/i);
    expect(screen.queryByRole('region', { name: /Waiting for proof/ })).toBeNull();
    expect(h.proof).not.toHaveBeenCalled();
  });
  it('AC-MAP-001 under may_follow an Admin sees the waiting movement on the stock home', async () => {
    h.timing = 'may_follow';
    renderPage();
    expect(await screen.findByRole('region', { name: 'Waiting for proof (1)' })).toBeInTheDocument();
    expect(screen.getByText('TRF-001')).toBeInTheDocument();
  });
});
