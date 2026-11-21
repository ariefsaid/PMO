import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinancePosition } from '@/src/lib/finance/financePosition';

/** #2698 AC-PCH-009 — Finance sees the request's payment channel in the payables list, only where the org turned it on. */
const state = vi.hoisted(() => ({ on: false, names: {} as Record<string, string>, position: null as unknown }));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => entity === 'finance' && action === 'view' }));
vi.mock('@/src/hooks/usePaymentChannels', () => ({
  usePaymentChannelsOn: () => ({ on: state.on }),
  usePaymentChannelNames: () => ({ data: state.on ? state.names : undefined }),
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({ position: state.position, isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({
    data: (state.position as FinancePosition).payables.map(({ procurement, amount }) => ({
      ...procurement,
      procurement_invoices: [{ invoice_date: '2026-04-10', amount: (amount ?? 0) / 100, erp_outstanding_amount: (amount ?? 0) / 100 }],
    })),
    isPending: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-07-19', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: vi.fn(), busy: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }) }));

import PayablesPage from './PayablesPage';

function fixture(): FinancePosition {
  return {
    receivablesCount: 0, receivablesUnknownCount: 0, overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [], unappliedPayments: [], unappliedTotals: {},
    payables: [{
      procurement: {
        id: 'procurement-1', title: 'Equipment inspection', code: 'PR-104', status: 'Vendor Invoiced', vendor_id: 'supplier-1',
        vendor: { name: 'Sinar Supplier' }, total_value: 62_400_000, currency: 'IDR', vendor_invoiced_at: null, updated_at: '2026-07-19T00:00:00Z',
        procurement_invoices: [{ invoice_date: '2026-04-10', amount: 62_400_000, erp_outstanding_amount: 62_400_000 }],
        project_id: null, project: null,
      } as unknown as FinancePosition['payables'][number]['procurement'],
      ageDays: 100, amount: 6_240_000_000,
    }],
    payablesTotals: { IDR: 6_240_000_000 }, payablesUnknownCount: 0, receivablesAgeing: {},
    payablesAgeing: { IDR: { d0_30: 0, d31_60: 0, d61_90: 0, over90: 6_240_000_000 } },
  };
}

const renderPage = () => {
  state.position = fixture();
  return render(<MemoryRouter initialEntries={['/finance/payables']}><Routes><Route path="/finance/payables" element={<PayablesPage />} /></Routes></MemoryRouter>);
};

afterEach(() => { cleanup(); state.on = false; state.names = {}; });

describe('PayablesPage payment channel (#2698)', () => {
  it('AC-PCH-009 off: no payment channel column', () => {
    renderPage();
    expect(screen.getByText('Sinar Supplier')).toBeInTheDocument();
    expect(screen.queryByText('Payment channel')).not.toBeInTheDocument();
  });

  it('AC-PCH-009 on: the column shows the request\'s channel name, or a dash when none is set', () => {
    state.on = true; state.names = { 'procurement-1': 'Bank transfer' };
    const { unmount } = renderPage();
    expect(screen.getByText('Payment channel')).toBeInTheDocument();
    expect(screen.getByText('Bank transfer')).toBeInTheDocument();
    unmount();
    state.names = {};
    renderPage();
    expect(screen.getByText('Payment channel')).toBeInTheDocument();
    expect(screen.queryByText('Bank transfer')).not.toBeInTheDocument();
  });
});
