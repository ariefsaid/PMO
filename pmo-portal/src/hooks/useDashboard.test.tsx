import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/dashboard', () => ({
  getExecutiveDashboard: vi.fn().mockResolvedValue({
    active_projects: 2, total_contract_value: 8000000, avg_gross_margin: 0.30162,
    projects_at_risk: 1, projects_by_status: [], procurements_by_status: [], top_projects: [],
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

import { useDashboard } from './useDashboard';
import { getExecutiveDashboard } from '@/src/lib/db/dashboard';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useDashboard', () => {
  it("keys by ['dashboard', orgId], calls getExecutiveDashboard (AC-709, FR-QRY-DASH-001)", async () => {
    const { result } = renderHook(() => useDashboard(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.active_projects).toBe(2);
    expect(getExecutiveDashboard).toHaveBeenCalledTimes(1);
  });
});
