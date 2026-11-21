import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Admin' as string, viewAs: null as string | null,
  settings: { data: { enabled: false, approver_role: 'Finance' as string | null } as { enabled: boolean; approver_role: string | null } | undefined },
  save: vi.fn(),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.viewAs ?? h.role }) }));
vi.mock('@/src/hooks/useLeave', () => ({
  useLeaveSettings: () => h.settings,
  useLeaveSettingsMutations: () => ({ save: { mutate: h.save, isPending: false } }),
}));

import LeaveRequestsSetting from './LeaveRequestsSetting';

const open = () => render(<MemoryRouter><ToastProvider><LeaveRequestsSetting /></ToastProvider></MemoryRouter>);

describe('leave requests switch in Administration (#2708)', () => {
  beforeEach(() => { h.role = 'Admin'; h.viewAs = null; h.settings = { data: { enabled: false, approver_role: 'Finance' } }; h.save.mockReset(); });

  it('an Admin switches leave requests on; the approver role already set is kept', async () => {
    open();
    await userEvent.click(screen.getByRole('switch', { name: /request leave/ }));
    expect(h.save).toHaveBeenCalledWith({ enabled: true, approver_role: 'Finance' }, expect.anything());
  });

  it('when on, it points to the rest of the leave settings', () => {
    h.settings = { data: { enabled: true, approver_role: null } };
    open();
    expect(screen.getByRole('link', { name: 'Open leave settings' })).toHaveAttribute('href', '/leave?view=settings');
  });

  it.each(['Executive', 'Finance', 'Project Manager', 'Engineer'])('%s sees nothing: the screen is unchanged for them', (role) => {
    h.role = role;
    open();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByLabelText('Leave requests')).toBeNull();
  });

  it('a view-as session sees no switch', () => {
    h.viewAs = 'Engineer';
    open();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('renders nothing until the setting has loaded', () => {
    h.settings = { data: undefined };
    open();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
