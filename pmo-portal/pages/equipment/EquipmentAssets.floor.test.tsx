/**
 * Floor tests for the equipment assets register (floor-wave2).
 *
 * Three controls nothing drove end-to-end: activating a row (the asset record), the new-asset
 * form's Default unit select, and the dirty-guarded Cancel. Each asserts the OUTCOME — the route
 * that opens, the value the create call carries, the draft that survives. Harness mirrors
 * `pages/equipment/EquipmentAssets.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  viewAs: null as string | null,
  assetPages: { data: undefined as unknown, total: undefined as number | undefined, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() },
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/src/hooks/useEquipment', () => ({
  useEquipmentAssetPages: () => h.assetPages,
  useCreateAsset: () => ({ mutateAsync: h.create, isPending: false }),
  useUpdateAsset: () => ({ mutateAsync: h.update, isPending: false }),
  useDeleteAsset: () => ({ mutateAsync: h.del, isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: (h.viewAs ?? h.role) as Role }) }));

import EquipmentAssetsPage from './EquipmentAssets';

const asset = (id: string, code: string, name: string, over: Record<string, unknown> = {}) =>
  ({ id, code, name, default_unit: 'hours', external_ref: null, external_tier: null, archived_at: null, ...over });

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-pathname={location.pathname} />;
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/equipment/assets']}>
      <ToastProvider>
        <LocationProbe />
        <EquipmentAssetsPage />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  h.role = 'Admin';
  h.viewAs = null;
  h.assetPages = {
    data: { pages: [{ rows: [asset('a1', 'EQU-1', 'Loader 1'), asset('a2', 'EQU-2', 'Crane', { default_unit: 'days' })], truncated: false }] },
    total: 2, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(),
  };
  h.create = vi.fn().mockResolvedValue({ id: 'a3' });
  h.update = vi.fn().mockResolvedValue(undefined);
  h.del = vi.fn().mockResolvedValue(undefined);
});

describe('Equipment assets floor', () => {
  it('floor: activating a row opens that asset’s record', async () => {
    renderPage();
    await userEvent.click(screen.getByText('EQU-1'));
    expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/equipment/assets/a1');
  });

  it('floor: choosing days as the default unit creates the asset in days', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New asset' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Code/ }), 'EQU-3');
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'Excavator');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Default unit/ }), 'days');
    await userEvent.click(screen.getByRole('button', { name: 'Create asset' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ code: 'EQU-3', name: 'Excavator', default_unit: 'days' }));
  });

  it('floor: Cancel on a dirty new-asset form asks first, and Keep editing keeps the entries', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New asset' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Code/ }), 'EQU-4');

    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

    const confirm = await screen.findByRole('alertdialog', { name: /Discard your changes\?/ });
    expect(confirm).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /Code/ })).toHaveValue('EQU-4');
    expect(h.create).not.toHaveBeenCalled();
  });
});
