/** AC-LA-011 (#2710) — the light account's phone home screen: four sections, Foreman roster, clock-in through the existing path. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'foreman' as string,
  get: vi.fn(), deliveries: vi.fn(), setStatus: vi.fn(), record: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', built_in_role: h.role } }) }));
vi.mock('@/src/lib/repositories/myHome', () => ({
  myHomeRepository: { get: h.get, deliveries: h.deliveries, setTaskStatus: h.setStatus, seatReport: vi.fn() },
}));
vi.mock('@/src/lib/repositories/crews', () => ({ attendanceRepository: { record: h.record } }));
vi.mock('./myHome/CrewRoster', () => ({ CrewRoster: () => <div data-testid="crew-roster" /> }));
import MyHome from './MyHome';

const home = {
  today: '2026-11-21',
  tasks: [{ id: 't1', name: 'Pour slab', status: 'To Do', end_date: null, project_id: 'p1', project_name: 'Site A' }],
  work_orders: [{ work_order_id: 'w1', title: 'Slab works', project_name: 'Site A', crew_id: 'c1', crew_name: 'Crew 1', my_worker_id: 'pw1', is_controller: true }],
  issues: [{ id: 'i1', type: 'Near miss', severity: 'Low', status: 'Open', incident_date: '2026-11-20', description: null }],
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><MyHome /></ToastProvider></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.role = 'foreman';
  h.get.mockResolvedValue(home);
  h.deliveries.mockResolvedValue([]);
  h.setStatus.mockResolvedValue(undefined);
  h.record.mockResolvedValue(1);
});

describe('AC-LA-011 phone home screen', () => {
  it('JOB-NAV-WO: lists the work orders I am on today under the dictionary name, with project and crew', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Work order' })).toBeInTheDocument();
    expect(screen.getByText('Slab works')).toBeInTheDocument();
    expect(screen.getByText('Site A · Crew 1')).toBeInTheDocument();
  });

  it('shows my tasks, clock in and issues, and hides deliveries while there are none', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument();
    expect(screen.getByText('Pour slab')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clock in' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Issues I reported' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Deliveries to confirm' })).not.toBeInTheDocument();
  });
  it('shows deliveries once the handover source supplies one', async () => {
    h.deliveries.mockResolvedValue([{ id: 'd1', description: 'Cement, 10 bags' }]);
    mount();
    expect(await screen.findByText('Cement, 10 bags')).toBeInTheDocument();
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
  it('clock in calls the existing attendance path as a phone check-in for the person', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Clock in' }));
    expect(h.record).toHaveBeenCalledWith('w1', '2026-11-21', 'phone_check_in', [{ worker_id: 'pw1', status: 'present', hours: 8 }]);
  });
  it('tells a person who is not on the list to ask the supervisor', async () => {
    mount();
    expect(await screen.findByText(/Ask your supervisor/)).toBeInTheDocument();
  });
  it('marks a task done through the status-only path', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mark done' }));
    expect(h.setStatus).toHaveBeenCalledWith('t1', 'Done');
  });
});
