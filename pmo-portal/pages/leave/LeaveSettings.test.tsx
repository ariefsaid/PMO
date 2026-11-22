import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';
import { MemoryRouter } from 'react-router';
import { toast as sonnerToast } from 'sonner';
import { act } from '@testing-library/react';

/** #2708 `/leave?view=settings`: only an Admin gets in; the switch + approver role save, the leave-type
 * list (add/archive), and each refused write surfaced through the LV_ error mapper. */
const h = vi.hoisted(() => ({
  isAdmin: true,
  settings: { enabled: true, approver_role: 'Finance' } as { enabled: boolean; approver_role: string | null } | undefined,
  types: [{ id: 'lt1', name: 'Annual leave', archived_at: null }, { id: 'lt2', name: 'Sick leave', archived_at: null }] as { id: string; name: string; archived_at: string | null }[],
  save: { mutateAsync: vi.fn(), isPending: false },
  createType: { mutateAsync: vi.fn(), isPending: false },
  archiveType: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.isAdmin }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/hooks/useLeave', () => ({
  useLeaveSettings: () => ({ data: h.settings }),
  useLeaveTypes: () => ({ data: h.types }),
  useLeaveSettingsMutations: () => ({ save: h.save, createType: h.createType, archiveType: h.archiveType }),
}));

import LeaveSettingsPage from './LeaveSettings';

const view = () => render(<MemoryRouter><ToastProvider><LeaveSettingsPage /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  act(() => { sonnerToast.dismiss(); }); // Sonner's store replays still-active toasts into the next Toaster — clear them.
  h.isAdmin = true;
  h.settings = { enabled: true, approver_role: 'Finance' };
  h.types = [{ id: 'lt1', name: 'Annual leave', archived_at: null }, { id: 'lt2', name: 'Sick leave', archived_at: null }];
  h.save = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
  h.createType = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
  h.archiveType = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
});

describe('LeaveSettings', () => {
  it('a non-admin is told the page is admin-only', () => {
    h.isAdmin = false;
    view();
    expect(screen.getByText('Only an Admin can change leave settings')).toBeInTheDocument();
    expect(screen.queryByText('Leave types')).not.toBeInTheDocument();
  });

  it('an admin sees the approver role and no on/off switch (leave is on for everyone, #2746)', () => {
    view();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Who approves')).toHaveValue('Finance');
  });

  it('FR-TR-010 the approver choices show the localised access role names in Bahasa', () => {
    render(<MemoryRouter><ToastProvider><BahasaProvider><LeaveSettingsPage /></BahasaProvider></ToastProvider></MemoryRouter>);
    const select = screen.getByLabelText('Who approves');
    expect(screen.getByRole('option', { name: 'Keuangan' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Manajer proyek' })).toBeInTheDocument();
    // The stored access level stays the enum value, never the translated label.
    expect(select).toHaveValue('Finance');
    expect(screen.queryByRole('option', { name: 'Finance' })).not.toBeInTheDocument();
  });

  it('saving sends the whole settings record, with leave on', async () => {
    const user = userEvent.setup();
    view();
    await user.selectOptions(screen.getByLabelText('Who approves'), '');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith({ enabled: true, approver_role: null }));
    expect((await screen.findAllByText('Settings saved')).length).toBeGreaterThan(0);
  });

  it('a refused save surfaces the LV_ mapper sentence, not a generic failure', async () => {
    h.save.mutateAsync.mockRejectedValue({ code: 'P0001', message: 'LV_SOD: not yours' });
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('You cannot decide your own request, or one you entered. Someone else must.')).toBeInTheDocument();
  });

  it('lists the live leave types with archive actions, and archives one', async () => {
    const user = userEvent.setup();
    view();
    expect(screen.getByText('Annual leave')).toBeInTheDocument();
    expect(screen.queryByText('No leave types yet. Add the types your organisation uses.')).not.toBeInTheDocument();
    const row = screen.getByText('Sick leave').closest('li') as HTMLElement;
    await user.click(row.querySelector('button') as HTMLElement);
    await waitFor(() => expect(h.archiveType.mutateAsync).toHaveBeenCalledWith('lt2'));
  });

  it('adds a new leave type and clears the field', async () => {
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText('New type'), 'Pilgrimage');
    await user.click(screen.getByRole('button', { name: 'Add type' }));
    await waitFor(() => expect(h.createType.mutateAsync).toHaveBeenCalledWith('Pilgrimage'));
    await waitFor(() => expect(screen.getByLabelText('New type')).toHaveValue(''));
  });

  it('an empty type name cannot be added', () => {
    view();
    expect(screen.getByRole('button', { name: 'Add type' })).toBeDisabled();
  });

  it('no leave types yet says so', () => {
    h.types = [];
    view();
    expect(screen.getByText('No leave types yet. Add the types your organisation uses.')).toBeInTheDocument();
  });

  it('a refused type create surfaces the duplicate-type sentence', async () => {
    h.createType.mutateAsync.mockRejectedValue({ code: '23505', message: 'duplicate key' });
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText('New type'), 'Annual leave');
    await user.click(screen.getByRole('button', { name: 'Add type' }));
    expect(await screen.findByText('That leave type already exists.')).toBeInTheDocument();
  });
});
