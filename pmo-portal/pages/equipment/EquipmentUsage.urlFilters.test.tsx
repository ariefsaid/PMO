import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';

/**
 * R2 (ux/1110): the equipment usage week, view tab and asset filter are URL-owned, so a
 * stepped-back week (or the approvals tab) survives opening an asset and pressing Back,
 * or a refresh — `?week=` keeps its existing deep-link contract.
 */

type Entry = {
  id: string; asset_id: string; project_id: string; work_date: string; quantity: number; unit: 'hours' | 'days'; kind: 'work' | 'standby';
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected'; author_id: string; fuel_litres: number | null; trips: number | null; note: string | null;
  archived_at: string | null; decision_notes: string | null;
};
const h = vi.hoisted(() => ({
  entries: [] as unknown[],
  usageQuery: null as { from?: string; to?: string } | null,
  query: { isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/hooks/useEquipment', async () => {
  const React = await import('react');
  return {
    useEquipmentAssetPages: () => ({
      data: { pages: [{ rows: [{ id: 'a1', code: 'EQU-1', name: 'Loader 1', default_unit: 'hours', archived_at: null }] }] },
      isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(), total: 1,
    }),
    useEquipmentUsage: (args: { from: string; to: string }) => {
      h.usageQuery = args;
      const [rows] = React.useState<unknown[]>(h.entries);
      return { data: { rows, truncated: false }, ...h.query };
    },
    useSaveUsage: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useTransitionUsage: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useApproveWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useArchiveUsage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({ data: [{ id: 'pj1', name: 'EQU P1', short_name: null, project_manager_id: 'u-pm' }] }),
}));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [{ id: 'u-eng', full_name: 'Engineer' }] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-eng', org_id: 'org1' } }) }));

import EquipmentUsagePage from './EquipmentUsage';

const entry = (over: Partial<Entry>): Entry => ({
  id: 'e1', asset_id: 'a1', project_id: 'pj1', work_date: '2026-08-24', quantity: 4, unit: 'hours', kind: 'work', status: 'Draft',
  author_id: 'u-eng', fuel_litres: null, trips: null, note: null, archived_at: null, decision_notes: null, ...over,
});

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderPage = (role: Role = 'Engineer', initialEntry = '/equipment') =>
  render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <LocationProbe />
          <EquipmentUsagePage />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  // Mon 7 – Sun 13 Sep 2026 is "this week": the default that stays out of the URL.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 11, 9, 0, 0));
  h.entries = [entry({})];
  h.usageQuery = null;
  h.query = { isPending: false, isError: false, refetch: vi.fn() };
});
afterEach(() => { vi.useRealTimers(); });

describe('R2 — the equipment usage week, tab and asset live in the URL', () => {
  it('a refresh of ?week=2026-08-24 reopens that week and reads its entries', () => {
    renderPage('Engineer', '/equipment?week=2026-08-24');
    expect(screen.getByText(`${formatDay('2026-08-24')} – ${formatDay('2026-08-30')}`)).toBeInTheDocument();
    expect(h.usageQuery).toMatchObject({ from: '2026-08-24', to: '2026-08-30' });
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?week=2026-08-24');
  });

  it('stepping forward a week writes ?week= into the URL', async () => {
    const user = userEvent.setup();
    renderPage('Engineer', '/equipment?week=2026-08-24');
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?week=2026-08-31');
  });

  it('a refresh of ?tab=approvals reopens the approvals tab; the default clears back out', async () => {
    const user = userEvent.setup();
    renderPage('Project Manager', '/equipment?tab=approvals');
    expect(screen.getByRole('tab', { name: 'Approvals' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?tab=approvals');
    await user.click(screen.getByRole('tab', { name: 'My usage' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '');
  });

  it('stepping back a week writes ?week= into the URL, and This week returns to the current week', async () => {
    const user = userEvent.setup();
    renderPage('Engineer', '/equipment');
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByText(`${formatDay('2026-08-31')} – ${formatDay('2026-09-06')}`)).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?week=2026-08-31');
    expect(h.usageQuery).toMatchObject({ from: '2026-08-31', to: '2026-09-06' });
    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '');
  });

  it('picking equipment in the filter keeps that machine in the URL', async () => {
    const user = userEvent.setup();
    renderPage('Engineer', '/equipment');
    await user.click(screen.getByRole('combobox', { name: 'Show equipment' }));
    await user.click(await screen.findByRole('option', { name: /EQU-1 · Loader 1/ }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?asset=a1');
  });

  it('a refresh of ?asset=a1 shows that equipment in the filter', () => {
    renderPage('Engineer', '/equipment?asset=a1');
    // The Combobox trigger names (and titles) the selected asset: `code · name`.
    expect(screen.getByTitle('EQU-1 · Loader 1')).toBeInTheDocument();
  });
});
