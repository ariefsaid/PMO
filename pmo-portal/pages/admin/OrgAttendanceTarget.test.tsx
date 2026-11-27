import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/**
 * #2706 — the Admin's attendance target (AC-ATR-009). Off is a real choice and the default; only an Admin sees the
 * control (the database enforces it — organizations' Admin-only update policy plus 1436's column grant).
 */
const h = vi.hoisted(() => ({
  canManage: true,
  target: 75 as number | null,
  mutateAsync: vi.fn(),
}));

vi.mock('@/src/hooks/useAttendanceRate', () => ({
  useAttendanceTarget: () => ({ data: h.target, isSuccess: true, isError: false, refetch: vi.fn() }),
  useSetAttendanceTarget: () => ({ mutateAsync: h.mutateAsync, isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));

import OrgAttendanceTarget from './OrgAttendanceTarget';

const renderPanel = () => render(<ToastProvider><OrgAttendanceTarget /></ToastProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.target = 75;
  h.mutateAsync.mockResolvedValue(undefined);
});

describe('attendance target setting (#2706)', () => {
  it.each(['80.1', '0.29', '92.25'])('saves the valid target %s from the form', async (value) => {
    const user = userEvent.setup();
    renderPanel();
    const field = screen.getByLabelText('Target rate (%)');
    await user.clear(field);
    await user.type(field, value);
    await user.click(screen.getByRole('button', { name: 'Save target' }));
    expect(h.mutateAsync).toHaveBeenCalledWith(Number(value));
    expect(screen.queryByText('Give the target at most two decimals.')).toBeNull();
  });

  it.each([
    ['92.255', 'Give the target at most two decimals.'],
    ['100.01', 'The target runs from 0 to 100.'],
  ])('refuses the invalid target %s without writing', async (value, message) => {
    const user = userEvent.setup();
    renderPanel();
    const field = screen.getByLabelText('Target rate (%)');
    await user.clear(field);
    await user.type(field, value);
    await user.click(screen.getByRole('button', { name: 'Save target' }));
    expect(h.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('AC-ATR-009 an Admin sees the saved target and saves a new one', async () => {
    const user = userEvent.setup();
    renderPanel();
    const field = screen.getByLabelText('Target rate (%)');
    expect(field).toHaveValue('75');
    await user.clear(field);
    await user.type(field, '90');
    await user.click(screen.getByRole('button', { name: 'Save target' }));
    expect(h.mutateAsync).toHaveBeenCalledWith(90);
  });

  it('AC-ATR-009 with no target it says the view is off, and there is nothing to turn off', () => {
    h.target = null;
    renderPanel();
    expect(screen.getByLabelText('Target rate (%)')).toHaveValue('');
    expect(screen.getByText('Off: the attendance-rate view is not offered.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
  });

  it('AC-ATR-009 an Admin turns the target off', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(h.mutateAsync).toHaveBeenCalledWith(null);
  });

  it('refuses a percentage outside 0–100 without writing it', async () => {
    const user = userEvent.setup();
    renderPanel();
    const field = screen.getByLabelText('Target rate (%)');
    await user.clear(field);
    await user.type(field, '101');
    await user.click(screen.getByRole('button', { name: 'Save target' }));
    expect(h.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('The target runs from 0 to 100.')).toBeInTheDocument();
  });

  it('shows nothing to anyone who may not change the target', () => {
    h.canManage = false;
    renderPanel();
    expect(screen.queryByText('Attendance target')).toBeNull();
  });
});
