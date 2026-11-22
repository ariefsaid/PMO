/**
 * fix-waiting item 1: the Approvals badge reads the SAME shared list as the home and the inbox. This replaces the cache-only owner-key
 * test (AC-FAA-008) that pinned the old, separate badge source: the goals it held that still apply (never a partial total, never a
 * fabricated 0, the last complete count survives a refresh, nothing without a signed-in person) are asserted here against the one source.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({ count: 4 as number | undefined, force: (() => undefined) as () => void }));
vi.mock('@/src/hooks/useWaitingForYou', async () => {
  const React = await import('react');
  return { useWaitingForYou: () => { const [, force] = React.useReducer((x: number) => x + 1, 0); h.force = force as () => void; return { count: h.count, entries: [], countFor: () => 0, pendingKinds: [], failedKinds: [], isPending: false, isError: false, refetch: vi.fn() }; } };
});

import { ApprovalsNavCount } from '../ApprovalsNavCount';

const auth = (role: AuthContextValue['role'] = 'Admin') => ({ currentUser: { id: 'user-1', org_id: 'org-1' } as AuthContextValue['currentUser'], role }) as AuthContextValue;

function mount(role: AuthContextValue['role'] = 'Admin', withAuth = true) {
  const client = new QueryClient();
  const value = withAuth ? auth(role) : null as unknown as AuthContextValue;
  const view = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={value}>
        <ImpersonationProvider realRole={role} demoEligibility="eligible"><ApprovalsNavCount /></ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, again: () => h.force() };
}

afterEach(() => { cleanup(); h.count = 4; });

describe('ApprovalsNavCount reads the shared waiting list', () => {
  it('AC-WAIT-020 shows the shared list\'s count, for any role', () => {
    mount('Engineer');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/4 pending/)).toBeInTheDocument();
  });

  it('AC-WAIT-021 shows nothing when the count is unknown (a kind unread or failed): never a partial total, never 0', () => {
    h.count = undefined;
    mount();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it('AC-WAIT-022 keeps the last complete count visible while the list refreshes, then follows the next complete one', () => {
    const view = mount();
    expect(screen.getByText('4')).toBeInTheDocument();
    h.count = undefined;
    act(() => view.again());
    expect(screen.getByText('4')).toBeInTheDocument();
    h.count = 5;
    act(() => view.again());
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });

  it('AC-WAIT-023 shows a true zero as 0 (nothing waiting is a known answer)', () => {
    h.count = 0;
    mount();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('AC-WAIT-024 renders nothing without a signed-in person', () => {
    mount('Admin', false);
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });
});
