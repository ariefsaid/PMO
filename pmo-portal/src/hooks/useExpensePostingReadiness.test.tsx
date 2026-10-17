import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * S-12 — one readiness derivation for the expense surfaces (ExpenseAccountMap, ExpenseClaims,
 * ExpenseClaimFormModal, ExpensePostingsCard). The five states the screens must distinguish are
 * asserted here; the copy each screen shows is asserted at its own layer.
 */
const h = vi.hoisted(() => ({
  binding: { data: null as { status: string } | null, isPending: false, isError: false, refetch: vi.fn() },
  ownership: { data: [] as Array<{ externalTier: string; domain: string }>, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => h.binding }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => h.ownership }));

import { useExpensePostingReadiness } from './useExpensePostingReadiness';

beforeEach(() => {
  h.binding = { data: null, isPending: false, isError: false, refetch: vi.fn() };
  h.ownership = { data: [], isPending: false, isError: false, refetch: vi.fn() };
});

describe('useExpensePostingReadiness (S-12)', () => {
  it('reports notConnected when the org has no active ERPNext binding', () => {
    const { result } = renderHook(() => useExpensePostingReadiness());
    expect(result.current.state).toBe('notConnected');
  });

  it('reports inactive when ERPNext is connected but the expenses domain is not employed — the connected-but-unready case is never "connect"', () => {
    h.binding = { ...h.binding, data: { status: 'active' } };
    const { result } = renderHook(() => useExpensePostingReadiness());
    expect(result.current.state).toBe('inactive');
  });

  it('reports ready when the binding is active and the expenses domain is employed', () => {
    h.binding = { ...h.binding, data: { status: 'active' } };
    h.ownership = { ...h.ownership, data: [{ externalTier: 'erpnext', domain: 'expenses' }] };
    const { result } = renderHook(() => useExpensePostingReadiness());
    expect(result.current.state).toBe('ready');
  });

  it('keeps unknown distinct: a failed readiness read is unavailable, never notConnected or inactive', () => {
    h.binding = { ...h.binding, isError: true };
    const { result } = renderHook(() => useExpensePostingReadiness());
    expect(result.current.state).toBe('unavailable');
    h.ownership = { ...h.ownership, isError: true };
    const again = renderHook(() => useExpensePostingReadiness());
    expect(again.result.current.state).toBe('unavailable');
  });

  it('reports checking while either readiness read is still pending', () => {
    h.binding = { ...h.binding, isPending: true };
    const { result } = renderHook(() => useExpensePostingReadiness());
    expect(result.current.state).toBe('checking');
  });

  it('a non-active binding status is notConnected, not inactive', () => {
    h.binding = { ...h.binding, data: { status: 'pending' } };
    const { result } = renderHook(() => useExpensePostingReadiness());
    expect(result.current.state).toBe('notConnected');
  });

  it('retry re-reads both underlying readiness queries', async () => {
    const { result } = renderHook(() => useExpensePostingReadiness());
    result.current.retry();
    await waitFor(() => {
      expect(h.binding.refetch).toHaveBeenCalled();
      expect(h.ownership.refetch).toHaveBeenCalled();
    });
  });
});
