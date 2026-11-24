import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import stockEn from '@/public/locales/en/stock.json';

const { reports } = vi.hoisted(() => ({ reports: { atRisk: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { reports } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
let realRole: Role = 'Project Manager';
let effectiveRole: Role | null = null;
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: effectiveRole ?? realRole }) }));

import StockAtRisk from './StockAtRisk';

const row = (over: Record<string, unknown> = {}) => ({
  warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site',
  projectId: 'p1', projectName: 'Pier rebuild',
  stockValue: '3000.00', coverValue: '2500.00', atRisk: '500.00', ...over,
});

const renderPage = (role: Role = 'Project Manager') => {
  realRole = role;
  effectiveRole = null;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter><StockAtRisk /></MemoryRouter></ToastProvider></QueryClientProvider>);
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  reports.atRisk.mockResolvedValue([row(), row({ warehouseId: 'w2', warehouseCode: 'SITE-C', warehouseName: 'Site C', projectId: null, projectName: null, stockValue: '750.00', coverValue: null, atRisk: '750.00' })]);
});
afterEach(() => vi.unstubAllGlobals());

describe('StockAtRisk (#2694)', () => {
  it('AC-SAR-301 the report leads with the exposed location and shows held value, cover and at risk beside it', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const first = within(table).getAllByRole('row')[1];
    expect(within(first).getByRole('rowheader')).toHaveTextContent('SITE-A');
    expect(within(first).getByText('Site A')).toBeInTheDocument();
    expect(within(first).getByText('Pier rebuild')).toBeInTheDocument();
    expect(within(first).getAllByText(/3,000/).length).toBeGreaterThan(0);
    expect(within(first).getAllByText(/2,500/).length).toBeGreaterThan(0);
    expect(within(first).getAllByText(/500/).length).toBeGreaterThan(0);
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['SITE-ASite A', 'SITE-CSite C']);
  });

  it('AC-SAR-301 the summary leads with the total at risk, then the total held, and counts the locations above cover', async () => {
    renderPage();
    await screen.findByText('SITE-A');
    const figures = screen.getAllByRole('figure');
    expect(figures[0]).toHaveTextContent('Value at risk');
    expect(figures[0]).toHaveTextContent(/1,250/);   // 500 + 750, summed on decimal strings
    expect(figures[1]).toHaveTextContent('Stock value held');
    expect(figures[1]).toHaveTextContent(/3,750/);   // 3,000 + 750
    expect(screen.getByText('2 above cover')).toBeInTheDocument();
    expect(screen.getByText('2 locations')).toBeInTheDocument();
  });

  it('AC-SAR-302 the money columns follow the DATA: absent when no row carries money keys', async () => {
    reports.atRisk.mockResolvedValue([{ warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site', projectId: null, projectName: null }]);
    renderPage('Engineer');
    await screen.findByText('SITE-A');
    expect(screen.queryByRole('columnheader', { name: 'Stock value' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Cover' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'At risk' })).not.toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('AC-SAR-305 the coordinator sees guard cover on a phone without money', async () => {
    vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
      matches: false, media, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    reports.atRisk.mockResolvedValue([
      { warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site', uncovered: true },
      { warehouseId: 'w2', warehouseCode: 'SITE-B', warehouseName: 'Site B', warehouseKind: 'site', uncovered: false },
    ]);
    renderPage('Engineer');
    const cards = await screen.findByTestId('dt-card-branch');
    expect(within(cards).getByText(stockEn.atRisk.noGuardCover)).toBeInTheDocument();
    expect(within(cards).getByText(stockEn.atRisk.guardCovered)).toBeInTheDocument();
    expect(within(cards).queryByText('Stock value')).not.toBeInTheDocument();
  });

  it('AC-SAR-303 a location with no cover recorded shows Not recorded, never a fabricated 0', async () => {
    renderPage();
    await screen.findByText('SITE-C');
    const table = screen.getByRole('table');
    const siteC = within(table).getByRole('row', { name: /SITE-C/ });
    expect(within(siteC).getByText('Not recorded')).toBeInTheDocument();
    expect(within(siteC).queryByText('0')).not.toBeInTheDocument();
  });

  it('AC-SAR-304 no location holds stock: the empty state says so', async () => {
    reports.atRisk.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No location holds stock')).toBeInTheDocument();
  });

  it('AC-SAR-304 a failed read is an error state with a working retry, never a dead end', async () => {
    reports.atRisk.mockRejectedValue(new AppError('boom', '500'));
    renderPage();
    expect(await screen.findByText(/couldn't load stock/i)).toBeInTheDocument();
    reports.atRisk.mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('No location holds stock')).toBeInTheDocument();
  });
});
