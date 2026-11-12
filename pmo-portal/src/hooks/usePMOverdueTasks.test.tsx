import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePMOverdueTasks } from './usePMOverdueTasks';

const state = vi.hoisted(() => ({
  listDueRows: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' } }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { task: { listDueRows: state.listDueRows } },
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('usePMOverdueTasks', () => {
  beforeEach(() => state.listDueRows.mockReset());

  it('shares the overdue project task cache entry and resolves from the batched task read', async () => {
    state.listDueRows.mockResolvedValue([{ id: 'task-1', project_id: 'p1' }]);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => usePMOverdueTasks(['p1', 'p2'], true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.listDueRows).toHaveBeenCalledOnce();
    expect(state.listDueRows).toHaveBeenCalledWith(['p1', 'p2']);
    expect(queryClient.getQueryState(['pm-overdue-tasks', 'org-1', ['p1', 'p2']])?.data).toEqual([
      { id: 'task-1', project_id: 'p1' },
    ]);
  });

  it('does not start the read before project ids are available', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => usePMOverdueTasks([], false), { wrapper });

    expect(state.listDueRows).not.toHaveBeenCalled();
    expect(result.current.isFetching).toBe(false);
  });
});
