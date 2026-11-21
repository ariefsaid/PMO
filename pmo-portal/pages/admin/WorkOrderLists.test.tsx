import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

/** #2668 AC-WAG-009: an Admin adds, renames and archives the organisation's work-order areas and groups. */
const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  rows: { area: [{ id: 'a1', code: 'N1', name: 'North', archived_at: null }, { id: 'a2', code: 'OLD', name: 'Retired', archived_at: '2026-01-01' }], group: [] } as Record<string, Array<{ id: string; code: string; name: string; archived_at: string | null }>>,
  create: vi.fn(), update: vi.fn(), archive: vi.fn(),
}));
vi.mock('@/src/hooks/useWorkOrderLists', () => ({
  WORK_ORDER_LISTS_KEY: 'work-order-lists',
  useWorkOrderListEntries: (kind: string) => ({ data: h.rows[kind], isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/lib/repositories/workOrderLists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/repositories/workOrderLists')>()),
  workOrderListRepository: { create: h.create, update: h.update, archive: h.archive },
}));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role } as never) };
});
import WorkOrderLists from './WorkOrderLists';

const setup = () => {
  render(<QueryClientProvider client={new QueryClient()}><ToastProvider><WorkOrderLists /></ToastProvider></QueryClientProvider>);
  return userEvent.setup();
};

beforeEach(() => {
  h.role = 'Admin';
  h.create.mockReset().mockResolvedValue(undefined); h.update.mockReset().mockResolvedValue(undefined); h.archive.mockReset().mockResolvedValue(undefined);
});

describe('AC-WAG-009 work-order area and group lists', () => {
  it('lists live entries only, one section per list', () => {
    setup();
    const areas = screen.getByRole('region', { name: 'Work order areas' });
    expect(within(areas).getByText('North')).toBeVisible();
    expect(within(areas).queryByText('Retired')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Work order groups' })).getByText('None yet')).toBeVisible();
  });

  it('an Admin adds a group with a trimmed code and name', async () => {
    const user = setup();
    await user.click(within(screen.getByRole('region', { name: 'Work order groups' })).getByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Code/), ' G1 ');
    await user.type(within(dialog).getByLabelText(/Name/), ' Operations ');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith('group', { code: 'G1', name: 'Operations' }));
  });

  it('an Admin renames an area', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Edit North' }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText(/Name/);
    await user.clear(name); await user.type(name, 'North block');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('area', 'a1', { code: 'N1', name: 'North block' }));
  });

  it('an Admin archives an area after confirming', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Archive North' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(h.archive).toHaveBeenCalledWith('area', 'a1'));
  });

  it('a non-Admin has no write controls', () => {
    h.role = 'Project Manager';
    setup();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit North' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive North' })).not.toBeInTheDocument();
  });
});
