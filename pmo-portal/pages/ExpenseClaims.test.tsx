import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyCents } from '@/src/lib/format';
// The DOM matchers collapse NBSP to a space; Intl emits NBSP between code and digits.
const money = (v: number, c: string) => formatCurrencyCents(v, c).replace(/\u00a0/g, ' ');

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router')>();
  return { ...real, useNavigate: () => mockNavigate };
});
const h = vi.hoisted(() => ({
  listSpy: vi.fn(),
  list: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  aging: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  create: { mutateAsync: vi.fn(), isPending: false },
  capture: { capture: vi.fn(), cleanupUnlinkedAttachment: vi.fn(), recovery: null as null | Record<string, unknown>, progress: null as number | null },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaims: (filters: unknown) => { h.listSpy(filters); return h.list; },
  useExpenseAdvanceAging: () => h.aging,
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

import ExpenseClaims from './ExpenseClaims';

vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'ready', retry: vi.fn() }) }));

const ROW = {
  id: 'c1', claim_number: 'EXP-2610060001', kind: 'claim', title: 'Site visit', claimant: { full_name: 'Budi Field' },
  project: { name: 'Harbour Upgrade' }, budget_category: 'Special expenses', amount: 750000, currency: 'IDR', status: 'Submitted',
};
const renderPage = (entry = '/expenses') => render(<MemoryRouter initialEntries={[entry]}><ToastProvider><ExpenseClaims /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  mockNavigate.mockClear();
  h.listSpy.mockClear();
  h.create.mutateAsync.mockReset();
  h.capture.capture.mockReset();
  h.capture.cleanupUnlinkedAttachment.mockReset();
  h.capture.recovery = null;
  h.list.data = { rows: [ROW], truncated: false };
});

describe('ExpenseClaims page', () => {
  it('AC-EXP-060 lists records with number, claimant, project, amount and status', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Site visit/ });
    expect(within(row).getByText('EXP-2610060001')).toBeInTheDocument();
    expect(within(row).getByText('Budi Field')).toBeInTheDocument();
    expect(within(row).getByText('Harbour Upgrade')).toBeInTheDocument();
    expect(within(row).getByText(money(750000, 'IDR'))).toBeInTheDocument();
    expect(within(row).getByText('Submitted')).toBeInTheDocument();
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
    expect(within(screen.getByRole('dialog')).getByRole('option', { name: 'North Terminal' })).toHaveValue('p1');
  });

  it('AC-806 replays search, filters and sort from the URL into the server query', () => {
    renderPage('/expenses?q=field%20visit&status=Submitted&kind=claim&category=Special%20expenses&project=p1&sort=oldest');
    expect(h.listSpy).toHaveBeenLastCalledWith({
      search: 'field visit', status: 'Submitted', kind: 'claim', budgetCategory: 'Special expenses', projectId: 'p1', sort: 'oldest',
    });
  });

  it('AC-806 category filters own their URL key while retaining the rest of the collection state', async () => {
    renderPage('/expenses?q=hotel&project=p1&sort=oldest');
    await userEvent.selectOptions(screen.getByLabelText('Budget category', { selector: 'input, select, textarea' }), 'Special expenses');
    expect(mockNavigate).toHaveBeenCalledWith('/expenses?q=hotel&project=p1&sort=oldest&category=Special+expenses', { replace: true, state: null });
  });

  it('AC-806 switches to one outstanding-advances view and labels its date sort', async () => {
    renderPage('/expenses?status=Submitted&project=p1');
    expect(screen.getByRole('button', { name: 'Newest claims' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Outstanding advances' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses?status=Submitted&project=p1&view=outstanding', { replace: true, state: null });
  });

  it('AC-806 clears collection filters without dropping unrelated query state', async () => {
    h.list.data = { rows: [], truncated: false };
    renderPage('/expenses?q=missing&project=p1&status=Rejected&tab=mine');
    await userEvent.click(within(screen.getByTestId('money-out-toolbar')).getByRole('button', { name: 'Clear filters' }));
    expect(mockNavigate).toHaveBeenCalledWith('/expenses?tab=mine', { replace: true, state: null });
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
