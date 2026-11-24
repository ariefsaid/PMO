import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { ReportDayHours } from '@/src/lib/db/attendanceSecondRecords';

/** AC-PAY-009 the site report lists each worker's hours and lets the right person add a second record or decide. */
const h = vi.hoisted(() => ({
  data: null as unknown,
  pending: false,
  enter: vi.fn(),
  decide: vi.fn(),
}));
vi.mock('@/src/hooks/useAttendanceSecondRecords', () => ({
  useReportDayHours: () => ({ data: h.data, isPending: h.pending, isError: false, refetch: vi.fn() }),
  useSecondRecordMutations: () => ({ enter: { mutate: h.enter, isPending: false }, decide: { mutate: h.decide, isPending: false } }),
}));

import SiteReportPeopleHours from './SiteReportPeopleHours';

const worker = (over: Record<string, unknown> = {}) => ({
  workerId: 'w1', name: 'Budi', undecided: false, mine: false, own: false,
  day: { status: 'present', hours: 8, overtimeHours: null, source: 'roster_tick' }, second: null, ...over,
});
const view = (data: Partial<ReportDayHours>) => {
  h.data = { detail: true, mayEnter: false, mayDecide: false, workers: [], ...data };
  return render(<ToastProvider><SiteReportPeopleHours reportId="r1" workOrderId="wo1" workDate="2026-11-03" /></ToastProvider>);
};
beforeEach(() => { h.pending = false; h.enter.mockReset(); h.decide.mockReset(); });

describe('SiteReportPeopleHours', () => {
  it('shows nothing to a role that gets no detail (it keeps the total)', () => {
    view({ detail: false });
    expect(screen.queryByTestId('dsr-people-hours')).toBeNull();
  });
  it('lists each worker with the standing hours and where they came from', () => {
    view({ workers: [worker(), worker({ workerId: 'w2', name: 'Sari', day: null })] });
    expect(screen.getByTestId('dsr-people-row-w1')).toHaveTextContent('Budi');
    expect(screen.getByTestId('dsr-people-row-w1')).toHaveTextContent('Stands: 8 h');
    expect(screen.getByTestId('dsr-people-row-w1')).toHaveTextContent('Site report');
    expect(screen.getByTestId('dsr-people-row-w2')).toHaveTextContent('No hours recorded');
  });
  it('says who adds the rows when nobody is rostered', () => {
    view({ workers: [] });
    expect(screen.getByText(/No one is rostered on this work order/)).toBeInTheDocument();
  });
  it('flags a disagreement and shows the second record beside the standing figure', () => {
    view({ mayDecide: true, workers: [worker({ undecided: true, second: { status: 'present', hours: 5, overtimeHours: null, note: 'survey', standing: null, decidedAt: null, decisionReason: null } })] });
    const row = screen.getByTestId('dsr-people-row-w1');
    expect(within(row).getByRole('status')).toHaveTextContent('The two records differ');
    expect(row).toHaveTextContent('Second record: 5 h');
    expect(within(row).getByRole('button', { name: 'Decide' })).toBeEnabled();
  });
  it('disables Decide and says why for a role that does not decide', () => {
    view({ mayDecide: false, workers: [worker({ undecided: true, second: { status: 'present', hours: 5, overtimeHours: null, note: null, standing: null, decidedAt: null, decisionReason: null } })] });
    const row = screen.getByTestId('dsr-people-row-w1');
    expect(within(row).getByRole('button', { name: 'Decide' })).toBeDisabled();
    expect(row).toHaveTextContent('Your role does not decide which hours stand.');
  });
  it('disables Decide for the person who recorded one of the figures, and says so', () => {
    view({ mayDecide: true, workers: [worker({ undecided: true, mine: true, second: { status: 'present', hours: 5, overtimeHours: null, note: null, standing: null, decidedAt: null, decisionReason: null } })] });
    const row = screen.getByTestId('dsr-people-row-w1');
    expect(within(row).getByRole('button', { name: 'Decide' })).toBeDisabled();
    expect(row).toHaveTextContent('You recorded one of these figures. Someone else decides.');
  });
  it('1932 on the viewer\'s own working day: no second record to add, and Decide says someone else decides', () => {
    view({ mayEnter: true, mayDecide: true, workers: [worker({ undecided: true, own: true, second: { status: 'present', hours: 5, overtimeHours: null, note: null, standing: null, decidedAt: null, decisionReason: null } })] });
    const row = screen.getByTestId('dsr-people-row-w1');
    expect(within(row).getByRole('button', { name: 'Decide' })).toBeDisabled();
    expect(row).toHaveTextContent('This is your own working day. Someone else decides.');
    expect(within(row).queryByRole('button', { name: 'Add second record' })).toBeNull();
  });
  it('sends the chosen side with its reason', async () => {
    const user = userEvent.setup();
    view({ mayDecide: true, workers: [worker({ undecided: true, second: { status: 'present', hours: 5, overtimeHours: null, note: null, standing: null, decidedAt: null, decisionReason: null } })] });
    await user.click(screen.getByRole('button', { name: 'Decide' }));
    await user.selectOptions(screen.getByRole('combobox', { name: /Which figure stands/ }), 'second');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(h.decide).not.toHaveBeenCalled();
    expect(screen.getByText('Say why this figure stands.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Why this figure stands/), 'Survey sheet is signed');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(h.decide).toHaveBeenCalledWith({ workerId: 'w1', workOrderId: 'wo1', workDate: '2026-11-03', stand: 'second', reason: 'Survey sheet is signed' }, expect.anything());
  });
  it('F8-3 no figure is pre-chosen: a reason alone does not decide, the manager must choose which figure stands', async () => {
    const user = userEvent.setup();
    view({ mayDecide: true, workers: [worker({ undecided: true, second: { status: 'present', hours: 5, overtimeHours: null, note: null, standing: null, decidedAt: null, decisionReason: null } })] });
    await user.click(screen.getByRole('button', { name: 'Decide' }));
    expect(screen.getByRole('combobox', { name: /Which figure stands/ })).toHaveValue('');
    await user.type(screen.getByLabelText(/Why this figure stands/), 'Because');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(h.decide).not.toHaveBeenCalled();
    expect(screen.getByText('Choose which figure stands.')).toBeInTheDocument();
  });
  it('a surveyor adds a second record with hours', async () => {
    const user = userEvent.setup();
    view({ mayEnter: true, workers: [worker()] });
    await user.click(screen.getByRole('button', { name: 'Add second record' }));
    await user.click(screen.getByRole('button', { name: 'Save second record' }));
    expect(h.enter).not.toHaveBeenCalled();
    expect(screen.getByText('Enter hours from 0 to 24.')).toBeInTheDocument();
    await user.type(within(screen.getByRole('dialog')).getAllByRole('textbox')[0], '5');
    await user.click(screen.getByRole('button', { name: 'Save second record' }));
    expect(h.enter).toHaveBeenCalledWith({ workOrderId: 'wo1', workDate: '2026-11-03', rows: [{ worker_id: 'w1', status: 'present', hours: 5, overtime_hours: null, note: null }] }, expect.anything());
  });
  it('offers no second record on a decided day, and shows who stood', () => {
    view({ mayEnter: true, workers: [worker({ second: { status: 'present', hours: 5, overtimeHours: null, note: null, standing: 'second', decidedAt: '2026-11-04', decisionReason: 'signed' } })] });
    const row = screen.getByTestId('dsr-people-row-w1');
    expect(within(row).queryByRole('button', { name: 'Add second record' })).toBeNull();
    expect(row).toHaveTextContent('Second record stands (signed)');
  });
  it('F8-2 a decided day says who decided it and when', () => {
    view({ mayEnter: true, workers: [worker({ second: { status: 'present', hours: 5, overtimeHours: null, note: null, standing: 'second', decidedAt: '2026-11-04T08:30:00Z', decidedByName: 'Mira Manager', decisionReason: 'signed' } })] });
    const row = screen.getByTestId('dsr-people-row-w1');
    expect(row).toHaveTextContent('Second record stands (signed) · Mira Manager · 4 Nov 2026');
  });
});
