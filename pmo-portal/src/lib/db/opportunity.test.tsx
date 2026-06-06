import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { maybeSingle, eq, select, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { maybeSingle, eq, select, from };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

import { getOpportunity, useOpportunity } from './opportunity';

describe('getOpportunity DAL (AC-SP-208)', () => {
  beforeEach(() => {
    from.mockClear(); select.mockClear(); eq.mockClear(); maybeSingle.mockClear();
  });

  it('AC-SP-208: selects the org-scoped project row by id (no org_id arg — RLS scopes)', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: 'p1', name: 'Acme', code: 'OPP-1', status: 'Tender Submitted',
        client_id: 'c1', project_manager_id: 'u1', contract_value: 1000, win_probability: null,
        customer_contract_ref: null, contract_date: null, decided_at: null,
      },
      error: null,
    });
    const row = await getOpportunity('p1');
    expect(from).toHaveBeenCalledWith('projects');
    expect(eq).toHaveBeenCalledWith('id', 'p1');
    expect(row?.code).toBe('OPP-1');
  });

  it('AC-SP-208: returns null when the row is absent', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getOpportunity('missing')).toBeNull();
  });

  it('AC-SP-208: throws the RPC/query error message', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getOpportunity('p1')).rejects.toThrow('boom');
  });
});

describe('useOpportunity hook (AC-SP-208)', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

  beforeEach(() => {
    from.mockClear(); select.mockClear(); eq.mockClear(); maybeSingle.mockClear();
  });

  it('AC-SP-208: fetches the row by id when org + id are present (org-scoped queryKey)', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'p1', name: 'Acme' }, error: null });
    const { result } = renderHook(() => useOpportunity('p1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eq).toHaveBeenCalledWith('id', 'p1');
    expect(result.current.data?.name).toBe('Acme');
  });

  it('AC-SP-208: is disabled (no fetch) when the id is undefined', () => {
    const { result } = renderHook(() => useOpportunity(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(from).not.toHaveBeenCalled();
  });
});
