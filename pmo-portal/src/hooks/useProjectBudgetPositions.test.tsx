import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { read, auth, permissions } = vi.hoisted(() => ({
  read: vi.fn(),
  auth: { orgId: 'org-1' as string | null },
  permissions: { allowed: true },
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.orgId ? { org_id: auth.orgId } : null }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => permissions.allowed }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { projectMoney: { budgetPositions: read } } }));

import { useProjectBudgetPositions } from './useProjectBudgetPositions';

const wrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('useProjectBudgetPositions', () => {
  it('reads the canonical S03 position for a sorted, deduplicated project set', async () => {
    const positions = { p1: { projectId: 'p1', usedPercent: '90' } };
    read.mockResolvedValue(positions);
    const { result } = renderHook(() => useProjectBudgetPositions(['p2', 'p1', 'p1']), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(['p1', 'p2']);
    expect(result.current.data).toEqual(positions);
  });

  it('does not query when there is no organization, permission, or project ID', () => {
    auth.orgId = null;
    const noOrg = renderHook(() => useProjectBudgetPositions(['p1']), { wrapper: wrapper(client()) });
    expect(noOrg.result.current.fetchStatus).toBe('idle');
    expect(read).not.toHaveBeenCalled();

    auth.orgId = 'org-1';
    permissions.allowed = false;
    const denied = renderHook(() => useProjectBudgetPositions(['p1']), { wrapper: wrapper(client()) });
    expect(denied.result.current.fetchStatus).toBe('idle');
    expect(read).not.toHaveBeenCalled();

    permissions.allowed = true;
    const empty = renderHook(() => useProjectBudgetPositions([]), { wrapper: wrapper(client()) });
    expect(empty.result.current.fetchStatus).toBe('idle');
    expect(read).not.toHaveBeenCalled();
    auth.orgId = null;
  });
});
