/** AC-ETS-007/008/009 (unit layer, #2701): targets mark metric figures only when set, the flag label names the
 *  organisation's escalation limit, and only a real Admin sees the settings form. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  save: vi.fn(),
  targets: { availability_target_pct: null, utilisation_target_pct: null, escalation_down_days: 2 } as { availability_target_pct: number | null; utilisation_target_pct: number | null; escalation_down_days: number },
}));
vi.mock('@/src/hooks/useEquipment', () => ({
  useEquipmentAssetPages: () => ({ data: { pages: [{ rows: [{ id: 'a1', code: 'EQ-1', name: 'Loader', default_unit: 'hours', ownership: 'owned', archived_at: null }], truncated: false }] }, isPending: false, isError: false, refetch: vi.fn(), hasNextPage: false }),
}));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-09-26' }));
vi.mock('@/src/hooks/useResolvedLocale', () => ({ useOrgBusinessTimezone: () => 'UTC' }));
vi.mock('./RentalInvoiceCheck', () => ({ default: () => <div>Rental invoice check</div> }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useEquipmentAvailability', () => ({
  useStatusDays: () => ({ data: [], isError: false }),
  useLatestStatusDays: () => ({ data: [] }),
  useEquipmentProofs: () => ({ data: [] }),
  useDowntimeFlags: () => ({ data: [{ asset_id: 'a1', period_start: '2026-09-21', down_days: 6 }] }),
  useEquipmentMetrics: () => ({ data: [{ asset_id: 'a1', bucket_start: '2026-09-01', availability_pct: '80.0', utilisation_pct: '95.0', unrecorded_days: 0, pending_usage_entries: 0 }] }),
  useSetStatusBulk: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAttachProof: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRentalTerms: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRentalTermHistory: () => ({ data: [] }),
  useEquipmentOwnership: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangeRentalRate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEquipmentWorkingHours: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEquipmentTargets: () => ({ data: h.targets }),
  useSetEquipmentTargets: () => ({ mutateAsync: h.save, isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));
vi.mock('@/src/auth/policy', async (orig) => ({ ...(await orig<typeof import('@/src/auth/policy')>()), can: () => true }));

import EquipmentAvailabilityPage from './EquipmentAvailability';

const renderPage = () => render(<MemoryRouter><ToastProvider><EquipmentAvailabilityPage /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  h.role = 'Admin';
  h.save = vi.fn().mockResolvedValue(undefined);
  h.targets = { availability_target_pct: null, utilisation_target_pct: null, escalation_down_days: 2 };
});

describe('equipment target settings (#2701)', () => {
  it('AC-ETS-007 marks only the figure below a set target and shows the target', () => {
    h.targets = { availability_target_pct: 90, utilisation_target_pct: 60, escalation_down_days: 2 };
    renderPage();
    expect(screen.getAllByText('Below target')).toHaveLength(1);
    expect(screen.getByText('(target 90%)')).toBeInTheDocument();
    expect(screen.getByText('(target 60%)')).toBeInTheDocument();
  });

  it('AC-ETS-007 shows no marker and no target while none is set', () => {
    renderPage();
    expect(screen.queryByText('Below target')).not.toBeInTheDocument();
    expect(screen.queryByText(/\(target/)).not.toBeInTheDocument();
  });

  it('AC-ETS-008 the flag label names the organisation limit', () => {
    h.targets = { availability_target_pct: null, utilisation_target_pct: null, escalation_down_days: 5 };
    renderPage();
    expect(screen.getByText('Down more than 5 days')).toBeInTheDocument();
  });

  it('AC-ETS-009 an Admin saves the typed settings; empty targets are sent as null', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText('Availability target (%)'), '92.5');
    await userEvent.clear(screen.getByLabelText('Escalate after more than (days down)'));
    await userEvent.type(screen.getByLabelText('Escalate after more than (days down)'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save targets' }));
    expect(h.save).toHaveBeenCalledWith({ availability: '92.5', utilisation: null, escalationDays: '4' });
  });

  it('AC-ETS-009 other roles do not see the settings form', () => {
    h.role = 'Project Manager';
    renderPage();
    expect(screen.queryByLabelText('Availability target (%)')).not.toBeInTheDocument();
  });
});
