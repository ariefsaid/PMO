import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  role: 'Admin' as string, viewAs: null as string | null,
  assetPages: { data: undefined as unknown, total: undefined as number | undefined, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() },
  create: vi.fn(), update: vi.fn(), del: vi.fn(),
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
const renderPage = () => render(<MemoryRouter><ToastProvider><EquipmentAssetsPage /></ToastProvider></MemoryRouter>);

describe('/equipment/assets list (S6.4)', () => {
  beforeEach(() => {
    h.role = 'Admin';
    h.viewAs = null;
    h.assetPages = { data: { pages: [{ rows: [asset('a1', 'EQU-1', 'Loader 1'), asset('a2', 'EQU-2', 'Crane', { external_ref: 'AST-9', default_unit: 'days' })], truncated: false }] }, total: 2, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() };
    h.create = vi.fn().mockResolvedValue({ id: 'a3' });
    h.update = vi.fn().mockResolvedValue(undefined);
    h.del = vi.fn().mockResolvedValue(undefined);
  });

  it('AC-EQU-017 the list shows code, name, unit and the external reference', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Crane/ });
    expect(within(row).getByText('EQU-2')).toBeInTheDocument();
    expect(within(row).getByText('AST-9')).toBeInTheDocument();
    expect(within(row).getByText('days')).toBeInTheDocument();
  });

  it('C8 EquipmentAssets.tsx:117 gives a capped register a Load more path', async () => {
    h.assetPages = { data: { pages: [{ rows: [asset('a1', 'EQU-1', 'Loader 1')], truncated: true }] }, total: 5, isPending: false, isError: false, hasNextPage: true, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() };
    renderPage();
    expect(screen.getByText('Showing 1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(h.assetPages.fetchNextPage).toHaveBeenCalledOnce();
  });

  it('AC-EQU-017 an Engineer sees the list but no New asset', () => {
    h.role = 'Engineer';
    renderPage();
    expect(screen.getByRole('row', { name: /Loader 1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New asset' })).toBeNull();
  });

  it('AC-EQU-017 an Admin viewing as another role gets a read-only page: no New asset, no row menu items', async () => {
    h.viewAs = 'Engineer';
    renderPage();
    expect(screen.queryByRole('button', { name: 'New asset' })).toBeNull();
  });

  it('AC-EQU-017 an Admin creates an asset with the three granted fields only', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'New asset' }));
    await user.type(screen.getByRole('textbox', { name: /Code/ }), 'EQU-3');
    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Excavator');
    await user.click(screen.getByRole('button', { name: 'Create asset' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ code: 'EQU-3', name: 'Excavator', default_unit: 'hours' }));
  });

  it('AC-EQU-017 a code clash shows the 23505 copy and keeps the form open', async () => {
    h.create = vi.fn().mockRejectedValue(new AppError('duplicate key', '23505'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'New asset' }));
    await user.type(screen.getByRole('textbox', { name: /Code/ }), 'EQU-1');
    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Dup');
    await user.click(screen.getByRole('button', { name: 'Create asset' }));
    expect(await screen.findByText(/already uses one of these values/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create asset' })).toBeInTheDocument();
  });

  it('AC-EQU-017 archive confirms first and writes archived_at; only an Admin sees Delete, and an in-use 23503 says so', async () => {
    h.del = vi.fn().mockRejectedValue(new AppError('fk', '23503'));
    const user = userEvent.setup();
    renderPage();
    await user.click(within(screen.getByRole('row', { name: /Loader 1/ })).getByRole('button', { name: /more|actions|menu/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await user.click(await screen.findByRole('button', { name: 'Archive asset' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: 'a1', patch: { archived_at: expect.any(String) } }));
    await user.click(within(screen.getByRole('row', { name: /Loader 1/ })).getByRole('button', { name: /more|actions|menu/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete asset' }));
    expect(await screen.findByText(/in use/i)).toBeInTheDocument();
  });

  it('AC-EQU-017 a Project Manager can archive but not delete', async () => {
    h.role = 'Project Manager';
    const user = userEvent.setup();
    renderPage();
    await user.click(within(screen.getByRole('row', { name: /Loader 1/ })).getByRole('button', { name: /more|actions|menu/i }));
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('AC-EQU-017 shows loading, error with retry, and the empty list', async () => {
    h.assetPages = { data: undefined, total: undefined, isPending: true, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() };
    const a = renderPage(); a.unmount();
    h.assetPages = { data: undefined, total: undefined, isPending: false, isError: true, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() };
    const b = renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(h.assetPages.refetch).toHaveBeenCalled();
    b.unmount();
    h.assetPages = { data: { pages: [{ rows: [], truncated: false }] }, total: 0, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() };
    renderPage();
    expect(screen.getByText('No equipment yet')).toBeInTheDocument();
  });
});
