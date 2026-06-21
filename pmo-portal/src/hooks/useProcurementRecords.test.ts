/**
 * Smoke test — useProcurementRecordMutations returns the expected mutation keys.
 * Mirrors the useProcurementDetail smoke-test pattern.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Stub the DAL calls so the hook doesn't need a real Supabase connection
// ---------------------------------------------------------------------------
vi.mock('@/src/lib/db/procurementRecords', () => ({
  createPurchaseRequest: vi.fn(),
  createRfq: vi.fn(),
  createPurchaseOrder: vi.fn(),
  createPayment: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }),
}));

import { useProcurementRecordMutations } from './useProcurementRecords';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useProcurementRecordMutations — mutation key smoke test', () => {
  it('returns createPurchaseRequest mutation', () => {
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(typeof result.current.createPurchaseRequest.mutateAsync).toBe('function');
  });

  it('returns createRfq mutation', () => {
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(typeof result.current.createRfq.mutateAsync).toBe('function');
  });

  it('returns createPurchaseOrder mutation', () => {
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(typeof result.current.createPurchaseOrder.mutateAsync).toBe('function');
  });

  it('returns createPayment mutation', () => {
    const { result } = renderHook(() => useProcurementRecordMutations('proc1'), { wrapper });
    expect(typeof result.current.createPayment.mutateAsync).toBe('function');
  });
});
