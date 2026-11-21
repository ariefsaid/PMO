import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { DayCheckpoint } from '@/src/lib/repositories/siteCheckpoints';

/** AC-STC-012: the field controller's phone flow on the day's checkpoints. Behaviour only; no look is pinned. */
const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  userId: 'ctl',
  realRole: 'Finance',
  record: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/hooks/useSiteCheckpoints', () => ({
  useDayCheckpoints: () => ({ data: h.rows, isPending: false, isError: false, dataUpdatedAt: 1, refetch: vi.fn() }),
  useRecordCheckpoint: () => h.record,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));
vi.mock('@/src/lib/repositories/siteCheckpoints', () => ({ siteCheckpointRepository: { photoUrl: vi.fn() } }));

import { SiteCheckpoints } from './SiteCheckpoints';

const row = (over: Partial<DayCheckpoint>): DayCheckpoint => ({
  id: 'c1', crew_id: 'cr1', crew_name: 'Crew one', field_controller_id: 'ctl', position: 1, name: 'Work start', marks_work_start: true,
  due_at: '2099-01-01T00:00:00Z', grace_minutes: 10, photo_required: true, recorded_at: null, recorded_by: null, recorded_by_name: null,
  note: null, photo_path: null, state: 'pending', ...over,
});
const view = () => render(<SiteCheckpoints workOrderId="w1" workDate="2026-03-10" projectManagerId="pm" canRecordDay />);

describe('AC-STC-012 day checkpoints', () => {
  beforeEach(() => { h.record.mutateAsync.mockReset(); h.userId = 'ctl'; h.realRole = 'Finance'; });

  it('renders nothing while the organisation has no checkpoints', () => {
    h.rows = [];
    const { container } = view();
    expect(container).toBeEmptyDOMElement();
  });

  it('lets the crew controller record with a photo, then marks the next due one current', async () => {
    h.rows = [row({ id: 'c1', name: 'Gate arrival', position: 1 }), row({ id: 'c2', name: 'Work start', position: 2 })];
    const user = userEvent.setup();
    view();
    const first = screen.getByTestId('checkpoint-c1');
    expect(first).toHaveAttribute('aria-current', 'step');
    await user.click(within(first).getByRole('button', { name: 'Record' }));
    const confirm = within(first).getByRole('button', { name: 'Record now' });
    expect(confirm).toBeDisabled();
    await user.upload(within(first).getByTestId('checkpoint-photo-input'), new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
    await user.type(within(first).getByRole('textbox', { name: /note/i }), 'at the gate');
    await user.click(confirm);
    expect(h.record.mutateAsync).toHaveBeenCalledWith({ checkpointId: 'c1', file: expect.any(File), note: 'at the gate' });
  });

  it('shows a recorded checkpoint with its time and person, and the next one as current', () => {
    h.rows = [
      row({ id: 'c1', name: 'Gate arrival', recorded_at: '2099-01-01T00:05:00Z', recorded_by: 'ctl', recorded_by_name: 'Ada', state: 'on_time' }),
      row({ id: 'c2', name: 'Work start', position: 2 }),
    ];
    view();
    expect(within(screen.getByTestId('checkpoint-c1')).getByText('On time')).toBeInTheDocument();
    expect(within(screen.getByTestId('checkpoint-c1')).getByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByTestId('checkpoint-c2')).toHaveAttribute('aria-current', 'step');
  });

  it('says late in words, for an unrecorded and a late-recorded checkpoint', () => {
    h.rows = [
      row({ id: 'c1', name: 'Gate arrival', due_at: '2000-01-01T00:00:00Z' }),
      row({ id: 'c2', name: 'Work start', position: 2, due_at: '2000-01-01T00:00:00Z', recorded_at: '2000-01-01T02:00:00Z', recorded_by: 'ctl', state: 'late' }),
    ];
    view();
    expect(within(screen.getByTestId('checkpoint-c1')).getByText('Late')).toBeInTheDocument();
    expect(within(screen.getByTestId('checkpoint-c2')).getByText('Recorded late')).toBeInTheDocument();
  });

  it('offers no record action to a viewer who may not record (Executive, or another crew controller)', () => {
    h.rows = [row({ id: 'c1' })];
    h.realRole = 'Executive';
    const { unmount } = view();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
    unmount();
    h.realRole = 'Finance'; h.userId = 'someone-else';
    view();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
  });
});
