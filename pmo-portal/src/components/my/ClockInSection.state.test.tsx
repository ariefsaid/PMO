/** AC-WCI-030..034 — the clock-in card says what became of the tap, the Foreman can clock in, and a button never sits dead without a reason. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({ checkIn: vi.fn() }));
vi.mock('@/src/lib/repositories/phoneCheckIn', () => ({ phoneCheckInRepository: { checkIn: h.checkIn } }));
import { ClockInSection } from './ClockInSection';
import type { MyHomeWorkOrder } from '@/src/lib/repositories/myHome';

const wo = (over: Partial<MyHomeWorkOrder> = {}): MyHomeWorkOrder => ({
  work_order_id: 'w1', title: 'Slab works', project_name: 'Site A', crew_id: 'c1', crew_name: 'Crew 1', my_worker_id: 'pw1', is_controller: false, has_area: false, ...over,
});
function mount(workOrders: MyHomeWorkOrder[], deciderRole: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><ClockInSection today="2026-11-22" workOrders={workOrders} deciderRole={deciderRole} /></ToastProvider></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); h.checkIn.mockResolvedValue({ status: 'recorded', outcome: 'no_area' }); });

describe('clock-in result state', () => {
  it('AC-WCI-030 clocked in: the card says so with the time and offers no second tap', () => {
    mount([wo({ check_in: { state: 'clocked_in', at: '2026-11-22T00:14:00Z' } })]);
    expect(screen.getByTestId('clock-in-state')).toHaveTextContent(/Clocked in at \d{1,2}:\d{2}/);
    expect(screen.queryByRole('button', { name: /Clock in/ })).not.toBeInTheDocument();
  });
  it('AC-WCI-031 waiting: the card says it is waiting and names who decides; the role is named when the organisation set one', () => {
    mount([wo({ check_in: { state: 'pending', at: '2026-11-22T00:14:00Z', outcome: 'outside' } })], 'site_supervisor');
    expect(screen.getByTestId('clock-in-state')).toHaveTextContent(/outside the work area/i);
    expect(screen.getByTestId('clock-in-state')).toHaveTextContent(/Waiting for Site Supervisor to approve/);
    expect(screen.queryByRole('button', { name: /Clock in/ })).not.toBeInTheDocument();
  });
  it('AC-WCI-031 waiting with no role set says "your supervisor"', () => {
    mount([wo({ check_in: { state: 'pending', at: '2026-11-22T00:14:00Z', outcome: 'no_position' } })]);
    expect(screen.getByTestId('clock-in-state')).toHaveTextContent(/Waiting for your supervisor to approve/);
  });
  it('AC-WCI-032 refused: the card carries the reason and the person can clock in again', async () => {
    mount([wo({ check_in: { state: 'rejected', at: '2026-11-22T00:20:00Z', reason: 'too far from the gate' } })]);
    expect(screen.getByTestId('clock-in-state')).toHaveTextContent('your supervisor refused this check-in: too far from the gate');
    await userEvent.click(screen.getByRole('button', { name: 'Clock in again' }));
    await waitFor(() => expect(h.checkIn).toHaveBeenCalledTimes(1));
  });
  it('AC-WCI-033 the tap itself is answered at once, before the next read of the home', async () => {
    mount([wo()]);
    await userEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    expect(await screen.findByText(/Clocked in at/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clock in/ })).not.toBeInTheDocument();
  });
});

describe('Foreman clock-in', () => {
  it('AC-WCI-034 a Foreman with no person of his own yet still gets a working button, and the tap goes to the RPC', async () => {
    mount([wo({ my_worker_id: null, is_controller: true })]);
    const button = screen.getByRole('button', { name: 'Clock in' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(h.checkIn).toHaveBeenCalledWith(expect.objectContaining({ workOrderId: 'w1', crewId: 'c1' })));
  });
  it('AC-WCI-034 a Foreman of two crews on one work order sees each crew and chooses by tapping that crew', async () => {
    mount([wo({ my_worker_id: null, is_controller: true, crew_id: 'c1', crew_name: 'Crew 1' }), wo({ my_worker_id: null, is_controller: true, crew_id: 'c2', crew_name: 'Crew 2' })]);
    expect(screen.getByText('Crew: Crew 1')).toBeInTheDocument();
    expect(screen.getByText('Crew: Crew 2')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clock in' })[1]);
    await waitFor(() => expect(h.checkIn).toHaveBeenCalledWith(expect.objectContaining({ workOrderId: 'w1', crewId: 'c2' })));
    expect(screen.getAllByRole('button', { name: 'Clock in' })).toHaveLength(1);
  });
  it('AC-WCI-035 nothing rostered: the sentence says what to do', () => {
    mount([]);
    expect(screen.getByText('You are not rostered on a work order today. Ask your supervisor.')).toBeInTheDocument();
  });
  it('AC-WCI-035 a coded database message reaches the person in plain words', async () => {
    h.checkIn.mockRejectedValue(new AppError('PCI_NO_PERSON: this account is not in the workforce register', '23514'));
    mount([wo()]);
    await userEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    expect(await screen.findByText('You are not in the workforce list yet. Ask your supervisor.')).toBeInTheDocument();
  });
});
