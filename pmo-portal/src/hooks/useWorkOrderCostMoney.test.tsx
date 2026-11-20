import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkOrderCostLine } from '@/src/lib/db/workOrderCosts';

const costMoney = vi.hoisted(() => vi.fn(async (lines: WorkOrderCostLine[]) => ({ purchase_order: { [lines[0].recordId]: { amount: 10, currency: 'USD' } } })));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org' } }) }));
vi.mock('@/src/lib/repositories/workOrderCosts', () => ({ workOrderCostRepository: { costMoney } }));
import { useWorkOrderCostMoney } from './useWorkOrderCosts';

const line = (recordId: string): WorkOrderCostLine => ({ source: 'purchase_order', recordId, projectId: 'p', workOrderId: 'w', disciplineId: null, occurredOn: null, reference: null, quantity: null, quantityUnit: null });

describe('work order cost money', () => {
  it('fetches new money when a same-count replacement changes the record', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ lines }) => useWorkOrderCostMoney('w', lines), { wrapper, initialProps: { lines: [line('old')] } });
    await waitFor(() => expect(result.current.data?.purchase_order?.old).toBeDefined());
    rerender({ lines: [line('new')] });
    await waitFor(() => expect(result.current.data?.purchase_order?.new).toBeDefined());
  });
});
