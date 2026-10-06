import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/procurements', () => ({
  listProcurements: vi.fn().mockResolvedValue([
    { id: 'pc1', title: 'Workstations & AV', project: null, vendor: null, requested_by: null },
  ]),
  listProcurementsByProject: vi.fn().mockResolvedValue([{ id: 'pc9', project_id: 'proj-1' }]),
  getProjectCommittedSpend: vi.fn().mockResolvedValue(200000),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { useProcurements, useProjectProcurements, useProjectCommittedSpend } from './useProcurements';
import { listProcurements, listProcurementsByProject, getProjectCommittedSpend } from '@/src/lib/db/procurements';

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

describe('useProjectCommittedSpend (AC-IXD-PROC-W5-2)', () => {
  it('returns the committed-spend total for a project', async () => {
    const { result } = renderHook(() => useProjectCommittedSpend('proj-1'), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(200000);
    expect(getProjectCommittedSpend).toHaveBeenCalledWith('proj-1');
  });

  it('is disabled (no fetch) when projectId is null', () => {
    vi.mocked(getProjectCommittedSpend).mockClear();
    const { result } = renderHook(() => useProjectCommittedSpend(null), { wrapper: wrap });
    expect(result.current.fetchStatus).toBe('idle');
    expect(getProjectCommittedSpend).not.toHaveBeenCalled();
  });
});

describe('useProjectProcurements (AC-OVERFETCH-002)', () => {
  it('reads procurement for ONE project server-side — never the org-wide list', async () => {
    vi.mocked(listProcurements).mockClear();
    const { result } = renderHook(() => useProjectProcurements('proj-1'), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listProcurementsByProject).toHaveBeenCalledWith('proj-1');
    expect(listProcurements).not.toHaveBeenCalled();
  });

  it('is disabled (no fetch) without a project id', () => {
    vi.mocked(listProcurementsByProject).mockClear();
    const { result } = renderHook(() => useProjectProcurements(undefined), { wrapper: wrap });
    expect(result.current.fetchStatus).toBe('idle');
    expect(listProcurementsByProject).not.toHaveBeenCalled();
  });
});
