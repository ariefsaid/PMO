import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-PAGE-024 (#843): an organization with more expense records than one page reaches the OLDEST record
 * from the All view through numbered pages kept in the address, and the list says how many it shows of how many exist. The real paging hook runs;
 * only the repository is mocked, so the test proves the page asks for the numbered page named in the address.
 */
const h = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { expenseClaim: { page: h.list, count: h.count } } }));
vi.mock('@/src/hooks/useExpenseClaims', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/hooks/useExpenseClaims')>();
  const idle = { data: { rows: [], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
  return {
    useExpenseClaimPages: real.useExpenseClaimPages,
    useExpenseAdvanceAging: () => idle,
    useExpenseAdvanceAgingTotals: () => ({ data: {}, isPending: false, isError: false, refetch: vi.fn() }),
    useOwnExpenseAdvances: () => idle,
    useExpenseClaimMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  };
});
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestFloatChoices: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'ready', retry: vi.fn() }) }));

import ExpenseClaims from '../ExpenseClaims';

const claim = (n: number, title = `Claim ${n}`) => ({
  id: `c${n}`, claim_number: `EXP-${n}`, kind: 'claim', title, claimant: { full_name: 'Field Engineer' },
  project: null, budget_category: null, amount: 1000, currency: 'IDR', status: 'Submitted',
  created_at: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000000+00:00`,
});
const NEWEST = Array.from({ length: 50 }, (_, i) => claim(51 - i));
const OLDEST = claim(1, 'Oldest claim');

const Where: React.FC = () => <output data-testid="where">{useLocation().search}</output>;
const renderPage = (entry = '/expenses') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[entry]}><ToastProvider><ExpenseClaims /><Where /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.list.mockReset().mockImplementation(async (_filters: unknown, page?: number) =>
    (page ?? 1) > 1 ? { rows: [OLDEST], truncated: false } : { rows: NEWEST, truncated: true });
  h.count.mockReset().mockResolvedValue(51);
});

describe('AC-PAGE-024 expense claims beyond the first page', () => {
  it('AC-PAGE-024 the All view reads "Showing 1–50 of 51", has numbered pages and no Load more', async () => {
    renderPage();
    expect(await screen.findByText('Showing 1–50 of 51')).toBeInTheDocument();
    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument();
    expect(screen.queryByText('Oldest claim')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(h.count).toHaveBeenCalledWith({});
  });

  it('AC-PAGE-024 the oldest claim is reachable by page 2, which is kept in the address', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Page 2' }));
    expect(await screen.findByText('Oldest claim')).toBeInTheDocument();
    expect(screen.getByText('Showing 51–51 of 51')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('?page=2');
    expect(h.list).toHaveBeenLastCalledWith({}, 2);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('AC-PAGE-025 an address naming page 2 opens on it, and Previous returns to a clean first-page address', async () => {
    const user = userEvent.setup();
    renderPage('/expenses?page=2');
    expect(await screen.findByText('Oldest claim')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('Showing 1–50 of 51')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^$/);
  });

  it('AC-PAGE-025 changing a filter starts again at page 1 and keeps the filter', async () => {
    const user = userEvent.setup();
    renderPage('/expenses?page=2');
    await screen.findByText('Oldest claim');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Approved');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?status=Approved'));
    expect(screen.getByTestId('where')).not.toHaveTextContent('page=');
    expect(h.list).toHaveBeenLastCalledWith({ status: 'Approved' }, 1);
  });

  it('AC-PAGE-025 an address past the last page is corrected to the last page', async () => {
    renderPage('/expenses?page=9');
    expect(await screen.findByText('Oldest claim')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?page=2'));
  });

  it('AC-PAGE-023 a failed page read says so with a retry, and the retry loads the page', async () => {
    let failNext = true;
    h.list.mockImplementation(async (_filters: unknown, page?: number) => {
      if ((page ?? 1) === 1) return { rows: NEWEST, truncated: true };
      if (failNext) { failNext = false; throw new Error('network'); }
      return { rows: [OLDEST], truncated: false };
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Page 2' }));
    await user.click(await screen.findByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText('Oldest claim')).toBeInTheDocument();
  });
});
