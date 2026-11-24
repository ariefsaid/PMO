/** H8: an approver sees which work order each timesheet line belongs to, not only its project. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const entry = (over: Record<string, unknown>) => ({
  project_id: 'proj-apollo', entry_date: '2026-06-02', hours: 4, project: { name: 'Apollo Station', code: 'PRJ-014' }, work_order_id: null, work_order: null, ...over,
});
const { queue } = vi.hoisted(() => ({
  queue: {
    data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn(),
  },
}));
queue.data = [{
  id: 's1', status: 'Submitted', week_start_date: '2026-06-02', owner: { full_name: 'Anita Rao' },
  entries: [
    entry({ work_order_id: 'w1', work_order: { wo_number: 'WO-0001', title: 'Slab pour' } }),
    entry({ work_order_id: 'w2', work_order: { wo_number: 'WO-0002', title: 'Fencing' }, entry_date: '2026-06-03' }),
    entry({ entry_date: '2026-06-04' }),
  ],
}];

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => queue,
  useTimesheetMutations: () => ({ approve: { mutate: vi.fn(), isPending: false }, reject: { mutate: vi.fn(), isPending: false } }),
}));

import { ApprovalsQueue } from '../ApprovalsQueue';

describe('H8 approval grid shows each line’s work order', () => {
  it('splits one project into a line per work order and names each', () => {
    render(<MemoryRouter><ImpersonationProvider realRole="Project Manager"><ToastProvider><ApprovalsQueue /></ToastProvider></ImpersonationProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Show hours for Anita Rao/i }));
    const panel = document.getElementById('ts-breakdown-s1')!;
    expect(within(panel).getByText(/WO-0001/)).toBeInTheDocument();
    expect(within(panel).getByText(/WO-0002/)).toBeInTheDocument();
    expect(within(panel).getAllByRole('link', { name: /Open Apollo Station/i })).toHaveLength(3);
  });
});
