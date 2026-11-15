import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-PAGE-024 (#843): an organization with more expense records than one page reaches the OLDEST record
 * from the All view, and the list says how many it shows of how many exist. The real paging hook runs;
 * only the repository is mocked, so the test proves the page asks for the next page with the cursor.
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
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }) }));
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

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/expenses']}><ToastProvider><ExpenseClaims /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.list.mockReset().mockImplementation(async (_filters: unknown, cursor?: unknown) =>
    cursor ? { rows: [OLDEST], truncated: false } : { rows: NEWEST, truncated: true });
  h.count.mockReset().mockResolvedValue(51);
});

describe('AC-PAGE-024 expense claims beyond the first page', () => {
  it('AC-PAGE-024 the All view reads "Showing 50 of 51" and drops the "latest 200" dead end', async () => {
    renderPage();
    expect(await screen.findByText('Showing 50 of 51')).toBeInTheDocument();
    expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument();
    expect(screen.queryByText('Oldest claim')).not.toBeInTheDocument();
    expect(h.count).toHaveBeenCalledWith({});
  });

  it('AC-PAGE-024 the oldest claim is reachable from the All view and the count then reads 51 of 51', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Oldest claim')).toBeInTheDocument();
    expect(screen.getByText('Showing 51 of 51')).toBeInTheDocument();
    expect(h.list).toHaveBeenLastCalledWith({}, { createdAt: NEWEST[49].created_at, id: NEWEST[49].id });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('AC-PAGE-023 a failed second page keeps the first page on screen with a retry at the Load more spot', async () => {
    let failNext = true;
    h.list.mockImplementation(async (_filters: unknown, cursor?: unknown) => {
      if (!cursor) return { rows: NEWEST, truncated: true };
      if (failNext) { failNext = false; throw new Error('network'); }
      return { rows: [OLDEST], truncated: false };
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText("Couldn't load more expenses")).toBeInTheDocument();
    expect(screen.getByText(NEWEST[0].title)).toBeInTheDocument();
    expect(screen.getByText('Showing 50 of 51')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText('Oldest claim')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load more expenses")).not.toBeInTheDocument();
  });
});
