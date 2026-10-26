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
    project_id: 'project-1',
    project: { name: 'Pembangunan Gedung Layanan Terpadu Tahap IV Baru' },
    total_value: 25000,
    status: 'Requested',
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
import { ImpersonationProvider } from '@/src/auth/impersonation';
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
    // The expanded row's DecisionSupportPanel reads the viewer's real role.
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
        <ToastProvider>
          <ProcurementListRow row={row} />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('FR-L10N-020: ProcurementListRow uses the surrounding currency group', () => {
  it('renders the exact row total without repeating the group currency', () => {
    wrap(makeRow());
    expect(screen.getByText('25,000')).toBeInTheDocument();
    expect(screen.queryByText('$25,000')).not.toBeInTheDocument();
  });

  it("renders one currency group with exact line values and no duplicate request amount", async () => {
    wrap(makeRow({ project: { name: 'Pembangunan Gedung Layanan Terpadu Tahap IV Baru', code: 'N48' } }));
    await userEvent.click(screen.getByRole('button', { name: /Show preview for/i }));
    const panel = screen.getByRole('region', { name: /Preview for/i });
    expect(within(panel).getByRole('heading', { name: 'Requested items · EUR' })).toBeInTheDocument();
    const item = within(panel).getByRole('listitem');
    expect(within(item).getByText((_, element) =>
      element?.tagName === 'SPAN' && element.textContent?.replace(/\s+/g, ' ').trim() === '2 × 100 = 200',
    )).toBeInTheDocument();
    expect(within(item).queryByText(/€|\$/)).not.toBeInTheDocument();
    expect(within(panel).queryByText('This request')).not.toBeInTheDocument();
    expect(within(panel).getByText('Pembangunan Gedung Layanan Terpadu Tahap IV Baru')).toBeInTheDocument();
  });
});
