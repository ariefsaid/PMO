import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

const { master, reports, consumption } = vi.hoisted(() => ({ master: { listKeepers: vi.fn(), listItems: vi.fn(), listWarehouses: vi.fn() }, reports: { ledgerPage: vi.fn() }, consumption: { report: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, reports, consumption } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
let role: Role = 'Engineer';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: role, effectiveRole: role }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-11-01' }) }));

import MaterialsTab from './MaterialsTab';

const renderTab = (r: Role) => {
  role = r;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter><MaterialsTab projectId="p1" /></MemoryRouter></ToastProvider></QueryClientProvider>);
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  master.listItems.mockResolvedValue([]); master.listWarehouses.mockResolvedValue([]);
  reports.ledgerPage.mockResolvedValue({ rows: [], nextBeforeSeq: null });
  consumption.report.mockResolvedValue({ from: 'a', to: 'b', months: [], allowances: [], unplanned: [] });
});

describe('Project Materials tab', () => {
  it('FR-STK-041 the embedded trace requests this project', async () => {
    master.listKeepers.mockResolvedValue([]);
    renderTab('Admin');
    await screen.findByText('Nothing posted yet');
    expect(reports.ledgerPage.mock.calls[0][0]).toMatchObject({ projectId: 'p1' });
  });

  it('FR-STK-064 Issue material shows for a keeper and Admin, links to the issue form with the project, and is absent for a non-keeper', async () => {
    master.listKeepers.mockResolvedValue([]);
    const a = renderTab('Admin');
    expect(await screen.findByRole('link', { name: /Issue material/ })).toHaveAttribute('href', '/stock/new/issue?project=p1');
    a.unmount();
    renderTab('Engineer');
    await screen.findByText('Nothing posted yet');
    expect(screen.queryByRole('link', { name: /Issue material/ })).not.toBeInTheDocument();
  });

  it('FR-STK-064 an Engineer who keeps a warehouse sees Issue material', async () => {
    master.listKeepers.mockResolvedValue([{ warehouse_id: 'w1', user_id: 'me', org_id: 'org-1' }]);
    renderTab('Engineer');
    expect(await screen.findByRole('link', { name: /Issue material/ })).toBeInTheDocument();
  });

  it('FR-STK-045 the tab leads with the consumption report for this project, above the trace', async () => {
    master.listKeepers.mockResolvedValue([]);
    renderTab('Engineer');
    expect(await screen.findByText('No material issued to this project in these months')).toBeInTheDocument();
    expect(consumption.report.mock.calls[0][0]).toBe('p1');
    const report = screen.getByRole('heading', { name: 'Consumption' });
    const trace = screen.getByRole('heading', { name: 'Movements' });
    expect(report.compareDocumentPosition(trace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
