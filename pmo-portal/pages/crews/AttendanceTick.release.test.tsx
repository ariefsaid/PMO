import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ record: vi.fn(), holds: new Map<string, 'pending' | 'deferred'>() }));
vi.mock('@/src/hooks/useCrews', () => ({
  useWorkOrderRoster: () => ({
    data: [{
      crew_id: 'c1', crew_code: 'CR-1', crew_name: 'Crew one', field_controller_id: 'fc1', roles: [], shortfall: 0,
      members: [
        { worker_id: 'w1', display_name: 'Ana', kind: 'own', has_login: true, standard_role_id: null, off_rotation: false },
        { worker_id: 'w2', display_name: 'Budi', kind: 'own', has_login: true, standard_role_id: null, off_rotation: false },
      ],
    }],
    isPending: false, isError: false, refetch: vi.fn(),
  }),
  useAttendanceDay: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAwaitingAttendance: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAllCrewMembers: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useCrewWorkers: () => ({ data: [] }),
  useCrewWorkOrders: () => ({ data: [{ id: 'wo1', wo_number: 'WO-1', title: 'Pipe rack' }], isLoading: false, isError: false, refetch: vi.fn() }),
  useAttendanceMutations: () => ({
    record: { mutateAsync: h.record }, uploadPhoto: { mutateAsync: vi.fn() }, generateWeek: { mutateAsync: vi.fn() }, decideWeek: { mutateAsync: vi.fn() },
  }),
}));
vi.mock('@/src/hooks/useMedicalRelease', () => ({ useReleaseHolds: () => ({ data: h.holds }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer' as Role, effectiveRole: 'Engineer' as Role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fc1', org_id: 'org1' } }) }));

import { AttendanceTick } from './AttendanceTick';

const open = () => render(<MemoryRouter initialEntries={['/crews?view=attendance&wo=wo1&date=2026-11-18']}><ToastProvider><AttendanceTick /></ToastProvider></MemoryRouter>);

describe('AC-MR-008 the tick screen and a worker whose medical release is not approved', () => {
  beforeEach(() => { h.record = vi.fn().mockResolvedValue(1); h.holds = new Map([['w1', 'pending']]); });

  it('shows the worker as release pending with the reason and disables their controls; others are unchanged', () => {
    open();
    const ana = screen.getByRole('row', { name: /Ana/ });
    expect(within(ana).getByText('Release pending')).toBeInTheDocument();
    expect(within(ana).getByText(/direct manager approves the medical release/)).toBeInTheDocument();
    expect(within(ana).getByRole('combobox', { name: /Status for Ana/ })).toBeDisabled();
    expect(within(ana).getByRole('textbox', { name: /Reason for Ana/ })).toBeDisabled();
    const budi = screen.getByRole('row', { name: /Budi/ });
    expect(within(budi).queryByText('Release pending')).toBeNull();
    expect(within(budi).getByRole('combobox', { name: /Status for Budi/ })).toBeEnabled();
  });

  it('says deferred when the manager deferred it', () => {
    h.holds = new Map([['w1', 'deferred']]);
    open();
    expect(within(screen.getByRole('row', { name: /Ana/ })).getByText('Release deferred')).toBeInTheDocument();
  });

  it('saves the others and leaves the held worker out of the recording', async () => {
    open();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1));
    expect(h.record.mock.calls[0][0].rows.map((r: { worker_id: string }) => r.worker_id)).toEqual(['w2']);
  });
});
