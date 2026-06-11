import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { milestone } = vi.hoisted(() => ({
  milestone: {
    list: vi.fn(),
    deliveryForProjects: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setTaskMilestone: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { milestone } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useMilestones, useMilestoneMutations } from './useMilestones';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const seedMilestone: MilestoneWithProgress = {
  id: 'm1',
  project_id: 'p1',
  name: 'Engineering design',
  sort_order: 0,
  target_date: null,
  weight: 1,
  input_pct: null,
  task_count: 5,
  calculated_pct: 100,
  effective_pct: 100,
};

beforeEach(() => {
  milestone.list.mockResolvedValue([seedMilestone]);
  milestone.create.mockResolvedValue({ ...seedMilestone, id: 'm2' });
  milestone.update.mockResolvedValue(undefined);
  milestone.delete.mockResolvedValue(undefined);
  milestone.setTaskMilestone.mockResolvedValue(undefined);
});

describe('useMilestones', () => {
  it("useMilestones queries by project and invalidates tasks + projects on mutate", async () => {
    const client = freshClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useMilestones('p1'), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('Engineering design');
    expect(milestone.list).toHaveBeenCalledWith('p1');

    // Test invalidation after create
    const { result: mutResult } = renderHook(() => useMilestoneMutations('p1'), {
      wrapper: wrap(client),
    });
    await act(async () => {
      await mutResult.current.create.mutateAsync({
        input: { name: 'Phase 2', sort_order: 1, target_date: null, weight: 1 },
      });
    });
    // Should invalidate milestones, tasks, and projects-delivery (no ['projects'] — redundant).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['milestones', 'org-1', 'p1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks', 'org-1', 'p1'] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['projects'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['projects-delivery'] });
  });

  it('is disabled (no fetch) without a projectId', () => {
    milestone.list.mockClear();
    const { result } = renderHook(() => useMilestones(''), { wrapper: wrap(freshClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(milestone.list).not.toHaveBeenCalled();
  });
});
