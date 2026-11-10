import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

/**
 * #2106 AC-PERF-2106-1 — the /imprest list's position reads, counted at the repository seam.
 *
 * Before: every row's five money cells called useImprestPosition(floatId), so a 50-float list issued 50 separate
 * ledger aggregates and every column read "…" until its own request landed. After: ONE batched position read for
 * the page, seeded into each float's own `imprest-position` cache entry. The unit-level oracle is the closed
 * procurement file: this test counts REQUESTS, so a future per-row reintroduction fails here even though the money
 * cells would still render the right figures.
 */

const h = vi.hoisted(() => ({
  listFloats: vi.fn(),
  getPositions: vi.fn(),
  getPosition: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: { imprest: { listFloats: h.listFloats, getPositions: h.getPositions, getPosition: h.getPosition } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [] }) }));

import ImprestFloatsPage from './ImprestFloats';

const FLOAT_COUNT = 50;
const floatId = (i: number) => `2106f000-0000-0000-0000-${String(i).padStart(12, '0')}`;

const floatRow = (i: number) => ({
  id: floatId(i), project_id: 'p1', custodian_id: 'u-fin', currency: 'IDR', float_amount: 5000000, archived_at: null,
  project: { name: `Site ${String(i).padStart(2, '0')}` }, custodian: { full_name: 'Finn Finance' },
});
const positionRow = (i: number) => ({
  float_id: floatId(i), float_amount: 5000000, cash_book: 1200000 + i, advances_out: 300000, receipts_waiting: 3500000,
  replenishment_in_flight: 0, gap: 0, funded_total: 5000000, last_count_at: null, last_count_variance: null,
  month: '2026-11-01', plan_lines: [],
});

const renderPage = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider><ImprestFloatsPage /></ToastProvider></MemoryRouter>
    </QueryClientProvider>,
  );
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('AC-PERF-2106-1 /imprest list positions arrive in one batched read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listFloats.mockResolvedValue({ rows: Array.from({ length: FLOAT_COUNT }, (_, i) => floatRow(i)), truncated: false });
    h.getPositions.mockImplementation(async (ids: string[]) => ids.map((id) => positionRow(Number(id.slice(-12)))));
  });

  it('AC-PERF-2106-1 50 floats cost at most 2 position requests (was 50)', async () => {
    renderPage(fresh());
    expect(await screen.findByRole('row', { name: /Site 01/ })).toBeInTheDocument();
    await waitFor(() => expect(h.getPositions).toHaveBeenCalledTimes(1));

    const requests = h.getPositions.mock.calls.length + h.getPosition.mock.calls.length;
    expect(requests).toBeLessThanOrEqual(2);
    expect(h.getPosition).not.toHaveBeenCalled();
    expect(h.getPositions).toHaveBeenCalledTimes(1);
    expect(h.getPositions.mock.calls[0][0]).toHaveLength(FLOAT_COUNT);
  });

  it('AC-PERF-2106-1 every row shows its own figures (and none waits on a per-row request)', async () => {
    renderPage(fresh());
    expect(await screen.findByRole('row', { name: /Site 01/ })).toBeInTheDocument();
    // The 50th row's cash figure comes from the same batched response; a per-row read could not have it yet.
    expect(await screen.findByText(/1,200,049/)).toBeInTheDocument();
    expect(screen.queryByText('…')).toBeNull();
  });

  it('AC-PERF-2106-1 each float’s position is seeded into its own cache entry, so the record page opens warm', async () => {
    const client = fresh();
    renderPage(client);
    expect(await screen.findByRole('row', { name: /Site 01/ })).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(['imprest-position', 'org-1', floatId(7)]))
      .toMatchObject({ float_id: floatId(7), cash_book: 1200007 }));
  });

  it('AC-PERF-2106-1 a failed batched read says Unavailable on every money cell, never a zero', async () => {
    h.getPositions.mockRejectedValue(new Error('network'));
    renderPage(fresh());
    expect(await screen.findByRole('row', { name: /Site 01/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0));
    expect(h.getPosition).not.toHaveBeenCalled();
  });

  it('AC-PERF-2106-1 an empty list asks for no positions at all', async () => {
    h.listFloats.mockResolvedValue({ rows: [], truncated: false });
    renderPage(fresh());
    expect(await screen.findByText('No site floats yet')).toBeInTheDocument();
    await waitFor(() => expect(h.listFloats).toHaveBeenCalledTimes(1));
    expect(h.getPositions).not.toHaveBeenCalled();
  });
});
