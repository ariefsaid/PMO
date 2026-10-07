import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  billing: vi.fn(async () => []),
  unbilled: vi.fn(async () => ({ totals: [], incompleteCount: 0, rows: [] })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrder: { billing: h.billing, unbilled: h.unbilled } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));

import { useUnbilledWorkOrders, useWorkOrderBilling } from './useWorkOrderBilling';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { h.billing.mockClear(); h.unbilled.mockClear(); });

describe('work-order billing hooks (OD-BILL-1)', () => {
  it("AC-BWO-004 reads the project's billing", async () => {
    const { result } = renderHook(() => useWorkOrderBilling('p1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.billing).toHaveBeenCalledWith('p1');
  });
  it('AC-BWO-004 does not read when the caller may not see billing', async () => {
    renderHook(() => useWorkOrderBilling('p1', false), { wrapper: wrapper() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.billing).not.toHaveBeenCalled();
  });
  it('AC-UNB-005 asks for the 8 work orders with the most left', async () => {
    const { result } = renderHook(() => useUnbilledWorkOrders(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.unbilled).toHaveBeenCalledWith(8);
  });
});
