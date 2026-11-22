/** AC-LA-011 (#2710) — the light account's phone home screen: four sections, Foreman roster, clock-in through the existing path. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'foreman' as string,
  get: vi.fn(), deliveries: vi.fn(), setStatus: vi.fn(), record: vi.fn(), checkIn: vi.fn(), myAbsence: vi.fn(), reportAbsence: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', built_in_role: h.role } }) }));
vi.mock('@/src/lib/repositories/myHome', () => ({
  myHomeRepository: { get: h.get, deliveries: h.deliveries, setTaskStatus: h.setStatus, seatReport: vi.fn(), myAbsence: h.myAbsence, reportAbsence: h.reportAbsence },
}));
vi.mock('@/src/lib/repositories/crews', () => ({ attendanceRepository: { record: h.record } }));
vi.mock('@/src/lib/repositories/phoneCheckIn', () => ({ phoneCheckInRepository: { checkIn: h.checkIn } }));
vi.mock('./myHome/CrewRoster', () => ({ CrewRoster: () => <div data-testid="crew-roster" /> }));
import MyHome from './MyHome';

const home = {
  today: '2026-11-21',
  tasks: [{ id: 't1', name: 'Pour slab', status: 'To Do', end_date: null, project_id: 'p1', project_name: 'Site A' }],
  work_orders: [{ work_order_id: 'w1', title: 'Slab works', project_name: 'Site A', crew_id: 'c1', crew_name: 'Crew 1', my_worker_id: 'pw1', is_controller: true }],
  decider_role: null,
  issues: [{ id: 'i1', type: 'Near miss', severity: 'Low', status: 'Open', incident_date: '2026-11-20', description: null }],
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider><MyHome /></ToastProvider></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.role = 'foreman';
  h.get.mockResolvedValue(home);
  h.deliveries.mockResolvedValue([]);
  h.setStatus.mockResolvedValue(undefined);
  h.record.mockResolvedValue(1);
  h.checkIn.mockResolvedValue({ status: 'recorded', outcome: 'no_area' });
  h.myAbsence.mockResolvedValue(null);
  h.reportAbsence.mockResolvedValue(undefined);
});

describe('AC-LA-011 phone home screen', () => {
  it('JOB-NAV-WO: lists the work orders I am on today under the dictionary name, with project and crew', async () => {
    mount();
    const section = within(await screen.findByRole('region', { name: 'Work order' }));
    expect(section.getByText('Slab works')).toBeInTheDocument();
    expect(section.getByText('Site A · Crew 1')).toBeInTheDocument();
  });
  it('shows my tasks, clock in and issues, and hides deliveries while there are none', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument();
    expect(screen.getByText('Pour slab')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clock in' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Issues I reported' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'A delivery for you' })).not.toBeInTheDocument();
  });
  it('shows deliveries once the handover source supplies one', async () => {
    h.deliveries.mockResolvedValue([{ id: 'd1', number: 'TST-7', description: 'Cement, 10 bags', lineCount: 1 }]);
    mount();
    expect(await screen.findByRole('link', { name: /TST-7/ })).toHaveAttribute('href', '/stock/transfers/d1');
  });
  it('a Foreman sees the crew roster, a Field user does not', async () => {
    mount();
    expect(await screen.findByTestId('crew-roster')).toBeInTheDocument();
  });
  it('a Field user sees no crew roster', async () => {
    h.role = 'field_user';
    mount();
    await screen.findByText('Pour slab');
    expect(screen.queryByTestId('crew-roster')).not.toBeInTheDocument();
  });
  it('clock in is the phone check-in for the person, whether or not the work order has an area', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Clock in' }));
    expect(h.checkIn).toHaveBeenCalledWith({ workOrderId: 'w1', crewId: 'c1', hours: 8, position: undefined, noPosition: false });
  });
  it('tells a person with nothing rostered today to ask the supervisor', async () => {
    h.get.mockResolvedValue({ ...home, work_orders: [] });
    mount();
    expect(await screen.findByText('You are not rostered on a work order today. Ask your supervisor.')).toBeInTheDocument();
  });
  it('marks a task done through the status-only path', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mark done' }));
    expect(h.setStatus).toHaveBeenCalledWith('t1', 'Done');
  });
});

describe('AC-SD-007 a field worker says they are not coming in today', () => {
  it('takes two taps: open, then pick the reason; the note travels with it', async () => {
    h.role = 'field';
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('absent-open'));
    await user.type(screen.getByLabelText(/Note for your crew leader/), 'fever');
    await user.click(screen.getByTestId('absent-sick'));
    expect(h.reportAbsence).toHaveBeenCalledWith('sick', 'fever');
  });

  it('shows what was already told today and offers to change it', async () => {
    h.role = 'field';
    h.myAbsence.mockResolvedValue({ reason: 'other', note: null });
    mount();
    expect(await screen.findByTestId('absent-reported')).toHaveTextContent('Another reason');
    expect(screen.getByTestId('absent-open')).toHaveTextContent('Change what I told them');
  });

  it('is not offered to a person with no record on a crew', async () => {
    h.get.mockResolvedValue({ ...home, work_orders: [{ ...home.work_orders[0], my_worker_id: null }] });
    mount();
    await screen.findByText('Pour slab');
    expect(screen.queryByTestId('absent-open')).toBeNull();
  });
});
