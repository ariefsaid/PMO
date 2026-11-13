import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { renderWithQueryClient } from '@/test/renderWithQueryClient';
import { ToastProvider } from '@/src/components/ui';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// Same mock set as ProjectPosition.test.tsx (the overview harness), trimmed to the
// Money block rows under test.
const state = vi.hoisted(() => ({
  role: 'Project Manager',
  orgDay: '2026-10-27',
  orgCurrency: 'IDR',
  versions: [] as unknown[],
  finances: null as unknown,
  financeRefetch: vi.fn(),
  invoices: [] as unknown[],
  invoicesPending: false,
  invoicesError: false,
  invoicesRefetch: vi.fn(),
  billing: { contractLines: [] as unknown[] },
  boqItems: [] as unknown[],
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'salesInvoice' && action === 'view') return state.role !== 'Engineer';
    return true;
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'viewer-1', org_id: 'org-1' }, role: state.role }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }),
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => ({ data: state.versions, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: state.finances, isPending: false, isError: false, refetch: state.financeRefetch }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: state.invoices, isPending: state.invoicesPending, isError: state.invoicesError, refetch: state.invoicesRefetch }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: state.orgDay, isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrencyState: () => ({ currency: state.orgCurrency, isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxRates', () => ({
  useFxRate: () => ({ data: { rate: 16_300, rate_date: '2026-10-09' }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useBoqItems: () => ({ data: state.boqItems, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectBilling: () => ({ data: state.billing, isPending: false, isError: false, refetch: vi.fn() }),
}));
const milestoneMutations = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
}));
const milestoneBox = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneBox,
  useMilestoneMutations: () => milestoneMutations,
}));
const taskBox = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
vi.mock('@/src/hooks/useTasks', () => ({ useTasks: () => taskBox }));
vi.mock('../ProjectProfitLossSection', () => ({ default: () => null }));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));

import { MoneyBlock, DeliveryBlock } from '../ProjectBlocks';

const project = {
  id: 'p1', status: 'Ongoing Project', currency: 'USD', contract_value: 1_000,
  contract_date: '2026-10-10', tax_treatment: null,
} as ProjectWithRefs;

const SearchProbe = () => <output data-testid="dest">{useLocation().pathname + useLocation().search}</output>;

beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  state.role = 'Project Manager';
  state.orgDay = '2026-10-27';
  state.versions = [];
  state.invoices = [];
  state.invoicesPending = false;
  state.invoicesError = false;
  state.billing = { contractLines: [] };
  state.boqItems = [];
  // Settled invoice value with no receipt matched to it yet: paid > cash received.
  state.finances = {
    contract_invoiced: '250', remaining_to_invoice: '750', invoices: [],
    cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '150' }], receipt_count: 1 },
    actuals: { currency: 'USD', total: '100.00', as_of: null, excludes_restricted_rows: false, categories: [] },
  };
});

afterEach(() => resetActiveLocale());

describe('ProjectBlocks floor', () => {
  it('floor: Match payments opens Receivables on the payments view', async () => {
    state.boqItems = [{ id: 'boq-1', quantity: 10, rate: 100 }];
    state.invoices = [{ id: 'inv-1', status: 'Submitted', invoice_date: '2026-10-01', erp_due_date: '2026-10-20', erp_payment_terms_days: 30, erp_outstanding_amount: 50, grand_total: '9999', currency: 'USD', amount: 250 }];

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <Routes>
          <Route path="/projects/p1/overview" element={<MoneyBlock project={project} />} />
          <Route path="/finance/receivables" element={<SearchProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/no receipt is matched to it yet\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Match payments' }));
    expect(screen.getByTestId('dest')).toHaveTextContent('/finance/receivables?view=payments');
  });

  it('floor: Open timeline opens Tasks on the Timeline view', async () => {
    milestoneBox.data = [{ id: 'm1', project_id: 'p1', name: 'Design', sort_order: 0, target_date: '2026-11-30', weight: 1, input_pct: null, task_count: 2, calculated_pct: 40, effective_pct: 40 }];
    renderWithQueryClient(
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <Routes>
          <Route path="/projects/p1/overview" element={<DeliveryBlock projectId="p1" />} />
          <Route path="/projects/p1/tasks" element={<SearchProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'Open timeline' }));
    expect(screen.getByTestId('dest')).toHaveTextContent('/projects/p1/tasks?view=timeline');
  });

  it('floor: Update phases opens the phase planner and Done returns to the read view', async () => {
    milestoneBox.data = [{ id: 'm1', project_id: 'p1', name: 'Design', sort_order: 0, target_date: '2026-11-30', weight: 1, input_pct: null, task_count: 2, calculated_pct: 40, effective_pct: 40 }];
    renderWithQueryClient(
      <MemoryRouter>
        <ToastProvider>
          <DeliveryBlock projectId="p1" />
        </ToastProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Update phases' }));
    expect(screen.getByRole('button', { name: 'Add phase' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('link', { name: 'Open timeline' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add phase' })).not.toBeInTheDocument();
  });
});
