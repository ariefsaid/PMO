import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/timesheets', () => ({
  listTimesheets: vi.fn().mockResolvedValue([
    { id: 'ts1', user_id: 'u1', week_start_date: '2026-06-01', status: 'Draft', entries: [] },
  ]),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useTimesheets } from './useTimesheets';
import { listTimesheets } from '@/src/lib/db/timesheets';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useTimesheets', () => {
  it("keys by ['timesheets', orgId, userId], calls listTimesheets(userId) (AC-601, FR-QRY-TS-001)", async () => {
    const { result } = renderHook(() => useTimesheets(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].week_start_date).toBe('2026-06-01');
    expect(listTimesheets).toHaveBeenCalledWith('u1');
  });
});
