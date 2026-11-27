/** AC-PCI-015 (#2705) — the decision list renders nothing without requests; with one it offers approve and reject (reason required). */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import enCrews from '@/public/locales/en/crews.json';
import idCrews from '@/public/locales/id/crews.json';

const h = vi.hoisted(() => ({ requests: vi.fn(), decide: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/lib/repositories/phoneCheckIn', () => ({ phoneCheckInRepository: { requests: h.requests, decide: h.decide } }));
import { CheckInRequests } from './CheckInRequests';

const row = { id: 'r1', work_order_id: 'w1', work_order_title: 'Slab works', worker_name: 'Sari', crew_id: 'c1', crew_name: 'Crew 1',
  work_date: '2026-11-21', hours: 8, outcome: 'outside', distance_m: 222.4, accuracy_m: 10, checked_in_at: '2026-11-21T01:00:00Z',
  area_lat: -6.2, area_lng: 106.8, area_radius_m: 100 };

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><CheckInRequests /></ToastProvider></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); h.decide.mockResolvedValue(undefined); });

describe('AC-PCI-015 check-in decision list', () => {
  it('retries a failed request read and restores pending decisions', async () => {
    h.requests.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue([row]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText(/Sari/)).toBeInTheDocument();
  });
  it('renders nothing when no request waits', async () => {
    h.requests.mockResolvedValue([]);
    mount();
    await waitFor(() => expect(h.requests).toHaveBeenCalled());
    expect(screen.queryByText('Check-ins waiting for you')).not.toBeInTheDocument();
  });
  it('renders nothing when the database refuses the list (a person who cannot decide)', async () => {
    h.requests.mockRejectedValue(Object.assign(new Error('LIGHT_ACCOUNT'), { code: '42501' }));
    mount();
    await waitFor(() => expect(h.requests).toHaveBeenCalled());
    expect(screen.queryByText('Check-ins waiting for you')).not.toBeInTheDocument();
  });
  it('shows the request and approves it', async () => {
    h.requests.mockResolvedValue([row]);
    mount();
    expect(await screen.findByText(/Sari/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Check-ins waiting for you' })).toHaveTextContent('Check-ins waiting for you');
    expect(screen.getByText(/Outside the work area/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.decide).toHaveBeenCalledWith('r1', true, null));
  });
  it('AC-WCI-044 each request shows the work area it is judged against, so the supervisor needs nowhere else to look', async () => {
    h.requests.mockResolvedValue([row]);
    mount();
    expect(await screen.findByText('Work area: centre -6.2, 106.8, radius 100 m')).toBeInTheDocument();
  });
  it('rejecting asks for a reason and sends it', async () => {
    h.requests.mockResolvedValue([row]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const reason = await screen.findByRole('textbox');
    await userEvent.type(reason, 'not on this job');
    await userEvent.click(screen.getAllByRole('button', { name: /reject/i }).at(-1) as HTMLElement);
    await waitFor(() => expect(h.decide).toHaveBeenCalledWith('r1', false, 'not on this job'));
  });
  it('English and Bahasa Indonesia carry the same check-in keys', () => {
    const en = Object.keys(enCrews.checkIn).sort();
    expect(en.length).toBeGreaterThan(10);
    expect(Object.keys(idCrews.checkIn).sort()).toEqual(en);
  });
});
