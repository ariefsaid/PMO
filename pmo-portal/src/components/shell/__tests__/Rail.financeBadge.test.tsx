import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

/**
 * G2 (dropped-restored §3): the redesign renamed the rail's Finance destination to "Overview" and
 * dropped its overdue-invoice count, while the page title and breadcrumb both still read
 * "Finance" — one place, two names, and no count for the Finance reader. The item is "Finance"
 * again with the count restored, sourced from the existing overdue-invoice read.
 */
const { overdue } = vi.hoisted(() => ({
  overdue: {
    count: 3 as number | undefined,
    isPending: false,
    isError: false,
    enabledCalls: [] as boolean[],
  },
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-finance', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { revenue: true, procurement: true }, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOverdueInvoiceCount', () => ({
  useOverdueInvoiceCount: (enabled = true) => {
    overdue.enabledCalls.push(enabled);
    return { data: overdue.count, isPending: overdue.isPending, isError: overdue.isError };
  },
}));
vi.mock('@/src/lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/features')>()),
  isFeatureEnabled: () => false,
  FEATURE_ENV_DEFAULT: { revenue: true, procurement: true },
}));

import { Rail } from '../Rail';
import { RailDrawerContext } from '../railDrawerContext';

const renderRail = (initialEntry = '/') => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ currentUser: { id: 'u-finance', org_id: 'org-1' }, role: 'Finance' } as AuthContextValue}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  overdue.count = 3;
  overdue.isPending = false;
  overdue.isError = false;
  overdue.enabledCalls.length = 0;
});

describe('G2: the rail names the Finance hub "Finance" and counts its overdue invoices', () => {
  it('loads the count on a Finance route and keeps the badge beside Finance', () => {
    renderRail('/finance/receivables');
    // The rail and the page title/breadcrumb agree on one name, and the count rides on the link.
    const link = screen.getByRole('link', { name: 'Finance, 3 overdue invoices' });
    expect(link).toHaveAttribute('href', '/finance');
    expect(overdue.enabledCalls.at(-1)).toBe(true);
    expect(screen.queryByRole('link', { name: /Overview/ })).not.toBeInTheDocument();
    // Non-zero count: a badge with the number, named for screen readers.
    expect(within(link).getByText('3')).toBeInTheDocument();
  });

  it('does not start an uncached count read on project detail', () => {
    overdue.count = undefined;
    overdue.isPending = true;
    renderRail('/projects/p-1');

    expect(overdue.enabledCalls.at(-1)).toBe(false);
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/finance');
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it.each([
    ['pointer hover', (link: HTMLElement) => fireEvent.mouseEnter(link)],
    ['keyboard focus', (link: HTMLElement) => fireEvent.focus(link)],
  ])('loads the count after Finance link %s', (_intent, expressIntent) => {
    renderRail('/projects/p-1');
    const link = screen.getByRole('link', { name: /^Finance/ });
    expect(overdue.enabledCalls.at(-1)).toBe(false);

    expressIntent(link);

    expect(overdue.enabledCalls.at(-1)).toBe(true);
    expect(screen.getByRole('link', { name: 'Finance, 3 overdue invoices' })).toBeInTheDocument();
  });

  it.each([
    ['pointer hover', (link: HTMLElement) => { fireEvent.mouseEnter(link); fireEvent.mouseLeave(link); }],
    ['keyboard focus', (link: HTMLElement) => { fireEvent.focus(link); fireEvent.blur(link); }],
  ])('keeps the cached badge without leaving the count query active after %s ends', (_intent, expressAndEndIntent) => {
    renderRail('/projects/p-1');
    const link = screen.getByRole('link', { name: /^Finance/ });

    expressAndEndIntent(link);

    expect(overdue.enabledCalls.at(-1)).toBe(false);
    expect(screen.getByRole('link', { name: 'Finance, 3 overdue invoices' })).toBeInTheDocument();
  });

  it('keeps a cached badge visible on project detail without starting a new read', () => {
    renderRail('/projects/p-1');

    expect(overdue.enabledCalls.at(-1)).toBe(false);
    const link = screen.getByRole('link', { name: 'Finance, 3 overdue invoices' });
    expect(within(link).getByText('3')).toBeInTheDocument();
  });

  it('keeps Finance navigation available and enables the count after the link is followed', () => {
    renderRail('/projects/p-1');
    const link = screen.getByRole('link', { name: 'Finance, 3 overdue invoices' });
    expect(overdue.enabledCalls.at(-1)).toBe(false);

    fireEvent.click(link);

    expect(link).toHaveAttribute('href', '/finance');
    expect(screen.getByRole('link', { name: 'Finance, 3 overdue invoices' })).toHaveAttribute('aria-current', 'page');
    expect(overdue.enabledCalls.at(-1)).toBe(true);
  });

  it('shows no count when nothing is overdue', () => {
    overdue.count = 0;
    overdue.isPending = false;
    overdue.isError = false;
    renderRail('/finance');
    const link = screen.getByRole('link', { name: 'Finance' });
    expect(within(link).queryByText('0')).not.toBeInTheDocument();
  });

  it('shows no count while the read is pending or failed (unknown is not zero)', () => {
    overdue.count = undefined;
    overdue.isPending = true;
    overdue.isError = false;
    const pending = renderRail('/finance');
    expect(screen.getByRole('link', { name: 'Finance' })).toBeInTheDocument();
    pending.unmount();

    overdue.isPending = false;
    overdue.isError = true;
    renderRail('/finance');
    expect(screen.getByRole('link', { name: 'Finance' })).toBeInTheDocument();
  });
});
