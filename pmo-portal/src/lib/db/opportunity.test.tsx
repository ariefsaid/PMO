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

import { getOpportunity, useOpportunity, OPPORTUNITY_COLUMNS } from './opportunity';

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

  // ── REGRESSION GATE (AC-SP-210) ────────────────────────────────────────────────────────────
  // The pre-win fallback query is an EXPLICIT column list, and the active-projects query is
  // `select('*')`. Every field the detail page formats must therefore be named here or the
  // pipeline lens silently receives `undefined` where the on-hand lens receives a value.
  //
  // ⚑ THIS IS NOT HYPOTHETICAL — IT SHIPPED TWICE ON THIS EXACT PATH.
  //   1. The unqualified `pm:profiles(...)` embed (fixed in-file) broke the canonical detail route
  //      for every pipeline record while the active-list query looked fine.
  //   2. `currency` was added to `projects` by the currency seam and never added here, so
  //      `formatCurrency(contract, project.currency)` threw `Currency code is required with
  //      currency style` inside `ProjectDetailHeader` and the error boundary ate the whole page.
  //
  // Both were invisible to the compiler because `getOpportunity` returns `as unknown as
  // OpportunityRow`, and both were invisible to every unit test because the mock returns whatever
  // the test hands it. Only a browser journey caught them — at the promote gate, 133 commits late.
  // This asserts the SELECT itself, which is the thing that was wrong.
  it('AC-SP-210: the select names every projects column the detail page renders', () => {
    const selected = OPPORTUNITY_COLUMNS;
    // Derived by reading `pages/project-detail/**` for `project.<field>` — the fields the pipeline
    // lens actually reads off the record. `budget`/`spent` are deliberately absent: ProjectDetail
    // defaults them to 0 for a pre-win record, which has neither.
    for (const field of [
      'id', 'name', 'code', 'status', 'client_id', 'project_manager_id',
      'contract_value', 'currency', 'customer_contract_ref', 'contract_date', 'decided_at',
      'start_date', 'end_date',
    ]) {
      expect(selected, `detail page reads project.${field}`).toContain(field);
    }
  });

  it('AC-SP-210: a fetched row carries the currency the header formats with', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'p1', name: 'Acme', currency: 'IDR', contract_value: 1000 },
      error: null,
    });
    const row = await getOpportunity('p1');
    // Guards the TYPE as much as the value: if `currency` leaves OpportunityRow, this stops compiling.
    expect(row?.currency).toBe('IDR');
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
