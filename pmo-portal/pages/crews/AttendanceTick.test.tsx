import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  role: 'Engineer' as string,
  uid: 'fc1',
  roster: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  day: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  awaiting: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  record: vi.fn(), upload: vi.fn(), generate: vi.fn(), decide: vi.fn(),
}));
vi.mock('@/src/hooks/useCrews', () => ({
  useWorkOrderRoster: () => h.roster,
  useAttendanceDay: () => h.day,
  useAwaitingAttendance: () => h.awaiting,
  useCrewWorkers: () => ({ data: [{ id: 'v1', display_name: 'Vendor One' }] }),
  useCrewWorkOrders: () => ({ data: [{ id: 'wo1', wo_number: 'WO-1', title: 'Pipe rack' }], isLoading: false, isError: false, refetch: vi.fn() }),
  useAttendanceMutations: () => ({
    record: { mutateAsync: h.record }, uploadPhoto: { mutateAsync: h.upload },
    generateWeek: { mutateAsync: h.generate }, decideWeek: { mutateAsync: h.decide },
  }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.uid, org_id: 'org1' } }) }));

import { AttendanceTick } from './AttendanceTick';

const people = ['Ana', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar'];
const renderAt = (url = '/crews?view=attendance&wo=wo1&date=2026-11-18') =>
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><AttendanceTick /></ToastProvider></MemoryRouter>);

describe('attendance tick screen (#2528)', () => {
  beforeEach(() => {
    h.role = 'Engineer';
    h.uid = 'fc1';
    h.roster = {
      data: [{
        crew_id: 'c1', crew_code: 'CR-1', crew_name: 'Crew one', field_controller_id: 'fc1', roles: [], shortfall: 0,
        members: people.map((n, i) => ({ worker_id: `w${i + 1}`, display_name: n, kind: 'own', has_login: i < 3, standard_role_id: null, off_rotation: false })),
      }],
      isPending: false, isError: false, refetch: vi.fn(),
    };
    h.day = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.awaiting = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.record = vi.fn().mockResolvedValue(6);
    h.upload = vi.fn().mockResolvedValue(undefined);
    h.generate = vi.fn().mockResolvedValue({ mode: 'timesheet', timesheet_id: 't', changed: true });
    h.decide = vi.fn().mockResolvedValue(5);
  });

  it('AC-CRW-005 the field controller marks a 6-person crew present for 8 hours, overrides one to 6 and attaches the group photo', async () => {
    const user = userEvent.setup();
    renderAt();
    const dewi = screen.getByRole('row', { name: /Dewi/ });
    await user.type(within(dewi).getByRole('textbox', { name: /Hours for Dewi/ }), '6');
    const photo = new File(['x'], 'crew.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Group photo'), photo);
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    const { workOrderId, date, rows } = h.record.mock.calls[0][0];
    expect([workOrderId, date]).toEqual(['wo1', '2026-11-18']);
    expect(rows).toHaveLength(6);
    expect(rows.map((r: { hours: number }) => r.hours)).toEqual([8, 8, 8, 6, 8, 8]);
    expect(rows.every((r: { status: string }) => r.status === 'present')).toBe(true);
    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.upload.mock.calls[0][0]).toMatchObject({ workOrderId: 'wo1', crewId: 'c1', workDate: '2026-11-18', file: photo });
  });

  it('AC-CRW-005 the crew-wide hours apply to everyone without an override', async () => {
    const user = userEvent.setup();
    renderAt();
    const crewHours = screen.getByRole('textbox', { name: 'Hours for the crew' });
    await user.clear(crewHours);
    await user.type(crewHours, '10');
    await user.selectOptions(within(screen.getByRole('row', { name: /Eko/ })).getByRole('combobox', { name: /Status for Eko/ }), 'absent');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalled());
    expect(h.record.mock.calls[0][0].rows.map((r: { hours: number | null }) => r.hours)).toEqual([10, 10, 10, 10, null, 10]);
  });

  it('#2620 FR-CRW-008 overtime typed for a present person travels with the record; blank means none', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.type(within(screen.getByRole('row', { name: /Ana/ })).getByRole('textbox', { name: /Overtime for Ana/ }), '2');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    const rows = h.record.mock.calls[0][0].rows as Array<{ worker_id: string; hours: number; overtime_hours: number | null }>;
    expect(rows[0]).toMatchObject({ worker_id: 'w1', hours: 8, overtime_hours: 2 });
    expect(rows.slice(1).every((r) => r.overtime_hours === null)).toBe(true);
  });

  it('#2620 overtime already held on a record shows and is kept on save; it is not offered for an absent person', async () => {
    const user = userEvent.setup();
    h.day = { data: [
      { id: 'd1', worker_id: 'w2', status: 'present', hours: 8, overtime_hours: 1.5, reason: null },
      { id: 'd2', worker_id: 'w3', status: 'absent', hours: null, overtime_hours: null, reason: null },
    ], isPending: false, isError: false, refetch: vi.fn() };
    renderAt();
    expect(screen.getByRole('textbox', { name: /Overtime for Budi/ })).toHaveValue('1.5');
    expect(screen.queryByRole('textbox', { name: /Overtime for Citra/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    const rows = h.record.mock.calls[0][0].rows as Array<{ worker_id: string; overtime_hours: number | null }>;
    expect(rows.find((r) => r.worker_id === 'w2')?.overtime_hours).toBe(1.5);
  });

  it('AC-CRW-006 an off-rotation person defaults to off rotation', () => {
    (h.roster.data as Array<{ members: Array<{ off_rotation: boolean }> }>)[0].members[0].off_rotation = true;
    renderAt();
    expect(within(screen.getByRole('row', { name: /Ana/ })).getByRole('combobox', { name: /Status for Ana/ })).toHaveValue('off_rotation');
  });

  it('AC-CRW-011 a refused save says why and keeps the screen', async () => {
    h.record = vi.fn().mockRejectedValue(new AppError('ATT_LOCKED: approved attendance cannot be changed', '55000'));
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('This day is approved. Re-open the timesheet to correct it.')).toBeInTheDocument();
  });

  it('requires the displayed attendance to be saved before sending the week', () => {
    renderAt();
    expect(screen.getByRole('button', { name: 'Send the week for approval' })).toBeDisabled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('prevents edits while a save is in flight', async () => {
    const user = userEvent.setup();
    let finish!: (value: number) => void;
    h.record = vi.fn().mockReturnValue(new Promise<number>((resolve) => { finish = resolve; }));
    renderAt();
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(screen.getByRole('textbox', { name: 'Hours for the crew' })).toBeDisabled();
    finish(6);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Hours for the crew' })).toBeEnabled());
  });

  it('does not submit stale hours while attendance edits are unsaved', async () => {
    const user = userEvent.setup();
    h.day.data = people.map((_, i) => ({ id: `a${i}`, worker_id: `w${i + 1}`, status: 'present', hours: 8, overtime_hours: null, reason: null }));
    renderAt();
    const hours = screen.getByRole('textbox', { name: 'Hours for the crew' });
    await user.clear(hours);
    await user.type(hours, '10');
    expect(screen.getByRole('button', { name: 'Send the week for approval' })).toBeDisabled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('AC-CRW-009 sending the week generates each person\'s week once', async () => {
    const user = userEvent.setup();
    h.day.data = people.map((_, i) => ({ id: `a${i}`, worker_id: `w${i + 1}`, status: 'present', hours: 8, overtime_hours: null, reason: null }));
    renderAt();
    await user.click(screen.getByRole('button', { name: 'Send the week for approval' }));
    await waitFor(() => expect(h.generate).toHaveBeenCalledTimes(6));
    expect(h.generate.mock.calls.map((c) => c[0])).toContainEqual({ workerId: 'w4', weekStart: '2026-11-16' });
  });

  it('AC-CRW-014 a user who is not the crew\'s field controller cannot save', () => {
    h.uid = 'someone-else';
    renderAt();
    expect(screen.queryByRole('button', { name: 'Save attendance' })).toBeNull();
  });

  it('AC-CRW-012 a supervisor approves a no-login week waiting for approval', async () => {
    h.role = 'Project Manager';
    h.uid = 'pm1';
    h.awaiting = { data: [{ worker_id: 'v1', work_date: '2026-11-17', hours: 8, overtime_hours: null, work_order_title: 'Bridge repair' },
      { worker_id: 'v1', work_date: '2026-11-18', hours: 8, overtime_hours: 1, work_order_title: 'Bridge repair' }], isPending: false, isError: false, refetch: vi.fn() };
    const user = userEvent.setup();
    renderAt();
    const row = screen.getByRole('row', { name: /Vendor One/ });
    expect(within(row).getByText('17 hours')).toBeInTheDocument();
    expect(within(row).getByText('Bridge repair')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.decide).toHaveBeenCalledWith({ workerId: 'v1', weekStart: '2026-11-16', decision: 'approve', reason: null }));
  });
});
