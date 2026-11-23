import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** AC-PAY-007 (screen): an Admin names who enters a second record and who decides; anyone else reads it, with the reason. */
const h = vi.hoisted(() => ({
  admin: true,
  roles: { secondRecordRoles: ['quantity_surveyor'], deciderRoles: [] as string[] },
  save: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.admin }));
vi.mock('@/src/lib/repositories/attendanceSecondRecords', () => ({
  attendanceSecondRecordRepository: { timeRoles: () => Promise.resolve(h.roles), saveTimeRoles: (r: unknown) => h.save(r) },
}));
vi.mock('@/src/hooks/useOrgRoleNames', () => ({ useBuiltInRoleName: () => (key: string) => (key === 'quantity_surveyor' ? 'Measurement lead' : key) }));
import { ToastProvider } from '@/src/components/ui';
import OrgAttendanceTimeRoles from './OrgAttendanceTimeRoles';

const view = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><OrgAttendanceTimeRoles /></ToastProvider></QueryClientProvider>);

describe('time record roles setting', () => {
  beforeEach(() => { h.admin = true; h.roles = { secondRecordRoles: ['quantity_surveyor'], deciderRoles: [] }; h.save.mockClear(); });

  it('shows the organisation\'s own name for a role and the saved choice', async () => {
    view();
    const enter = await screen.findByRole('group', { name: 'May enter a second record' });
    expect(within(enter).getByRole('checkbox', { name: 'Measurement lead', checked: true })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(1);
  });

  it('saves both lists through the Admin write', async () => {
    const user = userEvent.setup();
    view();
    await screen.findAllByRole('checkbox');
    const deciders = screen.getByRole('group', { name: 'Decides which hours stand' });
    await user.click(within(deciders).getByRole('checkbox', { name: 'project_control_manager' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ secondRecordRoles: ['quantity_surveyor'], deciderRoles: ['project_control_manager'] }));
  });

  it('is read-only for anyone but an Admin and says so', async () => {
    h.admin = false;
    view();
    await screen.findAllByRole('checkbox');
    expect(screen.getAllByRole('checkbox').every((c) => c.hasAttribute('disabled') || c.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  });
});
