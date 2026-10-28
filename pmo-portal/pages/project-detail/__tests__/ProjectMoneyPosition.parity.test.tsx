/**
 * Project money position — one finance reading, every Overview consumer agrees.
 *
 * Ported after the #1402 restructure deleted the previous file (it drove the old OverviewTab and the
 * full header strip, neither of which the project page mounts any more). The consumers are now the
 * Budget vs actual block, the Money position block and its Details drill-down (Project finances).
 * The repository read is the only network seam; the hooks, the money model and the blocks are real.
 * Also carries the budget-read states from the deleted OverviewTab.budgetUtil/atrisk/budgetBasis files.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectFinances } from '@/src/lib/projectFinances';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

const h = vi.hoisted(() => ({
  getProjectFinances: vi.fn(),
  versions: { data: [] as unknown[] | undefined, isPending: false, isError: false },
}));

vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: { getProjectFinances: h.getProjectFinances } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-A' }, role: 'Finance' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => !(entity === 'orgAccounting' && action === 'manage'),
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => ({ ...h.versions, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: () => ({ data: 0, otherCurrencies: [], commitmentSource: 'not-tracked', ledgerBasis: 'erp', isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useBoqItems: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectBilling: () => ({ data: { contractLines: [] }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));
vi.mock('../ProjectProfitLossSection', () => ({ default: () => null }));

import { CostBlock, MoneyBlock } from '../ProjectBlocks';

const project = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Sample project', status: 'Ongoing Project',
  currency: 'USD', contract_value: 100, budget: 0, tax_treatment: 'exclusive', contract_date: null,
} as unknown as ProjectWithRefs;

const activeVersion = (lines: Array<[string, number]>) => ({
  id: 'bv1', status: 'Active', line_items: lines.map(([category, budgeted_amount]) => ({ category, budgeted_amount })),
});

const actuals = (
  categories: ProjectFinances['actuals']['categories'],
  total: string | null = '10.10',
  currency = 'USD',
): ProjectFinances['actuals'] => ({ currency, as_of: '2026-10-17T00:00:00Z', total, excludes_restricted_rows: false, categories });

const reading = (overrides: Partial<ProjectFinances> = {}): ProjectFinances => ({
  project_id: project.id,
  cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '0.00' }, { currency: 'IDR', amount: '7.50' }], receipt_count: 1 },
  contract_invoiced: '25.00',
  remaining_to_invoice: '75.00',
  invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '25.00', settled: '25.00', outstanding: '0.00', missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '20.00', missing_work: 0 }],
  budget: null,
  actuals: actuals([{ category: 'Labor', mapped: true, amount: '10.00' }, { category: 'Materials', mapped: true, amount: '0.10' }]),
  ...overrides,
} as ProjectFinances);

const renderOverviewMoney = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider>
        <CostBlock project={project} />
        <MoneyBlock project={project} />
      </ToastProvider></MemoryRouter>
    </QueryClientProvider>,
  );
};
const costBlock = () => screen.getByRole('region', { name: /Budget vs actual/ });

beforeEach(() => {
  h.getProjectFinances.mockReset();
  h.getProjectFinances.mockResolvedValue(reading());
  h.versions = { data: [activeVersion([['Labor', 30], ['Materials', 10]])], isPending: false, isError: false };
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
});

describe('project money position consumer parity (AC-PMP-003)', () => {
  it.each([['en', 'en-US'], ['id', 'id-ID']] as const)('AC-PMP-003 one complete ERP reading gives the same spending to Budget vs actual and Project finances (%s)', async (locale, numberLocale) => {
    setActiveLocale({ locale, numberLocale, timezone: 'UTC' });
    renderOverviewMoney();
    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalled());
    // One read serves every consumer (shared query key).
    expect(h.getProjectFinances.mock.calls.every(([id]) => id === project.id)).toBe(true);
    expect(await within(costBlock()).findByText(/25% used/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    const section = await screen.findByTestId('project-finances');
    // The section names the currency once and shows the same reading in the viewer's number format;
    // contract remaining after cost is the same reading subtracted from the contract (100 − 10.10).
    const decimal = numberLocale === 'id-ID' ? ',' : '.';
    expect(section).toHaveTextContent(new RegExp(`Recorded spending · USD\\s*10\\${decimal}1(?!\\d)`));
    expect(section).toHaveTextContent(new RegExp(`Contract remaining after cost\\s*89\\${decimal}9(?!\\d)`));
    // Receipt cash is its own figure: the project-currency bucket in the strip, never added to settlement.
    // The strip carries the project-currency bucket (a known 0); the drill-down adds only the other currency.
    const stripCash = screen.getAllByText('Cash received', { exact: true }).find((label) => !section.contains(label))!;
    expect(stripCash.parentElement!).toHaveTextContent(/Cash received\s*0$/);
    expect(section).toHaveTextContent(/Cash received\s*IDR\s*7[.,]5/);
  });

  it('AC-PMP-003 a mapped category with no ERP amount is never reported as complete spending', async () => {
    h.getProjectFinances.mockResolvedValue(reading({ actuals: actuals([{ category: 'Labor', mapped: true, amount: null }], '10.10') }));
    h.versions = { data: [activeVersion([['Labor', 40]])], isPending: false, isError: false };
    renderOverviewMoney();
    expect(await within(costBlock()).findByText(/Spending isn't linked yet/)).toBeInTheDocument();
    expect(within(costBlock()).getByText('Budget 40')).toBeInTheDocument();
    expect(within(costBlock()).queryByText(/within budget|% used/i)).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    const section = await screen.findByTestId('project-finances');
    expect(section).not.toHaveTextContent(/Partial coverage/);
  });

  it('AC-PMP-003 spending recorded in another currency is never compared with the project-currency budget', async () => {
    h.getProjectFinances.mockResolvedValue(reading({ actuals: actuals([{ category: 'Labor', mapped: true, amount: '10.10' }], '10.10', 'EUR') }));
    h.versions = { data: [activeVersion([['Labor', 40]])], isPending: false, isError: false };
    renderOverviewMoney();
    expect(await within(costBlock()).findByText('Budget 40')).toBeInTheDocument();
    expect(within(costBlock()).queryByText(/% used|within budget|over budget/i)).not.toBeInTheDocument();
  });
});

describe('budget read states never show a false zero (AC-B-0-4, AC-PMP-003 budget precedence)', () => {
  it('AC-B-0-4: while the budget read is pending there is no budget-use figure and no zero', async () => {
    h.versions = { data: undefined, isPending: true, isError: false };
    renderOverviewMoney();
    await waitFor(() => expect(h.getProjectFinances).toHaveBeenCalled());
    expect(within(costBlock()).queryByText(/% used/)).not.toBeInTheDocument();
    expect(costBlock().textContent).not.toMatch(/\b0 of 0\b|0% used/);
  });

  it('AC-B-0-4: a failed budget read shows an error with retry and no budget-use figure', async () => {
    h.versions = { data: undefined, isPending: false, isError: true };
    renderOverviewMoney();
    expect(await within(costBlock()).findByText("Couldn't load the budget")).toBeInTheDocument();
    expect(within(costBlock()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(costBlock()).queryByText(/% used/)).not.toBeInTheDocument();
  });

  it('DD-MONEY-4: with no Active budget there is no utilization against a zero denominator', async () => {
    h.versions = { data: [], isPending: false, isError: false };
    renderOverviewMoney();
    expect(await within(costBlock()).findByText(/No active budget yet/)).toBeInTheDocument();
    expect(within(costBlock()).queryByText(/% used|At risk/)).not.toBeInTheDocument();
  });

  it('AC-W2-1-FE-01: use is Actual over the Active budget lines, not the stored project budget column', async () => {
    h.getProjectFinances.mockResolvedValue(reading({ actuals: actuals([{ category: 'Labor', mapped: true, amount: '95.00' }], '95.00') }));
    h.versions = { data: [activeVersion([['Labor', 100]])], isPending: false, isError: false };
    renderOverviewMoney();
    expect(await within(costBlock()).findByText(/95% used/)).toBeInTheDocument();
    expect(within(costBlock()).getByText('At risk')).toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: a healthy project shows its use and no At risk mark', async () => {
    h.getProjectFinances.mockResolvedValue(reading({ actuals: actuals([{ category: 'Labor', mapped: true, amount: '40.00' }], '40.00') }));
    h.versions = { data: [activeVersion([['Labor', 90]])], isPending: false, isError: false };
    renderOverviewMoney();
    expect(await within(costBlock()).findByText(/44% used/)).toBeInTheDocument();
    expect(within(costBlock()).queryByText('At risk')).not.toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: a zero budget gives no use figure, no At risk mark and never NaN', async () => {
    h.getProjectFinances.mockResolvedValue(reading({ actuals: actuals([{ category: 'Labor', mapped: true, amount: '50.00' }], '50.00') }));
    h.versions = { data: [activeVersion([['Labor', 0]])], isPending: false, isError: false };
    renderOverviewMoney();
    await within(costBlock()).findByText(/over budget/i);
    expect(within(costBlock()).queryByText(/% used/)).not.toBeInTheDocument();
    expect(within(costBlock()).queryByText('At risk')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});

// Ported from the deleted OverviewTab.test.tsx (Budget snapshot T16 / UX-027 / OD-TAX-1 / T18), against
// the Budget vs actual and Money position blocks that replaced the snapshot card.
describe('Budget vs actual block carries the snapshot behaviours', () => {
  it('UX-027/AC-W2-9-02: an overrun is named an overrun in destructive text, with the spend against the budget', async () => {
    h.getProjectFinances.mockResolvedValue(reading({ actuals: actuals([{ category: 'Labor', mapped: true, amount: '320.00' }], '320.00') }));
    h.versions = { data: [activeVersion([['Labor', 150]])], isPending: false, isError: false };
    renderOverviewMoney();
    const headline = await within(costBlock()).findByText('170 over budget');
    expect(headline.closest('p')).toHaveClass('text-destructive-text');
    expect(within(costBlock()).getByText(/Spent 320 of 150/)).toBeInTheDocument();
  });

  it('UX-027: under-budget money reads as remaining, never as a negative overrun', async () => {
    h.getProjectFinances.mockResolvedValue(reading({ actuals: actuals([{ category: 'Labor', mapped: true, amount: '50.00' }], '50.00') }));
    h.versions = { data: [activeVersion([['Labor', 150]])], isPending: false, isError: false };
    renderOverviewMoney();
    expect(await within(costBlock()).findByText(/100 remaining/)).toBeInTheDocument();
    expect(within(costBlock()).getByText('Within budget')).toBeInTheDocument();
    expect(within(costBlock()).queryByText(/over budget/i)).not.toBeInTheDocument();
  });

  it('item F: by-category figures are money amounts, never a raw "Nh" hours suffix', async () => {
    h.getProjectFinances.mockResolvedValue(reading({ actuals: actuals([{ category: 'Labor', mapped: true, amount: '10.00' }, { category: 'Materials', mapped: true, amount: '0.10' }]) }));
    h.versions = { data: [activeVersion([['Labor', 100_000], ['Materials', 50_000]])], isPending: false, isError: false };
    renderOverviewMoney();
    expect(await within(costBlock()).findByText('10 of 100,000')).toBeInTheDocument();
    expect(within(costBlock()).getByText('0 of 50,000')).toBeInTheDocument();
    expect(costBlock().textContent).not.toMatch(/\b\d+h\b/);
  });

  it('T18: the block opens the Budget area', async () => {
    const onOpenBudget = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><CostBlock project={project} onOpenBudget={onOpenBudget} /></MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open budget' }));
    expect(onOpenBudget).toHaveBeenCalledOnce();
  });

  it('OD-TAX-1 §2: the money blocks state the tax basis from the project row itself', async () => {
    renderOverviewMoney();
    const money = await screen.findByRole('region', { name: /Money position/ });
    expect(within(money).getAllByText(/excl\. PPN/).length).toBeGreaterThan(0);
    expect(within(costBlock()).getAllByText(/excl\. PPN/).length).toBeGreaterThan(0);
  });
});
