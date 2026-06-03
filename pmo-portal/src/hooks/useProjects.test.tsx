import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/projects', () => ({
  listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'X', client: null, pm: null }]),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProjects } from './useProjects';
import { listProjects } from '@/src/lib/db/projects';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useProjects', () => {
  it("keys by ['projects', orgId] and returns rows (FR-QRY-002, FR-PROJ-001)", async () => {
    const { result } = renderHook(() => useProjects(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('X');
    expect(listProjects).toHaveBeenCalled();
  });
});
