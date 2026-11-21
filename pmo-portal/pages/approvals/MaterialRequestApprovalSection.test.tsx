/** #2685 AC-MRI-015 — a decided step leaves the inbox without a reload (the decision refreshes the material-request queries). */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ waiting: vi.fn() }));
vi.mock('@/src/lib/repositories/materialRequests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories/materialRequests')>();
  return { ...actual, materialRequestRepository: { ...actual.materialRequestRepository, waitingForMe: h.waiting, get: async (id: string) => ({ id, number: 'MR-0007', workOrderId: 'wo1', projectId: 'p1', neededBy: '2026-12-01' }) } };
});
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
// The real RequestWorkOrder renders a link; the row must not wrap it in another.
vi.mock('../materialRequests/shared', () => ({ RequestWorkOrder: () => <a href="/work-orders/wo1">WO</a> }));

import { MaterialRequestApprovalSection } from './MaterialRequestApprovalSection';
import { MATERIAL_REQUEST_QUERY_ROOT } from '@/src/hooks/useMaterialRequests';

describe('AC-MRI-012 row markup', () => {
  it('no link sits inside another link, and the request number is the one link to the request', async () => {
    h.waiting.mockReset();
    h.waiting.mockResolvedValue([{ requestId: 'mr-7', stepPosition: 1, role: 'Finance', label: 'Stock check', actingFor: null, submittedAt: '2026-11-20T08:00:00Z' }]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<MemoryRouter><QueryClientProvider client={qc}><MaterialRequestApprovalSection /></QueryClientProvider></MemoryRouter>);
    const number = await screen.findByRole('link', { name: 'MR-0007' });
    expect(number).toHaveAttribute('href', '/material-requests/mr-7');
    expect(container.querySelectorAll('a a').length).toBe(0);
    expect(container.querySelectorAll('a[href="/material-requests/mr-7"]').length).toBe(1);
  });
});

describe('AC-MRI-015 the row leaves when its step is decided', () => {
  it('refreshing the material-request queries drops the decided request', async () => {
    h.waiting.mockResolvedValueOnce([{ requestId: 'mr-7', stepPosition: 1, role: 'Finance', label: 'Stock check', actingFor: null, submittedAt: '2026-11-20T08:00:00Z' }]);
    h.waiting.mockResolvedValue([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={qc}><MaterialRequestApprovalSection /></QueryClientProvider></MemoryRouter>);
    expect(await screen.findByText('MR-0007')).toBeInTheDocument();
    // What every decision mutation does on success (useMaterialRequestMutations).
    await qc.invalidateQueries({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, 'org-1'] });
    await waitFor(() => expect(screen.queryByText('MR-0007')).toBeNull());
  });
});
