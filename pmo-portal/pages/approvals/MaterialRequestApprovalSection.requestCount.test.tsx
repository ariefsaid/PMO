import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The approvals inbox reads the waiting material requests in one batch, not four reads per row plus one work-order read per
// row (perf-1124: 300 waiting requests made one /approvals load 1,200+ calls and p95 76 s at 100 users).
const repo = vi.hoisted(() => ({
  waitingForMe: vi.fn(), get: vi.fn(), headers: vi.fn(),
}));
const workOrderReads = vi.hoisted(() => [] as Array<string | undefined>);
vi.mock('@/src/lib/repositories/materialRequests', () => ({ materialRequestRepository: repo }));
vi.mock('@/src/hooks/useOrgId', () => ({ useOrgId: () => 'org-1' }));
vi.mock('@/src/hooks/useWorkOrderRecord', () => ({ useWorkOrder: (id: string | undefined) => { workOrderReads.push(id); return { data: undefined }; } }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'p1', code: 'P-1', name: 'Site one' }] }) }));

import { MaterialRequestApprovalSection } from './MaterialRequestApprovalSection';

const ids = ['r1', 'r2', 'r3'];
beforeEach(() => {
  vi.clearAllMocks();
  workOrderReads.length = 0;
  repo.waitingForMe.mockResolvedValue(ids.map((id, i) => ({ requestId: id, stepPosition: 1, role: 'Project Manager', jobRole: null, label: 'Project manager', actingFor: null, submittedAt: `2026-11-1${i}T08:00:00Z` })));
  repo.headers.mockImplementation(async (want: string[]) => want.map((id) => ({
    id, number: `MR-${id}`, workOrderId: `wo-${id}`, projectId: 'p1', neededBy: '2026-12-01', workOrder: { wo_number: `WO-${id}`, title: 'Foundations' },
  })));
});

describe('MaterialRequestApprovalSection reads', () => {
  it('reads every waiting request in one batch and no request or work order one by one', async () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MaterialRequestApprovalSection />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const section = await screen.findByRole('region', { name: 'Material requests awaiting you' });
    await waitFor(() => expect(within(section).getByText('MR-r3')).toBeInTheDocument());
    expect(within(section).getByText('WO-r1 · Foundations')).toBeInTheDocument();
    expect(within(section).getAllByText(/^Needed by /).length).toBe(3);
    expect(repo.headers).toHaveBeenCalledTimes(1);
    expect(repo.headers.mock.calls[0][0]).toEqual(ids);
    expect(repo.get).not.toHaveBeenCalled();
    expect(workOrderReads.filter(Boolean)).toEqual([]);
  });
});
