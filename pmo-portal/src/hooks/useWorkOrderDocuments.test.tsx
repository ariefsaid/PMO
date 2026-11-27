import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ list: vi.fn(async () => [{ id: 'd1' }]), listForWorkOrder: vi.fn(async () => [{ id: 'd2' }]) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document: h } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));
import { useWorkOrderDocuments } from './useDocuments';

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
};

describe('work order document slice hook', () => {
  it('reads the order\'s slice, never the whole project register, and a project invalidation refreshes it', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useWorkOrderDocuments('p1', 'wo-1', ['b', 'a', 'a']), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.listForWorkOrder).toHaveBeenCalledWith('p1', 'wo-1', ['a', 'b']);
    expect(h.list).not.toHaveBeenCalled();
    await client.invalidateQueries({ queryKey: ['project-documents', 'org-1', 'p1'] });
    expect(h.listForWorkOrder).toHaveBeenCalledTimes(2);
  });
  it('waits while disabled', () => {
    const { wrapper } = setup();
    h.listForWorkOrder.mockClear();
    renderHook(() => useWorkOrderDocuments('p1', 'wo-1', [], false), { wrapper });
    expect(h.listForWorkOrder).not.toHaveBeenCalled();
  });
});
