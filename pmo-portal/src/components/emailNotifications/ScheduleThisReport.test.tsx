import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type Role } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/** fix/walk-people item 10: "Send this report every …" on the report itself, for Admin or enabled Project Control Manager. */
const sched = vi.hoisted(() => ({ recipientOptions: vi.fn(), save: vi.fn() }));
const switches = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/src/lib/repositories/scheduledReports', () => ({ scheduledReportsRepository: sched }));
vi.mock('@/src/lib/repositories/orgSwitches', () => ({ orgSwitchRepository: switches }));
import { ScheduleThisReport } from './ScheduleThisReport';

const mount = (role: Role, builtInRole: string | null = null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AuthContext.Provider value={{ currentUser: { id: 'u1', org_id: 'org-1', role, built_in_role: builtInRole } } as never}>
      <ImpersonationProvider realRole={role}><ToastProvider><ScheduleThisReport kind="daily_progress" /></ToastProvider></ImpersonationProvider>
    </AuthContext.Provider>
  </QueryClientProvider>,
);

describe('ScheduleThisReport', () => {
  beforeEach(() => {
    sched.recipientOptions.mockReset().mockResolvedValue([
      { id: 'u1', name: 'Sari', builtInRole: 'project_manager' },
      { id: 'u2', name: 'Budi', builtInRole: 'foreman' },
    ]);
    sched.save.mockReset().mockResolvedValue('r1');
    switches.read.mockReset().mockResolvedValue(true);
  });

  it('is hidden from Finance and plain Project Manager, and hidden from PCM when the org switch is off', async () => {
    mount('Finance');
    expect(screen.queryByRole('button', { name: /Send this report every/ })).toBeNull();
    mount('Project Manager', 'project_manager');
    expect(screen.queryByRole('button', { name: /Send this report every/ })).toBeNull();
    switches.read.mockResolvedValue(false);
    mount('Project Manager', 'project_control_manager');
    await waitFor(() => expect(switches.read).toHaveBeenCalledWith('pcmScheduledReports'));
    expect(screen.queryByRole('button', { name: /Send this report every/ })).toBeNull();
  });

  it('an Admin picks who and when, and saves a daily-progress schedule without choosing the report', async () => {
    const user = userEvent.setup();
    mount('Admin');
    await user.click(screen.getByRole('button', { name: /Send this report every/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Report')).toBeNull();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Finance' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save report' }));
    expect(sched.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'daily_progress', frequency: 'daily', recipientRoles: ['Finance'] }));
  });

  it('an enabled Project Control Manager sees the button and only non-light recipients', async () => {
    const user = userEvent.setup();
    mount('Project Manager', 'project_control_manager');
    const trigger = await screen.findByRole('button', { name: /Send this report every/ });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
  });
});
