import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ create: vi.fn(async () => ({ id: 'si-1', si_number: 'ACC-SINV-1' })) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: { createInvoice: h.create } } }));

import { useRevenueMutations } from './useRevenue';

describe('useRevenueMutations.create (OD-BILL-1)', () => {
  it('AC-BWO-003 sends the work order and refreshes work-order billing and the dashboard figure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });
    const input = { customerId: 'c-1', projectId: 'p1', workOrderId: 'wo-1', items: [{ item_code: 'SVC', qty: 1, rate: 10 }] };
    await act(async () => { await result.current.create.mutateAsync(input); });
    expect(h.create).toHaveBeenCalledWith(input, undefined);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-order-billing'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['unbilled-work-orders'] });
  });
});
