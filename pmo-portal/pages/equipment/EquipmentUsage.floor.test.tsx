/**
 * Floor tests for the equipment usage week (floor-wave2).
 *
 * Five controls on the usage grid that nothing drove end-to-end: the week steppers, the Add-row
 * inline form (Add and Cancel), clearing a day's quantity, and the fuel/trips chevron. Each
 * asserts the OUTCOME a person gets — the week the grid reads, the line that appears, the write
 * that is issued — never a look. The harness mirrors `pages/equipment/EquipmentUsage.test.tsx`
 * (same equipment-hook mocks, same impersonation provider, same pinned clock).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';

type Entry = {
  id: string; asset_id: string; project_id: string; work_date: string; quantity: number; unit: 'hours' | 'days'; kind: 'work' | 'standby';
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected'; author_id: string; fuel_litres: number | null; trips: number | null; note: string | null;
  archived_at: string | null; decision_notes: string | null;
};

const h = vi.hoisted(() => ({
  entries: [] as unknown[],
  usageArgs: [] as unknown[],
  query: { isPending: false, isError: false, refetch: vi.fn() },
  save: vi.fn(),
  archive: vi.fn(),
}));

vi.mock('@/src/hooks/useEquipment', async () => {
  const React = await import('react');
  return {
    useEquipmentAssetPages: () => ({
      data: { pages: [{ rows: [{ id: 'a1', code: 'EQU-1', name: 'Loader 1', default_unit: 'hours', archived_at: null }] }] },
      isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false,
      fetchNextPage: vi.fn(), refetch: vi.fn(), total: 1,
    }),
    useEquipmentUsage: (args: unknown) => {
      h.usageArgs.push(args);
      const [rows] = React.useState<unknown[]>(h.entries);
      return { data: { rows, truncated: false }, ...h.query };
    },
    useSaveUsage: () => ({ mutateAsync: h.save, isPending: false }),
    useTransitionUsage: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useApproveWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useArchiveUsage: () => ({ mutateAsync: h.archive, isPending: false }),
  };
});
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({ data: [{ id: 'pj1', name: 'EQU P1', short_name: null, project_manager_id: 'u-pm' }] }),
}));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [{ id: 'u-eng', full_name: 'Engineer' }] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-eng', org_id: 'org1' } }) }));

import EquipmentUsagePage from './EquipmentUsage';

const entry = (over: Partial<Entry>): Entry => ({
  id: 'e1', asset_id: 'a1', project_id: 'pj1', work_date: '2026-09-08', quantity: 4, unit: 'hours', kind: 'work', status: 'Draft',
  author_id: 'u-eng', fuel_litres: null, trips: null, note: null, archived_at: null, decision_notes: null, ...over,
});

const day = (iso: string) => formatDay(iso);
const cell = (iso: string, project = 'EQU P1', unit = 'hours') =>
  screen.getByRole('textbox', { name: `Loader 1 · ${project} · ${day(iso)}, ${unit}` });

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderPage = (role: Role = 'Engineer', initialEntry = '/equipment/usage') =>
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

const probe = () => screen.getByTestId('location-probe');
const weekRead = () => h.usageArgs.at(-1) as { from: string; to: string };

beforeEach(() => {
  // Fri 11 Sep 2026 — the week is Mon 7 – Sun 13 Sep, so "this week" is out of the URL by default.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 11, 9, 0, 0));
  h.entries = [entry({})];
  h.usageArgs = [];
  h.query = { isPending: false, isError: false, refetch: vi.fn() };
  h.save = vi.fn().mockResolvedValue({ id: 'e9', status: 'Draft', day_total_hours: 3, over_24h: false });
  h.archive = vi.fn().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('Equipment usage floor — the week you read', () => {
  it('floor: Previous week steps the grid back a Monday and reads that week', async () => {
    renderPage('Engineer', '/equipment/usage?week=2026-09-21');
    expect(weekRead()).toMatchObject({ from: '2026-09-21', to: '2026-09-27' });

    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));

    expect(probe().dataset.search).toBe('?week=2026-09-14');
    await waitFor(() => expect(weekRead()).toMatchObject({ from: '2026-09-14', to: '2026-09-20' }));
  });

  it('floor: This week returns to the current week and keeps it out of the URL', async () => {
    renderPage('Engineer', '/equipment/usage?week=2026-09-21');
    await userEvent.click(screen.getByRole('button', { name: 'This week' }));

    expect(probe().dataset.search).toBe('');
    await waitFor(() => expect(weekRead()).toMatchObject({ from: '2026-09-07', to: '2026-09-13' }));
  });
});

describe('Equipment usage floor — Add row', () => {
  const pickRow = async (kindLabel = 'Add') => {
    await userEvent.click(screen.getByRole('button', { name: 'Add row' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Equipment' }));
    await userEvent.click(await screen.findByRole('option', { name: /EQU-1 · Loader 1/ }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /EQU P1/ }));
    await userEvent.click(screen.getByRole('button', { name: kindLabel }));
  };

  it('floor: Add row opens the picked machine and project line, and a typed day saves against it', async () => {
    h.entries = [];
    renderPage();
    expect(screen.getByText('No equipment logged this week')).toBeInTheDocument();

    await pickRow();

    const typed = cell('2026-09-10');
    expect(typed).toBeEnabled();
    await userEvent.type(typed, '3{Enter}');
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({
      asset_id: 'a1', project_id: 'pj1', work_date: '2026-09-10', quantity: 3, unit: 'hours', kind: 'work',
    }));
  });

  it('floor: Cancel in the new-row form adds no line and closes the form', async () => {
    h.entries = [];
    renderPage();
    await pickRow('Cancel');
    expect(screen.queryByRole('combobox', { name: 'Equipment' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add row' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Loader 1 · EQU P1/ })).not.toBeInTheDocument();
  });
});

describe('Equipment usage floor — day cells', () => {
  it('floor: clearing a day’s quantity archives that entry', async () => {
    renderPage();
    const logged = cell(entry({}).work_date);
    expect(logged).toHaveValue('4');

    await userEvent.clear(logged);
    await userEvent.type(logged, '{Enter}');

    await waitFor(() => expect(h.archive).toHaveBeenCalledWith('e1'));
    expect(h.save).not.toHaveBeenCalled();
  });

  it('floor: the fuel/trips chevron reveals the measures lines and trips takes whole numbers only', async () => {
    renderPage();
    expect(screen.queryByRole('textbox', { name: /, trips$/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Fuel and trips for Loader 1 · EQU P1' }));

    const trips = await screen.findByRole('textbox', { name: `Loader 1 · EQU P1 · ${day('2026-09-08')}, trips` });
    expect(screen.getByRole('textbox', { name: `Loader 1 · EQU P1 · ${day('2026-09-08')}, fuel litres` })).toBeEnabled();

    await userEvent.type(trips, '2.5{Enter}');
    expect(await screen.findByText(/Trips must be a whole number/i)).toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();

    await userEvent.clear(trips);
    await userEvent.type(trips, '3{Enter}');
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', trips: 3, quantity: 4 })));
  });
});
