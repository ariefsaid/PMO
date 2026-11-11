import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

/**
 * AC-3 of #2101: the value and age sorts read a cached per-row derivation, so their ORDER
 * must stay exactly what the live scan produced. Value: ascending then descending by the
 * row's most-real amount. Age: ascending then descending by days in the current stage.
 */
const makeRow = (id: string, value: number, status: string, enteredStageAt: string) => ({
  id, code: `PR-${id}`, title: `Row ${id}`, status, total_value: value, approved_total_value: null, currency: 'USD',
  project_id: 'pr-1', budget_category: 'Materials', requested_by_id: 'u-2', vendor_id: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  status_events: [{ to_status: status, created_at: enteredStageAt }],
  project: { name: 'Site', code: 'P1' }, vendor: null, requested_by: { full_name: 'Requester' },
});

// Ages (days in stage, ascending): b (2026-10-01) < a (2026-09-01) < c (2026-08-01).
// Values (ascending): b 100 < c 200 < a 300.
const rows = [
  makeRow('a', 300, 'Ordered', '2026-09-01T00:00:00.000Z'),
  makeRow('b', 100, 'Ordered', '2026-10-01T00:00:00.000Z'),
  makeRow('c', 200, 'Ordered', '2026-08-01T00:00:00.000Z'),
];
const procState = { data: rows as unknown[], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, isPending: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: 'Finance' }) }));

const renderBlock = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><ToastProvider><ProcurementBlock showCreate={false} /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

/** The visible row order, read off the row-header buttons ("Open Row a"). */
const rowOrder = () => screen.getAllByRole('button', { name: /^Open Row / })
  .map((button) => button.getAttribute('aria-label')!.replace('Open Row ', ''));

describe('ProcurementBlock sort order (#2101)', () => {
  it('keeps the value sort order: ascending, then descending', () => {
    renderBlock();
    const header = screen.getByRole('button', { name: /^Value/ });
    expect(rowOrder()).toEqual(['a', 'b', 'c']);

    fireEvent.click(header);
    expect(rowOrder()).toEqual(['b', 'c', 'a']);

    fireEvent.click(header);
    expect(rowOrder()).toEqual(['a', 'c', 'b']);
  });

  it('keeps the age-in-stage sort order: ascending, then descending', () => {
    renderBlock();
    const header = screen.getByRole('button', { name: /^In stage/ });

    fireEvent.click(header);
    expect(rowOrder()).toEqual(['b', 'a', 'c']);

    fireEvent.click(header);
    expect(rowOrder()).toEqual(['c', 'a', 'b']);
  });
});
