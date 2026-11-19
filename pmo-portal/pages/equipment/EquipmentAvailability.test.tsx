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
  check: vi.fn(),
  assets: [] as unknown[],
}));
vi.mock('@/src/hooks/useEquipment', () => ({
  useEquipmentAssetPages: () => ({ data: { pages: [{ rows: h.assets, truncated: false }] }, isPending: false }),
}));
vi.mock('@/src/hooks/useEquipmentAvailability', () => ({
  useStatusDays: () => ({ data: [] }),
  useDowntimeFlags: () => ({ data: [] }),
  useEquipmentMetrics: () => ({ data: [] }),
  useSetStatusBulk: () => ({ mutateAsync: h.bulk, isPending: false }),
  useAttachProof: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRentalCheck: () => ({ mutateAsync: h.check, isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));

import EquipmentAvailabilityPage from './EquipmentAvailability';

const asset = (id: string, code: string, ownership = 'owned') => ({ id, code, name: `Machine ${code}`, default_unit: 'hours', ownership, archived_at: null });
const renderPage = () => render(<MemoryRouter><ToastProvider><EquipmentAvailabilityPage /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  h.role = 'Engineer';
  h.bulk = vi.fn().mockResolvedValue(2);
  h.check = vi.fn().mockResolvedValue(undefined);
  h.assets = [asset('a1', 'EQU-1'), asset('a2', 'EQU-2'), asset('a3', 'EQU-3', 'rented')];
});

describe('Equipment availability screen', () => {
  it('AC-EAV-013 a field controller sets several machines and saves only the ones they changed', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status of EQU-1' }), 'broken');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status of EQU-2' }), 'ready');
    await userEvent.click(screen.getByRole('button', { name: "Save today's status" }));
    await waitFor(() => expect(h.bulk).toHaveBeenCalledTimes(1));
    const arg = h.bulk.mock.calls[0][0] as { items: { asset_id: string; status: string }[] };
    expect(arg.items).toEqual([{ asset_id: 'a1', status: 'broken' }, { asset_id: 'a2', status: 'ready' }]);
  });

  it('AC-EAV-018 a field controller sees no rental invoice check', () => {
    renderPage();
    expect(screen.queryByText('Rental invoice check')).not.toBeInTheDocument();
  });

  it('AC-EAV-018 Finance sees the check for a rented machine but cannot set status', () => {
    h.role = 'Finance';
    renderPage();
    expect(screen.getByText('Rental invoice check')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Status of EQU-1' })).not.toBeInTheDocument();
  });
});
