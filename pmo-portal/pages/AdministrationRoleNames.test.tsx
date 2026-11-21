/** AC-TX-008 (#2712): Administration › Terminology › Role names. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const permissions = vi.hoisted(() => ({ write: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => permissions.write }));
const save = vi.fn().mockResolvedValue(undefined);
const reset = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/lib/db/orgRoleNames', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/db/orgRoleNames')>()),
  listOrgRoleNames: vi.fn().mockResolvedValue({ en: { storekeeper: 'Yard Lead' } }),
  saveOrgRoleName: (...a: unknown[]) => save(...a),
  resetOrgRoleName: (...a: unknown[]) => reset(...a),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1' } }) }));

import AdministrationRoleNames from './AdministrationRoleNames';

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><AdministrationRoleNames /></ToastProvider>
    </QueryClientProvider>,
  );

describe('AC-TX-008 role names screen', () => {
  beforeEach(() => { vi.clearAllMocks(); permissions.write = true; });
  it('lists all 28 roles with both languages', async () => {
    wrap();
    await screen.findByTestId('role-name-card-storekeeper');
    expect(screen.getAllByTestId(/^role-name-card-/)).toHaveLength(28);
    expect(screen.getAllByTestId(/^role-name-row-/)).toHaveLength(56);
  });
  it('shows an override, saves an edit with key, language and name', async () => {
    wrap();
    const row = await screen.findByTestId('role-name-row-storekeeper-en');
    const input = row.querySelector('input') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('Yard Lead'));
    await userEvent.clear(input);
    await userEvent.type(input, 'Yard Chief');
    await userEvent.click(row.querySelectorAll('button')[0]);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ roleKey: 'storekeeper', locale: 'en', name: 'Yard Chief' }));
  });
  it('resets one row; a row without an override cannot be reset', async () => {
    wrap();
    const row = await screen.findByTestId('role-name-row-storekeeper-en');
    await waitFor(() => expect((row.querySelector('input') as HTMLInputElement).value).toBe('Yard Lead'));
    await userEvent.click(row.querySelectorAll('button')[1]);
    await waitFor(() => expect(reset).toHaveBeenCalledWith('storekeeper', 'en'));
    const plain = screen.getByTestId('role-name-row-buyer-en');
    expect((plain.querySelectorAll('button')[1] as HTMLButtonElement).disabled).toBe(true);
  });
  it('blocks a name over 60 characters (input is length-bounded)', async () => {
    wrap();
    const row = await screen.findByTestId('role-name-row-buyer-id');
    expect((row.querySelector('input') as HTMLInputElement).maxLength).toBe(60);
  });
  it('gives a read-only viewer no controls', async () => {
    permissions.write = false;
    wrap();
    const row = await screen.findByTestId('role-name-row-buyer-en');
    expect(row.querySelectorAll('button')).toHaveLength(0);
    expect((row.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });
});
