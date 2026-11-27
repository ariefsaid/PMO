import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import { resetActiveLocale, setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';

const h = vi.hoisted(() => ({
  role: 'Engineer' as string,
  uid: 'fc1',
  reports: [] as string[],
  roster: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  day: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  awaiting: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  workerReads: [] as Array<{ ids: string[]; enabled: boolean }>, placementReads: [] as Array<{ date: string; enabled: boolean }>,
  record: vi.fn(), upload: vi.fn(), generate: vi.fn(), decide: vi.fn(), clear: vi.fn(),
}));
vi.mock('@/src/hooks/useCrews', () => ({
  useWorkOrderRoster: () => h.roster,
  useAttendanceDay: () => h.day,
  useAwaitingAttendance: () => h.awaiting,
  useManagedPeople: () => ({ data: h.reports }),
  useCrewWorkersByIds: (ids: string[], enabled = true) => {
    h.workerReads.push({ ids: [...ids], enabled });
    return { data: [
      { id: 'v1', display_name: 'Vendor One' }, { id: 'v2', display_name: 'Ended Placement' }, { id: 'v3', display_name: 'No Placement' }, { id: 'w2', display_name: 'Budi' },
    ].filter((w) => ids.includes(w.id)), isPending: false };
  },
  useCrewPlacementsOn: (date: string, enabled = true) => {
    h.placementReads.push({ date, enabled });
    return { data: [
      { id: 'm1', crew_id: 'c9', worker_id: 'v1', valid_from: '2026-01-01', valid_to: null },
      { id: 'm2', crew_id: 'c9', worker_id: 'v2', valid_from: '2026-01-01', valid_to: '2026-11-01' },
      { id: 'm3', crew_id: 'c1', worker_id: 'w2', valid_from: '2026-01-01', valid_to: null },
    ].filter((m) => m.valid_from <= date && (m.valid_to === null || m.valid_to >= date)), isPending: false };
  },
  useCrewWorkOrders: () => ({ data: [{ id: 'wo1', wo_number: 'WO-1', title: 'Pipe rack' }], isLoading: false, isError: false, refetch: vi.fn() }),
  useAttendanceMutations: () => ({
    record: { mutateAsync: h.record }, uploadPhoto: { mutateAsync: h.upload },
    generateWeek: { mutateAsync: h.generate }, decideWeek: { mutateAsync: h.decide }, clearFollow: { mutateAsync: h.clear },
  }),
}));
vi.mock('@/src/hooks/useHeadcount', () => ({
  useHeadcountEvidence: () => ({ data: [] }),
  useHeadcountEvidenceMutations: () => ({ attachFile: { mutateAsync: vi.fn(), isPending: false }, detach: { mutateAsync: vi.fn(), isPending: false } }),
  useHeadcountDay: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useHeadcountMutations: () => ({ record: { mutateAsync: vi.fn() }, approve: { mutateAsync: vi.fn() }, clear: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useLabourCost', () => ({ useLabourClasses: () => ({ data: [] }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.uid, org_id: 'org1' } }) }));

import { AttendanceTick } from './AttendanceTick';

const people = ['Ana', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar'];
const renderAt = (url = '/crews?view=attendance&wo=wo1&date=2026-11-18') =>
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><AttendanceTick /></ToastProvider></MemoryRouter>);

/** Nobody starts present (OD-R1125-1): the recorder marks each person, as on the screen. */
const markPresent = async (user: ReturnType<typeof userEvent.setup>, names: string[] = people) => {
  for (const n of names) await user.selectOptions(screen.getByRole('combobox', { name: new RegExp(`Status for ${n}`) }), 'present');
};

describe('attendance tick screen (#2528)', () => {
  beforeEach(() => {
    h.role = 'Engineer';
    h.uid = 'fc1';
    h.workerReads = []; h.placementReads = [];
    h.reports = [];
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
    h.clear = vi.fn().mockResolvedValue(1);
  });

  it('#1126 the day defaults to the organisation\'s day, not the browser\'s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    setActiveOrgTimezone('Asia/Jakarta');
    try {
      renderAt('/crews?view=attendance&wo=wo1');
      expect(screen.getByLabelText('Date')).toHaveValue('26 Nov 2026');
    } finally {
      resetActiveLocale();
      vi.useRealTimers();
    }
  });

  it('AC-CRW-005 the field controller marks a 6-person crew present for 8 hours, overrides one to 6 and attaches the group photo', async () => {
    const user = userEvent.setup();
    renderAt();
    await markPresent(user);
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
    await markPresent(user, people.filter((n) => n !== 'Eko'));
    const crewHours = screen.getByRole('textbox', { name: 'Hours for the crew' });
    await user.clear(crewHours);
    await user.type(crewHours, '10');
    await user.selectOptions(within(screen.getByRole('row', { name: /Eko/ })).getByRole('combobox', { name: /Status for Eko/ }), 'absent');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalled());
    expect(h.record.mock.calls[0][0].rows.map((r: { hours: number | null }) => r.hours)).toEqual([10, 10, 10, 10, null, 10]);
  });

  it('AC-SD-007 a person who reported absent shows as such on the roster and starts the day as absent', async () => {
    const user = userEvent.setup();
    ((h.roster.data as Array<{ members: Array<Record<string, unknown>> }>)[0].members[1]).reported_absent = { reason: 'sick', note: 'fever' };
    renderAt();
    await markPresent(user, ['Ana']);
    expect(screen.getByTestId('reported-absent-w2')).toHaveTextContent('Reported absent: sick — fever');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalled());
    const rows = h.record.mock.calls[0][0].rows as Array<{ worker_id: string; status: string }>;
    expect(rows.find((r) => r.worker_id === 'w2')?.status).toBe('absent');
    expect(rows.find((r) => r.worker_id === 'w1')?.status).toBe('present');
  });

  it('AC-SD-008 a reader who cannot tick is told who does', () => {
    h.role = 'Engineer';
    h.uid = 'someone-else';
    renderAt();
    expect(screen.getByText("Only this crew's Foreman or a crew manager ticks this roster.")).toBeInTheDocument();
  });

  it('F4-1 a reader who cannot tick sees only the two who clocked in as present; the other four read "Not yet present", not Present', () => {
    h.uid = 'someone-else';
    h.day = { data: [
      { id: 'd1', worker_id: 'w1', work_order_id: 'wo1', crew_id: 'c1', work_date: '2026-11-18', status: 'present', hours: 8, overtime_hours: null, reason: null, source: 'phone' },
      { id: 'd2', worker_id: 'w2', work_order_id: 'wo1', crew_id: 'c1', work_date: '2026-11-18', status: 'present', hours: 8, overtime_hours: null, reason: null, source: 'phone' },
    ], isPending: false, isError: false, refetch: vi.fn() };
    renderAt();
    expect(screen.getAllByText('Not yet present', { selector: 'span' })).toHaveLength(4);
    expect(within(screen.getByRole('row', { name: /Ana/ })).queryByText('Not yet present', { selector: 'span' })).toBeNull();
    expect(within(screen.getByRole('row', { name: /Citra/ })).getByText('Not yet present', { selector: 'span' })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Citra/ })).queryByRole('combobox')).toBeNull();
  });

  it('OD-R1125-1 the field controller sees an unrecorded person as "Not yet present" and saving sends only who was marked', async () => {
    const user = userEvent.setup();
    renderAt();
    expect(within(screen.getByRole('row', { name: /Citra/ })).getByRole('combobox')).toHaveValue('unmarked');
    expect(within(screen.getByRole('row', { name: /Citra/ })).getByRole('option', { name: 'Not yet present' })).toBeInTheDocument();
    await markPresent(user, ['Ana', 'Budi']);
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    expect(h.record.mock.calls[0][0].rows.map((r: { worker_id: string; status: string }) => [r.worker_id, r.status])).toEqual([['w1', 'present'], ['w2', 'present']]);
  });

  it('OD-R1125-1 the manager recorded on one member (not the crew\'s recorder) marks that row only; the other rows stay read-only', async () => {
    const user = userEvent.setup();
    h.uid = 'mgr1';
    h.reports = ['w3'];
    renderAt();
    expect(within(screen.getByRole('row', { name: /Citra/ })).getByRole('combobox')).toBeEnabled();
    for (const n of ['Ana', 'Budi', 'Dewi']) {
      const row = screen.getByRole('row', { name: new RegExp(n) });
      expect(within(row).queryByRole('combobox')).toBeNull();
      expect(within(row).getByText('Not yet present', { selector: 'span' })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Send the week for approval' })).toBeNull();
    await user.selectOptions(within(screen.getByRole('row', { name: /Citra/ })).getByRole('combobox'), 'absent');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    expect(h.record.mock.calls[0][0].rows).toEqual([{ worker_id: 'w3', status: 'absent', hours: null, overtime_hours: null, reason: null }]);
  });

  it('OD-R1125-1 someone who manages nobody on the crew and does not record it gets no control and no save', () => {
    h.uid = 'stranger';
    renderAt();
    expect(screen.queryByRole('combobox', { name: /Status for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save attendance' })).toBeNull();
  });

  it('AC-SD-002 one refused person is named and everyone else is saved', async () => {
    const user = userEvent.setup();
    h.record = vi.fn().mockImplementation(async (v: { rows: Array<{ worker_id: string }> }) => {
      if (v.rows.length > 1 || v.rows[0].worker_id === 'w2') throw Object.assign(new Error('ATT_NOT_ROSTERED: x'), { code: '23514' });
      return 1;
    });
    renderAt();
    await markPresent(user);
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText(/Saved for everyone except: Budi/)).toBeInTheDocument();
    expect(h.record).toHaveBeenCalledTimes(7); // the whole batch, then one per person
  });

  it('#2620 FR-CRW-008 overtime typed for a present person travels with the record; blank means none', async () => {
    const user = userEvent.setup();
    renderAt();
    await markPresent(user);
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

  it('AC-WCI-050 a site supervisor who is not the crew\'s Foreman and not a crew manager sees greyed fields and one sentence saying who ticks', () => {
    h.uid = 'site-supervisor';
    renderAt();
    expect(screen.getByText("Only this crew's Foreman or a crew manager ticks this roster.")).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Hours for the crew' })).toBeDisabled();
  });

  it('AC-HC-011 the crew\'s day carries a head-count section under the roster, counting the named people ticked present', () => {
    (h.day.data as unknown[]) = [{ id: 'd1', worker_id: 'w1', status: 'present', hours: 8, overtime_hours: null }, { id: 'd2', worker_id: 'w2', status: 'absent', hours: null, overtime_hours: null }];
    renderAt();
    expect(screen.getByRole('heading', { name: 'Head count' })).toBeInTheDocument();
    expect(screen.getByTestId('headcount-named')).toHaveTextContent('1 named present above');
  });

  it('AC-WCI-050 the crew\'s Foreman gets no such sentence and can tick', () => {
    renderAt();
    expect(screen.queryByText("Only this crew's Foreman or a crew manager ticks this roster.")).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Hours for the crew' })).toBeEnabled();
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
    expect(within(row).getByText('17')).toBeInTheDocument();
    expect(within(row).getByText('Bridge repair')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.decide).toHaveBeenCalledWith({ workerId: 'v1', weekStart: '2026-11-16', decision: 'approve', reason: null }));
  });

  it('AC-FOL-008 the foreman adds someone from another crew, who is saved as following this crew', async () => {
    const user = userEvent.setup();
    renderAt();
    await markPresent(user);
    await user.click(screen.getByRole('combobox', { name: /Add someone from another crew/ }));
    const listed = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(listed.some((n) => n.includes('Vendor One'))).toBe(true);
    // Searchable lists hold only people placed that day who are not already on this crew: no ended placement, no unplaced, no member.
    expect(listed.some((n) => /Ended Placement|No Placement|Budi/.test(n))).toBe(false);
    await user.click(await screen.findByRole('option', { name: /Vendor One/ }));
    const row = screen.getByRole('row', { name: /Vendor One/ });
    expect(within(row).getByText('Followed this crew today')).toBeInTheDocument();
    await user.selectOptions(within(row).getByRole('combobox'), 'present');
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    const { rows } = h.record.mock.calls[0][0];
    expect(rows).toHaveLength(7);
    expect(rows[6]).toMatchObject({ worker_id: 'v1', status: 'present', hours: 8, followed_crew_id: 'c1' });
    expect(rows.slice(0, 6).some((r: Record<string, unknown>) => 'followed_crew_id' in r)).toBe(false);
  });

  it('#1128 the screen reads the placements of the chosen day and the names of those people only', async () => {
    renderAt();
    await screen.findByRole('combobox', { name: /Add someone from another crew/ });
    expect(h.placementReads.every((r) => r.date === '2026-11-18' && r.enabled)).toBe(true);
    // The ended placement and the unplaced person are never asked for.
    const asked = new Set(h.workerReads.filter((r) => r.enabled).flatMap((r) => r.ids));
    expect([...asked].sort()).toEqual(['v1', 'w2']);
  });

  it('AC-FOL-008 a recorded follow shows where the person came from and is not sent as a new follow', async () => {
    const user = userEvent.setup();
    h.roster = { ...h.roster, data: [{
      crew_id: 'c1', crew_code: 'CR-1', crew_name: 'Crew one', field_controller_id: 'fc1', roles: [], shortfall: 0,
      members: [{ worker_id: 'w1', display_name: 'Ana', standard_role_id: null, off_rotation: false, followed: true, from_crew_name: 'Home crew' }],
    }] };
    renderAt();
    await markPresent(user, ['Ana']);
    expect(within(screen.getByRole('row', { name: /Ana/ })).getByText('Followed from Home crew')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    expect('followed_crew_id' in h.record.mock.calls[0][0].rows[0]).toBe(false);
  });

  it('AC-FOL-008 someone who may not tick this crew is not offered the add control', () => {
    h.uid = 'someone-else';
    renderAt();
    expect(screen.queryByRole('combobox', { name: /Add someone from another crew/ })).toBeNull();
  });

  it('AC-FOL-008 someone already recorded today on this work order is not offered again', async () => {
    const user = userEvent.setup();
    h.day = { ...h.day, data: [{ id: 'd1', worker_id: 'v1', status: 'present', hours: 8, overtime_hours: null, reason: null }] };
    renderAt();
    await user.click(screen.getByRole('combobox', { name: /Add someone from another crew/ }));
    await screen.findByRole('listbox');
    expect(screen.queryByRole('option', { name: /Vendor One/ })).toBeNull();
  });

  const followedRoster = () => ({
    data: [{
      crew_id: 'c1', crew_code: 'CR-1', crew_name: 'Crew one', field_controller_id: 'fc1', roles: [], shortfall: 0,
      members: [{ worker_id: 'w1', display_name: 'Ana', standard_role_id: null, off_rotation: false, followed: true, from_crew_name: 'Home crew' }],
    }],
    isPending: false, isError: false, refetch: vi.fn(),
  });

  it('AC-FOL-014 a crew manager undoes a recorded follow after confirming, and a foreman who is not a manager has no such control', async () => {
    const user = userEvent.setup();
    h.role = 'Project Manager'; h.uid = 'pm1';
    h.roster = followedRoster();
    renderAt();
    await user.click(within(screen.getByRole('row', { name: /Ana/ })).getByRole('button', { name: /Undo follow/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Undo follow' }));
    await waitFor(() => expect(h.clear).toHaveBeenCalledWith({ workerId: 'w1', date: '2026-11-18' }));
  });

  it('AC-FOL-014 a foreman who is not a crew manager is not offered Undo follow', () => {
    h.roster = followedRoster();
    renderAt();
    expect(screen.queryByRole('button', { name: /Undo follow/ })).toBeNull();
  });

  it('AC-PAY-006 Approve is disabled on a week the viewer recorded, and says why', () => {
    h.role = 'Project Manager';
    h.uid = 'pm1';
    h.awaiting = { data: [{ worker_id: 'v1', work_date: '2026-11-17', hours: 8, overtime_hours: null, work_order_title: 'Bridge repair', recorded_by_ids: ['ctl', 'pm1'] }], isPending: false, isError: false, refetch: vi.fn() };
    renderAt();
    const row = screen.getByRole('row', { name: /Vendor One/ });
    const approve = within(row).getByRole('button', { name: 'Approve' });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleDescription('You recorded these hours, so someone else approves them.');
    const ret = within(row).getByRole('button', { name: 'Return' });
    expect(ret).toBeDisabled();
    expect(ret).toHaveAccessibleDescription('You recorded these hours, so someone else approves them.');
  });

  it('AC-PAY-006 Approve stays enabled for a manager who recorded none of the days', () => {
    h.role = 'Project Manager';
    h.uid = 'pm2';
    h.awaiting = { data: [{ worker_id: 'v1', work_date: '2026-11-17', hours: 8, overtime_hours: null, work_order_title: 'Bridge repair', recorded_by_ids: ['ctl', 'pm1'] }], isPending: false, isError: false, refetch: vi.fn() };
    renderAt();
    const row = screen.getByRole('row', { name: /Vendor One/ });
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(within(row).getByRole('button', { name: 'Return' })).toBeEnabled();
  });

  it('#2976 a failed awaiting-approval read shows Retry instead of vanishing', async () => {
    const refetch = vi.fn();
    h.role = 'Project Manager';
    h.uid = 'pm2';
    h.awaiting = { data: undefined as unknown as unknown[], isPending: false, isError: true, refetch };
    renderAt();
    const region = screen.getByRole('region', { name: 'Weeks waiting for your approval' });
    expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't load weeks waiting for your approval");
    await userEvent.setup().click(within(region).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('#2976 a failed awaiting-approval refresh keeps loaded weeks visible alongside Retry', async () => {
    const refetch = vi.fn();
    h.role = 'Project Manager';
    h.uid = 'pm2';
    h.awaiting = {
      data: [{ worker_id: 'v1', work_date: '2026-11-17', hours: 8, overtime_hours: null, work_order_title: 'Bridge repair', recorded_by_ids: ['ctl', 'pm1'] }],
      isPending: false,
      isError: true,
      refetch,
    };
    renderAt();
    const region = screen.getByRole('region', { name: 'Weeks waiting for your approval' });
    expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't load weeks waiting for your approval");
    expect(within(region).getByRole('row', { name: /Vendor One/ })).toBeInTheDocument();
    await userEvent.setup().click(within(region).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
