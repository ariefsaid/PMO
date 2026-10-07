import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ transition: vi.fn(async () => undefined) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrder: { transition: h.transition } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));

import { useWorkOrderMutations } from './useWorkOrders';

describe('useWorkOrderMutations (OD-BILL-1)', () => {
  it('AC-BWO-004 closing or cancelling a work order refreshes its billing (Invoice is offered only on Issued/Closed)', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useWorkOrderMutations('p1'), { wrapper });
    await act(async () => { await result.current.transition.mutateAsync({ id: 'wo-1', to: 'Closed' }); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-order-billing', 'org-1', 'p1'] });
    // The dashboards' still-to-invoice card reads the same fact across the org.
    expect(spy).toHaveBeenCalledWith({ queryKey: ['unbilled-work-orders', 'org-1'] });
  });
});
