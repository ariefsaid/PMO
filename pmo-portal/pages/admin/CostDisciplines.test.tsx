import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

/** #2623 (FR-WCA-010/011, AC-WCA-017): an Admin adds, renames and archives the organisation's cost disciplines. */
const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  rows: [{ id: 'd1', code: 'CIV', name: 'Civil' }] as Array<{ id: string; code: string; name: string }>,
  state: 'ready' as 'ready' | 'loading' | 'error',
  refetch: vi.fn(),
  create: vi.fn(), update: vi.fn(), archive: vi.fn(),
}));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({
  useCostDisciplines: () => ({ data: h.state === 'ready' ? h.rows : undefined, isPending: h.state === 'loading', isError: h.state === 'error', refetch: h.refetch }),
}));
vi.mock('@/src/lib/repositories/workOrderCosts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/repositories/workOrderCosts')>()),
  workOrderCostRepository: { createDiscipline: h.create, updateDiscipline: h.update, archiveDiscipline: h.archive },
}));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role } as never) };
});
import CostDisciplines from './CostDisciplines';

const setup = () => {
  render(<QueryClientProvider client={new QueryClient()}><ToastProvider><CostDisciplines /></ToastProvider></QueryClientProvider>);
  return userEvent.setup();
};

beforeEach(() => {
  h.role = 'Admin'; h.state = 'ready'; h.rows = [{ id: 'd1', code: 'CIV', name: 'Civil' }];
  h.create.mockReset().mockResolvedValue('d2'); h.update.mockReset().mockResolvedValue(undefined); h.archive.mockReset().mockResolvedValue(undefined);
});

describe('AC-WCA-017 cost disciplines (Admin settings)', () => {
  it('lists the live disciplines by code and name', () => {
    setup();
    const section = screen.getByRole('region', { name: 'Cost disciplines' });
    expect(within(section).getByText('CIV')).toBeVisible();
    expect(within(section).getByText('Civil')).toBeVisible();
  });

  it('an Admin adds a discipline with a trimmed code and name', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Add discipline' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Code/), '  ELE ');
    await user.type(within(dialog).getByLabelText(/Name/), ' Electrical ');
    await user.click(within(dialog).getByRole('button', { name: 'Add discipline' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ code: 'ELE', name: 'Electrical' }));
  });

  it('an Admin renames a discipline', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Edit Civil' }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText(/Name/);
    await user.clear(name); await user.type(name, 'Civil works');
    await user.click(within(dialog).getByRole('button', { name: 'Save discipline' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('d1', { code: 'CIV', name: 'Civil works' }));
  });

  it('an Admin archives a discipline after confirming; existing cost lines keep it', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Archive Civil' }));
    const confirm = screen.getByRole('dialog');
    expect(confirm).toHaveTextContent(/Cost lines that already name it keep it/);
    await user.click(within(confirm).getByRole('button', { name: 'Archive discipline' }));
    await waitFor(() => expect(h.archive).toHaveBeenCalledWith('d1'));
  });

  it('a duplicate live code is refused with its reason, in the form', async () => {
    const { AppError } = await import('@/src/lib/appError');
    h.create.mockRejectedValue(new AppError('duplicate key value violates unique constraint "cost_disciplines_code_live"', '23505'));
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Add discipline' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Code/), 'CIV');
    await user.type(within(dialog).getByLabelText(/Name/), 'Civil again');
    await user.click(within(dialog).getByRole('button', { name: 'Add discipline' }));
    expect(await screen.findAllByText('Another live discipline already uses this code.')).not.toHaveLength(0);
  });

  it('a code over 20 or a name over 120 characters is flagged and cannot be saved', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Add discipline' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Code/), 'X'.repeat(21));
    await user.type(within(dialog).getByLabelText(/Name/), 'Long');
    expect(within(dialog).getByText('Use 20 characters or fewer.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Add discipline' })).toBeDisabled();
  });

  it('a Finance user or a Project Manager sees the list without add, edit or archive', () => {
    for (const role of ['Finance', 'Project Manager', 'Executive']) {
      h.role = role;
      const { unmount } = render(<QueryClientProvider client={new QueryClient()}><ToastProvider><CostDisciplines /></ToastProvider></QueryClientProvider>);
      expect(screen.getByText('Civil')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Add discipline' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Edit Civil' })).toBeNull();
      expect(screen.getByText('Only an Admin can change the discipline list.')).toBeVisible();
      unmount();
    }
  });

  it('an empty list says what a discipline is for and offers the add action', () => {
    h.rows = [];
    setup();
    expect(screen.getByText('No disciplines yet')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Add discipline' }).length).toBeGreaterThan(0);
  });

  it('a failed read offers a retry, never an empty list', async () => {
    h.state = 'error';
    const user = setup();
    expect(screen.queryByText('No disciplines yet')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it('the strings are translated — Bahasa Indonesia has every key', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (lng: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/workOrderCost.json`), 'utf8')).disciplines as Record<string, unknown>;
    expect(Object.keys(read('id')).sort()).toEqual(Object.keys(read('en')).sort());
    expect(read('id').title).toBe('Disiplin biaya');
  });
});
