/**
 * procurement_detail_opened (2026-07-13 wiring plan) — the row-click boundary in
 * ProcurementListRow (the table view). Mirrors ProcurementListRow.rowclick.test.tsx's
 * harness; adds the analytics facade mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
const analytics = vi.hoisted(() => ({ trackProcurementDetailOpened: vi.fn() }));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => ({ data: null, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/src/lib/analytics', () => ({
  trackProcurementDetailOpened: analytics.trackProcurementDetailOpened,
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

beforeEach(() => {
  navigateMock.mockReset();
  analytics.trackProcurementDetailOpened.mockClear();
});

describe('ProcurementListRow: procurement_detail_opened fires on whole-row click, source="list"', () => {
  it('AC: clicking the row body fires trackProcurementDetailOpened with a route PATTERN, never the raw id', async () => {
    wrap(makeRow());
    await userEvent.click(screen.getByText('PR-0001'));
    expect(analytics.trackProcurementDetailOpened).toHaveBeenCalledWith('/procurement/:procurementId', 'list');
    const call = analytics.trackProcurementDetailOpened.mock.calls[0];
    expect(JSON.stringify(call)).not.toMatch(/pr-1/);
  });

  it('does NOT fire when the disclosure chevron is clicked (no navigation)', async () => {
    wrap(makeRow());
    const chevron = screen.getByRole('button', { name: /show preview for/i });
    await userEvent.click(chevron);
    expect(analytics.trackProcurementDetailOpened).not.toHaveBeenCalled();
  });
});
