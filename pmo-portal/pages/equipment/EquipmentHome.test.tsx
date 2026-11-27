/** AC-EQM-001/004/006 (unit layer): /equipment opens on the machines with today's status, the hours log is one tap away, the
 *  monthly plan is one tap away for the roles that plan, and a status is saved with its note and photo in one step. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Project Manager' as string,
  planFeature: true,
  planEnabled: true,
  bulk: vi.fn(),
  proof: vi.fn(),
  statusRows: [] as { asset_id: string; status_date: string; status: string }[],
}));
vi.mock('@/src/hooks/useEquipment', () => ({
  useEquipmentAssetPages: () => ({
    data: { pages: [{ rows: [{ id: 'a1', code: 'EX-1', name: 'Excavator', default_unit: 'hours', ownership: 'owned', archived_at: null }, { id: 'a2', code: 'CR-2', name: 'Crane', default_unit: 'hours', ownership: 'rented', archived_at: null }], truncated: false }] },
    isPending: false, isError: false, refetch: vi.fn(), hasNextPage: false, total: 2,
  }),
  useCreateAsset: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateRentedAsset: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAsset: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanyOptions: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-09-11' }));
vi.mock('@/src/hooks/useResolvedLocale', () => ({ useOrgBusinessTimezone: () => 'UTC' }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => h.planFeature }));
vi.mock('@/src/hooks/useEquipmentPlans', () => ({ useEquipmentPlanSettings: () => ({ data: { enabled: h.planEnabled } }) }));
vi.mock('@/src/hooks/useEquipmentAvailability', () => ({
  useStatusDays: () => ({ data: h.statusRows, isError: false }),
  useLatestStatusDays: () => ({ data: [] }),
  useEquipmentProofs: () => ({ data: [], isFetching: false, isError: false }),
  useDowntimeFlags: () => ({ data: [] }),
  useSetStatusBulk: () => ({ mutateAsync: h.bulk, isPending: false }),
  useAttachProof: () => ({ mutateAsync: h.proof, isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));
vi.mock('./EquipmentUsage', () => ({ default: () => <div>Hours log page</div> }));

import EquipmentHome from './EquipmentHome';

const renderAt = (url = '/equipment') => render(<MemoryRouter initialEntries={[url]}><ToastProvider><EquipmentHome /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  h.role = 'Project Manager'; h.planFeature = true; h.planEnabled = true;
  h.bulk = vi.fn().mockResolvedValue(1); h.proof = vi.fn().mockResolvedValue(undefined);
  h.statusRows = [{ asset_id: 'a1', status_date: '2026-09-11', status: 'ready' }];
});

describe('Equipment home', () => {
  it('AC-EQM-001 opens on the machines, each with today\'s status, not on the weekly hours log', () => {
    renderAt();
    expect(screen.getByRole('link', { name: 'EX-1' })).toBeInTheDocument();
    expect(screen.getByTestId('today-status-EX-1')).toHaveTextContent('Ready');
    expect(screen.getByText('Not recorded')).toBeInTheDocument(); // CR-2 has no status today
    expect(screen.queryByText('Hours log page')).not.toBeInTheDocument();
  });

  it('AC-EQM-001 the hours log is one tap away, and its own deep links still open it', async () => {
    const first = renderAt();
    expect(screen.getByRole('link', { name: 'Hours log' })).toHaveAttribute('href', '/equipment?view=hours');
    first.unmount();
    renderAt('/equipment?view=hours');
    expect(screen.getByText('Hours log page')).toBeInTheDocument();
    renderAt('/equipment?tab=approvals&week=2026-09-07');
    expect(screen.getAllByText('Hours log page').length).toBe(2);
  });

  it('AC-EQM-001 availability and expiring documents are one tap away too', () => {
    renderAt();
    expect(screen.getByRole('link', { name: 'Availability' })).toHaveAttribute('href', '/equipment/availability');
    expect(screen.getByRole('link', { name: 'Expiring documents' })).toHaveAttribute('href', '/equipment/expiring');
  });

  it('AC-EQM-002 the equipment manager gets New equipment; a field controller does not', () => {
    const first = renderAt();
    expect(screen.getByRole('button', { name: 'New equipment' })).toBeInTheDocument();
    first.unmount();
    h.role = 'Engineer';
    renderAt();
    expect(screen.queryByRole('button', { name: 'New equipment' })).not.toBeInTheDocument();
  });

  it('AC-EQM-006 with the plan on, the monthly equipment plan is one tap away', () => {
    renderAt();
    expect(screen.getByRole('link', { name: 'Monthly equipment plan' })).toHaveAttribute('href', '/equipment-plans');
  });

  it('AC-EQM-006 with the plan off, only an Admin is shown where to turn it on, named for it', () => {
    h.planEnabled = false; h.role = 'Admin';
    const admin = renderAt();
    expect(screen.queryByRole('link', { name: 'Monthly equipment plan' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on the monthly equipment plan' })).toHaveAttribute('href', '/equipment-plans/settings');
    admin.unmount();
    h.role = 'Project Manager';
    renderAt();
    expect(screen.queryByRole('link', { name: 'Turn on the monthly equipment plan' })).not.toBeInTheDocument();
  });

  it('AC-EQM-006 without the module the plan link is not offered', () => {
    h.planFeature = false;
    renderAt();
    expect(screen.queryByRole('link', { name: 'Monthly equipment plan' })).not.toBeInTheDocument();
  });

  it('AC-EQM-004 broken + note + photo are saved in one step, and the page says who is told', async () => {
    renderAt();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status of EX-1' }), 'broken');
    await userEvent.type(screen.getByLabelText('Note for EX-1'), 'hydraulic leak');
    const photo = new File(['x'], 'leak.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText('Photo for EX-1');
    expect(input).toHaveAttribute('capture', 'environment'); // camera first on a phone
    await userEvent.upload(input, photo);
    await userEvent.click(screen.getByRole('button', { name: 'Save statuses' }));
    await waitFor(() => expect(h.bulk).toHaveBeenCalledWith({ date: '2026-09-11', items: [{ asset_id: 'a1', status: 'broken', note: 'hydraulic leak' }] }));
    await waitFor(() => expect(h.proof).toHaveBeenCalledWith({ assetId: 'a1', date: '2026-09-11', file: photo, note: 'hydraulic leak' }));
    const told = await screen.findByText(/Marked broken: EX-1\./);
    expect(told).toHaveTextContent('Admin and Project Manager users are told if it stays down more than 2 days');
  });

  it('AC-EQM-009 each status shows one line saying what it does to planning while it is being chosen', async () => {
    renderAt();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status of CR-2' }), 'waiting_parts');
    const row = screen.getByRole('combobox', { name: 'Status of CR-2' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('Not available until the parts arrive. Counts as downtime.')).toBeInTheDocument();
  });

  it('AC-EQM-004 a photo that fails to upload does not undo the saved status and says so', async () => {
    h.proof = vi.fn().mockRejectedValue(new Error('too big'));
    renderAt();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status of CR-2' }), 'at_vendor');
    await userEvent.upload(screen.getByLabelText('Photo for CR-2'), new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save statuses' }));
    expect(await screen.findByText(/Status saved, but the photo for CR-2 did not upload/)).toBeInTheDocument();
    expect(h.bulk).toHaveBeenCalled();
  });
});
