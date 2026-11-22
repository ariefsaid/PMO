/** AC-PCI-014 (#2705) — the position is read once on the tap, only for a work order with an area; both permissions-policy branches. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ checkIn: vi.fn(), record: vi.fn() }));
vi.mock('@/src/lib/repositories/phoneCheckIn', () => ({ phoneCheckInRepository: { checkIn: h.checkIn } }));
vi.mock('@/src/lib/repositories/crews', () => ({ attendanceRepository: { record: h.record } }));
import { ClockInSection } from './ClockInSection';

const base = { project_name: 'Site A', crew_id: 'c1', crew_name: 'Crew 1', my_worker_id: 'pw1', is_controller: false };
const withArea = { ...base, work_order_id: 'w1', title: 'Slab works', has_area: true };
const noArea = { ...base, work_order_id: 'w2', title: 'Pipe works', has_area: false };

const geo = { getCurrentPosition: vi.fn(), watchPosition: vi.fn() };
function allowGeolocation(allowed: boolean) {
  Object.defineProperty(document, 'permissionsPolicy', { configurable: true, value: { allowsFeature: () => allowed } });
}
const assign = vi.fn();

function mount(workOrders = [withArea, noArea]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><ClockInSection today="2026-11-21" workOrders={workOrders} /></ToastProvider></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/my');
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo });
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, search: '', pathname: '/my' } });
  allowGeolocation(true);
  h.record.mockResolvedValue(1);
  h.checkIn.mockResolvedValue({ status: 'recorded', outcome: 'inside' });
  geo.getCurrentPosition.mockImplementation((ok: PositionCallback) =>
    ok({ coords: { latitude: 0.0005, longitude: 0, accuracy: 12 } } as GeolocationPosition));
});

describe('AC-PCI-014 clock-in location', () => {
  it('a work order with no area never asks for a location and sends the tap with no position and no request for one', async () => {
    mount([noArea]);
    await userEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    await waitFor(() => expect(h.checkIn).toHaveBeenCalledWith({ workOrderId: 'w2', crewId: 'c1', hours: 8, position: undefined, noPosition: false }));
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('a work order with an area reads the position exactly once per tap, never watches, and sends it with the crew', async () => {
    mount([withArea]);
    await userEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    await waitFor(() => expect(h.checkIn).toHaveBeenCalledTimes(1));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(h.checkIn).toHaveBeenCalledWith({ workOrderId: 'w1', crewId: 'c1', hours: 8, position: { lat: 0.0005, lng: 0, accuracy: 12 }, noPosition: false });
    expect(h.record).not.toHaveBeenCalled();
    expect(await screen.findByText(/Clocked in at/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clock in/ })).not.toBeInTheDocument();
  });

  it('an outside result shows the supervisor note and is not shown as clocked in', async () => {
    h.checkIn.mockResolvedValue({ status: 'pending', outcome: 'outside', id: 'r1' });
    mount([withArea]);
    await userEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    expect(await screen.findByText(/outside the work area/i)).toBeInTheDocument();
    expect(screen.queryByText(/Clocked in at/)).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting for your supervisor to approve/)).toBeInTheDocument();
  });

  it('denied permission shows the message and the ask-supervisor action, which sends a request without a position', async () => {
    geo.getCurrentPosition.mockImplementation((_ok: PositionCallback, err: PositionErrorCallback) => err({ code: 1, message: 'denied' } as GeolocationPositionError));
    h.checkIn.mockResolvedValue({ status: 'pending', outcome: 'no_position', id: 'r2' });
    mount([withArea]);
    await userEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    expect(await screen.findByText(/blocked/i)).toBeInTheDocument();
    expect(h.checkIn).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Ask my supervisor' }));
    await waitFor(() => expect(h.checkIn).toHaveBeenCalledWith({ workOrderId: 'w1', crewId: 'c1', hours: 8, position: undefined, noPosition: true }));
  });

  it('when the document does not allow geolocation it navigates once to /my?clockin=<work order> and does not read a position', async () => {
    allowGeolocation(false);
    mount([withArea]);
    await userEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/my?clockin=w1');
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('the navigation cannot loop: a second tap in a still-blocked document shows a reload message instead of navigating again', async () => {
    allowGeolocation(false);
    mount([withArea]);
    await userEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/reload this page/i)).toBeInTheDocument();
  });

  it('after the hard navigation the tap resumes once from ?clockin=<work order> in a document that allows geolocation', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, search: '?clockin=w1', pathname: '/my' } });
    mount([withArea]);
    await waitFor(() => expect(h.checkIn).toHaveBeenCalledTimes(1));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
