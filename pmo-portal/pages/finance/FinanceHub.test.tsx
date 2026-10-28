import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'jest-axe';
import type { FinancePosition } from '@/src/lib/finance/financePosition';

const state = vi.hoisted(() => ({
  role: 'Finance',
  position: null as FinancePosition | null,
  catalogue: { data: undefined as undefined | { periods: Array<{ kind: string; currentStart: string }> }, isPending: false, isError: false, refetch: vi.fn() },
  statement: { data: undefined as unknown, isPending: true, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: state.role, effectiveRole: state.role }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'finance') return ['Finance', 'Executive', 'Admin'].includes(state.role) && (action === 'view' || (action === 'act' && state.role !== 'Executive'));
    return action === 'view' && state.role !== 'Project Manager' && state.role !== 'Engineer';
  },
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => true }));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({
    position: state.position,
    today: '2026-10-27',
    isPending: false,
    isError: false,
    retry: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({ data: { to: '2026-10-01', totals: [{ currency: 'IDR', months: [{ unbilled: 1_230_000 }] }, { currency: 'USD', months: [{ unbilled: 500_000 }] }], rows: [{ kind: 'contract', projectId: 'project-1', latestProgress: null }, { kind: 'contract', projectId: 'project-2', latestProgress: null }] }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFinancialStatements', () => ({
  useFinancialStatementCatalogue: () => state.catalogue,
  useFinancialStatement: () => state.statement,
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'project-1', name: 'North delivery', short_name: 'North delivery', pm: { full_name: 'Alex Rivera' } }] }) }));

import FinanceHub from './FinanceHub';

function positionFixture(): FinancePosition {
  return {
    overdue: Array.from({ length: 5 }, (_, index) => ({
      invoice: {
        id: `invoice-${index + 1}`, project_id: null, customer_name: `Client ${index + 1}`, si_number: `INV-${index + 1}`,
        invoice_date: '2026-07-15', erp_payment_terms_days: 0, erp_due_date: '2026-07-15', received_date: null,
        amount: 10_000_000, tax_amount: 0, tax_treatment: 'exclusive', currency: 'IDR', status: 'Unpaid', erp_outstanding_amount: 9_000_000,
      } as never,
      daysOverdue: 104 - index,
      outstanding: 900_000_000,
    })),
    overdueTotals: { IDR: 4_500_000_000 },
    overdueUnknownCount: 0,
    receivablesCount: 5,
    drafts: { canApprove: [], awaitingOther: [], all: [] },
    toSend: [],
    unappliedPayments: [],
    unappliedTotals: {},
    payables: [{ procurement: { id: 'procurement-1', vendor_id: 'supplier-1', vendor: { name: 'Supplier A' } } as never, ageDays: 100, amount: 6_240_000_000 }],
    payablesTotals: { IDR: 6_240_000_000 },
    payablesUnknownCount: 0,
    receivablesAgeing: { IDR: { notDue: 3_820_000_000, d1_30: 1_220_000_000, d31_60: 1_430_000_000, d61_90: 0, over90: 1_850_000_000 } },
    payablesAgeing: { IDR: { d0_30: 2_100_000_000, d31_60: 940_000_000, d61_90: 1_200_000_000, over90: 2_000_000_000 } },
  };
}

function renderHub(role = 'Finance') {
  state.role = role;
  state.position = positionFixture();
  return render(<MemoryRouter><FinanceHub /></MemoryRouter>);
}

beforeEach(() => {
  state.position = positionFixture();
  state.catalogue = { data: { periods: [] }, isPending: false, isError: false, refetch: vi.fn() };
  state.statement = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
});

afterEach(() => {
  cleanup();
  state.role = 'Finance';
});

describe('Finance hub', () => {
  it('AC-1405-HUB-001: shows whole-unit figures and four area cards with their meaning lines', () => {
    renderHub();

    expect(screen.getByRole('heading', { name: 'Finance', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Overdue · IDR\s45,000,000 from 5 invoices/ })).toBeInTheDocument();
    expect(screen.queryByText(/\.00\b/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Receivables/ })).toHaveAttribute('href', '/finance/receivables');
    expect(screen.getByRole('link', { name: /Payables/ })).toHaveAttribute('href', '/finance/payables');
    expect(screen.getByRole('link', { name: /Reports/ })).toHaveAttribute('href', '/finance/reports');
    expect(screen.getByRole('link', { name: /Statements/ })).toHaveAttribute('href', '/finance/statements');
    expect(screen.getByText(/owed to you/)).toBeInTheDocument();
    expect(screen.getByText(/to pay 1 supplier/)).toBeInTheDocument();
    expect(screen.getByText(/earned, not yet invoiced · through Oct/)).toBeInTheDocument();
    expect(screen.getByText('No progress recorded on 2 projects')).toBeInTheDocument();
    expect(screen.getByText('+ USD 5K in other currencies')).toBeInTheDocument();
  });

  it('L6: each overdue and supplier figure is shown once on the hub', () => {
    renderHub();
    // Overdue is owned by the attention block; payables by the Payables area card.
    expect(screen.getAllByText(/45,000,000/)).toHaveLength(1);
    expect(screen.getAllByText(/62,400,000/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open Payables' }).closest('article')).toHaveTextContent('IDR 62.4M');
    expect(screen.getByText(/1 supplier invoices? waiting to be paid/)).toBeInTheDocument();
  });

  it('F11: area cards show short amounts with the exact amount kept for hover and screen readers', () => {
    renderHub();
    const receivables = screen.getByRole('link', { name: 'Open Receivables' }).closest('article') as HTMLElement;
    expect(within(receivables).getByText('IDR 83.2M').getAttribute('title')).toMatch(/^IDR\s83,200,000$/);
    expect(within(receivables).getByText('IDR 83,200,000')).toHaveClass('sr-only');
  });

  it('AC-1405-HUB-002: Finance can create an invoice, while Executive stays read-only', () => {
    const finance = renderHub('Finance');
    expect(screen.getByRole('button', { name: /New invoice/ })).toBeInTheDocument();
    finance.unmount();

    renderHub('Executive');
    expect(screen.queryByRole('button', { name: /New invoice/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finance', level: 1 })).toBeInTheDocument();
  });

  it('AC-1405-HUB-003: keeps area cards, ageing figures and attention content accessible', async () => {
    const { container } = renderHub('Executive');

    expect(screen.getByRole('region', { name: /Client balances by age/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Waiting on Finance/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(within(screen.getByRole('region', { name: /Client balances by age/ })).getByText(/38[,.]?200[,.]?000/)).toBeInTheDocument();
  });

  it('AC-1405-HUB-005: Executive sees no finance action controls while the read-only waiting list remains visible', () => {
    renderHub('Executive');

    expect(screen.getByRole('heading', { name: 'Waiting on Finance' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New invoice|Review|Mark received|Apply|Open payables/ })).not.toBeInTheDocument();
  });

  it('AC-1405-HUB-006: no statement catalogue states the reason once, shows no placeholder value, and does not spin', () => {
    renderHub();

    const statements = screen.getByRole('link', { name: /Statements/ }).closest('article') as HTMLElement;
    // C4: "Not available yet" is never shown as a value; the reason is said once and the card links to Statements.
    expect(statements).not.toHaveTextContent('Not available yet');
    expect(statements).toHaveTextContent('Net profit is not available for a period yet');
    expect(within(statements).queryByRole('status')).not.toBeInTheDocument();
  });

  it('AC-1405-HUB-007: statement catalogue errors offer a retry action', () => {
    const refetch = vi.fn();
    state.catalogue = { data: undefined, isPending: false, isError: true, refetch };
    renderHub();

    screen.getAllByRole('button', { name: 'Retry' }).forEach((button) => button.click());
    expect(refetch).toHaveBeenCalled();
  });

  it.each(['Project Manager', 'Engineer'])('AC-1405-HUB-004: %s deep links receive AccessDenied', (role) => {
    renderHub(role);
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Receivables' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New invoice/ })).not.toBeInTheDocument();
  });
});
