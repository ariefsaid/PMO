import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/** fix/walk-people item 10: "Send this report every …" on the report itself, for the Admin only, with the report fixed. */
const sched = vi.hoisted(() => ({ recipientOptions: vi.fn(), save: vi.fn() }));
vi.mock('@/src/lib/repositories/scheduledReports', () => ({ scheduledReportsRepository: sched }));
import { ScheduleThisReport } from './ScheduleThisReport';

const mount = (role: 'Admin' | 'Finance') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ImpersonationProvider realRole={role}><ToastProvider><ScheduleThisReport kind="daily_progress" /></ToastProvider></ImpersonationProvider>
  </QueryClientProvider>,
);

describe('ScheduleThisReport', () => {
  beforeEach(() => { sched.recipientOptions.mockReset().mockResolvedValue([{ id: 'u1', name: 'Sari' }]); sched.save.mockReset().mockResolvedValue('r1'); });

  it('is not shown to anyone but an Admin', () => {
    mount('Finance');
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
});
