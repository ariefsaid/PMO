import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect'; // global registration moved out of test/setup.ts (unit-speed #1584)
import type { FinancePosition } from '@/src/lib/finance/financePosition';

const state = vi.hoisted(() => ({
  role: 'Finance',
  currency: 'IDR',
  position: null as FinancePosition | null,
  figures: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: state.role, effectiveRole: state.role }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'integration') return state.role === 'Admin' && action === 'manage';
    if (entity === 'finance') return ['Finance', 'Executive', 'Admin'].includes(state.role) && (action === 'view' || (action === 'act' && state.role !== 'Executive'));
    return action === 'view' && state.role !== 'Project Manager' && state.role !== 'Engineer';
  },
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }) }));
vi.mock('@/src/components/finance/BudgetDraftReview', () => ({ BudgetDraftReview: () => null }));
vi.mock('@/src/components/integrations/InvoicePairReview', () => ({
  InvoicePairReview: ({ orgId }: { orgId?: string }) => <section data-testid="invoice-pair-review">{orgId}</section>,
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({
    position: state.position,
    today: '2026-10-27',
    isPending: false,
    isError: false,
    retry: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useFinanceHubFigures', () => ({
  useFinanceHubFigures: () => state.figures,
}));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({
    data: { totals: [{ currency: 'IDR', months: ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((month) => ({ month, invoiced: 100_000 })) }] },
    isPending: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useRevenue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useRevenue')>()),
  usePaidPaymentFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrencyState: () => ({ currency: state.currency, isResolved: true, isError: false }),
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
    receivablesCount: 5, receivablesUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] },
    toSend: [],
    unappliedPayments: [],
    unappliedTotals: {},
    payables: [{ procurement: { id: 'procurement-1', vendor_id: 'supplier-1', vendor: { name: 'Supplier A' } } as never, ageDays: 100, amount: 6_240_000_000 }],
    payablesTotals: { IDR: 6_240_000_000, USD: 500_000 },
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
  state.currency = 'IDR';
  state.position = positionFixture();
  state.figures = {
    data: {
      pack: { asAt: '2026-10-01', unbilled: [{ currency: 'IDR', cents: 1_230_000 }, { currency: 'USD', cents: 500_000 }], contractRows: 2, invoicedBasisRows: 2 },
      statement: { unpublished: true, periodStart: null, netProfit: null, currency: null },
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  state.role = 'Finance';
});

describe('Finance hub', () => {
  it('shows known zero for no receivables and no supplier invoices', () => {
    state.position = { ...positionFixture(), receivablesCount: 0, receivablesAgeing: {}, payables: [], payablesTotals: {} };
    render(<MemoryRouter><FinanceHub /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Open Receivables' }).parentElement).toHaveTextContent(/IDR\s*0/);
    expect(screen.getByRole('link', { name: 'Open Payables' }).parentElement).toHaveTextContent(/IDR\s*0/);
  });

  it('I2 mounts the invoice pair review on the page Finance lands on, handing it the caller org', () => {
    renderHub('Finance');
    expect(screen.getByTestId('invoice-pair-review')).toHaveTextContent('org-1');
  });

  it('F1: shows only known receivable currencies beside the unknown invoice count', () => {
    state.currency = 'USD';
    state.position = {
      ...positionFixture(),
      receivablesAgeing: { IDR: { notDue: 40_000_000, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } },
      receivablesUnknownCount: 1,
      overdueUnknownCount: 1,
      overdue: [],
    };
    render(<MemoryRouter><FinanceHub /></MemoryRouter>);
    const receivables = screen.getByRole('link', { name: 'Open Receivables' }).parentElement as HTMLElement;
    expect(receivables).toHaveTextContent('IDR 400K');
    expect(receivables).toHaveTextContent('1 invoice · balance unknown');
    expect(receivables).not.toHaveTextContent('$0');
    expect(screen.getByRole('region', { name: /Receivables/ })).toHaveTextContent(/no balance reported by the accounting system/i);
  });

  it('F1: names a wholly unknown balance and keeps a known unbilled zero as zero', () => {
    state.currency = 'USD';
    state.position = { ...positionFixture(), receivablesAgeing: {}, receivablesUnknownCount: 1, overdueUnknownCount: 1, overdue: [] };
    state.figures.data = {
      pack: { asAt: '2026-10-01', unbilled: [], contractRows: 2, invoicedBasisRows: 2 },
      statement: { unpublished: true, periodStart: null, netProfit: null, currency: null },
    };
    render(<MemoryRouter><FinanceHub /></MemoryRouter>);

    expect(screen.queryByRole('link', { name: 'Open Receivables' })).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('invoice balances unknown');
    expect(screen.getByRole('link', { name: 'See invoices' })).toHaveAttribute('href', '/finance/receivables');
    expect(screen.getByRole('region', { name: /Receivables/ })).toHaveTextContent(/no balance reported by the accounting system/i);
    const unbilled = screen.getByRole('link', { name: 'Open Reports' }).parentElement as HTMLElement;
    expect(unbilled).toHaveTextContent('Done, not yet billed');
    expect(unbilled).toHaveTextContent('$0');
  });

  it('AC-1405-HUB-001: shows whole-unit figures and four linked figure tiles with one caption each', () => {
    renderHub();

    expect(screen.getByRole('heading', { name: 'Finance', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Overdue · 5 invoices· IDR\s45,000,000/ })).toBeInTheDocument();
    expect(screen.queryByText(/\.00\b/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Receivables' })).toHaveAttribute('href', '/finance/receivables');
    expect(screen.getByRole('link', { name: 'Open Payables' })).toHaveAttribute('href', '/finance/payables');
    expect(screen.getByRole('link', { name: 'Open Reports' })).toHaveAttribute('href', '/finance/reports');
    expect(screen.getAllByText('Receivables').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Payables').length).toBeGreaterThan(0);
    expect(screen.getByText('through Oct 2026')).toBeInTheDocument();
    // The supplier figure keeps the home and foreign currencies on separate lines without joining them.
    const payables = screen.getByRole('link', { name: 'Open Payables' }).parentElement as HTMLElement;
    expect(within(payables).getByText('Owed to suppliers')).toBeInTheDocument();
    const otherCurrency = within(payables).getByText('USD 5K');
    expect(otherCurrency).toHaveClass('block');
    expect(otherCurrency).not.toHaveTextContent('+');
    expect(within(payables).getByText('IDR 62,400,000; USD 5,000')).toHaveClass('sr-only');
    const earned = screen.getByRole('link', { name: 'Open Reports' }).parentElement as HTMLElement;
    expect(within(earned).getByText('Done, not yet billed')).toBeInTheDocument();
    const areas = screen.getByRole('region', { name: 'Finance areas' });
    expect(areas).toHaveClass('min-[900px]:grid-cols-3');
    expect(areas.children).toHaveLength(3);
  });

  it('L6: each overdue and supplier figure is shown once on the hub', () => {
    renderHub();
    // Overdue is owned by the attention block; payables by the Payables area card.
    expect(screen.getAllByText(/45,000,000/)).toHaveLength(1);
    expect(screen.getAllByText(/62,400,000/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open Payables' }).parentElement).toHaveTextContent('IDR 62.4M');
    expect(screen.getByText(/1 unpaid supplier invoices?/)).toBeInTheDocument();
  });

  it('F11: figure tiles show short amounts with the exact amount kept for hover and screen readers', () => {
    renderHub();
    const receivables = screen.getByRole('link', { name: 'Open Receivables' }).parentElement as HTMLElement;
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

    expect(screen.getByRole('heading', { name: 'Ageing' })).toBeInTheDocument();
    const trend = screen.getByTestId('finance-revenue-trend');
    const ageing = screen.getByRole('region', { name: 'Ageing' });
    expect(ageing.parentElement).not.toBe(trend.parentElement);
    expect(trend.compareDocumentPosition(ageing) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.getByRole('region', { name: 'Receivables' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Payables' })).toBeInTheDocument();
    expect(screen.getAllByTestId('ageing-bar-IDR')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: /Waiting on Finance/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Finance areas' }).children).toHaveLength(3);
    const firstRow = screen.getByTestId('finance-hub-first-row');
    const [left, right] = Array.from(firstRow.children) as HTMLElement[];
    const attention = screen.getByRole('region', { name: 'Finance attention' });
    expect(left).toContainElement(attention);
    expect(right).toContainElement(screen.getByRole('region', { name: 'Finance areas' }));
    expect(right).toContainElement(trend);
    expect(right).not.toContainElement(ageing);
    expect(firstRow.compareDocumentPosition(ageing) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(ageing.parentElement).not.toBe(trend.parentElement);
    expect(attention).toHaveClass('gap-0');
    expect(within(trend).getByText('Invoiced, excl. tax')).toBeInTheDocument();
    expect(within(trend).getByText('Collected')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(within(screen.getByRole('region', { name: 'Receivables' })).getByText(/38[,.]?200[,.]?000/)).toBeInTheDocument();
  });

  it('AC-1405-HUB-005: Executive sees no finance action controls while the read-only waiting list remains visible', () => {
    renderHub('Executive');

    expect(screen.getByRole('heading', { name: 'Waiting on Finance' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New invoice|Review|Record delivery|Apply|Open payables/ })).not.toBeInTheDocument();
  });

  it('AC-1405-HUB-006: no statement catalogue states the reason once, shows no placeholder value, and does not spin', () => {
    renderHub();

    // C4: "Not available yet" is never a value: the tile is hidden and ONE page line says why, once.
    expect(screen.queryByRole('link', { name: 'Open Statements' })).not.toBeInTheDocument();
    expect(screen.queryByText('Not available yet')).not.toBeInTheDocument();
    const hidden = screen.getByTestId('figures-hidden');
    expect(hidden).toHaveTextContent('1 figure hidden: accounting disconnected');
    expect(screen.getAllByText(/accounting disconnected/)).toHaveLength(1);
  });

  it('C4: with no statement yet, an Admin gets the link to where statements are set up', () => {
    renderHub('Admin');
    expect(within(screen.getByTestId('figures-hidden')).getByRole('link', { name: 'Set up' })).toHaveAttribute('href', '/administration/integrations');
  });

  it('C4: with no statement yet, Finance gets no link to a setup page it cannot open', () => {
    renderHub('Finance');
    expect(within(screen.getByTestId('figures-hidden')).queryByRole('link', { name: 'Set up' })).not.toBeInTheDocument();
  });

  it('L12(b): the hub ageing counts a supplier invoice with an unknown balance in its age group', () => {
    state.role = 'Finance';
    const position = positionFixture();
    position.payables = [{ procurement: { id: 'procurement-2', vendor_id: 'supplier-2', currency: 'IDR', vendor: { name: 'Supplier B' } } as never, ageDays: 101, amount: null }, ...position.payables];
    position.payablesUnknownCount = 1;
    state.position = position;
    render(<MemoryRouter><FinanceHub /></MemoryRouter>);
    const ageing = screen.getByRole('region', { name: 'Payables' });
    expect(within(ageing).getByTestId('ageing-bucket-IDR-over90')).toHaveTextContent('+ 1 balance unknown');
  });

  it('F6: each ageing chart uses its own currency total and zero buckets recede visually', () => {
    const position = positionFixture();
    position.receivablesAgeing = { IDR: { notDue: 100, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } };
    position.payablesAgeing = { IDR: { d0_30: 1_000_000, d31_60: 0, d61_90: 0, over90: 0 } };
    state.position = position;
    state.role = 'Executive';
    render(<MemoryRouter><FinanceHub /></MemoryRouter>);

    const receivables = screen.getByRole('region', { name: 'Receivables' });
    const payables = screen.getByRole('region', { name: 'Payables' });
    expect(within(receivables).getByTestId('ageing-bar-IDR')).toHaveAttribute('data-scale-max', '100');
    expect(within(payables).getByTestId('ageing-bar-IDR')).toHaveAttribute('data-scale-max', '1000000');
    const zeroBucket = within(receivables).getByTestId('ageing-bucket-IDR-d1_30').querySelector('.tabular');
    const positiveBucket = within(receivables).getByTestId('ageing-bucket-IDR-notDue').querySelector('.tabular');
    expect(zeroBucket).toHaveClass('text-muted-foreground');
    expect(zeroBucket).toHaveClass('font-normal');
    expect(zeroBucket).not.toHaveClass('font-semibold');
    expect(positiveBucket).not.toHaveClass('text-muted-foreground');
  });

  it('AC-1405-HUB-007: figure read errors offer a retry action', () => {
    const refetch = vi.fn();
    state.figures = { data: undefined, isPending: false, isError: true, refetch };
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
