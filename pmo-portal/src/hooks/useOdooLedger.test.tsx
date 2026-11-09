// AC-009 of #897 for the Odoo ledger hooks: a cached figure never crosses a role or user change.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({ health: vi.fn(), user: { id: 'u1', org_id: 'org-1' } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: h.user }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { odooLedger: { health: h.health } } }));

import { useOdooLedgerHealth } from './useOdooLedger';

const ok = { state: 'fresh', asOf: null, caughtUp: true, lastCensus: null, check: null, lastGood: null, unmapped: null, unattributed: null, unlinked: null };
beforeEach(() => { h.health.mockReset(); h.health.mockResolvedValue(ok); h.user = { id: 'u1', org_id: 'org-1' }; });

function run(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children, r = role }: { children: ReactNode; r?: string }) => (
    <QueryClientProvider client={client}><ImpersonationProvider realRole={r as never}>{children}</ImpersonationProvider></QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useOdooLedgerHealth cache keys', () => {
  it('carry org, user and real role, so another role never reads this role’s figures', async () => {
    const { client, wrapper } = run('Finance');
    const a = renderHook(() => useOdooLedgerHealth('p1'), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const key = client.getQueryCache().getAll()[0].queryKey;
    expect(key.slice(0, 4)).toEqual(['odoo-ledger', 'org-1', 'u1', 'Finance']);
    const b = renderHook(() => useOdooLedgerHealth('p1'), { wrapper: ({ children }) => wrapper({ children, r: 'Project Manager' }) });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(h.health).toHaveBeenCalledTimes(2);
    expect(client.getQueryCache().getAll().map((q) => q.queryKey[3]).sort()).toEqual(['Finance', 'Project Manager']);
  });

  it('a different user in the same role is a different entry', async () => {
    const { client, wrapper } = run('Finance');
    const a = renderHook(() => useOdooLedgerHealth(undefined), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    h.user = { id: 'u2', org_id: 'org-1' };
    const b = renderHook(() => useOdooLedgerHealth(undefined), { wrapper });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(h.health).toHaveBeenCalledTimes(2);
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });

  it('does not ask until a user, org and role are known', () => {
    h.user = { id: '', org_id: '' };
    const { wrapper } = run('Finance');
    renderHook(() => useOdooLedgerHealth(undefined), { wrapper });
    expect(h.health).not.toHaveBeenCalled();
  });
});
