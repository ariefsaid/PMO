import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/procurements', () => ({
  listProcurements: vi.fn().mockResolvedValue([
    { id: 'pc1', title: 'Workstations & AV', project: null, vendor: null, requested_by: null },
  ]),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProcurements } from './useProcurements';
import { listProcurements } from '@/src/lib/db/procurements';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useProcurements', () => {
  it("keys by ['procurements', orgId] and returns rows (AC-501, FR-QRY-PROC-001)", async () => {
    const { result } = renderHook(() => useProcurements(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].title).toBe('Workstations & AV');
    expect(listProcurements).toHaveBeenCalled();
  });
});
