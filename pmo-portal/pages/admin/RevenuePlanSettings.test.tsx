import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import RevenuePlanSettings from './RevenuePlanSettings';

const s = vi.hoisted(() => ({ canManage: true, save: vi.fn(), data: { enabled: false, workingWeekdays: [1, 2, 3, 4, 5] } }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => s.canManage }));
vi.mock('@/src/components/ui', async () => ({ ...(await vi.importActual<object>('@/src/components/ui')), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/src/hooks/useWorkOrderRevenuePlan', () => ({
  useRevenuePlanSettings: () => ({ data: s.data, isError: false, refetch: vi.fn() }),
  useSetRevenuePlanSettings: () => ({ mutateAsync: s.save, isPending: false }),
}));
beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); s.canManage = true; s.save.mockReset().mockResolvedValue(undefined); });

describe('RevenuePlanSettings (#2671)', () => {
  it('AC-WRP-001 is off by default and saves the switch with the working weekdays', async () => {
    render(<RevenuePlanSettings />);
    const on = screen.getByRole('checkbox', { name: 'Use the revenue plan' });
    expect(on.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(on);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Saturday' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.save).toHaveBeenCalledWith({ enabled: true, weekdays: [1, 2, 3, 4, 5, 6] }));
  });
  it('renders nothing for a role that cannot manage it', () => {
    s.canManage = false;
    expect(render(<RevenuePlanSettings />).container.firstChild).toBeNull();
  });
});
