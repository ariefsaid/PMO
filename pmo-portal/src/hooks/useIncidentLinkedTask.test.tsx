import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { useIncidentLinkedTask } from './useIncidentLinkedTask';

const { getTask } = vi.hoisted(() => ({ getTask: vi.fn().mockResolvedValue({ id: 't1', project_id: 'p1' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { task: { get: getTask } } }));

describe('useIncidentLinkedTask', () => {
  it('loads the linked task so its own project can be opened', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useIncidentLinkedTask('t1'), { wrapper });
    await waitFor(() => expect(result.current.data?.project_id).toBe('p1'));
    expect(getTask).toHaveBeenCalledWith('t1');
  });
});
