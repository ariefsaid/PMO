/**
 * FR-L10N-020 — ProcurementListRow's expanded preview renders line items in the
 * DETAIL record's own currency (`detail.data.currency`), independent of the row
 * header's `row.currency` (they usually agree, but the source must be the right
 * one per site — not a blind default).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const detailState = {
  data: {
    project_id: null, // suppresses DecisionSupportPanel (no-op when unset)
    currency: 'EUR',
    items: [{ id: 'i1', name: 'Widget', quantity: 2, rate: 100, amount: null }],
  },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
}));
// DecisionSupportPanel's budget hooks call hooks unconditionally (before its own
// `!projectId` bail-out), so they still need stubbing even though projectId is null
// here and the panel itself renders nothing.
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

import { ProcurementListRow } from '../ProcurementListRow';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const makeRow = (over: Partial<ProcurementWithRefs> = {}): ProcurementWithRefs =>
  ({
    id: 'pr-1',
    code: 'PR-0001',
    title: 'Crane Hire',
    status: 'Requested',
    total_value: 25000,
    currency: 'USD',
    created_at: '2026-06-01T00:00:00Z',
    project_id: 'project-xyz',
    requested_by_id: 'u1',
    project: { name: 'Harbour Bridge', code: 'HB-01' },
    requested_by: { full_name: 'Alice Engineer' },
    vendor: null,
    vendor_id: null,
    ...over,
  }) as ProcurementWithRefs;

const wrap = (row: ProcurementWithRefs) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProcurementListRow row={row} />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('FR-L10N-020: ProcurementListRow expanded line items — record currency', () => {
  it('renders the row header total in the ROW currency (USD)', () => {
    wrap(makeRow());
    expect(screen.getByText('$25,000')).toBeInTheDocument();
  });

  it("renders the expanded line item rate/total in the DETAIL record's currency (EUR), not USD", async () => {
    wrap(makeRow());
    await userEvent.click(screen.getByRole('button', { name: /Show preview for/i }));
    const panel = screen.getByRole('region', { name: /Preview for/i });
    expect(within(panel).getByText(/€100/)).toBeInTheDocument();
    expect(within(panel).getByText(/€200/)).toBeInTheDocument();
    expect(within(panel).queryByText(/\$100|\$200/)).not.toBeInTheDocument();
  });
});
