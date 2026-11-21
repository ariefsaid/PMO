import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import NonWorkingDatesCard from './NonWorkingDatesCard';

const s = vi.hoisted(() => ({ canManage: true, enabled: true, add: vi.fn(), remove: vi.fn(), list: [] as { date: string; label: string | null }[] }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => s.canManage }));
vi.mock('@/src/components/ui', async () => ({ ...(await vi.importActual<object>('@/src/components/ui')), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/src/hooks/useWorkOrderRevenuePlan', () => ({ useRevenuePlanSettings: () => ({ data: { enabled: s.enabled, workingWeekdays: [1, 2, 3, 4, 5] } }) }));
vi.mock('@/src/hooks/useWorkOrderDailyTarget', () => ({
  useNonWorkingDates: () => ({ data: s.list, isPending: false, isError: false, refetch: vi.fn() }),
  useNonWorkingDateMutations: () => ({ add: { mutateAsync: s.add, isPending: false }, remove: { mutateAsync: s.remove, isPending: false } }),
}));
beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  s.canManage = true; s.enabled = true; s.list = [];
  s.add.mockReset().mockResolvedValue(undefined); s.remove.mockReset().mockResolvedValue(undefined);
});

describe('NonWorkingDatesCard (#2672)', () => {
  it('AC-WDT-001 renders nothing while the revenue plan is off, and for a role that cannot manage it', () => {
    s.enabled = false;
    expect(render(<NonWorkingDatesCard />).container.firstChild).toBeNull();
  });
  it('renders nothing for a non-Admin role', () => {
    s.canManage = false;
    expect(render(<NonWorkingDatesCard />).container.firstChild).toBeNull();
  });
  it('shows an empty state when the list is empty (the default)', () => {
    render(<NonWorkingDatesCard />);
    expect(screen.getByTestId('nwd-empty')).toBeTruthy();
  });
  it('lists existing dates with their labels', () => {
    s.list = [{ date: '2026-12-25', label: 'Holiday' }];
    render(<NonWorkingDatesCard />);
    expect(screen.getByTestId('nwd-2026-12-25').textContent).toContain('Holiday');
  });
  it('asks for a date before adding', async () => {
    render(<NonWorkingDatesCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Add date' }));
    expect(screen.getByText('Enter a date.')).toBeTruthy();
    expect(s.add).not.toHaveBeenCalled();
  });
  it('adds a date with a label', async () => {
    render(<NonWorkingDatesCard />);
    await userEvent.type(screen.getByLabelText('Date'), '2026-12-25');
    await userEvent.type(screen.getByLabelText('Label (optional)'), 'Holiday');
    await userEvent.click(screen.getByRole('button', { name: 'Add date' }));
    await waitFor(() => expect(s.add).toHaveBeenCalledWith({ date: '2026-12-25', label: 'Holiday' }));
  });
  it('confirms before removing a date', async () => {
    s.list = [{ date: '2026-12-25', label: null }];
    render(<NonWorkingDatesCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(s.remove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.getByRole('dialog'));
    await userEvent.click(dialog.querySelector('button:last-of-type') as HTMLElement);
    await waitFor(() => expect(s.remove).toHaveBeenCalledWith({ date: '2026-12-25' }));
  });
});
