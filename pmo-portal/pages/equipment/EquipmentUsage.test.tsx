import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';
import type { Role } from '@/src/auth/AuthContext';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';

type Entry = {
  id: string; asset_id: string; project_id: string; work_date: string; quantity: number; unit: 'hours' | 'days'; kind: 'work' | 'standby';
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected'; author_id: string; fuel_litres: number | null; trips: number | null; note: string | null;
  archived_at: string | null; decision_notes: string | null;
};
const h = vi.hoisted(() => ({
  entries: [] as unknown[],
  setEntries: (() => undefined) as (e: unknown[]) => void,
  assets: [] as unknown[],
  usageArgs: [] as unknown[],
  query: { isPending: false, isError: false, refetch: vi.fn() },
  save: vi.fn(), transition: vi.fn(), approveWeek: vi.fn(), archive: vi.fn(),
  assetsHasMore: false, fetchAssetPage: vi.fn(),
  userId: 'u-eng',
}));

vi.mock('@/src/hooks/useEquipment', async () => {
  const React = await import('react');
  return {
    useEquipmentAssetPages: () => ({
      data: { pages: [{ rows: h.assets }] },
      isPending: false, isError: false, hasNextPage: h.assetsHasMore, isFetchingNextPage: false,
      fetchNextPage: h.fetchAssetPage, refetch: vi.fn(), total: h.assets.length,
    }),
    useEquipmentUsage: (args: unknown) => {
      h.usageArgs.push(args);
      const [rows, set] = React.useState<unknown[]>(h.entries);
      h.setEntries = set;
      return { data: { rows, truncated: false }, ...h.query };
    },
    useSaveUsage: () => ({ mutateAsync: h.save, isPending: false }),
    useTransitionUsage: () => ({ mutateAsync: h.transition, isPending: false }),
    useApproveWeek: () => ({ mutateAsync: h.approveWeek, isPending: false }),
    useArchiveUsage: () => ({ mutateAsync: h.archive, isPending: false }),
  };
});
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({ data: [{ id: 'pj1', name: 'EQU P1', short_name: null, project_manager_id: 'u-pm' }, { id: 'pj2', name: 'EQU P2', short_name: null, project_manager_id: 'u-other' }] }),
}));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [{ id: 'u-eng', full_name: 'Engineer' }, { id: 'u-pm', full_name: 'Reviewer' }] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org1' } }) }));

import EquipmentUsagePage from './EquipmentUsage';

const entry = (over: Partial<Entry>): Entry => ({
  id: 'e1', asset_id: 'a1', project_id: 'pj1', work_date: '2026-09-08', quantity: 4, unit: 'hours', kind: 'work', status: 'Draft',
  author_id: 'u-eng', fuel_litres: null, trips: null, note: null, archived_at: null, decision_notes: null, ...over,
});
const day = (iso: string) => formatDay(iso);
const cell = (iso: string, project = 'EQU P1') => screen.getByRole('textbox', { name: `Loader 1 · ${project} · ${day(iso)}, hours` });

const renderPage = (role: Role = 'Engineer', initialEntry = '/equipment/usage') =>
  render(<ImpersonationProvider realRole={role}><MemoryRouter initialEntries={[initialEntry]}><ToastProvider><LocationProbe /><EquipmentUsagePage /></ToastProvider></MemoryRouter></ImpersonationProvider>);

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-pathname={location.pathname} data-search={location.search} />;
};

const ViewAs: React.FC<{ role: Role }> = ({ role }) => {
  const { viewAs } = useEffectiveRole();
  React.useEffect(() => { viewAs(role); }, [viewAs, role]);
  return null;
};

describe('/equipment usage grid (AC-EQU-017)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 11, 9, 0, 0)); // Fri 11 Sep 2026: the week is Mon 7 - Sun 13 Sep
    h.userId = 'u-eng';
    h.entries = [entry({})];
    h.assets = [{ id: 'a1', code: 'EQU-1', name: 'Loader 1', default_unit: 'hours', archived_at: null }];
    h.usageArgs = [];
    h.assetsHasMore = false;
    h.fetchAssetPage.mockClear();
    h.query = { isPending: false, isError: false, refetch: vi.fn() };
    h.save = vi.fn(async (input: { work_date: string; quantity: number }) => {
      h.setEntries([...h.entries, entry({ id: 'e2', work_date: input.work_date, quantity: input.quantity })]);
      h.entries = [...h.entries, entry({ id: 'e2', work_date: input.work_date, quantity: input.quantity })];
      return { id: 'e2', status: 'Draft', day_total_hours: input.quantity, over_24h: false };
    });
    h.transition = vi.fn(async (a: { id: string; to: Entry['status'] }) => {
      h.entries = (h.entries as Entry[]).map((e) => (e.id === a.id ? { ...e, status: a.to } : e));
      h.setEntries(h.entries);
    });
    h.approveWeek = vi.fn().mockResolvedValue({ approved: 1, skipped_own: 1, skipped_not_permitted: 0 });
    h.archive = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('C8 EquipmentUsage.tsx:83,101 scopes the bounded week read to the selected asset', () => {
    renderPage('Engineer', '/equipment/usage?week=2026-09-07&asset=a1');
    expect(h.usageArgs.at(-1)).toMatchObject({ from: '2026-09-07', to: '2026-09-13', assetId: 'a1' });
  });

  it('C8b F2 counts the machines the picker has loaded and can load the rest', async () => {
    h.assetsHasMore = true;
    renderPage();
    expect(screen.getByText('1 loaded, more available')).toBeInTheDocument();
    expect(screen.getByText('Machines past this page are not loaded yet.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }));
    expect(h.fetchAssetPage).toHaveBeenCalledOnce();
  });

  it('AC-RSN-005 shows the returned equipment entry reason and person', () => {
    h.entries = [{ ...entry({ status: 'Rejected', decision_notes: 'Correct the asset' }), rejected_by: 'u-pm', rejected_at: '2026-09-09T10:00:00Z', rejecter: { full_name: 'Reviewer' } }];
    renderPage();
    expect(screen.getByText(/Correct the asset/)).toBeInTheDocument();
    expect(screen.getByText(/Reviewer/)).toBeInTheDocument();
  });

  it('AC-RSN-005 keeps a legacy return reason visible during correction alongside other entries', () => {
    h.entries = [
      { ...entry({ id: 'legacy', status: 'Draft', decision_notes: 'Correct legacy usage' }), rejected_by: null, rejected_at: null, rejecter: null },
      { ...entry({ id: 'new', status: 'Rejected', work_date: '2026-09-09', decision_notes: 'Correct this usage' }), rejected_by: 'u-pm', rejected_at: '2026-09-09T10:00:00Z', rejecter: { full_name: 'Reviewer' } },
    ];
    const { unmount } = renderPage();
    expect(screen.getByText('Correct legacy usage')).toBeInTheDocument();
    expect(screen.queryByText('Person unavailable')).not.toBeInTheDocument();
    expect(screen.getByText('Correct this usage')).toBeInTheDocument();
    expect(screen.getByText(/Reviewer/)).toHaveTextContent('2026');
    unmount();
    h.entries = [{ ...entry({ status: 'Rejected', decision_notes: null }), rejected_by: null, rejected_at: null, rejecter: null }];
    renderPage();
    expect(screen.getByText('Reason unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Person unavailable')).not.toBeInTheDocument();
  });

  it('C10 EquipmentUsage.tsx:160: reports mixed submission results and still attempts later entries', async () => {
    h.entries = [
      entry({ id: 'failed', project_id: 'pj1' }),
      entry({ id: 'saved', project_id: 'pj2' }),
    ];
    h.transition.mockImplementation(async (a: { id: string; to: Entry['status'] }) => {
      if (a.id === 'failed' && a.to === 'Submitted') throw new Error('write failed');
      h.entries = (h.entries as Entry[]).map((e) => (e.id === a.id ? { ...e, status: a.to } : e));
      h.setEntries(h.entries);
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Submit week' }));

    expect(h.transition).toHaveBeenCalledWith({ id: 'saved', to: 'Submitted' });
    const result = await screen.findByText(/1 submitted/i);
    expect(result).toHaveTextContent(/1 failed/i);
    expect(result).toHaveTextContent(/EQU P1/);
  });

  it('AC-EQU-017 a user logs 6 h on a project for an asset and day, submits, and the row shows Submitted', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(cell('2026-09-10'), '6{Enter}');
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({
      asset_id: 'a1', project_id: 'pj1', work_date: '2026-09-10', quantity: 6, unit: 'hours', kind: 'work',
    }));
    expect(screen.getByRole('textbox', { name: `Loader 1 · EQU P1 · ${day('2026-09-10')}, hours` })).toHaveValue('6');
    expect(within(screen.getByRole('row', { name: /Loader 1/ })).getByText('Draft')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit week' }));
    await waitFor(() => expect(h.transition).toHaveBeenCalledWith({ id: 'e2', to: 'Submitted' }));
    expect(h.transition).toHaveBeenCalledWith({ id: 'e1', to: 'Submitted' });
    expect(await within(screen.getByRole('row', { name: /Loader 1/ })).findByText('Submitted')).toBeInTheDocument();
    // submitted days are locked: the author cannot edit them under the approver's feet
    expect(cell('2026-09-10')).toBeDisabled();
  });

  it('AC-EQU-017 a 26 h day shows the over-24 h warning but saves', async () => {
    h.save = vi.fn().mockResolvedValue({ id: 'e2', status: 'Draft', day_total_hours: 26, over_24h: true });
    const user = userEvent.setup();
    renderPage();
    await user.type(cell('2026-09-10'), '12{Enter}');
    const warning = await screen.findByText(/26 h/);
    expect(warning).toHaveTextContent(day('2026-09-10'));
    expect(warning.closest('[role="status"]')).not.toBeNull();
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it('AC-EQU-017 a value over the entry limit is refused before any save', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(cell('2026-09-10'), '25{Enter}');
    expect(await screen.findByText(/at most 24 hours/)).toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('AC-EQU-017 a day in the future cannot be logged', () => {
    renderPage();
    expect(cell('2026-09-12')).toBeDisabled();
    expect(cell('2026-09-10')).toBeEnabled();
  });

  it('C2 EquipmentUsage.tsx:243,356 (AC-EQU-017) confirms which submitted week will be approved', async () => {
    h.userId = 'u-pm';
    h.entries = [
      entry({ id: 'e5', status: 'Submitted', author_id: 'u-eng' }),
      entry({ id: 'e6', status: 'Submitted', author_id: 'u-pm', work_date: '2026-09-09' }),
    ];
    const user = userEvent.setup();
    renderPage('Project Manager');
    await user.click(screen.getByRole('tab', { name: 'Approvals' }));
    await user.click(screen.getByRole('button', { name: 'Approve week' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve equipment usage week?' });
    expect(dialog).toHaveTextContent(/Loader 1/);
    expect(dialog).toHaveTextContent(/1 submitted entry/);
    expect(dialog).toHaveTextContent(/own entries.*skipped/i);
    expect(h.approveWeek).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Approve week' }));
    await waitFor(() => expect(h.approveWeek).toHaveBeenCalledWith({ assetId: 'a1', weekStart: '2026-09-07' }));
    expect((await screen.findAllByText('1 approved · 1 skipped (your own)')).length).toBeGreaterThan(0);
  });

  it('AC-EQU-017 the author sees no Approve on their own entry', async () => {
    h.userId = 'u-pm';
    h.entries = [
      entry({ id: 'e5', status: 'Submitted', author_id: 'u-eng' }),
      entry({ id: 'e6', status: 'Submitted', author_id: 'u-pm', work_date: '2026-09-09' }),
    ];
    const user = userEvent.setup();
    renderPage('Project Manager');
    await user.click(screen.getByRole('tab', { name: 'Approvals' }));
    const rows = screen.getAllByRole('row').filter((r) => within(r).queryByText(/EQU P1/));
    const own = rows.find((r) => within(r).queryByText(day('2026-09-09')));
    const theirs = rows.find((r) => within(r).queryByText(day('2026-09-08')));
    expect(own).toBeDefined();
    expect(theirs).toBeDefined();
    expect(within(own!).queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(within(own!).getByText('Your own entry')).toBeInTheDocument();
    expect(within(theirs!).getByRole('button', { name: /^Approve/ })).toBeInTheDocument();
  });

  it('AC-EQU-017 a PM sees no Approve on a project they do not manage', async () => {
    h.userId = 'u-pm';
    h.entries = [entry({ id: 'e7', project_id: 'pj2', status: 'Submitted', author_id: 'u-eng' })];
    const user = userEvent.setup();
    renderPage('Project Manager');
    await user.click(screen.getByRole('tab', { name: 'Approvals' }));
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
  });

  it('AC-EQU-017 return needs a reason and sends it (stored as Rejected)', async () => {
    h.userId = 'u-pm';
    h.entries = [entry({ id: 'e5', status: 'Submitted', author_id: 'u-eng' })];
    const user = userEvent.setup();
    renderPage('Project Manager');
    await user.click(screen.getByRole('tab', { name: 'Approvals' }));
    await user.click(screen.getByRole('button', { name: /^Return/ }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Return' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'Wrong day');
    await user.click(confirm);
    await waitFor(() => expect(h.transition).toHaveBeenCalledWith({ id: 'e5', to: 'Rejected', notes: 'Wrong day' }));
  });

  it('AC-EQU-017 a failed approve keeps the confirmation open with its classified error', async () => {
    h.userId = 'u-pm';
    h.entries = [entry({ id: 'e5', status: 'Submitted', author_id: 'u-eng' })];
    h.transition.mockRejectedValueOnce(Object.assign(new Error('permission denied for table equipment_usage'), { code: '42501' }));
    const user = userEvent.setup();
    renderPage('Project Manager');
    await user.click(screen.getByRole('tab', { name: 'Approvals' }));
    await user.click(screen.getByRole('button', { name: /Approve Loader 1/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve usage entry?' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    const openDialog = await screen.findByRole('dialog', { name: 'Approve usage entry?' });
    expect(within(openDialog).getByRole('alert')).toHaveTextContent("You don't have permission to do that.");
    expect(within(openDialog).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(h.transition).toHaveBeenCalledWith({ id: 'e5', to: 'Approved' });
  });

  it('AC-EQU-017 an Admin viewing as an Engineer gets a read-only grid: every cell disabled, no Add row, no Submit week', async () => {
    render(<ImpersonationProvider realRole="Admin" demoEligibility="eligible"><MemoryRouter><ToastProvider><ViewAs role="Engineer" /><EquipmentUsagePage /></ToastProvider></MemoryRouter></ImpersonationProvider>);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull());
    for (const input of screen.getAllByRole('textbox')) expect(input).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Submit week' })).toBeNull();
  });

  it('AC-EQU-017 an Engineer has no Approvals tab', () => {
    renderPage('Engineer');
    expect(screen.queryByRole('tab', { name: 'Approvals' })).toBeNull();
  });

  it('AC-EQU-017 shows loading, error with retry, and the empty grid', async () => {
    h.query = { isPending: true, isError: false, refetch: vi.fn() };
    const { unmount } = renderPage();
    expect(screen.queryByRole('textbox')).toBeNull();
    unmount();
    h.query = { isPending: false, isError: true, refetch: vi.fn() };
    const again = renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: /retry/i }));
    expect(h.query.refetch).toHaveBeenCalled();
    again.unmount();
    h.query = { isPending: false, isError: false, refetch: vi.fn() };
    h.entries = [];
    renderPage();
    expect(screen.getByText('No equipment logged this week')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add row' })).toBeInTheDocument();
  });

  it('AC-EQU-017 a typed value commits when the cell loses focus, not while typing', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(cell('2026-09-10'), '5');
    expect(h.save).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({
      asset_id: 'a1', project_id: 'pj1', work_date: '2026-09-10', quantity: 5,
    })));
  });

  it('AC-EQU-017 clearing an editable day cell archives that entry', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.clear(cell('2026-09-08'));
    await user.tab();
    await waitFor(() => expect(h.archive).toHaveBeenCalledWith('e1'));
  });

  it('AC-EQU-017 the fuel and trips chevron opens litres and saves them on the entry', async () => {
    const user = userEvent.setup();
    renderPage();
    const toggle = screen.getByRole('button', { name: 'Fuel and trips for Loader 1 · EQU P1' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const fuel = screen.getByRole('textbox', { name: `Loader 1 · EQU P1 · ${day('2026-09-10')}, fuel litres` });
    await user.type(fuel, '12{Enter}');
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', fuel_litres: 12 })));
  });

  it('AC-EQU-017 Add row needs a machine and a project before the row can be added', async () => {
    h.entries = [];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Equipment' }));
    await user.click(await screen.findByRole('option', { name: 'EQU-1 · Loader 1' }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    await user.click(await screen.findByRole('option', { name: 'EQU P1' }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('row', { name: /Loader 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add row' })).toBeInTheDocument();
    await user.type(cell('2026-09-10'), '3{Enter}');
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({
      asset_id: 'a1', project_id: 'pj1', work_date: '2026-09-10', quantity: 3, kind: 'work',
    })));
  });

  it('AC-EQU-017 Cancel closes the add form without adding a row', async () => {
    h.entries = [];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add row' })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Loader 1/ })).toBeNull();
  });

  it('AC-EQU-017 with no machines registered the empty grid names the absence and leads to New asset', async () => {
    h.assets = [];
    h.entries = [];
    const user = userEvent.setup();
    renderPage('Admin');
    expect(screen.getByText('No machines registered')).toBeInTheDocument();
    expect(screen.queryByText('No equipment logged this week')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New asset' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-pathname', '/equipment/assets');
  });

  it('AC-EQU-017 with no machines an Engineer is told who registers them and gets no asset action', () => {
    h.assets = [];
    h.entries = [];
    renderPage('Engineer');
    expect(screen.getByText('No machines registered')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New asset' })).toBeNull();
    expect(screen.getByText('An Admin or Project Manager adds the machines.')).toBeInTheDocument();
  });

  it('AC-EQU-017 the grid is keyboard operable', async () => {
    h.entries = [entry({}), entry({ id: 'e3', project_id: 'pj2', work_date: '2026-09-09' })];
    const user = userEvent.setup();
    renderPage();
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(14);
    for (const input of inputs) expect(input).toHaveAccessibleName();
    // Tab walks row one's enabled day cells in order, then continues into row two
    const enabled = inputs.filter((i) => !(i as HTMLInputElement).disabled);
    enabled[0].focus();
    const visited: Element[] = [document.activeElement as Element];
    for (let i = 0; i < 12; i++) { await user.tab(); visited.push(document.activeElement as Element); }
    const order = visited.map((el) => enabled.indexOf(el as HTMLInputElement)).filter((n) => n >= 0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(enabled.indexOf(cell('2026-09-11') as HTMLInputElement)).toBeLessThan(enabled.indexOf(cell('2026-09-07', 'EQU P2') as HTMLInputElement));
    expect(visited).toContain(cell('2026-09-07', 'EQU P2'));
  });

  it('AC-EQU-017 the usage page has no axe violations', async () => {
    const { container } = renderPage();
    await act(async () => { await Promise.resolve(); });
    expect((await axe(container)).violations).toEqual([]);
  });
});
