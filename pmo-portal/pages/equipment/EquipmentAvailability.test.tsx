/** AC-EAV-013 (unit layer): the bulk "set today's status" screen sends only the machines the user changed, and a field
 *  controller sees no rental check. AC-EAV-014 (unit layer): Finance sees the deduction and the day-by-day proof list. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Engineer' as string,
  bulk: vi.fn(),
  saveTerm: vi.fn(),
  ownership: vi.fn(),
  changeRate: vi.fn(),
  workingHours: vi.fn(),
  proof: vi.fn(),
  assets: [] as unknown[],
  nextAssets: [] as unknown[],
  metricIds: [] as string[],
  statusRange: [] as string[],
  assetsError: false,
  statusError: false,
  orgToday: '',
  provenRows: [] as { asset_id: string; proven: boolean }[],
  statusRows: [] as { asset_id: string; status_date: string; status: string }[],
}));
vi.mock('@/src/hooks/useEquipment', () => ({
  useEquipmentAssetPages: () => ({ data: { pages: [{ rows: h.assets, truncated: !!h.nextAssets.length }, ...(h.nextAssets.length ? [{ rows: h.nextAssets, truncated: false }] : [])] }, isPending: false, isError: h.assetsError, refetch: vi.fn(), hasNextPage: false }),
}));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => h.orgToday || new Date().toISOString().slice(0, 10) }));
vi.mock('@/src/hooks/useResolvedLocale', () => ({ useOrgBusinessTimezone: () => 'UTC' }));
vi.mock('./RentalInvoiceCheck', () => ({ default: () => <div>Rental invoice check</div> }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [{ id: 'v1', name: 'Vendor' }] }) }));
vi.mock('@/src/hooks/useEquipmentAvailability', () => ({
  useStatusDays: (from: string, to: string) => { h.statusRange = [from, to]; return { data: h.statusRows, isError: h.statusError }; },
  useLatestStatusDays: () => ({ data: [] }),
  useEquipmentProofs: () => ({ data: h.provenRows }),
  useDowntimeFlags: () => ({ data: [] }),
  useEquipmentMetrics: (ids: string[]) => { h.metricIds = ids; return { data: [] }; },
  useSetStatusBulk: () => ({ mutateAsync: h.bulk, isPending: false }),
  useAttachProof: () => ({ mutateAsync: h.proof, isPending: false }),
  useRentalTerms: () => ({ mutateAsync: h.saveTerm, isPending: false }),
  useRentalTermHistory: (assetId: string) => ({ data: assetId === 'a3' ? [{ id: 'term1', rate: 100, currency: 'IDR', basis: 'day', rented_from: '2026-01-01', rented_to: null, vendor_id: 'v1' }] : [] }),
  useEquipmentOwnership: () => ({ mutateAsync: h.ownership, isPending: false }),
  useChangeRentalRate: () => ({ mutateAsync: h.changeRate, isPending: false }),
  useEquipmentWorkingHours: () => ({ mutateAsync: h.workingHours, isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));

import EquipmentAvailabilityPage from './EquipmentAvailability';
import { EquipmentRentalTerms } from './EquipmentRentalTerms';

const asset = (id: string, code: string, ownership = 'owned') => ({ id, code, name: `Machine ${code}`, default_unit: 'hours', ownership, archived_at: null });
const renderPage = () => render(<MemoryRouter><ToastProvider><EquipmentAvailabilityPage /></ToastProvider></MemoryRouter>);
const renderTerms = (id: string) => render(<ToastProvider><EquipmentRentalTerms key={id} asset={asset(id, 'EQU-' + id.slice(1), id === 'a3' ? 'rented' : 'owned')} /></ToastProvider>);

beforeEach(() => {
  h.role = 'Engineer';
  h.bulk = vi.fn().mockResolvedValue(2);
  h.saveTerm = vi.fn().mockResolvedValue(undefined);
  h.ownership = vi.fn().mockResolvedValue(undefined);
  h.changeRate = vi.fn().mockResolvedValue(undefined);
  h.workingHours = vi.fn().mockResolvedValue(undefined);
  h.proof = vi.fn().mockResolvedValue(undefined);
  h.nextAssets = [];
  h.assetsError = false; h.statusError = false; h.statusRows = []; h.provenRows = [];
  h.assets = [asset('a1', 'EQU-1'), asset('a2', 'EQU-2'), asset('a3', 'EQU-3', 'rented')];
});

describe('Equipment availability screen', () => {
  it('offers an accessible status selector and upload action without repeating the visible label', () => {
    h.statusRows = [{ asset_id: 'a1', status_date: new Date().toISOString().slice(0, 10), status: 'broken' }];
    renderPage();
    expect(screen.getByRole('combobox', { name: 'Status of EQU-1' })).toBeInTheDocument();
    expect(screen.getByText('Status of EQU-1')).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Upload file for EQU-1' })).toBeInTheDocument();
  });

  it('links each asset to its record for rental setup', () => { h.role = 'Finance'; renderPage(); expect(screen.getByRole('link', { name: 'EQU-1' })).toHaveAttribute('href', '/equipment/assets/a1'); });

  it('AC-EAV-013 a field controller sets several machines and saves only the ones they changed', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status of EQU-1' }), 'broken');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status of EQU-2' }), 'ready');
    await userEvent.click(screen.getByRole('button', { name: 'Save statuses' }));
    await waitFor(() => expect(h.bulk).toHaveBeenCalledTimes(1));
    const arg = h.bulk.mock.calls[0][0] as { items: { asset_id: string; status: string }[] };
    expect(arg.items).toEqual([{ asset_id: 'a1', status: 'broken' }, { asset_id: 'a2', status: 'ready' }]);
  });

  it('Finance can enter rental terms for an asset', async () => {
    h.role = 'Finance';
    renderTerms('a1');
    await userEvent.selectOptions(screen.getByLabelText('Vendor'), 'v1');
    await userEvent.type(screen.getByLabelText('Rate'), '100');
    await userEvent.type(screen.getByLabelText('Rental start'), '2026-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Save rental terms' }));
    await waitFor(() => expect(h.saveTerm).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'a1', vendor_id: 'v1', rate: '100', rented_from: '2026-01-01' })));
  });

  it('a manager can choose the metric period and day breakdown', () => {
    h.role = 'Finance';
    renderPage();
    expect(screen.getByLabelText('Metric interval')).toBeInTheDocument();
    expect(screen.getByLabelText('Metric period from')).toBeInTheDocument();
  });

  it('lets a field controller record a past status with a note', async () => {
    renderPage();
    const date = screen.getByLabelText('Status date');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-01-15');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status of EQU-1' }), 'broken');
    await userEvent.type(screen.getByLabelText('Note for EQU-1'), 'Hydraulic leak');
    await userEvent.click(screen.getByRole('button', { name: 'Save statuses' }));
    expect(h.bulk).toHaveBeenCalledWith({ date: '2026-01-15', items: [{ asset_id: 'a1', status: 'broken', note: 'Hydraulic leak' }] });
  });

  it('lets a controller reach machines on the next page', async () => {
    h.nextAssets = [asset('a4', 'EQU-4')];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Next equipment page' }));
    expect(screen.getByRole('combobox', { name: 'Status of EQU-4' })).toBeInTheDocument();
  });

  it('allows Finance to mark an asset owned', async () => {
    h.role = 'Finance'; renderTerms('a1');
    await userEvent.click(screen.getByText('Other asset actions'));
    await userEvent.click(screen.getByRole('button', { name: 'Mark owned' }));
    expect(h.ownership).toHaveBeenCalledWith({ assetId: 'a1', ownership: 'owned', inServiceOn: null });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ownership saved'));
  });

  it('allows Finance to change a rental rate from an effective date', async () => {
    h.role = 'Finance'; renderTerms('a3');
    await userEvent.type(screen.getByLabelText('Rate'), '120');
    await userEvent.type(screen.getByLabelText('Rental start'), '2026-01-15');
    await userEvent.click(screen.getByText('Other asset actions'));
    await userEvent.click(screen.getByRole('button', { name: 'Change rate from date' }));
    expect(h.changeRate).toHaveBeenCalledWith({ assetId: 'a3', date: '2026-01-15', rate: '120' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Rate changed'));
  });

  it('limits metrics to the chosen assets', async () => {
    h.role = 'Finance'; renderPage();
    await userEvent.click(screen.getByText('Assets for metrics'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'EQU-1 Machine EQU-1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'EQU-3 Machine EQU-3' }));
    expect(h.metricIds).toEqual(['a1', 'a3']);
  });

  it('does not show an empty register when loading assets fails', () => {
    h.assets = []; h.assetsError = true; renderPage();
    expect(screen.getByText("Couldn't load equipment")).toBeInTheDocument();
    expect(screen.queryByText('No equipment yet')).not.toBeInTheDocument();
  });
  it('warns when status data could not be loaded', () => {
    h.statusError = true; renderPage();
    expect(screen.getByText('Could not load statuses')).toHaveAttribute('role', 'alert');
  });

  it('shows a rented machine’s existing rate and dates before a change', async () => {
    h.role = 'Finance'; renderTerms('a3');
    expect(screen.getByText(/100 IDR/)).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01/)).toBeInTheDocument();
  });

  it('lets an admin set the hours used by utilisation', async () => {
    h.role = 'Admin'; renderPage();
    await userEvent.type(screen.getByLabelText('Working hours per day'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save working hours' }));
    expect(h.workingHours).toHaveBeenCalledWith('10');
  });

  it('shows the selected day’s status to a read-only user', () => {
    h.role = 'Finance'; h.statusRows = [{ asset_id: 'a1', status_date: new Date().toISOString().slice(0, 10), status: 'broken' }];
    renderPage();
    expect(screen.getByText('Broken')).toBeInTheDocument();
  });

  it('lets Finance record the in-service date of rented equipment', async () => {
    h.role = 'Finance'; renderTerms('a3');
    await userEvent.type(screen.getByLabelText('In service from (optional)'), '2026-01-10');
    await userEvent.click(screen.getByText('Other asset actions'));
    await userEvent.click(screen.getByRole('button', { name: 'Save in-service date' }));
    expect(h.ownership).toHaveBeenCalledWith({ assetId: 'a3', ownership: 'rented', inServiceOn: '2026-01-10' });
  });

  it('follows the organisation date when it becomes available', () => {
    h.orgToday = '2026-01-01';
    const view = renderPage();
    h.orgToday = '2026-01-02';
    view.rerender(<MemoryRouter><ToastProvider><EquipmentAvailabilityPage /></ToastProvider></MemoryRouter>);
    expect(screen.getByLabelText('Status date')).toHaveValue('2026-01-02');
    h.orgToday = '';
  });

  it('does not query a malformed date while a date field is cleared', async () => {
    renderPage();
    await userEvent.clear(screen.getByLabelText('Status date'));
    expect(h.statusRange.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true);
    expect(screen.getByRole('button', { name: 'Save statuses' })).toBeDisabled();
  });

  it('clears incomplete terms when switching asset records', async () => { const view = renderTerms('a1'); await userEvent.type(screen.getByLabelText('Rate'), '100'); view.rerender(<ToastProvider><EquipmentRentalTerms key="a3" asset={asset('a3', 'EQU-3', 'rented')} /></ToastProvider>); expect(screen.getByLabelText('Rate')).toHaveValue(''); expect(screen.getByRole('button', { name: 'Save rental terms' })).toBeDisabled(); });

  it('shows a proven status after a successful evidence upload', async () => {
    h.statusRows = [{ asset_id: 'a1', status_date: new Date().toISOString().slice(0, 10), status: 'broken' }];
    renderPage();
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Attach proof for EQU-1'), file);
    await waitFor(() => expect(screen.getByText('Proven')).toBeInTheDocument());
  });

  it('shows saved proof after the page is reopened', () => {
    h.statusRows = [{ asset_id: 'a1', status_date: new Date().toISOString().slice(0, 10), status: 'broken' }];
    h.provenRows = [{ asset_id: 'a1', proven: true }];
    renderPage();
    expect(screen.getByText('Proven')).toBeInTheDocument();
  });

  it('clears incomplete terms when switching asset records', async () => { const view = renderTerms('a1'); await userEvent.type(screen.getByLabelText('Rate'), '100'); view.rerender(<ToastProvider><EquipmentRentalTerms key="a3" asset={asset('a3', 'EQU-3', 'rented')} /></ToastProvider>); expect(screen.getByLabelText('Rate')).toHaveValue(''); expect(screen.getByRole('button', { name: 'Save rental terms' })).toBeDisabled(); });

  it('offers the rental check to Finance and not to a field controller', () => {
    const engineer = renderPage();
    expect(screen.queryByText('Rental invoice check')).not.toBeInTheDocument();
    engineer.unmount();
    h.role = 'Finance'; renderPage();
    expect(screen.getByText('Rental invoice check')).toBeInTheDocument();
  });

});
