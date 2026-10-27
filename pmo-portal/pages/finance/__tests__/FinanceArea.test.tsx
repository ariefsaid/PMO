import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const h = vi.hoisted(() => ({ role: 'Finance' as string }));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'finance') return action === 'view' ? ['Finance', 'Admin', 'Executive'].includes(h.role) : ['Finance', 'Admin'].includes(h.role);
    if (entity === 'financialStatements') return ['Finance', 'Admin', 'Executive'].includes(h.role);
    return true;
  },
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => true }));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({
    position: {
      overdue: [], overdueTotals: { IDR: 12_000 }, overdueUnknownCount: 0,
      drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [],
      unappliedPayments: [], unappliedTotals: {}, payables: [], payablesTotals: { IDR: 3_000 },
      receivablesAgeing: { IDR: { notDue: 1_000, d1_30: 2_000, d31_60: 0, d61_90: 0, over90: 0 } },
      payablesAgeing: { IDR: { d0_30: 3_000, d31_60: 0, d61_90: 0, over90: 0 } },
    },
    today: '2026-10-27', isPending: false, isError: false, retry: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({ data: { to: '2026-10-01', totals: [{ currency: 'IDR', months: [{ unbilled: 5000 }] }] } }),
}));
vi.mock('@/src/hooks/useFinancialStatements', () => ({
  useFinancialStatementCatalogue: () => ({ data: { state: 'complete', periods: [{ currentStart: '2026-09-01' }] } }),
}));
vi.mock('@/src/components/finance/FinanceAttention', () => ({
  FinanceAttention: ({ scope }: { scope: string }) => <div data-testid={`attention-${scope}`} />,
}));
vi.mock('@/src/components/finance/AgeingStrip', () => ({ AgeingStrip: ({ kind }: { kind: string }) => <div data-testid={`ageing-${kind}`} /> }));
vi.mock('@/src/components/finance/PayablesList', () => ({ PayablesList: () => <div>Payables list</div> }));
vi.mock('@/pages/SalesInvoices', () => ({ default: () => <div>Embedded invoices</div> }));
vi.mock('@/pages/IncomingPayments', () => ({ default: () => <div>Embedded payments</div> }));
vi.mock('@/pages/ManagementPack', () => ({ default: () => <div>Embedded report</div> }));
vi.mock('@/pages/FinancialStatements', () => ({ default: () => <div>Embedded statements</div> }));

import FinanceArea from '../FinanceArea';

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}{location.search}{location.hash}</output>;
}

function renderAt(entry: string, role = 'Finance') {
  h.role = role;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/finance" element={<FinanceArea />} />
        <Route path="/finance/:area" element={<FinanceArea />} />
        <Route path="/sales-invoices" element={<div>Legacy invoices</div>} />
      </Routes>
      <CurrentPath />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('FinanceArea layouts', () => {
  it('A: tabs switch the area URL while keeping the selected layout', () => {
    renderAt('/finance?layout=a');
    expect(screen.getByRole('heading', { level: 1, name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Finance areas' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Payables/ }));
    expect(screen.getByText('/finance/payables?layout=a')).toBeInTheDocument();
    expect(screen.getByText('Payables list')).toBeInTheDocument();
  });

  it('B: the hub drills into an area and provides a return link', () => {
    renderAt('/finance?layout=b');
    expect(screen.getByRole('heading', { level: 1, name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByTestId('attention-all')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /Receivables/ }));
    expect(screen.getByText('/finance/receivables?layout=b')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Finance' })).toBeInTheDocument();
  });

  it('C: the one-page jump menu omits needs-you for Executives and includes all areas', () => {
    renderAt('/finance?layout=c', 'Executive');
    const jumpLinks = screen.getAllByRole('link').filter((link) => link.closest('[aria-label="Finance sections"]'));
    expect(jumpLinks.map((link) => link.textContent)).toEqual(['Revenue', 'Statements', 'Receivables', 'Payables']);
    expect(screen.queryByTestId('attention-all')).not.toBeInTheDocument();
    expect(screen.getByTestId('attention-receivables')).toBeInTheDocument();
  });

  it('layout=off redirects to the existing invoice list route', () => {
    renderAt('/finance?layout=off');
    expect(screen.getByText('Legacy invoices')).toBeInTheDocument();
  });
});
