import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

/**
 * G2 (dropped-restored §3): the redesign renamed the rail's Finance destination to "Overview" and
 * dropped its overdue-invoice count, while the page title and breadcrumb both still read
 * "Finance" — one place, two names, and no count for the Finance reader. The item is "Finance"
 * again with the count restored, sourced from the existing overdue-invoice read.
 */
const { overdue } = vi.hoisted(() => ({ overdue: { count: 3 as number | undefined, isPending: false, isError: false } }));

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
  useOverdueInvoiceCount: () => ({ data: overdue.count, isPending: overdue.isPending, isError: overdue.isError }),
}));
vi.mock('@/src/lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/features')>()),
  isFeatureEnabled: () => false,
  FEATURE_ENV_DEFAULT: { revenue: true, procurement: true },
}));

import { Rail } from '../Rail';
import { RailDrawerContext } from '../railDrawerContext';

const renderRail = () => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ currentUser: { id: 'u-finance', org_id: 'org-1' }, role: 'Finance' } as AuthContextValue}>
        <MemoryRouter initialEntries={['/']}>
          <RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
};

describe('G2: the rail names the Finance hub "Finance" and counts its overdue invoices', () => {
  it('uses the page title’s name and shows the overdue count beside it', () => {
    overdue.count = 3;
    overdue.isPending = false;
    overdue.isError = false;
    renderRail();
    // The rail and the page title/breadcrumb agree on one name, and the count rides on the link.
    const link = screen.getByRole('link', { name: 'Finance, 3 overdue invoices' });
    expect(link).toHaveAttribute('href', '/finance');
    expect(screen.queryByRole('link', { name: /Overview/ })).not.toBeInTheDocument();
    // Non-zero count: a badge with the number, named for screen readers.
    expect(within(link).getByText('3')).toBeInTheDocument();
  });

  it('shows no count when nothing is overdue', () => {
    overdue.count = 0;
    overdue.isPending = false;
    overdue.isError = false;
    renderRail();
    const link = screen.getByRole('link', { name: 'Finance' });
    expect(within(link).queryByText('0')).not.toBeInTheDocument();
  });

  it('shows no count while the read is pending or failed (unknown is not zero)', () => {
    overdue.count = undefined;
    overdue.isPending = true;
    overdue.isError = false;
    const pending = renderRail();
    expect(screen.getByRole('link', { name: 'Finance' })).toBeInTheDocument();
    pending.unmount();

    overdue.isPending = false;
    overdue.isError = true;
    renderRail();
    expect(screen.getByRole('link', { name: 'Finance' })).toBeInTheDocument();
  });
});
