import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
// The DOM matchers collapse NBSP to a space; Intl emits NBSP between code and digits.
const money = (v: number, c: string) => formatCurrency(v, c).replace(/\u00a0/g, ' ');

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router')>();
  return { ...real, useNavigate: () => mockNavigate };
});
const h = vi.hoisted(() => ({
  listSpy: vi.fn(),
  list: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  filteredList: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  dynamicFilters: false,
  aging: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  totals: { data: {} as Record<string, unknown>, isPending: false, isError: false, refetch: vi.fn() },
  own: { data: { rows: [] as unknown[], truncated: false } as unknown, isPending: false, isError: false, refetch: vi.fn() },
  create: { mutateAsync: vi.fn(), isPending: false },
  capture: { capture: vi.fn(), cleanupUnlinkedAttachment: vi.fn(), recovery: null as null | Record<string, unknown>, progress: null as number | null },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaims: (filters: unknown) => { h.listSpy(filters); return h.dynamicFilters && Object.keys(filters as Record<string, unknown>).length > 0 ? h.filteredList : h.list; },
  useExpenseAdvanceAging: () => h.aging,
  useExpenseAdvanceAgingTotals: () => h.totals,
  useOwnExpenseAdvances: () => h.own,
  useExpenseClaimMutations: () => ({ create: h.create }),
}));
vi.mock('@/src/hooks/useExpenseCapture', async () => {
  const ReactModule = await import('react');
  return {
    useExpenseCapture: () => {
      const [recovery, setRecovery] = ReactModule.useState(h.capture.recovery);
      const capture = async (input: unknown) => {
        try { return await h.capture.capture(input); }
        catch (error) { setRecovery(h.capture.recovery); throw error; }
      };
      return { ...h.capture, recovery, capture };
    },
  };
});
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'p1', name: 'Harbour Upgrade', short_name: 'North Terminal' }] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

vi.mock('@/src/hooks/useImprest', () => ({ useImprestFloatChoices: () => ({ data: [] }) }));

import ExpenseClaims from './ExpenseClaims';

vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'ready', retry: vi.fn() }) }));

const ROW = {
  id: 'c1', claim_number: 'EXP-2610060001', kind: 'claim', title: 'Site visit', claimant: { full_name: 'Budi Field' },
  project: { name: 'Harbour Upgrade' }, budget_category: 'Special expenses', amount: 750000, currency: 'IDR', status: 'Submitted',
};
const renderPage = (initialPath = '/expenses') => render(<MemoryRouter initialEntries={[initialPath]}><ToastProvider><ExpenseClaims /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  mockNavigate.mockClear();
  h.listSpy.mockClear();
  h.list.isError = false;
  h.list.refetch = vi.fn();
  h.create.mutateAsync.mockReset();
  h.capture.capture.mockReset();
  h.capture.cleanupUnlinkedAttachment.mockReset();
  h.capture.recovery = null;
  h.list.data = { rows: [ROW], truncated: false };
  h.filteredList.data = { rows: [], truncated: false };
  h.dynamicFilters = false;
});

describe('ExpenseClaims page', () => {
  it('R2-P1b #7 shows the exact transaction amount in the claims list', () => {
    h.list.data = {
      rows: [{ ...ROW, amount: 12.5, currency: 'USD' }],
      truncated: false,
    };
    renderPage();

    const row = screen.getByRole('row', { name: /Site visit/ });
    expect(within(row).getByText('$12.50')).toBeInTheDocument();
    expect(within(row).queryByText('$13')).not.toBeInTheDocument();
  });

  it('AC-EXP-060 lists records with number, claimant, project, amount and status', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Site visit/ });
    expect(within(row).getByText('EXP-2610060001')).toBeInTheDocument();
    expect(within(row).getByText('Budi Field')).toBeInTheDocument();
    expect(within(row).getByText('Harbour Upgrade')).toBeInTheDocument();
    expect(within(row).getByText(money(750000, 'IDR'))).toBeInTheDocument();
    expect(within(row).getByText('Submitted')).toBeInTheDocument();
  });

  it('AC-EXP-060 opens a claim from its accessible row action', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Open Site visit' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses/c1');
  });

  it('AC-EXP-060 retries a failed expense-list read', async () => {
    h.list.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.list.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps New claim reachable when the list has no claims', async () => {
    h.list.data = { rows: [], truncated: false };
    renderPage();
    await userEvent.click(screen.getAllByRole('button', { name: 'New claim' })[0]);
    expect(mockNavigate).toHaveBeenCalledWith('/expenses/new');
  });

  it('keeps Request advance available when the list has no claims', async () => {
    h.list.data = { rows: [], truncated: false };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Request advance' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('ruling 1: keeps New claim in the header and in the empty state (quiet outline pending)', async () => {
    h.list.data = { rows: [], truncated: false };
    renderPage();
    const [headerAction, emptyAction] = screen.getAllByRole('button', { name: 'New claim' });
    // New claim must never move: the header keeps its filled action at every width, and the
    // empty state keeps its own copy. The quiet outline for this copy awaits the shared
    // list-state action variant; until then it renders the primitive's default.
    await userEvent.click(headerAction);
    await userEvent.click(emptyAction);
    expect(mockNavigate).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenNthCalledWith(1, '/expenses/new');
    expect(mockNavigate).toHaveBeenNthCalledWith(2, '/expenses/new');
  });

  it('ruling 2: keeps the empty state inside the expense list card surface', () => {
    h.list.data = { rows: [], truncated: false };
    renderPage();
    expect(screen.getByText('No expenses here yet').closest('.panel-card')).toBeInTheDocument();
  });

  it('W7: Clear filters is keyboard reachable and restores rows from a filtered empty state', async () => {
    h.dynamicFilters = true;
    renderPage('/expenses?status=Rejected');

    const clear = screen.getByRole('button', { name: 'Clear filters' });
    clear.focus();
    expect(clear).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('row', { name: /Site visit/ })).toBeInTheDocument();
    expect(h.listSpy).toHaveBeenLastCalledWith({});
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('move 2: hides table headers until expense rows exist', () => {
    h.list.data = { rows: [], truncated: false };
    renderPage();
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });

  it('AC-002 #1325: the project column leads with the short name and titles the contractual one', () => {
    h.list.data = { rows: [{ ...ROW, project: { name: 'Harbour Upgrade', short_name: 'Harbour' } }], truncated: false };
    renderPage();
    const row = screen.getByRole('row', { name: /Site visit/ });
    expect(within(row).getByTitle('Harbour Upgrade')).toHaveTextContent('Harbour');
  });

  it('AC-002 #1325: advance request project options show the short name only', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /request advance/i }));
    expect(screen.getByRole('option', { name: 'North Terminal' })).toHaveValue('p1');
  });

  it('AC-EXP-060 the Special expenses filter queries by that category', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText('Budget category', { selector: 'input, select, textarea' }), 'Special expenses');
    expect(h.listSpy).toHaveBeenLastCalledWith({ budgetCategory: 'Special expenses' });
  });

  it('AC-EXP-060 New claim opens the full-page create route', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses/new');
    expect(h.capture.capture).not.toHaveBeenCalled();
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
  });


  it('AC-EXP-060 an advance cannot be created without an amount', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Request advance' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Trip float');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-EXP-060 says when the list is truncated instead of trimming silently', () => {
    h.list.data = { rows: [ROW], truncated: true };
    renderPage();
    expect(screen.getByText(/Showing the latest 200/)).toBeInTheDocument();
  });

  it('AC-S12 readiness disclosure moves with the new full-page create route', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses/new');
    expect(h.capture.capture).not.toHaveBeenCalled();
  });
});
